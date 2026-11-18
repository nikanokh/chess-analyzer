import React, { useState } from 'react';
import { useGameStore } from '../../stores/useGameStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { findNodeById } from '../../core/chess/VariationTree';
import {
  BookOpen,
  Calendar,
  Check,
  Clock,
  Copy,
  Download,
  GitBranch,
  PanelLeftClose,
  Play,
  Square,
  Trophy,
} from 'lucide-react';

interface GameInfoSidebarProps {
  embeddedMobile?: boolean;
}

export const GameInfoSidebar: React.FC<GameInfoSidebarProps> = ({ embeddedMobile = false }) => {
  const metadata = useGameStore((s) => s.metadata);
  const openingSummary = useGameStore((s) => s.openingSummary);
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const isBatchAnalyzing = useGameStore((s) => s.isBatchAnalyzing);
  const batchProgress = useGameStore((s) => s.batchProgress);
  const statistics = useGameStore((s) => s.statistics);
  const runFullGameAnalysis = useGameStore((s) => s.runFullGameAnalysis);
  const cancelFullGameAnalysis = useGameStore((s) => s.cancelFullGameAnalysis);
  const returnToMainline = useGameStore((s) => s.returnToMainline);
  const getExportPgn = useGameStore((s) => s.getExportPgn);

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [copiedPgn, setCopiedPgn] = useState(false);

  const currentNode = findNodeById(rootNode, currentNodeId) || rootNode;

  const handleCopyPgn = () => {
    const pgn = getExportPgn();
    navigator.clipboard.writeText(pgn);
    setCopiedPgn(true);
    setTimeout(() => setCopiedPgn(false), 1800);
  };

  const handleDownloadPgn = () => {
    const pgn = getExportPgn();
    const blob = new Blob([pgn], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metadata.whiteName}_vs_${metadata.blackName}.pgn`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  const containerClass = embeddedMobile
    ? 'flex-1 min-h-0 overflow-y-auto p-3 flex flex-col justify-between gap-3'
    : 'hidden xl:flex w-72 2xl:w-80 h-full min-h-0 shrink-0 bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md flex-col justify-between p-3 gap-2.5 overflow-hidden';

  const formatRatingDiff = (diff?: number) => {
    if (diff === undefined) return null;
    const sign = diff > 0 ? '+' : '';
    const colorClass =
      diff > 0
        ? 'text-[#779954]'
        : diff < 0
          ? 'text-[#E05252]'
          : 'text-[var(--chess-text-secondary)]';
    return (
      <span className={`font-semibold ${colorClass}`}>
        ({sign}{diff})
      </span>
    );
  };

  return (
    <aside className={containerClass}>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5">
        {/* Top Row: Title + Hide Sidebar (Desktop only) */}
        {!embeddedMobile && (
          <div className="flex items-center justify-between border-b border-[var(--chess-border)] pb-2">
            <h2 className="text-sm font-bold text-[var(--chess-text-primary)]">
              Информация о партии
            </h2>
            <button
              type="button"
              onClick={() => updateSettings({ showLeftSidebar: false })}
              className="p-1 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)] transition-colors"
              title="Скрыть левую панель"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Players Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
          {/* White Player */}
          <div className="flex items-center justify-between p-2 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-3.5 h-3.5 rounded-sm bg-[#FFFFFF] border border-[#333333] shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {metadata.whiteTitle && (
                    <span className="px-1.5 py-0.5 rounded-xs bg-[#B33430] text-white text-[10px] font-extrabold uppercase tracking-wider leading-none shrink-0">
                      {metadata.whiteTitle}
                    </span>
                  )}
                  <span className="text-xs sm:text-sm font-semibold text-[var(--chess-text-primary)] truncate">
                    {metadata.whiteName}
                  </span>
                </div>
                <div className="text-[10px] sm:text-[11px] text-[var(--chess-text-secondary)] font-mono-tabular flex items-center gap-1 mt-0.5">
                  <span>Белые {metadata.whiteRating ? `· ${metadata.whiteRating}` : ''}</span>
                  {formatRatingDiff(metadata.whiteRatingDiff)}
                </div>
              </div>
            </div>
            {statistics && (
              <div className="text-right shrink-0 ml-1">
                <div className="text-xs font-bold font-mono-tabular text-[#779954]">
                  {statistics.whiteAccuracy}%
                </div>
                <div className="text-[10px] text-[var(--chess-text-secondary)]">Точность</div>
              </div>
            )}
          </div>

          {/* Black Player */}
          <div className="flex items-center justify-between p-2 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-3.5 h-3.5 rounded-sm bg-[#262421] border border-[#777777] shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {metadata.blackTitle && (
                    <span className="px-1.5 py-0.5 rounded-xs bg-[#B33430] text-white text-[10px] font-extrabold uppercase tracking-wider leading-none shrink-0">
                      {metadata.blackTitle}
                    </span>
                  )}
                  <span className="text-xs sm:text-sm font-semibold text-[var(--chess-text-primary)] truncate">
                    {metadata.blackName}
                  </span>
                </div>
                <div className="text-[10px] sm:text-[11px] text-[var(--chess-text-secondary)] font-mono-tabular flex items-center gap-1 mt-0.5">
                  <span>Чёрные {metadata.blackRating ? `· ${metadata.blackRating}` : ''}</span>
                  {formatRatingDiff(metadata.blackRatingDiff)}
                </div>
              </div>
            </div>
            {statistics && (
              <div className="text-right shrink-0 ml-1">
                <div className="text-xs font-bold font-mono-tabular text-[#779954]">
                  {statistics.blackAccuracy}%
                </div>
                <div className="text-[10px] text-[var(--chess-text-secondary)]">Точность</div>
              </div>
            )}
          </div>
        </div>

        {/* Metadata Unboxed Clean List */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-y-2 gap-x-3 text-xs py-2 border-y border-[var(--chess-border)]">
          <div>
            <span className="text-[var(--chess-text-secondary)] block text-[11px]">Платформа</span>
            <span className="font-medium text-[var(--chess-text-primary)]">
              {metadata.platform}
            </span>
          </div>
          <div>
            <span className="text-[var(--chess-text-secondary)] block text-[11px]">Результат</span>
            <span className="font-semibold font-mono-tabular text-[var(--chess-text-primary)] flex items-center gap-1">
              <Trophy className="w-3 h-3 text-[#779954]" />
              {metadata.result}
            </span>
          </div>
          <div>
            <span className="text-[var(--chess-text-secondary)] block text-[11px]">Контроль</span>
            <span className="font-medium font-mono-tabular text-[var(--chess-text-primary)] flex items-center gap-1">
              <Clock className="w-3 h-3 text-[var(--chess-text-secondary)]" />
              {metadata.timeControl || 'Без часов'}
            </span>
          </div>
          <div>
            <span className="text-[var(--chess-text-secondary)] block text-[11px]">Дата</span>
            <span className="font-medium font-mono-tabular text-[var(--chess-text-primary)] flex items-center gap-1">
              <Calendar className="w-3 h-3 text-[var(--chess-text-secondary)]" />
              {metadata.date}
            </span>
          </div>
        </div>

        {/* ECO Opening & Theory Recognition Card */}
        <div className="p-2.5 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#A88865] flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              Дебют (ECO {openingSummary.eco})
            </span>
            <span className="text-[10px] font-mono-tabular text-[var(--chess-text-secondary)]">
              {openingSummary.version}
            </span>
          </div>

          <div>
            <div className="text-xs font-bold text-[var(--chess-text-primary)]">
              {openingSummary.name}
            </div>
            <div className="text-[11px] text-[var(--chess-text-secondary)] mt-0.5">
              {openingSummary.variation}
            </div>
          </div>

          <div className="pt-1.5 border-t border-[var(--chess-border)] text-[11px] space-y-1 text-[var(--chess-text-secondary)]">
            <div className="flex items-center justify-between">
              <span>Теоретических ходов:</span>
              <span className="font-mono-tabular font-medium text-[var(--chess-text-primary)]">
                Белые: {openingSummary.theoreticalMovesWhite} · Чёрные:{' '}
                {openingSummary.theoreticalMovesBlack}
              </span>
            </div>
            {openingSummary.lastTheoreticalMoveSan && (
              <div className="flex items-center justify-between">
                <span>Последний ход книги:</span>
                <span className="font-mono-tabular font-semibold text-[#779954]">
                  {openingSummary.lastTheoreticalMoveSan}
                </span>
              </div>
            )}
            {openingSummary.firstOutOfBookMoveSan && (
              <div className="flex items-center justify-between">
                <span>Выход из теории:</span>
                <span className="font-mono-tabular font-medium text-[#F39C36]">
                  {openingSummary.firstOutOfBookMoveSan}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Variation Status Banner if user is exploring a custom variation */}
        {!currentNode.isMainline && (
          <div className="p-2 rounded-md bg-[#36A9E1]/10 border border-[#36A9E1]/40 flex items-center justify-between gap-2">
            <div className="text-xs text-[var(--chess-text-primary)] flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-[#36A9E1] shrink-0" />
              <span>Пользовательский вариант</span>
            </div>
            <button
              type="button"
              onClick={returnToMainline}
              className="px-2 py-1 rounded text-[11px] font-semibold bg-[#36A9E1] text-white hover:opacity-90 whitespace-nowrap shrink-0"
            >
              К партии
            </button>
          </div>
        )}
      </div>

      {/* Bottom Action Area: Full Analysis & PGN Export */}
      <div className="space-y-2 pt-2 border-t border-[var(--chess-border)] shrink-0">
        {isBatchAnalyzing ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-[var(--chess-text-primary)]">
                Анализ Stockfish...
              </span>
              <span className="font-mono-tabular text-[#779954]">
                {batchProgress.current} / {batchProgress.total}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--chess-bg-secondary)] overflow-hidden">
              <div
                style={{
                  width: `${
                    batchProgress.total > 0
                      ? Math.round((batchProgress.current / batchProgress.total) * 100)
                      : 0
                  }%`,
                }}
                className="h-full bg-[#779954] transition-all duration-200"
              />
            </div>
            <button
              type="button"
              onClick={cancelFullGameAnalysis}
              className="w-full py-2 px-3 rounded-md bg-[#E05252] text-white text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Остановить анализ</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              runFullGameAnalysis(settings.engineConfig.depth, settings.thresholds)
            }
            className="w-full py-2 px-4 rounded-md bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold transition-colors shadow-sm flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {statistics ? 'Пересчитать полный анализ' : 'Запустить полный анализ'}
            </span>
          </button>
        )}

        {/* Export PGN Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopyPgn}
            className="py-1.5 px-2.5 rounded-md bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-[var(--chess-text-primary)] text-xs font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            {copiedPgn ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#779954]" />
                <span>Скопировано</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Копировать PGN</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadPgn}
            className="py-1.5 px-2.5 rounded-md bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-[var(--chess-text-primary)] text-xs font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать PGN</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
