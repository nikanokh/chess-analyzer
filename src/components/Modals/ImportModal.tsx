import React, { useRef, useState } from 'react';
import { useGameStore } from '../../stores/useGameStore';
import { SAMPLE_MASTER_GAMES } from '../../services/PgnService/pgnService';
import { DEFAULT_START_FEN } from '../../core/chess/VariationTree';
import { openingBook } from '../../core/chess/OpeningBook';
import { BookPlus, FileText, Upload, X } from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose }) => {
  const loadPgnGame = useGameStore((s) => s.loadPgnGame);
  const loadFenPosition = useGameStore((s) => s.loadFenPosition);

  const [tab, setTab] = useState<'pgn' | 'fen' | 'samples' | 'book'>('pgn');
  const [pgnInput, setPgnInput] = useState('');
  const [fenInput, setFenInput] = useState(DEFAULT_START_FEN);
  const [localError, setLocalError] = useState<string | null>(null);

  // Custom Opening Book Entry state (Section 16.4)
  const [customEco, setCustomEco] = useState('C50');
  const [customName, setCustomName] = useState('');
  const [customVariation, setCustomVariation] = useState('');
  const [customMoves, setCustomMoves] = useState('e4 e5 Nf3 Nc6 Bc4');
  const [bookSavedMsg, setBookSavedMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleLoadPgn = () => {
    setLocalError(null);
    if (!pgnInput.trim()) {
      setLocalError('Вставьте текст PGN или выберите файл .pgn');
      return;
    }
    loadPgnGame(pgnInput.trim(), 'PGN');
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = typeof ev.target?.result === 'string' ? ev.target.result : '';
      if (content) {
        setPgnInput(content);
      }
    };
    reader.readAsText(file);
  };

  const handleLoadFen = () => {
    setLocalError(null);
    if (!fenInput.trim()) {
      setLocalError('Введите корректную строку FEN');
      return;
    }
    loadFenPosition(fenInput.trim());
    onClose();
  };

  const handleAddOpeningEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customMoves.trim()) return;
    const sanList = customMoves
      .trim()
      .replace(/\d+\.(\.\.)?/g, '')
      .split(/\s+/)
      .filter(Boolean);

    openingBook.addCustomEntries([
      {
        eco: customEco.trim() || 'A00',
        name: customName.trim(),
        variation: customVariation.trim() || 'Пользовательский вариант',
        pgnMoves: sanList,
      },
    ]);

    setBookSavedMsg(`Дебют «${customName}» добавлен в локальную базу теории ECO.`);
    setCustomName('');
    setCustomVariation('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-[var(--chess-bg-primary)] border border-[var(--chess-border)] rounded-lg shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--chess-border)]">
          <h3 className="text-sm font-bold text-[var(--chess-text-primary)]">
            Импорт партии PGN / Позиции FEN
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[var(--chess-border)] bg-[var(--chess-bg-secondary)]">
          {[
            { id: 'pgn', label: 'Текст / Файл PGN' },
            { id: 'fen', label: 'Позиция FEN' },
            { id: 'samples', label: 'Классические партии' },
            { id: 'book', label: 'База дебютов ECO' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id as typeof tab);
                setLocalError(null);
              }}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-[#779954] text-[#779954] bg-[var(--chess-bg-primary)] rounded-t'
                  : 'border-transparent text-[var(--chess-text-secondary)] hover:text-[var(--chess-text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-4">
          {localError && (
            <div className="p-2.5 rounded bg-[#E05252]/15 border border-[#E05252] text-xs text-[#E05252]">
              {localError}
            </div>
          )}

          {tab === 'pgn' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--chess-text-secondary)]">
                  Вставьте PGN-код партии или загрузите файл .pgn
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pgn,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded bg-[var(--chess-bg-secondary)] hover:bg-[var(--chess-border)] text-xs font-medium text-[var(--chess-text-primary)] flex items-center gap-1.5 border border-[var(--chess-border)]"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Выбрать .pgn файл</span>
                </button>
              </div>

              <textarea
                rows={8}
                value={pgnInput}
                onChange={(e) => setPgnInput(e.target.value)}
                placeholder={`[Event "Live Chess"]\n[White "Player1"]\n[Black "Player2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 ...`}
                className="w-full p-3 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs font-mono-tabular text-[var(--chess-text-primary)] focus:outline-none focus:border-[#779954]"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-md text-xs font-medium text-[var(--chess-text-secondary)] hover:bg-[var(--chess-bg-secondary)]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleLoadPgn}
                  className="px-4 py-2 rounded-md bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Загрузить PGN</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'fen' && (
            <div className="space-y-3">
              <label className="text-xs font-medium text-[var(--chess-text-secondary)] block">
                Строка позиции FEN
              </label>
              <input
                type="text"
                value={fenInput}
                onChange={(e) => setFenInput(e.target.value)}
                className="w-full p-2.5 rounded-md bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs font-mono-tabular text-[var(--chess-text-primary)] focus:outline-none focus:border-[#779954]"
              />

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setFenInput(DEFAULT_START_FEN)}
                  className="text-xs text-[#779954] hover:underline"
                >
                  Сбросить к начальной позиции
                </button>

                <button
                  type="button"
                  onClick={handleLoadFen}
                  className="px-4 py-2 rounded-md bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold"
                >
                  Установить позицию FEN
                </button>
              </div>
            </div>
          )}

          {tab === 'samples' && (
            <div className="space-y-2.5">
              <p className="text-xs text-[var(--chess-text-secondary)]">
                Выберите одну из знаменитых партий для мгновенной проверки анализатора, дерева вариантов и графика точности:
              </p>
              {SAMPLE_MASTER_GAMES.map((sample, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    loadPgnGame(sample.pgn, 'PGN');
                    onClose();
                  }}
                  className="p-3 rounded-md bg-[var(--chess-bg-secondary)] hover:bg-[#779954]/15 border border-[var(--chess-border)] cursor-pointer transition-colors"
                >
                  <div className="text-xs font-bold text-[var(--chess-text-primary)]">
                    {sample.title}
                  </div>
                  <div className="text-[11px] text-[var(--chess-text-secondary)] mt-0.5">
                    {sample.subtitle}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'book' && (
            <form onSubmit={handleAddOpeningEntry} className="space-y-3">
              <p className="text-xs text-[var(--chess-text-secondary)]">
                Пополните локальную дебютную базу теоретической линией (с поддержкой автоматического распознавания транспозиций по FEN):
              </p>
              {bookSavedMsg && (
                <div className="p-2 rounded bg-[#779954]/15 border border-[#779954] text-xs text-[#779954]">
                  {bookSavedMsg}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-[var(--chess-text-secondary)] block mb-1">
                    Код ECO
                  </label>
                  <input
                    type="text"
                    value={customEco}
                    onChange={(e) => setCustomEco(e.target.value)}
                    placeholder="C50"
                    className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs font-mono-tabular"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-[var(--chess-text-secondary)] block mb-1">
                    Название дебюта
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Итальянская партия"
                    required
                    className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[var(--chess-text-secondary)] block mb-1">
                  Вариант
                </label>
                <input
                  type="text"
                  value={customVariation}
                  onChange={(e) => setCustomVariation(e.target.value)}
                  placeholder="Гамбит Эванса"
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] text-[var(--chess-text-secondary)] block mb-1">
                  Последовательность ходов (SAN)
                </label>
                <input
                  type="text"
                  value={customMoves}
                  onChange={(e) => setCustomMoves(e.target.value)}
                  placeholder="e4 e5 Nf3 Nc6 Bc4 Bc5 b4"
                  required
                  className="w-full p-2 rounded bg-[var(--chess-bg-secondary)] border border-[var(--chess-border)] text-xs font-mono-tabular"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-[#779954] hover:bg-[#62934B] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <BookPlus className="w-3.5 h-3.5" />
                  <span>Добавить в базу теории</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
