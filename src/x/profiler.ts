/**
 * THE PROFILER — a Hollywood talent agent's read on a person.
 *
 * Mirrors the Analyst's orchestration (agent-orchestration.md), but the subject
 * is identity, not performance. Incentive: make this person BIG — followers,
 * virality, engagement. So the read is candid to the point of uncomfortable.
 *
 *   Stage 1 · Read passes  — 5 parallel lenses on the evidence (parallel/sectioning)
 *   Stage 2 · The Map      — synthesize one structured Personality Map (orchestrator)
 *   Stage 3 · Partner review — critique for grounding/specificity/honesty; loop, keep best
 *
 * The Evidence Room (evidence.ts) already gathered the behavioral facts IN CODE.
 * These stages only INTERPRET them — never invent a tweet, a follow, or a number.
 */
import { z } from "zod";
import { callJSON, hasLLM } from "../llm.js";
import { evidencePack, type Evidence } from "./evidence.js";

// ── the deliverable: a structured Personality Map ────────────────────────────────
export const PersonalityMapSchema = z.object({
  archetype: z.object({ name: z.string(), tagline: z.string() }),
  essence: z.string(), // the one-line "fuck, I get this person"
  personality: z.object({
    traits: z.array(z.string()),
    temperament: z.string(),
    drivers: z.array(z.string()),
  }),
  voice: z.object({ signature: z.string(), tics: z.array(z.string()) }),
  themes: z.array(z.string()), // ownable lanes
  values: z.array(z.string()),
  enemies: z.array(z.string()),
  inGroup: z.array(z.string()),
  strengths: z.array(z.string()),
  liabilities: z.array(z.string()),
  judgment: z.object({
    starRating: z.number(), // 0-10 raw star potential
    marketable: z.string(),
    holdingBack: z.string(),
    uncomfortableTruth: z.string(),
  }),
  positioning: z.object({
    persona: z.string(),
    lane: z.string(),
    pillars: z.array(z.string()),
    newBio: z.string(),
    ninetyDayPlan: z.array(z.string()),
    audience: z.string(),
  }),
});
export type PersonalityMap = z.infer<typeof PersonalityMapSchema>;

const ReadSchema = z.object({
  lens: z.string(),
  headline: z.string(),
  reads: z.array(z.object({ evidence: z.string(), read: z.string() })),
});
type Read = z.infer<typeof ReadSchema>;

const ReviewSchema = z.object({ pass: z.boolean(), score: z.number(), issues: z.array(z.string()) });

// ── house voice ──────────────────────────────────────────────────────────────────
const AGENT = `You are a legendary Hollywood talent agent — but for X (Twitter). Your ONLY incentive is making
your client BIG: followers, virality, engagement. You read people fast and cold. You are warm enough to make
them trust you and brutal enough to tell them the truth no friend will. X rewards extremes, not nuance.
You see the person underneath the posts — who they are, who they're pretending to be, and who they could be
on a marquee. Every read you make MUST be grounded in the actual evidence (their words, what they amplify,
who they follow). Quote it. Be specific to THIS person — generic profiling is worthless.`;

const GROUND = `The EVIDENCE PACK below was pulled from the client's real X account in code. Treat it as ground
truth. Cite specific posts/follows when you make a claim. Never invent a tweet, a follow, or a statistic.`;

// ── Stage 1 — read passes ──────────────────────────────────────────────────────────
const LENSES: { key: string; brief: string }[] = [
  { key: "Voice & Psyche", brief: "How do they actually write — tone, rhythm, humor, what lights them up or sets them off? What does the WAY they post reveal about their temperament and personality?" },
  { key: "Values & Taste", brief: "What do they amplify (retweets) and react to (quotes)? What does that reveal about what they care about, their in-group, and what they quietly despise?" },
  { key: "Obsessions & Expertise", brief: "What themes recur? What do they clearly know cold? Which of these is a lane they could credibly OWN and grow on?" },
  { key: "Aspiration & Tribe", brief: "Who do they follow, and who does the algorithm group them with? Who do they want to BECOME? What room are they trying to get into?" },
  { key: "Perception Gap", brief: "How do they present (bio, originals) vs. how they actually come across? What's the gap between who they are and how they show up — the thing holding them back?" },
];

async function runRead(lens: { key: string; brief: string }, pack: string): Promise<Read | null> {
  try {
    return await callJSON<Read>(
      `${AGENT}\n\nYou are doing ONE read on this client: "${lens.key}". ${lens.brief}\n${GROUND}`,
      `EVIDENCE PACK:\n${pack}\n\nReturn JSON:
{ "lens": "${lens.key}",
  "headline": "one sharp, specific sentence — the core truth of this dimension",
  "reads": [ { "evidence": "the exact post/follow/fact you're reading", "read": "what it reveals about them" } ] }
Give 2–4 reads. Quote real evidence.`,
      ReadSchema,
      { temperature: 0.7 }
    );
  } catch {
    return null;
  }
}

// ── Stage 2 — synthesize the map ────────────────────────────────────────────────────
async function synthesize(pack: string, reads: Read[], feedback?: string[]): Promise<PersonalityMap> {
  const fb = feedback?.length
    ? `\n\nYou pitched this map and got torn apart in the room. Fix ALL of this:\n- ${feedback.join("\n- ")}`
    : "";
  return callJSON<PersonalityMap>(
    `${AGENT}\n\nYou've done the reads. Now build the CLIENT FILE — a personality map, a candid judgment, and a
positioning play to make them blow up. Name an archetype that nails them. The 'essence' is the one line that
makes them feel SEEN. The judgment must be brutally honest. The positioning must be a concrete plan, not
platitudes. ${GROUND}${fb}`,
    `EVIDENCE PACK:\n${pack}\n\nYOUR READS (JSON):\n${JSON.stringify(reads)}\n\nReturn JSON matching exactly:
{
  "archetype": { "name": "a vivid persona name", "tagline": "a sharp one-liner" },
  "essence": "the single sentence that makes them say 'fuck, you get me'",
  "personality": { "traits": ["..."], "temperament": "...", "drivers": ["what actually motivates them"] },
  "voice": { "signature": "how they sound in one line", "tics": ["specific verbal habits, quoting them"] },
  "themes": ["lanes they could own"],
  "values": ["..."], "enemies": ["what/who they're against"], "inGroup": ["who they belong with"],
  "strengths": ["as a creator"], "liabilities": ["what sabotages their growth"],
  "judgment": {
    "starRating": <0-10 raw star potential>,
    "marketable": "the most sellable thing about them",
    "holdingBack": "the #1 thing killing their growth",
    "uncomfortableTruth": "the thing they need to hear and won't like"
  },
  "positioning": {
    "persona": "the character they should lean into",
    "lane": "the ONE territory to own",
    "pillars": ["3-5 content pillars"],
    "newBio": "a rewritten bio (<=160 chars) that earns follows",
    "ninetyDayPlan": ["concrete moves, in order"],
    "audience": "who to court"
  }
}`,
    PersonalityMapSchema,
    { temperature: 0.75 }
  );
}

// ── Stage 3 — partner review (evaluator-optimizer, rubric-anchored) ─────────────────
async function review(pack: string, map: PersonalityMap): Promise<z.infer<typeof ReviewSchema>> {
  return callJSON(
    `${AGENT}\n\nYou are the senior partner signing off this client file. Score with a RUBRIC. Start at 10, deduct:
  −3  a claim contradicts or isn't supported by the evidence pack.
  −2  the read is generic — could describe any tech person, not THIS one.
  −2  the judgment is soft / flattering instead of brutally honest.
  −1  positioning is vague rather than concretely actionable.
  −1  the archetype/essence doesn't actually capture them.
Do NOT deduct for brutality (required) or for gaps in data we don't have. A grounded, specific, brutal,
actionable file scores 8–10. PASS at score >= 7. ${GROUND}`,
    `EVIDENCE PACK:\n${pack}\n\nCLIENT FILE (JSON):\n${JSON.stringify(map)}\n\nReturn JSON:
{ "pass": <score>=7>, "score": <0-10 after deductions>, "issues": ["exact defect + where; empty if none"] }`,
    ReviewSchema,
    { temperature: 0.2 }
  );
}

// ── orchestration ────────────────────────────────────────────────────────────────
export interface ProfileResult {
  map: PersonalityMap;
  meta: { reads: number; reviewScore: number; iterations: number };
}

export async function profile(
  e: Evidence,
  opts: { maxIterations?: number; log?: (m: string) => void } = {}
): Promise<ProfileResult | null> {
  if (!hasLLM()) return null;
  const { maxIterations = 2, log = () => {} } = opts;
  const pack = evidencePack(e);

  log("running 5 reads in parallel…");
  const reads = (await Promise.all(LENSES.map((l) => runRead(l, pack)))).filter(
    (r): r is Read => r !== null
  );
  if (!reads.length) return null;
  log(`${reads.length}/5 reads returned.`);

  let candidate = await synthesize(pack, reads);
  let best = { map: candidate, score: -1 };
  let iterations = 0;
  for (let i = 1; i <= maxIterations; i++) {
    iterations = i;
    const verdict = await review(pack, candidate);
    log(`partner review #${i}: score ${verdict.score}/10${verdict.pass ? " ✓" : ""}`);
    if (verdict.score > best.score) best = { map: candidate, score: verdict.score };
    if (verdict.pass || i === maxIterations) break;
    candidate = await synthesize(pack, reads, verdict.issues);
  }

  return { map: best.map, meta: { reads: reads.length, reviewScore: best.score, iterations } };
}
