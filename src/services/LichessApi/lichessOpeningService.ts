import { LichessExplorerData } from '../../types/chess';

const explorerCache = new Map<string, LichessExplorerData>();

/**
 * Fetches master / popular game continuations from Lichess Opening Explorer API
 * for statistical comparison alongside the local ECO theoretical book.
 */
export async function fetchLichessOpeningStats(fen: string): Promise<LichessExplorerData | null> {
  if (explorerCache.has(fen)) {
    return explorerCache.get(fen)!;
  }

  try {
    const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=6&topGames=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as LichessExplorerData;
    explorerCache.set(fen, data);
    return data;
  } catch {
    return null;
  }
}
