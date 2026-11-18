import React, { useEffect, useMemo, useState } from 'react';
import { useRepertoireStore } from '../../stores/useRepertoireStore';
import {
  OpeningAnalysisCacheRecord,
  OpeningStatsSummary,
  ProblematicContinuationItem,
  ProblematicIssueType,
  RepertoirePeriodPreset,
  RepertoireTimeClass,
  RepertoireTreeNode,
} from '../../types/repertoire';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileUp,
  Filter,
  GitBranch,
  Globe,
  HardDrive,
  Info,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  Upload,
  User,
  X,
} from 'lucide-react';

interface OpeningRepertoirePageProps {
  onNavigateToAnalyzer: () => void;
}

type RepertoireTabId = 'overview' | 'white' | 'black' | 'tree' | 'problematic';
type SortField = 'gamesCount' | 'winRate' | 'avgAccuracy' | 'avgCpl';

const TIME_CLASS_LABELS: { id: RepertoireTimeClass; label: string }[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'classical', label: 'Classical' },
];

const PERIOD_PRESETS: { id: RepertoirePeriodPreset; label: string }[] = [
  { id: 'all', label: 'Все партии' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: '90d', label: '90 дней' },
  { id: 'month', label: 'По месяцу' },
  { id: 'custom', label: 'Диапазон дат' },
];

function formatPct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function formatNum(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

const WdlProgressBar: React.FC<{
  winRate: number;
  drawRate: number;
  lossRate: number;
  wins?: number;
  draws?: number;
  losses?: number;
  compact?: boolean;
}> = ({ winRate, drawRate, lossRate, wins, draws, losses, compact = false }) => {
  return (
    <div className="w-full">
      <div
        className={`w-full ${
          compact ? 'h-2' : 'h-2.5'
        } rounded-xs overflow-hidden flex bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]`}
      >
        {winRate > 0 && (
          <div
            style={{ width: `${winRate}%` }}
            className="bg-[#779954] h-full transition-all"
            title={`Победы: ${formatPct(winRate)}`}
          />
        )}
        {drawRate > 0 && (
          <div
            style={{ width: `${drawRate}%` }}
            className="bg-[#8B8987] h-full transition-all"
            title={`Ничьи: ${formatPct(drawRate)}`}
          />
        )}
        {lossRate > 0 && (
          <div
            style={{ width: `${lossRate}%` }}
            className="bg-[#E05252] h-full transition-all"
            title={`Поражения: ${formatPct(lossRate)}`}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[var(--chess-text-secondary)] mt-0.5">
        <span className="text-[#779954] font-semibold">
          В: {formatPct(winRate)}
          {wins !== undefined ? ` (${wins})` : ''}
        </span>
        <span>
          Н: {formatPct(drawRate)}
          {draws !== undefined ? ` (${draws})` : ''}
        </span>
        <span className="text-[#E05252] font-semibold">
          П: {formatPct(lossRate)}
          {losses !== undefined ? ` (${losses})` : ''}
        </span>
      </div>
    </div>
  );
};

export const OpeningRepertoirePage: React.FC<OpeningRepertoirePageProps> = ({
  onNavigateToAnalyzer,
}) => {
  const isHydrated = useRepertoireStore((s) => s.isHydrated);
  const isLoadingSource = useRepertoireStore((s) => s.isLoadingSource);
  const sourceError = useRepertoireStore((s) => s.sourceError);
  const sourceLabel = useRepertoireStore((s) => s.sourceLabel);
  const availableMonths = useRepertoireStore((s) => s.availableMonths);
  const pool = useRepertoireStore((s) => s.pool);
  const filters = useRepertoireStore((s) => s.filters);
  const preview = useRepertoireStore((s) => s.preview);
  const activeRecords = useRepertoireStore((s) => s.activeRecords);
  const aggregated = useRepertoireStore((s) => s.aggregated);
  const cacheStats = useRepertoireStore((s) => s.cacheStats);

  const engineTaskStatus = useRepertoireStore((s) => s.engineTaskStatus);
  const engineTaskProgress = useRepertoireStore((s) => s.engineTaskProgress);
  const hasRecoverableTask = useRepertoireStore((s) => s.hasRecoverableTask);
  const recoverableTaskInfo = useRepertoireStore((s) => s.recoverableTaskInfo);

  const hydrateRepertoireStore = useRepertoireStore((s) => s.hydrateRepertoireStore);
  const loadFromSavedAndSampleGames = useRepertoireStore((s) => s.loadFromSavedAndSampleGames);
  const loadFromChessComUser = useRepertoireStore((s) => s.loadFromChessComUser);
  const loadFromCustomPgnText = useRepertoireStore((s) => s.loadFromCustomPgnText);
  const updateFilters = useRepertoireStore((s) => s.updateFilters);
  const toggleManualGameId = useRepertoireStore((s) => s.toggleManualGameId);
  const selectAllFilteredGames = useRepertoireStore((s) => s.selectAllFilteredGames);
  const startEngineRepertoireAnalysis = useRepertoireStore(
    (s) => s.startEngineRepertoireAnalysis
  );
  const pauseEngineAnalysis = useRepertoireStore((s) => s.pauseEngineAnalysis);
  const resumeEngineAnalysis = useRepertoireStore((s) => s.resumeEngineAnalysis);
  const cancelEngineAnalysis = useRepertoireStore((s) => s.cancelEngineAnalysis);
  const clearSourceError = useRepertoireStore((s) => s.clearSourceError);
  const openGameInAnalyzer = useRepertoireStore((s) => s.openGameInAnalyzer);

  const refreshCacheStats = useRepertoireStore((s) => s.refreshCacheStats);
  const clearCacheForCurrentSelection = useRepertoireStore(
    (s) => s.clearCacheForCurrentSelection
  );
  const clearCacheForPlayer = useRepertoireStore((s) => s.clearCacheForPlayer);
  const clearEngineEvaluationsOnly = useRepertoireStore(
    (s) => s.clearEngineEvaluationsOnly
  );
  const clearAllRepertoireCache = useRepertoireStore((s) => s.clearAllRepertoireCache);
  const exportRepertoireCacheJson = useRepertoireStore(
    (s) => s.exportRepertoireCacheJson
  );
  const importRepertoireCacheJson = useRepertoireStore(
    (s) => s.importRepertoireCacheJson
  );

  const [activeTab, setActiveTab] = useState<RepertoireTabId>('overview');
  const [selectedOpeningKey, setSelectedOpeningKey] = useState<string | null>(null);

  // Source loader inputs
  const [chessComUsernameInput, setChessComUsernameInput] = useState('');
  const [chessComMonthsLimit, setChessComMonthsLimit] = useState<number | 'all'>(6);
  const [isPgnModalOpen, setIsPgnModalOpen] = useState(false);
  const [customPgnInput, setCustomPgnInput] = useState('');
  const [customPgnPlayerInput, setCustomPgnPlayerInput] = useState('');
  const [isManualSelectModalOpen, setIsManualSelectModalOpen] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  // Overview sorting & search
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('gamesCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [showOnlyUndefined, setShowOnlyUndefined] = useState(false);

  // Tree state
  const [treeColor, setTreeColor] = useState<'w' | 'b'>('w');
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    new Set(['tree_root_w', 'tree_root_b'])
  );
  const [selectedTreeNode, setSelectedTreeNode] = useState<RepertoireTreeNode | null>(null);

  // Problematic filter
  const [problemKindFilter, setProblemKindFilter] = useState<'all' | ProblematicIssueType>(
    'all'
  );

  useEffect(() => {
    if (!isHydrated) {
      hydrateRepertoireStore();
    }
  }, [isHydrated, hydrateRepertoireStore]);

  // Extract top player names in current pool for quick perspective switching
  const candidatePlayers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of pool) {
      if (g.whiteName) counts.set(g.whiteName, (counts.get(g.whiteName) || 0) + 1);
      if (g.blackName) counts.set(g.blackName, (counts.get(g.blackName) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  }, [pool]);

  const handleOpenGameAtPly = (gameId: string, ply?: number) => {
    openGameInAnalyzer(gameId, ply);
    onNavigateToAnalyzer();
  };

  const handleToggleTimeClass = (tc: RepertoireTimeClass) => {
    const current = filters.timeClasses;
    const exists = current.includes(tc);
    const next = exists ? current.filter((x) => x !== tc) : [...current, tc];
    updateFilters({ timeClasses: next });
  };

  const handlePgnFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomPgnInput(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleExportCache = async () => {
    try {
      const json = await exportRepertoireCacheJson();
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repertoire_cache_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setCacheNotice('Кэш репертуара экспортирован в JSON');
    } catch (err) {
      setCacheNotice(
        err instanceof Error ? err.message : 'Ошибка экспорта кэша'
      );
    }
  };

  const handleImportCacheFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        try {
          const { importedCount } = await importRepertoireCacheJson(reader.result);
          setCacheNotice(`Успешно импортировано записей кэша: ${importedCount}`);
        } catch (err) {
          setCacheNotice(
            err instanceof Error ? err.message : 'Не удалось импортировать кэш JSON'
          );
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatCacheBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
  };

  // Filtered and sorted openings for Overview tab
  const filteredOpenings = useMemo(() => {
    const list = aggregated?.openings || [];
    const q = searchQuery.trim().toLowerCase();

    return list
      .filter((o) => {
        if (showOnlyUndefined && !o.isUndefinedOpening) return false;
        if (!q) return true;
        return (
          o.eco.toLowerCase().includes(q) ||
          o.openingName.toLowerCase().includes(q) ||
          o.variations.some((v) => v.variationName.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        let va = 0;
        let vb = 0;
        if (sortField === 'gamesCount') {
          va = a.gamesCount;
          vb = b.gamesCount;
        } else if (sortField === 'winRate') {
          va = a.winRate;
          vb = b.winRate;
        } else if (sortField === 'avgAccuracy') {
          va = a.avgAccuracy ?? -1;
          vb = b.avgAccuracy ?? -1;
        } else if (sortField === 'avgCpl') {
          va = a.avgCpl ?? 9999;
          vb = b.avgCpl ?? 9999;
        }
        return sortAsc ? va - vb : vb - va;
      });
  }, [aggregated, searchQuery, showOnlyUndefined, sortField, sortAsc]);

  // Detailed opening object if user clicked an opening
  const detailedOpening: OpeningStatsSummary | null = useMemo(() => {
    if (!selectedOpeningKey || !aggregated) return null;
    return aggregated.openings.find((o) => o.key === selectedOpeningKey) || null;
  }, [selectedOpeningKey, aggregated]);

  const detailedOpeningGames: OpeningAnalysisCacheRecord[] = useMemo(() => {
    if (!detailedOpening) return [];
    const idSet = new Set(detailedOpening.gameIds);
    return activeRecords.filter((r) => idSet.has(r.gameId));
  }, [detailedOpening, activeRecords]);

  // Global KPI metrics
  const globalKpis = useMemo(() => {
    if (!activeRecords.length) {
      return {
        totalGames: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
        drawRate: 0,
        lossRate: 0,
        avgAccuracy: null as number | null,
        avgCpl: null as number | null,
        mostFrequent: null as OpeningStatsSummary | null,
        bestOpening: null as OpeningStatsSummary | null,
        worstOpening: null as OpeningStatsSummary | null,
      };
    }

    let wins = 0;
    let draws = 0;
    let losses = 0;
    const accs: number[] = [];
    const cpls: number[] = [];

    for (const r of activeRecords) {
      if (r.outcome === 'win') wins++;
      else if (r.outcome === 'draw') draws++;
      else losses++;

      if (typeof r.playerAccuracy === 'number' && Number.isFinite(r.playerAccuracy)) {
        accs.push(r.playerAccuracy);
      }
      if (typeof r.playerAvgCpl === 'number' && Number.isFinite(r.playerAvgCpl)) {
        cpls.push(r.playerAvgCpl);
      }
    }

    const total = activeRecords.length;
    const openings = aggregated?.openings || [];
    const mostFrequent = openings[0] || null;
    const qualified = openings.filter((o) => o.gamesCount >= 2);
    const poolForExtremes = qualified.length > 0 ? qualified : openings;

    const bestOpening =
      [...poolForExtremes].sort((a, b) => b.winRate - a.winRate)[0] || null;
    const worstOpening =
      [...poolForExtremes].sort((a, b) => a.winRate - b.winRate)[0] || null;

    return {
      totalGames: total,
      wins,
      draws,
      losses,
      winRate: (wins / total) * 100,
      drawRate: (draws / total) * 100,
      lossRate: (losses / total) * 100,
      avgAccuracy:
        accs.length > 0 ? accs.reduce((s, v) => s + v, 0) / accs.length : null,
      avgCpl:
        cpls.length > 0 ? cpls.reduce((s, v) => s + v, 0) / cpls.length : null,
      mostFrequent,
      bestOpening,
      worstOpening,
    };
  }, [activeRecords, aggregated]);

  const toggleTreeExpand = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const renderTreeNodeRecursive = (
    node: RepertoireTreeNode,
    totalColorGames: number,
    depthLevel = 0
  ) => {
    const isExpanded = expandedNodeIds.has(node.id) || depthLevel < 1;
    const hasChildren = node.children.length > 0;
    const isSelected = selectedTreeNode?.id === node.id;
    const freqPct =
      totalColorGames > 0 ? (node.gamesCount / totalColorGames) * 100 : 100;

    return (
      <div key={node.id} className="select-none">
        {node.ply > 0 && (
          <div
            onClick={() => setSelectedTreeNode(node)}
            className={`group flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-2.5 py-1.5 rounded border transition-colors cursor-pointer mb-1 ${
              isSelected
                ? 'bg-[#779954]/15 border-[#779954]'
                : 'bg-[var(--chess-bg-primary)] hover:bg-[var(--chess-bg-secondary)] border-[var(--chess-border)]'
            }`}
            style={{ marginLeft: `${Math.min(depthLevel - 1, 8) * 16}px` }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTreeExpand(node.id);
                  }}
                  className="p-0.5 rounded hover:bg-[var(--chess-border)] text-[var(--chess-text-secondary)]"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4" />
              )}

              <span className="font-mono-tabular font-bold text-xs px-1.5 py-0.5 rounded bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)]">
                {node.moveNumber}
                {node.color === 'w' ? '.' : '...'} {node.san}
              </span>

              <span className="text-[11px] font-mono-tabular text-[#A88865] font-semibold">
                {node.eco}
              </span>

              <span className="text-xs text-[var(--chess-text-secondary)] truncate max-w-[220px] sm:max-w-[320px]">
                {node.openingName}
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0 ml-auto">
              <span className="text-xs font-mono-tabular font-semibold text-[var(--chess-text-primary)]">
                {node.gamesCount} парт. ({formatPct(freqPct)})
              </span>

              <div className="w-28 hidden md:block">
                <WdlProgressBar
                  winRate={node.winRate}
                  drawRate={node.drawRate}
                  lossRate={node.lossRate}
                  compact
                />
              </div>

              <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] w-20 text-right hidden sm:inline">
                Точн: {formatNum(node.avgAccuracy)}%
              </span>

              <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] w-16 text-right hidden lg:inline">
                CPL: {formatNum(node.avgCpl, 0)}
              </span>

              {node.gameIds.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenGameAtPly(node.gameIds[0], node.ply);
                  }}
                  className="px-2 py-1 rounded bg-[#779954] hover:bg-[#62934B] text-white text-[11px] font-semibold flex items-center gap-1"
                  title="Открыть партию в анализаторе прямо на этом ходе"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span className="hidden sm:inline">В анализатор</span>
                </button>
              )}
            </div>
          </div>
        )}

        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) =>
              renderTreeNodeRecursive(child, totalColorGames, depthLevel + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 w-full max-w-[1680px] mx-auto p-2 sm:p-3 flex flex-col gap-2.5 overflow-y-auto">
      {/* Top Banner: Module Title + Data Source Controls + Stockfish Batch Task Bar */}
      <section className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-2.5 sm:p-3 flex flex-col gap-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-[#779954]/15 text-[#779954]">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-[var(--chess-text-primary)]">
                  Анализ дебютного репертуара игрока
                </h1>
                <span className="px-2 py-0.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-[11px] font-mono-tabular text-[var(--chess-text-secondary)]">
                  {sourceLabel}
                </span>
              </div>
              <p className="text-xs text-[var(--chess-text-secondary)]">
                Автоматическое распознавание дебютов по ходам (ECO), перестановок, дерева вариантов и проблемных позиций со Stockfish
              </p>
            </div>
          </div>

          {/* Source Switcher & Chess.com Fetch Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] rounded px-2 py-1 gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#779954]" />
              <input
                type="text"
                value={chessComUsernameInput}
                onChange={(e) => setChessComUsernameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    loadFromChessComUser(chessComUsernameInput, chessComMonthsLimit);
                  }
                }}
                placeholder="Ник на Chess.com..."
                className="bg-transparent text-xs text-[var(--chess-text-primary)] placeholder:text-[var(--chess-text-secondary)] focus:outline-none w-32 sm:w-36"
              />
              <select
                value={String(chessComMonthsLimit)}
                onChange={(e) =>
                  setChessComMonthsLimit(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="bg-[var(--chess-bg-primary)] text-[11px] text-[var(--chess-text-primary)] border border-[var(--chess-border)] rounded px-1.5 py-0.5"
                title="Глубина архива Chess.com"
              >
                <option value="3">3 мес.</option>
                <option value="6">6 мес.</option>
                <option value="12">12 мес.</option>
                <option value="all">Все архивы</option>
              </select>
              <button
                type="button"
                disabled={isLoadingSource}
                onClick={() =>
                  loadFromChessComUser(chessComUsernameInput, chessComMonthsLimit)
                }
                className="px-2 py-0.5 rounded bg-[#779954] hover:bg-[#62934B] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {isLoadingSource ? 'Загрузка...' : 'Загрузить'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsPgnModalOpen(true)}
              className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-xs font-medium text-[var(--chess-text-primary)] flex items-center gap-1.5 transition-colors"
            >
              <FileUp className="w-3.5 h-3.5 text-[#F39C36]" />
              <span>Загрузить пакет PGN</span>
            </button>

            <button
              type="button"
              onClick={() => loadFromSavedAndSampleGames(filters.playerUsername)}
              className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-xs font-medium text-[var(--chess-text-primary)] flex items-center gap-1.5 transition-colors"
              title="Использовать сохранённые партии из локальной базы"
            >
              <Database className="w-3.5 h-3.5 text-[#779954]" />
              <span>Локальный архив</span>
            </button>

            <button
              type="button"
              onClick={() => {
                refreshCacheStats();
                setCacheNotice(null);
                setIsCacheModalOpen(true);
              }}
              className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-xs font-semibold text-[var(--chess-text-primary)] flex items-center gap-1.5 transition-colors"
              title="Управление кэшем дебютного репертуара (очистка, экспорт, импорт, статистика)"
            >
              <HardDrive className="w-3.5 h-3.5 text-[#36A9E1]" />
              <span>
                Управление кэшем ({cacheStats.totalCachedGames})
              </span>
            </button>
          </div>
        </div>

        {sourceError && (
          <div className="px-3 py-1.5 rounded bg-[#E05252]/15 border border-[#E05252] text-[#E05252] text-xs flex items-center justify-between">
            <span>{sourceError}</span>
            <button type="button" onClick={clearSourceError}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Recoverable Task Notification */}
        {hasRecoverableTask && recoverableTaskInfo && engineTaskStatus !== 'running' && (
          <div className="px-3 py-2 rounded bg-[#F39C36]/15 border border-[#F39C36]/50 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[var(--chess-text-primary)]">
              <RefreshCw className="w-4 h-4 text-[#F39C36]" />
              <span>
                Обнаружена незавершённая задача анализа репертуара (обработано{' '}
                <strong>
                  {recoverableTaskInfo.processedGames} из {recoverableTaskInfo.totalGames}
                </strong>{' '}
                партий). Все готовые партии уже сохранены в кеше.
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => resumeEngineAnalysis()}
                className="px-2.5 py-1 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Продолжить анализ</span>
              </button>
              <button
                type="button"
                onClick={() => cancelEngineAnalysis()}
                className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-xs text-[var(--chess-text-secondary)]"
              >
                Сбросить
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Filter & Pre-Analysis Selection Preview Panel */}
      <section className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-2.5 sm:p-3 flex flex-col gap-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--chess-border)] pb-2">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#779954]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--chess-text-secondary)]">
              Выборка партий и фильтры (применяются мгновенно до запуска Stockfish)
            </span>
          </div>

          {/* Player perspective selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--chess-text-secondary)] flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              Игрок репертуара:
            </span>
            <input
              type="text"
              value={filters.playerUsername}
              onChange={(e) => updateFilters({ playerUsername: e.target.value })}
              placeholder="Имя игрока..."
              className="px-2 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs font-semibold text-[var(--chess-text-primary)] w-36 sm:w-44"
            />
            {candidatePlayers.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto max-w-[320px]">
                {candidatePlayers.slice(0, 4).map((cp) => (
                  <button
                    key={cp.name}
                    type="button"
                    onClick={() => updateFilters({ playerUsername: cp.name })}
                    className={`px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors ${
                      filters.playerUsername.toLowerCase() === cp.name.toLowerCase()
                        ? 'bg-[#779954] text-white font-semibold'
                        : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
                    }`}
                  >
                    {cp.name} ({cp.count})
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 items-center">
          {/* 1. Period Filter */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--chess-text-secondary)]">
              Период партий
            </span>
            <div className="flex flex-wrap gap-1">
              {PERIOD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => updateFilters({ periodPreset: p.id })}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    filters.periodPreset === p.id
                      ? 'bg-[#779954] text-white font-semibold'
                      : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)] hover:bg-[var(--chess-border)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {filters.periodPreset === 'month' && (
              <select
                value={filters.selectedMonth}
                onChange={(e) => updateFilters({ selectedMonth: e.target.value })}
                className="mt-1 px-2 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
              >
                <option value="all">Все месяцы</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}

            {filters.periodPreset === 'custom' && (
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => updateFilters({ dateFrom: e.target.value })}
                  className="px-2 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
                />
                <span className="text-xs text-[var(--chess-text-secondary)]">—</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => updateFilters({ dateTo: e.target.value })}
                  className="px-2 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
                />
              </div>
            )}
          </div>

          {/* 2. Color & Time Control Filter */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--chess-text-secondary)]">
              Цвет фигур и контроль времени
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'all', label: 'Оба цвета' },
                  { id: 'w', label: 'Белые' },
                  { id: 'b', label: 'Чёрные' },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => updateFilters({ color: c.id })}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    filters.color === c.id
                      ? 'bg-[#779954] text-white font-semibold'
                      : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)] hover:bg-[var(--chess-border)]'
                  }`}
                >
                  {c.label}
                </button>
              ))}

              <span className="mx-1 text-[var(--chess-border)]">|</span>

              {TIME_CLASS_LABELS.map((tc) => {
                const active = filters.timeClasses.includes(tc.id);
                return (
                  <button
                    key={tc.id}
                    type="button"
                    onClick={() => handleToggleTimeClass(tc.id)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[#36A9E1]/20 border border-[#36A9E1] text-[var(--chess-text-primary)] font-semibold'
                        : 'bg-[var(--chess-bg-secondary)] border border-transparent text-[var(--chess-text-secondary)] opacity-60'
                    }`}
                  >
                    {tc.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Cache Mode & Incomplete PGN Toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--chess-text-secondary)]">
              Режим кеша и фильтрация данных
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={filters.cacheMode}
                onChange={(e) =>
                  updateFilters({
                    cacheMode: e.target.value as
                      | 'use_cache'
                      | 'exclude_analyzed'
                      | 'force_reanalyze',
                  })
                }
                className="px-2 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
              >
                <option value="use_cache">Использовать готовый кеш</option>
                <option value="exclude_analyzed">Только ещё не проанализированные</option>
                <option value="force_reanalyze">Принудительный пересчёт</option>
              </select>

              <label className="flex items-center gap-1.5 text-xs text-[var(--chess-text-primary)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filters.excludeIncompletePgn}
                  onChange={(e) =>
                    updateFilters({ excludeIncompletePgn: e.target.checked })
                  }
                  className="accent-[#779954]"
                />
                <span>Без неполных PGN</span>
              </label>

              <button
                type="button"
                onClick={() => {
                  refreshCacheStats();
                  setCacheNotice(null);
                  setIsCacheModalOpen(true);
                }}
                className="px-2 py-1 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-[11px] font-medium text-[#36A9E1] flex items-center gap-1"
                title="Открыть панель управления кэшем"
              >
                <HardDrive className="w-3 h-3" />
                <span>Кэш ({cacheStats.engineAnalyzedGames}/{cacheStats.totalCachedGames})</span>
              </button>
            </div>
          </div>

          {/* 4. Manual Selection & Stockfish Batch Action */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--chess-text-secondary)]">
              Ручной выбор и глубокий анализ Stockfish
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsManualSelectModalOpen(true)}
                className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-xs font-medium text-[var(--chess-text-primary)] flex items-center gap-1.5"
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#779954]" />
                <span>
                  Выбрать вручную (
                  {filters.manualSelectedGameIds !== null
                    ? `${filters.manualSelectedGameIds.length} выбр.`
                    : `все ${preview.totalMatching}`}
                  )
                </span>
              </button>

              {engineTaskStatus === 'running' ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={pauseEngineAnalysis}
                    className="px-2.5 py-1.5 rounded bg-[#F39C36] hover:bg-[#d98626] text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Пауза</span>
                  </button>
                  <button
                    type="button"
                    onClick={cancelEngineAnalysis}
                    className="px-2 py-1.5 rounded bg-[#E05252] hover:bg-[#c94141] text-white text-xs font-semibold flex items-center gap-1"
                    title="Отменить анализ"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={preview.totalMatching === 0}
                  onClick={() => startEngineRepertoireAnalysis()}
                  className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>
                    {preview.needsEngineAnalysisCount > 0
                      ? `Анализ Stockfish (${preview.needsEngineAnalysisCount} парт.)`
                      : 'Обновить оценку Stockfish'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Live Selection Preview Strip */}
        <div className="pt-2 border-t border-[var(--chess-border)] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 font-mono-tabular">
            <span>
              В выборке:{' '}
              <strong className="text-[var(--chess-text-primary)]">
                {preview.totalMatching}
              </strong>{' '}
              <span className="text-[var(--chess-text-secondary)]">
                (из {preview.totalLoadedPool})
              </span>
            </span>
            <span>
              Белыми:{' '}
              <strong className="text-[var(--chess-text-primary)]">
                {preview.whiteCount}
              </strong>
            </span>
            <span>
              Чёрными:{' '}
              <strong className="text-[var(--chess-text-primary)]">
                {preview.blackCount}
              </strong>
            </span>
            <span className="text-[#779954]">
              Проанализировано в кеше:{' '}
              <strong>{preview.alreadyAnalyzedCount}</strong>
            </span>
            <span className="text-[#F39C36]">
              Требуют Stockfish:{' '}
              <strong>{preview.needsEngineAnalysisCount}</strong>
            </span>
            {preview.incompleteOrMissingCount > 0 && (
              <span className="text-[#E05252]">
                Неполные PGN: <strong>{preview.incompleteOrMissingCount}</strong>
              </span>
            )}
          </div>

          {/* Engine Progress Bar if running / paused / completed */}
          {(engineTaskStatus === 'running' ||
            engineTaskStatus === 'paused' ||
            engineTaskStatus === 'completed') &&
            engineTaskProgress.total > 0 && (
              <div className="flex items-center gap-2 min-w-[260px] sm:min-w-[340px]">
                <div className="flex-1 h-2 rounded-full bg-[var(--chess-bg-secondary)] overflow-hidden border border-[var(--chess-border)]">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (engineTaskProgress.processed /
                            Math.max(1, engineTaskProgress.total)) *
                            100
                        )
                      )}%`,
                    }}
                    className={`h-full transition-all ${
                      engineTaskStatus === 'paused' ? 'bg-[#F39C36]' : 'bg-[#779954]'
                    }`}
                  />
                </div>
                <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] truncate max-w-[220px]">
                  {engineTaskProgress.processed}/{engineTaskProgress.total} ·{' '}
                  {engineTaskProgress.currentGameLabel}
                </span>
              </div>
            )}
        </div>
      </section>

      {/* If user clicked on a specific opening, render Detailed Opening View */}
      {detailedOpening ? (
        <section className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 sm:p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--chess-border)] pb-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedOpeningKey(null)}
                className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-xs font-semibold text-[var(--chess-text-primary)] flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Назад к репертуару</span>
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#A88865]/20 text-[#A88865] font-mono-tabular font-bold text-xs">
                    {detailedOpening.eco}
                  </span>
                  <h2 className="text-base sm:text-lg font-bold text-[var(--chess-text-primary)]">
                    {detailedOpening.openingName}
                  </h2>
                  {detailedOpening.lowSampleConfidence && (
                    <span className="px-2 py-0.5 rounded bg-[#F39C36]/15 text-[#F39C36] text-[11px] font-medium">
                      Малая выборка ({detailedOpening.gamesCount} парт.)
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--chess-text-secondary)] mt-0.5">
                  Детальная статистика дебюта, распределение вариантов, лучшие и проблемные продолжения
                </p>
              </div>
            </div>

            {detailedOpening.gameIds.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  handleOpenGameAtPly(detailedOpening.gameIds[0], 6)
                }
                className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Открыть партию этого дебюта в анализаторе</span>
              </button>
            )}
          </div>

          {/* Detailed Opening KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
              <div className="text-[11px] text-[var(--chess-text-secondary)]">
                Сыграно партий
              </div>
              <div className="text-base font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                {detailedOpening.gamesCount}{' '}
                <span className="text-xs font-normal text-[var(--chess-text-secondary)]">
                  ({formatPct(detailedOpening.frequencyPercent)})
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
              <div className="text-[11px] text-[var(--chess-text-secondary)]">
                Результативность
              </div>
              <div className="mt-1">
                <WdlProgressBar
                  winRate={detailedOpening.winRate}
                  drawRate={detailedOpening.drawRate}
                  lossRate={detailedOpening.lossRate}
                  wins={detailedOpening.wins}
                  draws={detailedOpening.draws}
                  losses={detailedOpening.losses}
                  compact
                />
              </div>
            </div>

            <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
              <div className="text-[11px] text-[var(--chess-text-secondary)]">
                Средняя точность / CPL
              </div>
              <div className="text-base font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                {formatNum(detailedOpening.avgAccuracy)}%{' '}
                <span className="text-xs font-normal text-[var(--chess-text-secondary)]">
                  · {formatNum(detailedOpening.avgCpl, 0)} cp
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
              <div className="text-[11px] text-[var(--chess-text-secondary)]">
                Белыми / Чёрными
              </div>
              <div className="text-xs font-mono-tabular text-[var(--chess-text-primary)] mt-1">
                Б: <strong>{detailedOpening.whiteStats.gamesCount}</strong> (В:{' '}
                {formatPct(detailedOpening.whiteStats.winRate)}) · Ч:{' '}
                <strong>{detailedOpening.blackStats.gamesCount}</strong> (В:{' '}
                {formatPct(detailedOpening.blackStats.winRate)})
              </div>
            </div>

            <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
              <div className="text-[11px] text-[var(--chess-text-secondary)]">
                Средняя длина партии
              </div>
              <div className="text-base font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                {formatNum(detailedOpening.avgMovesLength, 0)} ход.
              </div>
            </div>

            <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
              <div className="text-[11px] text-[var(--chess-text-secondary)]">
                Средний рейтинг соп.
              </div>
              <div className="text-base font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                {detailedOpening.avgOpponentRating
                  ? Math.round(detailedOpening.avgOpponentRating)
                  : '—'}
              </div>
            </div>
          </div>

          {/* Variations Table inside Detailed Opening */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="p-3 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] flex flex-col gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--chess-text-secondary)]">
                Варианты внутри дебюта ({detailedOpening.variations.length})
              </h3>
              <div className="divide-y divide-[var(--chess-border)] max-h-[300px] overflow-y-auto">
                {detailedOpening.variations.map((v) => (
                  <div
                    key={`${v.eco}_${v.variationName}`}
                    className="py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--chess-text-primary)] truncate">
                        {v.variationName}
                      </div>
                      <div className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] truncate">
                        {v.sampleMovesSan.join(' ') || 'Основная линия'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono-tabular font-semibold">
                        {v.gamesCount} парт.
                      </span>
                      <div className="w-24">
                        <WdlProgressBar
                          winRate={v.winRate}
                          drawRate={v.drawRate}
                          lossRate={v.lossRate}
                          compact
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          v.gameIds[0] && handleOpenGameAtPly(v.gameIds[0], 6)
                        }
                        className="px-2 py-1 rounded bg-[var(--chess-bg-primary)] hover:bg-[#779954] hover:text-white border border-[var(--chess-border)] text-[11px] font-medium transition-colors"
                      >
                        Открыть
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Best & Problematic Continuations in this Opening */}
            <div className="p-3 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] flex flex-col gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--chess-text-secondary)]">
                Лучшие и проблемные продолжения в этом дебюте
              </h3>
              <div className="flex flex-col gap-2 text-xs">
                <div>
                  <span className="text-[11px] font-semibold text-[#779954] flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Лучшие варианты по проценту побед:
                  </span>
                  {detailedOpening.bestContinuations.map((b) => (
                    <div
                      key={b.lineKey}
                      className="mt-1 px-2 py-1 rounded bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] flex items-center justify-between gap-2"
                    >
                      <span className="truncate font-mono-tabular">
                        {b.movesSan.join(' ')}
                      </span>
                      <span className="font-mono-tabular font-semibold text-[#779954] shrink-0">
                        {formatPct(b.winRate)} побед ({b.gamesCount} парт.)
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-1">
                  <span className="text-[11px] font-semibold text-[#E05252] flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" />
                    Проблемные продолжения:
                  </span>
                  {detailedOpening.problematicContinuations.map((p) => (
                    <div
                      key={p.lineKey}
                      className="mt-1 px-2 py-1 rounded bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] flex items-center justify-between gap-2"
                    >
                      <span className="truncate font-mono-tabular">
                        {p.movesSan.join(' ')}
                      </span>
                      <span className="font-mono-tabular font-semibold text-[#E05252] shrink-0">
                        Побед: {formatPct(p.winRate)} · CPL: {formatNum(p.avgCpl, 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* All Games in this Opening */}
          <div className="p-3 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--chess-text-secondary)] mb-2">
              Партии в этом дебюте ({detailedOpeningGames.length})
            </h3>
            <div className="divide-y divide-[var(--chess-border)] max-h-[320px] overflow-y-auto">
              {detailedOpeningGames.map((g) => (
                <div
                  key={g.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono-tabular font-bold text-[11px] ${
                        g.outcome === 'win'
                          ? 'bg-[#779954]/20 text-[#779954]'
                          : g.outcome === 'draw'
                            ? 'bg-[#8B8987]/20 text-[var(--chess-text-secondary)]'
                            : 'bg-[#E05252]/20 text-[#E05252]'
                      }`}
                    >
                      {g.outcome === 'win'
                        ? 'Победа'
                        : g.outcome === 'draw'
                          ? 'Ничья'
                          : 'Поражение'}{' '}
                      ({g.result})
                    </span>
                    <span className="font-semibold text-[var(--chess-text-primary)] truncate">
                      {g.whiteName} vs {g.blackName}
                    </span>
                    <span className="text-[11px] text-[var(--chess-text-secondary)] font-mono-tabular">
                      {g.dateStr} · {g.timeClass} · {g.totalMoves} ход.
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)]">
                      Точн: <strong>{formatNum(g.playerAccuracy)}%</strong> · CPL:{' '}
                      <strong>{formatNum(g.playerAvgCpl, 0)}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenGameAtPly(
                          g.gameId,
                          g.firstOutOfBookPly || g.theoryDepthPly || 4
                        )
                      }
                      className="px-2.5 py-1 rounded bg-[#779954] hover:bg-[#62934B] text-white text-[11px] font-semibold flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Открыть в анализаторе</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        /* Standard 5-Tab Workspace */
        <>
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-1 overflow-x-auto shrink-0">
            {(
              [
                { id: 'overview', label: 'Обзор репертуара', icon: Layers },
                { id: 'white', label: 'Игра белыми', icon: Sparkles },
                { id: 'black', label: 'Игра чёрными', icon: Target },
                { id: 'tree', label: 'Дерево дебютов', icon: GitBranch },
                {
                  id: 'problematic',
                  label: `Проблемные продолжения (${
                    aggregated?.problematicItems.length || 0
                  })`,
                  icon: ShieldAlert,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[#779954] text-white shadow-xs'
                      : 'text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: ОБЗОР РЕПЕРТУАРА */}
          {activeTab === 'overview' && (
            <div className="flex flex-col gap-3">
              {/* Summary KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3">
                  <div className="text-xs text-[var(--chess-text-secondary)]">
                    Общий баланс в выборке ({globalKpis.totalGames} парт.)
                  </div>
                  <div className="mt-2">
                    <WdlProgressBar
                      winRate={globalKpis.winRate}
                      drawRate={globalKpis.drawRate}
                      lossRate={globalKpis.lossRate}
                      wins={globalKpis.wins}
                      draws={globalKpis.draws}
                      losses={globalKpis.losses}
                    />
                  </div>
                </div>

                <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col justify-between">
                  <div className="text-xs text-[var(--chess-text-secondary)]">
                    Средняя точность Lichess / CPL в дебюте
                  </div>
                  <div className="flex items-baseline gap-3 mt-1">
                    <span className="text-xl font-bold font-mono-tabular text-[#779954]">
                      {formatNum(globalKpis.avgAccuracy)}%
                    </span>
                    <span className="text-xs font-mono-tabular text-[var(--chess-text-secondary)]">
                      Средний CPL: <strong>{formatNum(globalKpis.avgCpl, 1)}</strong>
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)] mt-1">
                    {preview.alreadyAnalyzedCount > 0
                      ? `Рассчитано по ${preview.alreadyAnalyzedCount} партиям со Stockfish`
                      : 'Запустите анализ Stockfish для расчёта CPL и точности'}
                  </div>
                </div>

                <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col justify-between">
                  <div className="text-xs text-[var(--chess-text-secondary)] flex items-center gap-1">
                    <Trophy className="w-3.5 h-3.5 text-[#779954]" />
                    Самый успешный дебют
                  </div>
                  {globalKpis.bestOpening ? (
                    <div
                      onClick={() =>
                        setSelectedOpeningKey(globalKpis.bestOpening!.key)
                      }
                      className="cursor-pointer hover:underline mt-1"
                    >
                      <div className="text-xs font-bold text-[var(--chess-text-primary)] truncate">
                        {globalKpis.bestOpening.eco} ·{' '}
                        {globalKpis.bestOpening.openingName}
                      </div>
                      <div className="text-xs font-mono-tabular text-[#779954] font-semibold mt-0.5">
                        Побед: {formatPct(globalKpis.bestOpening.winRate)} (
                        {globalKpis.bestOpening.gamesCount} парт.)
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--chess-text-secondary)]">—</div>
                  )}
                </div>

                <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col justify-between">
                  <div className="text-xs text-[var(--chess-text-secondary)] flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#E05252]" />
                    Самый проблемный дебют
                  </div>
                  {globalKpis.worstOpening ? (
                    <div
                      onClick={() =>
                        setSelectedOpeningKey(globalKpis.worstOpening!.key)
                      }
                      className="cursor-pointer hover:underline mt-1"
                    >
                      <div className="text-xs font-bold text-[var(--chess-text-primary)] truncate">
                        {globalKpis.worstOpening.eco} ·{' '}
                        {globalKpis.worstOpening.openingName}
                      </div>
                      <div className="text-xs font-mono-tabular text-[#E05252] font-semibold mt-0.5">
                        Побед: {formatPct(globalKpis.worstOpening.winRate)} · Поражений:{' '}
                        {formatPct(globalKpis.worstOpening.lossRate)} (
                        {globalKpis.worstOpening.gamesCount} парт.)
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--chess-text-secondary)]">—</div>
                  )}
                </div>
              </div>

              {/* Openings Table with Search & Sort */}
              <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[var(--chess-text-secondary)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск по ECO, названию дебюта или варианта..."
                        className="pl-8 pr-3 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)] w-64 sm:w-80"
                      />
                    </div>

                    <label className="flex items-center gap-1.5 text-xs text-[var(--chess-text-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showOnlyUndefined}
                        onChange={(e) => setShowOnlyUndefined(e.target.checked)}
                        className="accent-[#779954]"
                      />
                      <span>Только «Неопределённый дебют»</span>
                    </label>
                  </div>

                  {/* Sort controls */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--chess-text-secondary)] flex items-center gap-1">
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Сортировка:
                    </span>
                    {(
                      [
                        { id: 'gamesCount', label: 'Частота' },
                        { id: 'winRate', label: '% побед' },
                        { id: 'avgAccuracy', label: 'Точность' },
                        { id: 'avgCpl', label: 'CPL' },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          if (sortField === s.id) setSortAsc(!sortAsc);
                          else {
                            setSortField(s.id);
                            setSortAsc(s.id === 'avgCpl');
                          }
                        }}
                        className={`px-2 py-1 rounded font-medium transition-colors ${
                          sortField === s.id
                            ? 'bg-[#779954] text-white font-semibold'
                            : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)] hover:bg-[var(--chess-border)]'
                        }`}
                      >
                        {s.label}{' '}
                        {sortField === s.id ? (sortAsc ? '↑' : '↓') : ''}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Openings Rows */}
                <div className="divide-y divide-[var(--chess-border)]">
                  {filteredOpenings.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--chess-text-secondary)]">
                      Нет дебютов, подходящих под выбранные фильтры.
                    </div>
                  ) : (
                    filteredOpenings.map((op) => (
                      <div
                        key={op.key}
                        onClick={() => setSelectedOpeningKey(op.key)}
                        className="py-2.5 px-2 hover:bg-[var(--chess-bg-secondary)] transition-colors cursor-pointer flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 rounded"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-[#A88865]/20 text-[#A88865] font-mono-tabular font-bold text-xs shrink-0">
                              {op.eco}
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-[var(--chess-text-primary)] truncate">
                              {op.openingName}
                            </span>
                            {op.isUndefinedOpening && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-[10px] text-[var(--chess-text-secondary)]">
                                Нестандартное начало
                              </span>
                            )}
                            {op.lowSampleConfidence && (
                              <span
                                className="text-[10px] text-[#F39C36] font-mono-tabular"
                                title="Малое количество партий (< 5)"
                              >
                                малая выборка
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-[var(--chess-text-secondary)] mt-0.5 flex flex-wrap items-center gap-2">
                            <span>
                              Частый вариант:{' '}
                              <strong>
                                {op.variations[0]?.variationName || 'Основная линия'}
                              </strong>
                            </span>
                            <span>·</span>
                            <span>
                              Длина партии в среднем:{' '}
                              <strong>{Math.round(op.avgMovesLength)} ход.</strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0 w-full lg:w-auto justify-between lg:justify-end">
                          <div className="text-right font-mono-tabular">
                            <div className="text-xs font-bold text-[var(--chess-text-primary)]">
                              {op.gamesCount} парт.
                            </div>
                            <div className="text-[10px] text-[var(--chess-text-secondary)]">
                              {formatPct(op.frequencyPercent)} выборки
                            </div>
                          </div>

                          <div className="w-40 sm:w-48">
                            <WdlProgressBar
                              winRate={op.winRate}
                              drawRate={op.drawRate}
                              lossRate={op.lossRate}
                              wins={op.wins}
                              draws={op.draws}
                              losses={op.losses}
                              compact
                            />
                          </div>

                          <div className="w-24 text-right font-mono-tabular">
                            <div className="text-xs font-bold text-[var(--chess-text-primary)]">
                              Точн: {formatNum(op.avgAccuracy)}%
                            </div>
                            <div className="text-[10px] text-[var(--chess-text-secondary)]">
                              CPL: {formatNum(op.avgCpl, 1)}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOpeningKey(op.key);
                            }}
                            className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] hover:bg-[#779954] hover:text-white border border-[var(--chess-border)] text-xs font-semibold transition-colors"
                          >
                            Детали →
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2 & TAB 3: ИГРА БЕЛЫМИ / ИГРА ЧЁРНЫМИ */}
          {(activeTab === 'white' || activeTab === 'black') && (
            <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-[var(--chess-border)] pb-2">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-[var(--chess-text-primary)]">
                    {activeTab === 'white'
                      ? 'Репертуар за белых (статистика и эффективность дебютов)'
                      : 'Репертуар за чёрных (ответы на 1.e4, 1.d4 и фланговые дебюты)'}
                  </h2>
                  <p className="text-xs text-[var(--chess-text-secondary)]">
                    Нажмите на любой дебют для перехода к его детальной странице, дереву вариантов и списку партий
                  </p>
                </div>
                <span className="text-xs font-mono-tabular text-[var(--chess-text-secondary)]">
                  Партий этим цветом:{' '}
                  <strong>
                    {activeTab === 'white' ? preview.whiteCount : preview.blackCount}
                  </strong>
                </span>
              </div>

              <div className="divide-y divide-[var(--chess-border)]">
                {(activeTab === 'white'
                  ? aggregated?.whiteOpenings || []
                  : aggregated?.blackOpenings || []
                ).map((op) => (
                  <div
                    key={op.key}
                    onClick={() => setSelectedOpeningKey(op.key)}
                    className="py-2.5 px-2 hover:bg-[var(--chess-bg-secondary)] transition-colors cursor-pointer flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-[#A88865]/20 text-[#A88865] font-mono-tabular font-bold text-xs">
                          {op.eco}
                        </span>
                        <span className="text-xs sm:text-sm font-bold text-[var(--chess-text-primary)] truncate">
                          {op.openingName}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--chess-text-secondary)] mt-0.5">
                        Лучшее продолжение:{' '}
                        <strong className="font-mono-tabular">
                          {op.bestContinuations[0]?.movesSan.join(' ') ||
                            op.variations[0]?.variationName ||
                            op.openingName}
                        </strong>{' '}
                        (В: {formatPct(op.bestContinuations[0]?.winRate ?? op.winRate)})
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-xs font-mono-tabular font-bold">
                        {op.gamesCount} парт. ({formatPct(op.frequencyPercent)})
                      </span>
                      <div className="w-44">
                        <WdlProgressBar
                          winRate={op.winRate}
                          drawRate={op.drawRate}
                          lossRate={op.lossRate}
                          wins={op.wins}
                          draws={op.draws}
                          losses={op.losses}
                          compact
                        />
                      </div>
                      <div className="w-24 text-right font-mono-tabular text-xs">
                        <div>Точн: {formatNum(op.avgAccuracy)}%</div>
                        <div className="text-[10px] text-[var(--chess-text-secondary)]">
                          CPL: {formatNum(op.avgCpl, 1)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (op.gameIds[0]) {
                            handleOpenGameAtPly(op.gameIds[0], 6);
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold"
                      >
                        В анализатор
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: ИНТЕРАКТИВНОЕ ДЕРЕВО ДЕБЮТОВ */}
          {activeTab === 'tree' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--chess-border)] pb-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-[#779954]" />
                    <h2 className="text-sm font-bold text-[var(--chess-text-primary)]">
                      Интерактивное дерево дебютных ходов игрока
                    </h2>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTreeColor('w')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                        treeColor === 'w'
                          ? 'bg-[#779954] text-white'
                          : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)]'
                      }`}
                    >
                      Репертуар белыми ({preview.whiteCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTreeColor('b')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                        treeColor === 'b'
                          ? 'bg-[#779954] text-white'
                          : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)]'
                      }`}
                    >
                      Репертуар чёрными ({preview.blackCount})
                    </button>
                  </div>
                </div>

                <div className="max-h-[540px] overflow-y-auto pr-1">
                  {aggregated ? (
                    renderTreeNodeRecursive(
                      treeColor === 'w' ? aggregated.whiteTree : aggregated.blackTree,
                      treeColor === 'w' ? preview.whiteCount : preview.blackCount,
                      0
                    )
                  ) : (
                    <div className="py-8 text-center text-xs text-[var(--chess-text-secondary)]">
                      Дерево вариантов пусто.
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Tree Node Inspector & Matching Games */}
              <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col gap-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--chess-text-secondary)] border-b border-[var(--chess-border)] pb-2">
                  Детали выбранного узла дерева
                </h3>

                {selectedTreeNode ? (
                  <div className="flex flex-col gap-3 text-xs">
                    <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
                      <div className="flex items-center justify-between">
                        <span className="font-mono-tabular font-bold text-sm text-[var(--chess-text-primary)]">
                          Ход {selectedTreeNode.moveNumber}
                          {selectedTreeNode.color === 'w' ? '.' : '...'}{' '}
                          {selectedTreeNode.san}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#A88865]/20 text-[#A88865] font-mono-tabular font-bold">
                          {selectedTreeNode.eco}
                        </span>
                      </div>
                      <div className="text-[var(--chess-text-secondary)] mt-1">
                        {selectedTreeNode.openingName} — {selectedTreeNode.variationName}
                      </div>
                      <div className="mt-2">
                        <WdlProgressBar
                          winRate={selectedTreeNode.winRate}
                          drawRate={selectedTreeNode.drawRate}
                          lossRate={selectedTreeNode.lossRate}
                          wins={selectedTreeNode.wins}
                          draws={selectedTreeNode.draws}
                          losses={selectedTreeNode.losses}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between font-mono-tabular text-[11px] text-[var(--chess-text-secondary)]">
                        <span>Точность: {formatNum(selectedTreeNode.avgAccuracy)}%</span>
                        <span>Средний CPL: {formatNum(selectedTreeNode.avgCpl, 1)}</span>
                      </div>
                    </div>

                    <div>
                      <div className="font-semibold text-[var(--chess-text-secondary)] mb-1.5">
                        Партии, прошедшие через эту позицию ({selectedTreeNode.gameIds.length}):
                      </div>
                      <div className="divide-y divide-[var(--chess-border)] max-h-[340px] overflow-y-auto">
                        {selectedTreeNode.gameIds.map((gid) => {
                          const rec = activeRecords.find((r) => r.gameId === gid);
                          if (!rec) return null;
                          return (
                            <div
                              key={gid}
                              className="py-1.5 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-[var(--chess-text-primary)] truncate">
                                  {rec.whiteName} vs {rec.blackName}
                                </div>
                                <div className="text-[10px] font-mono-tabular text-[var(--chess-text-secondary)]">
                                  {rec.dateStr} · {rec.result}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenGameAtPly(gid, selectedTreeNode.ply)
                                }
                                className="px-2 py-1 rounded bg-[#779954] hover:bg-[#62934B] text-white text-[11px] font-semibold shrink-0"
                              >
                                На ход {selectedTreeNode.moveNumber}
                                {selectedTreeNode.color === 'w' ? '.' : '...'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-[var(--chess-text-secondary)]">
                    Нажмите на любой ход в дереве слева, чтобы увидеть список партий и открыть позицию на доске.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: ПРОБЛЕМНЫЕ ПРОДОЛЖЕНИЯ */}
          {activeTab === 'problematic' && (
            <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md p-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--chess-border)] pb-2.5">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-[var(--chess-text-primary)]">
                    Диагностика дебютных ошибок, потери перевеса и теоретических отклонений
                  </h2>
                  <p className="text-xs text-[var(--chess-text-secondary)]">
                    Алгоритм строго различает <strong>объективные ошибки по оценке Stockfish</strong> и{' '}
                    <strong>корректные боковые линии / выход из книги (CPL ≤ 40)</strong>
                  </p>
                </div>

                {/* Filter buttons */}
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { id: 'all', label: 'Все записи' },
                      { id: 'recurring_mistake', label: 'Объективные ошибки' },
                      { id: 'lost_advantage', label: 'Потеря преимущества' },
                      { id: 'theoretical_sideline', label: 'Боковые линии (без ошибки)' },
                      { id: 'strong_continuation', label: 'Сильные находки' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setProblemKindFilter(f.id)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        problemKindFilter === f.id
                          ? 'bg-[#779954] text-white font-semibold'
                          : 'bg-[var(--chess-bg-secondary)] text-[var(--chess-text-primary)] hover:bg-[var(--chess-border)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {preview.alreadyAnalyzedCount === 0 && (
                <div className="p-3 rounded bg-[#F39C36]/15 border border-[#F39C36]/40 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-[#F39C36] shrink-0" />
                    <span>
                      Для точного разделения теоретических отклонений и объективных ошибок Stockfish (CPL, потеря перевеса, лучший ход движка) запустите анализ дебютных ходов выбранных партий.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEngineRepertoireAnalysis()}
                    className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white font-semibold shrink-0"
                  >
                    Запустить Stockfish
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2.5">
                {(aggregated?.problematicItems || [])
                  .filter(
                    (item: ProblematicContinuationItem) =>
                      problemKindFilter === 'all' || item.issueType === problemKindFilter
                  )
                  .map((item: ProblematicContinuationItem) => (
                    <div
                      key={item.id}
                      className="p-3 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] flex flex-col gap-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] font-mono-tabular font-bold text-xs text-[var(--chess-text-primary)]">
                            {item.moveNumber}
                            {item.playerColor === 'w' ? '.' : '...'} {item.playedSan}
                          </span>

                          {item.isObjectiveError ? (
                            <span className="px-2 py-0.5 rounded bg-[#E05252]/20 text-[#E05252] text-[11px] font-bold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {item.issueType === 'lost_advantage'
                                ? 'Потеря перевеса в дебюте'
                                : 'Объективная ошибка (Stockfish)'}
                            </span>
                          ) : item.issueType === 'theoretical_sideline' ? (
                            <span className="px-2 py-0.5 rounded bg-[#36A9E1]/20 text-[#36A9E1] text-[11px] font-semibold flex items-center gap-1">
                              <BookOpen className="w-3 h-3" />
                              Теоретическое отклонение (боковая линия без ошибки)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-[#779954]/20 text-[#779954] text-[11px] font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Сильное дебютное продолжение
                            </span>
                          )}

                          <span className="text-xs font-semibold text-[#A88865]">
                            {item.eco} · {item.openingName}
                          </span>

                          {item.lowSampleWarning && (
                            <span className="px-1.5 py-0.5 rounded bg-[var(--chess-bg-primary)] text-[10px] text-[var(--chess-text-secondary)] font-mono-tabular">
                              Единичный / редкий случай ({item.occurrences} парт.) — без категоричных обобщений
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs font-mono-tabular">
                          <span>
                            Встретилось: <strong>{item.occurrences} раз</strong>
                          </span>
                          <span>
                            Потерь cp: <strong>{item.avgCpl} CPL</strong>
                          </span>
                          {item.recommendedSan && (
                            <span className="text-[#779954] font-bold">
                              Лучше по движку: {item.recommendedSan}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-[var(--chess-text-primary)]">
                        <strong>{item.summaryTitle}.</strong> {item.summaryDescription}
                      </p>

                      {/* Concrete Game Examples */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--chess-border)]">
                        <span className="text-[11px] text-[var(--chess-text-secondary)]">
                          Примеры из партий игрока:
                        </span>
                        {item.examples.map((ex) => (
                          <button
                            key={`${ex.gameId}_${ex.ply}`}
                            type="button"
                            onClick={() => handleOpenGameAtPly(ex.gameId, ex.ply)}
                            className="px-2.5 py-1 rounded bg-[var(--chess-bg-primary)] hover:bg-[#779954] hover:text-white border border-[var(--chess-border)] text-[11px] font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <span>
                              vs {ex.opponentName} ({ex.dateStr}) · CPL {ex.cpl}
                            </span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL 1: Multi-game PGN Batch Upload */}
      {isPgnModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md max-w-xl w-full p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--chess-border)] pb-2">
              <h3 className="text-sm font-bold text-[var(--chess-text-primary)]">
                Импорт базы PGN для анализа дебютного репертуара
              </h3>
              <button
                type="button"
                onClick={() => setIsPgnModalOpen(false)}
                className="text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              <label className="font-medium text-[var(--chess-text-secondary)]">
                Имя игрока (опционально — определится автоматически по наиболее частому игроку в PGN):
              </label>
              <input
                type="text"
                value={customPgnPlayerInput}
                onChange={(e) => setCustomPgnPlayerInput(e.target.value)}
                placeholder="Например: MagnusCarlsen"
                className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-[var(--chess-text-primary)]"
              />

              <div className="flex items-center justify-between mt-1">
                <span className="font-medium text-[var(--chess-text-secondary)]">
                  Вставьте PGN (поддерживается несколько партий подряд) или выберите файл .pgn:
                </span>
                <label className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] cursor-pointer font-medium">
                  <span>Выбрать файл .pgn</span>
                  <input
                    type="file"
                    accept=".pgn,.txt"
                    onChange={handlePgnFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <textarea
                rows={8}
                value={customPgnInput}
                onChange={(e) => setCustomPgnInput(e.target.value)}
                placeholder={'[Event "Live Chess"]\n[White "Player1"]\n[Black "Player2"]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
                className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] font-mono text-xs text-[var(--chess-text-primary)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--chess-border)]">
              <button
                type="button"
                onClick={() => setIsPgnModalOpen(false)}
                className="px-3 py-1.5 rounded bg-[var(--chess-bg-secondary)] text-xs text-[var(--chess-text-secondary)]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={async () => {
                  await loadFromCustomPgnText(
                    customPgnInput,
                    customPgnPlayerInput || undefined
                  );
                  setIsPgnModalOpen(false);
                }}
                className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold"
              >
                Построить репертуар
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Manual Game Selection from Pool */}
      {isManualSelectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md max-w-2xl w-full p-4 flex flex-col gap-3 shadow-xl max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-[var(--chess-border)] pb-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--chess-text-primary)]">
                  Ручной выбор партий для анализа ({pool.length} доступно)
                </h3>
                <p className="text-[11px] text-[var(--chess-text-secondary)]">
                  Отметьте конкретные партии, которые должны войти в расчёт репертуара
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManualSelectModalOpen(false)}
                className="text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => selectAllFilteredGames()}
                className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-[var(--chess-text-primary)] font-medium"
              >
                Выбрать все партии по фильтрам
              </button>
              <button
                type="button"
                onClick={() => updateFilters({ manualSelectedGameIds: [] })}
                className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-[var(--chess-text-secondary)]"
              >
                Снять выделение
              </button>
            </div>

            <div className="divide-y divide-[var(--chess-border)] overflow-y-auto flex-1 pr-1">
              {pool.map((g) => {
                const isChecked =
                  filters.manualSelectedGameIds === null ||
                  filters.manualSelectedGameIds.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className="py-2 px-2 hover:bg-[var(--chess-bg-secondary)] flex items-center justify-between gap-2 text-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleManualGameId(g.id)}
                        className="accent-[#779954]"
                      />
                      <span className="font-semibold text-[var(--chess-text-primary)] truncate">
                        {g.whiteName} vs {g.blackName}
                      </span>
                      <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)]">
                        ({g.playerColor === 'w' ? 'Белые' : 'Чёрные'} · {g.result})
                      </span>
                    </div>
                    <span className="text-[11px] font-mono-tabular text-[var(--chess-text-secondary)] shrink-0">
                      {g.dateStr} · {g.timeClass}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-[var(--chess-border)]">
              <button
                type="button"
                onClick={() => setIsManualSelectModalOpen(false)}
                className="px-4 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold"
              >
                Применить выборку ({preview.totalMatching} парт.)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Управление кэшем дебютного репертуара */}
      {isCacheModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-md max-w-2xl w-full p-4 flex flex-col gap-3.5 shadow-xl max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--chess-border)] pb-2.5">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#36A9E1]" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--chess-text-primary)]">
                    Управление кэшем дебютного репертуара (IndexedDB)
                  </h3>
                  <p className="text-[11px] text-[var(--chess-text-secondary)]">
                    Кэш дебютного репертуара полностью изолирован от основного анализатора партий
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCacheModalOpen(false)}
                className="text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cacheNotice && (
              <div className="px-3 py-1.5 rounded bg-[#779954]/15 border border-[#779954] text-xs text-[var(--chess-text-primary)] flex items-center justify-between">
                <span>{cacheNotice}</span>
                <button type="button" onClick={() => setCacheNotice(null)}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Cache Summary Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
                <div className="text-[11px] text-[var(--chess-text-secondary)]">
                  Всего партий в кэше
                </div>
                <div className="text-base font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                  {cacheStats.totalCachedGames}
                </div>
              </div>

              <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
                <div className="text-[11px] text-[var(--chess-text-secondary)]">
                  Со Stockfish / Базовых
                </div>
                <div className="text-sm font-bold font-mono-tabular text-[#779954] mt-0.5">
                  {cacheStats.engineAnalyzedGames}{' '}
                  <span className="text-xs font-normal text-[var(--chess-text-secondary)]">
                    / {cacheStats.basicCachedGames}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
                <div className="text-[11px] text-[var(--chess-text-secondary)]">
                  Сборок / Позиций FEN
                </div>
                <div className="text-sm font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                  {cacheStats.repertoireSnapshotsCount} / {cacheStats.inMemoryPositionsCount}
                </div>
              </div>

              <div className="p-2.5 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)]">
                <div className="text-[11px] text-[var(--chess-text-secondary)]">
                  Объём данных кэша
                </div>
                <div className="text-sm font-bold font-mono-tabular text-[var(--chess-text-primary)] mt-0.5">
                  {formatCacheBytes(cacheStats.estimatedSizeBytes)}
                </div>
              </div>
            </div>

            {/* Per-player Cache Breakdown */}
            <div className="p-3 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] flex flex-col gap-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--chess-text-secondary)]">
                Кэш по игрокам ({cacheStats.players.length})
              </div>
              {cacheStats.players.length === 0 ? (
                <div className="text-xs text-[var(--chess-text-secondary)] py-2">
                  В кэше пока нет сохранённых записей игроков.
                </div>
              ) : (
                <div className="divide-y divide-[var(--chess-border)] max-h-[180px] overflow-y-auto">
                  {cacheStats.players.map((pl) => (
                    <div
                      key={pl.playerUsername}
                      className="py-1.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-[var(--chess-text-primary)]">
                          {pl.playerUsername}
                        </span>
                        <span className="ml-2 text-[11px] font-mono-tabular text-[var(--chess-text-secondary)]">
                          Всего: {pl.totalGames} · Stockfish: {pl.engineAnalyzedGames} · Базовых:{' '}
                          {pl.basicGames}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await clearCacheForPlayer(pl.playerUsername);
                          setCacheNotice(
                            `Кэш игрока «${pl.playerUsername}» очищен и пересобран`
                          );
                        }}
                        className="px-2 py-1 rounded bg-[var(--chess-bg-primary)] hover:bg-[#E05252] hover:text-white border border-[var(--chess-border)] text-[11px] font-medium flex items-center gap-1 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Очистить игрока</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cache Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={async () => {
                  await clearCacheForCurrentSelection();
                  setCacheNotice(
                    `Кэш текущей выборки (${preview.totalMatching} парт.) сброшен`
                  );
                }}
                className="p-2.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-left flex items-start gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4 text-[#F39C36] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--chess-text-primary)]">
                    Очистить кэш текущей выборки ({preview.totalMatching} парт.)
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)]">
                    Удаляет кэш только для отфильтрованных партий и пересчитывает их дебюты
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await clearEngineEvaluationsOnly();
                  setCacheNotice(
                    'Оценки Stockfish сброшены (классификация дебютов ECO сохранена)'
                  );
                }}
                className="p-2.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-left flex items-start gap-2 transition-colors"
              >
                <Cpu className="w-4 h-4 text-[#36A9E1] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--chess-text-primary)]">
                    Сбросить только оценки Stockfish
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)]">
                    Сохраняет распознанные дебюты, но очищает CPL и точность для повторного анализа
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleExportCache}
                className="p-2.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-left flex items-start gap-2 transition-colors"
              >
                <Download className="w-4 h-4 text-[#779954] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--chess-text-primary)]">
                    Экспортировать кэш в JSON
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)]">
                    Сохранить резервную копию всех проанализированных партий репертуара
                  </div>
                </div>
              </button>

              <label className="p-2.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-left flex items-start gap-2 transition-colors cursor-pointer">
                <Upload className="w-4 h-4 text-[#779954] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[var(--chess-text-primary)]">
                    Импортировать кэш из JSON
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)]">
                    Восстановить готовые анализы партий из ранее сохранённого файла
                  </div>
                </div>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportCacheFile}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[var(--chess-border)]">
              <button
                type="button"
                onClick={async () => {
                  await clearAllRepertoireCache();
                  setCacheNotice('Весь кэш дебютного репертуара полностью очищен');
                }}
                className="px-3 py-1.5 rounded bg-[#E05252]/15 hover:bg-[#E05252] text-[#E05252] hover:text-white border border-[#E05252]/40 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Полностью очистить весь кэш репертуара</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCacheModalOpen(false)}
                className="px-4 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
