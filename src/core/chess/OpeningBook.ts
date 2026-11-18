import { Chess } from 'chess.js';
import { MoveNode, OpeningAnalysisSummary } from '../../types/chess';

export interface OpeningBookEntry {
  eco: string;
  name: string;
  variation: string;
  pgnMoves: string[]; // SAN moves from standard starting position
  continuation?: string[]; // Known main theoretical continuation after this line
}

export const OPENING_BOOK_META = {
  source: 'Local ECO & Master Theory Database',
  version: 'v2026.4',
};

const INITIAL_ECO_ENTRIES: OpeningBookEntry[] = [
  // Open Games (1.e4 e5) & common move-order transpositions
  { eco: 'C40', name: 'Дебют королевского коня', variation: '2.Nf3', pgnMoves: ['e4', 'e5', 'Nf3'], continuation: ['Nc6', 'Bb5', 'a6'] },
  { eco: 'C44', name: 'Дебют королевского коня', variation: 'Транспозиция 1.Nf3 Nc6 2.e4 e5', pgnMoves: ['Nf3', 'Nc6', 'e4', 'e5'], continuation: ['Bc4', 'Bc5', 'c3'] },
  { eco: 'C23', name: 'Дебют слона', variation: '2.Bc4', pgnMoves: ['e4', 'e5', 'Bc4'], continuation: ['Nf6', 'd3', 'Nc6'] },
  { eco: 'C25', name: 'Венская партия', variation: '2.Nc3', pgnMoves: ['e4', 'e5', 'Nc3'], continuation: ['Nf6', 'f4', 'd5'] },
  { eco: 'C21', name: 'Центральный дебют', variation: '2.d4 exd4', pgnMoves: ['e4', 'e5', 'd4', 'exd4'], continuation: ['Qxd4', 'Nc6', 'Qe3'] },
  { eco: 'C30', name: 'Королевский гамбит', variation: '2.f4', pgnMoves: ['e4', 'e5', 'f4'], continuation: ['exf4', 'Nf3', 'g5', 'Bc4'] },
  { eco: 'C33', name: 'Принятый королевский гамбит', variation: '2.f4 exf4 3.Nf3', pgnMoves: ['e4', 'e5', 'f4', 'exf4', 'Nf3'], continuation: ['g5', 'h4', 'g4', 'Ne5'] },
  { eco: 'C41', name: 'Защита Филидора', variation: '2.Nf3 d6', pgnMoves: ['e4', 'e5', 'Nf3', 'd6'], continuation: ['d4', 'exd4', 'Nxd4', 'Nf6'] },
  { eco: 'C41', name: 'Защита Филидора', variation: 'Разменный вариант в центре', pgnMoves: ['e4', 'e5', 'Nf3', 'd6', 'd4'], continuation: ['exd4', 'Nxd4', 'Nf6', 'Nc3', 'Be7'] },
  { eco: 'C41', name: 'Защита Филидора', variation: 'Вариант 3...Bg4 (Опера в Париже)', pgnMoves: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7'], continuation: ['Nc3', 'c6', 'Bg5', 'b5'] },
  { eco: 'C42', name: 'Русская партия (Защита Петрова)', variation: '2.Nf3 Nf6', pgnMoves: ['e4', 'e5', 'Nf3', 'Nf6'], continuation: ['Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4'] },
  { eco: 'C42', name: 'Русская партия (Защита Петрова)', variation: 'Классический вариант 3.Nxe5 d6 4.Nf3 Nxe4', pgnMoves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4'], continuation: ['d4', 'd5', 'Bd3', 'Nc6'] },
  { eco: 'C44', name: 'Дебют королевского коня', variation: '2.Nf3 Nc6', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6'], continuation: ['Bb5', 'a6', 'Ba4', 'Nf6'] },
  { eco: 'C45', name: 'Шотландская партия', variation: '3.d4 exd4 4.Nxd4', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'], continuation: ['Bc5', 'Be3', 'Qf6', 'c3', 'Nge7'] },
  { eco: 'C47', name: 'Дебют четырёх коней', variation: '3.Nc3 Nf6', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'], continuation: ['Bb5', 'Bb4', 'O-O', 'O-O'] },
  { eco: 'C50', name: 'Итальянская партия', variation: '3.Bc4', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], continuation: ['Bc5', 'c3', 'Nf6', 'd4'] },
  { eco: 'C50', name: 'Итальянская партия', variation: 'Giuoco Piano (3...Bc5)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], continuation: ['c3', 'Nf6', 'd3', 'd6'] },
  { eco: 'C53', name: 'Итальянская партия', variation: 'Классический центр 4.c3', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'], continuation: ['Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'] },
  { eco: 'C54', name: 'Итальянская партия', variation: 'Главный вариант Giuoco Piano', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'], continuation: ['Nc3', 'Nxe4', 'O-O'] },
  { eco: 'C54', name: 'Итальянская партия', variation: 'Giuoco Pianissimo (d3 и c3)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'c3', 'd6'], continuation: ['O-O', 'a6', 'Re1', 'O-O'] },
  { eco: 'C55', name: 'Защита двух коней', variation: '3.Bc4 Nf6', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], continuation: ['Ng5', 'd5', 'exd5', 'Na5'] },
  { eco: 'C57', name: 'Защита двух коней', variation: 'Атака 4.Ng5 d5 5.exd5', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5'], continuation: ['Na5', 'Bb5+', 'c6', 'dxc6', 'bxc6'] },
  { eco: 'C60', name: 'Испанская партия (Ruy Lopez)', variation: '3.Bb5', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], continuation: ['a6', 'Ba4', 'Nf6', 'O-O'] },
  { eco: 'C65', name: 'Испанская партия', variation: 'Берлинская защита (3...Nf6)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'], continuation: ['O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6'] },
  { eco: 'C65', name: 'Испанская партия', variation: 'Берлинская защита 4.O-O Nxe4', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4'], continuation: ['d4', 'Nd6', 'Bxc6', 'dxc6', 'dxe5'] },
  { eco: 'C65', name: 'Испанская партия', variation: 'Берлинская защита с 5.Re1 Nd6', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'Re1', 'Nd6', 'Nxe5', 'Be7', 'Bf1', 'Nxe5', 'Rxe5', 'O-O'], continuation: ['d4', 'Bf6', 'Re1', 'Re8'] },
  { eco: 'C67', name: 'Испанская партия', variation: 'Берлинский эндшпиль', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6', 'dxc6', 'dxe5', 'Nf5', 'Qxd8+', 'Kxd8'], continuation: ['Nc3', 'Ke8', 'h3', 'h5'] },
  { eco: 'C68', name: 'Испанская партия', variation: 'Разменный вариант (4.Bxc6)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6'], continuation: ['O-O', 'f6', 'd4', 'exd4'] },
  { eco: 'C70', name: 'Испанская партия', variation: 'Защита Морфи (3...a6 4.Ba4)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'], continuation: ['Nf6', 'O-O', 'Be7', 'Re1'] },
  { eco: 'C78', name: 'Испанская партия', variation: 'Главный вариант 4...Nf6 5.O-O', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'], continuation: ['Be7', 'Re1', 'b5', 'Bb3', 'd6'] },
  { eco: 'C84', name: 'Испанская партия', variation: 'Закрытая система (5...Be7)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'], continuation: ['h3', 'Na5', 'Bc2', 'c5', 'd4'] },
  { eco: 'C89', name: 'Испанская партия', variation: 'Контратака Маршалла (8...d5)', pgnMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'O-O', 'c3', 'd5'], continuation: ['exd5', 'Nxd5', 'Nxe5', 'Nxe5', 'Rxe5', 'c6'] },

  // Semi-Open Games (Sicilian, French, Caro-Kann, Pirc, Scandinavian, Alekhine)
  { eco: 'B22', name: 'Сицилианская защита', variation: 'Вариант Алапина (2.c3)', pgnMoves: ['e4', 'c5', 'c3'], continuation: ['Nf6', 'e5', 'Nd5', 'd4', 'cxd4'] },
  { eco: 'B23', name: 'Сицилианская защита', variation: 'Закрытая система (2.Nc3)', pgnMoves: ['e4', 'c5', 'Nc3'], continuation: ['Nc6', 'g3', 'g6', 'Bg2', 'Bg7'] },
  { eco: 'B27', name: 'Сицилианская защита', variation: 'Открытая подготовка 2.Nf3', pgnMoves: ['e4', 'c5', 'Nf3'], continuation: ['d6', 'd4', 'cxd4', 'Nxd4', 'Nf6'] },
  { eco: 'B30', name: 'Сицилианская защита', variation: 'Вариант 2.Nf3 Nc6', pgnMoves: ['e4', 'c5', 'Nf3', 'Nc6'], continuation: ['d4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'] },
  { eco: 'B30', name: 'Сицилианская защита', variation: 'Система Россолимо (3.Bb5)', pgnMoves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5'], continuation: ['g6', 'Bxc6', 'dxc6', 'd3', 'Bg7'] },
  { eco: 'B33', name: 'Сицилианская защита', variation: 'Челябинский вариант (Свешникова)', pgnMoves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5'], continuation: ['Ndb5', 'd6', 'Bg5', 'a6', 'Na3', 'b5'] },
  { eco: 'B40', name: 'Сицилианская защита', variation: 'Вариант 2.Nf3 e6', pgnMoves: ['e4', 'c5', 'Nf3', 'e6'], continuation: ['d4', 'cxd4', 'Nxd4', 'Nc6'] },
  { eco: 'B50', name: 'Сицилианская защита', variation: 'Классическая 2.Nf3 d6', pgnMoves: ['e4', 'c5', 'Nf3', 'd6'], continuation: ['d4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'] },
  { eco: 'B54', name: 'Сицилианская защита', variation: 'Открытый вариант (3.d4 cxd4 4.Nxd4)', pgnMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'], continuation: ['Nf6', 'Nc3', 'a6', 'Be3', 'e5'] },
  { eco: 'B70', name: 'Сицилианская защита', variation: 'Вариант Дракона (5...g6)', pgnMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'], continuation: ['Be3', 'Bg7', 'f3', 'O-O', 'Qd2', 'Nc6'] },
  { eco: 'B90', name: 'Сицилианская защита', variation: 'Вариант Найдорфа (5...a6)', pgnMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], continuation: ['Be3', 'e5', 'Nb3', 'Be6', 'f3', 'Be7'] },
  { eco: 'C00', name: 'Французская защита', variation: '2.d4 d5', pgnMoves: ['e4', 'e6', 'd4', 'd5'], continuation: ['Nc3', 'Nf6', 'Bg5', 'Be7', 'e5'] },
  { eco: 'C02', name: 'Французская защита', variation: 'Вариант Нимцовича (3.e5)', pgnMoves: ['e4', 'e6', 'd4', 'd5', 'e5'], continuation: ['c5', 'c3', 'Nc6', 'Nf3', 'Qb6'] },
  { eco: 'C11', name: 'Французская защита', variation: 'Классическая система (3.Nc3 Nf6)', pgnMoves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'], continuation: ['e5', 'Nfd7', 'f4', 'c5', 'Nf3'] },
  { eco: 'C18', name: 'Французская защита', variation: 'Вариант Винавера (3.Nc3 Bb4)', pgnMoves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'], continuation: ['e5', 'c5', 'a3', 'Bxc3+', 'bxc3'] },
  { eco: 'B10', name: 'Защита Каро-Канн', variation: '2.d4 d5', pgnMoves: ['e4', 'c6', 'd4', 'd5'], continuation: ['Nc3', 'dxe4', 'Nxe4', 'Bf5'] },
  { eco: 'B12', name: 'Защита Каро-Канн', variation: 'Закрытый вариант (3.e5)', pgnMoves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'], continuation: ['Nf3', 'e6', 'Be2', 'Nd7', 'O-O'] },
  { eco: 'B18', name: 'Защита Каро-Канн', variation: 'Классический вариант (4...Bf5)', pgnMoves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'], continuation: ['Ng3', 'Bg6', 'h4', 'h6', 'Nf3'] },
  { eco: 'B01', name: 'Скандинавская защита', variation: '2.exd5 Qxd5', pgnMoves: ['e4', 'd5', 'exd5', 'Qxd5'], continuation: ['Nc3', 'Qa5', 'd4', 'Nf6'] },
  { eco: 'B02', name: 'Защита Алехина', variation: '1...Nf6 2.e5 Nd5', pgnMoves: ['e4', 'Nf6', 'e5', 'Nd5'], continuation: ['d4', 'd6', 'Nf3', 'Bg4'] },
  { eco: 'B07', name: 'Защита Пирца-Уфимцева', variation: '2.d4 Nf6 3.Nc3 g6', pgnMoves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6'], continuation: ['Nf3', 'Bg7', 'Be2', 'O-O', 'O-O'] },
  { eco: 'B07', name: 'Защита Пирца-Уфимцева', variation: 'Система с 4.Be3 Bg7 5.Qd2', pgnMoves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'c6', 'f3', 'b5'], continuation: ['Nge2', 'Nbd7', 'Bh6'] },

  // Closed Games & Indian Defenses
  { eco: 'D00', name: 'Дебют ферзевых пешек', variation: '2.Nf3 Nf6', pgnMoves: ['d4', 'd5', 'Nf3', 'Nf6'], continuation: ['c4', 'e6', 'Nc3', 'Be7'] },
  { eco: 'D02', name: 'Лондонская система', variation: '2.Bf4', pgnMoves: ['d4', 'd5', 'Bf4'], continuation: ['Nf6', 'e3', 'c5', 'c3', 'Nc6'] },
  { eco: 'D06', name: 'Ферзевый гамбит', variation: '2.c4', pgnMoves: ['d4', 'd5', 'c4'], continuation: ['e6', 'Nc3', 'Nf6', 'Bg5'] },
  { eco: 'D10', name: 'Славянская защита', variation: '2.c4 c6', pgnMoves: ['d4', 'd5', 'c4', 'c6'], continuation: ['Nf3', 'Nf6', 'Nc3', 'dxc4'] },
  { eco: 'D20', name: 'Принятый ферзевый гамбит', variation: '2.c4 dxc4', pgnMoves: ['d4', 'd5', 'c4', 'dxc4'], continuation: ['Nf3', 'Nf6', 'e3', 'e6', 'Bxc4'] },
  { eco: 'D30', name: 'Отказанный ферзевый гамбит', variation: '2.c4 e6', pgnMoves: ['d4', 'd5', 'c4', 'e6'], continuation: ['Nc3', 'Nf6', 'Bg5', 'Be7', 'e3'] },
  { eco: 'D35', name: 'Отказанный ферзевый гамбит', variation: 'Транспозиция 1.d4 Nf6 2.c4 e6 3.Nc3 d5', pgnMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'd5'], continuation: ['cxd5', 'exd5', 'Bg5', 'Be7'] },
  { eco: 'D37', name: 'Отказанный ферзевый гамбит', variation: 'Классическая система с 5.Bf4', pgnMoves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bf4'], continuation: ['O-O', 'e3', 'c5', 'dxc5'] },
  { eco: 'A45', name: 'Индийская защита', variation: '2.c4', pgnMoves: ['d4', 'Nf6', 'c4'], continuation: ['e6', 'Nc3', 'Bb4'] },
  { eco: 'A80', name: 'Голландская защита', variation: '1.d4 f5 2.c4', pgnMoves: ['d4', 'f5', 'c4'], continuation: ['Nf6', 'g3', 'e6', 'Bg2'] },
  { eco: 'D85', name: 'Защита Грюнфельда', variation: '3.Nc3 d5', pgnMoves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'], continuation: ['cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3'] },
  { eco: 'E20', name: 'Защита Нимцовича', variation: '3.Nc3 Bb4', pgnMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], continuation: ['e3', 'O-O', 'Bd3', 'd5', 'Nf3'] },
  { eco: 'E60', name: 'Староиндийская защита', variation: '2.c4 g6 3.Nc3 Bg7', pgnMoves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'], continuation: ['e4', 'd6', 'Nf3', 'O-O', 'Be2'] },
  { eco: 'E97', name: 'Староиндийская защита', variation: 'Вариант Мар-дель-Плата', pgnMoves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7'], continuation: ['Ne1', 'Nd7', 'Be3', 'f5', 'f3'] },
  { eco: 'A10', name: 'Английское начало', variation: '1.c4 e5 2.Nc3', pgnMoves: ['c4', 'e5', 'Nc3'], continuation: ['Nf6', 'Nf3', 'Nc6', 'g3'] },
  { eco: 'A04', name: 'Дебют Рети', variation: '1.Nf3 d5 2.g3', pgnMoves: ['Nf3', 'd5', 'g3'], continuation: ['Nf6', 'Bg2', 'c6', 'O-O'] },
];

/**
 * Normalizes a FEN string to its 4-field position-identity key:
 * `piecePlacement activeColor castlingRights enPassantTarget`
 *
 * Includes the en passant target square (`parts[3]`) so positions with different
 * en passant possibilities never collide onto the same key.
 */
export function normalizeFenKey(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] || '';
  const turn = parts[1] || 'w';
  const castling = parts[2] || '-';
  const ep = parts[3] || '-';
  return `${placement} ${turn} ${castling} ${ep}`;
}

/**
 * Returns the 4-field FEN key where the en passant square is retained ONLY if an
 * actual legal en passant capture exists in the position; otherwise normalizes `ep` to `-`.
 * Used as a secondary lookup for move-order transpositions where a double pawn push
 * occurred on different moves without creating a legal en passant capture.
 */
export function normalizeLegalEpFenKey(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] || '';
  const turn = parts[1] || 'w';
  const castling = parts[2] || '-';
  const ep = parts[3] || '-';
  if (ep === '-') {
    return `${placement} ${turn} ${castling} -`;
  }
  try {
    const chess = new Chess(fen);
    const hasLegalEpCapture = chess
      .moves({ verbose: true })
      .some((m) => m.flags.includes('e'));
    return `${placement} ${turn} ${castling} ${hasLegalEpCapture ? ep : '-'}`;
  } catch {
    return `${placement} ${turn} ${castling} ${ep}`;
  }
}

export interface CompiledTheoryNode {
  fenKey: string;
  eco: string;
  name: string;
  variation: string;
  ply: number;
  continuationSan: string[];
  isExactEndpoint: boolean;
}

export class OpeningBookService {
  private entries: OpeningBookEntry[] = [...INITIAL_ECO_ENTRIES];
  private exactFenMap: Map<string, CompiledTheoryNode> = new Map();
  private legalEpFenMap: Map<string, CompiledTheoryNode> = new Map();
  private bookEdgesByParentKey: Map<string, Set<string>> = new Map();

  constructor() {
    this.rebuildIndex();
  }

  public getEntriesCount(): number {
    return this.entries.length;
  }

  public rebuildIndex(): void {
    this.exactFenMap.clear();
    this.legalEpFenMap.clear();
    this.bookEdgesByParentKey.clear();

    const sorted = [...this.entries].sort((a, b) => a.pgnMoves.length - b.pgnMoves.length);

    const recordEdge = (parentKey: string, san: string, uci: string) => {
      let set = this.bookEdgesByParentKey.get(parentKey);
      if (!set) {
        set = new Set<string>();
        this.bookEdgesByParentKey.set(parentKey, set);
      }
      set.add(san);
      set.add(uci);
    };

    for (const entry of sorted) {
      const chess = new Chess();
      const totalLen = entry.pgnMoves.length;

      for (let i = 0; i < totalLen; i++) {
        const parentFen = chess.fen();
        const parentExactKey = normalizeFenKey(parentFen);
        const parentLegalKey = normalizeLegalEpFenKey(parentFen);

        const moveSan = entry.pgnMoves[i];
        try {
          const moved = chess.move(moveSan);
          if (!moved) break;

          const uci = `${moved.from}${moved.to}${moved.promotion || ''}`;
          recordEdge(parentExactKey, moved.san, uci);
          recordEdge(parentLegalKey, moved.san, uci);

          const currentFen = chess.fen();
          const exactKey = normalizeFenKey(currentFen);
          const legalKey = normalizeLegalEpFenKey(currentFen);
          const isEndpoint = i === totalLen - 1;
          const remainingMoves = entry.pgnMoves.slice(i + 1);
          const fullContinuation = [
            ...remainingMoves,
            ...(entry.continuation || []),
          ].slice(0, 6);

          // Also register continuation moves as valid book edges from the endpoint
          if (isEndpoint && entry.continuation && entry.continuation.length > 0) {
            const contChess = new Chess(currentFen);
            for (const contSan of entry.continuation) {
              const cParentFen = contChess.fen();
              const cParentExact = normalizeFenKey(cParentFen);
              const cParentLegal = normalizeLegalEpFenKey(cParentFen);
              try {
                const cMoved = contChess.move(contSan);
                if (!cMoved) break;
                const cUci = `${cMoved.from}${cMoved.to}${cMoved.promotion || ''}`;
                recordEdge(cParentExact, cMoved.san, cUci);
                recordEdge(cParentLegal, cMoved.san, cUci);
              } catch {
                break;
              }
            }
          }

          const existingExact = this.exactFenMap.get(exactKey);

          if (isEndpoint) {
            const node: CompiledTheoryNode = {
              fenKey: exactKey,
              eco: entry.eco,
              name: entry.name,
              variation: entry.variation,
              ply: i + 1,
              continuationSan: fullContinuation,
              isExactEndpoint: true,
            };
            this.exactFenMap.set(exactKey, node);
            this.legalEpFenMap.set(legalKey, node);
          } else if (!existingExact) {
            const node: CompiledTheoryNode = {
              fenKey: exactKey,
              eco: i + 1 >= 3 ? entry.eco : 'A00',
              name: i + 1 >= 3 ? entry.name : 'Начальные ходы партии',
              variation:
                i + 1 >= 3
                  ? 'Основное продолжение'
                  : 'Дебют формируется (менее 2 полных ходов)',
              ply: i + 1,
              continuationSan: fullContinuation,
              isExactEndpoint: false,
            };
            this.exactFenMap.set(exactKey, node);
            if (!this.legalEpFenMap.has(legalKey)) {
              this.legalEpFenMap.set(legalKey, node);
            }
          }
        } catch {
          break;
        }
      }
    }
  }

  public addCustomEntries(newEntries: OpeningBookEntry[]): void {
    this.entries.push(...newEntries);
    this.rebuildIndex();
  }

  /**
   * Imports an opening line from a PGN string into the local opening book.
   */
  public importPgnOpening(
    pgn: string,
    fallbackEco = 'A00',
    fallbackName = 'Пользовательский дебют',
    fallbackVariation = 'Основная линия'
  ): OpeningBookEntry | null {
    try {
      const headers: Record<string, string> = {};
      const headerRegex = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
      let match: RegExpExecArray | null;
      while ((match = headerRegex.exec(pgn)) !== null) {
        headers[match[1]] = match[2];
      }

      const chess = new Chess();
      chess.loadPgn(pgn.trim(), { strict: false });
      const history = chess.history();
      if (history.length === 0) return null;

      const entry: OpeningBookEntry = {
        eco: headers.ECO || fallbackEco,
        name: headers.Opening || headers.Event || fallbackName,
        variation: headers.Variation || fallbackVariation,
        pgnMoves: history.slice(0, 30),
      };
      this.addCustomEntries([entry]);
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * Checks if a FEN position exists in the opening book.
   * When `strictEnPassant` is true, requires an exact 4-field FEN match including raw en passant target.
   * By default (`strictEnPassant = false`), matches exact 4-field FEN first, then falls back to
   * legal-en-passant-aware FEN so non-capturable en-passant target differences in transpositions still match.
   */
  public isPositionInTheory(
    fen: string,
    options?: { strictEnPassant?: boolean }
  ): CompiledTheoryNode | undefined {
    const exactKey = normalizeFenKey(fen);
    const exactMatch = this.exactFenMap.get(exactKey);
    if (exactMatch || options?.strictEnPassant) {
      return exactMatch;
    }
    return this.legalEpFenMap.get(normalizeLegalEpFenKey(fen));
  }

  /**
   * Checks whether a specific move (`moveSanOrUci`) from `fenBefore` resulting in `fenAfter`
   * is a genuine theoretical book move (either via a direct book edge from `fenBefore` or
   * a valid transition between two theoretical positions).
   */
  public isBookMove(
    fenBefore: string,
    moveSanOrUci: string,
    fenAfter?: string
  ): boolean {
    const parentExact = normalizeFenKey(fenBefore);
    const parentLegal = normalizeLegalEpFenKey(fenBefore);

    const exactEdges = this.bookEdgesByParentKey.get(parentExact);
    if (exactEdges && exactEdges.has(moveSanOrUci)) {
      return true;
    }

    const legalEdges = this.bookEdgesByParentKey.get(parentLegal);
    if (legalEdges && legalEdges.has(moveSanOrUci)) {
      return true;
    }

    // Also allow pure move-order transposition where both parent and child are in the book
    if (fenAfter) {
      const parentInBook =
        normalizeFenKey(fenBefore) ===
          normalizeFenKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') ||
        Boolean(this.isPositionInTheory(fenBefore));
      const childInBook = Boolean(this.isPositionInTheory(fenAfter));
      if (parentInBook && childInBook) {
        return true;
      }
    }

    return false;
  }

  /**
   * Analyzes a sequence of moves for ECO opening classification, last theoretical move,
   * first out-of-book move, and any later transposition back into known book positions.
   *
   * Key guarantees:
   * - Never overwrites `firstOutOfBookPly` once the game deviates from theory.
   * - If the game deviates from theory and later transposes back into a known book position,
   *   records `transposedBackToBookPly` and `transposedOpeningName` separately without
   *   falsely claiming the out-of-book moves were uninterrupted theory.
   */
  public analyzeMainlineOpening(pathNodes: MoveNode[]): OpeningAnalysisSummary {
    const moveNodesOnly = pathNodes.filter((n) => n.ply > 0);

    for (const node of pathNodes) {
      if (node.analysis) {
        node.analysis.isTheoretical = false;
        node.analysis.isBookTransposition = false;
        node.analysis.isLastTheoretical = false;
        node.analysis.isFirstOutOfTheory = false;
      }
    }

    if (moveNodesOnly.length <= 2) {
      let wBook = 0;
      let bBook = 0;
      let lastBookPly = 0;
      let lastBookSan: string | null = null;
      let firstOutPly: number | null = null;
      let firstOutSan: string | null = null;
      let unbrokenBook = true;

      for (let i = 0; i < moveNodesOnly.length; i++) {
        const n = moveNodesOnly[i];
        const prevFen =
          i === 0
            ? pathNodes[0]?.fen ||
              'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
            : moveNodesOnly[i - 1].fen;
        const inBook =
          unbrokenBook &&
          (this.isBookMove(prevFen, n.san, n.fen) ||
            this.isBookMove(prevFen, n.uci, n.fen));

        if (inBook) {
          if (n.color === 'w') wBook++;
          else bBook++;
          lastBookPly = n.ply;
          lastBookSan = `${n.moveNumber}${n.color === 'w' ? '.' : '...'} ${n.san}`;
          if (n.analysis) n.analysis.isTheoretical = true;
        } else if (unbrokenBook) {
          unbrokenBook = false;
          firstOutPly = n.ply;
          firstOutSan = `${n.moveNumber}${n.color === 'w' ? '.' : '...'} ${n.san}`;
          if (n.analysis) n.analysis.isFirstOutOfTheory = true;
        }
      }

      return {
        eco: '—',
        name: 'Дебют ещё не определён',
        variation:
          moveNodesOnly.length === 0
            ? 'Начальная позиция'
            : 'Сыграно менее 2 полных ходов — сделайте ещё ход для определения дебюта',
        source: OPENING_BOOK_META.source,
        version: OPENING_BOOK_META.version,
        theoreticalMovesWhite: wBook,
        theoreticalMovesBlack: bBook,
        lastTheoreticalPly: lastBookPly,
        lastTheoreticalMoveSan: lastBookSan,
        firstOutOfBookPly: firstOutPly,
        firstOutOfBookMoveSan: firstOutSan,
        transposedBackToBookPly: null,
        transposedOpeningName: null,
        mainBookContinuationSan: ['Nf3', 'Nc6', 'Bc4', 'Bc5'],
      };
    }

    let bestNamedMatch: CompiledTheoryNode = {
      fenKey: '',
      eco: 'A00',
      name: 'Нестандартное начало',
      variation: 'Редкое продолжение',
      ply: 0,
      continuationSan: [],
      isExactEndpoint: false,
    };

    let lastTheoreticalPly = 0;
    let lastTheoreticalMoveSan: string | null = null;
    let firstOutOfBookPly: number | null = null;
    let firstOutOfBookMoveSan: string | null = null;
    let transposedBackToBookPly: number | null = null;
    let transposedOpeningName: string | null = null;
    let theoreticalMovesWhite = 0;
    let theoreticalMovesBlack = 0;
    let stillInUnbrokenTheory = true;

    const rootFen =
      pathNodes[0]?.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    for (let i = 0; i < moveNodesOnly.length; i++) {
      const node = moveNodesOnly[i];
      const parentFen = i === 0 ? rootFen : moveNodesOnly[i - 1].fen;

      const posMatch = this.isPositionInTheory(node.fen);
      const isMoveBook =
        this.isBookMove(parentFen, node.san, node.fen) ||
        this.isBookMove(parentFen, node.uci, node.fen);

      if (stillInUnbrokenTheory && posMatch && isMoveBook) {
        if (node.ply >= 3 && (posMatch.isExactEndpoint || bestNamedMatch.ply === 0)) {
          bestNamedMatch = posMatch;
        }
        lastTheoreticalPly = node.ply;
        lastTheoreticalMoveSan = `${node.moveNumber}${node.color === 'w' ? '.' : '...'} ${node.san}`;

        if (node.color === 'w') {
          theoreticalMovesWhite++;
        } else {
          theoreticalMovesBlack++;
        }

        if (node.analysis) {
          node.analysis.isTheoretical = true;
        }
      } else if (stillInUnbrokenTheory) {
        // First deviation from the opening book! Never overwritten by subsequent moves.
        stillInUnbrokenTheory = false;
        firstOutOfBookPly = node.ply;
        firstOutOfBookMoveSan = `${node.moveNumber}${node.color === 'w' ? '.' : '...'} ${node.san}`;
        if (node.analysis) {
          node.analysis.isTheoretical = false;
          node.analysis.isFirstOutOfTheory = true;
        }
      } else {
        // Already out of the unbroken opening book line: check if this move transposed back into a known book position
        if (posMatch) {
          if (transposedBackToBookPly === null) {
            transposedBackToBookPly = node.ply;
            transposedOpeningName = `${posMatch.name}: ${posMatch.variation}`;
          }
          if (node.ply >= 3 && (posMatch.isExactEndpoint || bestNamedMatch.ply === 0)) {
            bestNamedMatch = posMatch;
          }
          if (node.analysis) {
            node.analysis.isBookTransposition = true;
          }
        }
      }
    }

    for (const node of pathNodes) {
      if (!node.analysis) continue;
      if (lastTheoreticalPly > 0 && node.ply === lastTheoreticalPly) {
        node.analysis.isLastTheoretical = true;
      }
      if (firstOutOfBookPly !== null && node.ply === firstOutOfBookPly) {
        node.analysis.isFirstOutOfTheory = true;
      }
    }

    return {
      eco: bestNamedMatch.eco,
      name: bestNamedMatch.name,
      variation: bestNamedMatch.variation,
      source: OPENING_BOOK_META.source,
      version: OPENING_BOOK_META.version,
      theoreticalMovesWhite,
      theoreticalMovesBlack,
      lastTheoreticalPly,
      lastTheoreticalMoveSan,
      firstOutOfBookPly,
      firstOutOfBookMoveSan,
      transposedBackToBookPly,
      transposedOpeningName,
      mainBookContinuationSan: bestNamedMatch.continuationSan,
    };
  }
}

export const openingBook = new OpeningBookService();
