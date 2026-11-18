import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { EngineLine } from '../../types/chess';
import { useGameStore } from '../../stores/useGameStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { findNodeById } from '../../core/chess/VariationTree';
import { createCustomPieceRenderers } from './CustomPieces';
import { AnnotationLayer } from './AnnotationLayer';
import { PIECE_ASSETS } from '../../utils/assets';
import {
  Crosshair,
  Eye,
  EyeOff,
  MousePointerClick,
  Trash2,
} from 'lucide-react';

interface ChessBoardViewProps {
  engineLines: EngineLine[];
}

const ARROW_PALETTE = [
  { label: 'Оранжевый (тактика)', color: '#F39C36' },
  { label: 'Голубой (альтернатива)', color: '#36A9E1' },
  { label: 'Зелёный (основной)', color: '#779954' },
  { label: 'Красный (угроза)', color: '#E05252' },
];

// Unified highlight color for the origin square during piece selection AND after move completion
const SQUARE_ORIGIN_AND_MOVE_HIGHLIGHT = 'rgba(245, 246, 130, 0.58)';

// Shared color and opacity for both legal move dots on empty squares and capture rings
const LEGAL_MOVE_INDICATOR_COLOR = 'rgba(0, 0, 0, 0.22)';

export const ChessBoardView: React.FC<ChessBoardViewProps> = ({ engineLines }) => {
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const makeMove = useGameStore((s) => s.makeMove);
  const toggleUserArrow = useGameStore((s) => s.toggleUserArrow);
  const removeUserArrow = useGameStore((s) => s.removeUserArrow);
  const toggleSquareHighlight = useGameStore((s) => s.toggleSquareHighlight);
  const clearNodeAnnotations = useGameStore((s) => s.clearNodeAnnotations);

  const settings = useSettingsStore((s) => s.settings);
  const activeBrushColor = useSettingsStore((s) => s.activeBrushColor);
  const setActiveBrushColor = useSettingsStore((s) => s.setActiveBrushColor);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [drawMode, setDrawMode] = useState<'move' | 'arrow' | 'highlight'>('move');
  const [arrowStartSquare, setArrowStartSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(
    null
  );

  const boardContainerRef = useRef<HTMLDivElement>(null);

  // Clear selected square when navigating between moves
  useEffect(() => {
    setSelectedSquare(null);
  }, [currentNodeId]);

  const currentNode = useMemo(
    () => findNodeById(rootNode, currentNodeId) || rootNode,
    [rootNode, currentNodeId]
  );

  const chessInstance = useMemo(() => {
    try {
      return new Chess(currentNode.fen);
    } catch {
      return new Chess();
    }
  }, [currentNode.fen]);

  const customPieces = useMemo(
    () => createCustomPieceRenderers(settings.pieceSet, selectedSquare),
    [settings.pieceSet, selectedSquare]
  );

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    // 1. User Square Highlights
    if (settings.showUserArrows) {
      for (const hl of currentNode.squareHighlights) {
        styles[hl.square] = {
          backgroundColor: `${hl.color}66`,
        };
      }
    }

    // 2. Highlight Last Move (uses same highlight logic for origin & destination squares)
    if (settings.highlightLastMove && currentNode.from && currentNode.to) {
      styles[currentNode.from] = {
        ...styles[currentNode.from],
        backgroundColor: SQUARE_ORIGIN_AND_MOVE_HIGHLIGHT,
      };
      styles[currentNode.to] = {
        ...styles[currentNode.to],
        backgroundColor: SQUARE_ORIGIN_AND_MOVE_HIGHLIGHT,
      };
    }

    // 3. Highlight Selected Square & Legal Moves
    if (selectedSquare && drawMode === 'move') {
      styles[selectedSquare] = {
        ...styles[selectedSquare],
        backgroundColor: SQUARE_ORIGIN_AND_MOVE_HIGHLIGHT,
      };

      if (settings.highlightLegalMoves) {
        const moves = chessInstance.moves({ square: selectedSquare, verbose: true });
        for (const m of moves) {
          const targetPiece = chessInstance.get(m.to as Square);
          const isCapture = Boolean(targetPiece || m.captured);
          if (isCapture) {
            styles[m.to] = {
              ...styles[m.to],
              backgroundImage: `radial-gradient(circle closest-side, transparent 0%, transparent 76%, ${LEGAL_MOVE_INDICATOR_COLOR} 77.5%, ${LEGAL_MOVE_INDICATOR_COLOR} 95.5%, transparent 97%)`,
            };
          } else {
            styles[m.to] = {
              ...styles[m.to],
              backgroundImage: `radial-gradient(circle closest-side, ${LEGAL_MOVE_INDICATOR_COLOR} 0%, ${LEGAL_MOVE_INDICATOR_COLOR} 28%, transparent 30%)`,
            };
          }
        }
      }
    }

    // 4. Highlight Arrow Start Square when in arrow drawing mode
    if (arrowStartSquare && drawMode === 'arrow') {
      styles[arrowStartSquare] = {
        ...styles[arrowStartSquare],
        boxShadow: `inset 0 0 0 4px ${activeBrushColor}`,
      };
    }

    // 5. Check / Checkmate indicator on King square
    if (chessInstance.inCheck()) {
      const turn = chessInstance.turn();
      const board = chessInstance.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          if (piece && piece.type === 'k' && piece.color === turn) {
            styles[piece.square] = {
              ...styles[piece.square],
              backgroundImage:
                'radial-gradient(circle, rgba(224, 82, 82, 0.9) 0%, rgba(224, 82, 82, 0.5) 55%, transparent 80%)',
            };
          }
        }
      }
    }

    return styles;
  }, [
    currentNode,
    selectedSquare,
    arrowStartSquare,
    drawMode,
    activeBrushColor,
    chessInstance,
    settings.highlightLastMove,
    settings.highlightLegalMoves,
    settings.showUserArrows,
  ]);

  const isPromotionMove = (from: Square, to: Square): boolean => {
    const piece = chessInstance.get(from);
    if (!piece || piece.type !== 'p') return false;
    const targetRank = to[1];
    return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1');
  };

  const handlePieceDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
    if (drawMode !== 'move') return false;
    if (sourceSquare === targetSquare) {
      return false;
    }

    if (isPromotionMove(sourceSquare, targetSquare)) {
      const testChess = new Chess(currentNode.fen);
      try {
        const legal = testChess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
        if (legal) {
          setSelectedSquare(null);
          setPendingPromotion({ from: sourceSquare, to: targetSquare });
          return true;
        }
      } catch {
        return false;
      }
    }

    const moved = makeMove({ from: sourceSquare, to: targetSquare, promotion: 'q' });
    if (moved) {
      setSelectedSquare(null);
    }
    return moved;
  };

  const handleSquareClick = (square: Square) => {
    if (drawMode === 'highlight') {
      toggleSquareHighlight(square, activeBrushColor);
      return;
    }

    if (drawMode === 'arrow') {
      if (!arrowStartSquare) {
        setArrowStartSquare(square);
      } else {
        if (arrowStartSquare !== square) {
          toggleUserArrow(
            arrowStartSquare,
            square,
            activeBrushColor,
            settings.arrowWidth,
            settings.arrowOpacity
          );
        }
        setArrowStartSquare(null);
      }
      return;
    }

    // Move mode
    if (selectedSquare) {
      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      if (isPromotionMove(selectedSquare, square)) {
        const testChess = new Chess(currentNode.fen);
        try {
          if (testChess.move({ from: selectedSquare, to: square, promotion: 'q' })) {
            setPendingPromotion({ from: selectedSquare, to: square });
            setSelectedSquare(null);
            return;
          }
        } catch {
          // fall through
        }
      }

      const moved = makeMove({ from: selectedSquare, to: square, promotion: 'q' });
      if (moved) {
        setSelectedSquare(null);
        return;
      }
    }

    // Select square if it has a piece of active turn
    const piece = chessInstance.get(square);
    if (piece && piece.color === chessInstance.turn()) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleSquareRightClick = (square: Square) => {
    toggleSquareHighlight(square, activeBrushColor);
  };

  const desktopMaxPx =
    settings.boardSize === 'small'
      ? '420px'
      : settings.boardSize === 'medium'
      ? '520px'
      : settings.boardSize === 'large'
      ? '660px'
      : '640px';

  const turnToPromote = chessInstance.turn();

  // Responsive board width class:
  // - Smartphones (<768px): full comfortable width w-[min(calc(100vw-56px),460px)]
  // - Tablets & Medium Desktops (768px..1279px, including ~1000px): side-by-side with AnalysisPanel, so w-[min(calc(100vw-395px),calc(100dvh-195px),var(--desktop-board-max))]
  // - Large Desktops (>=1280px): 3-column or 2-column depending on showLeftSidebar
  const responsiveBoardWidthClass = settings.showLeftSidebar
    ? 'w-[min(calc(100vw-56px),460px)] md:w-[min(calc(100vw-395px),calc(100dvh-195px),var(--desktop-board-max))] xl:w-[min(calc(100vw-780px),calc(100dvh-195px),var(--desktop-board-max))]'
    : 'w-[min(calc(100vw-56px),460px)] md:w-[min(calc(100vw-395px),calc(100dvh-195px),var(--desktop-board-max))]';

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-0">
      {/* Board Wrapper */}
      <div
        ref={boardContainerRef}
        style={{
          ['--desktop-board-max' as string]: desktopMaxPx,
          touchAction: 'none',
        }}
        className={`relative ${responsiveBoardWidthClass} aspect-square rounded-md overflow-hidden shadow-md border border-[var(--chess-border)] select-none shrink-0`}
      >
        <Chessboard
          options={{
            id: 'ChessAnalyzerBoard',
            position: currentNode.fen,
            boardOrientation: settings.boardOrientation,
            allowDragging: drawMode === 'move',
            dragActivationDistance: 4,
            canDragPiece: ({ square }) => {
              if (drawMode !== 'move' || !square) return false;
              const p = chessInstance.get(square as Square);
              return Boolean(p && p.color === chessInstance.turn());
            },
            showAnimations: settings.enableAnimations,
            animationDurationInMs: settings.enableAnimations ? 210 : 0,
            // Disabled built-in fixed-px notation in favor of proportional SVG coordinates in AnnotationLayer
            showNotation: false,
            boardStyle: {
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gridTemplateRows: 'repeat(8, 1fr)',
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              position: 'relative',
            },
            squareStyle: {
              aspectRatio: '1/1',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              position: 'relative',
              width: '100%',
              height: '100%',
            },
            dropSquareStyle: {},
            draggingPieceStyle: {
              transform: 'scale(1.12)',
            },
            draggingPieceGhostStyle: {
              opacity: 0,
            },
            lightSquareStyle: { backgroundColor: settings.lightSquareColor },
            darkSquareStyle: { backgroundColor: settings.darkSquareColor },
            squareStyles: customSquareStyles,
            pieces: customPieces,
            allowDrawingArrows: false,
            onPieceDrag: ({ square }) => {
              if (drawMode === 'move' && square) {
                const p = chessInstance.get(square as Square);
                if (p && p.color === chessInstance.turn()) {
                  setSelectedSquare(square as Square);
                }
              }
            },
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare) return false;
              return handlePieceDrop(sourceSquare as Square, targetSquare as Square);
            },
            onSquareClick: ({ square }) => {
              handleSquareClick(square as Square);
            },
            onSquareRightClick: ({ square }) => {
              handleSquareRightClick(square as Square);
            },
          }}
        />

        {/* Independent SVG Layer: Proportional Coordinates + Engine Arrows + User Arrows + Move Badges */}
        <AnnotationLayer
          orientation={settings.boardOrientation}
          showCoordinates={settings.showCoordinates}
          lightSquareColor={settings.lightSquareColor}
          darkSquareColor={settings.darkSquareColor}
          userArrows={currentNode.userArrows}
          previewArrow={null}
          engineLines={engineLines}
          showUserArrows={settings.showUserArrows}
          showEngineArrows={settings.showEngineArrows}
          enginePrimaryColor={settings.engineArrowColor}
          engineSecondaryColor={settings.secondaryEngineArrowColor}
          arrowWidth={settings.arrowWidth}
          arrowOpacity={settings.arrowOpacity}
          moveBadge={
            currentNode.analysis && currentNode.to
              ? {
                  square: currentNode.to,
                  category: currentNode.analysis.category,
                }
              : null
          }
          onRemoveUserArrow={removeUserArrow}
        />

        {/* Pawn Promotion Picker Overlay */}
        {pendingPromotion && (
          <div className="absolute inset-0 bg-black/50 z-30 flex items-center justify-center p-4">
            <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-lg p-3 shadow-xl flex flex-col items-center gap-2">
              <span className="text-xs font-semibold text-[var(--chess-text-primary)]">
                Выберите фигуру превращения
              </span>
              <div className="flex items-center gap-2">
                {(['q', 'r', 'b', 'n'] as const).map((promoType) => {
                  const assetKey = `${turnToPromote}${promoType.toUpperCase()}`;
                  return (
                    <button
                      key={promoType}
                      type="button"
                      onClick={() => {
                        makeMove({
                          from: pendingPromotion.from,
                          to: pendingPromotion.to,
                          promotion: promoType,
                        });
                        setPendingPromotion(null);
                      }}
                      className="w-12 h-12 sm:w-14 sm:h-14 p-1.5 rounded-md bg-[var(--chess-bg-secondary)] hover:bg-[#779954]/20 border border-[var(--chess-border)] transition-colors"
                    >
                      <img
                        src={PIECE_ASSETS[assetKey]}
                        alt={promoType}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPendingPromotion(null)}
                className="text-xs text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)] mt-1"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Annotation & Arrow Control Strip directly below board */}
      <div
        style={{
          ['--desktop-board-max' as string]: desktopMaxPx,
        }}
        className={`${responsiveBoardWidthClass} mt-1 flex flex-wrap items-center justify-between gap-1 px-2 py-1 rounded-md bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] text-[11px] sm:text-xs shrink-0`}
      >
        {/* Mode Switcher: Move vs Draw Arrow vs Square Highlight */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setDrawMode('move');
              setArrowStartSquare(null);
            }}
            className={`px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              drawMode === 'move'
                ? 'bg-[#779954] text-white'
                : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
            }`}
            title="Режим ходов фигурами"
          >
            <MousePointerClick className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Ходы</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDrawMode('arrow');
              setSelectedSquare(null);
              setArrowStartSquare(null);
            }}
            className={`px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              drawMode === 'arrow'
                ? 'bg-[#F39C36] text-white'
                : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
            }`}
            title="Рисование стрелок: нажмите на начальную и конечную клетку"
          >
            <Crosshair className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Стрелки {arrowStartSquare ? `(${arrowStartSquare})` : ''}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDrawMode('highlight');
              setSelectedSquare(null);
              setArrowStartSquare(null);
            }}
            className={`px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
              drawMode === 'highlight'
                ? 'bg-[#36A9E1] text-white'
                : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
            }`}
            title="Подсветка клеток выбранным цветом"
          >
            Клетки
          </button>
        </div>

        {/* Arrow Color Swatches */}
        <div className="flex items-center gap-1.5">
          {ARROW_PALETTE.map((swatch) => (
            <button
              key={swatch.color}
              type="button"
              onClick={() => setActiveBrushColor(swatch.color)}
              title={swatch.label}
              style={{ backgroundColor: swatch.color }}
              className={`w-3.5 h-3.5 rounded-full transition-transform ${
                activeBrushColor === swatch.color
                  ? 'scale-125 ring-2 ring-offset-1 ring-[#333333] dark:ring-white'
                  : 'opacity-75 hover:opacity-100'
              }`}
            />
          ))}
        </div>

        {/* Independent Toggles for Engine Arrows vs User Arrows + Clear */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => updateSettings({ showEngineArrows: !settings.showEngineArrows })}
            className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              settings.showEngineArrows
                ? 'border-[#36A9E1] text-[#36A9E1] bg-[#36A9E1]/10'
                : 'border-[var(--chess-border)] text-[var(--chess-text-secondary)]'
            }`}
            title="Показать / скрыть стрелки вариантов Stockfish"
          >
            {settings.showEngineArrows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>Линии</span>
          </button>

          <button
            type="button"
            onClick={() => updateSettings({ showUserArrows: !settings.showUserArrows })}
            className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
              settings.showUserArrows
                ? 'border-[#F39C36] text-[#F39C36] bg-[#F39C36]/10'
                : 'border-[var(--chess-border)] text-[var(--chess-text-secondary)]'
            }`}
            title="Показать / скрыть пользовательские стрелки"
          >
            {settings.showUserArrows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>{currentNode.userArrows.length + currentNode.squareHighlights.length}</span>
          </button>

          {(currentNode.userArrows.length > 0 || currentNode.squareHighlights.length > 0) && (
            <button
              type="button"
              onClick={clearNodeAnnotations}
              className="p-0.5 rounded text-[#E05252] hover:bg-[#E05252]/10 transition-colors"
              title="Очистить все пользовательские стрелки и подсветку"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
