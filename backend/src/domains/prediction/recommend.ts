export interface OutcomeRecommendation {
  outcome: number; // 0 home, 1 draw, 2 away
  edge: number; // Kelly fraction (positive = edge); can be negative
  modelProb: number;
  impliedProb: number;
}

/**
 * Given model probabilities and the parimutuel pools, pick the outcome with the
 * best Kelly edge. For a parimutuel bet the decimal payout ≈ total/pool, so net
 * odds b = (1 - implied) / implied and the Kelly fraction simplifies to
 *   f* = (p - implied) / (1 - implied).
 * Empty pools (implied 0) get f* = p (strong incentive to seed them).
 */
export function recommendOutcome(
  probs: number[],
  pools: number[],
  total: number,
): OutcomeRecommendation {
  let best: OutcomeRecommendation = {
    outcome: 0,
    edge: Number.NEGATIVE_INFINITY,
    modelProb: probs[0] ?? 0,
    impliedProb: 0,
  };
  for (let i = 0; i < 3; i++) {
    const p = probs[i] ?? 0;
    const implied = total > 0 ? (pools[i] ?? 0) / total : 1 / 3;
    const f = implied < 1 ? (p - implied) / (1 - implied) : 0;
    if (f > best.edge) {
      best = { outcome: i, edge: f, modelProb: p, impliedProb: implied };
    }
  }
  return best;
}
