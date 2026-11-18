import { ClassificationThresholds, EngineLine, MoveAnalysis } from '../../types/chess';
import {
  OpeningAnalysisCacheRecord,
  OpeningRepertoireCacheRecord,
  RepertoireFilterConfig,
  RepertoireSourceGame,
} from '../../types/repertoire';
import { StockfishUciClient } from '../engine/StockfishClient';
import { classifyMoveFromEvaluations, DEFAULT_THRESHOLDS } from '../analysis/MoveAnalyzer';
import {
  DEFAULT_START_FEN,
  getMainlineNodes,
  parsePgnMovetextToTree,
  uciLineToSan,
} from '../chess/VariationTree';
import { openingBook } from '../chess/OpeningBook';
import {
  analyzeGameOpeningForRepertoire,
  computeStringHash,
  extractPlayerMetricsFromAnalyses,
  REPERTOIRE_ALGORITHM_VERSION,
} from './OpeningAnalyzer';
import {
  buildOpeningStatsList,
  buildRepertoireMoveTree,
  detectProblematicAndNotableContinuations,
} from './OpeningStatisticsService';
import {
  bulkPutOpeningAnalysisCacheItems,
  putOpeningAnalysisCacheItem,
  putOpeningRepertoireCacheItem,
} from '../../services/StorageService/db';

/**
 * Dedicated, completely isolated Stockfish Worker instance for Opening Repertoire analysis.
 * Never shares state, lines, or arrows with the main board analyzer (`stockfishClient`).
 */
export const repertoireStockfishClient = new StockfishUciClient();

/**
 * Computes a deterministic cache key for `OpeningRepertoireCacheRecord`
 * based on player identifier, filter configuration, and selected game IDs.
 */
export function computeRepertoireAggregationCacheId(
  filters: RepertoireFilterConfig,
  selectedGameIds: string[]
): string {
  const raw = JSON.stringify({
    v: REPERTOIRE_ALGORITHM_VERSION,
    player: filters.playerUsername.trim().toLowerCase(),
    period: filters.periodPreset,
    month: filters.selectedMonth,
    from: filters.dateFrom,
    to: filters.dateTo,
    color: filters.color,
    tc: [...filters.timeClasses].sort(),
    ids: [...selectedGameIds].sort(),
  });
  return `rep_${computeStringHash(raw)}`;
}

/**
 * Phase 1 (Zero-Stockfish Instant Classification):
 * For every game in `selectedGames`:
 * - Checks if a valid `OpeningAnalysisCacheRecord` with matching `pgnHash` and `algorithmVersion`
 *   already exists in `cacheMap`.
 * - If found (either `'basic'` or `'engine_analyzed'`), reuses it immediately without re-parsing!
 * - If missing or `pgnHash` changed, runs `analyzeGameOpeningForRepertoire` (using `chess.js` + `OpeningBook`)
 *   and saves the resulting record into `OpeningAnalysisCache`.
 * - Builds and saves the complete `OpeningRepertoireCacheRecord` (openings, White/Black stats, trees, problematic lines).
 */
export async function buildInstantRepertoireFromSelection(
  selectedGames: RepertoireSourceGame[],
  filters: RepertoireFilterConfig,
  cacheMap: Map<string, OpeningAnalysisCacheRecord>
): Promise<{
  records: OpeningAnalysisCacheRecord[];
  aggregated: OpeningRepertoireCacheRecord;
}> {
  const newOrUpdatedToPersist: OpeningAnalysisCacheRecord[] = [];
  const activeRecords: OpeningAnalysisCacheRecord[] = [];

  for (const game of selectedGames) {
    if (!game.hasValidPgn) continue;
    const cacheKey = `${game.id}_${game.playerColor}`;
    const existing = cacheMap.get(cacheKey);

    if (
      existing &&
      existing.pgnHash === game.pgnHash &&
      existing.algorithmVersion === REPERTOIRE_ALGORITHM_VERSION &&
      existing.status !== 'error'
    ) {
      // If game has newly available precomputedAnalyses from main analyzer that weren't in cache yet, upgrade it
      if (
        existing.status !== 'engine_analyzed' &&
        game.precomputedAnalyses &&
        game.precomputedAnalyses.length > 0
      ) {
        const upgraded = analyzeGameOpeningForRepertoire(game, game.precomputedAnalyses);
        cacheMap.set(cacheKey, upgraded);
        newOrUpdatedToPersist.push(upgraded);
        activeRecords.push(upgraded);
      } else {
        activeRecords.push(existing);
      }
      continue;
    }

    const classified = analyzeGameOpeningForRepertoire(game, game.precomputedAnalyses);
    cacheMap.set(cacheKey, classified);
    newOrUpdatedToPersist.push(classified);
    activeRecords.push(classified);
  }

  if (newOrUpdatedToPersist.length > 0) {
    await bulkPutOpeningAnalysisCacheItems(newOrUpdatedToPersist);
  }

  const aggregated = aggregateRepertoireRecords(activeRecords, filters);
  await putOpeningRepertoireCacheItem(aggregated);

  return {
    records: activeRecords,
    aggregated,
  };
}

/**
 * Aggregates `OpeningAnalysisCacheRecord[]` into an `OpeningRepertoireCacheRecord`
 * without touching Stockfish. Used whenever filters change or after each analyzed game.
 */
export function aggregateRepertoireRecords(
  records: OpeningAnalysisCacheRecord[],
  filters: RepertoireFilterConfig
): OpeningRepertoireCacheRecord {
  const validRecords = records.filter((r) => r.status !== 'error');
  const whiteRecords = validRecords.filter((r) => r.playerColor === 'w');
  const blackRecords = validRecords.filter((r) => r.playerColor === 'b');
  const analyzedGames = validRecords.filter((r) => r.status === 'engine_analyzed').length;

  const openings = buildOpeningStatsList(validRecords);
  const whiteOpenings = buildOpeningStatsList(whiteRecords);
  const blackOpenings = buildOpeningStatsList(blackRecords);

  const whiteTree = buildRepertoireMoveTree(validRecords, 'w', 20);
  const blackTree = buildRepertoireMoveTree(validRecords, 'b', 20);
  const problematicItems = detectProblematicAndNotableContinuations(validRecords);

  const id = computeRepertoireAggregationCacheId(
    filters,
    validRecords.map((r) => r.gameId)
  );

  return {
    id,
    playerIdentifier: (filters.playerUsername || 'Белые').trim(),
    filterSnapshot: structuredClone(filters),
    totalGames: validRecords.length,
    whiteGames: whiteRecords.length,
    blackGames: blackRecords.length,
    analyzedGames,
    openings,
    whiteOpenings,
    blackOpenings,
    whiteTree,
    blackTree,
    problematicItems,
    createdAt: Date.now(),
    algorithmVersion: REPERTOIRE_ALGORITHM_VERSION,
  };
}

/**
 * Evaluates the opening moves (up to `maxOpeningPly`, default 16 plies) of a single game
 * using the existing `stockfishClient` Web Worker and `classifyMoveFromEvaluations`,
 * then updates and persists the `OpeningAnalysisCacheRecord` in IndexedDB.
 */
export async function evaluateSingleGameOpeningWithStockfish(
  record: OpeningAnalysisCacheRecord,
  options: {
    depth: number;
    maxOpeningPly?: number;
    thresholds?: ClassificationThresholds;
    positionEvalCache?: Map<
      string,
      { bestMove: string; lines: EngineLine[]; cp?: number; mate?: number }
    >;
    shouldAbort?: () => boolean;
  }
): Promise<OpeningAnalysisCacheRecord> {
  await repertoireStockfishClient.init();

  const evalDepth = repertoireStockfishClient.normalizeDepth(
    Math.max(8, Math.min(18, options.depth || 12))
  );
  const maxPly = options.maxOpeningPly ?? 16;
  const thresholds = options.thresholds || DEFAULT_THRESHOLDS;
  const posCache =
    options.positionEvalCache ||
    new Map<string, { bestMove: string; lines: EngineLine[]; cp?: number; mate?: number }>();

  const headers: Record<string, string> = {};
  const headerRegex = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(record.pgn)) !== null) {
    headers[m[1]] = m[2];
  }

  const initialFen = headers.FEN || DEFAULT_START_FEN;
  const root = parsePgnMovetextToTree(record.pgn, initialFen);
  const mainlineNodes = getMainlineNodes(root);
  const moveNodes = mainlineNodes.filter((n) => n.ply > 0).slice(0, maxPly);

  if (moveNodes.length === 0) {
    return record;
  }

  const openingSummary = openingBook.analyzeMainlineOpening(mainlineNodes);

  const getOrEvalPosition = async (fen: string) => {
    const cached = posCache.get(fen);
    if (cached) return cached;
    const res = await repertoireStockfishClient.evaluateFenAsync(fen, evalDepth, 2);
    const primary = res.lines[0];
    const entry = {
      bestMove: res.bestMove || primary?.pv?.[0] || '',
      lines: res.lines,
      cp: primary?.cp,
      mate: primary?.mate,
    };
    posCache.set(fen, entry);
    return entry;
  };

  const analyses: MoveAnalysis[] = [];

  for (let i = 0; i < moveNodes.length; i++) {
    if (options.shouldAbort?.()) {
      throw new Error('REPERTOIRE_ABORTED');
    }

    const currNode = moveNodes[i];
    const fenBefore = i === 0 ? initialFen : moveNodes[i - 1].fen;
    const fenAfter = currNode.fen;

    const evalBefore = await getOrEvalPosition(fenBefore);
    if (options.shouldAbort?.()) {
      throw new Error('REPERTOIRE_ABORTED');
    }

    const evalAfter = await getOrEvalPosition(fenAfter);
    if (options.shouldAbort?.()) {
      throw new Error('REPERTOIRE_ABORTED');
    }

    const bestMoveUci = evalBefore.bestMove;
    const bestLineUci = evalBefore.lines[0]?.pv || (bestMoveUci ? [bestMoveUci] : []);
    const bestLineSan = uciLineToSan(fenBefore, bestLineUci, 6);
    const bestMoveSan = bestLineSan[0] || currNode.san;
    const opponentBestPvUci = evalAfter.lines[0]?.pv || [];

    const isTheoretical = Boolean(
      openingSummary.lastTheoreticalPly > 0 &&
        currNode.ply <= openingSummary.lastTheoreticalPly &&
        (openingSummary.firstOutOfBookPly === null ||
          currNode.ply < openingSummary.firstOutOfBookPly)
    );

    const secondLine = evalBefore.lines.find((l) => l.multipv === 2);

    const classification = classifyMoveFromEvaluations({
      player: currNode.color,
      uci: currNode.uci,
      fenBefore,
      fenAfter,
      bestMoveUci,
      evalBeforeCp: evalBefore.cp,
      evalAfterCp: evalAfter.cp,
      mateBefore: evalBefore.mate,
      mateAfter: evalAfter.mate,
      secondBestCp: secondLine?.cp,
      secondBestMate: secondLine?.mate,
      alternativeLines: evalBefore.lines,
      opponentBestPvUci,
      isTheoretical,
      thresholds,
    });

    analyses.push({
      nodeId: currNode.id,
      ply: currNode.ply,
      moveNumber: currNode.moveNumber,
      player: currNode.color,
      san: currNode.san,
      uci: currNode.uci,
      fenBefore,
      fenAfter,
      bestMoveUci,
      bestMoveSan,
      evalBeforeCp: evalBefore.cp ?? 0,
      evalAfterCp: evalAfter.cp ?? 0,
      mateBefore: evalBefore.mate,
      mateAfter: evalAfter.mate,
      winProbBefore: classification.winProbBefore,
      winProbAfter: classification.winProbAfter,
      cpl: classification.cpl,
      winProbLoss: classification.winProbLoss,
      moveAccuracy: classification.moveAccuracy,
      category: classification.category,
      bestLineUci,
      bestLineSan,
      alternativeLines: evalBefore.lines,
      depth: evalDepth,
      isTheoretical,
    });
  }

  const { playerAccuracy, playerAvgCpl } = extractPlayerMetricsFromAnalyses(
    analyses,
    record.playerColor
  );

  const updatedRecord: OpeningAnalysisCacheRecord = {
    ...record,
    moveAnalyses: analyses,
    playerAccuracy,
    playerAvgCpl,
    algorithmVersion: REPERTOIRE_ALGORITHM_VERSION,
    analyzedAt: Date.now(),
    status: 'engine_analyzed',
  };

  await putOpeningAnalysisCacheItem(updatedRecord);
  return updatedRecord;
}
