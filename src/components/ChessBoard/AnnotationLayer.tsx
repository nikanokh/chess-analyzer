import React from 'react';
import { Square } from 'chess.js';
import { EngineLine, MoveCategory, UserArrow } from '../../types/chess';
import { CATEGORY_ICONS, CATEGORY_META } from '../../utils/assets';

interface AnnotationLayerProps {
  orientation: 'white' | 'black';
  showCoordinates?: boolean;
  lightSquareColor?: string;
  darkSquareColor?: string;
  userArrows: UserArrow[];
  previewArrow: { from: Square; to: Square; color: string } | null;
  engineLines: EngineLine[];
  showUserArrows: boolean;
  showEngineArrows: boolean;
  enginePrimaryColor: string;
  engineSecondaryColor: string;
  arrowWidth: number;
  arrowOpacity: number;
  moveBadge?: {
    square: Square;
    category: MoveCategory;
  } | null;
  onRemoveUserArrow?: (arrowId: string) => void;
}

/**
 * Converts a chess square ("e4") into normalized SVG coordinates (0..800, 0..800)
 * where each square is 100x100 units and its center is at (col*100 + 50, row*100 + 50).
 */
export function squareToSvgCoords(
  square: Square,
  orientation: 'white' | 'black'
): { x: number; y: number; topLeftX: number; topLeftY: number } {
  const fileCode = square.charCodeAt(0) - 97; // 0..7 for a..h
  const rankIndex = parseInt(square[1], 10) - 1; // 0..7 for 1..8

  const col = orientation === 'white' ? fileCode : 7 - fileCode;
  const row = orientation === 'white' ? 7 - rankIndex : rankIndex;

  return {
    x: col * 100 + 50,
    y: row * 100 + 50,
    topLeftX: col * 100,
    topLeftY: row * 100,
  };
}

function isOrangeArrowColor(color: string): boolean {
  const c = color.toLowerCase();
  return c === '#f39c36' || c === '#ff9f1c' || c === '#f59e0b';
}

function renderSvgArrow(params: {
  key: string;
  from: Square;
  to: Square;
  color: string;
  strokeWidth: number;
  opacity: number;
  orientation: 'white' | 'black';
  isDashed?: boolean;
  onClick?: () => void;
}) {
  const {
    key,
    from,
    to,
    color,
    strokeWidth,
    opacity,
    orientation,
    isDashed,
    onClick,
  } = params;
  if (from === to) return null;

  const start = squareToSvgCoords(from, orientation);
  const end = squareToSvgCoords(to, orientation);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;

  // Substantial thickness in the 800x800 SVG space, no outline, no numbers
  const effectiveWidth = Math.max(18, strokeWidth);
  const headLength = Math.max(42, effectiveWidth * 2.15);
  const headWidth = Math.max(50, effectiveWidth * 2.55);

  const startX = start.x + ux * 18;
  const startY = start.y + uy * 18;
  const baseCenterX = end.x - ux * headLength;
  const baseCenterY = end.y - uy * headLength;

  const tipX = end.x - ux * 4;
  const tipY = end.y - uy * 4;

  const leftCornerX = baseCenterX + px * (headWidth / 2);
  const leftCornerY = baseCenterY + py * (headWidth / 2);
  const rightCornerX = baseCenterX - px * (headWidth / 2);
  const rightCornerY = baseCenterY - py * (headWidth / 2);

  const polygonPoints = `${tipX},${tipY} ${leftCornerX},${leftCornerY} ${rightCornerX},${rightCornerY}`;

  const effectiveOpacity = isOrangeArrowColor(color)
    ? Math.min(0.58, opacity)
    : opacity;

  return (
    <g
      key={key}
      opacity={effectiveOpacity}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      className={onClick ? 'cursor-pointer pointer-events-auto hover:opacity-85' : 'pointer-events-none'}
    >
      <line
        x1={startX}
        y1={startY}
        x2={baseCenterX}
        y2={baseCenterY}
        stroke={color}
        strokeWidth={effectiveWidth}
        strokeLinecap="butt"
        strokeDasharray={isDashed ? '16 10' : undefined}
      />
      <circle cx={startX} cy={startY} r={effectiveWidth / 2} fill={color} />
      <polygon points={polygonPoints} fill={color} />
    </g>
  );
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  orientation,
  showCoordinates = true,
  lightSquareColor = '#EEEED2',
  darkSquareColor = '#769656',
  userArrows,
  previewArrow,
  engineLines,
  showUserArrows,
  showEngineArrows,
  enginePrimaryColor,
  engineSecondaryColor,
  arrowWidth,
  arrowOpacity,
  moveBadge,
  onRemoveUserArrow,
}) => {
  const engineArrowsToRender: Array<{
    key: string;
    from: Square;
    to: Square;
    color: string;
    rank: number;
  }> = [];

  if (showEngineArrows && engineLines.length > 0) {
    const seenPairs = new Set<string>();
    const reversedLines = [...engineLines].reverse();

    for (const line of reversedLines) {
      const firstUci = line.pv?.[0];
      if (!firstUci || firstUci.length < 4) continue;
      const from = firstUci.slice(0, 2) as Square;
      const to = firstUci.slice(2, 4) as Square;
      const pairKey = `${from}-${to}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const isPrimary = line.multipv === 1;
      engineArrowsToRender.push({
        key: `engine_${line.multipv}_${pairKey}`,
        from,
        to,
        color: isPrimary ? enginePrimaryColor : engineSecondaryColor,
        rank: line.multipv,
      });
    }
  }

  const badgeCoords = moveBadge ? squareToSvgCoords(moveBadge.square, orientation) : null;

  return (
    <svg
      viewBox="0 0 800 800"
      className="absolute inset-0 w-full h-full pointer-events-none z-20 select-none"
    >
      {/* 0. Proportional SVG Board Coordinates (1..8 and a..h) that scale strictly with board size */}
      {showCoordinates && (
        <g className="pointer-events-none select-none" style={{ fontFamily: 'var(--font-sans)' }}>
          {Array.from({ length: 8 }).map((_, rowIdx) => {
            const rankLabel = orientation === 'white' ? String(8 - rowIdx) : String(rowIdx + 1);
            // (col=0, row=rowIdx): even sum is light square, odd sum is dark square
            const isLightSquare = rowIdx % 2 === 0;
            const textColor = isLightSquare ? darkSquareColor : lightSquareColor;
            return (
              <text
                key={`rank_${rowIdx}`}
                x={6}
                y={rowIdx * 100 + 23}
                fill={textColor}
                fontSize="21"
                fontWeight="700"
              >
                {rankLabel}
              </text>
            );
          })}

          {Array.from({ length: 8 }).map((_, colIdx) => {
            const fileLabel =
              orientation === 'white'
                ? String.fromCharCode(97 + colIdx)
                : String.fromCharCode(97 + (7 - colIdx));
            // (col=colIdx, row=7): even sum is light square, odd sum is dark square
            const isLightSquare = (colIdx + 7) % 2 === 0;
            const textColor = isLightSquare ? darkSquareColor : lightSquareColor;
            return (
              <text
                key={`file_${colIdx}`}
                x={colIdx * 100 + 94}
                y={793}
                textAnchor="end"
                fill={textColor}
                fontSize="21"
                fontWeight="700"
              >
                {fileLabel}
              </text>
            );
          })}
        </g>
      )}

      {/* 1. Stockfish Engine Arrows (without numbers or outlines) */}
      {engineArrowsToRender.map((ea) =>
        renderSvgArrow({
          key: ea.key,
          from: ea.from,
          to: ea.to,
          color: ea.color,
          strokeWidth: ea.rank === 1 ? arrowWidth + 2 : Math.max(16, arrowWidth - 3),
          opacity: ea.rank === 1 ? arrowOpacity : Math.max(0.45, arrowOpacity - 0.15),
          orientation,
        })
      )}

      {/* 2. User Drawn Arrows */}
      {showUserArrows &&
        userArrows.map((ua) =>
          renderSvgArrow({
            key: ua.id,
            from: ua.from,
            to: ua.to,
            color: ua.color,
            strokeWidth: Math.max(18, ua.width || arrowWidth),
            opacity: ua.opacity || arrowOpacity,
            orientation,
            onClick: onRemoveUserArrow ? () => onRemoveUserArrow(ua.id) : undefined,
          })
        )}

      {/* 3. Live Preview Arrow */}
      {showUserArrows &&
        previewArrow &&
        renderSvgArrow({
          key: 'preview_arrow',
          from: previewArrow.from,
          to: previewArrow.to,
          color: previewArrow.color,
          strokeWidth: Math.max(18, arrowWidth),
          opacity: 0.5,
          orientation,
        })}

      {/* 4. Official Move Quality Badge on Destination Square (no white circle ring) */}
      {moveBadge && badgeCoords && (
        <g
          transform={`translate(${badgeCoords.topLeftX + 66}, ${badgeCoords.topLeftY - 4})`}
          className="pointer-events-none"
        >
          <title>{CATEGORY_META[moveBadge.category].labelRu}</title>
          <image
            href={CATEGORY_ICONS[moveBadge.category]}
            x="0"
            y="0"
            width="38"
            height="38"
          />
        </g>
      )}
    </svg>
  );
};
