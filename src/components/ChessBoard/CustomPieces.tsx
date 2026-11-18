import React from 'react';
import { PIECE_ASSETS } from '../../utils/assets';

type PieceCode = 'wP' | 'wN' | 'wB' | 'wR' | 'wQ' | 'wK' | 'bP' | 'bN' | 'bB' | 'bR' | 'bQ' | 'bK';

/**
 * Clean, rounded SVG chess pieces with uniform stroke width and balanced proportions.
 * All pieces are horizontally centered at x = 22.5 and share an identical bottom baseline (y = 39.25)
 * while the full piece set is vertically centered within the 45x45 square.
 */
const ClassicSvgPiece: React.FC<{ piece: PieceCode }> = ({ piece }) => {
  const isWhite = piece.startsWith('w');
  const fill = isWhite ? '#FFFFFF' : '#2C2C2C';
  const stroke = isWhite ? '#333333' : '#1A1A1A';
  const innerStroke = isWhite ? '#333333' : '#DFDFDF';
  const type = piece[1];

  return (
    <svg viewBox="0 0 45 45" className="w-full h-full block select-none pointer-events-none">
      {type === 'P' && (
        <g transform="translate(0, 0.75)">
          <path
            d="M 22.5,9 C 19.5,9 17,11.5 17,14.5 C 17,16.8 18.4,18.7 20.4,19.5 C 17.5,21.2 15.5,24.5 15.5,29 L 29.5,29 C 29.5,24.5 27.5,21.2 24.6,19.5 C 26.6,18.7 28,16.8 28,14.5 C 28,11.5 25.5,9 22.5,9 z M 12.5,32 L 32.5,32 C 33.5,32 34,33 34,34.5 L 11,34.5 C 11,33 11.5,32 12.5,32 z M 11,36 L 34,36 L 34,38.5 L 11,38.5 L 11,36 z"
            fill={fill}
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {type === 'R' && (
        <g
          transform="translate(0, 0.75)"
          fill={fill}
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 11,38.5 L 34,38.5 L 33,35 L 12,35 L 11,38.5 z" />
          <path d="M 14,35 L 14,20 L 31,20 L 31,35 L 14,35 z" />
          <path d="M 12,20 L 33,20 L 33,12 L 29,12 L 29,15 L 25,15 L 25,12 L 20,12 L 20,15 L 16,15 L 16,12 L 12,12 L 12,20 z" />
        </g>
      )}
      {type === 'N' && (
        <g
          transform="translate(0.5, 0.25)"
          fill={fill}
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18" />
          <path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10" />
          <circle cx="15.5" cy="14.5" r="1.2" fill={innerStroke} stroke="none" />
        </g>
      )}
      {type === 'B' && (
        <g
          transform="translate(0, 0.35)"
          fill={fill}
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.646,38.99 6.677,38.97 6,38 C 7.354,36.06 9,36 9,36 z" />
          <path d="M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z" />
          <circle cx="22.5" cy="8" r="2.2" />
          <path d="M 19.5,18.5 L 25.5,18.5 M 22.5,15.5 L 22.5,21.5" stroke={innerStroke} strokeWidth="1.8" />
        </g>
      )}
      {type === 'Q' && (
        <g
          transform="translate(0, 0)"
          fill={fill}
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z" />
          <path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" />
          <circle cx="6" cy="12" r="1.8" />
          <circle cx="14" cy="9" r="1.8" />
          <circle cx="22.5" cy="8" r="1.8" />
          <circle cx="31" cy="9" r="1.8" />
          <circle cx="39" cy="12" r="1.8" />
        </g>
      )}
      {type === 'K' && (
        <g
          transform="translate(0, -0.375)"
          fill={fill}
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 22.5,11.63 L 22.5,6" />
          <path d="M 20,8 L 25,8" />
          <path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" />
          <path d="M 11.5,37 C 17,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 19,16 9.5,13 6.5,19.5 C 3.5,25.5 11.5,29.5 11.5,29.5 L 11.5,37 z" />
        </g>
      )}
    </svg>
  );
};

export function createCustomPieceRenderers(
  pieceSet: 'neo' | 'classic_svg',
  selectedSquare?: string | null
) {
  const pieces: PieceCode[] = [
    'wP', 'wN', 'wB', 'wR', 'wQ', 'wK',
    'bP', 'bN', 'bB', 'bR', 'bQ', 'bK',
  ];

  const renderers: Record<
    string,
    (props?: {
      fill?: string;
      square?: string;
      svgStyle?: React.CSSProperties;
    }) => React.JSX.Element
  > = {};

  for (const code of pieces) {
    renderers[code] = (props) => {
      const isSelected = Boolean(selectedSquare && props?.square === selectedSquare);
      const scaleStyle: React.CSSProperties = isSelected
        ? {
            transform: 'scale(1.12)',
            transition: 'transform 150ms cubic-bezier(0.2, 0, 0, 1)',
          }
        : {
            transform: 'scale(1)',
            transition: 'transform 150ms cubic-bezier(0.2, 0, 0, 1)',
          };

      if (pieceSet === 'classic_svg') {
        return (
          <div
            style={scaleStyle}
            className="w-full h-full flex items-center justify-center select-none pointer-events-none"
          >
            <ClassicSvgPiece piece={code} />
          </div>
        );
      }

      return (
        <div
          style={scaleStyle}
          className="w-full h-full flex items-center justify-center select-none pointer-events-none"
        >
          <img
            src={PIECE_ASSETS[code]}
            alt={code}
            referrerPolicy="no-referrer"
            draggable={false}
            className="w-full h-full block object-contain object-center select-none pointer-events-none drop-shadow-[0_0_1px_rgba(0,0,0,0.18)]"
          />
        </div>
      );
    };
  }

  return renderers;
}
