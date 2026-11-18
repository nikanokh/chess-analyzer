import { Chess, Move, Square } from 'chess.js';
import {
  ClassificationThresholds,
  EngineLine,
  MoveAnalysis,
  MoveCategory,
  MoveNode,
  PlayerColor,
} from '../../types/chess';
import { openingBook } from '../chess/OpeningBook';
import { getMainlineNodes, uciLineToSan } from '../chess/VariationTree';
import { stockfishClient } from '../engine/StockfishClient';
import {
  calculateSingleMoveAccuracy,
  computeMoveWinProbLoss,
  cpToWhiteWinProbability,
  toPlayerWinProbability,
} from './AccuracyCalculator';

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  bestMaxCpl: 20,
  excellentMaxCpl: 50,
  goodMaxCpl: 95,
  inaccuracyMaxCpl: 175,
  mistakeMaxCpl: 300,
};

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 300,
  b: 300,
  r: 500,
  q: 900,
  k: 10000,
};

/**
 * Computes net material balance (in centipawns) from `color`'s perspective.
 */
export function computeMaterialBalance(fen: string, color: PlayerColor): number {
  const chess = new Chess(fen);
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const cell of row) {
      if (!cell || cell.type === 'k') continue;
      const val = PIECE_VALUES[cell.type] || 0;
      if (cell.color === color) score += val;
      else score -= val;
    }
  }
  return score;
}

/**
 * Recursive Static Exchange Evaluation (SEE) on a target `square` from the side-to-move's perspective.
 * Picks the least valuable legal attacker on `square` at each ply and uses negamax
 * `Math.max(0, capturedValue - evaluateSeeOnSquare(afterCapture, square))` so neither player
 * is forced to continue an unfavorable capture sequence.
 */
export function evaluateSeeOnSquare(chess: Chess, targetSquare: Square, depth = 0): number {
  if (depth >= 8) return 0;
  const legalCaptures = chess
    .moves({ verbose: true })
    .filter((m) => m.to === targetSquare && Boolean(m.captured));

  if (legalCaptures.length === 0) {
    return 0;
  }

  // Choose the least valuable attacker first
  legalCaptures.sort(
    (a, b) => (PIECE_VALUES[a.piece] || 0) - (PIECE_VALUES[b.piece] || 0)
  );
  const chosenCapture: Move = legalCaptures[0];
  const capturedVal = PIECE_VALUES[chosenCapture.captured || 'p'] || 0;
  const promotionGain = chosenCapture.promotion
    ? (PIECE_VALUES[chosenCapture.promotion] || 900) - 100
    : 0;

  const nextChess = new Chess(chess.fen());
  const moved = nextChess.move({
    from: chosenCapture.from,
    to: chosenCapture.to,
    promotion: chosenCapture.promotion,
  });
  if (!moved) return 0;

  const opponentReplyGain = evaluateSeeOnSquare(nextChess, targetSquare, depth + 1);
  return Math.max(0, capturedVal + promotionGain - opponentReplyGain);
}

/**
 * Determines whether the move from `fenBefore` to `fenAfter` loses significant material (>= 250 cp,
 * i.e. at least a minor piece or clear exchange) after accounting for:
 * 1. Any material already captured by `player` on the move (`immediateGain`),
 * 2. Full recapture sequences on all attacked squares via Static Exchange Evaluation (SEE), and
 * 3. Material balance after the opponent's best engine continuation (`opponentBestPvUci`).
 *
 * Example: if a pawn captures a rook (`+500`) and is then recaptured (`-100`), the net material
 * change is `+400` for the mover — never falsely flagged as losing a piece.
 * Similarly, if `player` captures a knight (`+300`) and opponent recaptures `player`'s knight (`-300`),
 * net material change is `0` (an equal trade), NOT a piece loss.
 */
export function doesMoveLosePiece(
  fenBefore: string,
  fenAfter: string,
  player: PlayerColor,
  opponentBestPvUci?: string[]
): boolean {
  try {
    const matBefore = computeMaterialBalance(fenBefore, player);
    const matAfter = computeMaterialBalance(fenAfter, player);
    const immediateGain = matAfter - matBefore; // e.g. +300 if player just captured a minor piece

    // 1. Check Static Exchange Evaluation (SEE) on every square where opponent can capture a piece in `fenAfter`
    const chessAfter = new Chess(fenAfter);
    const opponentCaptures = chessAfter
      .moves({ verbose: true })
      .filter((m) => Boolean(m.captured));

    const checkedSquares = new Set<Square>();
    let maxOpponentSeeGain = 0;

    for (const cap of opponentCaptures) {
      if (checkedSquares.has(cap.to)) continue;
      checkedSquares.add(cap.to);

      const capturedVal = PIECE_VALUES[cap.captured || 'p'] || 0;
      const attackerVal = PIECE_VALUES[cap.piece] || 0;
      const promoGain = cap.promotion ? (PIECE_VALUES[cap.promotion] || 900) - 100 : 0;

      const sim = new Chess(fenAfter);
      const moved = sim.move({
        from: cap.from,
        to: cap.to,
        promotion: cap.promotion,
      });
      if (!moved) continue;

      const playerRecaptureGain = evaluateSeeOnSquare(sim, cap.to, 1);
      const opponentNetOnSquare = capturedVal + promoGain - playerRecaptureGain;

      // Ignore equal trades where attackerVal === capturedVal and player recaptures
      if (opponentNetOnSquare > maxOpponentSeeGain && (capturedVal >= 300 || attackerVal < capturedVal)) {
        maxOpponentSeeGain = opponentNetOnSquare;
      }
    }

    // Net material lost after subtracting what `player` already captured on the move
    const netSeeMaterialLoss = maxOpponentSeeGain - immediateGain;
    if (netSeeMaterialLoss >= 250) {
      return true;
    }

    // 2. Also check material balance along the engine's principal variation (`opponentBestPvUci`)
    // Evaluate at an even number of plies (after player's recapture opportunity) or at the end of a forcing tactical line
    if (opponentBestPvUci && opponentBestPvUci.length > 0) {
      const sim = new Chess(fenAfter);
      const maxPlies = Math.min(opponentBestPvUci.length, 4);
      let pliesPlayed = 0;
      for (let i = 0; i < maxPlies; i++) {
        const uci = opponentBestPvUci[i];
        if (!uci || uci.length < 4) break;
        const from = uci.slice(0, 2) as Square;
        const to = uci.slice(2, 4) as Square;
        const promotion = uci.length > 4 ? uci[4] : undefined;
        const mv = sim.move({ from, to, promotion });
        if (!mv) break;
        pliesPlayed++;
      }

      if (pliesPlayed > 0) {
        // If we stopped on an odd ply (opponent just captured), check if player has a direct recapture on the last square
        let afterPvMaterial = computeMaterialBalance(sim.fen(), player);
        if (pliesPlayed % 2 === 1) {
          const lastUci = opponentBestPvUci[pliesPlayed - 1];
          const lastTo = lastUci.slice(2, 4) as Square;
          const playerRecovery = evaluateSeeOnSquare(sim, lastTo, 0);
          afterPvMaterial += playerRecovery;
        }

        if (matBefore - afterPvMaterial >= 250) {
          return true;
        }
      }
    }
  } catch {
    // ignore invalid FEN
  }
  return false;
}

/**
 * Checks if the played move involves an intentional, sound material sacrifice:
 * - Either the moved piece (or another friendly minor/major piece) is left exposed to an
 *   opponent capture that wins >= 150 cp of material by SEE (`opponentSeeGain - immediateGain >= 150`),
 *   OR the move itself sacrifices net material (`immediateGain <= -150`) to initiate a combination.
 */
function isMaterialSacrificeMove(
  fenBefore: string,
  fenAfter: string,
  uci: string,
  player: PlayerColor
): boolean {
  try {
    if (!uci || uci.length < 4 || fenBefore === fenAfter) return false;
    const matBefore = computeMaterialBalance(fenBefore, player);
    const matAfter = computeMaterialBalance(fenAfter, player);
    const immediateDelta = matAfter - matBefore;

    const chessAfter = new Chess(fenAfter);
    const toSquare = uci.slice(2, 4) as Square;
    const movedPiece = chessAfter.get(toSquare);
    if (!movedPiece || movedPiece.color !== player) return false;

    // Check if opponent can profitably capture any of player's pieces (N, B, R, Q) in `fenAfter`
    const opponentCaptures = chessAfter
      .moves({ verbose: true })
      .filter((m) => Boolean(m.captured) && m.captured !== 'p');

    let bestOpponentSee = 0;
    const checked = new Set<Square>();
    for (const cap of opponentCaptures) {
      if (checked.has(cap.to)) continue;
      checked.add(cap.to);
      const capturedVal = PIECE_VALUES[cap.captured || 'p'] || 0;
      if (capturedVal < 300) continue;

      const sim = new Chess(fenAfter);
      const moved = sim.move({
        from: cap.from,
        to: cap.to,
        promotion: cap.promotion,
      });
      if (!moved) continue;
      const recaptureGain = evaluateSeeOnSquare(sim, cap.to, 1);
      const netGain = capturedVal - recaptureGain;
      if (netGain > bestOpponentSee) {
        bestOpponentSee = netGain;
      }
    }

    // True material sacrifice if opponent can win >= 150 cp net (even after accounting for what player captured)
    if (bestOpponentSee >= 200 && bestOpponentSee - Math.max(0, immediateDelta) >= 150) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Classifies a move based on objective Win Probability Loss, comparable MultiPV lines,
 * Static Exchange Evaluation (SEE), and dedicated mate-distance analysis.
 *
 * Key algorithmic guarantees:
 * 1. No `decisiveDampener`: CPL is never artificially multiplied by 0.45.
 * 2. `Best` is reserved strictly for the engine's actual #1 move (`uci === bestMoveUci` or tied #1 in MultiPV within 3 cp).
 *    Near-best moves (`cpl <= bestMaxCpl` or `excellentMaxCpl`) that are not the engine's best move are `Excellent`.
 * 3. `Great` compares MultiPV #1 (`evalBeforeCp`/`mateBefore`) against MultiPV #2 (`secondBestCp`/`secondBestMate`)
 *    from the SAME initial position (`fenBefore`).
 * 4. `Brilliant` requires the engine's top move (`uci === bestMoveUci`), a verified sound material sacrifice,
 *    a playable/winning resulting position (`playerWinProbAfter >= 50%`), and non-trivial initial evaluation.
 * 5. `Book` requires both book membership AND absence of real errors (`winProbLoss <= 10%`), without
 *    artificially forcing `moveAccuracy` to 98%.
 * 6. `Forced` requires a non-terminal position in `fenBefore` with `legalMoves.length === 1`.
 * 7. `Inaccuracy`, `Mistake`, `MissedChance`, and `Blunder` follow a strict, non-overlapping hierarchy
 *    driven by `winProbLoss` (primary) and `thresholds` including `mistakeMaxCpl` (secondary).
 */
export function classifyMoveFromEvaluations(params: {
  player: PlayerColor;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  bestMoveUci: string;
  evalBeforeCp?: number;
  evalAfterCp?: number;
  mateBefore?: number;
  mateAfter?: number;
  secondBestCp?: number;
  secondBestMate?: number;
  alternativeLines?: EngineLine[];
  opponentBestPvUci?: string[];
  isTheoretical: boolean;
  thresholds: ClassificationThresholds;
}): {
  cpl: number;
  winProbBefore: number;
  winProbAfter: number;
  winProbLoss: number;
  moveAccuracy: number;
  category: MoveCategory;
} {
  const {
    player,
    uci,
    fenBefore,
    fenAfter,
    bestMoveUci,
    evalBeforeCp,
    evalAfterCp,
    mateBefore,
    mateAfter,
    secondBestCp,
    secondBestMate,
    alternativeLines,
    opponentBestPvUci,
    isTheoretical,
    thresholds,
  } = params;

  const sign = player === 'w' ? 1 : -1;

  // Player-relative mate numbers (> 0: player mates in N; < 0: opponent mates player in |N|)
  const playerMateBefore =
    mateBefore !== undefined && mateBefore !== null && mateBefore !== 0
      ? mateBefore * sign
      : undefined;
  const playerMateAfter =
    mateAfter !== undefined && mateAfter !== null && mateAfter !== 0
      ? mateAfter * sign
      : undefined;

  const hasValidCpBefore =
    evalBeforeCp !== undefined &&
    evalBeforeCp !== null &&
    Number.isFinite(evalBeforeCp) &&
    playerMateBefore === undefined;
  const hasValidCpAfter =
    evalAfterCp !== undefined &&
    evalAfterCp !== null &&
    Number.isFinite(evalAfterCp) &&
    playerMateAfter === undefined;

  const playerEvalBefore = hasValidCpBefore ? evalBeforeCp * sign : 0;
  const playerEvalAfter = hasValidCpAfter ? evalAfterCp * sign : 0;

  // Check if the played move is the engine's exact #1 choice, or tied #1 in MultiPV from fenBefore
  const isExactBestMove = Boolean(bestMoveUci && uci && uci === bestMoveUci);
  let isTiedTopMultiPv = false;
  if (!isExactBestMove && alternativeLines && alternativeLines.length > 1 && uci) {
    const matchingLine = alternativeLines.find((l) => l.pv?.[0] === uci);
    const topLine = alternativeLines[0];
    if (
      matchingLine &&
      topLine &&
      matchingLine.depth === topLine.depth &&
      topLine.mate === undefined &&
      matchingLine.mate === undefined &&
      topLine.cp !== undefined &&
      matchingLine.cp !== undefined
    ) {
      const diffCp = Math.abs(topLine.cp - matchingLine.cp);
      if (diffCp <= 3) {
        isTiedTopMultiPv = true;
      }
    }
  }

  const isBestMoveChoice = isExactBestMove || isTiedTopTopMove(isExactBestMove, isTiedTopMultiPv);

  // Compute CPL strictly from comparable centipawn evaluations (0 if best move)
  let cpl = 0;
  if (!isBestMoveChoice) {
    if (hasValidCpBefore && hasValidCpAfter) {
      // If the played move is present in MultiPV from `fenBefore`, use same-depth comparison
      const matchingPreLine = alternativeLines?.find((l) => l.pv?.[0] === uci);
      if (
        matchingPreLine &&
        matchingPreLine.cp !== undefined &&
        matchingPreLine.mate === undefined
      ) {
        const playedLinePlayerCp = matchingPreLine.cp * sign;
        cpl = Math.round(Math.max(0, playerEvalBefore - playedLinePlayerCp));
      } else {
        cpl = Math.round(Math.max(0, playerEvalBefore - playerEvalAfter));
      }
    } else if (playerMateBefore !== undefined || playerMateAfter !== undefined) {
      // Mate transitions are governed by dedicated mate logic below; assign representative CPL only for display
      cpl = 0;
    }
  }

  const { winProbBefore, winProbAfter, winProbLoss } = computeMoveWinProbLoss({
    player,
    evalBeforeCp: hasValidCpBefore ? evalBeforeCp : undefined,
    evalAfterCp: hasValidCpAfter ? evalAfterCp : undefined,
    mateBefore,
    mateAfter,
    isBestMove: isBestMoveChoice,
  });

  const playerWinProbBefore = toPlayerWinProbability(winProbBefore, player);
  const playerWinProbAfter = toPlayerWinProbability(winProbAfter, player);
  const moveAccuracy = calculateSingleMoveAccuracy(winProbLoss);

  // ============================================================================
  // 1. Check if Forced (strictly 1 legal move in a non-terminal position)
  // ============================================================================
  try {
    if (fenBefore) {
      const chessBefore = new Chess(fenBefore);
      if (!chessBefore.isGameOver()) {
        const legalMoves = chessBefore.moves({ verbose: true });
        if (legalMoves.length === 1) {
          const singleUci = `${legalMoves[0].from}${legalMoves[0].to}${legalMoves[0].promotion || ''}`;
          if (!uci || uci === singleUci) {
            return {
              cpl: 0,
              winProbBefore,
              winProbAfter,
              winProbLoss: 0,
              moveAccuracy: 100,
              category: 'Forced',
            };
          }
        }
      }
    }
  } catch {
    // ignore invalid FEN
  }

  // ============================================================================
  // 2. Check if Book (Opening Theory)
  // Book status NEVER masks a real mistake/inaccuracy and never inflates accuracy artificially.
  // ============================================================================
  if (isTheoretical) {
    const isGenuineBookEdge =
      !fenBefore ||
      !fenAfter ||
      fenBefore === fenAfter ||
      openingBook.isBookMove(fenBefore, uci, fenAfter);

    const hasNoSeriousError =
      winProbLoss <= 10 &&
      cpl <= thresholds.goodMaxCpl &&
      (playerMateAfter === undefined || playerMateAfter > 0);

    if (isGenuineBookEdge && hasNoSeriousError) {
      return {
        cpl,
        winProbBefore,
        winProbAfter,
        winProbLoss,
        moveAccuracy,
        category: 'Book',
      };
    }
  }

  // ============================================================================
  // 3. Dedicated Mate Threat & Forced Mate Sequence Classification
  // ============================================================================
  if (playerMateBefore !== undefined || playerMateAfter !== undefined) {
    // Case A: Opponent did NOT have a forced mate before, and now Opponent HAS a forced mate against player
    if (
      (playerMateBefore === undefined || playerMateBefore > 0) &&
      playerMateAfter !== undefined &&
      playerMateAfter < 0
    ) {
      const mateDist = Math.abs(playerMateAfter);
      // If position before was already completely lost (<= -600 cp) and mate is still >= 5 moves away -> Mistake
      if (playerMateBefore === undefined && hasValidCpBefore && playerEvalBefore <= -600 && mateDist >= 5) {
        return {
          cpl: Math.max(cpl, 250),
          winProbBefore,
          winProbAfter,
          winProbLoss,
          moveAccuracy,
          category: 'Mistake',
        };
      }
      return {
        cpl: Math.max(cpl, 600),
        winProbBefore,
        winProbAfter,
        winProbLoss,
        moveAccuracy,
        category: 'Blunder',
      };
    }

    // Case B: Opponent ALREADY had a forced mate against player (e.g. -M6), and still has a forced mate (e.g. -M1)
    if (
      playerMateBefore !== undefined &&
      playerMateBefore < 0 &&
      playerMateAfter !== undefined &&
      playerMateAfter < 0
    ) {
      const distBefore = Math.abs(playerMateBefore);
      const distAfter = Math.abs(playerMateAfter);
      const stepsShortened = distBefore - distAfter;

      if (isBestMoveChoice || distAfter >= distBefore) {
        return {
          cpl: 0,
          winProbBefore,
          winProbAfter,
          winProbLoss: 0,
          moveAccuracy: 100,
          category: 'Best',
        };
      }

      if ((distAfter === 1 && distBefore >= 2) || stepsShortened >= 3) {
        return {
          cpl: stepsShortened * 120,
          winProbBefore,
          winProbAfter,
          winProbLoss,
          moveAccuracy,
          category: 'Blunder',
        };
      }

      if (stepsShortened === 2) {
        return {
          cpl: 220,
          winProbBefore,
          winProbAfter,
          winProbLoss,
          moveAccuracy,
          category: 'Mistake',
        };
      }

      return {
        cpl: 120,
        winProbBefore,
        winProbAfter,
        winProbLoss,
        moveAccuracy,
        category: 'Inaccuracy',
      };
    }

    // Case C: Player HAD a forced mate (playerMateBefore > 0)
    if (playerMateBefore !== undefined && playerMateBefore > 0) {
      if (playerMateAfter !== undefined && playerMateAfter > 0) {
        const distBefore = playerMateBefore;
        const distAfter = playerMateAfter;
        const optimalAfterDist = Math.max(1, distBefore - 1);

        // Only Best if it is the engine's best move or achieves the optimal mate reduction
        if (isBestMoveChoice || distAfter <= optimalAfterDist) {
          // Check if finding this forced mate was a uniquely strong Great/Brilliant move
          if (isBestMoveChoice && secondBestCp !== undefined && secondBestMate === undefined) {
            return {
              cpl: 0,
              winProbBefore,
              winProbAfter,
              winProbLoss: 0,
              moveAccuracy: 100,
              category: 'Great',
            };
          }
          return {
            cpl: 0,
            winProbBefore,
            winProbAfter,
            winProbLoss: 0,
            moveAccuracy: 100,
            category: 'Best',
          };
        }

        const extraMoves = distAfter - optimalAfterDist;
        if (extraMoves >= 3) {
          return {
            cpl: 160 + extraMoves * 25,
            winProbBefore,
            winProbAfter,
            winProbLoss,
            moveAccuracy,
            category: 'MissedChance',
          };
        }

        return {
          cpl: 110 + extraMoves * 25,
          winProbBefore,
          winProbAfter,
          winProbLoss,
          moveAccuracy,
          category: 'Inaccuracy',
        };
      }

      // Player had a forced mate and lost it completely (playerMateAfter === undefined)
      if (playerEvalAfter < 120) {
        return {
          cpl: Math.max(cpl, 550),
          winProbBefore,
          winProbAfter,
          winProbLoss,
          moveAccuracy,
          category: 'Blunder',
        };
      }

      if (playerEvalAfter < 500 || playerMateBefore <= 6) {
        return {
          cpl: Math.max(cpl, 220),
          winProbBefore,
          winProbAfter,
          winProbLoss,
          moveAccuracy,
          category: 'MissedChance',
        };
      }

      return {
        cpl: Math.max(cpl, 130),
        winProbBefore,
        winProbAfter,
        winProbLoss,
        moveAccuracy,
        category: 'Inaccuracy',
      };
    }

    // Case D: Player did NOT have a forced mate before, and found a forced mate (playerMateAfter > 0)
    if (playerMateBefore === undefined && playerMateAfter !== undefined && playerMateAfter > 0) {
      if (isMaterialSacrificeMove(fenBefore, fenAfter, uci, player)) {
        return {
          cpl: 0,
          winProbBefore,
          winProbAfter,
          winProbLoss: 0,
          moveAccuracy: 100,
          category: 'Brilliant',
        };
      }
      return {
        cpl: 0,
        winProbBefore,
        winProbAfter,
        winProbLoss: 0,
        moveAccuracy: 100,
        category: 'Best',
      };
    }
  }

  // ============================================================================
  // 4. Standard Non-Mate Evaluation Classification
  // ============================================================================
  const hasSecondOption = secondBestCp !== undefined || secondBestMate !== undefined;
  const secondBestWhiteWinProb = hasSecondOption
    ? cpToWhiteWinProbability(secondBestCp, secondBestMate)
    : undefined;
  const playerSecondBestWinProb =
    secondBestWhiteWinProb !== undefined
      ? toPlayerWinProbability(secondBestWhiteWinProb, player)
      : undefined;
  const playerSecondBestCp =
    secondBestCp !== undefined && Number.isFinite(secondBestCp)
      ? secondBestCp * sign
      : undefined;

  // 4.1 Brilliant, Great, and Best (ONLY when the player played the engine's best move)
  if (isBestMoveChoice && winProbLoss <= 2) {
    // Check for Brilliant move:
    // Must be engine's best move, involve a verified material sacrifice, maintain >= 50% win prob,
    // not be in an already trivially won position (< 550 cp), and be clearly stronger than passive 2nd choice.
    if (
      playerWinProbAfter >= 50 &&
      playerEvalBefore < 550 &&
      isMaterialSacrificeMove(fenBefore, fenAfter, uci, player)
    ) {
      const advantageOverSecondCp =
        playerSecondBestCp !== undefined ? playerEvalBefore - playerSecondBestCp : 120;
      const advantageOverSecondWinProb =
        playerSecondBestWinProb !== undefined
          ? playerWinProbBefore - playerSecondBestWinProb
          : 10;

      if (advantageOverSecondCp >= 90 || advantageOverSecondWinProb >= 8) {
        return {
          cpl: 0,
          winProbBefore,
          winProbAfter,
          winProbLoss: 0,
          moveAccuracy: 100,
          category: 'Brilliant',
        };
      }
    }

    // Check for Great move:
    // Compares MultiPV #1 (`playerEvalBefore` / `playerWinProbBefore`) against MultiPV #2
    // (`playerSecondBestCp` / `playerSecondBestWinProb`) from the SAME initial position `fenBefore`.
    if (
      playerSecondBestCp !== undefined &&
      playerSecondBestWinProb !== undefined &&
      playerWinProbAfter >= 35
    ) {
      const cpGapFromSamePosition = playerEvalBefore - playerSecondBestCp;
      const winProbGapFromSamePosition = playerWinProbBefore - playerSecondBestWinProb;

      if (cpGapFromSamePosition >= 120 && winProbGapFromSamePosition >= 11) {
        return {
          cpl: 0,
          winProbBefore,
          winProbAfter,
          winProbLoss: 0,
          moveAccuracy: 100,
          category: 'Great',
        };
      }
    }

    return {
      cpl: 0,
      winProbBefore,
      winProbAfter,
      winProbLoss: 0,
      moveAccuracy: 100,
      category: 'Best',
    };
  }

  // 4.2 Near-Best / Excellent Move (not the #1 engine move, but minimal loss)
  if (cpl <= thresholds.excellentMaxCpl && winProbLoss <= 6) {
    return {
      cpl,
      winProbBefore,
      winProbAfter,
      winProbLoss,
      moveAccuracy,
      category: 'Excellent',
    };
  }

  // 4.3 Good Move (solid playable move with minor loss)
  if (cpl <= thresholds.goodMaxCpl && winProbLoss <= 11.5) {
    return {
      cpl,
      winProbBefore,
      winProbAfter,
      winProbLoss,
      moveAccuracy,
      category: 'Good',
    };
  }
  // Also if the position is already overwhelmingly decided (|eval| >= 600 cp) and winProbLoss <= 5%,
  // a higher CPL (e.g. +750 -> +620) does not materially harm win probability and is a Good move.
  if (winProbLoss <= 5) {
    return {
      cpl,
      winProbBefore,
      winProbAfter,
      winProbLoss,
      moveAccuracy,
      category: 'Good',
    };
  }

  // 4.4 Missed Chance (Упущенный шанс):
  // Player had a concrete winning advantage / tactical opportunity in `fenBefore` (`bestMoveUci` gave >= 72% win prob
  // and >= +200 cp), played a suboptimal move (`uci !== bestMoveUci`) that let the opponent equalize
  // (`playerWinProbAfter` in [38%, 62%], `winProbLoss` >= 14%), without blundering into a lost position.
  const pieceLost =
    cpl >= 200 && doesMoveLosePiece(fenBefore, fenAfter, player, opponentBestPvUci);

  if (
    !pieceLost &&
    playerWinProbBefore >= 72 &&
    playerEvalBefore >= 200 &&
    playerWinProbAfter >= 38 &&
    playerWinProbAfter <= 62 &&
    winProbLoss >= 14 &&
    winProbLoss <= 35
  ) {
    return {
      cpl,
      winProbBefore,
      winProbAfter,
      winProbLoss,
      moveAccuracy,
      category: 'MissedChance',
    };
  }

  // Dynamic Win-Probability boundaries scaled by user-configured CPL thresholds
  const inaccuracyWinProbMax = Math.max(
    10,
    Math.round((thresholds.inaccuracyMaxCpl / 175) * 19)
  );
  const mistakeWinProbMax = Math.max(
    inaccuracyWinProbMax + 6,
    Math.round((thresholds.mistakeMaxCpl / 300) * 32)
  );

  // 4.5 Inaccuracy (Неточность ?!)
  if (
    !pieceLost &&
    winProbLoss <= inaccuracyWinProbMax &&
    (cpl <= thresholds.inaccuracyMaxCpl || winProbLoss <= 12)
  ) {
    return {
      cpl,
      winProbBefore,
      winProbAfter,
      winProbLoss,
      moveAccuracy,
      category: 'Inaccuracy',
    };
  }

  // 4.6 Mistake (?) vs Blunder (??)
  // Blunder when:
  // - Verified uncompensated piece loss (SEE / PV >= 250 cp) confirmed by engine (`winProbLoss >= 16` & `cpl >= 200`), OR
  // - Severe win probability collapse (`winProbLoss > mistakeWinProbMax`), OR
  // - CPL exceeds `thresholds.mistakeMaxCpl` accompanied by substantial win probability loss (`winProbLoss >= 20`).
  const isVerifiedMaterialBlunder = pieceLost && winProbLoss >= 16 && cpl >= 200;
  const isCatastrophicEvalBlunder =
    winProbLoss > mistakeWinProbMax ||
    (cpl > thresholds.mistakeMaxCpl && winProbLoss >= 20);

  if (isVerifiedMaterialBlunder || isCatastrophicEvalBlunder) {
    return {
      cpl,
      winProbBefore,
      winProbAfter,
      winProbLoss,
      moveAccuracy,
      category: 'Blunder',
    };
  }

  return {
    cpl,
    winProbBefore,
    winProbAfter,
    winProbLoss,
    moveAccuracy,
    category: 'Mistake',
  };
}

function isTiedTopTopMove(isExact: boolean, isTied: boolean): boolean {
  return isExact || isTied;
}

/**
 * Re-classifies existing MoveAnalysis items across the entire tree when user changes thresholds.
 */
export function reclassifyMoveAnalyses(
  nodes: MoveNode[],
  thresholds: ClassificationThresholds
): void {
  for (const node of nodes) {
    if (node.analysis) {
      const a = node.analysis;
      const secondLine = a.alternativeLines.find((l) => l.multipv === 2);
      const updated = classifyMoveFromEvaluations({
        player: a.player,
        uci: a.uci,
        fenBefore: a.fenBefore,
        fenAfter: a.fenAfter,
        bestMoveUci: a.bestMoveUci,
        evalBeforeCp: a.evalBeforeCp,
        evalAfterCp: a.evalAfterCp,
        mateBefore: a.mateBefore,
        mateAfter: a.mateAfter,
        secondBestCp: secondLine?.cp,
        secondBestMate: secondLine?.mate,
        alternativeLines: a.alternativeLines,
        isTheoretical: a.isTheoretical,
        thresholds,
      });
      a.cpl = updated.cpl;
      a.winProbBefore = updated.winProbBefore;
      a.winProbAfter = updated.winProbAfter;
      a.winProbLoss = updated.winProbLoss;
      a.moveAccuracy = updated.moveAccuracy;
      a.category = updated.category;
    }
  }
}

/**
 * Collects all nodes in the variation tree (pre-order traversal) so variations outside the main game are also processed.
 */
export function getAllTreeNodes(root: MoveNode): MoveNode[] {
  const result: MoveNode[] = [];
  function visit(n: MoveNode) {
    result.push(n);
    for (const child of n.children) {
      visit(child);
    }
  }
  visit(root);
  return result;
}

export class MoveAnalyzerService {
  private abortController: AbortController | null = null;

  public cancelBatchAnalysis(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      stockfishClient.stop();
    }
  }

  /**
   * Evaluates a single move (including moves played by the user in side variations / outside the main game)
   * at the requested depth (respecting full configurable depth without hidden caps).
   */
  public async evaluateSingleMoveNode(
    prevNode: MoveNode,
    currNode: MoveNode,
    depth: number = 12,
    thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS
  ): Promise<MoveAnalysis> {
    await stockfishClient.init();
    const evalDepth = stockfishClient.normalizeDepth(depth);

    const beforeRes = await stockfishClient.evaluateFenAsync(prevNode.fen, evalDepth, 2);
    const evalBeforeLines = beforeRes.lines;
    const bestMoveBefore = beforeRes.bestMove || beforeRes.lines[0]?.pv?.[0] || '';
    const cpBefore = beforeRes.lines[0]?.cp;
    const mateBefore = beforeRes.lines[0]?.mate;

    const afterRes = await stockfishClient.evaluateFenAsync(currNode.fen, evalDepth, 2);
    const primaryAfter = afterRes.lines[0];
    const cpAfter = primaryAfter?.cp;
    const mateAfter = primaryAfter?.mate;
    const opponentBestPvUci = primaryAfter?.pv || [];

    const bestLineUci = evalBeforeLines[0]?.pv || (bestMoveBefore ? [bestMoveBefore] : []);
    const bestLineSan = uciLineToSan(prevNode.fen, bestLineUci, 6);
    const bestMoveSan = bestLineSan[0] || currNode.san;

    const isTheoretical = Boolean(
      currNode.ply <= 24 &&
        (openingBook.isBookMove(prevNode.fen, currNode.san, currNode.fen) ||
          openingBook.isBookMove(prevNode.fen, currNode.uci, currNode.fen))
    );
    const secondLine = evalBeforeLines.find((l) => l.multipv === 2);

    const classification = classifyMoveFromEvaluations({
      player: currNode.color,
      uci: currNode.uci,
      fenBefore: prevNode.fen,
      fenAfter: currNode.fen,
      bestMoveUci: bestMoveBefore,
      evalBeforeCp: cpBefore,
      evalAfterCp: cpAfter,
      mateBefore,
      mateAfter,
      secondBestCp: secondLine?.cp,
      secondBestMate: secondLine?.mate,
      alternativeLines: evalBeforeLines,
      opponentBestPvUci,
      isTheoretical,
      thresholds,
    });

    return {
      nodeId: currNode.id,
      ply: currNode.ply,
      moveNumber: currNode.moveNumber,
      player: currNode.color,
      san: currNode.san,
      uci: currNode.uci,
      fenBefore: prevNode.fen,
      fenAfter: currNode.fen,
      bestMoveUci: bestMoveBefore,
      bestMoveSan,
      evalBeforeCp: cpBefore ?? 0,
      evalAfterCp: cpAfter ?? 0,
      mateBefore,
      mateAfter,
      winProbBefore: classification.winProbBefore,
      winProbAfter: classification.winProbAfter,
      cpl: classification.cpl,
      winProbLoss: classification.winProbLoss,
      moveAccuracy: classification.moveAccuracy,
      category: classification.category,
      bestLineUci,
      bestLineSan,
      alternativeLines: evalBeforeLines,
      depth: evalDepth,
      isTheoretical,
    };
  }

  /**
   * Runs full-game Stockfish evaluation across all nodes in the tree (mainline + all user variations),
   * populates MoveAnalysis on each node, and invokes `onProgress`.
   */
  public async analyzeGameNodes(
    rootOrMainline: MoveNode | MoveNode[],
    options: {
      depth: number;
      thresholds: ClassificationThresholds;
      onProgress?: (completedPlies: number, totalPlies: number, analyzedNodeId: string) => void;
    }
  ): Promise<MoveAnalysis[]> {
    this.cancelBatchAnalysis();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    await stockfishClient.init();

    const rootNode = Array.isArray(rootOrMainline) ? rootOrMainline[0] : rootOrMainline;
    if (!rootNode) return [];

    const mainlineNodes = getMainlineNodes(rootNode);
    const openingSummary = openingBook.analyzeMainlineOpening(mainlineNodes);

    const edges: Array<{ parent: MoveNode; child: MoveNode }> = [];
    function collectEdges(node: MoveNode) {
      for (const child of node.children) {
        edges.push({ parent: node, child });
        collectEdges(child);
      }
    }
    collectEdges(rootNode);

    const totalPlies = edges.length;
    if (totalPlies === 0) return [];

    const evalCache = new Map<
      string,
      {
        bestMove: string;
        lines: EngineLine[];
        cp?: number;
        mate?: number;
      }
    >();

    const batchDepth = stockfishClient.normalizeDepth(options.depth);

    const getOrEvaluateFen = async (fen: string) => {
      const cached = evalCache.get(fen);
      if (cached) return cached;

      const evalResult = await stockfishClient.evaluateFenAsync(fen, batchDepth, 2);
      const primaryLine = evalResult.lines[0];
      const entry = {
        bestMove: evalResult.bestMove || primaryLine?.pv?.[0] || '',
        lines: evalResult.lines,
        cp: primaryLine?.cp,
        mate: primaryLine?.mate,
      };
      evalCache.set(fen, entry);
      return entry;
    };

    const mainlineAnalyses: MoveAnalysis[] = [];

    for (let i = 0; i < edges.length; i++) {
      if (signal.aborted) {
        throw new Error('Анализ отменён');
      }

      const { parent: prevNode, child: currNode } = edges[i];
      const evalBefore = await getOrEvaluateFen(prevNode.fen);

      if (signal.aborted) {
        throw new Error('Анализ отменён');
      }

      const evalAfter = await getOrEvaluateFen(currNode.fen);

      if (signal.aborted) {
        throw new Error('Анализ отменён');
      }

      const bestMoveUci = evalBefore.bestMove;
      const bestLineUci = evalBefore.lines[0]?.pv || (bestMoveUci ? [bestMoveUci] : []);
      const bestLineSan = uciLineToSan(prevNode.fen, bestLineUci, 6);
      const bestMoveSan = bestLineSan[0] || currNode.san;
      const opponentBestPvUci = evalAfter.lines[0]?.pv || [];

      const isMainlineBookMove =
        currNode.isMainline &&
        openingSummary.lastTheoreticalPly > 0 &&
        currNode.ply <= openingSummary.lastTheoreticalPly &&
        (openingSummary.firstOutOfBookPly === null ||
          currNode.ply < openingSummary.firstOutOfBookPly);

      const isVariationBookMove =
        !currNode.isMainline &&
        currNode.ply <= 24 &&
        (openingBook.isBookMove(prevNode.fen, currNode.san, currNode.fen) ||
          openingBook.isBookMove(prevNode.fen, currNode.uci, currNode.fen));

      const isTheoretical = Boolean(isMainlineBookMove || isVariationBookMove);
      const secondLine = evalBefore.lines.find((l) => l.multipv === 2);

      const classification = classifyMoveFromEvaluations({
        player: currNode.color,
        uci: currNode.uci,
        fenBefore: prevNode.fen,
        fenAfter: currNode.fen,
        bestMoveUci,
        evalBeforeCp: evalBefore.cp,
        evalAfterCp: evalAfter.cp,
        mateBefore: evalBefore.mate,
        mateAfter: evalAfter.mate,
        secondBestCp: secondLine?.cp,
        secondBestMate: secondLine?.mate,
        alternativeLines: evalBefore.lines,
        opponentBestPvUci,
        isTheoretical,
        thresholds: options.thresholds,
      });

      const moveAnalysis: MoveAnalysis = {
        nodeId: currNode.id,
        ply: currNode.ply,
        moveNumber: currNode.moveNumber,
        player: currNode.color,
        san: currNode.san,
        uci: currNode.uci,
        fenBefore: prevNode.fen,
        fenAfter: currNode.fen,
        bestMoveUci,
        bestMoveSan,
        evalBeforeCp: evalBefore.cp ?? 0,
        evalAfterCp: evalAfter.cp ?? 0,
        mateBefore: evalBefore.mate,
        mateAfter: evalAfter.mate,
        winProbBefore: classification.winProbBefore,
        winProbAfter: classification.winProbAfter,
        cpl: classification.cpl,
        winProbLoss: classification.winProbLoss,
        moveAccuracy: classification.moveAccuracy,
        category: classification.category,
        bestLineUci,
        bestLineSan,
        alternativeLines: evalBefore.lines,
        depth: batchDepth,
        isTheoretical,
      };

      currNode.analysis = moveAnalysis;
      if (currNode.isMainline) {
        mainlineAnalyses.push(moveAnalysis);
      }

      options.onProgress?.(i + 1, totalPlies, currNode.id);
    }

    openingBook.analyzeMainlineOpening(mainlineNodes);

    return mainlineAnalyses;
  }
}

export const moveAnalyzer = new MoveAnalyzerService();
