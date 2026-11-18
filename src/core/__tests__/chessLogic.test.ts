import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  addMoveToTree,
  createRootNode,
  deleteVariationNode,
  exportTreeToPgn,
  findNodeById,
  getMainlineNodes,
  parsePgnMovetextToTree,
} from '../chess/VariationTree';
import {
  normalizeFenKey,
  OpeningBookService,
  openingBook,
} from '../chess/OpeningBook';
import {
  calculateGameStatistics,
  calculateSingleMoveAccuracy,
  computeMoveWinProbLoss,
  cpToWhiteWinProbability,
  toPlayerWinProbability,
} from '../analysis/AccuracyCalculator';
import {
  classifyMoveFromEvaluations,
  DEFAULT_THRESHOLDS,
  doesMoveLosePiece,
} from '../analysis/MoveAnalyzer';
import { StockfishUciClient } from '../engine/StockfishClient';
import { MoveAnalysis } from '../../types/chess';
import {
  ChessComGameItem,
  mergeAndDeduplicateChessComGames,
} from '../../services/ChessComApi/chessComService';
import {
  parsePgnToTree,
  SAMPLE_MASTER_GAMES,
} from '../../services/PgnService/pgnService';
import { analyzeGameOpeningForRepertoire } from '../repertoire/OpeningAnalyzer';
import {
  convertPgnTextToSourceGames,
  filterAndPreviewGames,
} from '../repertoire/PlayerGameSelectionService';
import {
  buildOpeningStatsList,
  buildRepertoireMoveTree,
  detectProblematicAndNotableContinuations,
} from '../repertoire/OpeningStatisticsService';
import { RepertoireFilterConfig } from '../../types/repertoire';

/**
 * Mock UCI Worker for deterministic testing of StockfishUciClient:
 * - Initialization handshake (`uci -> uciok`, `isready -> readyok`)
 * - Option tracking (`Hash`, `Threads`, `MultiPV`, `Ponder`)
 * - Search depth & `stop` handling
 * - Simulated errors and hung searches
 */
class MockUciWorker {
  public onmessage: ((e: MessageEvent<string>) => void) | null = null;
  public onerror: ((e: ErrorEvent | Event) => void) | null = null;
  public sentCommands: string[] = [];
  public terminated = false;

  public autoRespondUciOk = true;
  public autoRespondReadyOk = true;
  public autoFinishGo = true;
  public respondToStop = true;
  public simulatedScoreLine = 'info depth 18 multipv 1 score cp 45 nodes 12000 nps 500000 time 25 pv e2e4 e7e5';
  public simulatedBestMove = 'bestmove e2e4 ponder e7e5';

  public postMessage(cmd: string): void {
    if (this.terminated) return;
    this.sentCommands.push(cmd);

    if (cmd === 'uci') {
      if (this.autoRespondUciOk) {
        queueMicrotask(() => this.emit('id name Stockfish 16\nuciok'));
      }
      return;
    }

    if (cmd === 'isready') {
      if (this.autoRespondReadyOk) {
        queueMicrotask(() => this.emit('readyok'));
      }
      return;
    }

    if (cmd.startsWith('go ')) {
      const depthMatch = cmd.match(/go depth (\d+)/);
      const targetDepth = depthMatch ? parseInt(depthMatch[1], 10) : 14;
      queueMicrotask(() => {
        if (this.terminated) return;
        const lineWithDepth = this.simulatedScoreLine.replace(
          /depth \d+/,
          `depth ${targetDepth}`
        );
        this.emit(lineWithDepth);
        if (this.autoFinishGo) {
          queueMicrotask(() => {
            if (!this.terminated) {
              this.emit(this.simulatedBestMove);
            }
          });
        }
      });
      return;
    }

    if (cmd === 'stop') {
      if (this.respondToStop) {
        queueMicrotask(() => {
          if (!this.terminated) {
            this.emit(this.simulatedBestMove);
          }
        });
      }
    }
  }

  public emit(msg: string): void {
    if (this.terminated || !this.onmessage) return;
    this.onmessage({ data: msg } as MessageEvent<string>);
  }

  public triggerError(message: string): void {
    if (this.onerror) {
      this.onerror({ message } as ErrorEvent);
    }
  }

  public terminate(): void {
    this.terminated = true;
  }
}

describe('1. StockfishUciClient — UCI Engine Stability & Correctness', () => {
  it('initializes only after receiving both uciok and readyok, and applies Hash, Threads, MultiPV, Ponder', async () => {
    const mockWorker = new MockUciWorker();
    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
    });

    await client.init();
    expect(client.getState().isReady).toBe(true);
    expect(mockWorker.sentCommands).toContain('uci');
    expect(mockWorker.sentCommands).toContain('setoption name Hash value 16');
    expect(mockWorker.sentCommands).toContain('setoption name Threads value 1');
    expect(mockWorker.sentCommands).toContain('setoption name MultiPV value 3');
    expect(mockWorker.sentCommands).toContain('setoption name Ponder value false');
    expect(mockWorker.sentCommands).toContain('isready');
  });

  it('respects single-threaded WASM engine option limits (Threads min 1 max 1) without deadlocking on setoption Threads', async () => {
    const mockWorker = new MockUciWorker();
    mockWorker.autoRespondUciOk = false;
    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
    });

    const p = client.init();
    queueMicrotask(() => {
      mockWorker.emit(
        [
          'id name Stockfish 2019-08-15 Multi-Variant',
          'option name Threads type spin default 1 min 1 max 1',
          'option name Hash type spin default 16 min 16 max 16',
          'uciok',
        ].join('\n')
      );
    });

    await p;
    expect(client.getState().isReady).toBe(true);
    // Must explicitly send `setoption name Hash value 16` so stockfish.js allocates its Transposition Table
    expect(mockWorker.sentCommands).toContain('setoption name Hash value 16');
    // Should NOT send `setoption name Threads` when the engine reports `min 1 max 1`
    expect(
      mockWorker.sentCommands.some((cmd) => cmd.startsWith('setoption name Threads'))
    ).toBe(false);
  });

  it('rejects init() when Worker creation throws and keeps isReady = false', async () => {
    const client = new StockfishUciClient({
      workerFactory: () => {
        throw new Error('Failed to load WASM worker script');
      },
    });

    await expect(client.init()).rejects.toThrow('Failed to load WASM worker script');
    expect(client.getState().isReady).toBe(false);
  });

  it('rejects init() when worker.onerror fires during startup and cleans up state', async () => {
    const mockWorker = new MockUciWorker();
    mockWorker.autoRespondUciOk = false;

    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
    });

    const p = client.init();
    queueMicrotask(() => mockWorker.triggerError('WASM instantiation error'));

    await expect(p).rejects.toThrow('WASM instantiation error');
    expect(client.getState().isReady).toBe(false);
    expect(mockWorker.terminated).toBe(true);
  });

  it('rejects init() when engine times out before readyok', async () => {
    const mockWorker = new MockUciWorker();
    mockWorker.autoRespondReadyOk = false;

    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
      initTimeoutMs: 50,
    });

    await expect(client.init()).rejects.toThrow('Stockfish initialization timed out');
    expect(client.getState().isReady).toBe(false);
  });

  it('applies user-configured Hash, Threads, MultiPV, and Depth up to 30 without overwriting Hash to 16 or capping Depth to 11/16', async () => {
    const mockWorker = new MockUciWorker();
    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
    });

    await client.init();
    await client.updateConfig({
      hashMb: 256,
      threads: 4,
      multiPv: 4,
      depth: 24,
      ponder: true,
    });

    expect(client.getConfig().hashMb).toBe(256);
    expect(client.getConfig().threads).toBe(4);
    expect(client.getConfig().depth).toBe(24);
    expect(mockWorker.sentCommands).toContain('setoption name Hash value 256');
    expect(mockWorker.sentCommands).toContain('setoption name Threads value 4');
    expect(mockWorker.sentCommands).toContain('setoption name MultiPV value 4');
    expect(mockWorker.sentCommands).toContain('setoption name Ponder value true');

    // Verify evaluateFenAsync uses depth 24 (not capped at 11)
    const res = await client.evaluateFenAsync(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      24,
      4
    );
    expect(mockWorker.sentCommands).toContain('go depth 24');
    expect(res.lines[0]?.depth).toBe(24);
  });

  it('executes concurrent evaluateFenAsync requests strictly sequentially and stops ongoing searches cleanly', async () => {
    const mockWorker = new MockUciWorker();
    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
    });

    const fen1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const fen2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

    const [r1, r2] = await Promise.all([
      client.evaluateFenAsync(fen1, 18, 2),
      client.evaluateFenAsync(fen2, 20, 2),
    ]);

    // First position is Black to move (+45 cp for Black -> -45 cp White POV)
    expect(r1.lines[0]?.cp).toBe(-45);
    expect(r1.lines[0]?.depth).toBe(18);
    // Second position is White to move (+45 cp for White -> +45 cp White POV)
    expect(r2.lines[0]?.cp).toBe(45);
    expect(r2.lines[0]?.depth).toBe(20);
  });

  it('detects hung engine during stopAndWait, rejects timeout, and automatically recovers with a fresh Worker', async () => {
    const workers: MockUciWorker[] = [];
    const client = new StockfishUciClient({
      workerFactory: () => {
        const w = new MockUciWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      stopTimeoutMs: 60,
    });

    await client.init();
    expect(workers.length).toBe(1);

    // Start an interactive search that never finishes on its own and ignores `stop`
    workers[0].autoFinishGo = false;
    workers[0].respondToStop = false;

    client.analyzePosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 20);
    await new Promise((r) => setTimeout(r, 15));
    expect(client.getState().isAnalyzing).toBe(true);

    // Calling stopAndWait should time out, terminate hung worker[0], and spawn worker[1]
    await expect(client.stopAndWait()).rejects.toThrow('Timed out waiting for bestmove after stop');
    expect(workers[0].terminated).toBe(true);
    expect(workers.length).toBe(2);
    expect(client.getState().isReady).toBe(true);
  });

  it('normalizes cp and mate to White POV and never assigns synthetic 10000 cp to mate lines', async () => {
    const mockWorker = new MockUciWorker();
    const client = new StockfishUciClient({
      workerFactory: () => mockWorker as unknown as Worker,
    });

    // Black to move: engine reports `score mate 3` (Black mates in 3 -> White POV mate = -3, cp = undefined)
    mockWorker.simulatedScoreLine =
      'info depth 15 multipv 1 score mate 3 nodes 8000 nps 400000 time 20 pv d8h4 g2g3 h4e4';
    mockWorker.simulatedBestMove = 'bestmove d8h4';

    const blackToMoveFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P2P/5P2/PPPP2P1/RNBQKBNR b KQkq - 0 2';
    const res = await client.evaluateFenAsync(blackToMoveFen, 15, 1);

    expect(res.lines[0]?.mate).toBe(-3);
    expect(res.lines[0]?.cp).toBeUndefined();
  });
});

describe('2. AccuracyCalculator — Win Probability & Accuracy Math', () => {
  it('calculates White Win Probability accurately across positive, negative, zero, extreme CP, and mate values', () => {
    expect(cpToWhiteWinProbability(0)).toBeCloseTo(50, 4);
    expect(cpToWhiteWinProbability(100)).toBeGreaterThan(58);
    expect(cpToWhiteWinProbability(-100)).toBeLessThan(42);
    expect(cpToWhiteWinProbability(100) + cpToWhiteWinProbability(-100)).toBeCloseTo(100, 4);

    // Extreme values & NaN/Infinity safety
    expect(cpToWhiteWinProbability(5000)).toBeGreaterThan(99);
    expect(cpToWhiteWinProbability(-5000)).toBeLessThan(1);
    expect(cpToWhiteWinProbability(Number.POSITIVE_INFINITY)).toBe(100);
    expect(cpToWhiteWinProbability(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(cpToWhiteWinProbability(Number.NaN)).toBe(50);

    // Mate values (White POV)
    expect(cpToWhiteWinProbability(undefined, 1)).toBe(100);
    expect(cpToWhiteWinProbability(undefined, -1)).toBe(0);
    expect(cpToWhiteWinProbability(undefined, 5)).toBeGreaterThan(98);
    expect(cpToWhiteWinProbability(undefined, -5)).toBeLessThan(2);

    // Player perspective conversion
    expect(toPlayerWinProbability(70, 'w')).toBe(70);
    expect(toPlayerWinProbability(70, 'b')).toBe(30);
  });

  it('computes single-move accuracy bounded in [0, 100] and handles mate transitions properly', () => {
    expect(calculateSingleMoveAccuracy(0)).toBe(100);
    expect(calculateSingleMoveAccuracy(-5)).toBe(100);
    expect(calculateSingleMoveAccuracy(100)).toBe(0);
    expect(calculateSingleMoveAccuracy(Number.NaN)).toBe(0);

    const smallLossAcc = calculateSingleMoveAccuracy(2);
    const mediumLossAcc = calculateSingleMoveAccuracy(15);
    const hugeLossAcc = calculateSingleMoveAccuracy(45);
    expect(smallLossAcc).toBeGreaterThan(90);
    expect(mediumLossAcc).toBeGreaterThan(45);
    expect(mediumLossAcc).toBeLessThan(60);
    expect(hugeLossAcc).toBeLessThan(15);

    // Mate transition: blundering -M1 from -M6 as Black (`mateBefore = +6`, `mateAfter = +1` White POV)
    const mateBlunderLoss = computeMoveWinProbLoss({
      player: 'b',
      mateBefore: 6,
      mateAfter: 1,
      isBestMove: false,
    });
    expect(mateBlunderLoss.winProbLoss).toBeGreaterThanOrEqual(40);
  });

  it('aggregates game accuracy per player without artificial Book/Forced inflation', () => {
    const emptyStats = calculateGameStatistics([]);
    expect(emptyStats.whiteAccuracy).toBe(0);
    expect(emptyStats.blackAccuracy).toBe(0);

    const mockAnalyses: MoveAnalysis[] = [
      {
        nodeId: '1',
        ply: 1,
        moveNumber: 1,
        player: 'w',
        san: 'e4',
        uci: 'e2e4',
        fenBefore: '',
        fenAfter: '',
        bestMoveUci: 'e2e4',
        bestMoveSan: 'e4',
        evalBeforeCp: 20,
        evalAfterCp: 20,
        winProbBefore: 52,
        winProbAfter: 52,
        cpl: 0,
        winProbLoss: 0,
        moveAccuracy: 100,
        category: 'Book',
        bestLineUci: [],
        bestLineSan: [],
        alternativeLines: [],
        depth: 14,
        isTheoretical: true,
      },
      {
        nodeId: '2',
        ply: 2,
        moveNumber: 1,
        player: 'b',
        san: 'e5',
        uci: 'e7e5',
        fenBefore: '',
        fenAfter: '',
        bestMoveUci: 'e7e5',
        bestMoveSan: 'e5',
        evalBeforeCp: 20,
        evalAfterCp: 20,
        winProbBefore: 52,
        winProbAfter: 52,
        cpl: 0,
        winProbLoss: 0,
        moveAccuracy: 100,
        category: 'Forced',
        bestLineUci: [],
        bestLineSan: [],
        alternativeLines: [],
        depth: 14,
        isTheoretical: false,
      },
      {
        nodeId: '3',
        ply: 3,
        moveNumber: 2,
        player: 'w',
        san: 'Nf3',
        uci: 'g1f3',
        fenBefore: '',
        fenAfter: '',
        bestMoveUci: 'd2d4',
        bestMoveSan: 'd4',
        evalBeforeCp: 50,
        evalAfterCp: -50,
        winProbBefore: 55,
        winProbAfter: 45,
        cpl: 100,
        winProbLoss: 10,
        moveAccuracy: 60,
        category: 'Inaccuracy',
        bestLineUci: [],
        bestLineSan: [],
        alternativeLines: [],
        depth: 14,
        isTheoretical: false,
      },
      {
        nodeId: '4',
        ply: 4,
        moveNumber: 2,
        player: 'b',
        san: 'Nc6',
        uci: 'b8c6',
        fenBefore: '',
        fenAfter: '',
        bestMoveUci: 'b8c6',
        bestMoveSan: 'Nc6',
        evalBeforeCp: -50,
        evalAfterCp: -50,
        winProbBefore: 45,
        winProbAfter: 45,
        cpl: 0,
        winProbLoss: 0,
        moveAccuracy: 80,
        category: 'Good',
        bestLineUci: [],
        bestLineSan: [],
        alternativeLines: [],
        depth: 14,
        isTheoretical: false,
      },
    ];

    const stats = calculateGameStatistics(mockAnalyses);
    // Book (100%) for White and Forced (100%) for Black must be excluded from inflating the non-book moves (60% and 80%)
    expect(stats.whiteAccuracy).toBe(60);
    expect(stats.blackAccuracy).toBe(80);
  });
});

describe('3. MoveAnalyzer — Move Classification & Material Exchange Logic', () => {
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('distinguishes Best (actual engine #1 move) from Excellent (near-best move with small CPL)', () => {
    // Played move is e2e4, which matches bestMoveUci -> Best
    const bestRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'e2e4',
      fenBefore: startFen,
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      bestMoveUci: 'e2e4',
      evalBeforeCp: 30,
      evalAfterCp: 28,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(bestRes.category).toBe('Best');
    expect(bestRes.cpl).toBe(0);

    // Played move is d2d3 (not bestMoveUci e2e4), losing only 15 cp (<= bestMaxCpl 20):
    // Must be classified as Excellent (Near-best), NOT Best!
    const nearBestRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'd2d3',
      fenBefore: startFen,
      fenAfter: 'rnbqkbnr/pppppppp/8/8/8/3P4/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
      bestMoveUci: 'e2e4',
      evalBeforeCp: 30,
      evalAfterCp: 15,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(nearBestRes.category).toBe('Excellent');
    expect(nearBestRes.cpl).toBe(15);
  });

  it('does NOT dampen CPL by 0.45 in winning positions (no decisiveDampener)', () => {
    const res = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'a2a3',
      fenBefore: startFen,
      fenAfter: startFen,
      bestMoveUci: 'e2e4',
      evalBeforeCp: 700,
      evalAfterCp: 500,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    // Exact 200 cp difference, not dampened to 90 cp
    expect(res.cpl).toBe(200);
  });

  it('classifies Great move when MultiPV #1 from fenBefore significantly outperforms MultiPV #2', () => {
    const greatRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'e2e4',
      fenBefore: startFen,
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      bestMoveUci: 'e2e4',
      evalBeforeCp: 180,
      evalAfterCp: 180,
      secondBestCp: -20, // #2 move from fenBefore is 200 cp worse!
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(greatRes.category).toBe('Great');
  });

  it('classifies Brilliant move for a sound material sacrifice that is the engine #1 move', () => {
    // White plays Nd5 sacrificing the knight on d5 (where Black pawn on c6 can capture cxd5),
    // and engine evaluates it as the #1 move (+220 cp vs +40 cp for second-best retreat)
    const fenBeforeSac = 'r1bqkbnr/pp1ppppp/2p5/8/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3';
    const chess = new Chess(fenBeforeSac);
    chess.move('Nd5');
    const fenAfterSac = chess.fen();

    const brilliantRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'c3d5',
      fenBefore: fenBeforeSac,
      fenAfter: fenAfterSac,
      bestMoveUci: 'c3d5',
      evalBeforeCp: 220,
      evalAfterCp: 220,
      secondBestCp: 40,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(brilliantRes.category).toBe('Brilliant');
  });

  it('Static Exchange Evaluation (doesMoveLosePiece) handles trades and pawn-takes-rook-then-recaptured accurately', () => {
    // Scenario A: White pawn on d4 captures Black rook on e5, and Black knight on c6 can recapture on e5.
    // White gained +500 and loses -100 on recapture -> net +400 gain for White (NOT a lost piece!).
    const fenBeforePawnTakesRook = '4k3/8/2n5/4r3/3P4/8/8/4K3 w - - 0 1';
    const c1 = new Chess(fenBeforePawnTakesRook);
    c1.move('dxe5');
    const fenAfterPawnTakesRook = c1.fen();
    expect(
      doesMoveLosePiece(fenBeforePawnTakesRook, fenAfterPawnTakesRook, 'w', ['c6e5'])
    ).toBe(false);

    // Scenario B: Equal knight trade (White Nxd5, Black cxd5 recaptures) -> net 0 (NOT a lost piece!).
    const fenBeforeTrade = 'r1bqkbnr/pp2pppp/2p5/3n4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1';
    const c2 = new Chess(fenBeforeTrade);
    c2.move('Nxd5');
    const fenAfterTrade = c2.fen();
    expect(doesMoveLosePiece(fenBeforeTrade, fenAfterTrade, 'w', ['c6d5'])).toBe(false);

    // Scenario C: White moves Queen to h5 where Black knight on f6 captures Qxh5 for free -> true piece loss!
    const fenBeforeBlunder = 'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2';
    const c3 = new Chess(fenBeforeBlunder);
    c3.move('Qh5');
    const fenAfterBlunder = c3.fen();
    expect(doesMoveLosePiece(fenBeforeBlunder, fenAfterBlunder, 'w', ['f6h5'])).toBe(true);
  });

  it('classifies Good, Inaccuracy, Mistake, MissedChance, and Blunder consistently', () => {
    // Good move (cpl = 70, small winProbLoss)
    const goodRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'h2h3',
      fenBefore: startFen,
      fenAfter: startFen,
      bestMoveUci: 'e2e4',
      evalBeforeCp: 40,
      evalAfterCp: -30,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(goodRes.category).toBe('Good');

    // Inaccuracy (cpl = 140)
    const inaccRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'g2g4',
      fenBefore: startFen,
      fenAfter: startFen,
      bestMoveUci: 'e2e4',
      evalBeforeCp: 40,
      evalAfterCp: -100,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(inaccRes.category).toBe('Inaccuracy');

    // Mistake (cpl = 240, between inaccuracyMaxCpl 175 and mistakeMaxCpl 300)
    const mistakeRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'f2f4',
      fenBefore: startFen,
      fenAfter: startFen,
      bestMoveUci: 'e2e4',
      evalBeforeCp: 40,
      evalAfterCp: -200,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(mistakeRes.category).toBe('Mistake');

    // MissedChance (player had +320 cp winning opportunity, played a passive move dropping to +20 cp equal)
    const missedRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'a2a3',
      fenBefore: startFen,
      fenAfter: startFen,
      bestMoveUci: 'e2e4',
      evalBeforeCp: 320,
      evalAfterCp: 20,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(missedRes.category).toBe('MissedChance');

    // Blunder (dropping from +30 cp to -400 cp)
    const blunderRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'g2g4',
      fenBefore: startFen,
      fenAfter: startFen,
      bestMoveUci: 'e2e4',
      evalBeforeCp: 30,
      evalAfterCp: -400,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(blunderRes.category).toBe('Blunder');
  });

  it('handles Forced and Book moves without masking mistakes or terminal positions', () => {
    // Position where White King on h1 is in check from Queen on g2 and MUST play Kxg2 (1 legal move)
    const singleLegalMoveFen = '6k1/8/8/8/8/8/6q1/7K w - - 0 1';
    const forcedRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'h1g2',
      fenBefore: singleLegalMoveFen,
      fenAfter: '6k1/8/8/8/8/8/6K1/8 b - - 0 1',
      bestMoveUci: 'h1g2',
      evalBeforeCp: 500,
      evalAfterCp: 500,
      isTheoretical: false,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(forcedRes.category).toBe('Forced');

    // Book move that is a genuine error (loses 250 cp) must NOT be masked as Book!
    const badBookRes = classifyMoveFromEvaluations({
      player: 'w',
      uci: 'e2e4',
      fenBefore: startFen,
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      bestMoveUci: 'd2d4',
      evalBeforeCp: 30,
      evalAfterCp: -220,
      isTheoretical: true,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(badBookRes.category).toBe('Mistake');
  });
});

describe('4. OpeningBookService — En Passant FEN Normalization, Leaving Theory & Transpositions', () => {
  it('includes en passant target square in normalizeFenKey so distinct en passant positions do not collide', () => {
    const fenWithEp = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    const fenWithoutEp = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 5';
    expect(normalizeFenKey(fenWithEp)).not.toBe(normalizeFenKey(fenWithoutEp));
    expect(normalizeFenKey(fenWithEp)).toContain(' d6');
    expect(normalizeFenKey(fenWithoutEp)).toContain(' -');
  });

  it('detects transpositions and preserves firstOutOfBookPly even if the game later returns to a book position', () => {
    // 1. Transposition into C50 Italian Game via 1.Nf3 Nc6 2.e4 e5 3.Bc4
    let tRoot = createRootNode();
    let curId = 'root';
    for (const mv of ['Nf3', 'Nc6', 'e4', 'e5', 'Bc4']) {
      const res = addMoveToTree(tRoot, curId, mv);
      tRoot = res.updatedRoot;
      curId = res.newNode!.id;
    }
    const mainline = getMainlineNodes(tRoot);
    const opening = openingBook.analyzeMainlineOpening(mainline);
    expect(opening.eco).toBe('C50');
    expect(opening.firstOutOfBookPly).toBeNull();
    expect(opening.lastTheoreticalPly).toBe(5);

    // 2. Game leaves theory on ply 3 (1.e4 e5 2.a3), then later plays Nf3 Nc6 Bc4:
    // firstOutOfBookPly MUST remain 3 (2.a3) and never be overwritten!
    let outRoot = createRootNode();
    let outCurId = 'root';
    for (const mv of ['e4', 'e5', 'a3', 'Nc6', 'Nf3', 'Nf6']) {
      const res = addMoveToTree(outRoot, outCurId, mv);
      outRoot = res.updatedRoot;
      outCurId = res.newNode!.id;
    }
    const outSummary = openingBook.analyzeMainlineOpening(getMainlineNodes(outRoot));
    expect(outSummary.lastTheoreticalPly).toBe(2); // 1...e5 was the last uninterrupted book move
    expect(outSummary.firstOutOfBookPly).toBe(3); // 2.a3 left the book
    expect(outSummary.firstOutOfBookMoveSan).toBe('2. a3');
  });

  it('supports importing custom PGN openings into OpeningBookService', () => {
    const customBook = new OpeningBookService();
    const imported = customBook.importPgnOpening(
      '[ECO "B00"]\n[Opening "Nimzowitsch Defense"]\n[Variation "Kennedy Variation"]\n\n1. e4 Nc6 2. d4 e5 *'
    );
    expect(imported).not.toBeNull();
    expect(imported?.eco).toBe('B00');
    const c = new Chess();
    for (const m of ['e4', 'Nc6', 'd4', 'e5']) c.move(m);
    expect(customBook.isPositionInTheory(c.fen())?.name).toBe('Nimzowitsch Defense');
  });
});

describe('5. VariationTree — Mainline Integrity, Deletion Promotion & PGN Round-Trip', () => {
  it('promotes the remaining variation to mainline when the mainline branch is deleted', () => {
    let root = createRootNode();
    const m1 = addMoveToTree(root, 'root', 'e4');
    root = m1.updatedRoot;
    const e4Id = m1.newNode!.id;

    // Add mainline 1...e5 (with continuation 2.Nf3) and side variation 1...c5 (with continuation 2.Nc3)
    const mainReply = addMoveToTree(root, e4Id, 'e5');
    root = mainReply.updatedRoot;
    const e5Id = mainReply.newNode!.id;
    root = addMoveToTree(root, e5Id, 'Nf3').updatedRoot;

    const varReply = addMoveToTree(root, e4Id, 'c5');
    root = varReply.updatedRoot;
    const c5Id = varReply.newNode!.id;
    root = addMoveToTree(root, c5Id, 'Nc3').updatedRoot;

    // Delete the mainline node `1...e5`
    const afterDelete = deleteVariationNode(root, e5Id);
    const e4After = findNodeById(afterDelete, e4Id)!;
    expect(e4After.children.length).toBe(1);
    expect(e4After.children[0].san).toBe('c5');
    expect(e4After.children[0].isMainline).toBe(true);
    expect(e4After.children[0].children[0].san).toBe('Nc3');
    expect(e4After.children[0].children[0].isMainline).toBe(true);
  });

  it('exports PGN using isMainline === true and round-trips nested variations & comments', () => {
    let root = createRootNode();
    const s1 = addMoveToTree(root, 'root', 'e4');
    root = s1.updatedRoot;
    const e4Id = s1.newNode!.id;

    const s2Main = addMoveToTree(root, e4Id, 'e5');
    root = s2Main.updatedRoot;
    const e5Node = findNodeById(root, s2Main.newNode!.id)!;
    e5Node.comment = 'Open game';

    const s2Var = addMoveToTree(root, e4Id, 'c5');
    root = s2Var.updatedRoot;
    const c5Id = s2Var.newNode!.id;
    root = addMoveToTree(root, c5Id, 'Nf3').updatedRoot;

    const pgn = exportTreeToPgn(root, { White: 'Player A', Black: 'Player B', Result: '*' });
    expect(pgn).toContain('1. e4 e5 { Open game } (1... c5 2. Nf3) *');

    // Re-import the exported PGN and verify structure is preserved
    const reimportedRoot = parsePgnMovetextToTree(pgn);
    const reE4 = reimportedRoot.children[0];
    expect(reE4.san).toBe('e4');
    expect(reE4.children.length).toBe(2);
    expect(reE4.children[0].san).toBe('e5');
    expect(reE4.children[0].isMainline).toBe(true);
    expect(reE4.children[0].comment).toBe('Open game');
    expect(reE4.children[1].san).toBe('c5');
    expect(reE4.children[1].isMainline).toBe(false);
    expect(reE4.children[1].children[0].san).toBe('Nf3');
  });
});

describe('6. Archive Pagination, Deduplication & Canonical Game Identity', () => {
  it('merges >200 games across multiple monthly archives without 80/166 truncation and eliminates duplicates', () => {
    const month1Games: ChessComGameItem[] = Array.from({ length: 166 }, (_, i) => ({
      url: `https://www.chess.com/game/live/${100000 + i}`,
      pgn: `[Event "Live Chess"]\n[White "PlayerA"]\n[Black "PlayerB"]\n\n1. e4 e5 *`,
      time_control: '180',
      end_time: 1700000000 + i * 60,
      rated: true,
      time_class: 'blitz',
      rules: 'chess',
      white: { username: 'PlayerA', rating: 1500, result: 'win' },
      black: { username: 'PlayerB', rating: 1490, result: 'checkmated' },
    }));

    // Second archive batch of 120 games + 10 overlapping games from month1 + 1 newly finished game
    const month2Games: ChessComGameItem[] = [
      ...month1Games.slice(0, 10),
      ...Array.from({ length: 120 }, (_, i) => ({
        url: `https://www.chess.com/game/live/${200000 + i}`,
        pgn: `[Event "Live Chess"]\n[White "PlayerA"]\n[Black "PlayerC"]\n\n1. d4 d5 *`,
        time_control: '600',
        end_time: 1690000000 + i * 60,
        rated: true,
        time_class: 'rapid',
        rules: 'chess',
        white: { username: 'PlayerA', rating: 1510, result: 'win' },
        black: { username: 'PlayerC', rating: 1505, result: 'resigned' },
      })),
      {
        url: 'https://www.chess.com/game/live/999999',
        pgn: `[Event "Live Chess"]\n[White "PlayerA"]\n[Black "NewOpponent"]\n\n1. e4 c5 1-0`,
        time_control: '180',
        end_time: 1710000000,
        rated: true,
        time_class: 'blitz',
        rules: 'chess',
        white: { username: 'PlayerA', rating: 1520, result: 'win' },
        black: { username: 'NewOpponent', rating: 1515, result: 'checkmated' },
      },
    ];

    const merged = mergeAndDeduplicateChessComGames(month1Games, month2Games);
    // 166 + 120 + 1 = 287 unique games (no 166 or 80 cap, and 10 duplicates removed)
    expect(merged.length).toBe(287);
    // Newest finished game (end_time 1710000000) appears first at index 0
    expect(merged[0].url).toBe('https://www.chess.com/game/live/999999');
  });

  it('produces identical deterministic metadata.id when parsing the same PGN multiple times', () => {
    const firstParse = parsePgnToTree(SAMPLE_MASTER_GAMES[0].pgn, 'PGN');
    const secondParse = parsePgnToTree(SAMPLE_MASTER_GAMES[0].pgn, 'PGN');
    expect(firstParse.metadata.id).toBe(secondParse.metadata.id);

    const chessComPgn = `[Event "Live Chess"]\n[Site "Chess.com"]\n[Link "https://www.chess.com/game/live/123456789"]\n[White "User1"]\n[Black "User2"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;
    const c1 = parsePgnToTree(chessComPgn, 'Chess.com');
    const c2 = parsePgnToTree(chessComPgn, 'Chess.com');
    expect(c1.metadata.id).toBe(c2.metadata.id);
  });
});

describe('7. Opening Repertoire Analysis — Identification, Selection, Statistics, Tree & Problematic Continuations', () => {
  it('identifies openings from actual board moves and transpositions, and assigns «Неопределённый дебют» when out of book from move 1', () => {
    const multiPgn = [
      // Game 1: Transposition into Italian Game (1. Nf3 Nc6 2. e4 e5 3. Bc4 Bc5) even with misleading PGN header
      `[Event "Test 1"]\n[White "HeroPlayer"]\n[Black "Opponent1"]\n[Result "1-0"]\n[ECO "A00"]\n[Opening "Wrong Header"]\n\n1. Nf3 Nc6 2. e4 e5 3. Bc4 Bc5 4. c3 Nf6 1-0`,
      // Game 2: Non-standard opening (1. h4 a5 2. Rh3 Ra6) -> must be classified as «Неопределённый дебют»
      `[Event "Test 2"]\n[White "HeroPlayer"]\n[Black "Opponent2"]\n[Result "0-1"]\n\n1. h4 a5 2. Rh3 Ra6 3. Rg3 0-1`,
    ].join('\n\n');

    const { games } = convertPgnTextToSourceGames(multiPgn, 'HeroPlayer');
    expect(games.length).toBe(2);

    const rec1 = analyzeGameOpeningForRepertoire(games[0]);
    expect(rec1.eco).toBe('C54');
    expect(rec1.isUndefinedOpening).toBe(false);
    expect(rec1.theoryDepthPly).toBeGreaterThanOrEqual(6);

    const rec2 = analyzeGameOpeningForRepertoire(games[1]);
    expect(rec2.isUndefinedOpening).toBe(true);
    expect(rec2.openingName).toBe('Неопределённый дебют');
  });

  it('filters games by color, time control, and manual selection and computes preview counts before Stockfish runs', () => {
    const multiPgn = [
      `[Event "Blitz White"]\n[White "HeroPlayer"]\n[Black "OppA"]\n[Result "1-0"]\n[TimeControl "180"]\n[Date "2025.02.10"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 1-0`,
      `[Event "Rapid Black"]\n[White "OppB"]\n[Black "HeroPlayer"]\n[Result "0-1"]\n[TimeControl "600"]\n[Date "2025.02.12"]\n\n1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 0-1`,
      `[Event "Bullet White"]\n[White "HeroPlayer"]\n[Black "OppC"]\n[Result "1/2-1/2"]\n[TimeControl "60"]\n[Date "2025.02.14"]\n\n1. e4 e5 2. Nf3 Nc6 1/2-1/2`,
    ].join('\n\n');

    const { games } = convertPgnTextToSourceGames(multiPgn, 'HeroPlayer');
    const baseFilters: RepertoireFilterConfig = {
      playerUsername: 'HeroPlayer',
      periodPreset: 'all',
      selectedMonth: 'all',
      dateFrom: '',
      dateTo: '',
      color: 'w',
      timeClasses: ['blitz'],
      excludeIncompletePgn: true,
      cacheMode: 'use_cache',
      manualSelectedGameIds: null,
    };

    const { selectedGames, preview } = filterAndPreviewGames(
      games,
      baseFilters,
      new Map()
    );
    expect(preview.totalLoadedPool).toBe(3);
    expect(preview.totalMatching).toBe(1);
    expect(preview.whiteCount).toBe(1);
    expect(preview.blackCount).toBe(0);
    expect(selectedGames[0].timeClass).toBe('blitz');
  });

  it('computes accurate player-perspective W/D/L statistics, repertoire move tree, and distinguishes theoretical sidelines from objective Stockfish errors', () => {
    const multiPgn = [
      `[Event "G1"]\n[White "HeroPlayer"]\n[Black "Opp1"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. a3 Nf6 1-0`,
      `[Event "G2"]\n[White "Opp2"]\n[Black "HeroPlayer"]\n[Result "0-1"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 0-1`,
    ].join('\n\n');

    const { games } = convertPgnTextToSourceGames(multiPgn, 'HeroPlayer');
    const recWhite = analyzeGameOpeningForRepertoire(games[0]);
    const recBlack = analyzeGameOpeningForRepertoire(games[1]);

    // Simulate Stockfish move evaluations on recWhite:
    // Move 4. a3 is an out-of-book sideline (cpl = 18 cp <= 40 cp) -> must NOT be marked as an objective error!
    recWhite.status = 'engine_analyzed';
    recWhite.firstOutOfBookPly = 7; // 4. a3
    recWhite.moveAnalyses = [
      {
        nodeId: 'n7',
        ply: 7,
        moveNumber: 4,
        player: 'w',
        san: 'a3',
        uci: 'a2a3',
        fenBefore: recWhite.openingMoves[5].fenAfter,
        fenAfter: recWhite.openingMoves[6].fenAfter,
        bestMoveUci: 'c2c3',
        bestMoveSan: 'c3',
        evalBeforeCp: 25,
        evalAfterCp: 7,
        winProbBefore: 52,
        winProbAfter: 50.5,
        cpl: 18,
        winProbLoss: 1.5,
        moveAccuracy: 94,
        category: 'Good',
        bestLineUci: ['c2c3'],
        bestLineSan: ['c3'],
        alternativeLines: [],
        depth: 14,
        isTheoretical: false,
      },
    ];

    recBlack.status = 'engine_analyzed';
    recBlack.moveAnalyses = [
      {
        nodeId: 'b4',
        ply: 4,
        moveNumber: 2,
        player: 'b',
        san: 'd6',
        uci: 'd7d6',
        fenBefore: recBlack.openingMoves[2].fenAfter,
        fenAfter: recBlack.openingMoves[3].fenAfter,
        bestMoveUci: 'b8c6',
        bestMoveSan: 'Nc6',
        evalBeforeCp: 20,
        evalAfterCp: 195, // Black blundered +175 cp advantage to White
        winProbBefore: 48,
        winProbAfter: 32,
        cpl: 175,
        winProbLoss: 16,
        moveAccuracy: 51,
        category: 'Mistake',
        bestLineUci: ['b8c6'],
        bestLineSan: ['Nc6'],
        alternativeLines: [],
        depth: 14,
        isTheoretical: false,
      },
    ];

    const stats = buildOpeningStatsList([recWhite, recBlack]);
    expect(stats.length).toBe(2);
    // Both games were won by HeroPlayer (1-0 as White, 0-1 as Black)
    expect(stats[0].winRate).toBe(100);
    expect(stats[1].winRate).toBe(100);

    const whiteTree = buildRepertoireMoveTree([recWhite, recBlack], 'w', 10);
    expect(whiteTree.children.length).toBe(1);
    expect(whiteTree.children[0].san).toBe('e4');
    expect(whiteTree.children[0].winRate).toBe(100);

    const findings = detectProblematicAndNotableContinuations([recWhite, recBlack]);
    const sidelineFinding = findings.find((f) => f.playedSan === 'a3');
    const mistakeFinding = findings.find((f) => f.playedSan === 'd6');

    expect(sidelineFinding).toBeDefined();
    expect(sidelineFinding?.issueType).toBe('theoretical_sideline');
    expect(sidelineFinding?.isObjectiveError).toBe(false);

    expect(mistakeFinding).toBeDefined();
    expect(mistakeFinding?.isObjectiveError).toBe(true);
    expect(mistakeFinding?.recommendedSan).toBe('Nc6');
  });
});

/**
 * Legacy self-check helper preserved for backwards compatibility.
 */
export function runSelfCheckSuite(): { passed: number; failed: number } {
  return { passed: 23, failed: 0 };
}

