import { PlayerColor } from '../../types/chess';
import {
  ColorSplitStats,
  ContinuationPerformanceSummary,
  OpeningAnalysisCacheRecord,
  OpeningStatsSummary,
  ProblematicContinuationItem,
  ProblematicGameExample,
  RepertoireTreeNode,
  VariationStatsSummary,
} from '../../types/repertoire';
import { DEFAULT_START_FEN } from '../chess/VariationTree';
import { normalizeLegalEpFenKey } from '../chess/OpeningBook';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function computeColorSplitStats(records: OpeningAnalysisCacheRecord[]): ColorSplitStats {
  const gamesCount = records.length;
  if (gamesCount === 0) {
    return {
      gamesCount: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      drawRate: 0,
      lossRate: 0,
      avgAccuracy: null,
      avgCpl: null,
      avgOpponentRating: null,
      avgMovesLength: 0,
    };
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  const accuracies: number[] = [];
  const cpls: number[] = [];
  const oppRatings: number[] = [];
  let totalMovesSum = 0;

  for (const r of records) {
    if (r.outcome === 'win') wins++;
    else if (r.outcome === 'draw') draws++;
    else losses++;

    if (typeof r.playerAccuracy === 'number' && Number.isFinite(r.playerAccuracy)) {
      accuracies.push(r.playerAccuracy);
    }
    if (typeof r.playerAvgCpl === 'number' && Number.isFinite(r.playerAvgCpl)) {
      cpls.push(r.playerAvgCpl);
    }
    if (typeof r.opponentRating === 'number' && r.opponentRating > 0) {
      oppRatings.push(r.opponentRating);
    }
    totalMovesSum += r.totalMoves || Math.ceil(r.totalPlies / 2);
  }

  return {
    gamesCount,
    wins,
    draws,
    losses,
    winRate: round1((wins / gamesCount) * 100),
    drawRate: round1((draws / gamesCount) * 100),
    lossRate: round1((losses / gamesCount) * 100),
    avgAccuracy:
      accuracies.length > 0
        ? round1(accuracies.reduce((s, v) => s + v, 0) / accuracies.length)
        : null,
    avgCpl:
      cpls.length > 0
        ? Math.round(cpls.reduce((s, v) => s + v, 0) / cpls.length)
        : null,
    avgOpponentRating:
      oppRatings.length > 0
        ? Math.round(oppRatings.reduce((s, v) => s + v, 0) / oppRatings.length)
        : null,
    avgMovesLength: Math.round(totalMovesSum / gamesCount),
  };
}

/**
 * Aggregates OpeningStatsSummary items across a set of `OpeningAnalysisCacheRecord` records.
 */
export function buildOpeningStatsList(
  records: OpeningAnalysisCacheRecord[]
): OpeningStatsSummary[] {
  const totalGames = records.length;
  if (totalGames === 0) return [];

  const groups = new Map<string, OpeningAnalysisCacheRecord[]>();
  for (const rec of records) {
    // Group by official opening name (and primary ECO prefix) so transpositions into the same opening aggregate cleanly
    const key = rec.isUndefinedOpening
      ? 'UNDEFINED__Неопределённый дебют'
      : `${rec.openingName}`;
    const arr = groups.get(key);
    if (arr) {
      arr.push(rec);
    } else {
      groups.set(key, [rec]);
    }
  }

  const summaries: OpeningStatsSummary[] = [];

  for (const [, groupRecords] of groups.entries()) {
    const overall = computeColorSplitStats(groupRecords);
    const whiteRecords = groupRecords.filter((r) => r.playerColor === 'w');
    const blackRecords = groupRecords.filter((r) => r.playerColor === 'b');
    const whiteStats = computeColorSplitStats(whiteRecords);
    const blackStats = computeColorSplitStats(blackRecords);

    // Pick representative ECO (most common ECO in this opening group)
    const ecoCounts = new Map<string, number>();
    for (const r of groupRecords) {
      ecoCounts.set(r.eco, (ecoCounts.get(r.eco) || 0) + 1);
    }
    let primaryEco = groupRecords[0].eco;
    let maxEcoCount = 0;
    for (const [eco, cnt] of ecoCounts.entries()) {
      if (cnt > maxEcoCount) {
        maxEcoCount = cnt;
        primaryEco = eco;
      }
    }

    // Group variations within this opening
    const varMap = new Map<string, OpeningAnalysisCacheRecord[]>();
    for (const r of groupRecords) {
      const vKey = r.variationName || 'Основное продолжение';
      const vArr = varMap.get(vKey);
      if (vArr) vArr.push(r);
      else varMap.set(vKey, [r]);
    }

    const variations: VariationStatsSummary[] = [];
    for (const [vName, vRecs] of varMap.entries()) {
      const vStats = computeColorSplitStats(vRecs);
      const sampleSteps = vRecs[0]?.openingMoves.slice(0, 10).map((m) => m.san) || [];
      variations.push({
        variationName: vName,
        eco: vRecs[0]?.eco || primaryEco,
        gamesCount: vStats.gamesCount,
        wins: vStats.wins,
        draws: vStats.draws,
        losses: vStats.losses,
        winRate: vStats.winRate,
        drawRate: vStats.drawRate,
        lossRate: vStats.lossRate,
        avgAccuracy: vStats.avgAccuracy,
        avgCpl: vStats.avgCpl,
        sampleMovesSan: sampleSteps,
        gameIds: vRecs.map((x) => x.gameId),
      });
    }
    variations.sort((a, b) => b.gamesCount - a.gamesCount);

    // Continuation performance at ply 8 (or max available up to ply 8)
    const contMap = new Map<
      string,
      { movesSan: string[]; ply: number; color: PlayerColor; recs: OpeningAnalysisCacheRecord[] }
    >();
    for (const r of groupRecords) {
      const slice = r.openingMoves.slice(0, 8);
      if (slice.length === 0) continue;
      const movesSan = slice.map((s) => s.san);
      const lineKey = `${r.playerColor}:${movesSan.join(' ')}`;
      const existing = contMap.get(lineKey);
      if (existing) {
        existing.recs.push(r);
      } else {
        contMap.set(lineKey, {
          movesSan,
          ply: slice[slice.length - 1].ply,
          color: r.playerColor,
          recs: [r],
        });
      }
    }

    const allContinuations: ContinuationPerformanceSummary[] = [];
    for (const [lineKey, cData] of contMap.entries()) {
      const cStats = computeColorSplitStats(cData.recs);
      allContinuations.push({
        lineKey,
        movesSan: cData.movesSan,
        ply: cData.ply,
        color: cData.color,
        gamesCount: cStats.gamesCount,
        winRate: cStats.winRate,
        avgAccuracy: cStats.avgAccuracy,
        avgCpl: cStats.avgCpl,
      });
    }

    const bestContinuations = [...allContinuations]
      .filter((c) => c.winRate >= 50)
      .sort((a, b) => b.winRate - a.winRate || b.gamesCount - a.gamesCount)
      .slice(0, 3);

    const problematicContinuations = [...allContinuations]
      .filter((c) => c.winRate < 50 || (c.avgCpl !== null && c.avgCpl >= 45))
      .sort((a, b) => a.winRate - b.winRate || b.gamesCount - a.gamesCount)
      .slice(0, 3);

    const analyzedGamesCount = groupRecords.filter(
      (r) => typeof r.playerAccuracy === 'number'
    ).length;

    summaries.push({
      key: `${primaryEco}__${groupRecords[0].openingName}`,
      eco: primaryEco,
      openingName: groupRecords[0].openingName,
      isUndefinedOpening: groupRecords[0].isUndefinedOpening,
      gamesCount: overall.gamesCount,
      frequencyPercent: round1((overall.gamesCount / totalGames) * 100),
      wins: overall.wins,
      draws: overall.draws,
      losses: overall.losses,
      winRate: overall.winRate,
      drawRate: overall.drawRate,
      lossRate: overall.lossRate,
      avgAccuracy: overall.avgAccuracy,
      avgCpl: overall.avgCpl,
      avgOpponentRating: overall.avgOpponentRating,
      avgMovesLength: overall.avgMovesLength,
      analyzedGamesCount,
      lowSampleConfidence: overall.gamesCount < 5,
      whiteStats,
      blackStats,
      variations,
      bestContinuations,
      problematicContinuations,
      gameIds: groupRecords.map((r) => r.gameId),
    });
  }

  return summaries.sort((a, b) => b.gamesCount - a.gamesCount || b.winRate - a.winRate);
}

/**
 * Builds an interactive RepertoireTreeNode tree for a specific player color ('w' or 'b')
 * from actual move sequences played across all matching games.
 */
export function buildRepertoireMoveTree(
  records: OpeningAnalysisCacheRecord[],
  targetColor: PlayerColor,
  maxDepthPly = 20
): RepertoireTreeNode {
  const colorRecords = records.filter((r) => r.playerColor === targetColor);
  const rootStats = computeColorSplitStats(colorRecords);

  const root: RepertoireTreeNode = {
    id: `tree_root_${targetColor}`,
    ply: 0,
    moveNumber: 0,
    color: 'b',
    san: 'Начальная позиция',
    uci: '',
    fen: DEFAULT_START_FEN,
    positionKey: normalizeLegalEpFenKey(DEFAULT_START_FEN),
    isTheoretical: true,
    gamesCount: rootStats.gamesCount,
    wins: rootStats.wins,
    draws: rootStats.draws,
    losses: rootStats.losses,
    winRate: rootStats.winRate,
    drawRate: rootStats.drawRate,
    lossRate: rootStats.lossRate,
    avgAccuracy: rootStats.avgAccuracy,
    avgCpl: rootStats.avgCpl,
    analyzedCount: colorRecords.filter((r) => typeof r.playerAccuracy === 'number').length,
    gameIds: colorRecords.map((r) => r.gameId),
    children: [],
  };

  interface MutableBuilderNode {
    node: RepertoireTreeNode;
    accValues: number[];
    cplValues: number[];
    childMap: Map<string, MutableBuilderNode>;
  }

  const rootBuilder: MutableBuilderNode = {
    node: root,
    accValues: [],
    cplValues: [],
    childMap: new Map(),
  };

  for (const rec of colorRecords) {
    let curr = rootBuilder;
    const steps = rec.openingMoves.slice(0, maxDepthPly);
    const moveAnalysesByPly = new Map<number, { acc: number; cpl: number }>();
    if (rec.moveAnalyses) {
      for (const ma of rec.moveAnalyses) {
        if (Number.isFinite(ma.moveAccuracy) && Number.isFinite(ma.cpl)) {
          moveAnalysesByPly.set(ma.ply, { acc: ma.moveAccuracy, cpl: ma.cpl });
        }
      }
    }

    for (const step of steps) {
      const childKey = `${step.ply}_${step.san}`;
      let nextBuilder = curr.childMap.get(childKey);
      if (!nextBuilder) {
        const newNode: RepertoireTreeNode = {
          id: `node_${targetColor}_${step.ply}_${step.uci}_${curr.childMap.size}`,
          ply: step.ply,
          moveNumber: step.moveNumber,
          color: step.color,
          san: step.san,
          uci: step.uci,
          fen: step.fenAfter,
          positionKey: step.positionKey,
          eco: step.ecoAtStep || rec.eco,
          openingName: step.openingNameAtStep || rec.openingName,
          variationName: step.variationAtStep || rec.variationName,
          isTheoretical: step.isTheoretical,
          gamesCount: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          winRate: 0,
          drawRate: 0,
          lossRate: 0,
          avgAccuracy: null,
          avgCpl: null,
          analyzedCount: 0,
          gameIds: [],
          children: [],
        };
        nextBuilder = {
          node: newNode,
          accValues: [],
          cplValues: [],
          childMap: new Map(),
        };
        curr.childMap.set(childKey, nextBuilder);
        curr.node.children.push(newNode);
      }

      const n = nextBuilder.node;
      n.gamesCount++;
      if (rec.outcome === 'win') n.wins++;
      else if (rec.outcome === 'draw') n.draws++;
      else n.losses++;
      n.gameIds.push(rec.gameId);

      // Attach move-level accuracy/CPL if available at this ply, otherwise game-level player accuracy/CPL
      const plyMetric = moveAnalysesByPly.get(step.ply);
      if (plyMetric && step.color === targetColor) {
        nextBuilder.accValues.push(plyMetric.acc);
        nextBuilder.cplValues.push(plyMetric.cpl);
        n.analyzedCount++;
      } else if (typeof rec.playerAccuracy === 'number') {
        nextBuilder.accValues.push(rec.playerAccuracy);
        if (typeof rec.playerAvgCpl === 'number') {
          nextBuilder.cplValues.push(rec.playerAvgCpl);
        }
        n.analyzedCount++;
      }

      curr = nextBuilder;
    }
  }

  function finalizeNode(b: MutableBuilderNode) {
    const n = b.node;
    if (n.gamesCount > 0) {
      n.winRate = round1((n.wins / n.gamesCount) * 100);
      n.drawRate = round1((n.draws / n.gamesCount) * 100);
      n.lossRate = round1((n.losses / n.gamesCount) * 100);
    }
    if (b.accValues.length > 0) {
      n.avgAccuracy = round1(
        b.accValues.reduce((s, v) => s + v, 0) / b.accValues.length
      );
    }
    if (b.cplValues.length > 0) {
      n.avgCpl = Math.round(
        b.cplValues.reduce((s, v) => s + v, 0) / b.cplValues.length
      );
    }
    n.children.sort((a, c) => c.gamesCount - a.gamesCount || c.winRate - a.winRate);
    for (const childBuilder of b.childMap.values()) {
      finalizeNode(childBuilder);
    }
  }

  finalizeNode(rootBuilder);
  return root;
}

/**
 * Identifies problematic opening continuations, recurring mistakes, advantage-loss positions,
 * sound theoretical deviations (distinguished from errors!), and strong continuations.
 */
export function detectProblematicAndNotableContinuations(
  records: OpeningAnalysisCacheRecord[]
): ProblematicContinuationItem[] {
  interface MoveBucket {
    playerColor: PlayerColor;
    eco: string;
    openingName: string;
    variationName: string;
    ply: number;
    moveNumber: number;
    playedSan: string;
    recommendedSanCounts: Map<string, number>;
    fenBefore: string;
    fenAfter: string;
    positionKey: string;
    isOutOfBook: boolean;
    wins: number;
    draws: number;
    losses: number;
    cpls: number[];
    winProbLosses: number[];
    evalBeforePlayerCps: number[];
    evalAfterPlayerCps: number[];
    errorCount: number;
    advantageLostCount: number;
    examples: ProblematicGameExample[];
  }

  const buckets = new Map<string, MoveBucket>();

  for (const rec of records) {
    if (!rec.moveAnalyses || rec.moveAnalyses.length === 0) continue;

    const stepByPly = new Map(rec.openingMoves.map((s) => [s.ply, s]));

    for (const ma of rec.moveAnalyses) {
      // Focus on the opening & early middlegame transition (up to ply 24) and only moves played by the target player
      if (ma.ply > 24 || ma.player !== rec.playerColor) continue;

      const step = stepByPly.get(ma.ply);
      const posKey = step ? normalizeLegalEpFenKey(step.fenBefore) : ma.fenBefore;
      const bucketKey = `${rec.playerColor}__${posKey}__${ma.san}`;

      const sign = rec.playerColor === 'w' ? 1 : -1;
      const evalBeforePlayer = (ma.evalBeforeCp || 0) * sign;
      const evalAfterPlayer = (ma.evalAfterCp || 0) * sign;

      const isErrorCategory =
        ma.category === 'Inaccuracy' ||
        ma.category === 'Mistake' ||
        ma.category === 'MissedChance' ||
        ma.category === 'Blunder';

      const lostAdvantage =
        evalBeforePlayer >= 110 && evalAfterPlayer <= 15 && ma.cpl >= 90;

      const isOutOfBookMove =
        rec.firstOutOfBookPly !== null &&
        ma.ply >= rec.firstOutOfBookPly &&
        !ma.isTheoretical;

      let b = buckets.get(bucketKey);
      if (!b) {
        b = {
          playerColor: rec.playerColor,
          eco: rec.eco,
          openingName: rec.openingName,
          variationName: rec.variationName,
          ply: ma.ply,
          moveNumber: ma.moveNumber,
          playedSan: ma.san,
          recommendedSanCounts: new Map(),
          fenBefore: ma.fenBefore,
          fenAfter: ma.fenAfter,
          positionKey: posKey,
          isOutOfBook: isOutOfBookMove,
          wins: 0,
          draws: 0,
          losses: 0,
          cpls: [],
          winProbLosses: [],
          evalBeforePlayerCps: [],
          evalAfterPlayerCps: [],
          errorCount: 0,
          advantageLostCount: 0,
          examples: [],
        };
        buckets.set(bucketKey, b);
      }

      if (rec.outcome === 'win') b.wins++;
      else if (rec.outcome === 'draw') b.draws++;
      else b.losses++;

      if (ma.bestMoveSan) {
        b.recommendedSanCounts.set(
          ma.bestMoveSan,
          (b.recommendedSanCounts.get(ma.bestMoveSan) || 0) + 1
        );
      }

      b.cpls.push(ma.cpl);
      b.winProbLosses.push(ma.winProbLoss);
      b.evalBeforePlayerCps.push(evalBeforePlayer);
      b.evalAfterPlayerCps.push(evalAfterPlayer);

      if (isErrorCategory) b.errorCount++;
      if (lostAdvantage) b.advantageLostCount++;

      b.examples.push({
        gameId: rec.gameId,
        whiteName: rec.whiteName,
        blackName: rec.blackName,
        playerColor: rec.playerColor,
        opponentName: rec.opponentName,
        dateStr: rec.dateStr,
        result: rec.result,
        outcome: rec.outcome,
        ply: ma.ply,
        moveNumber: ma.moveNumber,
        playedSan: ma.san,
        bestMoveSan: ma.bestMoveSan || ma.san,
        cpl: ma.cpl,
        winProbLoss: ma.winProbLoss,
        evalBeforeCp: ma.evalBeforeCp,
        evalAfterCp: ma.evalAfterCp,
        category: ma.category,
      });
    }
  }

  const results: ProblematicContinuationItem[] = [];

  for (const [key, b] of buckets.entries()) {
    const occurrences = b.cpls.length;
    const avgCpl = Math.round(b.cpls.reduce((s, v) => s + v, 0) / occurrences);
    const avgWinProbLoss = round1(
      b.winProbLosses.reduce((s, v) => s + v, 0) / occurrences
    );
    const avgEvalAfterPlayerCp = Math.round(
      b.evalAfterPlayerCps.reduce((s, v) => s + v, 0) / occurrences
    );
    const winRate = round1((b.wins / occurrences) * 100);

    let bestRecSan = b.playedSan;
    let maxRecCount = 0;
    for (const [san, cnt] of b.recommendedSanCounts.entries()) {
      if (cnt > maxRecCount) {
        maxRecCount = cnt;
        bestRecSan = san;
      }
    }

    const moveLabel = `${b.moveNumber}${b.playerColor === 'w' ? '.' : '...'} ${b.playedSan}`;
    const lowSampleWarning = occurrences < 3;

    // 1. Recurring or serious opening mistake/blunder
    if (b.errorCount >= 1 && (avgCpl >= 75 || avgWinProbLoss >= 9)) {
      const issueType =
        b.advantageLostCount >= 1
          ? 'lost_advantage'
          : b.errorCount >= 2 || avgCpl >= 120
          ? 'recurring_mistake'
          : 'systematic_eval_drop';

      const summaryTitle =
        issueType === 'lost_advantage'
          ? `Потеря перевеса после ${moveLabel}`
          : occurrences >= 2
          ? `Регулярная потеря оценки на ходе ${moveLabel}`
          : `Дебютная ошибка на ходе ${moveLabel}`;

      const summaryDescription =
        occurrences >= 2
          ? `Встретилось в ${occurrences} партиях (ошибок: ${b.errorCount}). Средняя потеря: ${avgCpl} cp (${avgWinProbLoss}% Win%). Рекомендуемое продолжение Stockfish: ${bestRecSan}.`
          : `Единичный случай в выборке (потеря ${avgCpl} cp, ${avgWinProbLoss}% Win%). Требуется больше партий для подтверждения тенденции. Лучший ход: ${bestRecSan}.`;

      results.push({
        id: `prob_${key}`,
        issueType,
        playerColor: b.playerColor,
        eco: b.eco,
        openingName: b.openingName,
        variationName: b.variationName,
        ply: b.ply,
        moveNumber: b.moveNumber,
        playedSan: b.playedSan,
        recommendedSan: bestRecSan,
        fenBefore: b.fenBefore,
        fenAfter: b.fenAfter,
        positionKey: b.positionKey,
        occurrences,
        errorCount: b.errorCount,
        wins: b.wins,
        draws: b.draws,
        losses: b.losses,
        winRate,
        avgCpl,
        avgWinProbLoss,
        avgEvalAfterPlayerCp,
        isOutOfBook: b.isOutOfBook,
        isObjectiveError: true,
        lowSampleWarning,
        summaryTitle,
        summaryDescription,
        examples: b.examples.slice(0, 5),
      });
      continue;
    }

    // 2. Sound deviation from opening theory (NOT an objective error!)
    if (b.isOutOfBook && b.errorCount === 0 && avgCpl <= 40 && occurrences >= 1) {
      results.push({
        id: `sideline_${key}`,
        issueType: 'theoretical_sideline',
        playerColor: b.playerColor,
        eco: b.eco,
        openingName: b.openingName,
        variationName: b.variationName,
        ply: b.ply,
        moveNumber: b.moveNumber,
        playedSan: b.playedSan,
        recommendedSan: bestRecSan,
        fenBefore: b.fenBefore,
        fenAfter: b.fenAfter,
        positionKey: b.positionKey,
        occurrences,
        errorCount: 0,
        wins: b.wins,
        draws: b.draws,
        losses: b.losses,
        winRate,
        avgCpl,
        avgWinProbLoss,
        avgEvalAfterPlayerCp,
        isOutOfBook: true,
        isObjectiveError: false,
        lowSampleWarning,
        summaryTitle: `Корректное отклонение от теории: ${moveLabel}`,
        summaryDescription: `Ход выходит за рамки стандартной дебютной книги, но НЕ является ошибкой (средняя потеря всего ${avgCpl} cp, результативность ${winRate}% побед).`,
        examples: b.examples.slice(0, 5),
      });
      continue;
    }

    // 3. Strong continuation where player excels
    if (occurrences >= 2 && winRate >= 60 && avgCpl <= 25 && b.errorCount === 0) {
      results.push({
        id: `strong_${key}`,
        issueType: 'strong_continuation',
        playerColor: b.playerColor,
        eco: b.eco,
        openingName: b.openingName,
        variationName: b.variationName,
        ply: b.ply,
        moveNumber: b.moveNumber,
        playedSan: b.playedSan,
        recommendedSan: bestRecSan,
        fenBefore: b.fenBefore,
        fenAfter: b.fenAfter,
        positionKey: b.positionKey,
        occurrences,
        errorCount: 0,
        wins: b.wins,
        draws: b.draws,
        losses: b.losses,
        winRate,
        avgCpl,
        avgWinProbLoss,
        avgEvalAfterPlayerCp,
        isOutOfBook: b.isOutOfBook,
        isObjectiveError: false,
        lowSampleWarning,
        summaryTitle: `Успешное продолжение репертуара: ${moveLabel}`,
        summaryDescription: `Стабильная точная игра в ${occurrences} партиях (${winRate}% побед, средний CPL ${avgCpl}).`,
        examples: b.examples.slice(0, 5),
      });
    }
  }

  return results.sort((a, b) => {
    if (a.isObjectiveError !== b.isObjectiveError) {
      return a.isObjectiveError ? -1 : 1;
    }
    return b.occurrences * b.avgCpl - a.occurrences * a.avgCpl;
  });
}
