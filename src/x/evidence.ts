/**
 * STAGE 0 (Profiler) — THE EVIDENCE ROOM.
 *
 * The Analyst's Data Room computes performance numbers; this computes BEHAVIORAL
 * evidence — the raw material for figuring out *who someone is*. All in code:
 * their own words, what they amplify, who they follow, the niche the algorithm
 * assigns them. The LLM reads this; it never guesses at the facts.
 *
 * `buildEvidence()` returns the structured evidence; `evidencePack()` formats it
 * as a labeled string (the ACI input — never raw JSON).
 */
import Database from "better-sqlite3";
import { computeFactBase, type FactBase } from "./factbase.js";
import { DB_PATH } from "./db.js";

export interface Evidence {
  facts: FactBase;
  /** The subject's own posts (not retweets), newest first. */
  authored: { text: string; kind: "original" | "quote" | "reply" }[];
  /** What they retweet — the "RT @x: …" stubs. Signals taste/values. */
  amplified: string[];
  /** Who they follow (with bios) — tribe & aspiration. */
  following: { handle: string; followers: number | null; bio: string }[];
  /** Who the algorithm groups them with — perceived niche. */
  recs: { handle: string; name: string | null }[];
}

export function buildEvidence(path = DB_PATH): Evidence {
  const facts = computeFactBase(path);
  const db = new Database(path, { readonly: true });
  const all = (sql: string): any[] => db.prepare(sql).all();

  const authored = all(
    `SELECT text, is_reply, quoted_status_id FROM tweets
     WHERE source='user_tweets' AND is_retweet=0 AND text IS NOT NULL AND text!=''
     ORDER BY created_ts DESC LIMIT 40`
  ).map((r) => ({
    text: String(r.text).replace(/\n/g, " ").trim(),
    kind: r.is_reply ? "reply" : r.quoted_status_id ? "quote" : "original",
  })) as Evidence["authored"];

  const amplified = all(
    `SELECT text FROM tweets WHERE source='user_tweets' AND is_retweet=1 AND text IS NOT NULL ORDER BY created_ts DESC LIMIT 20`
  ).map((r) => String(r.text).replace(/\n/g, " ").trim());

  const following = all(
    `SELECT a.screen_name handle, a.followers_count followers, a.description bio
     FROM edges e JOIN accounts a ON a.rest_id = e.user_rest_id
     WHERE e.kind='following'
     ORDER BY a.followers_count DESC LIMIT 25`
  ).map((r) => ({ handle: r.handle, followers: r.followers, bio: (r.bio ?? "").replace(/\n/g, " ").trim() }));

  const recs = all("SELECT screen_name handle, name FROM recommendations LIMIT 12");

  db.close();
  return { facts, authored, amplified, following, recs };
}

/** A labeled evidence pack — well-documented input so the model reads, never guesses. */
export function evidencePack(e: Evidence): string {
  const f = e.facts;
  const o = f.owner;
  return [
    `=== THE SUBJECT ===`,
    `Name: ${o.name ?? "—"}  |  Handle: @${o.handle}`,
    `Bio: ${o.bioPresent ? JSON.stringify(o.bio) : "EMPTY (no bio set)"}`,
    `Account age: ${o.accountAgeYears?.toFixed(1) ?? "?"} yrs  |  ${o.followers} followers  |  ${o.following} following  |  ${o.posts} lifetime posts`,
    `Conversion: ${f.ratios.followersPerPost.toFixed(3)} followers per post  |  follower:following ${f.ratios.followerToFollowing.toFixed(2)}`,
    `Recent mix: ${f.sample.original} original, ${f.sample.quotes} quote-tweets, ${f.sample.replies} replies, ${f.sample.retweets} retweets`,
    ``,
    `=== THEIR OWN WORDS (authored posts, verbatim) ===`,
    ...e.authored.map((a, i) => `${i + 1}. [${a.kind.toUpperCase()}] ${a.text}`),
    ``,
    `=== WHAT THEY AMPLIFY (retweets — signals taste & values) ===`,
    ...e.amplified.map((t, i) => `${i + 1}. ${t}`),
    ``,
    `=== WHO THEY FOLLOW (tribe & aspiration — bios) ===`,
    ...e.following.map((u) => `@${u.handle} (${u.followers ?? "?"}) — ${u.bio || "—"}`),
    ``,
    `=== ALGORITHM'S READ (who-to-follow recommendations = perceived niche) ===`,
    e.recs.map((r) => `@${r.handle}${r.name ? ` (${r.name})` : ""}`).join(", "),
    ``,
    `=== BEST-PERFORMING POSTS (what resonated) ===`,
    ...f.topPosts.map((p, i) => `${i + 1}. ${p.views} views — "${p.text.slice(0, 100).replace(/\n/g, " ")}"`),
  ].join("\n");
}
