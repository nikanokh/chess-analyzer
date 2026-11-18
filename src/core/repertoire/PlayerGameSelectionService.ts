import { MoveAnalysis, MoveNode, PlayerColor, SavedGameRecord } from '../../types/chess';
import {
  OpeningAnalysisCacheRecord,
  RepertoireFilterConfig,
  RepertoireSourceGame,
  RepertoireTimeClass,
  SelectionPreviewSummary,
} from '../../types/repertoire';
import { ChessComGameItem, mapChessComResult } from '../../services/ChessComApi/chessComService';
import { parsePgnToTree } from '../../services/PgnService/pgnService';
import { getMainlineNodes } from '../chess/VariationTree';
import {
  computeStringHash,
  hasValidMainlineMoves,
  REPERTOIRE_ALGORITHM_VERSION,
} from './OpeningAnalyzer';

/**
 * Splits a multi-game PGN string into individual PGN game strings.
 */
export function splitMultiGamePgn(rawPgnText: string): string[] {
  const trimmed = rawPgnText.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  const games: string[] = [];
  let currentLines: string[] = [];
  let seenMovesInCurrent = false;

  for (const line of lines) {
    const isHeader = /^\s*\[[A-Za-z0-9_]+\s+"[^"]*"\]\s*$/.test(line);
    if (isHeader && seenMovesInCurrent) {
      const joined = currentLines.join('\n').trim();
      if (joined) games.push(joined);
      currentLines = [line];
      seenMovesInCurrent = false;
    } else {
      currentLines.push(line);
      if (!isHeader && line.trim().length > 0 && !line.trim().startsWith('%')) {
        seenMovesInCurrent = true;
      }
    }
  }

  if (currentLines.length > 0) {
    const joined = currentLines.join('\n').trim();
    if (joined) games.push(joined);
  }

  return games;
}

/**
 * Classifies a PGN TimeControl string or Chess.com time_class into Bullet, Blitz, Rapid, or Classical.
 */
export function classifyTimeControl(
  timeControl?: string,
  explicitTimeClass?: string
): RepertoireTimeClass {
  const tcLower = (explicitTimeClass || '').trim().toLowerCase();
  if (tcLower === 'bullet') return 'bullet';
  if (tcLower === 'blitz') return 'blitz';
  if (tcLower === 'rapid') return 'rapid';
  if (tcLower === 'daily' || tcLower === 'classical' || tcLower === 'standard') {
    return 'classical';
  }

  const raw = (timeControl || '').trim().toLowerCase();
  if (!raw || raw === '-' || raw.includes('классика') || raw.includes('classical')) {
    return 'classical';
  }
  if (raw.includes('bullet') || raw.includes('пуля')) return 'bullet';
  if (raw.includes('blitz') || raw.includes('блиц')) return 'blitz';
  if (raw.includes('rapid') || raw.includes('рапид')) return 'rapid';

  // Parse numeric time control like "180", "180+2", "600+0", "40/7200"
  if (raw.includes('/')) {
    return 'classical';
  }

  const match = raw.match(/^(\d+)(?:\+(\d+))?/);
  if (match) {
    const baseSec = parseInt(match[1], 10);
    const incSec = match[2] ? parseInt(match[2], 10) : 0;
    const estimatedTotalSec = baseSec + 40 * incSec;
    if (estimatedTotalSec < 180) return 'bullet';
    if (estimatedTotalSec < 600) return 'blitz';
    if (estimatedTotalSec <= 1800) return 'rapid';
    return 'classical';
  }

  return 'rapid';
}

/**
 * Normalizes a PGN Date tag (e.g. "2025.04.12" or "2025-04-12") into `{ dateStr: "YYYY-MM-DD", timestamp }`.
 */
export function parsePgnDateAndTime(
  dateHeader?: string,
  utcDateHeader?: string,
  utcTimeHeader?: string,
  fallbackEpochSec?: number
): { dateStr: string; timestamp: number } {
  if (fallbackEpochSec && fallbackEpochSec > 0) {
    const ms = fallbackEpochSec * 1000;
    const d = new Date(ms);
    return {
      dateStr: d.toISOString().slice(0, 10),
      timestamp: ms,
    };
  }

  const rawDate = (utcDateHeader || dateHeader || '').trim();
  const normalizedDate = rawDate.replace(/\./g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) && !normalizedDate.includes('?')) {
    const timePart =
      utcTimeHeader && /^\d{2}:\d{2}:\d{2}$/.test(utcTimeHeader.trim())
        ? utcTimeHeader.trim()
        : '12:00:00';
    const parsedMs = Date.parse(`${normalizedDate}T${timePart}Z`);
    if (!Number.isNaN(parsedMs)) {
      return {
        dateStr: normalizedDate,
        timestamp: parsedMs,
      };
    }
  }

  const now = Date.now();
  return {
    dateStr: new Date(now).toISOString().slice(0, 10),
    timestamp: now,
  };
}

/**
 * Infers the most frequent player name across a list of PGN games when no username is specified.
 */
export function inferPrimaryPlayerFromGames(
  games: Array<{ whiteName: string; blackName: string }>
): string {
  const counts = new Map<string, { display: string; count: number }>();
  for (const g of games) {
    for (const name of [g.whiteName, g.blackName]) {
      const clean = (name || '').trim();
      if (!clean || clean === 'Белые' || clean === 'Чёрные' || clean === '?') continue;
      const key = clean.toLowerCase();
      const prev = counts.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        counts.set(key, { display: clean, count: 1 });
      }
    }
  }
  let best = '';
  let maxCount = 0;
  for (const entry of counts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      best = entry.display;
    }
  }
  return best;
}

/**
 * Determines playerColor ('w' | 'b') and outcome ('win' | 'draw' | 'loss') for `targetUsername`.
 */
export function resolvePlayerColorAndOutcome(
  whiteName: string,
  blackName: string,
  result: string,
  targetUsername: string
): { playerColor: PlayerColor; outcome: 'win' | 'draw' | 'loss' } {
  const target = targetUsername.trim().toLowerCase();
  const wLower = whiteName.trim().toLowerCase();
  const bLower = blackName.trim().toLowerCase();

  let playerColor: PlayerColor = 'w';
  if (target) {
    if (bLower === target || (bLower.includes(target) && wLower !== target)) {
      playerColor = 'b';
    } else {
      playerColor = 'w';
    }
  }

  let outcome: 'win' | 'draw' | 'loss' = 'draw';
  if (result === '1-0') {
    outcome = playerColor === 'w' ? 'win' : 'loss';
  } else if (result === '0-1') {
    outcome = playerColor === 'b' ? 'win' : 'loss';
  } else {
    outcome = 'draw';
  }

  return { playerColor, outcome };
}

/**
 * Converts Chess.com API game items into `RepertoireSourceGame[]`.
 */
export function convertChessComGamesToSourceGames(
  items: ChessComGameItem[],
  username: string
): RepertoireSourceGame[] {
  const result: RepertoireSourceGame[] = [];
  const seenIds = new Set<string>();

  for (const item of items) {
    const pgn = (item.pgn || '').trim();
    const mapped = mapChessComResult(item, username);
    const id = item.uuid
      ? `chesscom_${item.uuid}`
      : item.url
      ? `chesscom_${computeStringHash(item.url.toLowerCase())}`
      : `chesscom_${computeStringHash(pgn || `${item.end_time}`)}`;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const { dateStr, timestamp } = parsePgnDateAndTime(undefined, undefined, undefined, item.end_time);
    const hasValidPgn = Boolean(pgn) && hasValidMainlineMoves(pgn);
    const playerSide = mapped.userColor === 'w' ? item.white : item.black;
    const oppSide = mapped.userColor === 'w' ? item.black : item.white;

    result.push({
      id,
      source: 'chesscom',
      pgn,
      pgnHash: computeStringHash(pgn),
      whiteName: item.white.username,
      blackName: item.black.username,
      whiteRating: item.white.rating,
      blackRating: item.black.rating,
      playerUsername: playerSide.username,
      playerColor: mapped.userColor,
      playerRating: playerSide.rating,
      opponentName: oppSide.username,
      opponentRating: oppSide.rating,
      result: mapped.resultString,
      outcome: mapped.outcome,
      timeClass: classifyTimeControl(item.time_control, item.time_class),
      timeControl: item.time_control,
      timestamp,
      dateStr,
      hasValidPgn,
      siteUrl: item.url,
    });
  }

  return result.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Converts raw PGN text (single or multi-game) into `RepertoireSourceGame[]`.
 */
export function convertPgnTextToSourceGames(
  rawPgnText: string,
  preferredUsername?: string
): { games: RepertoireSourceGame[]; inferredUsername: string } {
  const chunks = splitMultiGamePgn(rawPgnText);
  const parsedItems = chunks.map((chunk) => {
    const headers: Record<string, string> = {};
    const headerRegex = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
    let m: RegExpExecArray | null;
    while ((m = headerRegex.exec(chunk)) !== null) {
      headers[m[1]] = m[2];
    }
    try {
      const parsed = parsePgnToTree(chunk, 'PGN');
      return { chunk, headers, parsed, valid: parsed.root.children.length > 0 };
    } catch {
      return {
        chunk,
        headers,
        parsed: null,
        valid: false,
      };
    }
  });

  const inferredUsername =
    preferredUsername?.trim() ||
    inferPrimaryPlayerFromGames(
      parsedItems.map((p) => ({
        whiteName: p.parsed?.metadata.whiteName || p.headers.White || 'Белые',
        blackName: p.parsed?.metadata.blackName || p.headers.Black || 'Чёрные',
      }))
    ) ||
    'Белые';

  const result: RepertoireSourceGame[] = [];
  const seenIds = new Set<string>();
  const batchFallbackSec = Math.floor(Date.now() / 1000);

  for (const item of parsedItems) {
    const whiteName = item.parsed?.metadata.whiteName || item.headers.White || 'Белые';
    const blackName = item.parsed?.metadata.blackName || item.headers.Black || 'Чёрные';
    const resStr = item.parsed?.metadata.result || item.headers.Result || '*';
    const { playerColor, outcome } = resolvePlayerColorAndOutcome(
      whiteName,
      blackName,
      resStr,
      inferredUsername
    );
    const id = item.parsed?.metadata.id || `pgn_${computeStringHash(item.chunk)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const hasExplicitDate = Boolean(item.headers.Date || item.headers.UTCDate);
    const { dateStr, timestamp } = parsePgnDateAndTime(
      item.headers.Date,
      item.headers.UTCDate,
      item.headers.UTCTime,
      hasExplicitDate ? undefined : batchFallbackSec
    );

    const whiteRating = item.parsed?.metadata.whiteRating;
    const blackRating = item.parsed?.metadata.blackRating;

    result.push({
      id,
      source: 'pgn',
      pgn: item.chunk,
      pgnHash: computeStringHash(item.chunk),
      whiteName,
      blackName,
      whiteRating,
      blackRating,
      playerUsername: playerColor === 'w' ? whiteName : blackName,
      playerColor,
      playerRating: playerColor === 'w' ? whiteRating : blackRating,
      opponentName: playerColor === 'w' ? blackName : whiteName,
      opponentRating: playerColor === 'w' ? blackRating : whiteRating,
      result: resStr,
      outcome,
      timeClass: classifyTimeControl(item.headers.TimeControl, item.headers.Event),
      timeControl: item.headers.TimeControl || 'Классика',
      timestamp,
      dateStr,
      hasValidPgn: item.valid,
      siteUrl: item.headers.Link || item.headers.Site,
    });
  }

  return {
    games: result.sort((a, b) => b.timestamp - a.timestamp),
    inferredUsername,
  };
}

/**
 * Converts local `SavedGameRecord[]` from IndexedDB into `RepertoireSourceGame[]`,
 * preserving any already-computed Stockfish `MoveAnalysis[]` from `serializedTree`!
 */
export function convertSavedRecordsToSourceGames(
  records: SavedGameRecord[],
  preferredUsername?: string
): { games: RepertoireSourceGame[]; inferredUsername: string } {
  const inferredUsername =
    preferredUsername?.trim() ||
    inferPrimaryPlayerFromGames(
      records.map((r) => ({
        whiteName: r.metadata.whiteName,
        blackName: r.metadata.blackName,
      }))
    ) ||
    'Белые';

  const result: RepertoireSourceGame[] = [];
  const seenIds = new Set<string>();

  for (const rec of records) {
    if (seenIds.has(rec.id)) continue;
    seenIds.add(rec.id);

    const { playerColor, outcome } = resolvePlayerColorAndOutcome(
      rec.metadata.whiteName,
      rec.metadata.blackName,
      rec.metadata.result,
      inferredUsername
    );

    let precomputedAnalyses: MoveAnalysis[] | undefined;
    let hasMoves = false;
    try {
      const rootNode: MoveNode = JSON.parse(rec.serializedTree);
      const mainline = getMainlineNodes(rootNode).filter((n) => n.ply > 0);
      hasMoves = mainline.length > 0;
      const analyses = mainline.map((n) => n.analysis!).filter(Boolean);
      if (analyses.length > 0) {
        precomputedAnalyses = analyses;
      }
    } catch {
      hasMoves = hasValidMainlineMoves(rec.pgn);
    }

    const { dateStr, timestamp } = parsePgnDateAndTime(
      rec.metadata.date,
      undefined,
      undefined,
      Math.floor((rec.updatedAt || Date.now()) / 1000)
    );

    result.push({
      id: rec.id,
      source: 'saved',
      pgn: rec.pgn,
      pgnHash: computeStringHash(rec.pgn),
      whiteName: rec.metadata.whiteName,
      blackName: rec.metadata.blackName,
      whiteRating: rec.metadata.whiteRating,
      blackRating: rec.metadata.blackRating,
      playerUsername: playerColor === 'w' ? rec.metadata.whiteName : rec.metadata.blackName,
      playerColor,
      playerRating: playerColor === 'w' ? rec.metadata.whiteRating : rec.metadata.blackRating,
      opponentName: playerColor === 'w' ? rec.metadata.blackName : rec.metadata.whiteName,
      opponentRating: playerColor === 'w' ? rec.metadata.blackRating : rec.metadata.whiteRating,
      result: rec.metadata.result,
      outcome,
      timeClass: classifyTimeControl(rec.metadata.timeControl, rec.metadata.timeClass),
      timeControl: rec.metadata.timeControl || 'Классика',
      timestamp,
      dateStr,
      hasValidPgn: hasMoves,
      siteUrl: rec.metadata.site,
      precomputedAnalyses,
    });
  }

  return {
    games: result.sort((a, b) => b.timestamp - a.timestamp),
    inferredUsername,
  };
}

/**
 * Re-applies `targetUsername` perspective to a pool of `RepertoireSourceGame[]`
 * so switching the target player name updates `playerColor` and `outcome` accurately.
 */
export function rebindPlayerPerspective(
  games: RepertoireSourceGame[],
  targetUsername: string
): RepertoireSourceGame[] {
  if (!targetUsername.trim()) return games;
  return games.map((g) => {
    const { playerColor, outcome } = resolvePlayerColorAndOutcome(
      g.whiteName,
      g.blackName,
      g.result,
      targetUsername
    );
    return {
      ...g,
      playerUsername: playerColor === 'w' ? g.whiteName : g.blackName,
      playerColor,
      playerRating: playerColor === 'w' ? g.whiteRating : g.blackRating,
      opponentName: playerColor === 'w' ? g.blackName : g.whiteName,
      opponentRating: playerColor === 'w' ? g.blackRating : g.whiteRating,
      outcome,
    };
  });
}

/**
 * Filters the source games according to `RepertoireFilterConfig` and computes `SelectionPreviewSummary`
 * BEFORE launching any Stockfish analysis.
 */
export function filterAndPreviewGames(
  pool: RepertoireSourceGame[],
  filters: RepertoireFilterConfig,
  cacheMap: Map<string, OpeningAnalysisCacheRecord>
): {
  selectedGames: RepertoireSourceGame[];
  preview: SelectionPreviewSummary;
} {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const timeClassSet = new Set(filters.timeClasses);
  const manualSet =
    filters.manualSelectedGameIds !== null ? new Set(filters.manualSelectedGameIds) : null;

  let incompleteOrMissingCount = 0;
  const matchingGames: RepertoireSourceGame[] = [];

  for (const game of pool) {
    if (!game.hasValidPgn) {
      incompleteOrMissingCount++;
      if (filters.excludeIncompletePgn) {
        continue;
      }
    }

    // Period filter
    if (filters.periodPreset === '7d') {
      if (now - game.timestamp > 7 * DAY_MS) continue;
    } else if (filters.periodPreset === '30d') {
      if (now - game.timestamp > 30 * DAY_MS) continue;
    } else if (filters.periodPreset === '90d') {
      if (now - game.timestamp > 90 * DAY_MS) continue;
    } else if (filters.periodPreset === 'month' && filters.selectedMonth && filters.selectedMonth !== 'all') {
      if (!game.dateStr.startsWith(filters.selectedMonth)) continue;
    } else if (filters.periodPreset === 'custom') {
      if (filters.dateFrom && game.dateStr < filters.dateFrom) continue;
      if (filters.dateTo && game.dateStr > filters.dateTo) continue;
    }

    // Color filter
    if (filters.color !== 'all' && game.playerColor !== filters.color) {
      continue;
    }

    // Time control filter
    if (timeClassSet.size > 0 && !timeClassSet.has(game.timeClass)) {
      continue;
    }

    // Manual game selection filter
    if (manualSet !== null && !manualSet.has(game.id)) {
      continue;
    }

    // Cache mode filter: if user chose to exclude already-analyzed games from selection
    const cacheKey = `${game.id}_${game.playerColor}`;
    const cached = cacheMap.get(cacheKey);
    const isFreshEngineCached = Boolean(
      (cached &&
        cached.status === 'engine_analyzed' &&
        cached.pgnHash === game.pgnHash &&
        cached.algorithmVersion === REPERTOIRE_ALGORITHM_VERSION) ||
        (game.precomputedAnalyses && game.precomputedAnalyses.length > 0)
    );

    if (filters.cacheMode === 'exclude_analyzed' && isFreshEngineCached) {
      continue;
    }

    matchingGames.push(game);
  }

  let whiteCount = 0;
  let blackCount = 0;
  let alreadyAnalyzedCount = 0;
  let basicCachedCount = 0;
  let needsEngineAnalysisCount = 0;

  for (const game of matchingGames) {
    if (game.playerColor === 'w') whiteCount++;
    else blackCount++;

    const cacheKey = `${game.id}_${game.playerColor}`;
    const cached = cacheMap.get(cacheKey);
    const hasEngine = Boolean(
      filters.cacheMode !== 'force_reanalyze' &&
        ((cached &&
          cached.status === 'engine_analyzed' &&
          cached.pgnHash === game.pgnHash &&
          cached.algorithmVersion === REPERTOIRE_ALGORITHM_VERSION) ||
          (game.precomputedAnalyses && game.precomputedAnalyses.length > 0))
    );

    if (hasEngine) {
      alreadyAnalyzedCount++;
    } else if (game.hasValidPgn) {
      needsEngineAnalysisCount++;
      if (cached && cached.pgnHash === game.pgnHash) {
        basicCachedCount++;
      }
    }
  }

  return {
    selectedGames: matchingGames,
    preview: {
      totalLoadedPool: pool.length,
      totalMatching: matchingGames.length,
      whiteCount,
      blackCount,
      alreadyAnalyzedCount,
      basicCachedCount,
      needsEngineAnalysisCount,
      incompleteOrMissingCount,
    },
  };
}
