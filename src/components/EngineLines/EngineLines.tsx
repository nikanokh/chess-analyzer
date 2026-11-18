import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { EngineState } from '../../types/chess';
import { useGameStore } from '../../stores/useGameStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { findNodeById } from '../../core/chess/VariationTree';
import { fetchLichessOpeningStats } from '../../services/LichessApi/lichessOpeningService';
import { CATEGORY_ICONS, CATEGORY_META } from '../../utils/assets';
import { formatEvalScore } from '../EvaluationBar/EvaluationBar';
import { BookOpen, Cpu, Layers, Sparkles, TrendingUp } from 'lucide-react';

interface EngineLinesProps {
  engineState: EngineState;
}

export const EngineLines: React.FC<EngineLinesProps> = ({ engineState }) => {
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const openingSummary = useGameStore((s) => s.openingSummary);
  const makeMove = useGameStore((s) => s.makeMove);

  const settings = useSettingsStore((s) => s.settings);
  const updateEngineConfig = useSettingsStore((s) => s.updateEngineConfig);

  const currentNode = findNodeById(rootNode, currentNodeId) || rootNode;
  const moveAnalysis = currentNode.analysis;

  // Query Lichess Opening Explorer for popular master continuations in the first 24 plies
  const { data: lichessStats } = useQuery({
    queryKey: ['lichessOpeningExplorer', currentNode.fen],
    queryFn: () => fetchLichessOpeningStats(currentNode.fen),
    enabled: currentNode.ply <= 24,
    staleTime: 1000 * 60 * 30,
  });

  const primaryLine = engineState.lines[0];

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* 1. Current Move Review Card (if this move was analyzed or selected) */}
      {moveAnalysis && (
        <div
          style={{ backgroundColor: CATEGORY_META[moveAnalysis.category].bgColor }}
          className="p-3 rounded-md border border-[var(--chess-border)] space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <img
                src={CATEGORY_ICONS[moveAnalysis.category]}
                alt={moveAnalysis.category}
                referrerPolicy="no-referrer"
                className="w-6 h-6 object-contain"
              />
              <div>
                <div className="text-xs font-bold text-[var(--chess-text-primary)]">
                  {moveAnalysis.moveNumber}
                  {moveAnalysis.player === 'w' ? '.' : '...'} {moveAnalysis.san} —{' '}
                  <span style={{ color: CATEGORY_META[moveAnalysis.category].color }}>
                    {CATEGORY_META[moveAnalysis.category].labelRu}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--chess-text-secondary)] font-mono-tabular">
                  Точность хода: {moveAnalysis.moveAccuracy}% · Потеря (CPL): {moveAnalysis.cpl}
                </div>
              </div>
            </div>

            <div className="text-right font-mono-tabular">
              <div className="text-xs font-bold text-[var(--chess-text-primary)]">
                {formatEvalScore(
                  moveAnalysis.evalAfterCp,
                  moveAnalysis.mateAfter,
                  2,
                  moveAnalysis.fenAfter
                )}
              </div>
              <div className="text-[10px] text-[var(--chess-text-secondary)]">
                было{' '}
                {formatEvalScore(
                  moveAnalysis.evalBeforeCp,
                  moveAnalysis.mateBefore,
                  2,
                  moveAnalysis.fenBefore
                )}
              </div>
            </div>
          </div>

          {moveAnalysis.category !== 'Best' &&
            moveAnalysis.category !== 'Book' &&
            moveAnalysis.bestMoveSan && (
              <div className="pt-1.5 border-t border-[var(--chess-border)]/60 text-xs flex items-center justify-between">
                <span className="text-[var(--chess-text-secondary)]">Лучший ход Stockfish:</span>
                <span className="font-mono-tabular font-semibold text-[#779954]">
                  {moveAnalysis.bestMoveSan} (
                  {moveAnalysis.bestLineSan.slice(0, 4).join(' ')})
                </span>
              </div>
            )}
        </div>
      )}

      {/* 2. Real-time Stockfish UCI Header & Quick Controls */}
      <div className="p-3 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#779954]" />
            <span className="text-xs font-bold text-[var(--chess-text-primary)]">
              Stockfish 16 WebAssembly
            </span>
          </div>
          <div className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)]">
            Глубина {engineState.currentDepth}/{settings.engineConfig.depth}
            {engineState.nps > 0 ? ` · ${Math.round(engineState.nps / 1000)} kN/s` : ''}
          </div>
        </div>

        {/* Quick UCI Sliders: Depth & MultiPV */}
        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[var(--chess-border)] text-xs">
          <div>
            <div className="flex justify-between text-[11px] text-[var(--chess-text-secondary)] mb-1">
              <span>Глубина (Depth)</span>
              <span className="font-mono-tabular font-semibold text-[var(--chess-text-primary)]">
                {settings.engineConfig.depth}
              </span>
            </div>
            <input
              type="range"
              min={8}
              max={30}
              value={settings.engineConfig.depth}
              onChange={(e) => updateEngineConfig({ depth: Number(e.target.value) })}
              className="w-full accent-[#779954] cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-[var(--chess-text-secondary)] mb-1">
              <span>Линии (MultiPV)</span>
              <span className="font-mono-tabular font-semibold text-[var(--chess-text-primary)]">
                {settings.engineConfig.multiPv}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              value={settings.engineConfig.multiPv}
              onChange={(e) => updateEngineConfig({ multiPv: Number(e.target.value) })}
              className="w-full accent-[#36A9E1] cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 3. Live Stockfish MultiPV Continuation Lines */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-[var(--chess-text-primary)]">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#36A9E1]" />
            Варианты движка (MultiPV)
          </span>
          {primaryLine?.pvSan?.[0] && (
            <span className="text-[11px] font-mono-tabular text-[#779954]">
              Лучший ход: {primaryLine.pvSan[0]}
            </span>
          )}
        </div>

        {engineState.lines.length === 0 ? (
          <div className="p-3 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-secondary)]">
            {engineState.isAnalyzing ? 'Расчёт вариантов Stockfish...' : 'Оценка позиции завершена.'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {engineState.lines.map((line) => {
              const scoreText = formatEvalScore(line.cp, line.mate);
              const isPrimary = line.multipv === 1;
              const firstSan = line.pvSan?.[0];

              return (
                <div
                  key={line.multipv}
                  onClick={() => {
                    if (firstSan) {
                      makeMove(firstSan);
                    }
                  }}
                  title="Нажмите, чтобы сделать первый ход этого варианта на доске"
                  className="p-2.5 rounded-md bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)]/50 border border-[var(--chess-border)] cursor-pointer transition-colors flex items-start gap-2.5"
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold font-mono-tabular shrink-0 ${
                      isPrimary
                        ? 'bg-[#779954] text-white'
                        : 'bg-[#36A9E1]/20 text-[#36A9E1]'
                    }`}
                  >
                    {scoreText}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono-tabular text-[var(--chess-text-primary)] leading-relaxed break-words">
                      {(line.pvSan && line.pvSan.length > 0 ? line.pvSan : line.pv).map(
                        (mv, idx) => (
                          <span
                            key={idx}
                            className={idx === 0 ? 'font-bold underline decoration-[#779954]' : ''}
                          >
                            {mv}{' '}
                          </span>
                        )
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--chess-text-secondary)] font-mono-tabular mt-0.5">
                      Линия #{line.multipv} · глубина {line.depth}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Opening Theory vs Popular Moves vs Engine Move Separation (Section 16.3 & 16.4) */}
      <div className="p-3 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--chess-text-primary)] flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-[#A88865]" />
            Дебютная теория и статистика
          </span>
          <span className="text-[10px] font-mono-tabular text-[var(--chess-text-secondary)]">
            ECO {openingSummary.eco}
          </span>
        </div>

        <div className="text-xs space-y-1.5">
          <div>
            <span className="text-[var(--chess-text-secondary)]">1. Классификация ECO: </span>
            <span className="font-semibold text-[var(--chess-text-primary)]">
              {openingSummary.name} ({openingSummary.variation})
            </span>
          </div>

          {openingSummary.mainBookContinuationSan.length > 0 && (
            <div>
              <span className="text-[var(--chess-text-secondary)]">
                2. Главная теоретическая линия книги:{' '}
              </span>
              <span className="font-mono-tabular font-medium text-[#A88865]">
                {openingSummary.mainBookContinuationSan.join(' → ')}
              </span>
            </div>
          )}

          {primaryLine?.pvSan?.[0] && (
            <div>
              <span className="text-[var(--chess-text-secondary)]">
                3. Сильнейший ход Stockfish:{' '}
              </span>
              <span className="font-mono-tabular font-semibold text-[#779954]">
                {primaryLine.pvSan[0]} ({formatEvalScore(primaryLine.cp, primaryLine.mate)})
              </span>
            </div>
          )}
        </div>

        {/* Popular Master Moves from Lichess Opening Explorer */}
        {lichessStats && lichessStats.moves.length > 0 && (
          <div className="pt-2 border-t border-[var(--chess-border)] space-y-1.5">
            <div className="text-[11px] font-semibold text-[var(--chess-text-secondary)] flex items-center justify-between">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-[#36A9E1]" />
                Популярные ходы мастеров (Lichess Masters DB)
              </span>
              <span>Партий</span>
            </div>
            <div className="space-y-1">
              {lichessStats.moves.slice(0, 4).map((m) => {
                const total = m.white + m.draws + m.black;
                if (total === 0) return null;
                const wPct = Math.round((m.white / total) * 100);
                const dPct = Math.round((m.draws / total) * 100);
                const bPct = Math.max(0, 100 - wPct - dPct);

                return (
                  <div
                    key={m.uci}
                    onClick={() => makeMove(m.san)}
                    className="flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded hover:bg-[var(--chess-border)]/50 cursor-pointer"
                  >
                    <span className="font-mono-tabular font-semibold w-12 text-[var(--chess-text-primary)]">
                      {m.san}
                    </span>
                    <div className="flex-1 h-2.5 rounded-sm overflow-hidden flex bg-[#262421]">
                      <div style={{ width: `${wPct}%` }} className="bg-[#EEEED2]" title={`Белые: ${wPct}%`} />
                      <div style={{ width: `${dPct}%` }} className="bg-[#888888]" title={`Ничьи: ${dPct}%`} />
                      <div style={{ width: `${bPct}%` }} className="bg-[#333333]" title={`Чёрные: ${bPct}%`} />
                    </div>
                    <span className="font-mono-tabular text-[11px] text-[var(--chess-text-secondary)] w-14 text-right">
                      {total.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-[10px] text-[var(--chess-text-secondary)] flex items-center justify-between pt-1 border-t border-[var(--chess-border)]">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#A88865]" />
            Источник: {openingSummary.source}
          </span>
          <span className="font-mono-tabular">{openingSummary.version}</span>
        </div>
      </div>
    </div>
  );
};
