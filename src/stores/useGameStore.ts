import { create } from 'zustand';
import { Chess, Square } from 'chess.js';
import {
  ClassificationThresholds,
  GameMetadata,
  GameStatistics,
  MoveNode,
  OpeningAnalysisSummary,
  SavedGameRecord,
} from '../types/chess';
import {
  addMoveToTree,
  DEFAULT_START_FEN,
  deleteVariationNode,
  exportTreeToPgn,
  findNodeById,
  getMainlineNodes,
  getPathToNode,
} from '../core/chess/VariationTree';
import { openingBook } from '../core/chess/OpeningBook';
import {
  DEFAULT_THRESHOLDS,
  getAllTreeNodes,
  moveAnalyzer,
  reclassifyMoveAnalyses,
} from '../core/analysis/MoveAnalyzer';
import { calculateGameStatistics } from '../core/analysis/AccuracyCalculator';
import { stockfishClient } from '../core/engine/StockfishClient';
import { useSettingsStore } from './useSettingsStore';
import {
  createNewEmptyGame,
  createTreeFromFen,
  parsePgnToTree,
  SAMPLE_MASTER_GAMES,
} from '../services/PgnService/pgnService';
import {
  deleteSavedGame,
  loadAllSavedGames,
  saveGameToIndexedDB,
} from '../services/StorageService/db';

interface GameStoreState {
  gameId: string;
  metadata: GameMetadata;
  initialFen: string;
  rootNode: MoveNode;
  currentNodeId: string;
  openingSummary: OpeningAnalysisSummary;
  statistics: GameStatistics | null;
  savedGames: SavedGameRecord[];
  isBatchAnalyzing: boolean;
  batchProgress: { current: number; total: number };
  isAutoPlaying: boolean;
  errorMessage: string | null;

  // Actions
  startNewGame: () => void;
  loadPgnGame: (
    pgn: string,
    platform?: GameMetadata['platform'],
    extraTitles?: { whiteTitle?: string; blackTitle?: string }
  ) => void;
  loadFenPosition: (fen: string) => void;
  loadSavedGameRecord: (record: SavedGameRecord) => void;
  refreshSavedGames: () => Promise<void>;
  removeSavedGame: (id: string) => Promise<void>;
  selectNode: (nodeId: string) => void;
  goToStart: () => void;
  goToPrev: () => void;
  goToNext: () => void;
  goToEnd: () => void;
  returnToMainline: () => void;
  makeMove: (move: { from: Square; to: Square; promotion?: string } | string) => boolean;
  deleteVariation: (nodeId: string) => void;
  toggleUserArrow: (
    from: Square,
    to: Square,
    color: string,
    width: number,
    opacity: number
  ) => void;
  removeUserArrow: (arrowId: string) => void;
  toggleSquareHighlight: (square: Square, color: string) => void;
  clearNodeAnnotations: () => void;
  runFullGameAnalysis: (depth: number, thresholds: ClassificationThresholds) => Promise<void>;
  cancelFullGameAnalysis: () => void;
  recalculateWithThresholds: (thresholds: ClassificationThresholds) => void;
  setAutoPlaying: (playing: boolean) => void;
  clearError: () => void;
  getExportPgn: () => string;
  persistCurrentGame: () => Promise<void>;
}

function computeOpeningForContext(root: MoveNode, currentNodeId: string): OpeningAnalysisSummary {
  if (currentNodeId !== 'root') {
    const activePath = getPathToNode(root, currentNodeId);
    if (activePath.length > 1) {
      return openingBook.analyzeMainlineOpening(activePath);
    }
  }
  const mainline = getMainlineNodes(root);
  return openingBook.analyzeMainlineOpening(mainline);
}

const initialParsed = parsePgnToTree(SAMPLE_MASTER_GAMES[0].pgn, 'PGN');
const initialMainline = getMainlineNodes(initialParsed.root);
const initialOpeningSummary = openingBook.analyzeMainlineOpening(initialMainline);

export const useGameStore = create<GameStoreState>((set, get) => ({
  gameId: initialParsed.metadata.id,
  metadata: initialParsed.metadata,
  initialFen: initialParsed.initialFen,
  rootNode: initialParsed.root,
  currentNodeId: initialParsed.root.id,
  openingSummary: initialOpeningSummary,
  statistics: null,
  savedGames: [],
  isBatchAnalyzing: false,
  batchProgress: { current: 0, total: 0 },
  isAutoPlaying: false,
  errorMessage: null,

  startNewGame: () => {
    moveAnalyzer.cancelBatchAnalysis();
    const parsed = createNewEmptyGame();
    const mainline = getMainlineNodes(parsed.root);
    const openingSummary = openingBook.analyzeMainlineOpening(mainline);

    set({
      gameId: parsed.metadata.id,
      metadata: parsed.metadata,
      initialFen: parsed.initialFen,
      rootNode: parsed.root,
      currentNodeId: parsed.root.id,
      openingSummary,
      statistics: null,
      isBatchAnalyzing: false,
      batchProgress: { current: 0, total: 0 },
      isAutoPlaying: false,
      errorMessage: null,
    });

    get().persistCurrentGame().catch(console.error);
  },

  loadPgnGame: (pgn, platform, extraTitles) => {
    try {
      moveAnalyzer.cancelBatchAnalysis();
      const parsed = parsePgnToTree(pgn, platform, extraTitles);
      const mainline = getMainlineNodes(parsed.root);
      const openingSummary = openingBook.analyzeMainlineOpening(mainline);

      // Preserve existing statistics if this exact game was already analyzed in local archive
      const existingSaved = get().savedGames.find((g) => g.id === parsed.metadata.id);

      set({
        gameId: parsed.metadata.id,
        metadata: {
          ...parsed.metadata,
          eco: openingSummary.eco,
          openingName: `${openingSummary.name}: ${openingSummary.variation}`,
        },
        initialFen: parsed.initialFen,
        rootNode: parsed.root,
        currentNodeId: parsed.root.id,
        openingSummary,
        statistics: existingSaved?.statistics || null,
        isBatchAnalyzing: false,
        batchProgress: { current: 0, total: 0 },
        isAutoPlaying: false,
        errorMessage: null,
      });

      get().persistCurrentGame().catch(console.error);
    } catch (err) {
      set({
        errorMessage: err instanceof Error ? err.message : 'Не удалось загрузить PGN',
      });
    }
  },

  loadFenPosition: (fen) => {
    try {
      moveAnalyzer.cancelBatchAnalysis();
      const parsed = createTreeFromFen(fen);
      const mainline = getMainlineNodes(parsed.root);
      const openingSummary = openingBook.analyzeMainlineOpening(mainline);

      set({
        gameId: parsed.metadata.id,
        metadata: parsed.metadata,
        initialFen: parsed.initialFen,
        rootNode: parsed.root,
        currentNodeId: parsed.root.id,
        openingSummary,
        statistics: null,
        isBatchAnalyzing: false,
        batchProgress: { current: 0, total: 0 },
        isAutoPlaying: false,
        errorMessage: null,
      });

      get().persistCurrentGame().catch(console.error);
    } catch (err) {
      set({
        errorMessage: err instanceof Error ? err.message : 'Некорректная строка FEN',
      });
    }
  },

  loadSavedGameRecord: (record) => {
    try {
      moveAnalyzer.cancelBatchAnalysis();
      const restoredRoot: MoveNode = JSON.parse(record.serializedTree);
      const mainline = getMainlineNodes(restoredRoot);
      const openingSummary = openingBook.analyzeMainlineOpening(mainline);

      set({
        gameId: record.id,
        metadata: record.metadata,
        initialFen: record.initialFen || DEFAULT_START_FEN,
        rootNode: restoredRoot,
        currentNodeId: restoredRoot.id,
        openingSummary,
        statistics: record.statistics || null,
        isBatchAnalyzing: false,
        batchProgress: { current: 0, total: 0 },
        isAutoPlaying: false,
        errorMessage: null,
      });
    } catch (err) {
      set({
        errorMessage:
          err instanceof Error ? err.message : 'Ошибка восстановления сохранённой партии',
      });
    }
  },

  refreshSavedGames: async () => {
    try {
      const list = await loadAllSavedGames();
      set({ savedGames: list });
    } catch (err) {
      console.error('Failed to refresh saved games:', err);
    }
  },

  removeSavedGame: async (id: string) => {
    await deleteSavedGame(id);
    const list = await loadAllSavedGames();
    set({ savedGames: list });
  },

  selectNode: (nodeId) => {
    const { rootNode } = get();
    const found = findNodeById(rootNode, nodeId);
    if (found) {
      const openingSummary = computeOpeningForContext(rootNode, found.id);
      set({ currentNodeId: found.id, openingSummary });
    }
  },

  goToStart: () => {
    const { rootNode } = get();
    const openingSummary = computeOpeningForContext(rootNode, rootNode.id);
    set({ currentNodeId: rootNode.id, openingSummary, isAutoPlaying: false });
  },

  goToPrev: () => {
    const { rootNode, currentNodeId } = get();
    const current = findNodeById(rootNode, currentNodeId);
    if (current && current.parentId) {
      const openingSummary = computeOpeningForContext(rootNode, current.parentId);
      set({ currentNodeId: current.parentId, openingSummary });
    }
  },

  goToNext: () => {
    const { rootNode, currentNodeId } = get();
    const current = findNodeById(rootNode, currentNodeId);
    if (current && current.children.length > 0) {
      const nextId = current.children[0].id;
      const openingSummary = computeOpeningForContext(rootNode, nextId);
      set({ currentNodeId: nextId, openingSummary });
    } else {
      set({ isAutoPlaying: false });
    }
  },

  goToEnd: () => {
    const { rootNode, currentNodeId } = get();
    let current = findNodeById(rootNode, currentNodeId) || rootNode;
    while (current.children.length > 0) {
      current = current.children[0];
    }
    const openingSummary = computeOpeningForContext(rootNode, current.id);
    set({ currentNodeId: current.id, openingSummary, isAutoPlaying: false });
  },

  returnToMainline: () => {
    const { rootNode, currentNodeId } = get();
    let current = findNodeById(rootNode, currentNodeId);
    while (current && !current.isMainline && current.parentId) {
      current = findNodeById(rootNode, current.parentId);
    }
    if (current) {
      const openingSummary = computeOpeningForContext(rootNode, current.id);
      set({ currentNodeId: current.id, openingSummary });
    }
  },

  makeMove: (moveInput) => {
    const { rootNode, currentNodeId, isBatchAnalyzing, metadata } = get();
    const { updatedRoot, newNode, error } = addMoveToTree(rootNode, currentNodeId, moveInput);
    if (!newNode || error) {
      return false;
    }

    const openingSummary = computeOpeningForContext(updatedRoot, newNode.id);

    // Check if the newly played move on the mainline finishes the game (checkmate/draw)
    let updatedMetadata = {
      ...metadata,
      eco: openingSummary.eco,
      openingName: `${openingSummary.name}: ${openingSummary.variation}`,
    };

    if (newNode.isMainline) {
      try {
        const positionCheck = new Chess(newNode.fen);
        if (positionCheck.isCheckmate()) {
          updatedMetadata = {
            ...updatedMetadata,
            result: newNode.color === 'w' ? '1-0' : '0-1',
          };
        } else if (
          positionCheck.isDraw() ||
          positionCheck.isStalemate() ||
          positionCheck.isThreefoldRepetition() ||
          positionCheck.isInsufficientMaterial()
        ) {
          updatedMetadata = {
            ...updatedMetadata,
            result: '1/2-1/2',
          };
        }
      } catch {
        // Ignore invalid FEN edge case
      }
    }

    set({
      rootNode: updatedRoot,
      currentNodeId: newNode.id,
      openingSummary,
      metadata: updatedMetadata,
      errorMessage: null,
    });

    // Automatically evaluate any newly played move (including variations outside the main game!)
    if (!newNode.analysis && !isBatchAnalyzing && newNode.parentId) {
      const parentNode = findNodeById(updatedRoot, newNode.parentId);
      if (parentNode) {
        const settingsState = useSettingsStore.getState()?.settings;
        const thresholds = settingsState?.thresholds || DEFAULT_THRESHOLDS;
        const singleMoveDepth = settingsState?.engineConfig?.depth ?? 14;
        const targetNodeId = newNode.id;

        moveAnalyzer
          .evaluateSingleMoveNode(parentNode, newNode, singleMoveDepth, thresholds)
          .then((moveAnalysis) => {
            const latestState = get();
            if (latestState.isBatchAnalyzing) return;
            const clonedRoot = structuredClone(latestState.rootNode);
            const targetInTree = findNodeById(clonedRoot, targetNodeId);
            if (!targetInTree) return;

            targetInTree.analysis = moveAnalysis;

            // Update mainline statistics if mainline has analyses
            const mainline = getMainlineNodes(clonedRoot);
            const mainlineAnalyses = mainline.map((n) => n.analysis!).filter(Boolean);
            const updatedStats =
              mainlineAnalyses.length > 0
                ? calculateGameStatistics(mainlineAnalyses)
                : latestState.statistics;

            set({
              rootNode: clonedRoot,
              statistics: updatedStats,
            });

            // Resume live interactive MultiPV search on the currently active board position
            const activeNode = findNodeById(clonedRoot, get().currentNodeId);
            if (activeNode) {
              const cfg = useSettingsStore.getState()?.settings?.engineConfig;
              stockfishClient.analyzePosition(
                activeNode.fen,
                cfg?.depth ?? 14,
                cfg?.movetimeMs ?? 0
              );
            }

            get().persistCurrentGame().catch(console.error);
          })
          .catch((err) => {
            console.error('Background single-move evaluation failed:', err);
          });
      }
    }

    get().persistCurrentGame().catch(console.error);
    return true;
  },

  deleteVariation: (nodeId) => {
    const { rootNode, currentNodeId } = get();
    const target = findNodeById(rootNode, nodeId);
    if (!target || target.id === 'root') return;
    const parentId = target.parentId || 'root';
    const updatedRoot = deleteVariationNode(rootNode, nodeId);
    const stillExists = findNodeById(updatedRoot, currentNodeId);
    const nextNodeId = stillExists ? currentNodeId : parentId;
    const openingSummary = computeOpeningForContext(updatedRoot, nextNodeId);

    set({
      rootNode: updatedRoot,
      currentNodeId: nextNodeId,
      openingSummary,
    });
    get().persistCurrentGame().catch(console.error);
  },

  toggleUserArrow: (from, to, color, width, opacity) => {
    if (from === to) return;
    const { rootNode, currentNodeId } = get();
    const cloned = structuredClone(rootNode);
    const current = findNodeById(cloned, currentNodeId);
    if (!current) return;

    const existingIdx = current.userArrows.findIndex(
      (a) => a.from === from && a.to === to && a.color === color
    );
    if (existingIdx !== -1) {
      current.userArrows.splice(existingIdx, 1);
    } else {
      current.userArrows = current.userArrows.filter((a) => !(a.from === from && a.to === to));
      current.userArrows.push({
        id: `arrow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        from,
        to,
        color,
        width,
        opacity,
      });
    }

    set({ rootNode: cloned });
    get().persistCurrentGame().catch(console.error);
  },

  removeUserArrow: (arrowId) => {
    const { rootNode, currentNodeId } = get();
    const cloned = structuredClone(rootNode);
    const current = findNodeById(cloned, currentNodeId);
    if (!current) return;
    current.userArrows = current.userArrows.filter((a) => a.id !== arrowId);
    set({ rootNode: cloned });
    get().persistCurrentGame().catch(console.error);
  },

  toggleSquareHighlight: (square, color) => {
    const { rootNode, currentNodeId } = get();
    const cloned = structuredClone(rootNode);
    const current = findNodeById(cloned, currentNodeId);
    if (!current) return;

    const existingIdx = current.squareHighlights.findIndex((h) => h.square === square);
    if (existingIdx !== -1) {
      if (current.squareHighlights[existingIdx].color === color) {
        current.squareHighlights.splice(existingIdx, 1);
      } else {
        current.squareHighlights[existingIdx].color = color;
      }
    } else {
      current.squareHighlights.push({ square, color });
    }

    set({ rootNode: cloned });
    get().persistCurrentGame().catch(console.error);
  },

  clearNodeAnnotations: () => {
    const { rootNode, currentNodeId } = get();
    const cloned = structuredClone(rootNode);
    const current = findNodeById(cloned, currentNodeId);
    if (!current) return;
    current.userArrows = [];
    current.squareHighlights = [];
    set({ rootNode: cloned });
    get().persistCurrentGame().catch(console.error);
  },

  runFullGameAnalysis: async (depth, thresholds) => {
    const { rootNode } = get();
    const clonedRoot = structuredClone(rootNode);
    const allNodes = getAllTreeNodes(clonedRoot).filter((n) => n.ply > 0);

    if (allNodes.length === 0) {
      set({ errorMessage: 'Нет ходов для анализа. Сделайте ходы или загрузите партию.' });
      return;
    }

    // Start from the initial position so pieces visibly animate move-by-move during analysis
    set({
      isBatchAnalyzing: true,
      currentNodeId: clonedRoot.id,
      batchProgress: { current: 0, total: allNodes.length },
      errorMessage: null,
    });

    try {
      const analyses = await moveAnalyzer.analyzeGameNodes(clonedRoot, {
        depth,
        thresholds,
        onProgress: (completed, total, analyzedNodeId) => {
          const mainline = getMainlineNodes(clonedRoot);
          const partialAnalyses = mainline.map((n) => n.analysis!).filter(Boolean);
          const partialStats =
            partialAnalyses.length > 0 ? calculateGameStatistics(partialAnalyses) : null;
          const openingSummary = computeOpeningForContext(clonedRoot, analyzedNodeId);
          set({
            batchProgress: { current: completed, total },
            rootNode: structuredClone(clonedRoot),
            currentNodeId: analyzedNodeId,
            openingSummary,
            statistics: partialStats,
          });
        },
      });

      const finalActiveId = get().currentNodeId;
      const openingSummary = computeOpeningForContext(clonedRoot, finalActiveId);
      const statistics = calculateGameStatistics(analyses);

      set({
        rootNode: clonedRoot,
        openingSummary,
        statistics,
        isBatchAnalyzing: false,
      });

      // Restart interactive analysis for current position
      const activeNode = findNodeById(clonedRoot, get().currentNodeId);
      if (activeNode) {
        const cfg = useSettingsStore.getState()?.settings?.engineConfig;
        stockfishClient.analyzePosition(activeNode.fen, cfg?.depth ?? 14, cfg?.movetimeMs ?? 0);
      }

      await get().persistCurrentGame();
    } catch (err) {
      if (err instanceof Error && err.message === 'Анализ отменён') {
        set({ isBatchAnalyzing: false });
        return;
      }
      set({
        isBatchAnalyzing: false,
        errorMessage: err instanceof Error ? err.message : 'Ошибка при анализе партии',
      });
    }
  },

  cancelFullGameAnalysis: () => {
    moveAnalyzer.cancelBatchAnalysis();
    set({ isBatchAnalyzing: false });
  },

  recalculateWithThresholds: (thresholds) => {
    const { rootNode, currentNodeId } = get();
    const clonedRoot = structuredClone(rootNode);
    const allNodes = getAllTreeNodes(clonedRoot);
    const analyzedNodes = allNodes.filter((n) => Boolean(n.analysis));
    if (analyzedNodes.length === 0) return;

    reclassifyMoveAnalyses(allNodes, thresholds);
    const mainline = getMainlineNodes(clonedRoot);
    const openingSummary = computeOpeningForContext(clonedRoot, currentNodeId);
    const analyses = mainline.map((n) => n.analysis!).filter(Boolean);
    const statistics = calculateGameStatistics(analyses);

    set({
      rootNode: clonedRoot,
      openingSummary,
      statistics,
    });
    get().persistCurrentGame().catch(console.error);
  },

  setAutoPlaying: (playing) => set({ isAutoPlaying: playing }),

  clearError: () => set({ errorMessage: null }),

  getExportPgn: () => {
    const { rootNode, metadata, openingSummary } = get();
    return exportTreeToPgn(rootNode, {
      Event: metadata.event || 'Chess Analyzer Review',
      Site: metadata.site || 'Chess Analyzer',
      Date: metadata.date,
      White: metadata.whiteName,
      Black: metadata.blackName,
      WhiteElo: metadata.whiteRating ? String(metadata.whiteRating) : '',
      BlackElo: metadata.blackRating ? String(metadata.blackRating) : '',
      Result: metadata.result,
      ECO: openingSummary.eco,
      Opening: `${openingSummary.name}: ${openingSummary.variation}`,
    });
  },

  persistCurrentGame: async () => {
    const { gameId, metadata, initialFen, rootNode, statistics, openingSummary } = get();
    const pgn = get().getExportPgn();
    const record: SavedGameRecord = {
      id: gameId,
      metadata,
      pgn,
      initialFen,
      serializedTree: JSON.stringify(rootNode),
      statistics: statistics || undefined,
      openingSummary,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveGameToIndexedDB(record);
    const updatedList = await loadAllSavedGames();
    set({ savedGames: updatedList });
  },
}));
