/**
 * `npm run x:write` — the ONE write seam. Everything else in this repo is
 * read-only; this is the only place that puts something onto X.
 *
 * WHY A HEADLESS BROWSER (not raw HTTP):
 * We first tried replaying the CreateTweet GraphQL mutation over pure HTTP. It
 * works just often enough to be a trap — X soon flags it (error 226, "this
 * request looks like it might be automated") because the call is missing the
 * `x-client-transaction-id` and other signals that only X's own JavaScript mints
 * in a real page. So instead we drive a HEADLESS browser page (no visible window,
 * so it still honors "don't pop a browser every time"): X's JS builds every
 * signal, the post looks legitimate, and we sniff the page's own CreateTweet
 * RESPONSE to confirm the real tweet id. Posting needs ONLY the login session —
 * no captured queryId/features/bearer.
 *
 * One flow per action:
 *   • post   — compose a new tweet
 *   • reply  — open the target tweet, reply in its composer
 *   • quote  — open the target tweet, Quote it
 *
 *   npm run x:write post  "text"
 *   npm run x:write reply <tweetId>  "text"
 *   npm run x:write quote <tweetUrl> "text"
 *
 * Preview without sending (note the `--` so npm forwards the flag):
 *   npm run x:write post "text" -- --dry     # (a bare `--dry` also fails safe)
 *
 * Set HEADED=1 to watch the window (debugging, or if headless ever gets flagged).
 */
import { appendFileSync } from "node:fs";
import type { Page } from "playwright";
import { launch } from "./session.js";

/** Append-only log of what we actually put on X. Distinct from the v1 dry-run fixtures. */
const POSTED_LOG = "buffer/posted-live.jsonl";

// ── tiny ansi ────────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mode = { kind: "post" } | { kind: "reply"; inReplyTo: string } | { kind: "quote"; url: string };

/** What we learn by sniffing the page's own CreateTweet response. */
type SendOutcome = { restId: string } | { errors: string } | null;

/** Type into X's contenteditable composer (page.fill doesn't work on it). */
async function typeInComposer(page: Page, text: string): Promise<void> {
  const box = page.locator('[data-testid="tweetTextarea_0"]').first();
  await box.waitFor({ timeout: 30_000 });
  await box.click();
  await page.keyboard.type(text, { delay: 18 });
}

/** Click whichever Post/Reply submit button is present and enabled. */
async function clickPost(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]').first();
  await btn.waitFor({ timeout: 15_000 });
  // Give X a beat to enable the button after the text registers.
  for (let i = 0; i < 20 && (await btn.isDisabled().catch(() => false)); i++) await sleep(150);
  await btn.click();
}

/** Drive the right UI flow for the action, then type + submit. */
async function compose(page: Page, text: string, mode: Mode): Promise<void> {
  if (mode.kind === "post") {
    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
    await typeInComposer(page, text);
    await clickPost(page);
  } else if (mode.kind === "reply") {
    await page.goto(`https://x.com/i/status/${mode.inReplyTo}`, { waitUntil: "domcontentloaded" });
    await typeInComposer(page, text); // the reply box is the top composer on a status page
    await clickPost(page);
  } else {
    await page.goto(mode.url, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="retweet"]').first().click({ timeout: 30_000 });
    await page.getByRole("menuitem").filter({ hasText: "Quote" }).first().click({ timeout: 10_000 });
    await typeInComposer(page, text);
    await clickPost(page);
  }
}

async function send(text: string, mode: Mode, dry: boolean): Promise<void> {
  if (!text.trim()) throw new Error("Empty tweet text.");
  if (text.length > 280) throw new Error(`Tweet is ${text.length} chars (limit 280). Trim it.`);

  const label =
    mode.kind === "post" ? "post" : mode.kind === "reply" ? `reply → ${mode.inReplyTo}` : `quote → ${mode.url}`;

  if (dry) {
    console.log(bold(`\n  [dry] ${label}`));
    console.log(`  ${dim(text)}`);
    console.log(dim("\n  (nothing sent — would drive a headless composer)\n"));
    return;
  }

  const headed = process.env.HEADED === "1";
  const { browser, page, handle } = await launch(headed);

  // Sniff the page's OWN CreateTweet response — that's the real tweet id (or the
  // real error). The page mints the transaction-id, so this call isn't flagged.
  let outcome: SendOutcome = null;
  page.on("response", async (resp) => {
    if (outcome || !resp.url().includes("/CreateTweet")) return;
    try {
      const j: any = await resp.json();
      const rid = j?.data?.create_tweet?.tweet_results?.result?.rest_id;
      if (rid) outcome = { restId: rid };
      else if (j?.errors?.length) outcome = { errors: j.errors.map((e: any) => e.message ?? JSON.stringify(e)).join("; ") };
    } catch {
      /* not JSON — ignore */
    }
  });

  try {
    await compose(page, text, mode);
    // Wait for the CreateTweet round-trip (or a timeout).
    const deadline = Date.now() + 30_000;
    while (!outcome && Date.now() < deadline) await sleep(300);
  } catch (err) {
    await browser.close();
    console.log(red(`\n  ✗ ${label} — couldn't drive the composer: ${(err as Error).message}`));
    console.log(dim("  If the page showed a login wall, your session expired — run `npm run x:login`.\n"));
    process.exitCode = 1;
    return;
  }
  await browser.close();

  // Snapshot through a cast: the assignments above happen inside the response
  // callback, so TS control-flow would otherwise narrow `outcome` to null.
  const result = outcome as { restId: string } | { errors: string } | null;
  if (!result) {
    console.log(red(`\n  ✗ ${label} — no CreateTweet response seen (post may not have submitted).`));
    console.log(dim("  Re-run with HEADED=1 to watch what happened.\n"));
    process.exitCode = 1;
    return;
  }
  if ("errors" in result) {
    console.log(red(`\n  ✗ ${label} did NOT post — X returned: ${result.errors}`));
    console.log("");
    process.exitCode = 1;
    return;
  }

  const link = `https://x.com/${handle}/status/${result.restId}`;
  appendFileSync(
    POSTED_LOG,
    JSON.stringify({ at: new Date().toISOString(), kind: mode.kind, text, mode, restId: result.restId, link }) + "\n"
  );
  console.log(green(`\n  ✓ ${label}`));
  console.log(`  ${dim(text)}`);
  console.log(`  ${link}\n`);
}

// ── cli ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  // `--dry` is honored three ways, because `npm run … --dry` does NOT reach argv:
  // npm rewrites it to its own `--dry-run`, surfacing as npm_config_dry_run.
  // Honoring that env var means a stray `--dry` fails SAFE instead of posting.
  const dry = argv.includes("--dry") || process.env.npm_config_dry_run === "true" || process.env.DRY === "1";
  const args = argv.filter((a) => a !== "--dry");
  const cmd = args[0];

  if (cmd === "post") {
    if (!args[1]) throw new Error('Usage: npm run x:write post "your tweet"');
    await send(args[1], { kind: "post" }, dry);
    return;
  }
  if (cmd === "reply") {
    const [, inReplyTo, text] = args;
    if (!inReplyTo || !text) throw new Error('Usage: npm run x:write reply <tweetId> "your reply"');
    await send(text, { kind: "reply", inReplyTo }, dry);
    return;
  }
  if (cmd === "quote") {
    const [, url, text] = args;
    if (!url || !text) throw new Error('Usage: npm run x:write quote <tweetUrl> "your comment"');
    await send(text, { kind: "quote", url }, dry);
    return;
  }

  console.log(
    [
      "",
      bold("  npm run x:write — the one write seam (headless, no visible window)"),
      "",
      '  npm run x:write post  "text"             post',
      '  npm run x:write reply <tweetId>  "text"  reply',
      '  npm run x:write quote <tweetUrl> "text"  quote-tweet',
      "",
      "  add  -- --dry  to preview without sending · HEADED=1 to watch the window",
      "",
    ].join("\n")
  );
}

main().catch((err) => {
  console.error(red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
