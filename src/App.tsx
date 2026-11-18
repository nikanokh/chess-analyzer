/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useGameStore } from './stores/useGameStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { useStockfishEngine } from './hooks/useStockfishEngine';
import { findNodeById } from './core/chess/VariationTree';
import { GameInfoSidebar } from './components/GameInfo/GameInfoSidebar';
import { ChessBoardView } from './components/ChessBoard/ChessBoardView';
import { EvaluationBar, getTerminalScoreFromFen } from './components/EvaluationBar/EvaluationBar';
import { AnalysisPanel } from './components/AnalysisPanel/AnalysisPanel';
import { ImportModal } from './components/Modals/ImportModal';
import { ChessComModal } from './components/Modals/ChessComModal';
import { SavedGamesModal } from './components/Modals/SavedGamesModal';
import { SettingsModal } from './components/Settings/SettingsModal';
import { OpeningRepertoirePage } from './components/Repertoire/OpeningRepertoirePage';
import { CATEGORY_ICONS, CATEGORY_META } from './utils/assets';
import {
  BookOpen,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  CornerUpLeft,
  Cpu,
  Database,
  FileUp,
  Globe,
  Moon,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Square,
  Sun,
  Trophy,
  X,
} from 'lucide-react';

export default function App() {
  const engineState = useStockfishEngine();

  const metadata = useGameStore((s) => s.metadata);
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const openingSummary = useGameStore((s) => s.openingSummary);
  const isAutoPlaying = useGameStore((s) => s.isAutoPlaying);
  const isBatchAnalyzing = useGameStore((s) => s.isBatchAnalyzing);
  const batchProgress = useGameStore((s) => s.batchProgress);
  const errorMessage = useGameStore((s) => s.errorMessage);
  const goToStart = useGameStore((s) => s.goToStart);
  const goToPrev = useGameStore((s) => s.goToPrev);
  const goToNext = useGameStore((s) => s.goToNext);
  const goToEnd = useGameStore((s) => s.goToEnd);
  const returnToMainline = useGameStore((s) => s.returnToMainline);
  const setAutoPlaying = useGameStore((s) => s.setAutoPlaying);
  const runFullGameAnalysis = useGameStore((s) => s.runFullGameAnalysis);
  const cancelFullGameAnalysis = useGameStore((s) => s.cancelFullGameAnalysis);
  const clearError = useGameStore((s) => s.clearError);
  const persistCurrentGame = useGameStore((s) => s.persistCurrentGame);

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const flipBoard = useSettingsStore((s) => s.flipBoard);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const hydrateFromStorage = useSettingsStore((s) => s.hydrateFromStorage);

  const [activeWorkspaceView, setActiveWorkspaceView] = useState<'analyzer' | 'repertoire'>(
    'analyzer'
  );
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isChessComModalOpen, setIsChessComModalOpen] = useState(false);
  const [isSavedGamesModalOpen, setIsSavedGamesModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Hydrate persisted settings and initial game on mount
  useEffect(() => {
    hydrateFromStorage();
    persistCurrentGame().catch(() => {});
  }, [hydrateFromStorage, persistCurrentGame]);

  // Keyboard navigation for moves (ArrowLeft, ArrowRight, Home/ArrowUp, End/ArrowDown, f = flip)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'ArrowUp' || e.key === 'Home') {
        e.preventDefault();
        goToStart();
      } else if (e.key === 'ArrowDown' || e.key === 'End') {
        e.preventDefault();
        goToEnd();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        flipBoard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrev, goToNext, goToStart, goToEnd, flipBoard]);

  // Autoplay interval
  useEffect(() => {
    if (!isAutoPlaying) return;
    const timer = window.setInterval(() => {
      goToNext();
    }, 950);
    return () => window.clearInterval(timer);
  }, [isAutoPlaying, goToNext]);

  const currentNode = findNodeById(rootNode, currentNodeId) || rootNode;
  const activeEngineLines =
    !isBatchAnalyzing && (!engineState.fen || engineState.fen === currentNode.fen)
      ? engineState.lines
      : [];
  const primaryEngineLine = activeEngineLines[0];

  // Use analyzed evaluation if available, otherwise live Stockfish evaluation
  const activeCp = currentNode.analysis?.evalAfterCp ?? primaryEngineLine?.cp ?? 0;
  const activeMate = currentNode.analysis?.mateAfter ?? primaryEngineLine?.mate;
  const terminalScore = getTerminalScoreFromFen(currentNode.fen);

  const isWhiteBottom = settings.boardOrientation === 'white';
  const topPlayer = isWhiteBottom
    ? {
        name: metadata.blackName,
        title: metadata.blackTitle,
        rating: metadata.blackRating,
        ratingDiff: metadata.blackRatingDiff,
        color: 'b' as const,
      }
    : {
        name: metadata.whiteName,
        title: metadata.whiteTitle,
        rating: metadata.whiteRating,
        ratingDiff: metadata.whiteRatingDiff,
        color: 'w' as const,
      };
  const bottomPlayer = isWhiteBottom
    ? {
        name: metadata.whiteName,
        title: metadata.whiteTitle,
        rating: metadata.whiteRating,
        ratingDiff: metadata.whiteRatingDiff,
        color: 'w' as const,
      }
    : {
        name: metadata.blackName,
        title: metadata.blackTitle,
        rating: metadata.blackRating,
        ratingDiff: metadata.blackRatingDiff,
        color: 'b' as const,
      };

  const renderRatingBadge = (rating?: number, ratingDiff?: number) => {
    if (!rating) return null;
    const sign = ratingDiff && ratingDiff > 0 ? '+' : '';
    const diffColor =
      ratingDiff && ratingDiff > 0
        ? 'text-[#779954]'
        : ratingDiff && ratingDiff < 0
          ? 'text-[#E05252]'
          : 'text-[var(--chess-text-secondary)]';

    return (
      <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] shrink-0">
        {rating}
        {ratingDiff !== undefined && (
          <span className={`ml-1 font-semibold ${diffColor}`}>
            ({sign}
            {ratingDiff})
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="min-h-[100dvh] md:h-[100dvh] w-screen overflow-y-auto md:overflow-hidden flex flex-col bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)]">
      {/* Compact Top Bar */}
      <header className="h-10 sm:h-11 px-2.5 sm:px-4 bg-[var(--chess-bg-primary)] border-b border-[var(--chess-border)] flex items-center justify-between gap-2 sm:gap-4 shrink-0 sticky top-0 z-30 md:static">
        {/* Zone 1: Brand Title */}
        <div className="flex items-center gap-2 shrink-0">
          {!settings.showLeftSidebar && (
            <button
              type="button"
              onClick={() => updateSettings({ showLeftSidebar: true })}
              className="hidden xl:inline-flex p-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-[var(--chess-text-primary)] transition-colors"
              title="Показать панель информации о партии"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveWorkspaceView('analyzer')}
            className="text-xs sm:text-base font-bold tracking-tight text-[var(--chess-text-primary)] whitespace-nowrap hover:opacity-90 transition-opacity"
          >
            Chess Analyzer
          </button>

          {/* Primary Workspace Mode Switcher */}
          <div className="flex items-center bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] rounded p-0.5 ml-1">
            <button
              type="button"
              onClick={() => setActiveWorkspaceView('analyzer')}
              className={`px-2 py-0.5 rounded-xs text-xs font-semibold transition-colors whitespace-nowrap ${
                activeWorkspaceView === 'analyzer'
                  ? 'bg-[#779954] text-white'
                  : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
              }`}
            >
              Анализатор
            </button>
            <button
              type="button"
              onClick={() => setActiveWorkspaceView('repertoire')}
              className={`px-2 py-0.5 rounded-xs text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap ${
                activeWorkspaceView === 'repertoire'
                  ? 'bg-[#779954] text-white'
                  : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
              }`}
              title="Модуль анализа дебютного репертуара игрока"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Дебютный репертуар</span>
            </button>
          </div>
        </div>

        {/* Zone 2: Navigation / Action Links */}
        <nav className="flex items-center gap-1 sm:gap-2.5 overflow-x-auto py-0.5">
          <button
            type="button"
            onClick={() => setIsSavedGamesModalOpen(true)}
            className="px-2 sm:px-2.5 py-1 rounded text-xs font-medium text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)] transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Мои сохранённые партии"
          >
            <Database className="w-3.5 h-3.5 text-[#779954]" />
            <span className="hidden sm:inline">Мои партии</span>
          </button>

          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="px-2 sm:px-2.5 py-1 rounded text-xs font-medium text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)] transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Импорт PGN или FEN"
          >
            <FileUp className="w-3.5 h-3.5 text-[#F39C36]" />
            <span>PGN / FEN</span>
          </button>

          <button
            type="button"
            onClick={() => setIsChessComModalOpen(true)}
            className="px-2 sm:px-2.5 py-1 rounded text-xs font-semibold bg-[#779954] hover:bg-[#62934B] text-white transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 shadow-xs"
            title="Импорт партий с Chess.com"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Chess.com</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-1.5 sm:px-2.5 sm:py-1 rounded text-xs font-medium text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)] transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Настройки"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Настройки</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)] transition-colors shrink-0"
            title={settings.theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
          >
            {settings.theme === 'light' ? (
              <Moon className="w-4 h-4" />
            ) : (
              <Sun className="w-4 h-4 text-[#F39C36]" />
            )}
          </button>
        </nav>

        {/* Zone 3: Stockfish Real-time Status Readout */}
        <div className="hidden lg:flex items-center gap-2 text-xs font-mono-tabular text-[var(--chess-text-secondary)] shrink-0">
          <Cpu
            className={`w-3.5 h-3.5 ${
              engineState.isReady ? 'text-[#779954]' : 'text-[#F39C36]'
            }`}
          />
          <span>
            {engineState.isReady
              ? engineState.isAnalyzing
                ? `Stockfish · Глубина ${engineState.currentDepth}`
                : `Stockfish · Готов (d${engineState.currentDepth})`
              : 'Запуск Stockfish...'}
          </span>
        </div>
      </header>

      {/* Optional Error Toast Banner */}
      {errorMessage && (
        <div className="bg-[#E05252] text-white px-4 py-1 text-xs font-medium flex items-center justify-between shrink-0">
          <span className="truncate">{errorMessage}</span>
          <button type="button" onClick={clearError} className="p-0.5 hover:opacity-80 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeWorkspaceView === 'repertoire' ? (
        <OpeningRepertoirePage
          onNavigateToAnalyzer={() => setActiveWorkspaceView('analyzer')}
        />
      ) : (
        /* Main Responsive Workspace:
           - < 768px (smartphones): vertical flow with full-width board + tall unclipped panel below
           - 768px..1279px (tablets / ~1000px): 2-column side-by-side (Board + AnalysisPanel) locked to 100dvh
           - >= 1280px (desktop): 3-column side-by-side (GameInfoSidebar + Board + AnalysisPanel) locked to 100dvh */
        <main className="flex-1 min-h-0 max-w-[1680px] w-full mx-auto p-1.5 sm:p-2 flex flex-col md:flex-row items-stretch gap-2 overflow-visible md:overflow-hidden">
          {/* Left Zone (XL Desktop): Game Information & Full Review Trigger */}
          {settings.showLeftSidebar && <GameInfoSidebar />}

        {/* Center Zone: Chessboard + Evaluation Bar + Player Bars + Move Controls */}
        <section className="shrink-0 md:flex-1 min-h-0 min-w-0 md:h-full flex flex-col items-center justify-between bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md px-2 sm:px-3 py-1.5 sm:py-2 overflow-hidden">
          {/* Top Player Bar + Opening Tag */}
          <div className="w-full max-w-[660px] flex items-center justify-between mb-1 px-1 shrink-0 gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-xs shrink-0 border ${
                  topPlayer.color === 'w'
                    ? 'bg-[#FFFFFF] border-[#333333]'
                    : 'bg-[#262421] border-[#777777]'
                }`}
              />
              {topPlayer.title && (
                <span className="px-1.5 py-0.5 rounded-xs bg-[#B33430] text-white text-[10px] font-extrabold uppercase tracking-wider leading-none shrink-0">
                  {topPlayer.title}
                </span>
              )}
              <span className="text-xs font-bold text-[var(--chess-text-primary)] truncate">
                {topPlayer.name}
              </span>
              {renderRatingBadge(topPlayer.rating, topPlayer.ratingDiff)}
            </div>

            <div className="text-[10px] sm:text-[11px] text-[var(--chess-text-secondary)] truncate max-w-[48%]">
              <span className="font-mono-tabular font-semibold text-[#A88865]">
                {openingSummary.eco}
              </span>{' '}
              · {openingSummary.name}
            </div>
          </div>

          {/* Board + Vertical Evaluation Bar Row */}
          <div className="md:flex-1 min-h-0 w-full flex items-stretch justify-center gap-1.5 sm:gap-2.5 overflow-hidden py-0.5">
            <EvaluationBar
              cp={activeCp}
              mate={activeMate}
              fen={currentNode.fen}
              orientation={settings.boardOrientation}
              visible={settings.showEvalBar}
            />
            <div className="flex items-center justify-center max-w-[660px]">
              <ChessBoardView engineLines={activeEngineLines} />
            </div>
          </div>

          {/* Bottom Player Bar + Current Move Classification or Terminal Result */}
          <div className="w-full max-w-[660px] flex items-center justify-between mt-1 px-1 shrink-0 gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-xs shrink-0 border ${
                  bottomPlayer.color === 'w'
                    ? 'bg-[#FFFFFF] border-[#333333]'
                    : 'bg-[#262421] border-[#777777]'
                }`}
              />
              {bottomPlayer.title && (
                <span className="px-1.5 py-0.5 rounded-xs bg-[#B33430] text-white text-[10px] font-extrabold uppercase tracking-wider leading-none shrink-0">
                  {bottomPlayer.title}
                </span>
              )}
              <span className="text-xs font-bold text-[var(--chess-text-primary)] truncate">
                {bottomPlayer.name}
              </span>
              {renderRatingBadge(bottomPlayer.rating, bottomPlayer.ratingDiff)}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {terminalScore && (
                <span className="px-2 py-0.5 rounded bg-[#779954]/20 text-[#779954] font-mono-tabular font-bold text-[11px] flex items-center gap-1">
                  <Trophy className="w-3 h-3" />
                  {terminalScore === '1/2-1/2' ? `Ничья · ${terminalScore}` : `Мат · ${terminalScore}`}
                </span>
              )}

              {currentNode.analysis && (
                <div className="flex items-center gap-1 text-[11px] sm:text-xs">
                  <img
                    src={CATEGORY_ICONS[currentNode.analysis.category]}
                    alt={currentNode.analysis.category}
                    referrerPolicy="no-referrer"
                    className="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain"
                  />
                  <span
                    style={{ color: CATEGORY_META[currentNode.analysis.category].color }}
                    className="font-semibold truncate max-w-[130px] sm:max-w-none"
                  >
                    {currentNode.moveNumber}
                    {currentNode.color === 'w' ? '.' : '...'} {currentNode.san} —{' '}
                    {CATEGORY_META[currentNode.analysis.category].labelRu}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Game Navigation Control Bar Below Board */}
          <div className="w-full max-w-[660px] mt-1 pt-1 border-t border-[var(--chess-border)] flex items-center justify-between gap-1.5 shrink-0 flex-wrap">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goToStart}
                disabled={currentNode.id === 'root'}
                className="p-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] disabled:opacity-40 text-[var(--chess-text-primary)] transition-colors"
                title="В начало партии (Home / Стрелка вверх)"
              >
                <ChevronFirst className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={goToPrev}
                disabled={!currentNode.parentId}
                className="p-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] disabled:opacity-40 text-[var(--chess-text-primary)] transition-colors"
                title="Предыдущий ход (Стрелка влево)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setAutoPlaying(!isAutoPlaying)}
                className={`px-2.5 py-1.5 rounded font-semibold text-xs transition-colors flex items-center gap-1 ${
                  isAutoPlaying
                    ? 'bg-[#F39C36] text-white'
                    : 'bg-[#779954] hover:bg-[#62934B] text-white'
                }`}
                title="Автовоспроизведение партии"
              >
                {isAutoPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span className="hidden sm:inline">Пауза</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span className="hidden sm:inline">Авто</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={goToNext}
                disabled={currentNode.children.length === 0}
                className="p-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] disabled:opacity-40 text-[var(--chess-text-primary)] transition-colors"
                title="Следующий ход (Стрелка вправо)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={goToEnd}
                disabled={currentNode.children.length === 0}
                className="p-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] disabled:opacity-40 text-[var(--chess-text-primary)] transition-colors"
                title="В конец партии (End / Стрелка вниз)"
              >
                <ChevronLast className="w-4 h-4" />
              </button>

              {/* One-Click Return from Alternative Variation Branch to Mainline */}
              {!currentNode.isMainline && (
                <button
                  type="button"
                  onClick={returnToMainline}
                  className="ml-1 px-2.5 py-1.5 rounded bg-[#36A9E1] hover:bg-[#2B93C7] text-white text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap shadow-xs"
                  title="Вернуться из альтернативной ветки к основной партии одним нажатием"
                >
                  <CornerUpLeft className="w-3.5 h-3.5" />
                  <span>К основной</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Quick Full Analysis Button when Left Sidebar is hidden (< xl) */}
              {isBatchAnalyzing ? (
                <button
                  type="button"
                  onClick={cancelFullGameAnalysis}
                  className="xl:hidden px-2.5 py-1.5 rounded bg-[#E05252] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                >
                  <Square className="w-3 h-3" />
                  <span className="font-mono-tabular">
                    Стоп ({batchProgress.current}/{batchProgress.total})
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    runFullGameAnalysis(settings.engineConfig.depth, settings.thresholds)
                  }
                  className="xl:hidden px-2.5 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                  title="Запустить полный анализ партии"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Анализ</span>
                </button>
              )}

              <button
                type="button"
                onClick={flipBoard}
                className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-xs font-medium text-[var(--chess-text-primary)] transition-colors flex items-center gap-1.5 whitespace-nowrap"
                title="Перевернуть доску (клавиша F)"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Переворот</span>
              </button>
            </div>
          </div>
        </section>

          {/* Right / Bottom Zone: Analysis Panel (Ходы | Анализ | Статистика | Партия) */}
          <AnalysisPanel engineState={engineState} />
        </main>
      )}

      {/* Modals */}
      <ImportModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} />
      <ChessComModal isOpen={isChessComModalOpen} onClose={() => setIsChessComModalOpen(false)} />
      <SavedGamesModal
        isOpen={isSavedGamesModalOpen}
        onClose={() => setIsSavedGamesModalOpen(false)}
      />
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
    </div>
  );
}
