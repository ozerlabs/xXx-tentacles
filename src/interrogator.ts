import "dotenv/config";
import OpenAI from "openai";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileSync } from "node:fs";
import { SYSTEM_PROMPT } from "./persona.js";
import { TurnSchema, type Turn } from "./schema.js";

// ── config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const TARGET_CONFIDENCE = 10;
const MAX_QUESTIONS = 60; // safety valve so it can't drill forever

if (!API_KEY) {
  console.error("✗ DEEPSEEK_API_KEY is missing. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// DeepSeek is OpenAI-compatible — the SDK they officially recommend.
const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com" });

// ── pretty-printing ────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function bar(confidence: number): string {
  const filled = "█".repeat(confidence);
  const empty = "░".repeat(10 - confidence);
  return `${filled}${empty} ${confidence}/10`;
}

// ── one model turn ──────────────────────────────────────────────────────────────
type Msg = OpenAI.Chat.ChatCompletionMessageParam;

async function runTurn(messages: Msg[]): Promise<Turn> {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages,
    response_format: { type: "json_object" },
    temperature: 1.1, // mean and unpredictable, not a robot
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = TurnSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // Hand the model its own mistake and let it self-correct next loop.
    throw new Error(`Bad turn shape: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  // Keep the assistant's JSON in the transcript so it remembers the dossier.
  messages.push({ role: "assistant", content: raw });
  return parsed.data;
}

// ── the loop ──────────────────────────────────────────────────────────────────
async function main() {
  const rl = readline.createInterface({ input, output });

  console.clear();
  console.log(bold("\n  xXx-tentacles  ·  Tentacle 1 — the Interrogator\n"));
  console.log(dim("  Sit in the chair. Answer honestly — lying only wastes your own time.\n"));
  console.log(dim("  (type 'quit' to walk out)\n"));

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "[BEGIN INTERROGATION — open with your first question]" },
  ];

  let turn: Turn | null = null;
  let asked = 0;

  while (asked < MAX_QUESTIONS) {
    try {
      turn = await runTurn(messages);
    } catch (err) {
      // Nudge the model to retry with valid JSON, don't crash the session.
      console.log(dim(`  …(the manager mutters something incoherent, collecting himself)`));
      messages.push({ role: "user", content: "That wasn't valid json in the required shape. Respond again, json only." });
      continue;
    }

    if (turn.roast.trim()) console.log(`\n  ${red(turn.roast.trim())}`);
    console.log(dim(`\n  read: ${bar(turn.confidence)}`));

    if (turn.done || turn.confidence >= TARGET_CONFIDENCE || !turn.next_question) {
      break;
    }

    console.log(`\n  ${bold(turn.next_question.trim())}`);

    let answer: string;
    try {
      answer = await rl.question("\n  > ");
    } catch {
      // stdin closed / EOF (e.g. piped input ran out) — treat as walking out.
      answer = "quit";
    }

    if (answer.trim().toLowerCase() === "quit") {
      console.log(dim("\n  Walking out mid-interrogation. Your funeral.\n"));
      rl.close();
      return;
    }

    messages.push({ role: "user", content: answer });
    asked++;
  }

  rl.close();

  // ── verdict ───────────────────────────────────────────────────────────────────
  if (turn) {
    console.log(bold("\n\n  ───────────────  VERDICT  ───────────────\n"));
    console.log(`  ${turn.roast.trim() || "I get you now."}\n`);

    writeFileSync("dossier.json", JSON.stringify(turn.dossier, null, 2));
    console.log(dim(`  Dossier saved → dossier.json   (read: ${turn.confidence}/10)`));
    console.log(dim(`  Next: the other tentacles turn this into the show.\n`));
  }
}

main().catch((err) => {
  console.error(red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
