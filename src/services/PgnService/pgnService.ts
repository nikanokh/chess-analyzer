import { Chess } from 'chess.js';
import { GameMetadata, MoveNode } from '../../types/chess';
import {
  createRootNode,
  DEFAULT_START_FEN,
  parsePgnMovetextToTree,
} from '../../core/chess/VariationTree';

export interface ParsedPgnResult {
  root: MoveNode;
  metadata: GameMetadata;
  initialFen: string;
  pgn: string;
}

const KNOWN_TITLED_PLAYERS: Record<string, string> = {
  'paul morphy': 'GM',
  magnuscarlsen: 'GM',
  'magnus carlsen': 'GM',
  hikaru: 'GM',
  'hikaru nakamura': 'GM',
  'garry kasparov': 'GM',
  'veselin topalov': 'GM',
  danielnaroditsky: 'GM',
  'daniel naroditsky': 'GM',
  gothamchess: 'IM',
  'levy rozman': 'IM',
  fabianocaruana: 'GM',
  'fabiano caruana': 'GM',
  alirezafirouzja: 'GM',
  'alireza firouzja': 'GM',
  lachesisq: 'GM',
  'ian nepomniachtchi': 'GM',
  anishgiri: 'GM',
  'anish giri': 'GM',
  levonaronian: 'GM',
  bobbyfischer: 'GM',
  'robert james fischer': 'GM',
  'mikhail tal': 'GM',
  'anatoly karpov': 'GM',
  'vladimir kramnik': 'GM',
  'viswanathan anand': 'GM',
  'ding liren': 'GM',
  'gukesh d': 'GM',
  'praggnanandhaa': 'GM',
  botezlive: 'WFM',
  'alexandra botez': 'WFM',
  annacramling: 'WFM',
  'anna cramling': 'WFM',
  nemo: 'WGM',
  akanemsko: 'WGM',
};

const VALID_TITLES = new Set(['GM', 'IM', 'FM', 'CM', 'NM', 'WGM', 'WIM', 'WFM', 'WCM']);

function extractTitleAndName(
  rawName: string,
  explicitHeaderTitle?: string
): { cleanName: string; title?: string } {
  const trimmed = rawName.trim();
  if (explicitHeaderTitle && VALID_TITLES.has(explicitHeaderTitle.trim().toUpperCase())) {
    return { cleanName: trimmed, title: explicitHeaderTitle.trim().toUpperCase() };
  }

  // Check if name starts with a title prefix like "GM Hikaru" or "IM Levy"
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && VALID_TITLES.has(parts[0].toUpperCase())) {
    return {
      cleanName: parts.slice(1).join(' '),
      title: parts[0].toUpperCase(),
    };
  }

  const lookup = KNOWN_TITLED_PLAYERS[trimmed.toLowerCase()];
  if (lookup) {
    return { cleanName: trimmed, title: lookup };
  }

  return { cleanName: trimmed };
}

/**
 * Computes standard Elo rating change after a finished game if explicit RatingDiff tag is absent.
 */
export function calculateEloDelta(
  playerRating?: number,
  opponentRating?: number,
  result?: string,
  color: 'w' | 'b' = 'w'
): number | undefined {
  if (!playerRating || !opponentRating || !result || result === '*') {
    return undefined;
  }

  let actualScore: number;
  if (result === '1-0') {
    actualScore = color === 'w' ? 1 : 0;
  } else if (result === '0-1') {
    actualScore = color === 'b' ? 1 : 0;
  } else if (result === '1/2-1/2' || result === '½-½') {
    actualScore = 0.5;
  } else {
    return undefined;
  }

  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  const kFactor = 16;
  let delta = Math.round(kFactor * (actualScore - expectedScore));
  if (actualScore === 1 && delta < 1) delta = 1;
  if (actualScore === 0 && delta > -1) delta = -1;
  return delta;
}

function computeStableHash(input: string): string {
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

function getMainlineSanSignature(root: MoveNode): string {
  const sans: string[] = [];
  let cursor = root;
  while (cursor.children.length > 0) {
    const next = cursor.children[0];
    sans.push(next.san);
    cursor = next;
  }
  return sans.join(' ');
}

export function computeCanonicalGameId(
  headers: Record<string, string>,
  root: MoveNode,
  initialFen: string,
  whiteName: string,
  blackName: string
): string {
  const link = (headers.Link || '').trim().toLowerCase();
  const site = (headers.Site || '').trim().toLowerCase();
  if (link.startsWith('http://') || link.startsWith('https://')) {
    return `game_${computeStableHash(link)}`;
  }
  if (
    (site.startsWith('http://') || site.startsWith('https://')) &&
    /\/\d{5,}|lichess\.org\/[a-z0-9]{8}/i.test(site)
  ) {
    return `game_${computeStableHash(site)}`;
  }

  const mainlineSig = getMainlineSanSignature(root);
  if (!mainlineSig && initialFen === DEFAULT_START_FEN) {
    return `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const rawKey = [
    whiteName.trim().toLowerCase(),
    blackName.trim().toLowerCase(),
    (headers.Date || '').trim(),
    (headers.UTCDate || '').trim(),
    (headers.UTCTime || '').trim(),
    (headers.TimeControl || '').trim(),
    initialFen.trim(),
    mainlineSig,
  ].join('|');

  return `game_${computeStableHash(rawKey)}`;
}

export function parsePgnToTree(
  pgnText: string,
  platformOverride?: GameMetadata['platform'],
  extraTitles?: { whiteTitle?: string; blackTitle?: string }
): ParsedPgnResult {
  const cleanPgn = pgnText.trim();
  const chess = new Chess();

  const headers: Record<string, string> = {};
  const headerRegex = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(cleanPgn)) !== null) {
    headers[match[1]] = match[2];
  }

  const initialFen = headers.FEN || DEFAULT_START_FEN;
  const root = parsePgnMovetextToTree(cleanPgn, initialFen);
  if (root.children.length === 0 && cleanPgn.length > 0 && !cleanPgn.endsWith('*')) {
    // Validate with chess.js if non-empty movetext produced 0 moves
    chess.loadPgn(cleanPgn, { strict: false });
  }

  const rawWhiteRating = headers.WhiteElo ? parseInt(headers.WhiteElo, 10) : undefined;
  const rawBlackRating = headers.BlackElo ? parseInt(headers.BlackElo, 10) : undefined;
  const whiteRating = Number.isNaN(rawWhiteRating) ? undefined : rawWhiteRating;
  const blackRating = Number.isNaN(rawBlackRating) ? undefined : rawBlackRating;

  const result = headers.Result || '*';

  const parsedWhiteDiff = headers.WhiteRatingDiff
    ? parseInt(headers.WhiteRatingDiff, 10)
    : undefined;
  const parsedBlackDiff = headers.BlackRatingDiff
    ? parseInt(headers.BlackRatingDiff, 10)
    : undefined;

  const whiteRatingDiff =
    parsedWhiteDiff !== undefined && !Number.isNaN(parsedWhiteDiff)
      ? parsedWhiteDiff
      : calculateEloDelta(whiteRating, blackRating, result, 'w');
  const blackRatingDiff =
    parsedBlackDiff !== undefined && !Number.isNaN(parsedBlackDiff)
      ? parsedBlackDiff
      : calculateEloDelta(blackRating, whiteRating, result, 'b');

  const whiteExtracted = extractTitleAndName(
    headers.White || 'Белые',
    extraTitles?.whiteTitle || headers.WhiteTitle
  );
  const blackExtracted = extractTitleAndName(
    headers.Black || 'Чёрные',
    extraTitles?.blackTitle || headers.BlackTitle
  );

  const detectedPlatform: GameMetadata['platform'] =
    platformOverride ||
    (headers.Site?.toLowerCase().includes('chess.com') ||
    headers.Link?.toLowerCase().includes('chess.com')
      ? 'Chess.com'
      : headers.Site?.toLowerCase().includes('lichess') ||
        headers.Link?.toLowerCase().includes('lichess')
      ? 'Lichess'
      : 'PGN');

  const deterministicId = computeCanonicalGameId(
    headers,
    root,
    initialFen,
    whiteExtracted.cleanName,
    blackExtracted.cleanName
  );

  const metadata: GameMetadata = {
    id: deterministicId,
    whiteName: whiteExtracted.cleanName,
    blackName: blackExtracted.cleanName,
    whiteTitle: whiteExtracted.title,
    blackTitle: blackExtracted.title,
    whiteRating,
    blackRating,
    whiteRatingDiff,
    blackRatingDiff,
    timeControl: headers.TimeControl || 'Классика',
    platform: detectedPlatform,
    date: headers.Date || new Date().toISOString().slice(0, 10),
    result,
    event: headers.Event || 'Шахматная партия',
    site: headers.Link || headers.Site || '',
    eco: headers.ECO || undefined,
    openingName: headers.Opening || undefined,
  };

  return {
    root,
    metadata,
    initialFen,
    pgn: cleanPgn,
  };
}

export function createTreeFromFen(fen: string): ParsedPgnResult {
  const chess = new Chess(fen.trim());
  const validFen = chess.fen();
  const root = createRootNode(validFen);
  const metadata: GameMetadata = {
    id: `fen_${computeStableHash(validFen)}_${Date.now().toString(36)}`,
    whiteName: 'Белые',
    blackName: 'Чёрные',
    platform: 'Analysis',
    date: new Date().toISOString().slice(0, 10),
    result: '*',
    event: 'Позиция из FEN',
    timeControl: '-',
  };

  return {
    root,
    metadata,
    initialFen: validFen,
    pgn: `[FEN "${validFen}"]\n[SetUp "1"]\n\n*`,
  };
}

export function createNewEmptyGame(): ParsedPgnResult {
  const root = createRootNode(DEFAULT_START_FEN);
  const today = new Date().toISOString().slice(0, 10);
  const metadata: GameMetadata = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    whiteName: 'Белые',
    blackName: 'Чёрные',
    platform: 'Analysis',
    date: today,
    result: '*',
    event: 'Свободная партия',
    timeControl: 'Без часов',
  };

  return {
    root,
    metadata,
    initialFen: DEFAULT_START_FEN,
    pgn: `[Event "Свободная партия"]\n[Date "${today}"]\n[White "Белые"]\n[Black "Чёрные"]\n[Result "*"]\n\n*`,
  };
}

export const SAMPLE_MASTER_GAMES: Array<{
  title: string;
  subtitle: string;
  pgn: string;
}> = [
  {
    title: 'Морфи — Герцог Брауншвейгский (Опера в Париже, 1858)',
    subtitle: 'Защита Филидора · Блестящие жертвы и форсированный мат в 17 ходов',
    pgn: `[Event "Opera Game"]
[Site "Paris FRA"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[WhiteTitle "GM"]
[WhiteElo "2690"]
[BlackElo "2150"]
[WhiteRatingDiff "+4"]
[BlackRatingDiff "-4"]
[TimeControl "Classical"]
[Result "1-0"]
[ECO "C41"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`,
  },
  {
    title: 'Магнус Карлсен — Хикару Накамура (Titled Tuesday, 2024)',
    subtitle: 'Испанская партия · Острая тактическая борьба с перехватом инициативы',
    pgn: `[Event "Titled Tuesday Blitz"]
[Site "Chess.com"]
[Date "2024.05.14"]
[White "MagnusCarlsen"]
[Black "Hikaru"]
[WhiteTitle "GM"]
[BlackTitle "GM"]
[WhiteElo "3265"]
[BlackElo "3248"]
[WhiteRatingDiff "+8"]
[BlackRatingDiff "-8"]
[TimeControl "180+1"]
[Result "1-0"]
[ECO "C65"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Nxe4 5. Re1 Nd6 6. Nxe5 Be7 7. Bf1 Nxe5 8. Rxe5 O-O 9. d4 Bf6 10. Re1 Re8 11. c3 Rxe1 12. Qxe1 Ne8 13. Bf4 d5 14. Bd3 g6 15. Nd2 Ng7 16. Qe2 c6 17. Re1 Bf5 18. Bxf5 Nxf5 19. Nf3 Ng7 20. Be5 Ne6 21. Bxf6 Qxf6 22. Ne5 Re8 23. Ng4 Qd8 24. Qe5 Ng7 25. Nf6+ Kf8 26. Nxe8 Qxe8 27. Qd6+ 1-0`,
  },
  {
    title: 'Гарри Каспаров — Веселин Топалов (Вейк-ан-Зее, 1999)',
    subtitle: 'Защита Пирца-Уфимцева · «Бессмертная партия Каспарова» с жертвой ладьи',
    pgn: `[Event "Hoogovens Wijk aan Zee"]
[Site "Wijk aan Zee NED"]
[Date "1999.01.20"]
[White "Garry Kasparov"]
[Black "Veselin Topalov"]
[WhiteTitle "GM"]
[BlackTitle "GM"]
[WhiteElo "2812"]
[BlackElo "2700"]
[WhiteRatingDiff "+6"]
[BlackRatingDiff "-6"]
[TimeControl "40/7200"]
[Result "1-0"]
[ECO "B07"]

1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0`,
  },
];
