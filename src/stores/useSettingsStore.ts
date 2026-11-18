import { create } from 'zustand';
import { AppSettings, ClassificationThresholds, EngineConfig } from '../types/chess';
import { DEFAULT_THRESHOLDS } from '../core/analysis/MoveAnalyzer';
import { loadSettingsFromIndexedDB, saveSettingsToIndexedDB } from '../services/StorageService/db';
import { stockfishClient } from '../core/engine/StockfishClient';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'ru',
  boardSize: 'auto',
  boardOrientation: 'white',
  lightSquareColor: '#EEEED2',
  darkSquareColor: '#769656',
  pieceSet: 'neo',
  enableAnimations: true,
  highlightLastMove: true,
  highlightLegalMoves: true,
  showCoordinates: true,
  showEvalBar: true,
  showLeftSidebar: true,
  showUserArrows: true,
  showEngineArrows: true,
  userArrowColor: '#F39C36',
  engineArrowColor: '#F39C36',
  secondaryEngineArrowColor: '#36A9E1',
  arrowWidth: 22,
  arrowOpacity: 0.6,
  engineConfig: {
    depth: 14,
    maxDepth: 30,
    movetimeMs: 0,
    multiPv: 3,
    hashMb: 16,
    threads: 1,
    ponder: false,
  },
  thresholds: { ...DEFAULT_THRESHOLDS },
};

interface SettingsStoreState {
  settings: AppSettings;
  activeBrushColor: string;
  updateSettings: (partial: Partial<AppSettings>) => void;
  updateEngineConfig: (partial: Partial<EngineConfig>) => void;
  updateThresholds: (partial: Partial<ClassificationThresholds>) => void;
  setActiveBrushColor: (color: string) => void;
  flipBoard: () => void;
  toggleTheme: () => void;
  resetSettings: () => void;
  hydrateFromStorage: () => Promise<void>;
}

function syncDomWithSettings(settings: AppSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (settings.theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.style.setProperty('--chess-square-light', settings.lightSquareColor);
  root.style.setProperty('--chess-square-dark', settings.darkSquareColor);
  root.style.setProperty('--chess-arrow-orange', settings.userArrowColor);
  root.style.setProperty('--chess-arrow-blue', settings.secondaryEngineArrowColor);
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: DEFAULT_APP_SETTINGS,
  activeBrushColor: '#F39C36',

  updateSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    syncDomWithSettings(next);
    saveSettingsToIndexedDB(next).catch(console.error);
  },

  updateEngineConfig: (partial) => {
    const current = get().settings;
    const nextEngine = { ...current.engineConfig, ...partial };
    const next = { ...current, engineConfig: nextEngine };
    stockfishClient.updateConfig(nextEngine);
    set({ settings: next });
    saveSettingsToIndexedDB(next).catch(console.error);
  },

  updateThresholds: (partial) => {
    const current = get().settings;
    const nextThresholds = { ...current.thresholds, ...partial };
    const next = { ...current, thresholds: nextThresholds };
    set({ settings: next });
    saveSettingsToIndexedDB(next).catch(console.error);
  },

  setActiveBrushColor: (color) => set({ activeBrushColor: color }),

  flipBoard: () => {
    const current = get().settings;
    const nextOrientation = current.boardOrientation === 'white' ? 'black' : 'white';
    get().updateSettings({ boardOrientation: nextOrientation });
  },

  toggleTheme: () => {
    const current = get().settings;
    const nextTheme = current.theme === 'light' ? 'dark' : 'light';
    get().updateSettings({ theme: nextTheme });
  },

  resetSettings: () => {
    stockfishClient.updateConfig(DEFAULT_APP_SETTINGS.engineConfig);
    set({ settings: DEFAULT_APP_SETTINGS, activeBrushColor: '#F39C36' });
    syncDomWithSettings(DEFAULT_APP_SETTINGS);
    saveSettingsToIndexedDB(DEFAULT_APP_SETTINGS).catch(console.error);
  },

  hydrateFromStorage: async () => {
    try {
      const saved = await loadSettingsFromIndexedDB();
      if (saved) {
        const migratedArrowWidth =
          !saved.arrowWidth || saved.arrowWidth < 16 ? DEFAULT_APP_SETTINGS.arrowWidth : saved.arrowWidth;
        const migratedEngineColor =
          !saved.engineArrowColor || saved.engineArrowColor.toLowerCase() === '#779954'
            ? DEFAULT_APP_SETTINGS.engineArrowColor
            : saved.engineArrowColor;
        const migratedOpacity =
          !saved.arrowOpacity || saved.arrowOpacity > 0.72
            ? DEFAULT_APP_SETTINGS.arrowOpacity
            : saved.arrowOpacity;
        const migratedThresholds =
          saved.thresholds && saved.thresholds.goodMaxCpl <= 60
            ? { ...DEFAULT_THRESHOLDS }
            : { ...DEFAULT_APP_SETTINGS.thresholds, ...saved.thresholds };

        // Migrate legacy pre-audit engineConfig records that did not have `maxDepth` defined
        const isLegacyEngineConfig = !saved.engineConfig || saved.engineConfig.maxDepth === undefined;
        const migratedEngineConfig: EngineConfig = {
          ...DEFAULT_APP_SETTINGS.engineConfig,
          ...saved.engineConfig,
          depth: isLegacyEngineConfig
            ? DEFAULT_APP_SETTINGS.engineConfig.depth
            : Math.max(1, Math.min(30, saved.engineConfig.depth ?? 14)),
          maxDepth: saved.engineConfig?.maxDepth ?? 30,
        };

        const merged: AppSettings = {
          ...DEFAULT_APP_SETTINGS,
          ...saved,
          arrowWidth: migratedArrowWidth,
          arrowOpacity: migratedOpacity,
          engineArrowColor: migratedEngineColor,
          engineConfig: migratedEngineConfig,
          thresholds: migratedThresholds,
        };
        stockfishClient.updateConfig(merged.engineConfig);
        set({ settings: merged, activeBrushColor: merged.userArrowColor });
        syncDomWithSettings(merged);
        saveSettingsToIndexedDB(merged).catch(console.error);
      } else {
        syncDomWithSettings(DEFAULT_APP_SETTINGS);
      }
    } catch (err) {
      console.error('Failed to load settings from IndexedDB:', err);
    }
  },
}));
