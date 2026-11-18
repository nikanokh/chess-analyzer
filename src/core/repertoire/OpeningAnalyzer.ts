import { Chess } from 'chess.js';
import { MoveAnalysis, PlayerColor } from '../../types/chess';
import {
  OpeningAnalysisCacheRecord,
  OpeningMoveStep,
  RepertoireSourceGame,
} from '../../types/repertoire';
import {
  normalizeLegalEpFenKey,
  OpeningBookEntry,
  openingBook,
} from '../chess/OpeningBook';
import {
  DEFAULT_START_FEN,
  getMainlineNodes,
  parsePgnMovetextToTree,
} from '../chess/VariationTree';
import { calculateGameStatistics } from '../analysis/AccuracyCalculator';

export const REPERTOIRE_ALGORITHM_VERSION = 'repertoire_v2.1';
export const MAX_REPERTOIRE_OPENING_PLY = 24;
export const UNDEFINED_OPENING_NAME = 'Неопределённый дебют';

const EXTENDED_ECO_ENTRIES: OpeningBookEntry[] = [
  // Additional 1.e4 openings & variations
  { eco: 'B00', name: 'Королевское пешечное начало', variation: '1.e4', pgnMoves: ['e4'] },
  { eco: 'C20', name: 'Открытые дебюты', variation: '1.e4 e5', pgnMoves: ['e4', 'e5'] },
  { eco: 'B20', name: 'Сицилианская защита', variation: '1.e4 c5', pgnMoves: ['e4', 'c5'] },
  { eco: 'B21', name: 'Сицилианская защита', variation: 'Гамбит Морра (2.d4 cxd4 3.c3)', pgnMoves: ['e4', 'c5', 'd4', 'cxd4', 'c3'] },
  { eco: 'B21', name: 'Сицилианская защита', variation: 'Атака Гран-При (2.f4)', pgnMoves: ['e4', 'c5', 'f4'] },
  { eco: 'B32', name: 'Сицилианская защита', variation: 'Вариант Лабурдонне-Лёвенталя (4...e5)', pgnMoves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'e5'] },
  { eco: 'B35', name: 'Сицилианская защита', variation: 'Ускоренный дракон (4...g6)', pgnMoves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6'] },
  { eco: 'B42', name: 'Сицилианская защита', variation: 'Вариант Кана (4...a6)', pgnMoves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'a6'] },
  { eco: 'B45', name: 'Сицилианская защита', variation: 'Вариант Тайманова (4...Nc6)', pgnMoves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6'] },
  { eco: 'B52', name: 'Сицилианская защита', variation: 'Московский вариант (3.Bb5+)', pgnMoves: ['e4', 'c5', 'Nf3', 'd6', 'Bb5+'] },
  { eco: 'B80', name: 'Сицилианская защита', variation: 'Схевенингенский вариант (5...e6)', pgnMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6'] },
  { eco: 'C00', name: 'Французская защита', variation: '1.e4 e6', pgnMoves: ['e4', 'e6'] },
  { eco: 'C01', name: 'Французская защита', variation: 'Разменный вариант (3.exd5 exd5)', pgnMoves: ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5'] },
  { eco: 'C03', name: 'Французская защита', variation: 'Система Тарраша (3.Nd2)', pgnMoves: ['e4', 'e6', 'd4', 'd5', 'Nd2'] },
  { eco: 'B10', name: 'Защита Каро-Канн', variation: '1.e4 c6', pgnMoves: ['e4', 'c6'] },
  { eco: 'B10', name: 'Защита Каро-Канн', variation: 'Вариант двух коней (2.Nf3 d5 3.Nc3)', pgnMoves: ['e4', 'c6', 'Nf3', 'd5', 'Nc3'] },
  { eco: 'B13', name: 'Защита Каро-Канн', variation: 'Разменный вариант (3.exd5 cxd5)', pgnMoves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'] },
  { eco: 'B14', name: 'Защита Каро-Канн', variation: 'Атака Панова-Ботвинника (4.c4)', pgnMoves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4'] },
  { eco: 'B15', name: 'Защита Каро-Канн', variation: 'Система 3.Nc3 dxe4 4.Nxe4 Nf6', pgnMoves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6'] },
  { eco: 'B01', name: 'Скандинавская защита', variation: '1.e4 d5', pgnMoves: ['e4', 'd5'] },
  { eco: 'B01', name: 'Скандинавская защита', variation: 'Вариант 2...Nf6', pgnMoves: ['e4', 'd5', 'exd5', 'Nf6'] },
  { eco: 'B06', name: 'Современная защита (Модерн)', variation: '1.e4 g6 2.d4 Bg7', pgnMoves: ['e4', 'g6', 'd4', 'Bg7'] },
  { eco: 'B07', name: 'Защита Пирца-Уфимцева', variation: '1.e4 d6 2.d4 Nf6', pgnMoves: ['e4', 'd6', 'd4', 'Nf6'] },
  { eco: 'B00', name: 'Защита Нимцовича', variation: '1.e4 Nc6', pgnMoves: ['e4', 'Nc6'] },
  { eco: 'B00', name: 'Защита Оуэна', variation: '1.e4 b6', pgnMoves: ['e4', 'b6'] },
  { eco: 'C22', name: 'Центральный дебют', variation: '3.Qxd4 Nc6', pgnMoves: ['e4', 'e5', 'd4', 'exd4', 'Qxd4', 'Nc6'] },
  { eco: 'C21', name: 'Северный гамбит', variation: '2.d4 exd4 3.c3', pgnMoves: ['e4', 'e5', 'd4', 'exd4', 'c3'] },
  { eco: 'C44', name: 'Гамбит Понциани', variation: '3.c3', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'c3'] },
  { eco: 'C51', name: 'Гамбит Эванса', variation: '4.b4', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'] },

  // Additional 1.d4, 1.c4, 1.Nf3 openings & variations
  { eco: 'A40', name: 'Ферзевое пешечное начало', variation: '1.d4', pgnMoves: ['d4'] },
  { eco: 'D00', name: 'Закрытые дебюты', variation: '1.d4 d5', pgnMoves: ['d4', 'd5'] },
  { eco: 'A45', name: 'Индийская защита', variation: '1.d4 Nf6', pgnMoves: ['d4', 'Nf6'] },
  { eco: 'A45', name: 'Атака Тромповского', variation: '1.d4 Nf6 2.Bg5', pgnMoves: ['d4', 'Nf6', 'Bg5'] },
  { eco: 'A46', name: 'Атака Торре', variation: '1.d4 Nf6 2.Nf3 e6 3.Bg5', pgnMoves: ['d4', 'Nf6', 'Nf3', 'e6', 'Bg5'] },
  { eco: 'A48', name: 'Лондонская система (против 1...Nf6)', variation: '1.d4 Nf6 2.Bf4', pgnMoves: ['d4', 'Nf6', 'Bf4'] },
  { eco: 'D02', name: 'Лондонская система', variation: '1.d4 d5 2.Nf3 Nf6 3.Bf4', pgnMoves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4'] },
  { eco: 'D04', name: 'Система Колле', variation: '1.d4 d5 2.Nf3 Nf6 3.e3', pgnMoves: ['d4', 'd5', 'Nf3', 'Nf6', 'e3'] },
  { eco: 'D00', name: 'Гамбит Блэкмара-Димера', variation: '1.d4 d5 2.e4 dxe4 3.Nc3', pgnMoves: ['d4', 'd5', 'e4', 'dxe4', 'Nc3'] },
  { eco: 'D43', name: 'Славяно-меранская защита (Полуславянская)', variation: '4...e6', pgnMoves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6'] },
  { eco: 'E00', name: 'Каталонское начало', variation: '1.d4 Nf6 2.c4 e6 3.g3', pgnMoves: ['d4', 'Nf6', 'c4', 'e6', 'g3'] },
  { eco: 'E04', name: 'Каталонское начало', variation: 'Открытый вариант (4.Bg2 dxc4)', pgnMoves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'dxc4'] },
  { eco: 'E11', name: 'Защита Боголюбова', variation: '3.Nf3 Bb4+', pgnMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'Bb4+'] },
  { eco: 'E12', name: 'Новоиндийская защита', variation: '3.Nf3 b6', pgnMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { eco: 'A56', name: 'Защита Бенони', variation: '1.d4 Nf6 2.c4 c5', pgnMoves: ['d4', 'Nf6', 'c4', 'c5'] },
  { eco: 'A57', name: 'Волжский гамбит (Бенко)', variation: '3.d5 b5', pgnMoves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5'] },
  { eco: 'A51', name: 'Будапештский гамбит', variation: '1.d4 Nf6 2.c4 e5', pgnMoves: ['d4', 'Nf6', 'c4', 'e5'] },
  { eco: 'A10', name: 'Английское начало', variation: '1.c4', pgnMoves: ['c4'] },
  { eco: 'A20', name: 'Английское начало', variation: '1.c4 e5', pgnMoves: ['c4', 'e5'] },
  { eco: 'A30', name: 'Английское начало', variation: 'Симметричный вариант (1.c4 c5)', pgnMoves: ['c4', 'c5'] },
  { eco: 'A15', name: 'Английское начало', variation: 'Англо-индийская система (1.c4 Nf6)', pgnMoves: ['c4', 'Nf6'] },
  { eco: 'A04', name: 'Дебют Рети', variation: '1.Nf3', pgnMoves: ['Nf3'] },
  { eco: 'A05', name: 'Дебют Рети / Староиндийское начало', variation: '1.Nf3 Nf6', pgnMoves: ['Nf3', 'Nf6'] },
  { eco: 'A07', name: 'Староиндийская атака', variation: '1.Nf3 d5 2.g3 Nf6 3.Bg2', pgnMoves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2'] },
  { eco: 'A02', name: 'Дебют Бёрда', variation: '1.f4', pgnMoves: ['f4'] },
  { eco: 'A01', name: 'Дебют Ларсена', variation: '1.b3', pgnMoves: ['b3'] },
];

let extendedLoaded = false;
export function ensureExtendedOpeningDatabaseLoaded(): void {
  if (extendedLoaded) return;
  extendedLoaded = true;
  openingBook.addCustomEntries(EXTENDED_ECO_ENTRIES);
}

export function computeStringHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Computes player-specific accuracy and average CPL from `MoveAnalysis[]` if present.
 */
export function extractPlayerMetricsFromAnalyses(
  analyses: MoveAnalysis[] | undefined,
  playerColor: PlayerColor
): { playerAccuracy?: number; playerAvgCpl?: number } {
  if (!analyses || analyses.length === 0) {
    return {};
  }
  const playerMoves = analyses.filter((a) => a.player === playerColor);
  if (playerMoves.length === 0) {
    return {};
  }
  const stats = calculateGameStatistics(analyses);
  const playerAccuracy = playerColor === 'w' ? stats.whiteAccuracy : stats.blackAccuracy;
  const playerAvgCpl = playerColor === 'w' ? stats.whiteAvgCpl : stats.blackAvgCpl;
  return {
    playerAccuracy,
    playerAvgCpl,
  };
}

/**
 * OpeningAnalyzer:
 * Reconstructs the move sequence strictly via chess.js (`parsePgnMovetextToTree`),
 * identifies the official ECO, Opening Name, Variation, theory depth, first out-of-book move,
 * and transposition status using normalized position FEN keys (`normalizeLegalEpFenKey`).
 *
 * Never relies solely on PGN headers. If no reliable theoretical match is found,
 * assigns `UNDEFINED_OPENING_NAME` («Неопределённый дебют»).
 */
export function analyzeGameOpeningForRepertoire(
  game: RepertoireSourceGame,
  existingMoveAnalyses?: MoveAnalysis[]
): OpeningAnalysisCacheRecord {
  ensureExtendedOpeningDatabaseLoaded();

  const headers: Record<string, string> = {};
  const headerRegex = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(game.pgn)) !== null) {
    headers[match[1]] = match[2];
  }

  const initialFen = headers.FEN || DEFAULT_START_FEN;
  const root = parsePgnMovetextToTree(game.pgn, initialFen);
  const mainlineNodes = getMainlineNodes(root);
  const moveNodes = mainlineNodes.filter((n) => n.ply > 0);

  const openingSteps: OpeningMoveStep[] = [];
  let bestMatch: {
    eco: string;
    name: string;
    variation: string;
    ply: number;
    isExactEndpoint: boolean;
  } | null = null;

  let theoryDepthPly = 0;
  let firstOutOfBookPly: number | null = null;
  let firstOutOfBookMoveSan: string | null = null;
  let stillUnbrokenTheory = true;
  let transposed = false;

  const maxPliesToInspect = Math.min(moveNodes.length, MAX_REPERTOIRE_OPENING_PLY);

  for (let i = 0; i < maxPliesToInspect; i++) {
    const node = moveNodes[i];
    const fenBefore = i === 0 ? initialFen : moveNodes[i - 1].fen;
    const fenAfter = node.fen;
    const positionKey = normalizeLegalEpFenKey(fenAfter);

    const posTheory = openingBook.isPositionInTheory(fenAfter);
    const edgeInBook =
      openingBook.isBookMove(fenBefore, node.san, fenAfter) ||
      openingBook.isBookMove(fenBefore, node.uci, fenAfter);

    let stepIsTheoretical = false;

    if (stillUnbrokenTheory && posTheory && edgeInBook) {
      stepIsTheoretical = true;
      theoryDepthPly = node.ply;
      if (
        posTheory.name !== 'Начальные ходы партии' &&
        (posTheory.isExactEndpoint || !bestMatch || node.ply >= bestMatch.ply)
      ) {
        bestMatch = {
          eco: posTheory.eco,
          name: posTheory.name,
          variation: posTheory.variation,
          ply: node.ply,
          isExactEndpoint: posTheory.isExactEndpoint,
        };
      }
    } else if (stillUnbrokenTheory) {
      stillUnbrokenTheory = false;
      firstOutOfBookPly = node.ply;
      firstOutOfBookMoveSan = `${node.moveNumber}${node.color === 'w' ? '.' : '...'} ${node.san}`;
    } else if (posTheory && posTheory.name !== 'Начальные ходы партии') {
      // Transposition back into a known theoretical position via non-standard move order
      transposed = true;
      stepIsTheoretical = true;
      theoryDepthPly = Math.max(theoryDepthPly, node.ply);
      if (posTheory.isExactEndpoint || !bestMatch || node.ply > bestMatch.ply) {
        bestMatch = {
          eco: posTheory.eco,
          name: posTheory.name,
          variation: posTheory.variation,
          ply: node.ply,
          isExactEndpoint: posTheory.isExactEndpoint,
        };
      }
    }

    openingSteps.push({
      ply: node.ply,
      moveNumber: node.moveNumber,
      color: node.color,
      san: node.san,
      uci: node.uci,
      fenBefore,
      fenAfter,
      positionKey,
      isTheoretical: stepIsTheoretical,
      ecoAtStep: bestMatch?.eco,
      openingNameAtStep: bestMatch?.name,
      variationAtStep: bestMatch?.variation,
    });
  }

  // Fallback check: if no match was found in the local book, check if the first 2 plies match a known root move
  let isUndefinedOpening = false;
  let eco = 'A00';
  let openingName = UNDEFINED_OPENING_NAME;
  let variationName = 'Вне известной теории';

  if (bestMatch && bestMatch.ply >= 1) {
    eco = bestMatch.eco;
    openingName = bestMatch.name;
    variationName = bestMatch.variation;
  } else {
    isUndefinedOpening = true;
  }

  const normalizedMovesKey = openingSteps.map((s) => s.uci).join(' ');
  const analysesToUse = existingMoveAnalyses || game.precomputedAnalyses;
  const { playerAccuracy, playerAvgCpl } = extractPlayerMetricsFromAnalyses(
    analysesToUse,
    game.playerColor
  );

  const hasEngineAnalysis = Boolean(analysesToUse && analysesToUse.length > 0);

  return {
    id: `${game.id}_${game.playerColor}`,
    gameId: game.id,
    source: game.source,
    pgnHash: game.pgnHash,
    normalizedMovesKey,
    playerUsername: game.playerUsername,
    playerColor: game.playerColor,
    opponentName: game.opponentName,
    playerRating: game.playerRating,
    opponentRating: game.opponentRating,
    whiteName: game.whiteName,
    blackName: game.blackName,
    outcome: game.outcome,
    result: game.result,
    timeClass: game.timeClass,
    timeControl: game.timeControl,
    timestamp: game.timestamp,
    dateStr: game.dateStr,
    eco,
    openingName,
    variationName,
    isUndefinedOpening,
    theoryDepthPly,
    firstOutOfBookPly,
    firstOutOfBookMoveSan,
    transposed,
    totalPlies: moveNodes.length,
    totalMoves: Math.ceil(moveNodes.length / 2),
    openingMoves: openingSteps,
    moveAnalyses: analysesToUse,
    playerAccuracy,
    playerAvgCpl,
    algorithmVersion: REPERTOIRE_ALGORITHM_VERSION,
    analyzedAt: Date.now(),
    status: !game.hasValidPgn || moveNodes.length === 0
      ? 'error'
      : hasEngineAnalysis
      ? 'engine_analyzed'
      : 'basic',
    pgn: game.pgn,
  };
}

/**
 * Helper to validate whether a PGN has at least 1 legal move via chess.js.
 */
export function hasValidMainlineMoves(pgn: string): boolean {
  if (!pgn || !pgn.trim()) return false;
  try {
    const root = parsePgnMovetextToTree(pgn);
    return root.children.length > 0;
  } catch {
    try {
      const c = new Chess();
      c.loadPgn(pgn, { strict: false });
      return c.history().length > 0;
    } catch {
      return false;
    }
  }
}
