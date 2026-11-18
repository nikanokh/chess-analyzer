import { MoveAnalysis, MoveCategory, PlayerColor } from './chess';

export type RepertoireTimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical';

export type RepertoirePeriodPreset = 'all' | '7d' | '30d' | '90d' | 'month' | 'custom';

export type RepertoireCacheMode = 'use_cache' | 'exclude_analyzed' | 'force_reanalyze';

export interface RepertoireSourceGame {
  id: string;
  source: 'chesscom' | 'pgn' | 'saved';
  pgn: string;
  pgnHash: string;
  whiteName: string;
  blackName: string;
  whiteRating?: number;
  blackRating?: number;
  playerUsername: string;
  playerColor: PlayerColor;
  playerRating?: number;
  opponentName: string;
  opponentRating?: number;
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
  outcome: 'win' | 'draw' | 'loss';
  timeClass: RepertoireTimeClass;
  timeControl: string;
  timestamp: number; // ms since epoch
  dateStr: string;   // YYYY-MM-DD
  hasValidPgn: boolean;
  siteUrl?: string;
  precomputedAnalyses?: MoveAnalysis[];
}

export interface RepertoireFilterConfig {
  playerUsername: string;
  periodPreset: RepertoirePeriodPreset;
  selectedMonth: string; // "YYYY-MM" or "all"
  dateFrom: string;      // "YYYY-MM-DD"
  dateTo: string;        // "YYYY-MM-DD"
  color: 'all' | PlayerColor;
  timeClasses: RepertoireTimeClass[];
  excludeIncompletePgn: boolean;
  cacheMode: RepertoireCacheMode;
  manualSelectedGameIds: string[] | null; // null means all games matching the filters
}

export interface SelectionPreviewSummary {
  totalLoadedPool: number;
  totalMatching: number;
  whiteCount: number;
  blackCount: number;
  alreadyAnalyzedCount: number;
  basicCachedCount: number;
  needsEngineAnalysisCount: number;
  incompleteOrMissingCount: number;
}

export interface OpeningMoveStep {
  ply: number;
  moveNumber: number;
  color: PlayerColor;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  positionKey: string;
  isTheoretical: boolean;
  ecoAtStep?: string;
  openingNameAtStep?: string;
  variationAtStep?: string;
}

export interface OpeningAnalysisCacheRecord {
  id: string; // canonical cache key: `${gameId}_${playerColor}`
  gameId: string;
  source: 'chesscom' | 'pgn' | 'saved';
  pgnHash: string;
  normalizedMovesKey: string;
  playerUsername: string;
  playerColor: PlayerColor;
  opponentName: string;
  playerRating?: number;
  opponentRating?: number;
  whiteName: string;
  blackName: string;
  outcome: 'win' | 'draw' | 'loss';
  result: string;
  timeClass: RepertoireTimeClass;
  timeControl: string;
  timestamp: number;
  dateStr: string;
  eco: string;
  openingName: string;
  variationName: string;
  isUndefinedOpening: boolean;
  theoryDepthPly: number;
  firstOutOfBookPly: number | null;
  firstOutOfBookMoveSan: string | null;
  transposed: boolean;
  totalPlies: number;
  totalMoves: number;
  openingMoves: OpeningMoveStep[];
  moveAnalyses?: MoveAnalysis[];
  playerAccuracy?: number;
  playerAvgCpl?: number;
  algorithmVersion: string;
  analyzedAt: number;
  status: 'basic' | 'engine_analyzed' | 'error';
  pgn: string;
}

export interface VariationStatsSummary {
  variationName: string;
  eco: string;
  gamesCount: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  avgAccuracy: number | null;
  avgCpl: number | null;
  sampleMovesSan: string[];
  gameIds: string[];
}

export interface ColorSplitStats {
  gamesCount: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  avgAccuracy: number | null;
  avgCpl: number | null;
  avgOpponentRating: number | null;
  avgMovesLength: number;
}

export interface ContinuationPerformanceSummary {
  lineKey: string;
  movesSan: string[];
  ply: number;
  color: PlayerColor;
  gamesCount: number;
  winRate: number;
  avgAccuracy: number | null;
  avgCpl: number | null;
}

export interface OpeningStatsSummary {
  key: string; // e.g. `${eco}__${openingName}`
  eco: string;
  openingName: string;
  isUndefinedOpening: boolean;
  gamesCount: number;
  frequencyPercent: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  avgAccuracy: number | null;
  avgCpl: number | null;
  avgOpponentRating: number | null;
  avgMovesLength: number;
  analyzedGamesCount: number;
  lowSampleConfidence: boolean;
  whiteStats: ColorSplitStats;
  blackStats: ColorSplitStats;
  variations: VariationStatsSummary[];
  bestContinuations: ContinuationPerformanceSummary[];
  problematicContinuations: ContinuationPerformanceSummary[];
  gameIds: string[];
}

export interface RepertoireTreeNode {
  id: string;
  ply: number;
  moveNumber: number;
  color: PlayerColor;
  san: string;
  uci: string;
  fen: string;
  positionKey: string;
  eco?: string;
  openingName?: string;
  variationName?: string;
  isTheoretical: boolean;
  gamesCount: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  avgAccuracy: number | null;
  avgCpl: number | null;
  analyzedCount: number;
  gameIds: string[];
  children: RepertoireTreeNode[];
}

export interface ProblematicGameExample {
  gameId: string;
  whiteName: string;
  blackName: string;
  playerColor: PlayerColor;
  opponentName: string;
  dateStr: string;
  result: string;
  outcome: 'win' | 'draw' | 'loss';
  ply: number;
  moveNumber: number;
  playedSan: string;
  bestMoveSan: string;
  cpl: number;
  winProbLoss: number;
  evalBeforeCp: number;
  evalAfterCp: number;
  category: MoveCategory;
}

export type ProblematicIssueType =
  | 'recurring_mistake'
  | 'systematic_eval_drop'
  | 'lost_advantage'
  | 'theoretical_sideline'
  | 'strong_continuation';

export interface ProblematicContinuationItem {
  id: string;
  issueType: ProblematicIssueType;
  playerColor: PlayerColor;
  eco: string;
  openingName: string;
  variationName: string;
  ply: number;
  moveNumber: number;
  playedSan: string;
  recommendedSan: string;
  fenBefore: string;
  fenAfter: string;
  positionKey: string;
  occurrences: number;
  errorCount: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  avgCpl: number;
  avgWinProbLoss: number;
  avgEvalAfterPlayerCp: number;
  isOutOfBook: boolean;
  isObjectiveError: boolean;
  lowSampleWarning: boolean;
  summaryTitle: string;
  summaryDescription: string;
  examples: ProblematicGameExample[];
}

export interface OpeningRepertoireCacheRecord {
  id: string;
  playerIdentifier: string;
  filterSnapshot: RepertoireFilterConfig;
  totalGames: number;
  whiteGames: number;
  blackGames: number;
  analyzedGames: number;
  openings: OpeningStatsSummary[];
  whiteOpenings: OpeningStatsSummary[];
  blackOpenings: OpeningStatsSummary[];
  whiteTree: RepertoireTreeNode;
  blackTree: RepertoireTreeNode;
  problematicItems: ProblematicContinuationItem[];
  createdAt: number;
  algorithmVersion: string;
}

export interface PersistedRepertoireTaskState {
  id: string; // 'active_repertoire_task'
  status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
  playerUsername: string;
  totalGames: number;
  processedGames: number;
  pendingGameIds: string[];
  completedGameIds: string[];
  depth: number;
  maxOpeningPly: number;
  updatedAt: number;
  errorMessage?: string;
}

export interface PlayerCacheBreakdown {
  playerUsername: string;
  totalGames: number;
  engineAnalyzedGames: number;
  basicGames: number;
  lastAnalyzedAt: number;
}

export interface RepertoireCacheStats {
  totalCachedGames: number;
  engineAnalyzedGames: number;
  basicCachedGames: number;
  repertoireSnapshotsCount: number;
  inMemoryPositionsCount: number;
  estimatedSizeBytes: number;
  lastUpdatedAt: number | null;
  players: PlayerCacheBreakdown[];
}

