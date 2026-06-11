/**
 * `npm run x:recon` — READ-ONLY reconnaissance of X's internal API.
 *
 * Opens your saved session, browses like a human (scroll, navigate, pause), and
 * listens to the network. Every internal GraphQL call X's own page makes —
 * operation name, query id, variables, and the full JSON response — gets saved
 * to .x-recon/. That single pass gives us two things at once:
 *
 *   1. the DATA (your followers, tweets, timeline — already parsed JSON), and
 *   2. the MAP of the API (which operations exist, what they expect) — so the
 *      real crawler learns the API instead of hardcoding query ids that rot.
 *
 * Nothing is posted. We only open pages and read what the app fetches.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Request } from "playwright";
import { launch } from "./session.js";

const OUT = ".x-recon";
const RESP_DIR = `${OUT}/responses`;

// ── human pacing ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A randomized pause, so our rhythm doesn't look like a metronome. */
const humanPause = (minMs: number, maxMs: number) => sleep(minMs + Math.random() * (maxMs - minMs));

// ── what we learn about each operation ───────────────────────────────────────────
interface OpRecord {
  operation: string;
  queryId: string;
  method: string;
  /** how many times we saw it this run */
  count: number;
  /** last variables / features we saw it called with — the call template */
  lastVariables?: unknown;
  lastFeatures?: unknown;
}

/** Pull { queryId, operation } out of …/graphql/<queryId>/<Operation>?… */
function parseGraphql(url: string): { queryId: string; operation: string } | null {
  const m = url.match(/\/graphql\/([^/]+)\/([^/?]+)/);
  return m ? { queryId: m[1], operation: m[2] } : null;
}

/** GraphQL GETs carry variables/features as JSON in the query string. */
function readParam(url: string, key: string): unknown {
  try {
    const raw = new URL(url).searchParams.get(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function variablesFromRequest(req: Request): unknown {
  if (req.method() === "GET") return readParam(req.url(), "variables");
  try {
    return JSON.parse(req.postData() ?? "{}").variables;
  } catch {
    return undefined;
  }
}
function featuresFromRequest(req: Request): unknown {
  if (req.method() === "GET") return readParam(req.url(), "features");
  try {
    return JSON.parse(req.postData() ?? "{}").features;
  } catch {
    return undefined;
  }
}

async function main() {
  mkdirSync(RESP_DIR, { recursive: true });

  const ops = new Map<string, OpRecord>();
  /** auth bits we'll need to replay calls later (kept only in gitignored .x-recon) */
  let bearer: string | undefined;
  let csrf: string | undefined;
  let saved = 0;

  // Headed by default (we browse like a human). Scheduled cycles set
  // RECON_HEADLESS=1 so the 3×/day capture runs windowless.
  const headed = process.env.RECON_HEADLESS !== "1";
  const { browser, page, handle } = await launch(headed);

  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/i/api/graphql/")) return;
    const parsed = parseGraphql(url);
    if (!parsed) return;
    const { queryId, operation } = parsed;

    const req = resp.request();
    const headers = req.headers();
    bearer ??= headers["authorization"];
    csrf ??= headers["x-csrf-token"];

    const rec = ops.get(operation) ?? { operation, queryId, method: req.method(), count: 0 };
    rec.queryId = queryId;
    rec.count += 1;
    rec.lastVariables = variablesFromRequest(req);
    rec.lastFeatures = featuresFromRequest(req);
    ops.set(operation, rec);

    // Save the response body — this is the actual data + real response shape.
    try {
      const body = await resp.json();
      const file = `${RESP_DIR}/${operation}-${String(rec.count).padStart(3, "0")}.json`;
      writeFileSync(file, JSON.stringify(body, null, 2));
      saved += 1;
      console.log(`  ↓ ${operation}  ${dim(`(${queryId})`)}`);
    } catch {
      /* not JSON, or body already consumed — fine, we still logged the op */
    }
  });

  console.clear();
  console.log(bold("\n  xXx-tentacles  ·  X recon (read-only)"));
  console.log(dim(`  Signed in as @${handle}. Browsing like a human — don't touch the window.\n`));

  // A gentle human browse. Each stop triggers a different family of API calls,
  // which the listener above captures. Randomized scrolls + pauses throughout.
  await visit(page, "https://x.com/home", "home timeline", 5);
  await visit(page, `https://x.com/${handle}`, "your profile + posts", 4);
  await visit(page, `https://x.com/${handle}/followers`, "your followers", 4);
  await visit(page, `https://x.com/${handle}/following`, "your following", 4);

  // Settle, then snapshot what we learned.
  await humanPause(1500, 3000);
  await browser.close();

  const manifest = {
    handle,
    capturedAt: new Date().toISOString(),
    auth: { bearer, csrf },
    operations: Object.fromEntries([...ops.values()].map((o) => [o.operation, o])),
  };
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));

  console.log(bold(`\n  ✓ Captured ${ops.size} distinct operations, ${saved} responses.`));
  console.log(dim(`  → ${OUT}/manifest.json  (the API map)`));
  console.log(dim(`  → ${RESP_DIR}/         (the data + real response shapes)\n`));
  for (const o of [...ops.values()].sort((a, b) => b.count - a.count)) {
    console.log(`    ${o.operation.padEnd(28)} ${dim(`×${o.count}`)}`);
  }
  console.log("");
}

/** Navigate, then scroll a few times with human-ish pauses to draw out more calls. */
async function visit(page: import("playwright").Page, url: string, label: string, scrolls: number) {
  console.log(bold(`  → ${label}`));
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await humanPause(2500, 4500);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 1200 + Math.random() * 1600);
    await humanPause(1800, 4200);
  }
}

// ── tiny ansi ────────────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
