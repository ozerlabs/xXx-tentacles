/**
 * The X session seam — one logged-in browser, reused by every read-only crawl.
 *
 * We never automate the login form (handle, password, 2FA, "verify it's you").
 * Instead `npm run x:login` opens a real browser, you sign in by hand once, and
 * we save the cookies. Every later run reuses them — no credentials ever touch
 * this repo, and to X it's just your normal session.
 *
 * READ-ONLY: nothing here ever posts. We open the site and listen.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

/** Saved cookies / localStorage from a hand-done login. Gitignored. */
export const SESSION_PATH = ".x-session.json";
/** The signed-in account's @handle (no leading @), captured at login. Gitignored. */
export const ACCOUNT_PATH = ".x-account.json";

export interface XSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** The signed-in handle, without the leading @. */
  handle: string;
}

/**
 * Launch the *real* installed Chrome (not bundled Chromium) with the automation
 * flag turned off. Google's OAuth and X's bot checks flag the default automated
 * Chromium ("this browser may not be secure"); real Chrome + this arg dodges the
 * obvious tells. Falls back to bundled Chromium if Chrome isn't installed.
 */
async function launchChrome(headed: boolean): Promise<Browser> {
  const opts = {
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  try {
    return await chromium.launch({ ...opts, channel: "chrome" });
  } catch {
    return await chromium.launch(opts);
  }
}

/** True once `npm run x:login` has saved a session to reuse. */
export function hasSession(): boolean {
  return existsSync(SESSION_PATH);
}

/** The handle captured at login (no @), or null if not saved yet. */
export function savedHandle(): string | null {
  if (!existsSync(ACCOUNT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(ACCOUNT_PATH, "utf8")).handle ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the @handle off the page chrome. X exposes it on the profile nav link
 * as href="/<handle>". Returns null if we can't find it (e.g. not logged in yet).
 */
async function readHandle(page: Page): Promise<string | null> {
  const href = await page
    .locator('a[data-testid="AppTabBar_Profile_Link"]')
    .first()
    .getAttribute("href", { timeout: 15_000 })
    .catch(() => null);
  return href ? href.replace(/^\//, "").trim() || null : null;
}

/**
 * Interactive, one-time login. Opens a real window, lets you sign in by hand,
 * then waits for you to confirm in the terminal before saving the session.
 */
export async function login(): Promise<void> {
  const browser = await launchChrome(true);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("https://x.com/login");

  console.log("\n  A browser opened. Sign in to X by hand.");
  console.log("  Use your X username/email + password — NOT 'Sign in with Google'");
  console.log("  (Google blocks automated browsers). 2FA is fine.");
  console.log("  When you're fully on your home timeline, come back here.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("  Press Enter once you're signed in… ");
  rl.close();

  const handle = await readHandle(page);
  if (!handle) {
    await browser.close();
    throw new Error("Couldn't confirm you're signed in (no profile link found). Try `npm run x:login` again.");
  }

  await context.storageState({ path: SESSION_PATH });
  writeFileSync(ACCOUNT_PATH, JSON.stringify({ handle }, null, 2));
  await browser.close();

  console.log(`\n  ✓ Signed in as @${handle}. Session saved to ${SESSION_PATH}.`);
  console.log("  You can now run:  npm run x:recon\n");
}

/**
 * Launch Chromium with the saved session loaded.
 *
 * @param headed  show the window. True while we're building trust / browsing
 *                like a human; headless later for quiet background crawls.
 */
export async function launch(headed: boolean): Promise<XSession> {
  if (!hasSession()) {
    throw new Error("No saved X session. Run `npm run x:login` first to sign in once.");
  }
  const handle = savedHandle();
  if (!handle) {
    throw new Error("Session exists but no handle saved. Re-run `npm run x:login`.");
  }

  const browser = await launchChrome(headed);
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  return { browser, context, page, handle };
}
