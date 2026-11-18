import { create } from 'zustand';
import { EngineLine } from '../types/chess';
import {
  OpeningAnalysisCacheRecord,
  OpeningRepertoireCacheRecord,
  PersistedRepertoireTaskState,
  PlayerCacheBreakdown,
  RepertoireCacheStats,
  RepertoireFilterConfig,
  RepertoireSourceGame,
  SelectionPreviewSummary,
} from '../types/repertoire';
import {
  bulkPutOpeningAnalysisCacheItems,
  clearAllOpeningRepertoireCaches,
  clearPersistedRepertoireTask,
  deleteOpeningAnalysisCacheByIds,
  deleteOpeningAnalysisCacheByPlayer,
  getAllOpeningAnalysisCacheItems,
  getAllOpeningRepertoireCacheItems,
  getPersistedRepertoireTask,
  loadAllSavedGames,
  putOpeningRepertoireCacheItem,
  putPersistedRepertoireTask,
} from '../services/StorageService/db';
import {
  fetchChessComArchives,
  fetchChessComGamesByArchiveUrl,
  fetchChessComProfile,
  mergeAndDeduplicateChessComGames,
  ChessComGameItem,
} from '../services/ChessComApi/chessComService';
import { SAMPLE_MASTER_GAMES } from '../services/PgnService/pgnService';
import {
  convertChessComGamesToSourceGames,
  convertPgnTextToSourceGames,
  convertSavedRecordsToSourceGames,
  filterAndPreviewGames,
  rebindPlayerPerspective,
} from '../core/repertoire/PlayerGameSelectionService';
import {
  aggregateRepertoireRecords,
  buildInstantRepertoireFromSelection,
  evaluateSingleGameOpeningWithStockfish,
  repertoireStockfishClient,
} from '../core/repertoire/RepertoireAnalyzer';
import { REPERTOIRE_ALGORITHM_VERSION } from '../core/repertoire/OpeningAnalyzer';
import { useGameStore } from './useGameStore';
import { useSettingsStore } from './useSettingsStore';
import { getMainlineNodes } from '../core/chess/VariationTree';

const DEFAULT_FILTERS: RepertoireFilterConfig = {
  playerUsername: '',
  periodPreset: 'all',
  selectedMonth: 'all',
  dateFrom: '',
  dateTo: '',
  color: 'all',
  timeClasses: ['bullet', 'blitz', 'rapid', 'classical'],
  excludeIncompletePgn: true,
  cacheMode: 'use_cache',
  manualSelectedGameIds: null,
};

const EMPTY_PREVIEW: SelectionPreviewSummary = {
  totalLoadedPool: 0,
  totalMatching: 0,
  whiteCount: 0,
  blackCount: 0,
  alreadyAnalyzedCount: 0,
  basicCachedCount: 0,
  needsEngineAnalysisCount: 0,
  incompleteOrMissingCount: 0,
};

const EMPTY_CACHE_STATS: RepertoireCacheStats = {
  totalCachedGames: 0,
  engineAnalyzedGames: 0,
  basicCachedGames: 0,
  repertoireSnapshotsCount: 0,
  inMemoryPositionsCount: 0,
  estimatedSizeBytes: 0,
  lastUpdatedAt: null,
  players: [],
};

interface RepertoireStoreState {
  isHydrated: boolean;
  isLoadingSource: boolean;
  sourceError: string | null;
  sourceLabel: string;
  availableMonths: string[];

  pool: RepertoireSourceGame[];
  selectedGames: RepertoireSourceGame[];
  filters: RepertoireFilterConfig;
  preview: SelectionPreviewSummary;

  cacheMap: Map<string, OpeningAnalysisCacheRecord>;
  activeRecords: OpeningAnalysisCacheRecord[];
  aggregated: OpeningRepertoireCacheRecord | null;
  cacheStats: RepertoireCacheStats;

  // Engine batch task state (uses dedicated repertoireStockfishClient, completely independent from main board)
  engineTaskStatus: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
  engineTaskProgress: { processed: number; total: number; currentGameLabel: string };
  hasRecoverableTask: boolean;
  recoverableTaskInfo: PersistedRepertoireTaskState | null;

  // Actions
  hydrateRepertoireStore: () => Promise<void>;
  loadFromSavedAndSampleGames: (preferredUsername?: string) => Promise<void>;
  loadFromChessComUser: (
    username: string,
    maxMonthsToFetch?: number | 'all'
  ) => Promise<void>;
  loadFromCustomPgnText: (pgnText: string, preferredUsername?: string) => Promise<void>;
  updateFilters: (partial: Partial<RepertoireFilterConfig>) => Promise<void>;
  toggleManualGameId: (gameId: string) => Promise<void>;
  selectAllFilteredGames: () => Promise<void>;

  startEngineRepertoireAnalysis: (depth?: number) => Promise<void>;
  pauseEngineAnalysis: () => void;
  resumeEngineAnalysis: () => Promise<void>;
  cancelEngineAnalysis: () => Promise<void>;
  clearSourceError: () => void;

  // Cache Management Actions
  refreshCacheStats: () => Promise<void>;
  clearCacheForCurrentSelection: () => Promise<void>;
  clearCacheForPlayer: (playerUsername: string) => Promise<void>;
  clearEngineEvaluationsOnly: () => Promise<void>;
  clearAllRepertoireCache: () => Promise<void>;
  exportRepertoireCacheJson: () => Promise<string>;
  importRepertoireCacheJson: (jsonText: string) => Promise<{ importedCount: number }>;

  openGameInAnalyzer: (gameId: string, targetPly?: number) => void;
}

let isEngineLoopActive = false;
let pauseRequested = false;
let cancelRequested = false;
const sharedPositionEvalCache = new Map<
  string,
  { bestMove: string; lines: EngineLine[]; cp?: number; mate?: number }
>();

function extractAvailableMonths(games: RepertoireSourceGame[]): string[] {
  const set = new Set<string>();
  for (const g of games) {
    if (g.dateStr && g.dateStr.length >= 7) {
      set.add(g.dateStr.slice(0, 7));
    }
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

async function computeCacheStatsFromStorage(
  cacheMap: Map<string, OpeningAnalysisCacheRecord>
): Promise<RepertoireCacheStats> {
  const items = Array.from(cacheMap.values());
  const snapshots = await getAllOpeningRepertoireCacheItems();

  let engineAnalyzedGames = 0;
  let basicCachedGames = 0;
  let lastUpdatedAt: number | null = null;
  let estimatedSizeBytes = 0;

  const byPlayerMap = new Map<string, PlayerCacheBreakdown>();

  for (const rec of items) {
    const isEngine = rec.status === 'engine_analyzed';
    if (isEngine) engineAnalyzedGames++;
    else if (rec.status === 'basic') basicCachedGames++;

    if (rec.analyzedAt && (lastUpdatedAt === null || rec.analyzedAt > lastUpdatedAt)) {
      lastUpdatedAt = rec.analyzedAt;
    }

    // Approximate serialized size of the record
    estimatedSizeBytes +=
      (rec.pgn?.length || 0) * 2 +
      (rec.openingMoves?.length || 0) * 180 +
      (rec.moveAnalyses?.length || 0) * 320 +
      350;

    const pKey = (rec.playerUsername || 'Неизвестный игрок').trim();
    const pLower = pKey.toLowerCase();
    const existing = byPlayerMap.get(pLower);
    if (existing) {
      existing.totalGames++;
      if (isEngine) existing.engineAnalyzedGames++;
      else existing.basicGames++;
      if (rec.analyzedAt > existing.lastAnalyzedAt) {
        existing.lastAnalyzedAt = rec.analyzedAt;
      }
    } else {
      byPlayerMap.set(pLower, {
        playerUsername: pKey,
        totalGames: 1,
        engineAnalyzedGames: isEngine ? 1 : 0,
        basicGames: isEngine ? 0 : 1,
        lastAnalyzedAt: rec.analyzedAt || 0,
      });
    }
  }

  estimatedSizeBytes += snapshots.length * 4096 + sharedPositionEvalCache.size * 256;

  const players = Array.from(byPlayerMap.values()).sort(
    (a, b) => b.totalGames - a.totalGames
  );

  return {
    totalCachedGames: items.length,
    engineAnalyzedGames,
    basicCachedGames,
    repertoireSnapshotsCount: snapshots.length,
    inMemoryPositionsCount: sharedPositionEvalCache.size,
    estimatedSizeBytes,
    lastUpdatedAt,
    players,
  };
}

export const useRepertoireStore = create<RepertoireStoreState>((set, get) => ({
  isHydrated: false,
  isLoadingSource: false,
  sourceError: null,
  sourceLabel: 'Локальная база партий',
  availableMonths: [],

  pool: [],
  selectedGames: [],
  filters: DEFAULT_FILTERS,
  preview: EMPTY_PREVIEW,

  cacheMap: new Map(),
  activeRecords: [],
  aggregated: null,
  cacheStats: EMPTY_CACHE_STATS,

  engineTaskStatus: 'idle',
  engineTaskProgress: { processed: 0, total: 0, currentGameLabel: '' },
  hasRecoverableTask: false,
  recoverableTaskInfo: null,

  hydrateRepertoireStore: async () => {
    try {
      const cachedItems = await getAllOpeningAnalysisCacheItems();
      const cacheMap = new Map<string, OpeningAnalysisCacheRecord>();
      for (const item of cachedItems) {
        cacheMap.set(item.id, item);
      }

      const persistedTask = await getPersistedRepertoireTask();
      const hasRecoverable = Boolean(
        persistedTask &&
          (persistedTask.status === 'running' || persistedTask.status === 'paused') &&
          persistedTask.pendingGameIds.length > 0
      );

      const cacheStats = await computeCacheStatsFromStorage(cacheMap);

      set({
        isHydrated: true,
        cacheMap,
        cacheStats,
        hasRecoverableTask: hasRecoverable,
        recoverableTaskInfo: hasRecoverable ? persistedTask : null,
        engineTaskStatus: hasRecoverable ? 'paused' : 'idle',
        engineTaskProgress:
          hasRecoverable && persistedTask
            ? {
                processed: persistedTask.processedGames,
                total: persistedTask.totalGames,
                currentGameLabel: 'Приостановленная задача готова к продолжению',
              }
            : { processed: 0, total: 0, currentGameLabel: '' },
      });

      if (get().pool.length === 0) {
        await get().loadFromSavedAndSampleGames(persistedTask?.playerUsername);
      }
    } catch (err) {
      console.error('Failed to hydrate repertoire store:', err);
      set({ isHydrated: true });
    }
  },

  loadFromSavedAndSampleGames: async (preferredUsername) => {
    set({ isLoadingSource: true, sourceError: null });
    try {
      const savedRecords = await loadAllSavedGames();
      const { games: savedSourceGames, inferredUsername } =
        convertSavedRecordsToSourceGames(savedRecords, preferredUsername);

      // Keep main analyzer and repertoire analyses strictly independent:
      // strip any main-board precomputedAnalyses so repertoire analysis manages its own cache
      let combinedGames: RepertoireSourceGame[] = savedSourceGames.map((g) => ({
        ...g,
        precomputedAnalyses: undefined,
      }));

      if (combinedGames.length < 3) {
        const samplePgnJoined = SAMPLE_MASTER_GAMES.map((s) => s.pgn).join('\n\n');
        const { games: sampleGames } = convertPgnTextToSourceGames(
          samplePgnJoined,
          preferredUsername || inferredUsername
        );
        const existingIds = new Set(combinedGames.map((g) => g.id));
        for (const sg of sampleGames) {
          if (!existingIds.has(sg.id)) {
            combinedGames.push(sg);
          }
        }
      }

      const targetUser = preferredUsername?.trim() || inferredUsername || 'Paul Morphy';
      combinedGames = rebindPlayerPerspective(combinedGames, targetUser);

      const nextFilters: RepertoireFilterConfig = {
        ...get().filters,
        playerUsername: targetUser,
        manualSelectedGameIds: null,
      };

      const { selectedGames, preview } = filterAndPreviewGames(
        combinedGames,
        nextFilters,
        get().cacheMap
      );
      const { records, aggregated } = await buildInstantRepertoireFromSelection(
        selectedGames,
        nextFilters,
        get().cacheMap
      );
      const cacheStats = await computeCacheStatsFromStorage(get().cacheMap);

      set({
        isLoadingSource: false,
        sourceLabel: `Локальный архив (${combinedGames.length} партий)`,
        pool: combinedGames,
        availableMonths: extractAvailableMonths(combinedGames),
        filters: nextFilters,
        selectedGames,
        preview,
        activeRecords: records,
        aggregated,
        cacheStats,
      });
    } catch (err) {
      set({
        isLoadingSource: false,
        sourceError:
          err instanceof Error ? err.message : 'Ошибка загрузки локальных партий',
      });
    }
  },

  loadFromChessComUser: async (username, maxMonthsToFetch = 6) => {
    const clean = username.trim();
    if (!clean) {
      set({ sourceError: 'Введите имя пользователя Chess.com' });
      return;
    }

    set({ isLoadingSource: true, sourceError: null });
    try {
      const profile = await fetchChessComProfile(clean, { forceRefresh: true });
      const archives = await fetchChessComArchives(clean, { forceRefresh: true });
      if (archives.length === 0) {
        throw new Error('У данного игрока нет доступных партий на Chess.com');
      }

      const sliceCount =
        maxMonthsToFetch === 'all'
          ? archives.length
          : Math.min(archives.length, maxMonthsToFetch);
      const targetArchives = archives.slice(0, sliceCount);

      let mergedItems: ChessComGameItem[] = [];
      for (let i = 0; i < targetArchives.length; i++) {
        const monthGames = await fetchChessComGamesByArchiveUrl(targetArchives[i], {
          forceRefresh: i === 0,
          isLatestArchive: i === 0,
        });
        mergedItems = mergeAndDeduplicateChessComGames(mergedItems, monthGames);
      }

      const displayUsername = profile.username || clean;
      const sourceGames = convertChessComGamesToSourceGames(mergedItems, displayUsername);

      const nextFilters: RepertoireFilterConfig = {
        ...get().filters,
        playerUsername: displayUsername,
        manualSelectedGameIds: null,
      };

      const { selectedGames, preview } = filterAndPreviewGames(
        sourceGames,
        nextFilters,
        get().cacheMap
      );
      const { records, aggregated } = await buildInstantRepertoireFromSelection(
        selectedGames,
        nextFilters,
        get().cacheMap
      );
      const cacheStats = await computeCacheStatsFromStorage(get().cacheMap);

      set({
        isLoadingSource: false,
        sourceLabel: `Chess.com · ${displayUsername} (${sourceGames.length} партий за ${targetArchives.length} мес.)`,
        pool: sourceGames,
        availableMonths: extractAvailableMonths(sourceGames),
        filters: nextFilters,
        selectedGames,
        preview,
        activeRecords: records,
        aggregated,
        cacheStats,
      });
    } catch (err) {
      set({
        isLoadingSource: false,
        sourceError:
          err instanceof Error
            ? err.message
            : 'Не удалось загрузить партии с Chess.com',
      });
    }
  },

  loadFromCustomPgnText: async (pgnText, preferredUsername) => {
    if (!pgnText.trim()) {
      set({ sourceError: 'Вставьте текст PGN или выберите файл' });
      return;
    }

    set({ isLoadingSource: true, sourceError: null });
    try {
      const { games, inferredUsername } = convertPgnTextToSourceGames(
        pgnText,
        preferredUsername
      );
      if (games.length === 0) {
        throw new Error('Не удалось распознать партии в переданном PGN');
      }

      const nextFilters: RepertoireFilterConfig = {
        ...get().filters,
        playerUsername: inferredUsername,
        manualSelectedGameIds: null,
      };

      const { selectedGames, preview } = filterAndPreviewGames(
        games,
        nextFilters,
        get().cacheMap
      );
      const { records, aggregated } = await buildInstantRepertoireFromSelection(
        selectedGames,
        nextFilters,
        get().cacheMap
      );
      const cacheStats = await computeCacheStatsFromStorage(get().cacheMap);

      set({
        isLoadingSource: false,
        sourceLabel: `Импорт PGN (${games.length} партий · игрок ${inferredUsername})`,
        pool: games,
        availableMonths: extractAvailableMonths(games),
        filters: nextFilters,
        selectedGames,
        preview,
        activeRecords: records,
        aggregated,
        cacheStats,
      });
    } catch (err) {
      set({
        isLoadingSource: false,
        sourceError: err instanceof Error ? err.message : 'Ошибка разбора PGN',
      });
    }
  },

  updateFilters: async (partial) => {
    const prevFilters = get().filters;
    const nextFilters: RepertoireFilterConfig = {
      ...prevFilters,
      ...partial,
    };

    let currentPool = get().pool;
    if (
      partial.playerUsername !== undefined &&
      partial.playerUsername.trim() !== prevFilters.playerUsername.trim() &&
      partial.playerUsername.trim().length > 0
    ) {
      currentPool = rebindPlayerPerspective(currentPool, partial.playerUsername.trim());
    }

    const { selectedGames, preview } = filterAndPreviewGames(
      currentPool,
      nextFilters,
      get().cacheMap
    );

    // Recompute repertoire statistics and trees immediately from cache WITHOUT running Stockfish!
    const { records, aggregated } = await buildInstantRepertoireFromSelection(
      selectedGames,
      nextFilters,
      get().cacheMap
    );
    const cacheStats = await computeCacheStatsFromStorage(get().cacheMap);

    set({
      pool: currentPool,
      filters: nextFilters,
      selectedGames,
      preview,
      activeRecords: records,
      aggregated,
      cacheStats,
    });
  },

  toggleManualGameId: async (gameId) => {
    const { filters, selectedGames } = get();
    const currentList =
      filters.manualSelectedGameIds !== null
        ? [...filters.manualSelectedGameIds]
        : selectedGames.map((g) => g.id);

    const idx = currentList.indexOf(gameId);
    if (idx >= 0) {
      currentList.splice(idx, 1);
    } else {
      currentList.push(gameId);
    }

    await get().updateFilters({ manualSelectedGameIds: currentList });
  },

  selectAllFilteredGames: async () => {
    await get().updateFilters({ manualSelectedGameIds: null });
  },

  startEngineRepertoireAnalysis: async (requestedDepth) => {
    if (isEngineLoopActive) return;

    const { activeRecords, filters, cacheMap, pool } = get();
    const forceReanalyze = filters.cacheMode === 'force_reanalyze';

    const recordsToAnalyze = activeRecords.filter(
      (r) =>
        r.status !== 'error' &&
        (forceReanalyze ||
          r.status !== 'engine_analyzed' ||
          r.algorithmVersion !== REPERTOIRE_ALGORITHM_VERSION)
    );

    if (recordsToAnalyze.length === 0) {
      set({
        engineTaskStatus: 'completed',
        engineTaskProgress: {
          processed: activeRecords.length,
          total: activeRecords.length,
          currentGameLabel: 'Все выбранные партии уже проанализированы в кэше',
        },
      });
      return;
    }

    const settings = useSettingsStore.getState()?.settings;
    const depth = requestedDepth ?? Math.min(14, settings?.engineConfig?.depth || 12);
    const thresholds = settings?.thresholds;

    isEngineLoopActive = true;
    pauseRequested = false;
    cancelRequested = false;

    const totalToProcess = recordsToAnalyze.length;
    const pendingIds = recordsToAnalyze.map((r) => r.id);
    const completedIds: string[] = [];

    set({
      engineTaskStatus: 'running',
      hasRecoverableTask: false,
      recoverableTaskInfo: null,
      sourceError: null,
      engineTaskProgress: {
        processed: 0,
        total: totalToProcess,
        currentGameLabel: `Подготовка изолированного движка Stockfish (глубина ${depth})...`,
      },
    });

    await putPersistedRepertoireTask({
      id: 'active_repertoire_task',
      status: 'running',
      playerUsername: filters.playerUsername,
      totalGames: totalToProcess,
      processedGames: 0,
      pendingGameIds: [...pendingIds],
      completedGameIds: [],
      depth,
      maxOpeningPly: 16,
      updatedAt: Date.now(),
    });

    for (let i = 0; i < recordsToAnalyze.length; i++) {
      if (cancelRequested) {
        isEngineLoopActive = false;
        repertoireStockfishClient.stop();
        await clearPersistedRepertoireTask();
        set({
          engineTaskStatus: 'cancelled',
          engineTaskProgress: {
            processed: i,
            total: totalToProcess,
            currentGameLabel: 'Анализ отменён пользователем',
          },
        });
        return;
      }

      if (pauseRequested) {
        isEngineLoopActive = false;
        repertoireStockfishClient.stop();
        const pausedTask: PersistedRepertoireTaskState = {
          id: 'active_repertoire_task',
          status: 'paused',
          playerUsername: filters.playerUsername,
          totalGames: totalToProcess,
          processedGames: i,
          pendingGameIds: pendingIds.slice(i),
          completedGameIds: [...completedIds],
          depth,
          maxOpeningPly: 16,
          updatedAt: Date.now(),
        };
        await putPersistedRepertoireTask(pausedTask);
        set({
          engineTaskStatus: 'paused',
          hasRecoverableTask: true,
          recoverableTaskInfo: pausedTask,
          engineTaskProgress: {
            processed: i,
            total: totalToProcess,
            currentGameLabel: 'Анализ приостановлен (результаты сохранены в кэш)',
          },
        });
        return;
      }

      const rec = recordsToAnalyze[i];
      const label = `${rec.whiteName} vs ${rec.blackName} (${rec.eco})`;

      set({
        engineTaskProgress: {
          processed: i,
          total: totalToProcess,
          currentGameLabel: label,
        },
      });

      try {
        const updatedRecord = await evaluateSingleGameOpeningWithStockfish(rec, {
          depth,
          maxOpeningPly: 16,
          thresholds,
          positionEvalCache: sharedPositionEvalCache,
          shouldAbort: () => pauseRequested || cancelRequested,
        });

        cacheMap.set(updatedRecord.id, updatedRecord);
        completedIds.push(updatedRecord.id);

        // Update activeRecords and aggregated statistics live as each game finishes!
        const latestActive = get().activeRecords.map((item) =>
          item.id === updatedRecord.id ? updatedRecord : item
        );
        const { preview } = filterAndPreviewGames(pool, get().filters, cacheMap);
        const aggregated = aggregateRepertoireRecords(latestActive, get().filters);
        const cacheStats = await computeCacheStatsFromStorage(cacheMap);

        set({
          activeRecords: latestActive,
          preview,
          aggregated,
          cacheStats,
          engineTaskProgress: {
            processed: i + 1,
            total: totalToProcess,
            currentGameLabel: label,
          },
        });

        await putPersistedRepertoireTask({
          id: 'active_repertoire_task',
          status: 'running',
          playerUsername: get().filters.playerUsername,
          totalGames: totalToProcess,
          processedGames: i + 1,
          pendingGameIds: pendingIds.slice(i + 1),
          completedGameIds: [...completedIds],
          depth,
          maxOpeningPly: 16,
          updatedAt: Date.now(),
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'REPERTOIRE_ABORTED') {
          i--;
          continue;
        }
        console.warn(`Skipping game ${rec.gameId} due to evaluation error:`, err);
      }
    }

    isEngineLoopActive = false;
    const finalAggregated = get().aggregated;
    if (finalAggregated) {
      await putOpeningRepertoireCacheItem(finalAggregated);
    }
    await clearPersistedRepertoireTask();
    const finalCacheStats = await computeCacheStatsFromStorage(cacheMap);

    set({
      engineTaskStatus: 'completed',
      hasRecoverableTask: false,
      recoverableTaskInfo: null,
      cacheStats: finalCacheStats,
      engineTaskProgress: {
        processed: totalToProcess,
        total: totalToProcess,
        currentGameLabel: 'Анализ дебютного репертуара завершён',
      },
    });
  },

  pauseEngineAnalysis: () => {
    if (!isEngineLoopActive) return;
    pauseRequested = true;
    repertoireStockfishClient.stop();
  },

  resumeEngineAnalysis: async () => {
    const { recoverableTaskInfo } = get();
    await get().startEngineRepertoireAnalysis(recoverableTaskInfo?.depth);
  },

  cancelEngineAnalysis: async () => {
    cancelRequested = true;
    pauseRequested = false;
    repertoireStockfishClient.stop();
    await clearPersistedRepertoireTask();
    set({
      engineTaskStatus: 'cancelled',
      hasRecoverableTask: false,
      recoverableTaskInfo: null,
    });
  },

  clearSourceError: () => set({ sourceError: null }),

  // ==========================================================================
  // Cache Management Actions
  // ==========================================================================

  refreshCacheStats: async () => {
    const cacheStats = await computeCacheStatsFromStorage(get().cacheMap);
    set({ cacheStats });
  },

  clearCacheForCurrentSelection: async () => {
    if (isEngineLoopActive) {
      get().cancelEngineAnalysis();
    }
    const { selectedGames, cacheMap, pool, filters } = get();
    const idsToDelete: string[] = [];
    for (const g of selectedGames) {
      const key = `${g.id}_${g.playerColor}`;
      if (cacheMap.has(key)) {
        cacheMap.delete(key);
        idsToDelete.push(key);
      }
    }
    await deleteOpeningAnalysisCacheByIds(idsToDelete);

    const { selectedGames: nextSelected, preview } = filterAndPreviewGames(
      pool,
      filters,
      cacheMap
    );
    const { records, aggregated } = await buildInstantRepertoireFromSelection(
      nextSelected,
      filters,
      cacheMap
    );
    const cacheStats = await computeCacheStatsFromStorage(cacheMap);

    set({
      selectedGames: nextSelected,
      preview,
      activeRecords: records,
      aggregated,
      cacheStats,
      engineTaskStatus: 'idle',
    });
  },

  clearCacheForPlayer: async (playerUsername: string) => {
    if (isEngineLoopActive) {
      get().cancelEngineAnalysis();
    }
    const clean = playerUsername.trim().toLowerCase();
    if (!clean) return;

    const { cacheMap, pool, filters } = get();
    for (const [k, rec] of Array.from(cacheMap.entries())) {
      if (rec.playerUsername.trim().toLowerCase() === clean) {
        cacheMap.delete(k);
      }
    }
    await deleteOpeningAnalysisCacheByPlayer(playerUsername);

    const { selectedGames, preview } = filterAndPreviewGames(pool, filters, cacheMap);
    const { records, aggregated } = await buildInstantRepertoireFromSelection(
      selectedGames,
      filters,
      cacheMap
    );
    const cacheStats = await computeCacheStatsFromStorage(cacheMap);

    set({
      selectedGames,
      preview,
      activeRecords: records,
      aggregated,
      cacheStats,
      engineTaskStatus: 'idle',
    });
  },

  clearEngineEvaluationsOnly: async () => {
    if (isEngineLoopActive) {
      get().cancelEngineAnalysis();
    }
    sharedPositionEvalCache.clear();
    const { cacheMap, pool, filters } = get();
    const downgradedRecords: OpeningAnalysisCacheRecord[] = [];

    for (const [k, rec] of cacheMap.entries()) {
      if (rec.status === 'engine_analyzed' || rec.moveAnalyses) {
        const downgraded: OpeningAnalysisCacheRecord = {
          ...rec,
          moveAnalyses: undefined,
          playerAccuracy: undefined,
          playerAvgCpl: undefined,
          status: 'basic',
          analyzedAt: Date.now(),
        };
        cacheMap.set(k, downgraded);
        downgradedRecords.push(downgraded);
      }
    }

    if (downgradedRecords.length > 0) {
      await bulkPutOpeningAnalysisCacheItems(downgradedRecords);
    }
    await clearPersistedRepertoireTask();

    const { selectedGames, preview } = filterAndPreviewGames(pool, filters, cacheMap);
    const { records, aggregated } = await buildInstantRepertoireFromSelection(
      selectedGames,
      filters,
      cacheMap
    );
    const cacheStats = await computeCacheStatsFromStorage(cacheMap);

    set({
      selectedGames,
      preview,
      activeRecords: records,
      aggregated,
      cacheStats,
      engineTaskStatus: 'idle',
      hasRecoverableTask: false,
      recoverableTaskInfo: null,
    });
  },

  clearAllRepertoireCache: async () => {
    if (isEngineLoopActive) {
      await get().cancelEngineAnalysis();
    }
    sharedPositionEvalCache.clear();
    const cacheMap = new Map<string, OpeningAnalysisCacheRecord>();
    await clearAllOpeningRepertoireCaches();

    const { pool, filters } = get();
    const { selectedGames, preview } = filterAndPreviewGames(pool, filters, cacheMap);
    const { records, aggregated } = await buildInstantRepertoireFromSelection(
      selectedGames,
      filters,
      cacheMap
    );
    const cacheStats = await computeCacheStatsFromStorage(cacheMap);

    set({
      cacheMap,
      selectedGames,
      preview,
      activeRecords: records,
      aggregated,
      cacheStats,
      engineTaskStatus: 'idle',
      hasRecoverableTask: false,
      recoverableTaskInfo: null,
    });
  },

  exportRepertoireCacheJson: async () => {
    const items = Array.from(get().cacheMap.values());
    const payload = {
      version: REPERTOIRE_ALGORITHM_VERSION,
      exportedAt: new Date().toISOString(),
      recordsCount: items.length,
      records: items,
    };
    return JSON.stringify(payload, null, 2);
  },

  importRepertoireCacheJson: async (jsonText: string) => {
    const parsed = JSON.parse(jsonText);
    const recordsList: OpeningAnalysisCacheRecord[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.records)
      ? parsed.records
      : [];

    if (recordsList.length === 0) {
      throw new Error('В выбранном JSON-файле не найдено записей кэша репертуара');
    }

    const validRecords = recordsList.filter(
      (r) => r && typeof r.id === 'string' && typeof r.gameId === 'string' && typeof r.pgn === 'string'
    );

    if (validRecords.length === 0) {
      throw new Error('Формат записей кэша в JSON не распознан');
    }

    const { cacheMap, pool, filters } = get();
    for (const r of validRecords) {
      cacheMap.set(r.id, r);
    }
    await bulkPutOpeningAnalysisCacheItems(validRecords);

    const { selectedGames, preview } = filterAndPreviewGames(pool, filters, cacheMap);
    const { records, aggregated } = await buildInstantRepertoireFromSelection(
      selectedGames,
      filters,
      cacheMap
    );
    const cacheStats = await computeCacheStatsFromStorage(cacheMap);

    set({
      selectedGames,
      preview,
      activeRecords: records,
      aggregated,
      cacheStats,
    });

    return { importedCount: validRecords.length };
  },

  /**
   * Opens a game from the repertoire in the main analyzer at `targetPly`.
   * Strictly decoupled from the repertoire's internal moveAnalyses:
   * loads only the clean PGN and selects the requested move node so no repertoire
   * analysis arrows or partial evaluations leak into the main board analyzer.
   */
  openGameInAnalyzer: (gameId, targetPly) => {
    const { pool, activeRecords } = get();
    const record = activeRecords.find((r) => r.gameId === gameId);
    const sourceGame = pool.find((g) => g.id === gameId);
    const pgn = record?.pgn || sourceGame?.pgn;
    if (!pgn) return;

    const gameStore = useGameStore.getState();
    gameStore.loadPgnGame(
      pgn,
      sourceGame?.source === 'chesscom' ? 'Chess.com' : 'PGN'
    );

    if (record?.playerColor) {
      useSettingsStore.getState().updateSettings({
        boardOrientation: record.playerColor === 'b' ? 'black' : 'white',
      });
    }

    if (targetPly !== undefined && targetPly > 0) {
      const mainline = getMainlineNodes(useGameStore.getState().rootNode);
      const targetNode = mainline.find((n) => n.ply === targetPly);
      if (targetNode) {
        useGameStore.getState().selectNode(targetNode.id);
      }
    }
  },
}));
