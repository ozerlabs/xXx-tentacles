/**
 * `npm run x:cycle` — one turn of the growth loop's CAPTURE half.
 *
 * Runs recon (headless) → ingest, so every run appends a fresh snapshot to the
 * buffer's time series (tweet_metrics + account_history). Run it 3×/day on a
 * schedule and the buffer accumulates the history the Analyst/learnings loop
 * grades against — without this, we only ever see "now", never growth.
 *
 * This is the foundation rung. The next rung (the Proposer) reads the buffer this
 * fills and drafts posts + reply/quote targets for your approval — it does NOT
 * post on its own. Human-in-the-loop first.
 *
 * Schedule it (3×/day, your machine, because it needs your session + a browser).
 * Run `crontab -e` and add — adjust paths/times to taste (these are IST-ish):
 *
 *   30 9,14,20 * * *  cd /Users/gitarth/Documents/code/xXx-tentacles && /usr/local/bin/npm run x:cycle >> buffer/cron.log 2>&1
 *
 * (Find your npm path with `which npm`. Keep the machine awake at those times.)
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import Database from "better-sqlite3";
import { DB_PATH } from "./db.js";
import { hasSession, savedHandle } from "./session.js";

const TSX = "node_modules/.bin/tsx";
const CYCLE_LOG = "buffer/cycles.jsonl";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function step(label: string, script: string, env: Record<string, string> = {}): void {
  console.log(bold(`\n  ▸ ${label}`));
  execFileSync(TSX, [script], { stdio: "inherit", env: { ...process.env, ...env } });
}

function summarize(): void {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const owner = db.prepare("SELECT rest_id, screen_name FROM accounts WHERE is_owner=1").get() as
      | { rest_id: string; screen_name: string }
      | undefined;
    if (!owner) return;

    // Last two follower snapshots → the delta since the previous cycle.
    const hist = db
      .prepare(
        "SELECT captured_at, followers_count FROM account_history WHERE rest_id=? ORDER BY captured_at DESC LIMIT 2"
      )
      .all(owner.rest_id) as { captured_at: string; followers_count: number }[];

    const followers = hist[0]?.followers_count ?? 0;
    const delta = hist.length === 2 ? followers - hist[1].followers_count : null;
    const snapshots = (
      db.prepare("SELECT COUNT(DISTINCT captured_at) n FROM account_history WHERE rest_id=?").get(owner.rest_id) as {
        n: number;
      }
    ).n;
    const metricRows = (db.prepare("SELECT COUNT(*) n FROM tweet_metrics").get() as { n: number }).n;

    const deltaStr = delta === null ? "—" : delta >= 0 ? `+${delta}` : `${delta}`;
    console.log(green(`\n  ✓ cycle complete`));
    console.log(
      `  @${owner.screen_name}  ·  followers ${bold(String(followers))} (${deltaStr} since last cycle)  ·  ${snapshots} snapshots  ·  ${metricRows} metric rows`
    );

    appendFileSync(
      CYCLE_LOG,
      JSON.stringify({ at: new Date().toISOString(), followers, delta, snapshots, metricRows }) + "\n"
    );
  } finally {
    db.close();
  }
}

async function main() {
  if (!hasSession()) {
    console.error("\n✗ No saved X session. Run `npm run x:login` once first.\n");
    process.exit(1);
  }
  console.log(bold(`\n  xXx-tentacles · cycle  ${dim(`(@${savedHandle() ?? "?"})`)}`));

  step("capture — recon (headless)", "src/x/recon.ts", { RECON_HEADLESS: "1" });
  step("ingest — parse into buffer", "src/x/ingest.ts");
  summarize();
  console.log(dim(`\n  → growth tracked in ${CYCLE_LOG}. Next rung: the Proposer (drafts for your approval).\n`));
}

main().catch((err) => {
  console.error(`\n✗ cycle failed: ${err.message}\n`);
  process.exit(1);
});
