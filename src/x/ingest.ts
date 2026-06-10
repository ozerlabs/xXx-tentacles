/**
 * `npm run x:ingest` — load the raw recon capture into the buffer.
 *
 * Reads every .x-recon/responses/*.json we already pulled and writes structured,
 * deduped rows into buffer/x.db. NO new requests to X — this just parses data
 * that's already on disk, so we can prove the schema against real responses
 * before building the live paginating crawler.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { Buffer } from "./db.js";
import { savedHandle } from "./session.js";
import {
  parseUser,
  usersFromResponse,
  tweetsFromResponse,
} from "./parse.js";

const RESP_DIR = ".x-recon/responses";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function main() {
  if (!existsSync(RESP_DIR)) {
    console.error(`✗ No recon data at ${RESP_DIR}. Run \`npm run x:recon\` first.`);
    process.exit(1);
  }
  const owner = savedHandle() ?? "me";
  const files = readdirSync(RESP_DIR).filter((f) => f.endsWith(".json"));
  const db = new Buffer();

  let users = 0,
    tweets = 0,
    edges = 0;

  db.tx(() => {
    for (const file of files) {
      const json = JSON.parse(readFileSync(`${RESP_DIR}/${file}`, "utf8"));

      if (file.startsWith("Followers-") || file.startsWith("Following-")) {
        const kind = file.startsWith("Followers-") ? "follower" : "following";
        for (const u of usersFromResponse(json)) {
          db.upsertUser(u);
          db.addEdge(owner, kind, u.rest_id);
          users++;
          edges++;
        }
      } else if (file.startsWith("UserTweets-") || file.startsWith("HomeTimeline-")) {
        const source = file.startsWith("UserTweets-") ? "user_tweets" : "home_timeline";
        for (const t of tweetsFromResponse(json)) {
          db.upsertTweet(t, source);
          tweets++;
        }
      } else if (file.startsWith("UserByScreenName-")) {
        const u = parseUser(json?.data?.user?.result);
        if (u) {
          db.upsertUser(u);
          users++;
        }
      }
    }
  });

  const c = db.counts();
  db.close();

  console.log(bold(`\n  ✓ Ingested ${files.length} response files into buffer/x.db`));
  console.log(dim(`    (parsed ${users} user rows, ${tweets} tweet rows, ${edges} edges — deduped)`));
  console.log(bold("\n  Buffer now holds:"));
  console.log(`    users      ${c.users}`);
  console.log(`    tweets     ${c.tweets}`);
  console.log(`    followers  ${c.followers}`);
  console.log(`    following  ${c.following}\n`);
}

main();
