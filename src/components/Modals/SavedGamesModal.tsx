import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/useGameStore';
import { Database, FolderOpen, PlusCircle, RefreshCw, Trash2, X } from 'lucide-react';

interface SavedGamesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SavedGamesModal: React.FC<SavedGamesModalProps> = ({ isOpen, onClose }) => {
  const loadSavedGameRecord = useGameStore((s) => s.loadSavedGameRecord);
  const currentGameId = useGameStore((s) => s.gameId);
  const records = useGameStore((s) => s.savedGames);
  const refreshSavedGames = useGameStore((s) => s.refreshSavedGames);
  const removeSavedGame = useGameStore((s) => s.removeSavedGame);
  const startNewGame = useGameStore((s) => s.startNewGame);

  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshSavedGames();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleRefresh();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeSavedGame(id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--chess-border)] gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-4 h-4 text-[#779954] shrink-0" />
            <h3 className="text-sm font-bold text-[var(--chess-text-primary)] truncate">
              Сохранённые партии и история анализа ({records.length})
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                startNewGame();
                onClose();
              }}
              className="px-2.5 py-1 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1 transition-colors"
              title="Начать новую свободную партию на доске"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Новая партия</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="p-1.5 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)] hover:bg-[var(--chess-bg-secondary)] transition-colors"
              title="Обновить список"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[var(--chess-border)]">
          {loading && records.length === 0 && (
            <div className="p-8 text-center text-xs text-[var(--chess-text-secondary)]">
              Загрузка локальной базы...
            </div>
          )}

          {!loading && records.length === 0 && (
            <div className="p-8 text-center text-xs text-[var(--chess-text-secondary)]">
              В локальном хранилище пока нет сохранённых партий.
            </div>
          )}

          {records.map((rec) => {
            const isCurrent = rec.id === currentGameId;
            return (
              <div
                key={rec.id}
                onClick={() => {
                  loadSavedGameRecord(rec);
                  onClose();
                }}
                className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors text-xs ${
                  isCurrent
                    ? 'bg-[#779954]/15'
                    : 'hover:bg-[var(--chess-bg-secondary)]'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-bold text-[var(--chess-text-primary)] truncate flex items-center gap-1.5">
                    <span className="truncate">
                      {rec.metadata.whiteName} vs {rec.metadata.blackName}
                    </span>
                    <span className="font-mono-tabular font-normal text-[var(--chess-text-secondary)] shrink-0">
                      ({rec.metadata.result})
                    </span>
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 rounded bg-[#779954]/20 text-[#779954] text-[10px] font-semibold shrink-0">
                        Активна
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-[var(--chess-text-secondary)] font-mono-tabular flex flex-wrap items-center gap-2">
                    <span>{rec.metadata.platform}</span>
                    <span>·</span>
                    <span>{rec.metadata.date}</span>
                    {rec.openingSummary && (
                      <>
                        <span>·</span>
                        <span>
                          {rec.openingSummary.eco} {rec.openingSummary.name}
                        </span>
                      </>
                    )}
                    {rec.statistics && (
                      <>
                        <span>·</span>
                        <span className="text-[#779954] font-semibold">
                          Точность: {rec.statistics.whiteAccuracy}% / {rec.statistics.blackAccuracy}%
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      loadSavedGameRecord(rec);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Открыть</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDelete(rec.id, e)}
                    className="p-1.5 rounded text-[var(--chess-text-secondary)] hover:text-[#E05252] hover:bg-[#E05252]/10"
                    title="Удалить из хранилища"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
