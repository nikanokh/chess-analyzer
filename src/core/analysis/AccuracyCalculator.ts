import { GameStatistics, MoveAnalysis, MoveCategory, PlayerColor } from '../../types/chess';

/**
 * Logistic scaling constant from the open-source Lichess win-probability model
 * calibrated on human/engine game outcomes:
 * P(Win) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 */
export const WIN_PROB_LOGISTIC_COEFFICIENT = -0.00368208;
export const MAX_CLAMPED_CP = 4000;

/**
 * Converts a White-perspective evaluation (`cp` or `mate`) into White's Expected Win Probability (0..100%).
 *
 * Mathematical properties:
 * - Returns White's probability of winning (0..100), NEVER the side-to-move's probability.
 * - `cp = 0` -> `50%`.
 * - `cp > 0` -> `(50, 100]` (monotonically increasing for White).
 * - `cp < 0` -> `[0, 50)` (monotonically decreasing for White).
 * - Mate evaluations (`mate !== undefined && mate !== null`) are handled separately from centipawns:
 *   - `mate > 0` (White mates in N): `[97.6, 100]`, with `M1 = 100%`.
 *   - `mate < 0` (Black mates in |N|): `[0, 2.4]`, with `-M1 = 0%`.
 *   - `mate === 0`: `50%` (draw/stalemate).
 * - Guards against `NaN` and `±Infinity` so invalid values never propagate.
 */
export function cpToWhiteWinProbability(cp?: number | null, mate?: number | null): number {
  if (mate !== undefined && mate !== null && !Number.isNaN(mate)) {
    if (mate === 0) return 50;
    const dist = Math.max(1, Math.abs(Math.trunc(mate)));
    // Small distance-based gradation (0.25% per move up to 2.4%) so M1 = 100% and M10 = 97.75%,
    // staying strictly above +1000 cp (~97.5%) to avoid discontinuities at the mate boundary.
    const mateDiscount = Math.min(2.4, (dist - 1) * 0.25);
    return mate > 0 ? 100 - mateDiscount : mateDiscount;
  }

  if (cp === undefined || cp === null || Number.isNaN(cp)) {
    return 50;
  }

  if (!Number.isFinite(cp)) {
    return cp > 0 ? 100 : 0;
  }

  if (cp === 0) {
    return 50;
  }

  const clampedCp = Math.max(-MAX_CLAMPED_CP, Math.min(MAX_CLAMPED_CP, cp));
  const winProb =
    50 + 50 * (2 / (1 + Math.exp(WIN_PROB_LOGISTIC_COEFFICIENT * clampedCp)) - 1);
  return Math.max(0, Math.min(100, winProb));
}

/**
 * Converts a White-perspective win probability (0..100) into the moving player's win probability (0..100).
 */
export function toPlayerWinProbability(whiteWinProb: number, player: PlayerColor): number {
  const safeWhite = Number.isFinite(whiteWinProb)
    ? Math.max(0, Math.min(100, whiteWinProb))
    : 50;
  return player === 'w' ? safeWhite : 100 - safeWhite;
}

/**
 * Dedicated mate-aware calculation of Expected Win Probability Loss (0..100) for a single move.
 *
 * Why a dedicated strategy is needed for mate positions:
 * In pure centipawn positions, `winProbLoss = max(0, playerWinProbBefore - playerWinProbAfter)`.
 * However, when forced mates are involved (`mateBefore` or `mateAfter`), raw asymptotic win probabilities
 * are compressed near 0% or 100%. For example:
 * - Shortening a forced mate against oneself from `-M6` to `-M1` changes raw win probability by only ~1.25%,
 *   yet chess-wise it is a severe defensive blunder.
 * - Missing a forced mate (`+M3` -> `+300 cp`) or delaying `+M2` to `+M6` when `+M2` was available
 *   must be penalized proportionally to the mate distance lost relative to the optimal continuation.
 *
 * This heuristic is explicitly documented and separated from standard centipawn logistic differences.
 */
export function computeMoveWinProbLoss(params: {
  player: PlayerColor;
  evalBeforeCp?: number;
  evalAfterCp?: number;
  mateBefore?: number;
  mateAfter?: number;
  isBestMove?: boolean;
  bestAlternativeMateAfter?: number; // White-POV mate after the best move, if known
}): {
  winProbBefore: number;
  winProbAfter: number;
  winProbLoss: number;
} {
  const {
    player,
    evalBeforeCp,
    evalAfterCp,
    mateBefore,
    mateAfter,
    isBestMove = false,
    bestAlternativeMateAfter,
  } = params;

  const winProbBefore = cpToWhiteWinProbability(evalBeforeCp, mateBefore);
  const winProbAfter = cpToWhiteWinProbability(evalAfterCp, mateAfter);

  const playerWinProbBefore = toPlayerWinProbability(winProbBefore, player);
  const playerWinProbAfter = toPlayerWinProbability(winProbAfter, player);
  const rawWinProbLoss = Math.max(0, playerWinProbBefore - playerWinProbAfter);

  if (isBestMove) {
    return {
      winProbBefore,
      winProbAfter,
      winProbLoss: 0,
    };
  }

  const sign = player === 'w' ? 1 : -1;
  const playerEvalBefore =
    evalBeforeCp !== undefined && Number.isFinite(evalBeforeCp) ? evalBeforeCp * sign : 0;
  const playerEvalAfter =
    evalAfterCp !== undefined && Number.isFinite(evalAfterCp) ? evalAfterCp * sign : 0;

  const playerMateBefore =
    mateBefore !== undefined && mateBefore !== null && mateBefore !== 0
      ? mateBefore * sign
      : undefined;
  const playerMateAfter =
    mateAfter !== undefined && mateAfter !== null && mateAfter !== 0
      ? mateAfter * sign
      : undefined;
  const playerBestAltMate =
    bestAlternativeMateAfter !== undefined &&
    bestAlternativeMateAfter !== null &&
    bestAlternativeMateAfter !== 0
      ? bestAlternativeMateAfter * sign
      : undefined;

  // If neither before nor after is a mate position, return the exact logistic winProbLoss
  if (playerMateBefore === undefined && playerMateAfter === undefined) {
    return {
      winProbBefore,
      winProbAfter,
      winProbLoss: Number(rawWinProbLoss.toFixed(2)),
    };
  }

  let effectiveLoss = rawWinProbLoss;

  // Case 1: Opponent did NOT have a forced mate before, and now Opponent HAS a forced mate against player
  if (
    (playerMateBefore === undefined || playerMateBefore > 0) &&
    playerMateAfter !== undefined &&
    playerMateAfter < 0
  ) {
    const distAfter = Math.abs(playerMateAfter);
    if (playerMateBefore !== undefined && playerMateBefore > 0) {
      // Turned one's own forced mate into getting mated!
      effectiveLoss = Math.max(effectiveLoss, 85);
    } else if (playerEvalBefore <= -600 && distAfter >= 5) {
      // Position was already completely lost (-6.0+), but allowed a forced mate
      effectiveLoss = Math.max(effectiveLoss, 24);
    } else {
      effectiveLoss = Math.max(effectiveLoss, distAfter === 1 ? 65 : 48);
    }
  }
  // Case 2: Opponent ALREADY had a forced mate against player (playerMateBefore < 0)
  else if (playerMateBefore !== undefined && playerMateBefore < 0) {
    if (playerMateAfter !== undefined && playerMateAfter < 0) {
      const distBefore = Math.abs(playerMateBefore);
      const distAfter = Math.abs(playerMateAfter);
      // Optimal defense after defender's ply keeps attacker's mate distance at `optimalDist`
      const optimalDist =
        playerBestAltMate !== undefined && playerBestAltMate < 0
          ? Math.abs(playerBestAltMate)
          : distBefore;

      const stepsShortened = Math.max(0, optimalDist - distAfter);
      if (stepsShortened === 0) {
        effectiveLoss = 0;
      } else if ((distAfter === 1 && optimalDist >= 2) || stepsShortened >= 3) {
        effectiveLoss = Math.max(effectiveLoss, 38 + Math.min(25, stepsShortened * 4));
      } else if (stepsShortened === 2) {
        effectiveLoss = Math.max(effectiveLoss, 24);
      } else {
        effectiveLoss = Math.max(effectiveLoss, 13);
      }
    } else {
      // Opponent lost their forced mate (which shouldn't happen on player's own move unless horizon effect)
      effectiveLoss = 0;
    }
  }
  // Case 3: Player HAD a forced mate (playerMateBefore > 0)
  else if (playerMateBefore !== undefined && playerMateBefore > 0) {
    const distBefore = playerMateBefore;
    // After the attacker makes the mating move, the remaining mate distance in full moves
    // should decrease by 1 (or match `playerBestAltMate` if provided).
    const optimalDistAfter =
      playerBestAltMate !== undefined && playerBestAltMate > 0
        ? playerBestAltMate
        : Math.max(1, distBefore - 1);

    if (playerMateAfter !== undefined && playerMateAfter > 0) {
      const distAfter = playerMateAfter;
      const delaySteps = distAfter - optimalDistAfter;
      if (delaySteps <= 0) {
        effectiveLoss = 0;
      } else if (delaySteps === 1) {
        effectiveLoss = Math.max(effectiveLoss, 9);
      } else if (delaySteps === 2) {
        effectiveLoss = Math.max(effectiveLoss, 15);
      } else {
        effectiveLoss = Math.max(effectiveLoss, 20 + Math.min(20, (delaySteps - 2) * 4));
      }
    } else {
      // Player had a forced mate and let it slip to a non-mate evaluation
      if (playerEvalAfter < 120) {
        effectiveLoss = Math.max(effectiveLoss, 52);
      } else if (playerEvalAfter < 500 || distBefore <= 6) {
        effectiveLoss = Math.max(effectiveLoss, 24);
      } else {
        effectiveLoss = Math.max(effectiveLoss, 14);
      }
    }
  }

  return {
    winProbBefore,
    winProbAfter,
    winProbLoss: Number(Math.max(0, Math.min(100, effectiveLoss)).toFixed(2)),
  };
}

export const LICHESS_ACCURACY_MULTIPLIER = 103.1668100711649;
export const LICHESS_ACCURACY_DECAY = -0.04354415386753951;
export const LICHESS_ACCURACY_INTERCEPT = -3.166924740191411;
export const LICHESS_UNCERTAINTY_BONUS = 1;

/**
 * Calculates raw single-move accuracy (0..100%) in full floating-point precision
 * from the loss in Expected Win Probability (0..100) for the player who made the move.
 *
 * Official Lichess formula (`AccuracyPercent.scala`):
 * raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) + -3.166924740191411 + 1
 */
export function calculateRawSingleMoveAccuracy(winProbLoss: number): number {
  if (typeof winProbLoss !== 'number' || Number.isNaN(winProbLoss)) {
    return 0;
  }
  if (winProbLoss <= 0) {
    return 100;
  }
  if (!Number.isFinite(winProbLoss)) {
    return 0;
  }
  const raw =
    LICHESS_ACCURACY_MULTIPLIER * Math.exp(LICHESS_ACCURACY_DECAY * winProbLoss) +
    LICHESS_ACCURACY_INTERCEPT +
    LICHESS_UNCERTAINTY_BONUS;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Calculates single-move accuracy (0..100%) rounded to 1 decimal place for display.
 */
export function calculateSingleMoveAccuracy(winProbLoss: number): number {
  return Number(calculateRawSingleMoveAccuracy(winProbLoss).toFixed(1));
}

export function createEmptyCategoryCounts(): Record<MoveCategory, number> {
  return {
    Brilliant: 0,
    Great: 0,
    Best: 0,
    Excellent: 0,
    Good: 0,
    Book: 0,
    Forced: 0,
    Inaccuracy: 0,
    Mistake: 0,
    MissedChance: 0,
    Blunder: 0,
  };
}

function computeStandardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => {
      const diff = v - mean;
      return s + diff * diff;
    }, 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function computeWeightedMean(pairs: Array<{ value: number; weight: number }>): number {
  if (pairs.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const p of pairs) {
    const w = Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0.5;
    weightedSum += p.value * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function computeHarmonicMean(values: number[]): number {
  if (values.length === 0) return 0;
  let reciprocalSum = 0;
  for (const v of values) {
    // Clamp minimum denominator to 1e-3 so a single 0% blunder strongly penalizes
    // without collapsing the entire game accuracy to 0.0% via division by zero
    const safeVal = Math.max(1, v);
    reciprocalSum += 1 / safeVal;
  }
  return reciprocalSum > 0 ? values.length / reciprocalSum : 0;
}

/**
 * Computes Lichess game accuracy (`AccuracyPercent.scala`) using:
 * 1. Sliding windows of White Win% values (`windowSize = clamp(floor(totalPlies / 10), 2, 8)`),
 * 2. Volatility weights from the standard deviation of Win% inside each window, clamped to `[0.5, 12]`,
 * 3. Volatility-weighted mean of the player's move accuracies,
 * 4. Harmonic mean of the player's move accuracies,
 * 5. Final average `(weightedMean + harmonicMean) / 2`.
 */
export function computeLichessPlayerAccuracy(
  entries: Array<{ accuracy: number; weight: number }>
): number {
  if (entries.length === 0) return 0;
  if (entries.length === 1) {
    return Number(Math.max(0, Math.min(100, entries[0].accuracy)).toFixed(1));
  }
  const weightedMean = computeWeightedMean(
    entries.map((e) => ({ value: e.accuracy, weight: e.weight }))
  );
  const harmonicMean = computeHarmonicMean(entries.map((e) => e.accuracy));
  const combined = (weightedMean + harmonicMean) / 2;
  return Number(Math.max(0, Math.min(100, combined)).toFixed(1));
}

/**
 * Computes full GameStatistics (White & Black accuracy, average CPL, and move category counts)
 * from a list of analyzed moves using the Lichess sliding-window volatility + harmonic mean algorithm.
 */
export function calculateGameStatistics(analyses: MoveAnalysis[]): GameStatistics {
  const whiteCounts = createEmptyCategoryCounts();
  const blackCounts = createEmptyCategoryCounts();

  const validAnalyses = analyses.filter(
    (item) => item && (item.player === 'w' || item.player === 'b')
  );

  // Build White-POV Win% timeline across all plies for Lichess sliding-window volatility weights
  const allWhiteWinPercents: number[] = [];
  if (validAnalyses.length > 0) {
    const firstBefore = Number.isFinite(validAnalyses[0].winProbBefore)
      ? validAnalyses[0].winProbBefore
      : 50;
    allWhiteWinPercents.push(firstBefore);
    for (const item of validAnalyses) {
      const after = Number.isFinite(item.winProbAfter) ? item.winProbAfter : 50;
      allWhiteWinPercents.push(after);
    }
  }

  const totalPlies = validAnalyses.length;
  const windowSize = Math.max(2, Math.min(8, Math.floor(totalPlies / 10)));

  const slidingWindows: number[][] = [];
  if (allWhiteWinPercents.length >= windowSize) {
    for (let i = 0; i <= allWhiteWinPercents.length - windowSize; i++) {
      slidingWindows.push(allWhiteWinPercents.slice(i, i + windowSize));
    }
  } else if (allWhiteWinPercents.length > 0) {
    slidingWindows.push([...allWhiteWinPercents]);
  }

  const paddedWindows: number[][] = [];
  if (slidingWindows.length > 0) {
    const padCount = Math.max(0, windowSize - 2);
    for (let i = 0; i < padCount; i++) {
      paddedWindows.push(slidingWindows[0]);
    }
    paddedWindows.push(...slidingWindows);
  }

  const plyVolatilityWeights: number[] = validAnalyses.map((_, idx) => {
    const winSlice = paddedWindows[Math.min(idx, Math.max(0, paddedWindows.length - 1))] || [50, 50];
    const sd = computeStandardDeviation(winSlice);
    return Math.max(0.5, Math.min(12, sd));
  });

  const whitePrimaryEntries: Array<{ accuracy: number; weight: number }> = [];
  const blackPrimaryEntries: Array<{ accuracy: number; weight: number }> = [];
  const whiteFallbackEntries: Array<{ accuracy: number; weight: number }> = [];
  const blackFallbackEntries: Array<{ accuracy: number; weight: number }> = [];

  const whiteCpls: number[] = [];
  const blackCpls: number[] = [];

  for (let i = 0; i < validAnalyses.length; i++) {
    const item = validAnalyses[i];
    const weight = plyVolatilityWeights[i] ?? 0.5;

    const counts = item.player === 'w' ? whiteCounts : blackCounts;
    if (item.category in counts) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }

    const isBookOrForced = item.category === 'Book' || item.category === 'Forced';
    const hasValidAccuracy =
      typeof item.moveAccuracy === 'number' &&
      Number.isFinite(item.moveAccuracy) &&
      item.moveAccuracy >= 0 &&
      item.moveAccuracy <= 100;

    if (hasValidAccuracy) {
      const entry = { accuracy: item.moveAccuracy, weight };
      if (item.player === 'w') {
        whiteFallbackEntries.push(entry);
        if (!isBookOrForced) {
          whitePrimaryEntries.push(entry);
        }
      } else {
        blackFallbackEntries.push(entry);
        if (!isBookOrForced) {
          blackPrimaryEntries.push(entry);
        }
      }
    }

    const isMateMove = item.mateBefore !== undefined || item.mateAfter !== undefined;
    const hasValidCpl =
      typeof item.cpl === 'number' &&
      Number.isFinite(item.cpl) &&
      item.cpl >= 0 &&
      !isBookOrForced &&
      !isMateMove;

    if (hasValidCpl) {
      if (item.player === 'w') {
        whiteCpls.push(Math.min(item.cpl, 1000));
      } else {
        blackCpls.push(Math.min(item.cpl, 1000));
      }
    }
  }

  const computePlayerAcc = (
    primary: Array<{ accuracy: number; weight: number }>,
    fallback: Array<{ accuracy: number; weight: number }>
  ): number => {
    const list = primary.length > 0 ? primary : fallback;
    return computeLichessPlayerAccuracy(list);
  };

  const computeAvgCpl = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  };

  return {
    whiteAccuracy: computePlayerAcc(whitePrimaryEntries, whiteFallbackEntries),
    blackAccuracy: computePlayerAcc(blackPrimaryEntries, blackFallbackEntries),
    whiteAvgCpl: computeAvgCpl(whiteCpls),
    blackAvgCpl: computeAvgCpl(blackCpls),
    whiteCounts,
    blackCounts,
  };
}
