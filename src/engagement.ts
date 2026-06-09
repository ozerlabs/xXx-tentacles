import type { Engagement, PostedItem } from "./schema.js";

/**
 * The engagement source — the seam between the Analyst and real metrics.
 *
 * Today it's simulated. Later, XApiEngagement pulls real numbers from the X API
 * and nothing in the Analyst changes. Crucially, the LLM NEVER produces these
 * numbers — it only interprets them (the ChemCrow lesson: models can't self-grade).
 */
export interface EngagementSource {
  readonly label: string;
  fetch(post: PostedItem): Promise<Engagement>;
}

/**
 * Dry run: fabricates plausible numbers, biased by the post's PREDICTED virality
 * with heavy noise — so high-virality posts usually win, but a predicted hit can
 * still flop. That noise is the whole point: it gives the Analyst something real
 * to reflect on (prediction vs reality), instead of a rubber stamp.
 */
export class SimulatedEngagement implements EngagementSource {
  readonly label = "SIMULATED (no real metrics)";

  async fetch(post: PostedItem): Promise<Engagement> {
    const v = post.predicted_virality; // 0–10
    const noise = 0.45 + Math.random() * 1.1; // 0.45–1.55: a hit can flop, a dud can pop

    const impressions = Math.round((1500 + v * 3800) * noise);
    const likeRate = ((0.5 + v * 0.45) / 100) * noise; // ~0.5%–5%
    const likes = Math.round(impressions * likeRate);
    const reposts = Math.round(likes * (0.08 + Math.random() * 0.22));
    const replies = Math.round(likes * (0.05 + Math.random() * 0.3)); // beefs draw replies
    const quotes = Math.round(reposts * (0.15 + Math.random() * 0.5));

    return { impressions, likes, reposts, replies, quotes };
  }
}

/** Placeholder for real metrics — loud-fails until the X API is wired. */
export class XApiEngagement implements EngagementSource {
  readonly label = "X.com LIVE metrics";
  async fetch(_post: PostedItem): Promise<Engagement> {
    throw new Error("Real X.com metrics aren't wired yet. Add X API credentials, then implement XApiEngagement.");
  }
}

/** Scores WE compute from the raw numbers — never the model. */
export function engagementRate(e: Engagement): number {
  if (e.impressions <= 0) return 0;
  const weighted = e.likes + 2 * e.reposts + 1.5 * e.replies + 2 * e.quotes;
  return (weighted / e.impressions) * 100;
}

/** Map an engagement rate onto the same 0–10 scale virality was predicted on. */
export function rateToVirality(rate: number): number {
  // ~6%+ weighted rate is a smash; clamp to 0–10, one decimal.
  return Math.round(Math.min(10, (rate / 6) * 10) * 10) / 10;
}
