import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChessComGameItem,
  ChessComProfile,
  fetchChessComArchives,
  fetchChessComGamesByArchiveUrl,
  fetchChessComProfile,
  getChessComGameKey,
  mapChessComResult,
  mergeAndDeduplicateChessComGames,
} from '../../services/ChessComApi/chessComService';
import { useGameStore } from '../../stores/useGameStore';
import {
  Calendar,
  ChevronDown,
  Download,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';

interface ChessComModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_PROFILES = ['Hikaru', 'MagnusCarlsen', 'DanielNaroditsky', 'GothamChess'];
const LAST_USERNAME_STORAGE_KEY = 'chess_analyzer_last_chesscom_user';
const INITIAL_AUTO_ARCHIVE_MONTHS = 12;
const ARCHIVE_BATCH_SIZE = 2;
const INITIAL_VISIBLE_GAMES = 250;
const VISIBLE_GAMES_STEP = 250;

export const ChessComModal: React.FC<ChessComModalProps> = ({ isOpen, onClose }) => {
  const loadPgnGame = useGameStore((s) => s.loadPgnGame);

  const initialUser = useMemo(() => {
    try {
      return localStorage.getItem(LAST_USERNAME_STORAGE_KEY) || 'Hikaru';
    } catch {
      return 'Hikaru';
    }
  }, []);

  const [usernameInput, setUsernameInput] = useState(initialUser);
  const [searchedUsername, setSearchedUsername] = useState(initialUser);
  const [selectedArchiveUrl, setSelectedArchiveUrl] = useState<string>('all');

  // Filters
  const [resultFilter, setResultFilter] = useState<'all' | 'win' | 'draw' | 'loss'>('all');
  const [colorFilter, setColorFilter] = useState<'all' | 'w' | 'b'>('all');
  const [timeClassFilter, setTimeClassFilter] = useState<
    'all' | 'bullet' | 'blitz' | 'rapid' | 'daily'
  >('all');

  // Synchronized archive state
  const [profile, setProfile] = useState<ChessComProfile | null>(null);
  const [archiveUrls, setArchiveUrls] = useState<string[]>([]);
  const [loadedArchiveCount, setLoadedArchiveCount] = useState(0);
  const [allLoadedGames, setAllLoadedGames] = useState<ChessComGameItem[]>([]);
  const [singleMonthGames, setSingleMonthGames] = useState<ChessComGameItem[]>([]);

  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMoreArchives, setIsLoadingMoreArchives] = useState(false);
  const [isSyncingLatest, setIsSyncingLatest] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_GAMES);

  const activeUserSessionRef = useRef(0);
  const loadedArchiveSetRef = useRef<Set<string>>(new Set());
  const isFetchingMoreRef = useRef(false);

  // Save searched username
  useEffect(() => {
    if (!searchedUsername) return;
    try {
      localStorage.setItem(LAST_USERNAME_STORAGE_KEY, searchedUsername);
    } catch {
      // ignore storage errors
    }
  }, [searchedUsername]);

  // Reset visible count when filter changes
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_GAMES);
  }, [resultFilter, colorFilter, timeClassFilter, selectedArchiveUrl, searchedUsername]);

  // Load next batch of monthly archives into allLoadedGames without losing or duplicating data
  const loadNextArchiveBatch = useCallback(
    async (
      urls: string[],
      sessionId: number,
      batchCount: number = ARCHIVE_BATCH_SIZE,
      forceRefreshFirst: boolean = false
    ) => {
      if (isFetchingMoreRef.current) return;
      const unloadedUrls = urls.filter((u) => !loadedArchiveSetRef.current.has(u));
      if (unloadedUrls.length === 0) return;

      isFetchingMoreRef.current = true;
      setIsLoadingMoreArchives(true);

      try {
        const targetSlice = unloadedUrls.slice(0, batchCount);
        for (let i = 0; i < targetSlice.length; i += ARCHIVE_BATCH_SIZE) {
          if (activeUserSessionRef.current !== sessionId) return;
          const chunk = targetSlice.slice(i, i + ARCHIVE_BATCH_SIZE);
          const chunkResults = await Promise.all(
            chunk.map((url) =>
              fetchChessComGamesByArchiveUrl(url, {
                isLatestArchive: url === urls[0],
                forceRefresh: forceRefreshFirst && url === urls[0],
              })
            )
          );

          if (activeUserSessionRef.current !== sessionId) return;

          const incoming = chunkResults.flat();
          for (const u of chunk) {
            loadedArchiveSetRef.current.add(u);
          }

          setLoadedArchiveCount(loadedArchiveSetRef.current.size);
          setAllLoadedGames((prev) => mergeAndDeduplicateChessComGames(prev, incoming));
        }
      } catch (err) {
        if (activeUserSessionRef.current === sessionId) {
          console.warn('Error loading archive batch:', err);
        }
      } finally {
        if (activeUserSessionRef.current === sessionId) {
          isFetchingMoreRef.current = false;
          setIsLoadingMoreArchives(false);
        }
      }
    },
    []
  );

  // Initial load for a searched username
  const loadUserArchivesAndGames = useCallback(
    async (username: string, forceRefresh: boolean = false) => {
      const clean = username.trim();
      if (!clean) return;

      const sessionId = ++activeUserSessionRef.current;
      isFetchingMoreRef.current = false;
      loadedArchiveSetRef.current = new Set();

      setIsInitialLoading(true);
      setErrorMsg(null);
      if (!forceRefresh) {
        setProfile(null);
        setArchiveUrls([]);
        setLoadedArchiveCount(0);
        setAllLoadedGames([]);
        setSingleMonthGames([]);
      }

      try {
        const [prof, archives] = await Promise.all([
          fetchChessComProfile(clean, { forceRefresh }),
          fetchChessComArchives(clean, { forceRefresh }),
        ]);

        if (activeUserSessionRef.current !== sessionId) return;

        setProfile(prof);
        setArchiveUrls(archives);

        if (archives.length === 0) {
          setAllLoadedGames([]);
          setLoadedArchiveCount(0);
          setIsInitialLoading(false);
          return;
        }

        // Load the first archive immediately so user sees games right away
        const firstMonthGames = await fetchChessComGamesByArchiveUrl(archives[0], {
          isLatestArchive: true,
          forceRefresh: true,
        });

        if (activeUserSessionRef.current !== sessionId) return;

        loadedArchiveSetRef.current.add(archives[0]);
        setLoadedArchiveCount(1);
        setAllLoadedGames((prev) =>
          forceRefresh ? mergeAndDeduplicateChessComGames(prev, firstMonthGames) : firstMonthGames
        );
        setIsInitialLoading(false);

        // Automatically paginate through subsequent monthly archives so the list is not stuck at 1 month (e.g. 166 games)
        const autoMonthsToLoad = Math.min(
          archives.length - 1,
          INITIAL_AUTO_ARCHIVE_MONTHS - 1
        );
        if (autoMonthsToLoad > 0) {
          await loadNextArchiveBatch(archives, sessionId, autoMonthsToLoad, false);
        }
      } catch (err) {
        if (activeUserSessionRef.current !== sessionId) return;
        setErrorMsg(
          err instanceof Error ? err.message : 'Ошибка загрузки профиля Chess.com'
        );
        setIsInitialLoading(false);
      }
    },
    [loadNextArchiveBatch]
  );

  // Sync latest played games without losing already loaded pages or reloading the app
  const syncLatestGames = useCallback(async () => {
    const clean = searchedUsername.trim();
    if (!clean || isInitialLoading) return;
    const sessionId = activeUserSessionRef.current;

    setIsSyncingLatest(true);
    try {
      const latestArchives = await fetchChessComArchives(clean, { forceRefresh: true });
      if (activeUserSessionRef.current !== sessionId || latestArchives.length === 0) return;

      setArchiveUrls((prev) => {
        const seen = new Set(latestArchives);
        const merged = [...latestArchives];
        for (const u of prev) {
          if (!seen.has(u)) merged.push(u);
        }
        return merged;
      });

      const newestUrl = latestArchives[0];
      const latestGames = await fetchChessComGamesByArchiveUrl(newestUrl, {
        forceRefresh: true,
        isLatestArchive: true,
      });

      if (activeUserSessionRef.current !== sessionId) return;

      loadedArchiveSetRef.current.add(newestUrl);
      setLoadedArchiveCount(loadedArchiveSetRef.current.size);
      setAllLoadedGames((prev) => mergeAndDeduplicateChessComGames(prev, latestGames));

      if (selectedArchiveUrl !== 'all' && selectedArchiveUrl === newestUrl) {
        setSingleMonthGames((prev) => mergeAndDeduplicateChessComGames(prev, latestGames));
      }
    } catch {
      // ignore background poll errors
    } finally {
      if (activeUserSessionRef.current === sessionId) {
        setIsSyncingLatest(false);
      }
    }
  }, [searchedUsername, isInitialLoading, selectedArchiveUrl]);

  // Trigger initial load when modal opens or searchedUsername changes
  useEffect(() => {
    if (!isOpen || !searchedUsername) return;
    if (allLoadedGames.length === 0 || profile?.username.toLowerCase() !== searchedUsername.toLowerCase()) {
      loadUserArchivesAndGames(searchedUsername, false);
    } else {
      syncLatestGames();
    }
  }, [isOpen, searchedUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a specific month is selected, ensure its games are loaded
  useEffect(() => {
    if (!isOpen || !selectedArchiveUrl || selectedArchiveUrl === 'all') return;
    let cancelled = false;
    const isLatest = archiveUrls[0] === selectedArchiveUrl;

    setIsLoadingMoreArchives(true);
    fetchChessComGamesByArchiveUrl(selectedArchiveUrl, {
      isLatestArchive: isLatest,
      forceRefresh: isLatest,
    })
      .then((games) => {
        if (cancelled) return;
        setSingleMonthGames(games);
        loadedArchiveSetRef.current.add(selectedArchiveUrl);
        setLoadedArchiveCount(loadedArchiveSetRef.current.size);
        setAllLoadedGames((prev) => mergeAndDeduplicateChessComGames(prev, games));
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Ошибка загрузки архива за выбранный месяц'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingMoreArchives(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedArchiveUrl, archiveUrls]);

  // Auto-sync when a new game finishes (poll every 15s while open + on window focus / visibilitychange)
  useEffect(() => {
    if (!isOpen || !searchedUsername) return;

    const intervalId = window.setInterval(() => {
      syncLatestGames();
    }, 15000);

    const handleFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        syncLatestGames();
      }
    };

    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
    };
  }, [isOpen, searchedUsername, syncLatestGames]);

  const activeSourceGames = selectedArchiveUrl === 'all' ? allLoadedGames : singleMonthGames;

  const filteredGames = useMemo(() => {
    return activeSourceGames.filter((game) => {
      const mapped = mapChessComResult(game, searchedUsername);
      if (resultFilter !== 'all' && mapped.outcome !== resultFilter) return false;
      if (colorFilter !== 'all' && mapped.userColor !== colorFilter) return false;
      if (timeClassFilter !== 'all' && game.time_class !== timeClassFilter) return false;
      return true;
    });
  }, [activeSourceGames, searchedUsername, resultFilter, colorFilter, timeClassFilter]);

  const displayedGames = useMemo(
    () => filteredGames.slice(0, visibleCount),
    [filteredGames, visibleCount]
  );

  const hasMoreUnloadedArchives =
    selectedArchiveUrl === 'all' && loadedArchiveCount < archiveUrls.length;

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 320) {
      if (visibleCount < filteredGames.length) {
        setVisibleCount((prev) => prev + VISIBLE_GAMES_STEP);
      } else if (hasMoreUnloadedArchives && !isLoadingMoreArchives) {
        loadNextArchiveBatch(archiveUrls, activeUserSessionRef.current, 3, false);
      }
    }
  };

  if (!isOpen) return null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === searchedUsername.toLowerCase()) {
      syncLatestGames();
      if (hasMoreUnloadedArchives) {
        loadNextArchiveBatch(archiveUrls, activeUserSessionRef.current, 4, true);
      }
    } else {
      setSelectedArchiveUrl('all');
      setSearchedUsername(trimmed);
    }
  };

  const formatArchiveLabel = (url: string) => {
    const parts = url.split('/');
    const month = parts[parts.length - 1];
    const year = parts[parts.length - 2];
    return `${year} / ${month}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-lg shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--chess-border)]">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#779954]" />
            <h3 className="text-sm font-bold text-[var(--chess-text-primary)]">
              Импорт партий через Chess.com PubAPI
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Profile Bar */}
        <div className="p-4 border-b border-[var(--chess-border)] bg-[var(--chess-bg-secondary)] space-y-3">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[var(--chess-text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Введите никнейм игрока на Chess.com..."
                className="w-full pl-9 pr-3 py-2 rounded-md bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)] focus:outline-none focus:border-[#779954]"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold whitespace-nowrap"
            >
              Найти архивы
            </button>
            <button
              type="button"
              onClick={() => syncLatestGames()}
              disabled={isSyncingLatest || isInitialLoading}
              title="Синхронизировать новые сыгранные партии без перезагрузки"
              className="px-3 py-2 rounded-md bg-[var(--chess-bg-primary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-xs font-medium text-[var(--chess-text-primary)] flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncingLatest ? 'animate-spin text-[#779954]' : ''}`}
              />
              <span className="hidden sm:inline">Обновить</span>
            </button>
          </form>

          {/* Quick Grandmaster Presets */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--chess-text-secondary)] text-[11px]">Быстрый выбор:</span>
            {QUICK_PROFILES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setUsernameInput(name);
                  if (searchedUsername.toLowerCase() !== name.toLowerCase()) {
                    setSelectedArchiveUrl('all');
                    setSearchedUsername(name);
                  } else {
                    syncLatestGames();
                  }
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  searchedUsername.toLowerCase() === name.toLowerCase()
                    ? 'bg-[#779954] text-white'
                    : 'bg-[var(--chess-bg-primary)] text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)] border border-[var(--chess-border)]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Profile Info & Archive Period Selector */}
          {profile && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--chess-border)]">
              <div className="flex items-center gap-2.5">
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={profile.username}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-full object-cover border border-[var(--chess-border)]"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#779954]/20 flex items-center justify-center text-[#779954]">
                    <User className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <div className="text-xs font-bold text-[var(--chess-text-primary)] flex items-center gap-1.5">
                    {profile.title && (
                      <span className="text-[#E05252] font-mono-tabular">{profile.title}</span>
                    )}
                    <span>{profile.username}</span>
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)]">
                    {profile.name || 'Профиль Chess.com'} · Архивов: {loadedArchiveCount} /{' '}
                    {archiveUrls.length}
                  </div>
                </div>
              </div>

              {/* Year / Month Archive Dropdown (no 36-month limit + full archive option) */}
              {archiveUrls.length > 0 && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-[var(--chess-text-secondary)]" />
                  <select
                    value={selectedArchiveUrl}
                    onChange={(e) => setSelectedArchiveUrl(e.target.value)}
                    className="px-2.5 py-1.5 rounded bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] text-xs font-mono-tabular text-[var(--chess-text-primary)]"
                  >
                    <option value="all">
                      Все периоды ({allLoadedGames.length} парт.)
                    </option>
                    {archiveUrls.map((url) => (
                      <option key={url} value={url}>
                        {formatArchiveLabel(url)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filters Bar */}
        <div className="px-4 py-2.5 border-b border-[var(--chess-border)] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Result filter */}
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
              className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
            >
              <option value="all">Все результаты</option>
              <option value="win">Победы</option>
              <option value="draw">Ничьи</option>
              <option value="loss">Поражения</option>
            </select>

            {/* Color filter */}
            <select
              value={colorFilter}
              onChange={(e) => setColorFilter(e.target.value as typeof colorFilter)}
              className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
            >
              <option value="all">Любой цвет</option>
              <option value="w">За белых</option>
              <option value="b">За чёрных</option>
            </select>

            {/* Time Control filter */}
            <select
              value={timeClassFilter}
              onChange={(e) => setTimeClassFilter(e.target.value as typeof timeClassFilter)}
              className="px-2.5 py-1 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs text-[var(--chess-text-primary)]"
            >
              <option value="all">Любой контроль</option>
              <option value="bullet">Пуля (Bullet)</option>
              <option value="blitz">Блиц (Blitz)</option>
              <option value="rapid">Рапид (Rapid)</option>
              <option value="daily">Заочные (Daily)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono-tabular text-[var(--chess-text-secondary)]">
            {isLoadingMoreArchives && (
              <span className="flex items-center gap-1 text-[#779954]">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Подгрузка...</span>
              </span>
            )}
            <span>Найдено партий: {filteredGames.length}</span>
          </div>
        </div>

        {/* Games List */}
        <div
          onScroll={handleListScroll}
          className="flex-1 overflow-y-auto divide-y divide-[var(--chess-border)]"
        >
          {isInitialLoading && allLoadedGames.length === 0 && (
            <div className="p-8 flex items-center justify-center gap-2 text-xs text-[var(--chess-text-secondary)]">
              <Loader2 className="w-4 h-4 animate-spin text-[#779954]" />
              <span>Загрузка данных с Chess.com PubAPI...</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-6 text-center text-xs text-[#E05252]">{errorMsg}</div>
          )}

          {!isInitialLoading && !errorMsg && filteredGames.length === 0 && (
            <div className="p-8 text-center text-xs text-[var(--chess-text-secondary)]">
              Нет партий за выбранный период и фильтр.
            </div>
          )}

          {displayedGames.map((game) => {
            const mapped = mapChessComResult(game, searchedUsername);
            const dateStr = new Date(game.end_time * 1000).toLocaleDateString('ru-RU');

            return (
              <div
                key={getChessComGameKey(game)}
                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--chess-bg-secondary)] transition-colors text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 font-medium text-[var(--chess-text-primary)] truncate">
                    <span>
                      ⬜ {game.white.username}{' '}
                      <span className="text-[var(--chess-text-secondary)] font-mono-tabular">
                        ({game.white.rating || '?'})
                      </span>
                    </span>
                    <span className="text-[var(--chess-text-secondary)]">vs</span>
                    <span>
                      ⬛ {game.black.username}{' '}
                      <span className="text-[var(--chess-text-secondary)] font-mono-tabular">
                        ({game.black.rating || '?'})
                      </span>
                    </span>
                  </div>

                  <div className="text-[11px] text-[var(--chess-text-secondary)] font-mono-tabular flex items-center gap-2">
                    <span
                      className={`font-bold ${
                        mapped.outcome === 'win'
                          ? 'text-[#779954]'
                          : mapped.outcome === 'loss'
                          ? 'text-[#E05252]'
                          : 'text-[var(--chess-text-secondary)]'
                      }`}
                    >
                      {mapped.outcome === 'win'
                        ? 'Победа'
                        : mapped.outcome === 'loss'
                        ? 'Поражение'
                        : 'Ничья'}{' '}
                      ({mapped.resultString})
                    </span>
                    <span>·</span>
                    <span>{game.time_class || game.time_control}</span>
                    <span>·</span>
                    <span>{dateStr}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    if (game.pgn) {
                      const isSearchedWhite =
                        game.white.username.toLowerCase() === searchedUsername.toLowerCase();
                      const oppUsername = isSearchedWhite
                        ? game.black.username
                        : game.white.username;
                      let oppTitle: string | undefined;
                      try {
                        const oppProfile = await fetchChessComProfile(oppUsername);
                        oppTitle = oppProfile.title;
                      } catch {
                        // ignore
                      }
                      const whiteTitle = isSearchedWhite ? profile?.title : oppTitle;
                      const blackTitle = isSearchedWhite ? oppTitle : profile?.title;

                      loadPgnGame(game.pgn, 'Chess.com', { whiteTitle, blackTitle });
                      onClose();
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Импорт</span>
                </button>
              </div>
            );
          })}

          {/* Pagination & Load More Controls */}
          {(visibleCount < filteredGames.length || hasMoreUnloadedArchives) && (
            <div className="p-3 bg-[var(--chess-bg-secondary)] flex flex-wrap items-center justify-center gap-2 text-xs">
              {visibleCount < filteredGames.length && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + VISIBLE_GAMES_STEP)}
                  className="px-3 py-1.5 rounded bg-[var(--chess-bg-primary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-[var(--chess-text-primary)] font-medium flex items-center gap-1"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>
                    Показать ещё ({displayedGames.length} из {filteredGames.length})
                  </span>
                </button>
              )}

              {hasMoreUnloadedArchives && (
                <>
                  <button
                    type="button"
                    disabled={isLoadingMoreArchives}
                    onClick={() =>
                      loadNextArchiveBatch(archiveUrls, activeUserSessionRef.current, 6, false)
                    }
                    className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white font-semibold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isLoadingMoreArchives ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    <span>
                      Подгрузить следующие месяцы ({loadedArchiveCount} / {archiveUrls.length})
                    </span>
                  </button>

                  {archiveUrls.length - loadedArchiveCount > 6 && (
                    <button
                      type="button"
                      disabled={isLoadingMoreArchives}
                      onClick={() =>
                        loadNextArchiveBatch(
                          archiveUrls,
                          activeUserSessionRef.current,
                          archiveUrls.length,
                          false
                        )
                      }
                      className="px-3 py-1.5 rounded bg-[var(--chess-bg-primary)] hover:bg-[var(--chess-border)] border border-[var(--chess-border)] text-[var(--chess-text-primary)] font-medium disabled:opacity-50"
                    >
                      Загрузить все архивы ({archiveUrls.length})
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
