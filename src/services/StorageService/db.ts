import Dexie, { type Table } from 'dexie';
import { AppSettings, SavedGameRecord } from '../../types/chess';
import {
  OpeningAnalysisCacheRecord,
  OpeningRepertoireCacheRecord,
  PersistedRepertoireTaskState,
} from '../../types/repertoire';

export interface StoredSettingsRecord {
  id: string;
  settings: AppSettings;
  updatedAt: number;
}

export class ChessAnalyzerDatabase extends Dexie {
  games!: Table<SavedGameRecord, string>;
  settings!: Table<StoredSettingsRecord, string>;
  openingAnalysisCache!: Table<OpeningAnalysisCacheRecord, string>;
  openingRepertoireCache!: Table<OpeningRepertoireCacheRecord, string>;
  repertoireTaskState!: Table<PersistedRepertoireTaskState, string>;

  constructor() {
    super('ChessAnalyzerDB');
    this.version(1).stores({
      games: 'id, createdAt, updatedAt, metadata.whiteName, metadata.blackName, metadata.platform',
      settings: 'id, updatedAt',
    });
    this.version(2).stores({
      games: 'id, createdAt, updatedAt, metadata.whiteName, metadata.blackName, metadata.platform',
      settings: 'id, updatedAt',
      openingAnalysisCache:
        'id, gameId, pgnHash, playerUsername, playerColor, eco, openingName, status, analyzedAt',
      openingRepertoireCache: 'id, playerIdentifier, createdAt',
      repertoireTaskState: 'id, updatedAt',
    });
  }
}

export const db = new ChessAnalyzerDatabase();

function getSavedRecordDedupSignature(record: SavedGameRecord): string {
  const site = (record.metadata?.site || '').trim().toLowerCase();
  if (
    (site.startsWith('http://') || site.startsWith('https://')) &&
    /\/\d{5,}|lichess\.org\/[a-z0-9]{8}/i.test(site)
  ) {
    return `site:${site}`;
  }

  // Strip PGN headers to compare mainline move body for imported games
  const movetext = (record.pgn || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!movetext || movetext === '*') {
    return `id:${record.id}`;
  }

  return [
    (record.metadata?.whiteName || '').trim().toLowerCase(),
    (record.metadata?.blackName || '').trim().toLowerCase(),
    (record.metadata?.date || '').trim(),
    (record.metadata?.platform || '').trim(),
    movetext,
  ].join('|');
}

export async function saveGameToIndexedDB(record: SavedGameRecord): Promise<SavedGameRecord> {
  const now = Date.now();
  const existingById = await db.games.get(record.id);
  const allExisting = await db.games.toArray();
  const targetSig = getSavedRecordDedupSignature(record);

  const duplicateIdsToDelete: string[] = [];
  let earliestCreatedAt = existingById?.createdAt || record.createdAt || now;
  let preservedStats = record.statistics || existingById?.statistics;

  for (const item of allExisting) {
    if (item.id === record.id) continue;
    if (getSavedRecordDedupSignature(item) === targetSig) {
      duplicateIdsToDelete.push(item.id);
      if (item.createdAt && item.createdAt < earliestCreatedAt) {
        earliestCreatedAt = item.createdAt;
      }
      if (!preservedStats && item.statistics) {
        preservedStats = item.statistics;
      }
    }
  }

  if (duplicateIdsToDelete.length > 0) {
    await db.games.bulkDelete(duplicateIdsToDelete);
  }

  const normalizedRecord: SavedGameRecord = {
    ...record,
    statistics: preservedStats,
    createdAt: earliestCreatedAt,
    updatedAt: now,
  };

  await db.games.put(normalizedRecord);
  return normalizedRecord;
}

export async function loadAllSavedGames(): Promise<SavedGameRecord[]> {
  const rawList = await db.games.orderBy('updatedAt').reverse().toArray();
  const seenSignatures = new Map<string, SavedGameRecord>();
  const duplicateIds: string[] = [];

  for (const item of rawList) {
    const sig = getSavedRecordDedupSignature(item);
    const existing = seenSignatures.get(sig);
    if (!existing) {
      seenSignatures.set(sig, item);
    } else {
      duplicateIds.push(item.id);
      if (!existing.statistics && item.statistics) {
        existing.statistics = item.statistics;
      }
    }
  }

  if (duplicateIds.length > 0) {
    db.games.bulkDelete(duplicateIds).catch(() => {});
  }

  return Array.from(seenSignatures.values());
}

export async function deleteSavedGame(id: string): Promise<void> {
  await db.games.delete(id);
}

export async function saveSettingsToIndexedDB(settings: AppSettings): Promise<void> {
  await db.settings.put({
    id: 'user_settings',
    settings,
    updatedAt: Date.now(),
  });
}

export async function loadSettingsFromIndexedDB(): Promise<AppSettings | null> {
  const row = await db.settings.get('user_settings');
  return row ? row.settings : null;
}

// ============================================================================
// Opening Repertoire Cache & Task Persistence
// ============================================================================

export async function getOpeningAnalysisCacheItem(
  id: string
): Promise<OpeningAnalysisCacheRecord | undefined> {
  try {
    return await db.openingAnalysisCache.get(id);
  } catch {
    return undefined;
  }
}

export async function getAllOpeningAnalysisCacheItems(): Promise<OpeningAnalysisCacheRecord[]> {
  try {
    return await db.openingAnalysisCache.toArray();
  } catch {
    return [];
  }
}

export async function putOpeningAnalysisCacheItem(
  record: OpeningAnalysisCacheRecord
): Promise<void> {
  try {
    await db.openingAnalysisCache.put(record);
  } catch (err) {
    console.error('Failed to save OpeningAnalysisCacheRecord:', err);
  }
}

export async function bulkPutOpeningAnalysisCacheItems(
  records: OpeningAnalysisCacheRecord[]
): Promise<void> {
  if (records.length === 0) return;
  try {
    await db.openingAnalysisCache.bulkPut(records);
  } catch (err) {
    console.error('Failed to bulkPut OpeningAnalysisCacheRecords:', err);
  }
}

export async function getOpeningRepertoireCacheItem(
  id: string
): Promise<OpeningRepertoireCacheRecord | undefined> {
  try {
    return await db.openingRepertoireCache.get(id);
  } catch {
    return undefined;
  }
}

export async function putOpeningRepertoireCacheItem(
  record: OpeningRepertoireCacheRecord
): Promise<void> {
  try {
    await db.openingRepertoireCache.put(record);
  } catch (err) {
    console.error('Failed to save OpeningRepertoireCacheRecord:', err);
  }
}

export async function getPersistedRepertoireTask(): Promise<PersistedRepertoireTaskState | null> {
  try {
    const row = await db.repertoireTaskState.get('active_repertoire_task');
    return row || null;
  } catch {
    return null;
  }
}

export async function putPersistedRepertoireTask(
  state: PersistedRepertoireTaskState
): Promise<void> {
  try {
    await db.repertoireTaskState.put({
      ...state,
      id: 'active_repertoire_task',
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error('Failed to save PersistedRepertoireTaskState:', err);
  }
}

export async function clearPersistedRepertoireTask(): Promise<void> {
  try {
    await db.repertoireTaskState.delete('active_repertoire_task');
  } catch {
    // ignore
  }
}

export async function getAllOpeningRepertoireCacheItems(): Promise<OpeningRepertoireCacheRecord[]> {
  try {
    return await db.openingRepertoireCache.toArray();
  } catch {
    return [];
  }
}

export async function deleteOpeningAnalysisCacheByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db.openingAnalysisCache.bulkDelete(ids);
  } catch (err) {
    console.error('Failed to delete OpeningAnalysisCache items by IDs:', err);
  }
}

export async function deleteOpeningAnalysisCacheByPlayer(playerUsername: string): Promise<number> {
  const clean = playerUsername.trim().toLowerCase();
  if (!clean) return 0;
  try {
    const all = await db.openingAnalysisCache.toArray();
    const matchingIds = all
      .filter((item) => item.playerUsername.trim().toLowerCase() === clean)
      .map((item) => item.id);
    if (matchingIds.length > 0) {
      await db.openingAnalysisCache.bulkDelete(matchingIds);
    }

    const allRep = await db.openingRepertoireCache.toArray();
    const repIds = allRep
      .filter((r) => r.playerIdentifier.trim().toLowerCase() === clean)
      .map((r) => r.id);
    if (repIds.length > 0) {
      await db.openingRepertoireCache.bulkDelete(repIds);
    }

    return matchingIds.length;
  } catch (err) {
    console.error('Failed to delete OpeningAnalysisCache by player:', err);
    return 0;
  }
}

export async function clearAllOpeningRepertoireCaches(): Promise<void> {
  try {
    await Promise.all([
      db.openingAnalysisCache.clear(),
      db.openingRepertoireCache.clear(),
      db.repertoireTaskState.clear(),
    ]);
  } catch (err) {
    console.error('Failed to clear all opening repertoire caches:', err);
  }
}

