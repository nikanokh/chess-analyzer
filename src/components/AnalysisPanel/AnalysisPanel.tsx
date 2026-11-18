import React, { useState } from 'react';
import { EngineState, MoveCategory } from '../../types/chess';
import { useGameStore } from '../../stores/useGameStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { findNodeById } from '../../core/chess/VariationTree';
import { MoveList } from '../MoveList/MoveList';
import { EngineLines } from '../EngineLines/EngineLines';
import { AccuracyChart } from '../AccuracyChart/AccuracyChart';
import { GameInfoSidebar } from '../GameInfo/GameInfoSidebar';
import { CATEGORY_ICONS, CATEGORY_META } from '../../utils/assets';
import { Activity, BarChart3, CornerUpLeft, GitBranch, Info, ListOrdered, Play } from 'lucide-react';

interface AnalysisPanelProps {
  engineState: EngineState;
}

const STAT_CATEGORY_ORDER: MoveCategory[] = [
  'Brilliant',
  'Great',
  'Best',
  'Excellent',
  'Good',
  'Book',
  'Forced',
  'Inaccuracy',
  'Mistake',
  'MissedChance',
  'Blunder',
];

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ engineState }) => {
  const [activeTab, setActiveTab] = useState<'moves' | 'analysis' | 'stats' | 'info'>('moves');

  const statistics = useGameStore((s) => s.statistics);
  const metadata = useGameStore((s) => s.metadata);
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const returnToMainline = useGameStore((s) => s.returnToMainline);
  const isBatchAnalyzing = useGameStore((s) => s.isBatchAnalyzing);
  const runFullGameAnalysis = useGameStore((s) => s.runFullGameAnalysis);
  const settings = useSettingsStore((s) => s.settings);

  const currentNode = findNodeById(rootNode, currentNodeId) || rootNode;

  return (
    <aside className="w-full md:w-[330px] lg:w-[370px] xl:w-[405px] h-[480px] md:h-full min-h-0 shrink-0 bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md flex flex-col overflow-hidden">
      {/* Tab Header: Ходы | Анализ | Статистика | (+ Партия on < xl) */}
      <div className="grid grid-cols-4 xl:grid-cols-3 border-b border-[var(--chess-border)] bg-[var(--chess-bg-secondary)] p-1 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('moves')}
          className={`py-1.5 sm:py-2 px-1.5 sm:px-2.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap ${
            activeTab === 'moves'
              ? 'bg-[var(--chess-bg-primary)] text-[#779954] shadow-sm'
              : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
          }`}
        >
          <ListOrdered className="w-3.5 h-3.5 shrink-0" />
          <span>Ходы</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('analysis')}
          className={`py-1.5 sm:py-2 px-1.5 sm:px-2.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap ${
            activeTab === 'analysis'
              ? 'bg-[var(--chess-bg-primary)] text-[#779954] shadow-sm'
              : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
          }`}
        >
          <Activity className="w-3.5 h-3.5 shrink-0" />
          <span>Анализ</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stats')}
          className={`py-1.5 sm:py-2 px-1.5 sm:px-2.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap ${
            activeTab === 'stats'
              ? 'bg-[var(--chess-bg-primary)] text-[#779954] shadow-sm'
              : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 shrink-0" />
          <span>Статистика</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('info')}
          className={`xl:hidden py-1.5 sm:py-2 px-1.5 sm:px-2.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap ${
            activeTab === 'info'
              ? 'bg-[var(--chess-bg-primary)] text-[#779954] shadow-sm'
              : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
          }`}
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>Партия</span>
        </button>
      </div>

      {/* Prominent One-Click Return Banner when user is in an alternative variation branch */}
      {!currentNode.isMainline && (
        <div className="px-3 py-1.5 bg-[#36A9E1]/15 border-b border-[#36A9E1]/40 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[var(--chess-text-primary)] min-w-0">
            <GitBranch className="w-3.5 h-3.5 text-[#36A9E1] shrink-0" />
            <span className="truncate font-medium">Альтернативная ветка</span>
          </div>
          <button
            type="button"
            onClick={returnToMainline}
            className="px-2.5 py-1 rounded bg-[#36A9E1] hover:bg-[#2B93C7] text-white text-[11px] font-semibold transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 shadow-xs"
            title="Вернуться из альтернативной ветки к основной партии"
          >
            <CornerUpLeft className="w-3 h-3" />
            <span>К основной партии</span>
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'moves' && (
        <div className="flex-1 flex flex-col min-h-0">
          <MoveList />
          {/* Show compact Evaluation Graph below MoveList when analyzed */}
          {statistics && (
            <div className="p-2 border-t border-[var(--chess-border)] shrink-0">
              <AccuracyChart />
            </div>
          )}
        </div>
      )}

      {activeTab === 'analysis' && <EngineLines engineState={engineState} />}

      {activeTab === 'stats' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Interactive Evaluation Graph */}
          <AccuracyChart />

          {!statistics ? (
            <div className="p-4 sm:p-5 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-center space-y-3">
              <p className="text-xs text-[var(--chess-text-secondary)]">
                Для расчёта точности белых и чёрных, количества бриллиантовых ходов, ошибок и зевков запустите полный анализ партии движком Stockfish.
              </p>
              <button
                type="button"
                disabled={isBatchAnalyzing}
                onClick={() =>
                  runFullGameAnalysis(settings.engineConfig.depth, settings.thresholds)
                }
                className="px-4 py-2 rounded-md bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold transition-colors inline-flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isBatchAnalyzing ? 'Идёт анализ...' : 'Запустить полный анализ'}</span>
              </button>
            </div>
          ) : (
            <>
              {/* Accuracy Score Comparison Header */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-center">
                  <div className="text-[11px] text-[var(--chess-text-secondary)] truncate">
                    {metadata.whiteName} (Белые)
                  </div>
                  <div className="text-xl sm:text-2xl font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-1">
                    {statistics.whiteAccuracy}%
                  </div>
                  <div className="text-[10px] font-mono-tabular text-[var(--chess-text-secondary)] mt-0.5">
                    Средняя потеря: {statistics.whiteAvgCpl} сП
                  </div>
                </div>

                <div className="p-3 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-center">
                  <div className="text-[11px] text-[var(--chess-text-secondary)] truncate">
                    {metadata.blackName} (Чёрные)
                  </div>
                  <div className="text-xl sm:text-2xl font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-1">
                    {statistics.blackAccuracy}%
                  </div>
                  <div className="text-[10px] font-mono-tabular text-[var(--chess-text-secondary)] mt-0.5">
                    Средняя потеря: {statistics.blackAvgCpl} сП
                  </div>
                </div>
              </div>

              {/* Move Classification Breakdown Table */}
              <div className="rounded-md border border-[var(--chess-border)] overflow-hidden">
                <div className="grid grid-cols-3 bg-[var(--chess-bg-secondary)] px-3 py-2 text-[11px] font-semibold text-[var(--chess-text-secondary)] border-b border-[var(--chess-border)]">
                  <span>Белые</span>
                  <span className="text-center">Категория хода</span>
                  <span className="text-right">Чёрные</span>
                </div>

                <div className="divide-y divide-[var(--chess-border)]/60 text-xs">
                  {STAT_CATEGORY_ORDER.map((cat) => {
                    const meta = CATEGORY_META[cat];
                    const wCount = statistics.whiteCounts[cat] || 0;
                    const bCount = statistics.blackCounts[cat] || 0;

                    return (
                      <div
                        key={cat}
                        className="grid grid-cols-3 items-center px-3 py-2 hover:bg-[var(--chess-bg-secondary)]/60 transition-colors"
                      >
                        <span
                          style={{ color: wCount > 0 ? meta.color : undefined }}
                          className="font-mono-tabular font-bold"
                        >
                          {wCount}
                        </span>

                        <div className="flex items-center justify-center gap-2">
                          <img
                            src={CATEGORY_ICONS[cat]}
                            alt={meta.labelRu}
                            referrerPolicy="no-referrer"
                            className="w-4 h-4 object-contain shrink-0"
                          />
                          <span className="text-[var(--chess-text-primary)] font-medium whitespace-nowrap">
                            {meta.labelRu}
                          </span>
                        </div>

                        <span
                          style={{ color: bCount > 0 ? meta.color : undefined }}
                          className="font-mono-tabular font-bold text-right"
                        >
                          {bCount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'info' && <GameInfoSidebar embeddedMobile />}
    </aside>
  );
};
