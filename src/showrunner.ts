import "dotenv/config";
import OpenAI from "openai";
import type { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SHOW_PLANNER_PROMPT, ANGLE_TREE_PROMPT } from "./persona.js";
import {
  DossierSchema,
  WeekPlanSchema,
  BeatDraftSchema,
  type Dossier,
  type Beat,
  type Slot,
  type ShowPlan,
} from "./schema.js";

// ── config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const DOSSIER_PATH = process.argv[2] ?? "dossier.json";

if (!API_KEY) {
  console.error("✗ DEEPSEEK_API_KEY is missing. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (!existsSync(DOSSIER_PATH)) {
  console.error(`✗ No dossier at ${DOSSIER_PATH}. Run the Interrogator first:  npm run interrogate`);
  process.exit(1);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com" });

// ── pretty-printing ────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ── helpers ──────────────────────────────────────────────────────────────────
type Msg = OpenAI.Chat.ChatCompletionMessageParam;

/**
 * Call the model and validate against a schema. DeepSeek occasionally returns
 * malformed JSON at high temperature, so retry on parse/validation failure
 * rather than dropping the result.
 */
async function callJSON<T>(
  system: string,
  user: string,
  temperature: number,
  schema: z.ZodType<T>,
  retries = 2
): Promise<T> {
  const messages: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature,
      });
      return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Tree-of-Thoughts for one beat: branches → scored → spiciest on-voice pick. */
async function draftBeat(dossier: Dossier, beat: Beat, arc: string): Promise<Slot> {
  const brief = [
    `WEEK ARC: ${arc}`,
    `BEAT: day=${beat.day} type=${beat.type}`,
    `TOPIC: ${beat.topic}`,
    `INTENT: ${beat.intent}`,
    `CLIENT DOSSIER:\n${JSON.stringify(dossier, null, 2)}`,
  ].join("\n\n");

  const draft = await callJSON(ANGLE_TREE_PROMPT, brief, 1.2, BeatDraftSchema);
  const idx = Math.min(draft.chosen_index, draft.candidates.length - 1);
  const chosen = draft.candidates[idx];
  const alternates = draft.candidates.filter((_, i) => i !== idx);

  return { ...beat, chosen, alternates, reasoning: draft.reasoning };
}

// ── the run ──────────────────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log(bold("\n  xXx-tentacles  ·  Tentacle 2 — the Show Runner\n"));

  const dossier = DossierSchema.parse(JSON.parse(readFileSync(DOSSIER_PATH, "utf8")));
  console.log(dim(`  Client loaded → ${dossier.identity || "(unnamed)"}\n`));

  // Reflexion loop: if the Analyst has run, plan against last week's learnings.
  let learnings = "";
  if (existsSync("learnings.json")) {
    learnings = `\n\nLAST WEEK'S LEARNINGS — apply these, the numbers don't lie:\n${readFileSync("learnings.json", "utf8")}`;
    console.log(dim("  Found learnings.json — planning against last week's numbers."));
  }

  // 1. Plan the week (the arc + beats).
  console.log(dim("  Breaking the week..."));
  const week = await callJSON(
    SHOW_PLANNER_PROMPT,
    `CLIENT DOSSIER:\n${JSON.stringify(dossier, null, 2)}${learnings}`,
    1.0,
    WeekPlanSchema
  );

  console.log(`\n  ${bold("ARC:")} ${week.arc}`);
  console.log(dim(`  ${week.beats.length} beats. Rolling the writers' room...\n`));

  // 2. Tree-of-Thoughts each beat — in parallel.
  const slots = await Promise.all(
    week.beats.map((b) =>
      draftBeat(dossier, b, week.arc).catch((e) => {
        console.log(red(`  ✗ ${b.day} ${b.type} failed: ${e.message}`));
        return null;
      })
    )
  );
  const resolved = slots.filter((s): s is Slot => s !== null);

  // 3. Print the rundown.
  for (const s of resolved) {
    console.log(`  ${cyan(`${s.day} · ${s.type}`)}  ${dim(s.topic)}`);
    console.log(`  ${bold(s.chosen.text.replace(/\n/g, "\n  "))}`);
    console.log(
      dim(`  ↳ virality ${green(String(s.chosen.virality))}/10 · on-voice ${green(String(s.chosen.on_voice))}/10 · risk: ${s.chosen.risk}`)
    );
    console.log(dim(`  ↳ beat over ${s.alternates.length} other angles\n`));
  }

  // 4. Save.
  const plan: ShowPlan = { arc: week.arc, slots: resolved };
  writeFileSync("showplan.json", JSON.stringify(plan, null, 2));
  console.log(dim(`  Show plan saved → showplan.json  (${resolved.length} posts ready)`));
  console.log(dim(`  Next: the Writer ships them; the Analyst watches what lands.\n`));
}

main().catch((err) => {
  console.error(red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
