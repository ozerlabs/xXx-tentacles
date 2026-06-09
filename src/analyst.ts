import "dotenv/config";
import OpenAI from "openai";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ANALYST_PROMPT } from "./persona.js";
import { PostedItemSchema, ReflectionSchema, type ScoredPost, type Reflection } from "./schema.js";
import { z } from "zod";
import {
  SimulatedEngagement,
  XApiEngagement,
  engagementRate,
  rateToVirality,
  type EngagementSource,
} from "./engagement.js";

// ── config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const POSTED_PATH = args.find((a) => !a.startsWith("--")) ?? "posted.json";

if (!API_KEY) {
  console.error("✗ DEEPSEEK_API_KEY is missing. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (!existsSync(POSTED_PATH)) {
  console.error(`✗ No posted log at ${POSTED_PATH}. Run the Writer first:  npm run write`);
  process.exit(1);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com" });

// ── pretty-printing ────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ── the run ──────────────────────────────────────────────────────────────────
async function main() {
  const source: EngagementSource = LIVE ? new XApiEngagement() : new SimulatedEngagement();

  console.clear();
  console.log(bold("\n  xXx-tentacles  ·  Tentacle 4 — the Analyst"));
  console.log(`  ${LIVE ? red(source.label) : dim(source.label)}\n`);

  const posted = z.array(PostedItemSchema).parse(JSON.parse(readFileSync(POSTED_PATH, "utf8")));

  // 1. Pull the numbers and score them — in code, never the model.
  const scored: ScoredPost[] = [];
  for (const p of posted) {
    const engagement = await source.fetch(p);
    const rate = engagementRate(engagement);
    scored.push({
      id: p.id,
      type: p.type,
      topic: p.topic,
      text: p.text,
      predicted_virality: p.predicted_virality,
      engagement,
      engagement_rate: Math.round(rate * 100) / 100,
      actual_virality: rateToVirality(rate),
    });
  }

  // 2. Scoreboard, best first.
  const board = [...scored].sort((a, b) => b.engagement_rate - a.engagement_rate);
  console.log(dim("  SCOREBOARD (by engagement rate)\n"));
  for (const s of board) {
    const delta = s.actual_virality - s.predicted_virality;
    const tag = delta >= 1 ? green(`▲ beat call +${delta.toFixed(1)}`) : delta <= -1 ? red(`▼ missed ${delta.toFixed(1)}`) : dim("≈ on call");
    console.log(`  ${cyan(s.type.padEnd(18))} ${bold(`${s.engagement_rate.toFixed(1)}%`)}  ${dim(`${k(s.engagement.impressions)} imp · ${k(s.engagement.likes)}♥ · ${k(s.engagement.replies)}↩`)}  ${tag}`);
  }

  // 3. Reflexion: hand the model the numbers, get directives back.
  console.log(dim("\n  The manager reviews the tape...\n"));
  const reflection = await reflect(scored);

  console.log(`  ${bold("VERDICT:")} ${reflection.summary}\n`);
  console.log(`  ${green("DOUBLE DOWN:")} ${reflection.directives.double_down.join(" · ")}`);
  console.log(`  ${red("CUT:")} ${reflection.directives.cut.join(" · ")}`);
  console.log(`  ${cyan("NEXT WEEK:")} ${reflection.next_week_focus}\n`);

  // 4. Write the feedback the Show Runner will read next cycle.
  writeFileSync("learnings.json", JSON.stringify(reflection, null, 2));
  writeFileSync("analytics.json", JSON.stringify(scored, null, 2));
  console.log(dim(`  Feedback saved → learnings.json (steers next week) · analytics.json (raw scores)`));
  console.log(dim(`  Loop closed: run 'npm run showrun' again — it now plans against these learnings.\n`));
}

async function reflect(scored: ScoredPost[], retries = 2): Promise<Reflection> {
  const user = `WEEK SCOREBOARD (ground truth — interpret, do not invent):\n${JSON.stringify(
    scored.map((s) => ({
      type: s.type,
      topic: s.topic,
      predicted_virality: s.predicted_virality,
      actual_virality: s.actual_virality,
      engagement_rate_pct: s.engagement_rate,
      engagement: s.engagement,
    })),
    null,
    2
  )}`;

  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: ANALYST_PROMPT },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7, // analysis wants less chaos than writing
      });
      return ReflectionSchema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

main().catch((err) => {
  console.error(red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
