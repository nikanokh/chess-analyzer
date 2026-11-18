import React from 'react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useGameStore } from '../../stores/useGameStore';
import { RotateCcw, Settings, X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BOARD_COLOR_PRESETS = [
  { name: 'Классический зелёный (Chess.com)', light: '#EEEED2', dark: '#769656' },
  { name: 'Турнирное дерево', light: '#F0D9B5', dark: '#B58863' },
  { name: 'Морской лёд', light: '#DEE3E6', dark: '#8CA2AD' },
  { name: 'Графитовый минимализм', light: '#E6E6E6', dark: '#6E7582' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const updateEngineConfig = useSettingsStore((s) => s.updateEngineConfig);
  const updateThresholds = useSettingsStore((s) => s.updateThresholds);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const recalculateWithThresholds = useGameStore((s) => s.recalculateWithThresholds);

  if (!isOpen) return null;

  const handleThresholdChange = (key: keyof typeof settings.thresholds, val: number) => {
    const next = { ...settings.thresholds, [key]: val };
    updateThresholds({ [key]: val });
    recalculateWithThresholds(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--chess-border)]">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#779954]" />
            <h3 className="text-sm font-bold text-[var(--chess-text-primary)]">
              Настройки интерфейса, доски и Stockfish UCI
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs">
          {/* 1. Board & Pieces */}
          <section className="space-y-3">
            <h4 className="font-bold text-sm text-[var(--chess-text-primary)] border-b border-[var(--chess-border)] pb-1.5">
              1. Шахматная доска и фигуры
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Набор шахматных фигур
                </label>
                <select
                  value={settings.pieceSet}
                  onChange={(e) =>
                    updateSettings({ pieceSet: e.target.value as 'neo' | 'classic_svg' })
                  }
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-[var(--chess-text-primary)]"
                >
                  <option value="neo">Neo (Фигуры из ТЗ / Chess.com)</option>
                  <option value="classic_svg">Classic Rounded SVG (Векторные)</option>
                </select>
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Размер доски
                </label>
                <select
                  value={settings.boardSize}
                  onChange={(e) =>
                    updateSettings({
                      boardSize: e.target.value as typeof settings.boardSize,
                    })
                  }
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-[var(--chess-text-primary)]"
                >
                  <option value="auto">Автоматический (под экран)</option>
                  <option value="small">Компактный (420px)</option>
                  <option value="medium">Средний (520px)</option>
                  <option value="large">Крупный (660px)</option>
                </select>
              </div>
            </div>

            {/* Color Presets */}
            <div>
              <label className="text-[var(--chess-text-secondary)] block mb-1.5">
                Палитра клеток доски
              </label>
              <div className="grid grid-cols-2 gap-2">
                {BOARD_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() =>
                      updateSettings({
                        lightSquareColor: preset.light,
                        darkSquareColor: preset.dark,
                      })
                    }
                    className={`p-2 rounded border flex items-center gap-2 text-left transition-colors ${
                      settings.darkSquareColor.toLowerCase() === preset.dark.toLowerCase()
                        ? 'border-[#779954] bg-[#779954]/10 font-semibold'
                        : 'border-[var(--chess-border)] bg-[var(--chess-bg-secondary)]'
                    }`}
                  >
                    <span className="flex shrink-0 rounded overflow-hidden border border-black/20">
                      <span style={{ backgroundColor: preset.light }} className="w-4 h-4" />
                      <span style={{ backgroundColor: preset.dark }} className="w-4 h-4" />
                    </span>
                    <span className="truncate text-[11px]">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {[
                { key: 'enableAnimations', label: 'Анимация ходов' },
                { key: 'highlightLastMove', label: 'Подсветка хода' },
                { key: 'highlightLegalMoves', label: 'Возможные ходы' },
                { key: 'showCoordinates', label: 'Координаты A–H' },
                { key: 'showEvalBar', label: 'Шкала оценки' },
                { key: 'showLeftSidebar', label: 'Левая панель инфо' },
              ].map((item) => {
                const checked = Boolean(settings[item.key as keyof typeof settings]);
                return (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        updateSettings({ [item.key]: e.target.checked })
                      }
                      className="accent-[#779954]"
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* 2. Arrows & Graphical Annotations */}
          <section className="space-y-3">
            <h4 className="font-bold text-sm text-[var(--chess-text-primary)] border-b border-[var(--chess-border)] pb-1.5">
              2. Стрелки и графические аннотации
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Стрелки игрока
                </label>
                <input
                  type="color"
                  value={settings.userArrowColor}
                  onChange={(e) => updateSettings({ userArrowColor: e.target.value })}
                  className="w-full h-8 rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Лучший ход UCI
                </label>
                <input
                  type="color"
                  value={settings.engineArrowColor}
                  onChange={(e) => updateSettings({ engineArrowColor: e.target.value })}
                  className="w-full h-8 rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Вторые линии UCI
                </label>
                <input
                  type="color"
                  value={settings.secondaryEngineArrowColor}
                  onChange={(e) =>
                    updateSettings({ secondaryEngineArrowColor: e.target.value })
                  }
                  className="w-full h-8 rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Толщина ({settings.arrowWidth}px) и прозрачность ({Math.round(settings.arrowOpacity * 100)}%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={14}
                    max={32}
                    value={settings.arrowWidth}
                    onChange={(e) => updateSettings({ arrowWidth: Number(e.target.value) })}
                    className="w-1/2 accent-[#F39C36]"
                  />
                  <input
                    type="range"
                    min={40}
                    max={100}
                    value={Math.round(settings.arrowOpacity * 100)}
                    onChange={(e) =>
                      updateSettings({ arrowOpacity: Number(e.target.value) / 100 })
                    }
                    className="w-1/2 accent-[#36A9E1]"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 3. Stockfish UCI Engine Parameters */}
          <section className="space-y-3">
            <h4 className="font-bold text-sm text-[var(--chess-text-primary)] border-b border-[var(--chess-border)] pb-1.5">
              3. Параметры движка Stockfish (UCI)
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Глубина (Depth: {settings.engineConfig.depth})
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.engineConfig.depth}
                  onChange={(e) => updateEngineConfig({ depth: Number(e.target.value) })}
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono-tabular"
                />
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Линии MultiPV ({settings.engineConfig.multiPv})
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={settings.engineConfig.multiPv}
                  onChange={(e) => updateEngineConfig({ multiPv: Number(e.target.value) })}
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono-tabular"
                />
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Hash (МБ)
                </label>
                <select
                  value={settings.engineConfig.hashMb}
                  onChange={(e) => updateEngineConfig({ hashMb: Number(e.target.value) })}
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono-tabular"
                >
                  <option value={16}>16 МБ</option>
                  <option value={32}>32 МБ</option>
                  <option value={64}>64 МБ</option>
                  <option value={128}>128 МБ</option>
                  <option value={256}>256 МБ</option>
                  <option value={512}>512 МБ</option>
                </select>
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Потоки (Threads: {settings.engineConfig.threads})
                </label>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={settings.engineConfig.threads}
                  onChange={(e) => updateEngineConfig({ threads: Number(e.target.value) })}
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono-tabular"
                />
              </div>

              <div>
                <label className="text-[var(--chess-text-secondary)] block mb-1">
                  Время на ход (мс, 0=по глубине)
                </label>
                <input
                  type="number"
                  step={250}
                  min={0}
                  max={10000}
                  value={settings.engineConfig.movetimeMs}
                  onChange={(e) => updateEngineConfig({ movetimeMs: Number(e.target.value) })}
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono-tabular"
                />
              </div>
            </div>
          </section>

          {/* 4. Move Quality Thresholds (CPL) */}
          <section className="space-y-3">
            <h4 className="font-bold text-sm text-[var(--chess-text-primary)] border-b border-[var(--chess-border)] pb-1.5">
              4. Пороги классификации качества ходов (в сантипешках CPL)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { key: 'bestMaxCpl', label: 'Лучший (≤)' },
                { key: 'excellentMaxCpl', label: 'Прекрасный (≤)' },
                { key: 'goodMaxCpl', label: 'Хороший (≤)' },
                { key: 'inaccuracyMaxCpl', label: 'Неточность (≤)' },
                { key: 'mistakeMaxCpl', label: 'Ошибка (≤)' },
              ].map((item) => (
                <div key={item.key}>
                  <label className="text-[11px] text-[var(--chess-text-secondary)] block mb-1">
                    {item.label}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={settings.thresholds[item.key as keyof typeof settings.thresholds]}
                    onChange={(e) =>
                      handleThresholdChange(
                        item.key as keyof typeof settings.thresholds,
                        Number(e.target.value)
                      )
                    }
                    className="w-full p-1.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono-tabular"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--chess-border)] bg-[var(--chess-bg-secondary)]">
          <button
            type="button"
            onClick={resetSettings}
            className="px-3 py-1.5 rounded text-xs font-medium text-[#E05252] hover:bg-[#E05252]/10 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Сбросить по умолчанию</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
