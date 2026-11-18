import React from 'react';
import { Chess } from 'chess.js';
import { cpToWhiteWinProbability } from '../../core/analysis/AccuracyCalculator';

interface EvaluationBarProps {
  cp?: number;
  mate?: number;
  fen?: string;
  orientation: 'white' | 'black';
  visible: boolean;
}

export type TerminalGameScore = '1-0' | '0-1' | '1/2-1/2' | null;

/**
 * Inspects a FEN string to determine if the position on the board is already checkmate, stalemate, or draw.
 * Returns '1-0' if White delivered checkmate, '0-1' if Black delivered checkmate,
 * '1/2-1/2' if stalemate or draw, or null if the game is still in progress.
 */
export function getTerminalScoreFromFen(fen?: string): TerminalGameScore {
  if (!fen) return null;
  try {
    const chess = new Chess(fen);
    if (!chess.isGameOver()) return null;
    if (chess.isCheckmate()) {
      // The side whose turn it is has been checkmated
      return chess.turn() === 'b' ? '1-0' : '0-1';
    }
    return '1/2-1/2';
  } catch {
    return null;
  }
}

/**
 * Formats centipawn evaluation with hundredths precision (e.g. "+0.38", "-1.24", "0.00"),
 * forced mate ("M3", "-M2"), or terminal board result ("1-0", "0-1", "1/2-1/2").
 */
export function formatEvalScore(
  cp?: number,
  mate?: number,
  decimals: number = 2,
  fen?: string
): string {
  const terminal = getTerminalScoreFromFen(fen);
  if (terminal) {
    return terminal;
  }

  if (mate !== undefined && mate !== null) {
    if (mate === 0) return '1/2-1/2';
    return `${mate > 0 ? '' : '-'}M${Math.abs(mate)}`;
  }
  if (cp === undefined || cp === null) {
    return (0).toFixed(decimals);
  }
  const pawns = cp / 100;
  if (Math.abs(pawns) < 0.005) {
    return (0).toFixed(decimals);
  }
  const effectiveDecimals = Math.abs(pawns) >= 10 ? 1 : decimals;
  const formatted = Math.abs(pawns).toFixed(effectiveDecimals);
  if (pawns > 0) return `+${formatted}`;
  if (pawns < 0) return `-${formatted}`;
  return (0).toFixed(decimals);
}

export const EvaluationBar: React.FC<EvaluationBarProps> = ({
  cp = 0,
  mate,
  fen,
  orientation,
  visible,
}) => {
  if (!visible) return null;

  const terminalScore = getTerminalScoreFromFen(fen);

  // Calculate White's bar percentage (0..100)
  let whitePercent: number;
  if (terminalScore === '1-0') {
    whitePercent = 100;
  } else if (terminalScore === '0-1') {
    whitePercent = 0;
  } else if (terminalScore === '1/2-1/2') {
    whitePercent = 50;
  } else if (mate !== undefined && mate !== null) {
    whitePercent = mate > 0 ? 100 : 0;
  } else {
    const rawWhitePercent = cpToWhiteWinProbability(cp, mate);
    whitePercent = Math.max(4, Math.min(96, rawWhitePercent));
  }

  const isWhiteAdvantage =
    terminalScore === '1-0'
      ? true
      : terminalScore === '0-1'
      ? false
      : terminalScore === '1/2-1/2'
      ? true
      : mate !== undefined && mate !== null
      ? mate >= 0
      : cp >= 0;

  const scoreLabel = formatEvalScore(cp, mate, 2, fen);
  const isWhiteBottom = orientation === 'white';
  const isDrawResult = terminalScore === '1/2-1/2';

  return (
    <div
      className="relative w-8 sm:w-10 self-stretch rounded-md overflow-hidden border border-[var(--chess-border)] bg-[#1F1D1B] flex flex-col select-none shrink-0"
      title={`Оценка позиции: ${scoreLabel}`}
    >
      {/* White bar section */}
      <div
        style={{
          height: `${whitePercent}%`,
          order: isWhiteBottom ? 2 : 1,
        }}
        className="w-full bg-[#FFFFFF] transition-all duration-300 ease-out"
      />
      {/* Black bar section */}
      <div
        style={{
          height: `${100 - whitePercent}%`,
          order: isWhiteBottom ? 1 : 2,
        }}
        className="w-full bg-[#1F1D1B] transition-all duration-300 ease-out"
      />

      {/* Center 0.00 equilibrium tick mark */}
      <div className="absolute left-0 right-0 top-1/2 h-[1.5px] bg-[#779954]/80 pointer-events-none z-10" />

      {/* Numerical Score Readout or Terminal Result (1-0, 0-1, 1/2-1/2) */}
      <span
        className={`absolute left-0 right-0 text-center font-bold font-mono-tabular tracking-tighter leading-none z-20 px-0.5 ${
          isDrawResult
            ? 'top-1/2 -translate-y-1/2 py-0.5 bg-[#262421]/90 text-[#FFFFFF] text-[8.5px] sm:text-[9px]'
            : `${
                terminalScore ? 'text-[9.5px] sm:text-[10.5px]' : 'text-[9px] sm:text-[9.5px]'
              } ${
                isWhiteAdvantage
                  ? isWhiteBottom
                    ? 'bottom-1.5 text-[#1F1D1B]'
                    : 'top-1.5 text-[#1F1D1B]'
                  : isWhiteBottom
                  ? 'top-1.5 text-[#FFFFFF]'
                  : 'bottom-1.5 text-[#FFFFFF]'
              }`
        }`}
      >
        {scoreLabel}
      </span>
    </div>
  );
};
