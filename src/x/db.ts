/**
 * The local buffer — a single SQLite file (buffer/x.db) that every tentacle
 * reads from. better-sqlite3: synchronous, fast, one file on disk, gitignored.
 *
 * Three tables:
 *   users    — everyone we've seen (you, your network, tweet authors)
 *   tweets   — posts we've pulled (your history + home timeline), with metrics
 *   edges    — who follows whom (owner_handle —kind→ user), for network queries
 *
 * Upserts everywhere: re-running a crawl refreshes rows (fresh follower counts,
 * fresh like counts) instead of piling up duplicates.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { ParsedTweet, ParsedUser } from "./parse.js";
import { toEpochMs } from "./parse.js";

export const DB_PATH = "buffer/x.db";

export type EdgeKind = "follower" | "following";
export type TweetSource = "user_tweets" | "home_timeline";

export class Buffer {
  private db: Database.Database;

  constructor(path = DB_PATH) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        rest_id          TEXT PRIMARY KEY,
        screen_name      TEXT,
        name             TEXT,
        description      TEXT,
        followers_count  INTEGER,
        following_count  INTEGER,
        verified         INTEGER,
        created_at       TEXT,
        captured_at      TEXT
      );
      CREATE TABLE IF NOT EXISTS tweets (
        rest_id          TEXT PRIMARY KEY,
        author_rest_id   TEXT,
        author_handle    TEXT,
        text             TEXT,
        likes            INTEGER,
        retweets         INTEGER,
        replies          INTEGER,
        quotes           INTEGER,
        is_retweet       INTEGER,
        created_at       TEXT,
        created_ts       INTEGER,
        source           TEXT,
        captured_at      TEXT
      );
      CREATE TABLE IF NOT EXISTS edges (
        owner_handle     TEXT,
        kind             TEXT,
        user_rest_id     TEXT,
        captured_at      TEXT,
        PRIMARY KEY (owner_handle, kind, user_rest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(author_handle);
      CREATE INDEX IF NOT EXISTS idx_edges_user   ON edges(user_rest_id);
    `);
  }

  private now(): string {
    return new Date().toISOString();
  }

  upsertUser(u: ParsedUser): void {
    this.db
      .prepare(
        `INSERT INTO users (rest_id, screen_name, name, description, followers_count, following_count, verified, created_at, captured_at)
         VALUES (@rest_id, @screen_name, @name, @description, @followers_count, @following_count, @verified, @created_at, @captured_at)
         ON CONFLICT(rest_id) DO UPDATE SET
           screen_name=excluded.screen_name, name=excluded.name, description=excluded.description,
           followers_count=excluded.followers_count, following_count=excluded.following_count,
           verified=excluded.verified, created_at=excluded.created_at, captured_at=excluded.captured_at`
      )
      .run({ ...u, verified: u.verified ? 1 : 0, captured_at: this.now() });
  }

  upsertTweet(t: ParsedTweet, source: TweetSource): void {
    this.db
      .prepare(
        `INSERT INTO tweets (rest_id, author_rest_id, author_handle, text, likes, retweets, replies, quotes, is_retweet, created_at, created_ts, source, captured_at)
         VALUES (@rest_id, @author_rest_id, @author_handle, @text, @likes, @retweets, @replies, @quotes, @is_retweet, @created_at, @created_ts, @source, @captured_at)
         ON CONFLICT(rest_id) DO UPDATE SET
           likes=excluded.likes, retweets=excluded.retweets, replies=excluded.replies, quotes=excluded.quotes,
           captured_at=excluded.captured_at`
      )
      .run({
        ...t,
        is_retweet: t.is_retweet ? 1 : 0,
        created_ts: toEpochMs(t.created_at),
        source,
        captured_at: this.now(),
      });
  }

  addEdge(ownerHandle: string, kind: EdgeKind, userRestId: string): void {
    this.db
      .prepare(
        `INSERT INTO edges (owner_handle, kind, user_rest_id, captured_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_handle, kind, user_rest_id) DO UPDATE SET captured_at=excluded.captured_at`
      )
      .run(ownerHandle, kind, userRestId, this.now());
  }

  /** Run many writes in one transaction — far faster for bulk ingest. */
  tx(fn: () => void): void {
    this.db.transaction(fn)();
  }

  counts(): Record<string, number> {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      users: one("SELECT COUNT(*) n FROM users"),
      tweets: one("SELECT COUNT(*) n FROM tweets"),
      followers: one("SELECT COUNT(*) n FROM edges WHERE kind='follower'"),
      following: one("SELECT COUNT(*) n FROM edges WHERE kind='following'"),
    };
  }

  close(): void {
    this.db.close();
  }
}
