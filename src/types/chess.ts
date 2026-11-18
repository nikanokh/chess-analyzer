import { Square } from 'chess.js';

export type PlayerColor = 'w' | 'b';

export type MoveCategory =
  | 'Brilliant'
  | 'Great'
  | 'Best'
  | 'Excellent'
  | 'Good'
  | 'Book'
  | 'Forced'
  | 'Inaccuracy'
  | 'Mistake'
  | 'MissedChance'
  | 'Blunder';

export interface ClassificationThresholds {
  bestMaxCpl: number;
  excellentMaxCpl: number;
  goodMaxCpl: number;
  inaccuracyMaxCpl: number;
  mistakeMaxCpl: number;
}

export interface EngineLine {
  multipv: number;
  depth: number;
  cp?: number;       // Centipawns ALWAYS normalized to White's perspective (+ = White advantage)
  mate?: number;     // Mate in N ALWAYS normalized to White's perspective (+ = White mates, - = Black mates)
  pv: string[];      // UCI moves e.g. ["e2e4", "e7e5"]
  pvSan?: string[];  // SAN moves e.g. ["e4", "e5"]
  nps?: number;
  nodes?: number;
  timeMs?: number;
}

export interface EngineState {
  isReady: boolean;
  isAnalyzing: boolean;
  currentDepth: number;
  nps: number;
  bestMoveUci: string | null;
  ponderUci: string | null;
  lines: EngineLine[];
  fen?: string;
}

export interface EngineConfig {
  depth: number;       // e.g. 14..30 (configurable)
  maxDepth?: number;   // Maximum allowed depth (default 30)
  movetimeMs: number;  // e.g. 1000 (0 = use depth instead)
  multiPv: number;     // 1..5
  hashMb: number;      // 16..512
  threads: number;     // 1..4
  ponder: boolean;
}

export interface MoveAnalysis {
  nodeId: string;
  ply: number;               // 1-indexed half-move
  moveNumber: number;        // 1, 2, 3...
  player: PlayerColor;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  bestMoveUci: string;
  bestMoveSan: string;
  evalBeforeCp: number;      // White perspective centipawns (0 if pure mate without cp)
  evalAfterCp: number;       // White perspective centipawns (0 if pure mate without cp)
  mateBefore?: number;       // White perspective mate (+ = White mates, - = Black mates)
  mateAfter?: number;        // White perspective mate (+ = White mates, - = Black mates)
  winProbBefore: number;     // 0..100 for White
  winProbAfter: number;      // 0..100 for White
  cpl: number;               // Centipawn loss for the moving player (>= 0)
  winProbLoss: number;       // Expected score loss (0..100) for the moving player
  moveAccuracy: number;      // 0..100 accuracy of this specific move
  category: MoveCategory;
  bestLineUci: string[];
  bestLineSan: string[];
  alternativeLines: EngineLine[];
  depth: number;
  isTheoretical: boolean;
  isBookTransposition?: boolean;
  isLastTheoretical?: boolean;
  isFirstOutOfTheory?: boolean;
}

export interface UserArrow {
  id: string;
  from: Square;
  to: Square;
  color: string;
  width?: number;
  opacity?: number;
}

export interface SquareHighlight {
  square: Square;
  color: string;
}

export interface MoveNode {
  id: string;
  parentId: string | null;
  ply: number;               // 0 for root position
  moveNumber: number;        // Math.ceil(ply / 2)
  color: PlayerColor;        // Color that made the move to reach this node
  san: string;               // Empty for root
  uci: string;               // e.g. "e2e4"
  from?: Square;
  to?: Square;
  fen: string;
  children: MoveNode[];      // children[0] is main continuation, children[1+] are variations
  isMainline: boolean;
  comment?: string;
  userArrows: UserArrow[];
  squareHighlights: SquareHighlight[];
  analysis?: MoveAnalysis;
}

export interface OpeningMatch {
  eco: string;
  name: string;
  variation?: string;
  movesUci: string[];
  movesSan: string[];
  continuationSan: string[];
  source: string;
  version: string;
}

export interface OpeningAnalysisSummary {
  eco: string;
  name: string;
  variation: string;
  source: string;
  version: string;
  theoreticalMovesWhite: number;
  theoreticalMovesBlack: number;
  lastTheoreticalPly: number;
  lastTheoreticalMoveSan: string | null;
  firstOutOfBookPly: number | null;
  firstOutOfBookMoveSan: string | null;
  transposedBackToBookPly?: number | null;
  transposedOpeningName?: string | null;
  mainBookContinuationSan: string[];
}

export interface LichessExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number;
}

export interface LichessExplorerData {
  white: number;
  draws: number;
  black: number;
  moves: LichessExplorerMove[];
  opening?: {
    eco: string;
    name: string;
  } | null;
}

export interface GameMetadata {
  id: string;
  whiteName: string;
  blackName: string;
  whiteTitle?: string;
  blackTitle?: string;
  whiteRating?: number;
  blackRating?: number;
  whiteRatingDiff?: number;
  blackRatingDiff?: number;
  timeControl?: string;
  timeClass?: string;
  platform: 'Chess.com' | 'Lichess' | 'PGN' | 'Analysis';
  date: string;
  result: string;
  event?: string;
  site?: string;
  eco?: string;
  openingName?: string;
}

export interface GameStatistics {
  whiteAccuracy: number;
  blackAccuracy: number;
  whiteAvgCpl: number;
  blackAvgCpl: number;
  whiteCounts: Record<MoveCategory, number>;
  blackCounts: Record<MoveCategory, number>;
}

export interface SavedGameRecord {
  id: string;
  metadata: GameMetadata;
  pgn: string;
  initialFen: string;
  serializedTree: string;
  statistics?: GameStatistics;
  openingSummary?: OpeningAnalysisSummary;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  boardSize: 'small' | 'medium' | 'large' | 'auto';
  boardOrientation: 'white' | 'black';
  lightSquareColor: string;
  darkSquareColor: string;
  pieceSet: 'neo' | 'classic_svg';
  enableAnimations: boolean;
  highlightLastMove: boolean;
  highlightLegalMoves: boolean;
  showCoordinates: boolean;
  showEvalBar: boolean;
  showLeftSidebar: boolean;
  showUserArrows: boolean;
  showEngineArrows: boolean;
  userArrowColor: string;
  engineArrowColor: string;
  secondaryEngineArrowColor: string;
  arrowWidth: number;
  arrowOpacity: number;
  engineConfig: EngineConfig;
  thresholds: ClassificationThresholds;
}
