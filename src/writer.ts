import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ShowPlanSchema, type Slot, type PostedItem } from "./schema.js";
import { DryRunTransport, XApiTransport, type Transport } from "./transport.js";

// ── config ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const PLAN_PATH = args.find((a) => !a.startsWith("--")) ?? "showplan.json";

if (!existsSync(PLAN_PATH)) {
  console.error(`✗ No show plan at ${PLAN_PATH}. Run the Show Runner first:  npm run showrun`);
  process.exit(1);
}

// ── pretty-printing ────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ── scheduling ─────────────────────────────────────────────────────────────────
const WEEKDAY: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Peak engagement hour by beat type — when the timeline is hottest for it. */
const PEAK_HOUR: Record<string, number> = {
  hot_take: 8,
  manufactured_beef: 12,
  reply_bait: 17,
  callback_bit: 13,
  flex: 19,
  contrarian_thread: 18,
  vulnerable_arc: 21,
};

/** Next calendar date for a weekday label like "Mon", at the beat's peak hour. */
function scheduleFor(day: string, type: string, fallbackIdx: number): Date {
  const now = new Date();
  const key = day.trim().slice(0, 3).toLowerCase();
  const target = WEEKDAY[key];
  const d = new Date(now);

  if (target === undefined) {
    // Unrecognized label — just stagger one per day from tomorrow.
    d.setDate(now.getDate() + fallbackIdx + 1);
  } else {
    const delta = (target - now.getDay() + 7) % 7 || 7; // always the upcoming one
    d.setDate(now.getDate() + delta);
  }
  d.setHours(PEAK_HOUR[type] ?? 11, 0, 0, 0);
  return d;
}

const fmt = (d: Date) =>
  d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ── the run ──────────────────────────────────────────────────────────────────
async function main() {
  const transport: Transport = LIVE ? new XApiTransport() : new DryRunTransport();

  console.clear();
  console.log(bold("\n  xXx-tentacles  ·  Tentacle 3 — the Writer"));
  console.log(`  ${LIVE ? red(transport.label) : dim(transport.label)}\n`);

  const plan = ShowPlanSchema.parse(JSON.parse(readFileSync(PLAN_PATH, "utf8")));
  console.log(dim(`  Arc: ${plan.arc}\n`));

  // Schedule, then sort chronologically so the week reads in order.
  const scheduled = plan.slots
    .map((slot: Slot, i: number) => ({ slot, when: scheduleFor(slot.day, slot.type, i) }))
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  const log: PostedItem[] = [];

  for (const { slot, when } of scheduled) {
    const result = await transport.post(slot.chosen.text);
    log.push({
      day: slot.day,
      type: slot.type,
      topic: slot.topic,
      scheduled_for: when.toISOString(),
      text: slot.chosen.text,
      status: LIVE ? "posted (live)" : "posted (dry-run)",
      id: result.id,
      url: result.url,
      predicted_virality: slot.chosen.virality,
      on_voice: slot.chosen.on_voice,
    });

    console.log(`  ${green("✓")} ${cyan(fmt(when))}  ${dim(`${slot.type} · v${slot.chosen.virality}/10`)}`);
    console.log(`    ${slot.chosen.text.replace(/\n/g, "\n    ")}`);
    console.log(dim(`    → ${result.url}\n`));
  }

  writeFileSync("posted.json", JSON.stringify(log, null, 2));
  console.log(dim(`  ${log.length} posts ${LIVE ? "shipped" : "queued (dry-run)"} → posted.json`));
  if (!LIVE) console.log(dim(`  Nothing left your machine. Add X API creds + --live to ship for real.\n`));
}

main().catch((err) => {
  console.error(red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
