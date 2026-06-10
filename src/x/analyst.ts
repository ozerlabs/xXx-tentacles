/**
 * THE ANALYST — a McKinsey engagement over the fact base.
 *
 * Implements Stages 1–3 of agent-orchestration.md:
 *   Stage 1 · Workstreams   — 5 parallel analyst workers, each owning one MECE
 *                             dimension (voice / content / audience / cadence /
 *                             market). Parallelization (sectioning).
 *   Stage 2 · Engagement Mgr — synthesizes the workstreams into one answer-first
 *                             deliverable. Orchestrator–workers.
 *   Stage 3 · Partner Review — critiques the draft against a quality bar and loops
 *                             until it passes. Evaluator–optimizer.
 *
 * The Data Room (factbase.ts) already computed every number IN CODE. These stages
 * only INTERPRET those numbers — the model never invents a statistic. If no API
 * key is configured, `analyze()` returns null and the report falls back to its
 * rule-derived prose.
 */
import { z } from "zod";
import { callJSON, hasLLM } from "../llm.js";
import type { FactBase } from "./factbase.js";

// ── output shape the report consumes ─────────────────────────────────────────────
export const FindingSchema = z.object({
  stat: z.string(),
  diagnosis: z.string(),
  fix: z.string(),
});
export const RecSchema = z.object({
  move: z.string(),
  why: z.string(),
  impact: z.enum(["High", "Medium"]),
  effort: z.enum(["Low", "Medium", "High"]),
});
export const AnalysisSchema = z.object({
  verdict: z.string(),
  findings: z.array(FindingSchema),
  recommendations: z.array(RecSchema),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const WorkstreamSchema = z.object({
  dimension: z.string(),
  headline: z.string(),
  observations: z.array(z.object({ stat: z.string(), insight: z.string() })),
});
type Workstream = z.infer<typeof WorkstreamSchema>;

const ReviewSchema = z.object({
  pass: z.boolean(),
  score: z.number(),
  issues: z.array(z.string()),
});

// ── shared voice ─────────────────────────────────────────────────────────────────
const HOUSE_VOICE = `You are a senior growth strategist at Tentacle Partners — think McKinsey, but for
building a brutal, fast-growing presence on X (Twitter). Your job is to make the client BIG.
You are sharp, candid to the point of uncomfortable, and allergic to generic advice. X rewards
extremes, not nuance. Every claim you make MUST cite a real number from the fact base you are
given — never invent a statistic. Be specific to THIS person, not advice that fits anyone.`;

const FACTS_RULE = `The FACT SHEET below was computed deterministically from the client's real X data.
Treat every number as ground truth. Cite numbers exactly as labeled — do not relabel a number as
something it isn't (e.g. the follower:following ratio is NOT an engagement rate). Never invent numbers.`;

const pc = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * A clean, LABELED fact sheet — not raw JSON. Giving the model well-documented
 * inputs (the ACI principle) stops it conflating one number for another.
 */
function factSheet(f: FactBase): string {
  const o = f.owner;
  const topHours = f.cadenceByHourIST
    .map((c, h) => ({ h, c }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map((x) => `${x.h}:00 IST (${x.c})`)
    .join(", ");
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDow = f.cadenceByDow.map((c, i) => `${dow[i]} ${c}`).join(" · ");

  return [
    `=== ACCOUNT ===`,
    `Handle: @${o.handle}  |  Name: ${o.name ?? "—"}`,
    `Bio: ${o.bioPresent ? JSON.stringify(o.bio) : "EMPTY (not set)"}`,
    `Account age: ${o.accountAgeYears?.toFixed(1) ?? "?"} years  |  Total lifetime posts: ${o.posts}`,
    `Followers: ${o.followers}  |  Following: ${o.following}  |  Times listed: ${o.listed}  |  Likes this account has GIVEN: ${o.likesGiven}`,
    ``,
    `=== RATIOS ===`,
    `Follower-to-following ratio: ${f.ratios.followerToFollowing.toFixed(2)} (this is NOT an engagement rate)`,
    `Followers earned per lifetime post: ${f.ratios.followersPerPost.toFixed(3)}`,
    `Posting rate over account life: ${f.ratios.postsPerDay?.toFixed(2) ?? "?"} posts/day`,
    ``,
    `=== ANALYZED SAMPLE (recent posts) ===`,
    `Total recent posts: ${f.sample.total}  |  Authored (not retweets): ${f.sample.authored}  |  Pure retweets: ${f.sample.retweets}`,
    `Of authored: ${f.sample.original} original, ${f.sample.quotes} quote-tweets, ${f.sample.replies} replies`,
    `Authored posts with media: ${f.sample.withMedia}/${f.sample.authored}  |  with view data: ${f.sample.withViews}/${f.sample.authored}`,
    ``,
    `=== ENGAGEMENT (authored posts with view data) ===`,
    `Average views/post: ${f.engagement.avgViews}  |  Median views/post: ${f.engagement.medianViews}`,
    `Average engagement rate (interactions/impressions): ${pc(f.engagement.avgEngagementRatePct / 100)}`,
    `Average likes/post: ${f.engagement.avgLikesPerAuthored.toFixed(1)}  |  Total bookmarks earned in sample: ${f.engagement.totalBookmarks}`,
    `Format lift — avg views WITH media: ${f.formatLift.mediaAvgViews} vs TEXT-only: ${f.formatLift.textAvgViews}`,
    ``,
    `=== TOP POSTS BY REACH ===`,
    ...f.topPosts.map(
      (p, i) =>
        `${i + 1}. ${p.views} views, ${p.likes} likes, ${p.bookmarks} bookmarks, ${pc(p.engagementRate)} eng — "${p.text.slice(0, 100).replace(/\n/g, " ")}"`
    ),
    ``,
    `=== CADENCE ===`,
    `Busiest posting hours: ${topHours || "—"}  |  By weekday: ${byDow}`,
    ``,
    `=== POSITIONING ===`,
    `Hashtags used: ${f.hashtags.map((h) => `#${h.tag}(${h.count})`).join(", ") || "NONE"}`,
    `Algorithm groups this account with (who-to-follow recs): ${f.niche.recommendations.map((r) => "@" + r.handle).join(", ") || "—"}`,
    `Biggest accounts they follow: ${f.niche.following.slice(0, 5).map((u) => `@${u.handle}(${u.followers})`).join(", ")}`,
    ``,
    `=== MARKET (live in their region) ===`,
    `Trends: ${f.market.trends.map((t) => t.name).join(", ") || "—"}`,
    `Story angles in the air: ${f.market.stories.map((s) => `[${s.category}] ${s.name}`).join(" | ") || "—"}`,
    ``,
    `=== AUTHORED POSTS (verbatim, for voice analysis) ===`,
    ...f.authoredTexts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, " ")}`),
  ].join("\n");
}

// ── Stage 1 — workstreams ─────────────────────────────────────────────────────────
const DIMENSIONS: { key: string; brief: string }[] = [
  {
    key: "Voice & Identity",
    brief:
      "How does this person actually write? Tone, recurring topics, the lane they could own. Use the authored post texts. Is there a recognizable voice, or noise?",
  },
  {
    key: "Content Performance",
    brief:
      "What earns reach vs. what flops? Use views, engagement rate, top posts, content mix (original vs quote vs retweet), and format lift (media vs text).",
  },
  {
    key: "Audience & Positioning",
    brief:
      "Who follows them, who the algorithm groups them with (recommendations), and the biggest accounts they follow. What niche do they sit in and are they serving it?",
  },
  {
    key: "Cadence & Timing",
    brief:
      "Posting frequency (posts/day over the account's life), the follower-per-post conversion, and when in the day they post. Is the effort compounding?",
  },
  {
    key: "Market Fit",
    brief:
      "Given the live trends and AI story angles in the fact base, is this person riding what's hot in their lane — or posting into the void?",
  },
];

async function runWorkstream(d: { key: string; brief: string }, sheet: string): Promise<Workstream | null> {
  try {
    return await callJSON<Workstream>(
      `${HOUSE_VOICE}\n\nYou own ONE workstream: "${d.key}". ${d.brief}\n${FACTS_RULE}`,
      `FACT SHEET:\n${sheet}\n\nReturn JSON:
{
  "dimension": "${d.key}",
  "headline": "one brutally sharp sentence — the single most important thing about this dimension",
  "observations": [ { "stat": "the exact number/fact you're citing", "insight": "what it means for growth, specific to this person" } ]
}
Give 2–4 observations. Cite real numbers only.`,
      WorkstreamSchema,
      { temperature: 0.65 }
    );
  } catch {
    return null;
  }
}

// ── Stage 2 — synthesis ────────────────────────────────────────────────────────────
async function synthesize(sheet: string, streams: Workstream[], feedback?: string[]): Promise<Analysis> {
  const fb = feedback?.length
    ? `\n\nA senior partner reviewed your last draft and demanded fixes. Address ALL of these:\n- ${feedback.join("\n- ")}`
    : "";
  return callJSON<Analysis>(
    `${HOUSE_VOICE}\n\nYou are the engagement manager. Synthesize the workstream findings into ONE deliverable.
Lead with the answer (pyramid principle). ${FACTS_RULE}${fb}`,
    `FACT SHEET:\n${sheet}\n\nWORKSTREAM FINDINGS (JSON):\n${JSON.stringify(streams)}\n\nReturn JSON:
{
  "verdict": "ONE devastating, answer-first sentence — the bottom line up front. Must contain a real number.",
  "findings": [ { "stat": "real number/fact", "diagnosis": "what's actually wrong, brutally", "fix": "the specific move that fixes it" } ],
  "recommendations": [ { "move": "concrete action", "why": "why it matters, citing a number", "impact": "High|Medium", "effort": "Low|Medium|High" } ]
}
Give 5–7 findings (the sharpest, deduped across workstreams) and 4–6 recommendations, ordered by impact.`,
    AnalysisSchema,
    { temperature: 0.7 }
  );
}

// ── Stage 3 — partner review (evaluator-optimizer) ─────────────────────────────────
async function review(sheet: string, draft: Analysis): Promise<z.infer<typeof ReviewSchema>> {
  return callJSON(
    `${HOUSE_VOICE}\n\nYou are the SENIOR PARTNER signing off this deliverable. Score it with a RUBRIC, not a vibe.
Start at 10 and DEDUCT only for specific, named defects you can quote:
  −3  a claim cites a number that is wrong or not on the fact sheet (e.g. a mislabeled ratio).
  −2  a finding or rec is generic — would apply to any account, not specific to THIS person/their data.
  −2  the tone is soft or hedged (brutal candor is REQUIRED and must NOT be penalized).
  −1  a recommendation is vague / not concretely actionable.
  −1  findings duplicate each other.
Do NOT deduct for: brutality, missing data we don't have, or stylistic taste. A clean, fact-anchored,
specific, brutal deliverable should score 8–10. PASS when score >= 7. ${FACTS_RULE}`,
    `FACT SHEET:\n${sheet}\n\nDRAFT DELIVERABLE (JSON):\n${JSON.stringify(draft)}\n\nReturn JSON:
{ "pass": <score >= 7>, "score": <0-10 after deductions>, "issues": ["each issue = the exact defect + which finding/rec it's in; empty if none"] }`,
    ReviewSchema,
    { temperature: 0.2 }
  );
}

// ── orchestration ────────────────────────────────────────────────────────────────
export interface AnalyzeResult {
  analysis: Analysis;
  meta: { workstreams: number; reviewScore: number; iterations: number };
}

/**
 * Run the full engagement. Returns null if no LLM is configured (caller falls
 * back to rule-derived prose). Workstreams that fail are dropped, not fatal.
 */
export async function analyze(
  f: FactBase,
  opts: { maxIterations?: number; log?: (m: string) => void } = {}
): Promise<AnalyzeResult | null> {
  if (!hasLLM()) return null;
  const { maxIterations = 2, log = () => {} } = opts;
  const sheet = factSheet(f);

  // Stage 1 — parallel workstreams
  log("running 5 workstreams in parallel…");
  const streams = (await Promise.all(DIMENSIONS.map((d) => runWorkstream(d, sheet)))).filter(
    (s): s is Workstream => s !== null
  );
  if (!streams.length) return null;
  log(`${streams.length}/5 workstreams returned.`);

  // Stage 2 + 3 — synthesize, then partner-review and refine until it passes.
  // Keep the BEST-scoring draft: refinement can regress, and we must never ship
  // a worse deliverable than one we already produced.
  let candidate = await synthesize(sheet, streams);
  let best = { analysis: candidate, score: -1 };
  let iterations = 0;
  for (let i = 1; i <= maxIterations; i++) {
    iterations = i;
    const verdict = await review(sheet, candidate);
    log(`partner review #${i}: score ${verdict.score}/10${verdict.pass ? " ✓" : ""}`);
    if (verdict.score > best.score) best = { analysis: candidate, score: verdict.score };
    if (verdict.pass || i === maxIterations) break;
    candidate = await synthesize(sheet, streams, verdict.issues);
  }

  return {
    analysis: best.analysis,
    meta: { workstreams: streams.length, reviewScore: best.score, iterations },
  };
}
