import React, { useEffect, useRef } from 'react';
import { MoveNode } from '../../types/chess';
import { useGameStore } from '../../stores/useGameStore';
import { getMainlineNodes } from '../../core/chess/VariationTree';
import { openingBook } from '../../core/chess/OpeningBook';
import { CATEGORY_ICONS, CATEGORY_META } from '../../utils/assets';
import { formatEvalScore } from '../EvaluationBar/EvaluationBar';
import { BookOpen, GitBranch, Trash2 } from 'lucide-react';

interface MovePairRow {
  moveNumber: number;
  white?: MoveNode;
  black?: MoveNode;
  variationsAfterWhite: MoveNode[];
  variationsAfterBlack: MoveNode[];
}

export const MoveList: React.FC = () => {
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const openingSummary = useGameStore((s) => s.openingSummary);
  const selectNode = useGameStore((s) => s.selectNode);
  const deleteVariation = useGameStore((s) => s.deleteVariation);

  const activeRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentNodeId]);

  const mainline = getMainlineNodes(rootNode);

  // Group mainline moves into (White, Black) pairs by moveNumber
  const pairs: MovePairRow[] = [];
  for (let i = 1; i < mainline.length; i++) {
    const node = mainline[i];
    const parent = mainline[i - 1];
    const siblingVariations = parent.children.slice(1);

    if (node.color === 'w') {
      pairs.push({
        moveNumber: node.moveNumber,
        white: node,
        variationsAfterWhite: siblingVariations,
        variationsAfterBlack: [],
      });
    } else {
      const lastPair = pairs[pairs.length - 1];
      if (lastPair && lastPair.moveNumber === node.moveNumber && !lastPair.black) {
        lastPair.black = node;
        lastPair.variationsAfterBlack = siblingVariations;
      } else {
        pairs.push({
          moveNumber: node.moveNumber,
          black: node,
          variationsAfterWhite: [],
          variationsAfterBlack: siblingVariations,
        });
      }
    }
  }

  // Also check if the last mainline node has children (or variations)
  const renderVariationBranch = (startNode: MoveNode, depthLevel = 0): React.ReactNode => {
    const branchNodes: MoveNode[] = [];
    const subVariations: Array<{ afterNodeId: string; branchRoot: MoveNode }> = [];

    let curr: MoveNode | undefined = startNode;
    while (curr) {
      branchNodes.push(curr);
      if (curr.children.length > 1) {
        for (const subVar of curr.children.slice(1)) {
          subVariations.push({ afterNodeId: curr.id, branchRoot: subVar });
        }
      }
      curr = curr.children[0];
    }

    return (
      <React.Fragment key={startNode.id}>
        <div
          style={{ marginLeft: `${Math.min(24 + depthLevel * 12, 48)}px` }}
          className="my-1 mr-2 px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs flex items-center justify-between gap-2"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <GitBranch className="w-3 h-3 text-[#36A9E1] shrink-0" />
            {branchNodes.map((vn, idx) => {
              const isSelected = vn.id === currentNodeId;
              const showNum = idx === 0 || vn.color === 'w';
              const vAnalysis = vn.analysis;

              return (
                <button
                  key={vn.id}
                  type="button"
                  onClick={() => selectNode(vn.id)}
                  title={
                    vAnalysis
                      ? `${CATEGORY_META[vAnalysis.category].labelRu} (${formatEvalScore(
                          vAnalysis.evalAfterCp,
                          vAnalysis.mateAfter,
                          2,
                          vn.fen
                        )})`
                      : undefined
                  }
                  className={`px-1.5 py-0.5 rounded font-mono-tabular transition-colors inline-flex items-center gap-1 ${
                    isSelected
                      ? 'bg-[#36A9E1] text-white font-semibold'
                      : 'text-[var(--chess-text-primary)] hover:bg-[var(--chess-border)]'
                  }`}
                >
                  {vAnalysis && (
                    <img
                      src={CATEGORY_ICONS[vAnalysis.category]}
                      alt={vAnalysis.category}
                      referrerPolicy="no-referrer"
                      className="w-3.5 h-3.5 object-contain shrink-0"
                    />
                  )}
                  <span>
                    {showNum ? `${vn.moveNumber}${vn.color === 'w' ? '.' : '...'} ` : ''}
                    {vn.san}
                  </span>
                  {vAnalysis && (
                    <span
                      style={{
                        color: isSelected ? '#FFFFFF' : CATEGORY_META[vAnalysis.category].color,
                      }}
                      className="text-[10px] font-semibold opacity-90"
                    >
                      {formatEvalScore(vAnalysis.evalAfterCp, vAnalysis.mateAfter, 2, vn.fen)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => deleteVariation(startNode.id)}
            className="p-1 text-[var(--chess-text-secondary)] hover:text-[#E05252] transition-colors shrink-0"
            title="Удалить эту вариацию"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        {subVariations.map((sv) => renderVariationBranch(sv.branchRoot, depthLevel + 1))}
      </React.Fragment>
    );
  };

  const renderMoveCell = (node?: MoveNode) => {
    if (!node) {
      return <div className="flex-1 px-2.5 py-1.5 text-xs text-[var(--chess-text-secondary)]">...</div>;
    }

    const isSelected = node.id === currentNodeId;
    const analysis = node.analysis;
    const isBookPos =
      analysis?.isTheoretical ??
      Boolean(openingBook.isPositionInTheory(node.fen) && node.ply <= 24);
    const isLastTheory =
      node.ply === openingSummary.lastTheoreticalPly && openingSummary.lastTheoreticalPly > 0;

    return (
      <div
        ref={isSelected ? activeRowRef : undefined}
        onClick={() => selectNode(node.id)}
        className={`flex-1 flex items-center justify-between px-2.5 py-1.5 cursor-pointer rounded transition-colors select-none ${
          isSelected
            ? 'bg-[#779954]/25 text-[var(--chess-text-primary)] font-bold ring-1 ring-[#779954]'
            : 'hover:bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)]'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {analysis ? (
            <img
              src={CATEGORY_ICONS[analysis.category]}
              alt={analysis.category}
              referrerPolicy="no-referrer"
              title={CATEGORY_META[analysis.category].labelRu}
              className="w-4 h-4 object-contain shrink-0"
            />
          ) : isBookPos ? (
            <span title="Теоретический дебютный ход (ECO)">
              <BookOpen className="w-3.5 h-3.5 text-[#A88865] shrink-0" />
            </span>
          ) : null}

          <span className="font-mono-tabular text-xs truncate">{node.san}</span>

          {isLastTheory && (
            <span
              title="Последний теоретический ход из дебютной книги"
              className="text-[10px] text-[#A88865] font-medium"
            >
              · конец книги
            </span>
          )}
        </div>

        {analysis && (
          <span
            style={{ color: CATEGORY_META[analysis.category].color }}
            className="text-[11px] font-mono-tabular font-medium ml-1 shrink-0"
          >
            {formatEvalScore(analysis.evalAfterCp, analysis.mateAfter, 2, node.fen)}
          </span>
        )}
      </div>
    );
  };

  if (pairs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-[var(--chess-text-secondary)]">
        <p>Список ходов пуст.</p>
        <p className="mt-1">Сделайте ход на доске или импортируйте партию PGN / Chess.com.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-[var(--chess-border)]/50">
      {pairs.map((pair) => {
        const whiteLeavesBook =
          pair.white && pair.white.ply === openingSummary.firstOutOfBookPly;
        const blackLeavesBook =
          pair.black && pair.black.ply === openingSummary.firstOutOfBookPly;

        return (
          <React.Fragment key={pair.moveNumber}>
            {whiteLeavesBook && (
              <div className="px-3 py-1 bg-[#A88865]/12 text-[#A88865] text-[11px] font-medium flex items-center justify-between">
                <span>Выход из дебютной теории</span>
                <span className="font-mono-tabular">
                  {pair.moveNumber}. {pair.white?.san}
                </span>
              </div>
            )}

            <div className="flex items-center px-2 py-0.5 gap-1">
              <span className="w-9 text-right pr-2 text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] select-none shrink-0">
                {pair.moveNumber}.
              </span>
              {renderMoveCell(pair.white)}
              {renderMoveCell(pair.black)}
            </div>

            {blackLeavesBook && (
              <div className="px-3 py-1 bg-[#A88865]/12 text-[#A88865] text-[11px] font-medium flex items-center justify-between">
                <span>Выход из дебютной теории</span>
                <span className="font-mono-tabular">
                  {pair.moveNumber}... {pair.black?.san}
                </span>
              </div>
            )}

            {pair.variationsAfterWhite.map((v) => renderVariationBranch(v))}
            {pair.variationsAfterBlack.map((v) => renderVariationBranch(v))}
          </React.Fragment>
        );
      })}
    </div>
  );
};
