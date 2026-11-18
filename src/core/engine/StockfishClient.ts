import { Chess } from 'chess.js';
import { EngineConfig, EngineLine, EngineState, PlayerColor } from '../../types/chess';
import { uciLineToSan } from '../chess/VariationTree';

type EngineStateListener = (state: EngineState) => void;

export interface SearchResult {
  bestMove: string;
  lines: EngineLine[];
}

export interface StockfishClientOptions {
  workerFactory?: () => Worker;
  initTimeoutMs?: number;
  stopTimeoutMs?: number;
  searchTimeoutMs?: number;
  maxDepth?: number;
}

export const DEFAULT_MAX_DEPTH = 30;
export const MIN_ALLOWED_DEPTH = 1;
export const MIN_HASH_MB = 1;
export const MAX_HASH_MB = 2048;
export const MIN_THREADS = 1;
export const MAX_THREADS = 32;
export const MIN_MULTIPV = 1;
export const MAX_MULTIPV = 10;

interface PendingSearch {
  id: number;
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface PendingStopWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * UCI client for Stockfish WebAssembly / Web Worker.
 *
 * Key guarantees:
 * 1. Strict initialization: `isReady` only becomes `true` after both `uciok` and `readyok`.
 *    Any Worker creation error, `worker.onerror`, or timeout rejects `init()` and cleans up state.
 * 2. Sequential command execution: All `updateConfig`, `analyzePosition`, `evaluateFenAsync`,
 *    and `newGame` calls are serialized through `commandQueue`.
 * 3. Reliable search stopping: `stopAndWait()` waits for the engine's actual `bestmove` + `readyok`
 *    synchronization barrier. A timeout is treated as a hung engine error and triggers automatic
 *    Worker recovery so stale `bestmove` outputs never leak into subsequent searches.
 * 4. Authentic parameters: Depth (up to configurable `maxDepth`, default 30), `Hash`, `Threads`,
 *    `MultiPV`, and `Ponder` are validated and applied via UCI `setoption` followed by `isready` -> `readyok`.
 * 5. Strict separation of `cp` and `mate`: Evaluations are normalized from side-to-move POV
 *    to White POV (`+` = White advantage/mate, `-` = Black advantage/mate) without injecting
 *    synthetic centipawn numbers into mate evaluations.
 */
export class StockfishUciClient {
  private worker: Worker | null = null;
  private workerFactory: () => Worker;
  private initPromise: Promise<void> | null = null;
  private isReady = false;
  private isAnalyzing = false;

  private initTimeoutMs: number;
  private stopTimeoutMs: number;
  private searchTimeoutMs: number;

  private currentFen: string = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  private activeTurn: PlayerColor = 'w';
  private currentDepth = 0;
  private nps = 0;
  private bestMoveUci: string | null = null;
  private ponderUci: string | null = null;
  private linesMap: Map<number, EngineLine> = new Map();
  private listeners: Set<EngineStateListener> = new Set();

  private appliedMultiPv = 0;
  private appliedHashMb = 0;
  private appliedThreads = 0;
  private appliedPonder: boolean | null = null;
  private engineThreadLimits: { defaultVal: number; min: number; max: number } | null = null;
  private engineHashLimits: { defaultVal: number; min: number; max: number } | null = null;

  private stopWaiters: PendingStopWaiter[] = [];
  private readyWaiters: PendingReadyWaiter[] = [];
  private activeSearch: PendingSearch | null = null;
  private currentSearchId = 0;
  private isStoppingCurrentSearch = false;

  private commandQueue: Promise<unknown> = Promise.resolve();
  private latestInteractiveRequestId = 0;

  private config: EngineConfig = {
    depth: 14,
    maxDepth: DEFAULT_MAX_DEPTH,
    movetimeMs: 0,
    multiPv: 3,
    hashMb: 16,
    threads: 1,
    ponder: false,
  };

  constructor(options: StockfishClientOptions = {}) {
    this.workerFactory =
      options.workerFactory || (() => new Worker('/stockfish/stockfish.js'));
    this.initTimeoutMs = options.initTimeoutMs ?? 15000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 12000;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 45000;
    if (options.maxDepth !== undefined) {
      this.config.maxDepth = Math.max(MIN_ALLOWED_DEPTH, Math.floor(options.maxDepth));
    }
  }

  public getConfig(): EngineConfig {
    return { ...this.config };
  }

  /**
   * Clamps depth to `[1, config.maxDepth || 30]` without hidden low caps.
   */
  public normalizeDepth(requestedDepth?: number): number {
    const maxAllowed = Math.max(
      MIN_ALLOWED_DEPTH,
      this.config.maxDepth ?? DEFAULT_MAX_DEPTH
    );
    const raw =
      requestedDepth !== undefined && Number.isFinite(requestedDepth)
        ? Math.floor(requestedDepth)
        : this.config.depth;
    return Math.max(MIN_ALLOWED_DEPTH, Math.min(maxAllowed, raw));
  }

  public static clampHashMb(hashMb: number): number {
    if (!Number.isFinite(hashMb)) return 16;
    return Math.max(MIN_HASH_MB, Math.min(MAX_HASH_MB, Math.floor(hashMb)));
  }

  public static clampThreads(threads: number): number {
    if (!Number.isFinite(threads)) return 1;
    return Math.max(MIN_THREADS, Math.min(MAX_THREADS, Math.floor(threads)));
  }

  public static clampMultiPv(multiPv: number): number {
    if (!Number.isFinite(multiPv)) return 3;
    return Math.max(MIN_MULTIPV, Math.min(MAX_MULTIPV, Math.floor(multiPv)));
  }

  /**
   * Initializes the Stockfish Worker and performs the full `uci -> uciok -> setoption -> isready -> readyok` handshake.
   * Rejects if the Worker fails to construct, emits an error, or times out.
   */
  public init(): Promise<void> {
    if (this.isReady && this.worker) {
      return Promise.resolve();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      let uciOkReceived = false;
      let settled = false;

      const initTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.cleanupWorkerState(new Error('Stockfish initialization timed out'));
        reject(new Error('Stockfish initialization timed out'));
      }, this.initTimeoutMs);

      const failInit = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(initTimer);
        const errorObj =
          err instanceof Error
            ? err
            : new Error(typeof err === 'string' ? err : 'Stockfish Worker failed to initialize');
        this.cleanupWorkerState(errorObj);
        reject(errorObj);
      };

      let worker: Worker;
      try {
        worker = this.workerFactory();
        this.worker = worker;
      } catch (err) {
        failInit(err);
        return;
      }

      worker.onmessage = (e: MessageEvent<string>) => {
        const raw = typeof e.data === 'string' ? e.data : String(e.data ?? '');
        const lines = raw.split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          if (!this.isReady) {
            if (line.startsWith('option name ')) {
              this.parseEngineOptionLimits(line);
              continue;
            }
            if (line === 'uciok' && !uciOkReceived) {
              uciOkReceived = true;
              this.sendRaw('setoption name UCI_AnalyseMode value true');
              this.sendRaw('setoption name Contempt value 0');
              this.sendRaw('setoption name Analysis Contempt value Off');
              this.applyEngineOptionsRaw(this.config);
              this.sendRaw('isready');
              continue;
            }
            if (line === 'readyok' && uciOkReceived) {
              if (!settled) {
                settled = true;
                clearTimeout(initTimer);
                this.isReady = true;
                this.emitState();
                resolve();
              }
              continue;
            }
          } else {
            this.handleUciMessage(line);
          }
        }
      };

      worker.onerror = (err: ErrorEvent | Event) => {
        const msg =
          err && 'message' in err && typeof err.message === 'string' && err.message
            ? err.message
            : 'Stockfish Worker runtime error';
        const errorObj = new Error(msg);
        if (!this.isReady) {
          failInit(errorObj);
        } else {
          this.cleanupWorkerState(errorObj);
        }
      };

      try {
        this.sendRaw('uci');
      } catch (err) {
        failInit(err);
      }
    });

    return this.initPromise;
  }

  private parseEngineOptionLimits(line: string): void {
    const threadsMatch = line.match(
      /^option\s+name\s+Threads\s+type\s+spin\s+default\s+(\d+)\s+min\s+(\d+)\s+max\s+(\d+)/i
    );
    if (threadsMatch) {
      const defaultVal = parseInt(threadsMatch[1], 10);
      const min = parseInt(threadsMatch[2], 10);
      const max = parseInt(threadsMatch[3], 10);
      this.engineThreadLimits = { defaultVal, min, max };
      if (max <= 1) {
        this.appliedThreads = defaultVal;
      }
      return;
    }

    const hashMatch = line.match(
      /^option\s+name\s+Hash\s+type\s+spin\s+default\s+(\d+)\s+min\s+(\d+)\s+max\s+(\d+)/i
    );
    if (hashMatch) {
      const defaultVal = parseInt(hashMatch[1], 10);
      const min = parseInt(hashMatch[2], 10);
      const max = parseInt(hashMatch[3], 10);
      this.engineHashLimits = { defaultVal, min, max };
      // Note: Do NOT pre-populate `this.appliedHashMb = defaultVal` here.
      // In Emscripten stockfish.js builds, `TT.resize()` (callback 241) is only invoked
      // when `setoption name Hash value <N>` is explicitly executed at least once.
    }
  }

  private isSingleThreadedBuild(): boolean {
    return this.engineThreadLimits !== null && this.engineThreadLimits.max <= 1;
  }

  private applyEngineOptionsRaw(cfg: EngineConfig): void {
    let hashMb = StockfishUciClient.clampHashMb(cfg.hashMb);
    if (this.engineHashLimits) {
      hashMb = Math.max(
        this.engineHashLimits.min,
        Math.min(this.engineHashLimits.max, hashMb)
      );
    }

    let threads = StockfishUciClient.clampThreads(cfg.threads);
    if (this.engineThreadLimits) {
      threads = Math.max(
        this.engineThreadLimits.min,
        Math.min(this.engineThreadLimits.max, threads)
      );
    }

    const multiPv = StockfishUciClient.clampMultiPv(cfg.multiPv);
    const ponder = Boolean(cfg.ponder);

    if (this.appliedHashMb !== hashMb) {
      this.sendRaw(`setoption name Hash value ${hashMb}`);
      this.appliedHashMb = hashMb;
    }

    // Single-threaded Emscripten builds advertise `min 1 max 1` and deadlock inside `Threads::set`
    // if `setoption name Threads` is called without pthreads support.
    if (!this.isSingleThreadedBuild() && this.appliedThreads !== threads) {
      this.sendRaw(`setoption name Threads value ${threads}`);
      this.appliedThreads = threads;
    }

    if (this.appliedMultiPv !== multiPv) {
      this.sendRaw(`setoption name MultiPV value ${multiPv}`);
      this.appliedMultiPv = multiPv;
    }
    if (this.appliedPonder !== ponder) {
      this.sendRaw(`setoption name Ponder value ${ponder ? 'true' : 'false'}`);
      this.appliedPonder = ponder;
    }
  }

  private sendRaw(cmd: string): void {
    if (!this.worker) {
      throw new Error('Stockfish Worker is not available');
    }
    this.worker.postMessage(cmd);
  }

  /**
   * Sends `isready` and waits for `readyok` from the engine.
   * Ensures all prior `setoption` or stopped search outputs have been processed.
   */
  private waitReady(): Promise<void> {
    if (!this.isReady || !this.worker) {
      return Promise.reject(new Error('Stockfish engine is not ready'));
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.readyWaiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.readyWaiters.splice(idx, 1);
        reject(new Error('Timed out waiting for readyok from Stockfish'));
      }, this.stopTimeoutMs);

      this.readyWaiters.push({ resolve, reject, timeoutId });
      try {
        this.sendRaw('isready');
      } catch (err) {
        clearTimeout(timeoutId);
        const idx = this.readyWaiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.readyWaiters.splice(idx, 1);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Terminates a broken/hung Worker, rejects all pending promises, and resets internal state.
   */
  private cleanupWorkerState(reason: Error): void {
    if (this.worker) {
      try {
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.terminate();
      } catch {
        // ignore termination errors
      }
      this.worker = null;
    }

    this.initPromise = null;
    this.isReady = false;
    this.isAnalyzing = false;
    this.isStoppingCurrentSearch = false;
    this.appliedMultiPv = 0;
    this.appliedHashMb = 0;
    this.appliedThreads = 0;
    this.appliedPonder = null;
    this.engineThreadLimits = null;
    this.engineHashLimits = null;

    if (this.activeSearch) {
      const pending = this.activeSearch;
      this.activeSearch = null;
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(reason);
    }

    const sWaiters = [...this.stopWaiters];
    this.stopWaiters = [];
    for (const w of sWaiters) {
      clearTimeout(w.timeoutId);
      w.reject(reason);
    }

    const rWaiters = [...this.readyWaiters];
    this.readyWaiters = [];
    for (const w of rWaiters) {
      clearTimeout(w.timeoutId);
      w.reject(reason);
    }

    this.emitState();
  }

  /**
   * Restarts the Worker if the previous instance hung or crashed.
   */
  public async restartWorker(): Promise<void> {
    this.cleanupWorkerState(new Error('Stockfish Worker restarted'));
    await this.init();
  }

  /**
   * Disposes the Worker and clears all event listeners.
   */
  public dispose(): void {
    this.cleanupWorkerState(new Error('StockfishUciClient disposed'));
    this.listeners.clear();
  }

  /**
   * Stops any running search and waits for Stockfish to emit `bestmove` (followed by `readyok`).
   * Never resolves prematurely on timeout: if the engine fails to respond within `stopTimeoutMs`,
   * it restarts the hung Worker so subsequent commands run on a clean engine state.
   */
  public async stopAndWait(): Promise<void> {
    if (!this.isReady || !this.worker) {
      return;
    }
    if (!this.isAnalyzing) {
      return;
    }

    const effectiveStopTimeout = this.isSingleThreadedBuild()
      ? Math.min(this.stopTimeoutMs, 2500)
      : this.stopTimeoutMs;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const idx = this.stopWaiters.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) this.stopWaiters.splice(idx, 1);
          reject(new Error('Timed out waiting for bestmove after stop'));
        }, effectiveStopTimeout);

        this.stopWaiters.push({ resolve, reject, timeoutId });

        if (!this.isStoppingCurrentSearch) {
          this.isStoppingCurrentSearch = true;
          try {
            this.sendRaw('stop');
          } catch (err) {
            clearTimeout(timeoutId);
            const idx = this.stopWaiters.findIndex((w) => w.resolve === resolve);
            if (idx !== -1) this.stopWaiters.splice(idx, 1);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      // Synchronize with `isready` -> `readyok` so no trailing info lines can leak
      await this.waitReady();
    } catch (err) {
      // Hung engine recovery: restart the worker so subsequent searches are not corrupted
      await this.restartWorker();
      throw err;
    }
  }

  public stop(): void {
    if (this.isReady && this.isAnalyzing && this.worker && !this.isStoppingCurrentSearch) {
      this.isStoppingCurrentSearch = true;
      try {
        this.sendRaw('stop');
      } catch {
        // ignore
      }
    }
  }

  private handleUciMessage(line: string): void {
    if (line === 'readyok') {
      if (this.readyWaiters.length > 0) {
        const waiters = [...this.readyWaiters];
        this.readyWaiters = [];
        for (const w of waiters) {
          clearTimeout(w.timeoutId);
          w.resolve();
        }
      }
      return;
    }

    if (line.startsWith('info ') && line.includes(' pv ')) {
      // Ignore trailing info lines if we are not actively analyzing or are mid-stop
      if (!this.isAnalyzing || this.isStoppingCurrentSearch) {
        return;
      }
      const prevDepth = this.currentDepth;
      this.parseInfoLine(line);
      // During batch evaluateFenAsync, only emit UI state when depth advances to avoid spamming React re-renders
      if (!this.activeSearch || this.currentDepth !== prevDepth) {
        this.emitState();
      }
      return;
    }

    if (line.startsWith('bestmove ')) {
      const parts = line.split(/\s+/);
      const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      const ponderIdx = parts.indexOf('ponder');
      const ponder = ponderIdx !== -1 && parts[ponderIdx + 1] ? parts[ponderIdx + 1] : null;

      const wasStopping = this.isStoppingCurrentSearch || this.stopWaiters.length > 0;

      this.bestMoveUci = bestMove;
      this.ponderUci = ponder;
      this.isAnalyzing = false;
      this.isStoppingCurrentSearch = false;
      this.emitState();

      // Resolve any active search before/alongside stop waiters so no Promise ever hangs
      if (this.activeSearch) {
        const pending = this.activeSearch;
        this.activeSearch = null;
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.resolve({
          bestMove: bestMove || '',
          lines: this.getSortedLines(),
        });
      }

      if (wasStopping && this.stopWaiters.length > 0) {
        const waiters = [...this.stopWaiters];
        this.stopWaiters = [];
        for (const w of waiters) {
          clearTimeout(w.timeoutId);
          w.resolve();
        }
      }
    }
  }

  private parseInfoLine(line: string): void {
    // Ignore aspiration window fail-high/fail-low bounds once we have an exact PV line
    if (/\b(upperbound|lowerbound)\b/.test(line) && this.linesMap.size > 0) {
      return;
    }

    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    if (!depthMatch) return;
    const depth = parseInt(depthMatch[1], 10);

    const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
    const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;

    const npsMatch = line.match(/\bnps\s+(\d+)/);
    if (npsMatch) {
      this.nps = parseInt(npsMatch[1], 10);
    }

    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const nodes = nodesMatch ? parseInt(nodesMatch[1], 10) : undefined;

    const timeMatch = line.match(/\btime\s+(\d+)/);
    const timeMs = timeMatch ? parseInt(timeMatch[1] || '0', 10) : undefined;

    // Normalize evaluation from side-to-move POV to White's perspective (+ = White, - = Black)
    const perspectiveSign = this.activeTurn === 'w' ? 1 : -1;

    let cp: number | undefined;
    let mate: number | undefined;

    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);

    if (cpMatch) {
      const rawCp = parseInt(cpMatch[1], 10);
      cp = rawCp === 0 ? 0 : rawCp * perspectiveSign;
    } else if (mateMatch) {
      const rawMate = parseInt(mateMatch[1], 10);
      mate = rawMate === 0 ? 0 : rawMate * perspectiveSign;
      // Do NOT set a synthetic cp value for mate positions; keep cp undefined
      cp = undefined;
    }

    const pvIndex = line.indexOf(' pv ');
    const pvString = pvIndex !== -1 ? line.slice(pvIndex + 4).trim() : '';
    const pv = pvString ? pvString.split(/\s+/) : [];
    const pvSan = uciLineToSan(this.currentFen, pv, 8);

    if (multipv === 1) {
      this.currentDepth = Math.max(this.currentDepth, depth);
      if (pv.length > 0) {
        this.bestMoveUci = pv[0];
      }
    }

    const maxAllowedMultiPv = Math.max(this.appliedMultiPv, this.config.multiPv, 1);
    if (multipv <= maxAllowedMultiPv) {
      const existing = this.linesMap.get(multipv);
      if (!existing || depth >= existing.depth) {
        this.linesMap.set(multipv, {
          multipv,
          depth,
          cp,
          mate,
          pv,
          pvSan,
          nps: this.nps,
          nodes,
          timeMs,
        });
      }
    }
  }

  /**
   * Updates engine configuration (depth, maxDepth, movetimeMs, multiPv, hashMb, threads, ponder).
   * Preserves user-selected Hash and Threads, applies them via `setoption`, and awaits `readyok`.
   */
  public updateConfig(partial: Partial<EngineConfig>): Promise<void> {
    const nextConfig: EngineConfig = {
      ...this.config,
      ...partial,
    };

    if (partial.maxDepth !== undefined) {
      nextConfig.maxDepth = Math.max(MIN_ALLOWED_DEPTH, Math.floor(partial.maxDepth));
    }
    if (partial.depth !== undefined) {
      const maxD = nextConfig.maxDepth ?? DEFAULT_MAX_DEPTH;
      nextConfig.depth = Math.max(MIN_ALLOWED_DEPTH, Math.min(maxD, Math.floor(partial.depth)));
    }
    if (partial.hashMb !== undefined) {
      nextConfig.hashMb = StockfishUciClient.clampHashMb(partial.hashMb);
    }
    if (partial.threads !== undefined) {
      nextConfig.threads = StockfishUciClient.clampThreads(partial.threads);
    }
    if (partial.multiPv !== undefined) {
      nextConfig.multiPv = StockfishUciClient.clampMultiPv(partial.multiPv);
    }
    if (partial.movetimeMs !== undefined) {
      nextConfig.movetimeMs = Math.max(0, Math.floor(partial.movetimeMs));
    }
    if (partial.ponder !== undefined) {
      nextConfig.ponder = Boolean(partial.ponder);
    }

    this.config = nextConfig;

    if (!this.isReady || !this.worker) {
      return Promise.resolve();
    }

    const task = this.commandQueue.then(async () => {
      if (!this.isReady || !this.worker) return;
      try {
        await this.stopAndWait();
      } catch {
        // Worker already recovered by stopAndWait
      }
      this.applyEngineOptionsRaw(this.config);
      await this.waitReady();
    });

    this.commandQueue = task.catch(() => {});
    return task;
  }

  /**
   * Sends `ucinewgame` and waits for `readyok`.
   */
  public newGame(): Promise<void> {
    const task = this.commandQueue.then(async () => {
      await this.init();
      try {
        await this.stopAndWait();
      } catch {
        // Worker recovered
      }
      this.sendRaw('ucinewgame');
      await this.waitReady();
    });
    this.commandQueue = task.catch(() => {});
    return task;
  }

  private checkTerminalPosition(fen: string): EngineLine[] | null {
    try {
      const chess = new Chess(fen);
      if (chess.isGameOver()) {
        if (chess.isCheckmate()) {
          const matedColor = chess.turn();
          return [
            {
              multipv: 1,
              depth: 0,
              cp: undefined,
              mate: matedColor === 'w' ? -1 : 1,
              pv: [],
              pvSan: [],
            },
          ];
        }
        return [
          {
            multipv: 1,
            depth: 0,
            cp: 0,
            mate: undefined,
            pv: [],
            pvSan: [],
          },
        ];
      }
    } catch {
      // ignore invalid FEN here
    }
    return null;
  }

  /**
   * Starts interactive real-time analysis for the given FEN position.
   * Respects the full configured depth (up to `config.maxDepth`, default 30) without artificial caps.
   */
  public analyzePosition(fen: string, overrideDepth?: number, overrideMovetimeMs?: number): void {
    const requestId = ++this.latestInteractiveRequestId;

    this.commandQueue = this.commandQueue
      .then(async () => {
        await this.init();
        if (requestId !== this.latestInteractiveRequestId) return;

        try {
          await this.stopAndWait();
        } catch {
          // Worker was recovered after timeout
        }
        if (requestId !== this.latestInteractiveRequestId) return;

        this.currentFen = fen;
        const fenParts = fen.trim().split(/\s+/);
        this.activeTurn = (fenParts[1] === 'b' ? 'b' : 'w') as PlayerColor;
        this.currentDepth = 0;
        this.bestMoveUci = null;
        this.ponderUci = null;
        this.linesMap.clear();

        const terminal = this.checkTerminalPosition(fen);
        if (terminal) {
          this.isAnalyzing = false;
          this.linesMap.set(1, terminal[0]);
          this.emitState();
          return;
        }

        const depth = this.normalizeDepth(overrideDepth ?? this.config.depth);
        const movetime =
          overrideMovetimeMs !== undefined ? overrideMovetimeMs : this.config.movetimeMs;

        this.applyEngineOptionsRaw(this.config);
        await this.waitReady();
        if (requestId !== this.latestInteractiveRequestId) return;

        this.currentSearchId++;
        this.isAnalyzing = true;
        this.isStoppingCurrentSearch = false;
        this.emitState();

        this.sendRaw(`position fen ${fen}`);
        if (movetime > 0) {
          this.sendRaw(`go movetime ${movetime}`);
        } else if (this.isSingleThreadedBuild()) {
          // On single-threaded asm.js builds, each depth step runs synchronously on the Worker thread.
          // Providing a C++ movetime bound allows Stockfish's internal clock check to exit cleanly
          // so the Worker never freezes if the user selects a very high depth on a slower machine.
          const interactiveBudgetMs = Math.min(3500, Math.max(800, depth * 120));
          this.sendRaw(`go depth ${depth} movetime ${interactiveBudgetMs}`);
        } else {
          this.sendRaw(`go depth ${depth}`);
        }
      })
      .catch((err) => {
        console.error('analyzePosition error:', err);
      });
  }

  /**
   * Evaluates a single FEN position at the requested `depth` and `multiPv` and resolves when `bestmove` arrives.
   * Never caps depth to 11; uses `normalizeDepth(depth)` up to `config.maxDepth` (default 30).
   */
  public evaluateFenAsync(
    fen: string,
    depth?: number,
    multiPv: number = 2
  ): Promise<SearchResult> {
    // Cancel pending interactive search requests
    ++this.latestInteractiveRequestId;

    const runSearch = async (): Promise<SearchResult> => {
      await this.init();
      try {
        await this.stopAndWait();
      } catch {
        // Worker recovered after timeout
      }

      const terminal = this.checkTerminalPosition(fen);
      if (terminal) {
        return {
          bestMove: '',
          lines: terminal,
        };
      }

      const targetDepth = this.normalizeDepth(depth ?? this.config.depth);
      const targetMultiPv = StockfishUciClient.clampMultiPv(multiPv);

      if (this.appliedMultiPv !== targetMultiPv) {
        this.sendRaw(`setoption name MultiPV value ${targetMultiPv}`);
        this.appliedMultiPv = targetMultiPv;
      }
      await this.waitReady();

      const searchId = ++this.currentSearchId;

      return new Promise<SearchResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (this.activeSearch && this.activeSearch.id === searchId) {
            this.activeSearch = null;
            this.restartWorker().catch(() => {});
            reject(new Error(`Stockfish search timed out on FEN: ${fen}`));
          }
        }, this.searchTimeoutMs);

        this.currentFen = fen;
        const fenParts = fen.trim().split(/\s+/);
        this.activeTurn = (fenParts[1] === 'b' ? 'b' : 'w') as PlayerColor;
        this.currentDepth = 0;
        this.bestMoveUci = null;
        this.ponderUci = null;
        this.linesMap.clear();
        this.isAnalyzing = true;
        this.isStoppingCurrentSearch = false;
        this.activeSearch = { id: searchId, resolve, reject, timeoutId };
        this.emitState();

        try {
          this.sendRaw(`position fen ${fen}`);
          if (this.isSingleThreadedBuild()) {
            const batchBudgetMs =
              this.config.movetimeMs > 0
                ? this.config.movetimeMs
                : Math.min(1000, Math.max(250, targetDepth * 35));
            this.sendRaw(`go depth ${targetDepth} movetime ${batchBudgetMs}`);
          } else {
            this.sendRaw(`go depth ${targetDepth}`);
          }
        } catch (err) {
          clearTimeout(timeoutId);
          this.activeSearch = null;
          this.isAnalyzing = false;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    };

    const task = this.commandQueue.then(runSearch, runSearch);
    // Keep commandQueue alive even if a single task rejects
    this.commandQueue = task.catch(() => {});
    return task;
  }

  public getSortedLines(): EngineLine[] {
    return Array.from(this.linesMap.values()).sort((a, b) => a.multipv - b.multipv);
  }

  public getState(): EngineState {
    return {
      isReady: this.isReady,
      isAnalyzing: this.isAnalyzing,
      currentDepth: this.currentDepth,
      nps: this.nps,
      bestMoveUci: this.bestMoveUci,
      ponderUci: this.ponderUci,
      lines: this.getSortedLines(),
      fen: this.currentFen,
    };
  }

  public subscribe(listener: EngineStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const stockfishClient = new StockfishUciClient();
