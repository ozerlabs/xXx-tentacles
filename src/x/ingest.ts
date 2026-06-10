/**
 * `npm run x:ingest` — load the raw recon capture into the buffer.
 *
 * Reads every .x-recon/responses/*.json we already pulled and writes structured,
 * deduped rows into buffer/x.db. NO new requests to X — this just parses data
 * that's already on disk, so we can prove the schema against real responses
 * before building the live paginating crawler.
 *
 * Every row is stamped with the recon's capture time (from .x-recon/manifest.json),
 * so re-running this is idempotent and snapshots stack cleanly over time.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { Buffer } from "./db.js";
import { savedHandle } from "./session.js";
import {
  parseUser,
  usersFromResponse,
  tweetsFromResponse,
  trendsFromResponse,
  storiesFromResponse,
  recommendationsFromResponse,
} from "./parse.js";

const RECON_DIR = ".x-recon";
const RESP_DIR = `${RECON_DIR}/responses`;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function readManifest(): { handle?: string; capturedAt?: string } {
  try {
    return JSON.parse(readFileSync(`${RECON_DIR}/manifest.json`, "utf8"));
  } catch {
    return {};
  }
}

function main() {
  if (!existsSync(RESP_DIR)) {
    console.error(`✗ No recon data at ${RESP_DIR}. Run \`npm run x:recon\` first.`);
    process.exit(1);
  }

  const manifest = readManifest();
  const owner = manifest.handle ?? savedHandle() ?? "me";
  // Stamp every row with the capture time; fall back to "now" only if absent.
  const capturedAt = manifest.capturedAt ?? new Date().toISOString();

  const files = readdirSync(RESP_DIR).filter((f) => f.endsWith(".json"));
  const db = new Buffer({ capturedAt, ownerHandle: owner });

  const seen = { accounts: 0, tweets: 0, edges: 0, trends: 0, stories: 0, recs: 0 };

  db.tx(() => {
    for (const file of files) {
      const json = JSON.parse(readFileSync(`${RESP_DIR}/${file}`, "utf8"));

      if (file.startsWith("Followers-") || file.startsWith("Following-")) {
        const kind = file.startsWith("Followers-") ? "follower" : "following";
        for (const u of usersFromResponse(json)) {
          db.upsertUser(u);
          db.addEdge(owner, kind, u.rest_id);
          seen.accounts++;
          seen.edges++;
        }
      } else if (file.startsWith("UserTweets-") || file.startsWith("HomeTimeline-")) {
        const source = file.startsWith("UserTweets-") ? "user_tweets" : "home_timeline";
        for (const t of tweetsFromResponse(json)) {
          db.upsertTweet(t, source);
          seen.tweets++;
        }
      } else if (file.startsWith("UserByScreenName-")) {
        const u = parseUser(json?.data?.user?.result);
        if (u) {
          db.upsertUser(u);
          seen.accounts++;
        }
      } else if (file.startsWith("ExploreSidebar-")) {
        for (const t of trendsFromResponse(json)) {
          db.addTrend(t);
          seen.trends++;
        }
      } else if (file.startsWith("useStoryTopicQuery-")) {
        for (const s of storiesFromResponse(json)) {
          db.addStory(s);
          seen.stories++;
        }
      } else if (file.startsWith("SidebarUserRecommendations-")) {
        for (const r of recommendationsFromResponse(json)) {
          db.addRecommendation(r);
          seen.recs++;
        }
      }
    }
  });

  const c = db.counts();
  db.close();

  console.log(bold(`\n  ✓ Ingested ${files.length} response files into buffer/x.db`));
  console.log(dim(`    snapshot ${capturedAt} · owner @${owner}`));
  console.log(
    dim(
      `    (parsed ${seen.accounts} account, ${seen.tweets} tweet, ${seen.edges} edge, ` +
        `${seen.trends} trend, ${seen.stories} story, ${seen.recs} rec rows — deduped)`
    )
  );
  console.log(bold("\n  Buffer now holds:"));
  console.log(`    accounts         ${c.accounts}`);
  console.log(`    tweets           ${c.tweets}`);
  console.log(`    followers        ${c.followers}`);
  console.log(`    following        ${c.following}`);
  console.log(`    trends           ${c.trends}`);
  console.log(`    stories          ${c.stories}`);
  console.log(`    recommendations  ${c.recommendations}\n`);
}

main();
