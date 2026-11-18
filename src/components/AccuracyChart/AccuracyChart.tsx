import React from 'react';
import {
  Area,
  AreaChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useGameStore } from '../../stores/useGameStore';
import {
  findNodeById,
  getMainlineNodes,
  getPathToNode,
} from '../../core/chess/VariationTree';
import { CATEGORY_META } from '../../utils/assets';
import { formatEvalScore } from '../EvaluationBar/EvaluationBar';

interface ChartDataPoint {
  nodeId: string;
  ply: number;
  moveLabel: string;
  san: string;
  rawCp: number;
  evalPawns: number; // Smoothed visual value (-8..+8)
  whiteAdv: number; // >= 0 for White top fill
  blackAdv: number; // <= 0 for Black bottom fill
  rawScoreText: string; // Exact hundredths score e.g. +0.38
  category?: string;
  categoryRu?: string;
  isBlunderOrMistake: boolean;
  dotColor?: string;
}

export const AccuracyChart: React.FC = () => {
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const selectNode = useGameStore((s) => s.selectNode);

  const currentNode = findNodeById(rootNode, currentNodeId);
  const activeBranchNodes =
    currentNode && !currentNode.isMainline
      ? getPathToNode(rootNode, currentNodeId)
      : getMainlineNodes(rootNode);

  const analyzedNodes = activeBranchNodes.filter((n) => n.ply > 0 && n.analysis);

  // Convert raw centipawns into a nonlinearly compressed visual curve (-8..+8)
  const rawVisuals = analyzedNodes.map((n) => {
    const a = n.analysis!;
    if (a.mateAfter !== undefined) {
      return a.mateAfter > 0 ? 8 : -8;
    }
    return 7.6 * Math.tanh(a.evalAfterCp / 360);
  });

  // Smooth small centipawn oscillations (< 85 cp) on pure centipawn positions so the chart doesn't jitter on hundredths
  const smoothedVisuals = rawVisuals.map((val, idx) => {
    if (idx === 0 || idx === rawVisuals.length - 1) {
      return Number(val.toFixed(2));
    }
    const prevAnalysis = analyzedNodes[idx - 1].analysis!;
    const currAnalysis = analyzedNodes[idx].analysis!;
    const nextAnalysis = analyzedNodes[idx + 1].analysis!;

    if (
      prevAnalysis.mateAfter !== undefined ||
      currAnalysis.mateAfter !== undefined ||
      nextAnalysis.mateAfter !== undefined
    ) {
      return Number(val.toFixed(2));
    }

    const prevCp = prevAnalysis.evalAfterCp;
    const currCp = currAnalysis.evalAfterCp;
    const nextCp = nextAnalysis.evalAfterCp;

    const deltaPrev = Math.abs(currCp - prevCp);
    const deltaNext = Math.abs(nextCp - currCp);

    // Smooth minor oscillations while preserving real tactical swings
    if (deltaPrev < 85 && deltaNext < 85) {
      const avg = rawVisuals[idx - 1] * 0.25 + val * 0.5 + rawVisuals[idx + 1] * 0.25;
      return Number(avg.toFixed(2));
    }
    return Number(val.toFixed(2));
  });

  const data: ChartDataPoint[] = analyzedNodes.map((node, idx) => {
    const a = node.analysis!;
    const visualEval = smoothedVisuals[idx];
    const isMajorError =
      a.category === 'Blunder' ||
      a.category === 'Mistake' ||
      a.category === 'MissedChance';

    return {
      nodeId: node.id,
      ply: node.ply,
      moveLabel: `${node.moveNumber}${node.color === 'w' ? '.' : '...'}`,
      san: node.san,
      rawCp: a.evalAfterCp,
      evalPawns: visualEval,
      whiteAdv: Math.max(0, visualEval),
      blackAdv: Math.min(0, visualEval),
      rawScoreText: formatEvalScore(a.evalAfterCp, a.mateAfter, 2, node.fen),
      category: a.category,
      categoryRu: CATEGORY_META[a.category].labelRu,
      isBlunderOrMistake: isMajorError,
      dotColor: CATEGORY_META[a.category].color,
    };
  });

  if (data.length === 0) {
    return (
      <div className="h-40 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] flex items-center justify-center p-4 text-xs text-[var(--chess-text-secondary)] text-center">
        Запустите «Полный анализ» или сделайте ход на доске, чтобы построить интерактивный график преимущества.
      </div>
    );
  }

  const activePoint = data.find((d) => d.nodeId === currentNodeId);

  return (
    <div className="w-full h-46 rounded-md bg-[#3D3A36] border border-[var(--chess-border)] p-2.5 select-none">
      <div className="flex items-center justify-between px-1 mb-1.5 text-[11px] text-[#D4D0C8]">
        <div className="flex items-center gap-3">
          <span className="font-semibold">График преимущества</span>
          <span className="inline-flex items-center gap-1 text-[10px]">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#FFFFFF] border border-black/30 inline-block" />
            Белые (верх)
          </span>
          <span className="inline-flex items-center gap-1 text-[10px]">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#11100F] border border-white/30 inline-block" />
            Чёрные (низ)
          </span>
        </div>
        {activePoint && (
          <span className="font-mono-tabular text-white font-bold">
            {activePoint.moveLabel} {activePoint.san} ({activePoint.rawScoreText})
          </span>
        )}
      </div>

      <div className="w-full h-33 rounded bg-[#4A4641] overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 6, right: 8, left: -24, bottom: 0 }}
            onClick={(state) => {
              const idx =
                state && typeof state.activeTooltipIndex === 'number'
                  ? state.activeTooltipIndex
                  : -1;
              if (idx >= 0 && data[idx]?.nodeId) {
                selectNode(data[idx].nodeId);
              }
            }}
          >
            <XAxis
              dataKey="moveLabel"
              tick={{ fontSize: 10, fill: '#E5E1D8' }}
              axisLine={{ stroke: '#6E6962' }}
              tickLine={false}
            />
            <YAxis
              domain={[-8, 8]}
              ticks={[-5, 0, 5]}
              tick={{ fontSize: 10, fill: '#E5E1D8' }}
              axisLine={false}
              tickLine={false}
            />

            {/* Zero Equilibrium Reference Line */}
            <ReferenceLine y={0} stroke="#F39C36" strokeDasharray="3 3" strokeWidth={1.3} />

            {/* Current Active Move Vertical Indicator */}
            {activePoint && (
              <ReferenceLine
                x={activePoint.moveLabel}
                stroke="#36A9E1"
                strokeWidth={2}
              />
            )}

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const pt = payload[0].payload as ChartDataPoint;
                return (
                  <div className="bg-[#1B1A17] border border-[#555] rounded px-2.5 py-1.5 text-xs text-white shadow-lg">
                    <div className="font-bold font-mono-tabular">
                      {pt.moveLabel} {pt.san} · Оценка: {pt.rawScoreText}
                    </div>
                    {pt.categoryRu && (
                      <div style={{ color: pt.dotColor }} className="text-[11px] font-medium mt-0.5">
                        {pt.categoryRu}
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* Top Area (> 0): Highlighted in crisp White for White Advantage */}
            <Area
              type="monotone"
              dataKey="whiteAdv"
              stroke="#FFFFFF"
              strokeWidth={2}
              fill="#FFFFFF"
              fillOpacity={0.92}
              baseValue={0}
              isAnimationActive={false}
            />

            {/* Bottom Area (< 0): Highlighted in deep Black for Black Advantage */}
            <Area
              type="monotone"
              dataKey="blackAdv"
              stroke="#11100F"
              strokeWidth={2}
              fill="#11100F"
              fillOpacity={0.95}
              baseValue={0}
              isAnimationActive={false}
            />

            {/* Highlight Blunders and Mistakes as dots on the chart */}
            {data
              .filter((d) => d.isBlunderOrMistake)
              .map((errPt) => (
                <ReferenceDot
                  key={errPt.nodeId}
                  x={errPt.moveLabel}
                  y={errPt.evalPawns}
                  r={4.5}
                  fill={errPt.dotColor || '#E05252'}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
              ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
