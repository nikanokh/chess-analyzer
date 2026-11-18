import { MoveCategory } from '../types/chess';

export const PIECE_ASSETS: Record<string, string> = {
  wP: '/assets/aistudio/wp_87566929.png',
  wN: '/assets/aistudio/wn_8a174713.png',
  wB: '/assets/aistudio/wb_c7fd4cf4.png',
  wR: '/assets/aistudio/wr_1dc20630.png',
  wQ: '/assets/aistudio/wq_48e2b72f.png',
  wK: '/assets/aistudio/wk_02ecadd7.png',
  bP: '/assets/aistudio/bp_aa7fc9d5.png',
  bN: '/assets/aistudio/bn_884e0790.png',
  bB: '/assets/aistudio/bb_9d477ceb.png',
  bR: '/assets/aistudio/br_15f53d5d.png',
  bQ: '/assets/aistudio/bq_c4f80cab.png',
  bK: '/assets/aistudio/bk_50e85d68.png',
};

export const BOARD_TEXTURE_ASSET = '/assets/aistudio/9rdwe_ba9771fd.png';

export const CATEGORY_ICONS: Record<MoveCategory, string> = {
  Brilliant: '/assets/aistudio/brilliant_48bc72f7.png',
  Great: '/assets/aistudio/great_e818d09f.png',
  Best: '/assets/aistudio/best_645b0819.png',
  Excellent: '/assets/aistudio/excellent_af5ddd47.png',
  Good: '/assets/aistudio/good_0a9d8c87.png',
  Book: '/assets/aistudio/book_a75c6bc2.png',
  Forced: '/assets/aistudio/forced_cc7740a6.png',
  Inaccuracy: '/assets/aistudio/inaccuracy_0fc0d495.png',
  Mistake: '/assets/aistudio/mistake_e9945d6f.png',
  Blunder: '/assets/aistudio/blunder_a2e0d84a.png',
  MissedChance: '/assets/aistudio/missed_chance_44af9bdc.png',
};

export const CATEGORY_META: Record<
  MoveCategory,
  {
    labelRu: string;
    labelEn: string;
    symbol: string;
    color: string;
    bgColor: string;
  }
> = {
  Brilliant: {
    labelRu: 'Бриллиантовый',
    labelEn: 'Brilliant',
    symbol: '!!',
    color: '#1BACA6',
    bgColor: 'rgba(27, 172, 166, 0.14)',
  },
  Great: {
    labelRu: 'Отличный ход',
    labelEn: 'Great Move',
    symbol: '!',
    color: '#5C8BB0',
    bgColor: 'rgba(92, 139, 176, 0.14)',
  },
  Best: {
    labelRu: 'Лучший ход',
    labelEn: 'Best Move',
    symbol: '★',
    color: '#779954',
    bgColor: 'rgba(119, 153, 84, 0.14)',
  },
  Excellent: {
    labelRu: 'Прекрасный',
    labelEn: 'Excellent',
    symbol: '👍',
    color: '#81B64C',
    bgColor: 'rgba(129, 182, 76, 0.14)',
  },
  Good: {
    labelRu: 'Хороший',
    labelEn: 'Good',
    symbol: '✓',
    color: '#95B776',
    bgColor: 'rgba(149, 183, 118, 0.14)',
  },
  Book: {
    labelRu: 'Теория',
    labelEn: 'Book',
    symbol: '📖',
    color: '#A88865',
    bgColor: 'rgba(168, 136, 101, 0.14)',
  },
  Forced: {
    labelRu: 'Форсированный',
    labelEn: 'Forced',
    symbol: '→',
    color: '#779954',
    bgColor: 'rgba(119, 153, 84, 0.14)',
  },
  Inaccuracy: {
    labelRu: 'Неточность',
    labelEn: 'Inaccuracy',
    symbol: '?!',
    color: '#F0C15C',
    bgColor: 'rgba(240, 193, 92, 0.16)',
  },
  Mistake: {
    labelRu: 'Ошибка',
    labelEn: 'Mistake',
    symbol: '?',
    color: '#E6912C',
    bgColor: 'rgba(230, 145, 44, 0.16)',
  },
  MissedChance: {
    labelRu: 'Упущенный шанс',
    labelEn: 'Missed Win',
    symbol: '✖',
    color: '#EE6B5E',
    bgColor: 'rgba(238, 107, 94, 0.16)',
  },
  Blunder: {
    labelRu: 'Зевок',
    labelEn: 'Blunder',
    symbol: '??',
    color: '#CA3431',
    bgColor: 'rgba(202, 52, 49, 0.16)',
  },
};
