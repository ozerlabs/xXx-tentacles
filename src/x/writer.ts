/**
 * `npm run x:write` — the ONE write seam. Everything else in this repo is
 * read-only; this is the only place that puts something onto X.
 *
 * Design constraint (from the user): don't pop a browser window every time we
 * post. So posting is pure HTTP — we replay X's own `CreateTweet` GraphQL
 * mutation through Playwright's `request` context, which carries the saved
 * session cookies but launches NO browser window at all.
 *
 * One mutation covers all three actions:
 *   • post   — tweet_text only
 *   • reply  — tweet_text + reply.in_reply_to_tweet_id
 *   • quote  — tweet_text + attachment_url (the quoted tweet's URL)
 *
 * The catch: `CreateTweet`'s queryId and `features` blob rotate, and recon only
 * ever sees GETs (nothing composes a tweet while it listens). So we LEARN the
 * mutation once — `x:write capture` opens the browser a single time, you post by
 * hand, and we sniff the real queryId + features + variables into .x-write.json.
 * After that, post/reply/quote never open a browser again. Re-run capture only
 * if posting starts 4xx-ing (X rotated the operation).
 *
 *   npm run x:write capture                  # one-time: learn CreateTweet
 *   npm run x:write post  "text"             # browserless
 *   npm run x:write reply <tweetId>  "text"  # browserless
 *   npm run x:write quote <tweetUrl> "text"  # browserless
 *
 * Preview without sending — note the `--` so npm forwards the flag to the script:
 *   npm run x:write post "text" -- --dry     # (a bare `--dry` also fails safe)
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "playwright";
import { launch, SESSION_PATH } from "./session.js";

/** What we learned about CreateTweet, once. Gitignored — it carries auth bits. */
const WRITE_PATH = ".x-write.json";
/** Append-only log of what we actually put on X. Distinct from the dry-run fixtures. */
const POSTED_LOG = "buffer/posted-live.jsonl";

interface WriteRecipe {
  queryId: string;
  /** The full variables object from a real CreateTweet — used as a template. */
  variables: Record<string, unknown>;
  /** The full features object from a real CreateTweet — sent verbatim. */
  features: Record<string, unknown>;
  /** fieldToggles, if the client sent any. */
  fieldToggles?: Record<string, unknown>;
  /** Bearer token harvested from the live request's Authorization header. */
  bearer: string;
  /** True if X attached an x-client-transaction-id — a heads-up for replay. */
  sawTransactionId: boolean;
  capturedAt: string;
  handle: string;
}

// ── tiny ansi ────────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── capture: learn CreateTweet once, by watching a real post ─────────────────
async function capture(): Promise<void> {
  const { browser, page, handle } = await launch(true);

  let recipe: WriteRecipe | null = null;

  page.on("request", (req) => {
    if (recipe) return;
    const url = req.url();
    if (!url.includes("/i/api/graphql/") || !url.includes("/CreateTweet")) return;
    const m = url.match(/\/graphql\/([^/]+)\/CreateTweet/);
    if (!m) return;
    let body: { variables?: unknown; features?: unknown; fieldToggles?: unknown } = {};
    try {
      body = JSON.parse(req.postData() ?? "{}");
    } catch {
      return;
    }
    const headers = req.headers();
    recipe = {
      queryId: m[1],
      variables: (body.variables ?? {}) as Record<string, unknown>,
      features: (body.features ?? {}) as Record<string, unknown>,
      fieldToggles: body.fieldToggles as Record<string, unknown> | undefined,
      bearer: headers["authorization"] ?? "",
      sawTransactionId: Boolean(headers["x-client-transaction-id"]),
      capturedAt: new Date().toISOString(),
      handle,
    };
    console.log(green(`\n  ✓ Caught CreateTweet  ${dim(`(${m[1]})`)}`));
  });

  console.clear();
  console.log(bold("\n  xXx-tentacles  ·  learn the write path (one time)"));
  console.log(dim(`  Signed in as @${handle}.\n`));
  console.log("  Compose ONE tweet by hand in this window and hit Post.");
  console.log("  (Make it a real one you wanted to send — it won't be wasted.)");
  console.log(dim("  The moment it sends, we capture the mutation and close.\n"));

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" }).catch(() => {});

  // Wait up to 4 minutes for the user to post once.
  const deadline = Date.now() + 4 * 60_000;
  while (!recipe && Date.now() < deadline) await sleep(500);
  await sleep(1200); // let the request settle
  await browser.close();

  if (!recipe) {
    throw new Error("Didn't see a CreateTweet in time. Run `npm run x:write capture` again and post once.");
  }

  writeFileSync(WRITE_PATH, JSON.stringify(recipe, null, 2));
  console.log(green(`\n  ✓ Learned the write path → ${WRITE_PATH}`));
  if ((recipe as WriteRecipe).sawTransactionId) {
    console.log(
      dim(
        "  Note: X attached an x-client-transaction-id to that post. If browserless\n" +
          "  replay starts getting 4xx, that per-request token is the likely reason."
      )
    );
  }
  console.log(dim("\n  You're set. From here on:  npm run x:write post \"...\"\n"));
}

// ── replay: post / reply / quote over pure HTTP, no browser ──────────────────
function loadRecipe(): WriteRecipe {
  if (!existsSync(WRITE_PATH)) {
    throw new Error("Haven't learned the write path yet. Run `npm run x:write capture` once.");
  }
  return JSON.parse(readFileSync(WRITE_PATH, "utf8"));
}

/** Pull a cookie value straight out of the saved storageState. */
function cookieFromSession(name: string): string {
  const state = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
  const c = (state.cookies ?? []).find((x: { name: string }) => x.name === name);
  if (!c?.value) throw new Error(`Cookie ${name} not in ${SESSION_PATH} — re-run \`npm run x:login\`.`);
  return c.value;
}

type Mode = { kind: "post" } | { kind: "reply"; inReplyTo: string } | { kind: "quote"; url: string };

/** Build CreateTweet variables from the captured template, swapping in our content. */
function buildVariables(recipe: WriteRecipe, text: string, mode: Mode): Record<string, unknown> {
  // Start from the real template so we inherit whatever shape X currently expects.
  const vars: Record<string, unknown> = JSON.parse(JSON.stringify(recipe.variables));
  vars.tweet_text = text;
  // The template came from one real post; strip its reply/quote so a plain post
  // doesn't accidentally inherit them.
  delete vars.reply;
  delete vars.attachment_url;
  if (mode.kind === "reply") {
    vars.reply = { in_reply_to_tweet_id: mode.inReplyTo, exclude_reply_user_ids: [] };
  } else if (mode.kind === "quote") {
    vars.attachment_url = mode.url;
  }
  return vars;
}

async function send(text: string, mode: Mode, dry: boolean): Promise<void> {
  if (!text.trim()) throw new Error("Empty tweet text.");
  if (text.length > 280) {
    throw new Error(`Tweet is ${text.length} chars (limit 280). Trim it.`);
  }
  const recipe = loadRecipe();
  const ct0 = cookieFromSession("ct0");
  const variables = buildVariables(recipe, text, mode);
  const url = `https://x.com/i/api/graphql/${recipe.queryId}/CreateTweet`;
  const payload: Record<string, unknown> = { variables, features: recipe.features, queryId: recipe.queryId };
  if (recipe.fieldToggles) payload.fieldToggles = recipe.fieldToggles;

  const label =
    mode.kind === "post" ? "post" : mode.kind === "reply" ? `reply → ${mode.inReplyTo}` : `quote → ${mode.url}`;

  if (dry) {
    console.log(bold(`\n  [dry] ${label}`));
    console.log(`  ${dim(text)}`);
    console.log(dim(`\n  POST ${url}`));
    console.log(dim(`  variables: ${JSON.stringify(variables)}`));
    console.log(dim("\n  (nothing sent)\n"));
    return;
  }

  const ctx = await request.newContext({ storageState: SESSION_PATH });
  const res = await ctx.post(url, {
    headers: {
      authorization: recipe.bearer,
      "x-csrf-token": ct0,
      "content-type": "application/json",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      accept: "*/*",
      origin: "https://x.com",
      referer: "https://x.com/home",
    },
    data: payload,
  });

  const status = res.status();
  const bodyText = await res.text();
  await ctx.dispose();

  // CRITICAL: X returns HTTP 200 even when the post FAILS — the body carries an
  // `errors` array and no tweet result. So a 2xx is NOT success on its own. The
  // only proof a tweet was created is a real rest_id in the response.
  let json: any;
  try {
    json = JSON.parse(bodyText);
  } catch {
    /* non-JSON body — treated as failure below */
  }
  const restId: string | undefined = json?.data?.create_tweet?.tweet_results?.result?.rest_id;
  const apiErrors: { message?: string }[] | undefined = json?.errors;

  if (status < 200 || status >= 300 || !restId) {
    console.log(red(`\n  ✗ ${label} did NOT post — HTTP ${status}, no tweet id returned`));
    const detail = apiErrors?.length ? apiErrors.map((e) => e.message ?? JSON.stringify(e)).join("; ") : bodyText.slice(0, 500);
    console.log(dim(`  ${detail}\n`));
    if (status === 401 || status === 403) {
      console.log(
        dim(
          "  Session likely expired or X rotated CreateTweet. Try `npm run x:write capture`\n" +
            "  to relearn, or `npm run x:login` if cookies are stale.\n"
        )
      );
    }
    process.exitCode = 1;
    return;
  }

  const link = `https://x.com/${recipe.handle}/status/${restId}`;

  appendFileSync(
    POSTED_LOG,
    JSON.stringify({ at: new Date().toISOString(), kind: mode.kind, text, mode, restId, link }) + "\n"
  );

  console.log(green(`\n  ✓ ${label}`));
  console.log(`  ${dim(text)}`);
  console.log(`  ${link}\n`);
}

// ── cli ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  // `--dry` is honored three ways, because `npm run … --dry` does NOT reach argv:
  // npm rewrites it to its own `--dry-run`, which surfaces as npm_config_dry_run.
  // Honoring that env var means a stray `--dry` fails SAFE instead of posting.
  const dry =
    argv.includes("--dry") || process.env.npm_config_dry_run === "true" || process.env.DRY === "1";
  const args = argv.filter((a) => a !== "--dry");
  const cmd = args[0];

  if (cmd === "capture") {
    await capture();
    return;
  }
  if (cmd === "post") {
    const text = args[1];
    if (!text) throw new Error('Usage: npm run x:write post "your tweet"');
    await send(text, { kind: "post" }, dry);
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
      bold("  npm run x:write — the one write seam (browserless after capture)"),
      "",
      "  npm run x:write capture                  one-time: learn CreateTweet",
      '  npm run x:write post  "text"             post',
      '  npm run x:write reply <tweetId>  "text"  reply',
      '  npm run x:write quote <tweetUrl> "text"  quote-tweet',
      "",
      "  add --dry to preview the exact request without sending",
      "",
    ].join("\n")
  );
}

main().catch((err) => {
  console.error(red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
