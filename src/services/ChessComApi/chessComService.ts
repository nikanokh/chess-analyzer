import { z } from 'zod';

export const ChessComProfileSchema = z.object({
  username: z.string(),
  name: z.string().optional(),
  avatar: z.string().optional(),
  title: z.string().optional(),
  country: z.string().optional(),
  followers: z.number().optional(),
  url: z.string().optional(),
});

export type ChessComProfile = z.infer<typeof ChessComProfileSchema>;

export const ChessComArchivesSchema = z.object({
  archives: z.array(z.string()),
});

export const ChessComPlayerGameSideSchema = z.object({
  rating: z.number().optional(),
  result: z.string(),
  username: z.string(),
});

export const ChessComGameSchema = z.object({
  uuid: z.string().optional(),
  url: z.string(),
  pgn: z.string().optional(),
  time_control: z.string(),
  end_time: z.number(),
  rated: z.boolean().optional(),
  time_class: z.string().optional(),
  rules: z.string().optional(),
  white: ChessComPlayerGameSideSchema,
  black: ChessComPlayerGameSideSchema,
});

export type ChessComGameItem = z.infer<typeof ChessComGameSchema>;

const ChessComGamesResponseSchema = z.object({
  games: z.array(ChessComGameSchema),
});

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

const PROFILE_TTL_MS = 5 * 60 * 1000;
const ARCHIVES_LIST_TTL_MS = 8 * 1000;
const LATEST_ARCHIVE_TTL_MS = 5 * 1000;
const HISTORICAL_ARCHIVE_TTL_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCurrentMonthArchiveUrl(archiveUrl: string): boolean {
  const parts = archiveUrl.split('/');
  const monthStr = parts[parts.length - 1];
  const yearStr = parts[parts.length - 2];
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (Number.isNaN(year) || Number.isNaN(month)) return true;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  return year === currentYear && month === currentMonth;
}

export function clearChessComCache(username?: string): void {
  if (!username) {
    memoryCache.clear();
    return;
  }
  const clean = encodeURIComponent(username.trim().toLowerCase());
  for (const key of Array.from(memoryCache.keys())) {
    if (key.toLowerCase().includes(`/player/${clean}`)) {
      memoryCache.delete(key);
    }
  }
}

async function fetchWithRetryAndCache<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: {
    ttlMs?: number;
    forceRefresh?: boolean;
    noStore?: boolean;
    retries?: number;
  }
): Promise<T> {
  const ttlMs = options?.ttlMs ?? PROFILE_TTL_MS;
  const forceRefresh = options?.forceRefresh ?? false;
  const noStore = options?.noStore ?? forceRefresh;
  const maxRetries = options?.retries ?? 3;

  if (!forceRefresh && memoryCache.has(url)) {
    const entry = memoryCache.get(url) as CacheEntry<T>;
    if (Date.now() - entry.timestamp < ttlMs) {
      return entry.data;
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        cache: noStore ? 'no-store' : 'default',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt < maxRetries) {
          await sleep(600 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(
          response.status === 429
            ? 'Превышен лимит запросов к Chess.com API. Попробуйте через несколько секунд.'
            : `Временная ошибка сервера Chess.com (${response.status})`
        );
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Пользователь или архив на Chess.com не найден');
        }
        throw new Error(`Ошибка Chess.com API (${response.status})`);
      }

      const json = await response.json();
      const parsed = schema.parse(json);
      memoryCache.set(url, {
        data: parsed,
        timestamp: Date.now(),
      });
      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Do not retry 404s
      if (lastError.message.includes('не найден')) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error('Ошибка соединения с Chess.com API');
}

export async function fetchChessComProfile(
  username: string,
  options?: { forceRefresh?: boolean }
): Promise<ChessComProfile> {
  const clean = username.trim().toLowerCase();
  if (!clean) throw new Error('Введите имя пользователя Chess.com');
  return fetchWithRetryAndCache(
    `https://api.chess.com/pub/player/${encodeURIComponent(clean)}`,
    ChessComProfileSchema,
    {
      ttlMs: PROFILE_TTL_MS,
      forceRefresh: options?.forceRefresh,
    }
  );
}

export async function fetchChessComArchives(
  username: string,
  options?: { forceRefresh?: boolean }
): Promise<string[]> {
  const clean = username.trim().toLowerCase();
  if (!clean) throw new Error('Введите имя пользователя Chess.com');
  const data = await fetchWithRetryAndCache(
    `https://api.chess.com/pub/player/${encodeURIComponent(clean)}/games/archives`,
    ChessComArchivesSchema,
    {
      ttlMs: ARCHIVES_LIST_TTL_MS,
      forceRefresh: options?.forceRefresh,
      noStore: true,
    }
  );
  // Return in reverse chronological order (newest year/month first), deduplicated
  const seen = new Set<string>();
  const reversed: string[] = [];
  for (let i = data.archives.length - 1; i >= 0; i--) {
    const url = data.archives[i];
    if (!seen.has(url)) {
      seen.add(url);
      reversed.push(url);
    }
  }
  return reversed;
}

export function getChessComGameKey(game: ChessComGameItem): string {
  if (game.uuid) return `uuid:${game.uuid}`;
  if (game.url) return `url:${game.url}`;
  return `fallback:${game.white.username.toLowerCase()}_${game.black.username.toLowerCase()}_${game.end_time}`;
}

export function mergeAndDeduplicateChessComGames(
  existingGames: ChessComGameItem[],
  incomingGames: ChessComGameItem[]
): ChessComGameItem[] {
  const map = new Map<string, ChessComGameItem>();
  for (const g of existingGames) {
    map.set(getChessComGameKey(g), g);
  }
  for (const g of incomingGames) {
    map.set(getChessComGameKey(g), g);
  }
  return Array.from(map.values()).sort((a, b) => b.end_time - a.end_time);
}

export async function fetchChessComGamesByArchiveUrl(
  archiveUrl: string,
  options?: { forceRefresh?: boolean; isLatestArchive?: boolean }
): Promise<ChessComGameItem[]> {
  const isLiveArchive =
    Boolean(options?.isLatestArchive) || isCurrentMonthArchiveUrl(archiveUrl);

  const data = await fetchWithRetryAndCache(archiveUrl, ChessComGamesResponseSchema, {
    ttlMs: isLiveArchive ? LATEST_ARCHIVE_TTL_MS : HISTORICAL_ARCHIVE_TTL_MS,
    forceRefresh: options?.forceRefresh,
    noStore: isLiveArchive || Boolean(options?.forceRefresh),
  });

  // Include games with valid PGN, deduplicated and sorted newest first
  const validGames = data.games.filter(
    (g) => Boolean(g.pgn) && (!g.rules || g.rules === 'chess' || g.rules === 'chess960')
  );

  return mergeAndDeduplicateChessComGames([], validGames);
}

export function mapChessComResult(
  game: ChessComGameItem,
  targetUsername: string
): {
  userColor: 'w' | 'b';
  outcome: 'win' | 'loss' | 'draw';
  resultString: string;
} {
  const isWhite = game.white.username.toLowerCase() === targetUsername.toLowerCase();
  const side = isWhite ? game.white : game.black;
  const opp = isWhite ? game.black : game.white;

  const drawResults = new Set([
    'agreed',
    'repetition',
    'stalemate',
    'insufficient',
    '50move',
    'timevsinsufficient',
  ]);

  let outcome: 'win' | 'loss' | 'draw' = 'loss';
  let resultString = '0-1';

  if (side.result === 'win') {
    outcome = 'win';
    resultString = isWhite ? '1-0' : '0-1';
  } else if (drawResults.has(side.result) || drawResults.has(opp.result)) {
    outcome = 'draw';
    resultString = '1/2-1/2';
  } else {
    outcome = 'loss';
    resultString = isWhite ? '0-1' : '1-0';
  }

  return {
    userColor: isWhite ? 'w' : 'b',
    outcome,
    resultString,
  };
}
