/**
 * The local buffer — a single SQLite file (buffer/x.db) that every tentacle
 * reads from. better-sqlite3: synchronous, fast, one file on disk, gitignored.
 *
 * Tables:
 *   accounts        — every profile we've seen (you, your network, tweet authors),
 *                     with full point-in-time metrics. `is_owner` flags YOU.
 *   tweets          — posts we've pulled (your history + home timeline), with the
 *                     full metric set: likes, retweets, replies, quotes, bookmarks,
 *                     and VIEWS (impressions — the denominator for engagement rate).
 *   edges           — who follows whom (owner —kind→ user), for network queries.
 *   trends          — trending topics, one row per (name, snapshot).
 *   stories         — X's AI "what's happening" beats (name, category, hook).
 *   recommendations — who-to-follow suggestions, one row per (account, snapshot).
 *
 * Snapshot stamping: every row's `captured_at` is the recon's capture time (from
 * the manifest), NOT ingest time. So re-ingesting the same recon is idempotent,
 * and the time-series tables (trends/stories/recommendations) append exactly one
 * clean snapshot per recon run — the seam Phase 2 (history over time) builds on.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  ParsedRecommendation,
  ParsedStory,
  ParsedTrend,
  ParsedTweet,
  ParsedUser,
} from "./parse.js";
import { toEpochMs } from "./parse.js";

export const DB_PATH = "buffer/x.db";

export type EdgeKind = "follower" | "following";
export type TweetSource = "user_tweets" | "home_timeline";

export class Buffer {
  private db: Database.Database;
  /** Capture time of the recon being ingested (ISO). Stamps every row. */
  private capturedAt: string;
  /** The signed-in @handle (no leading @), flagged is_owner in accounts. */
  private ownerHandle: string | null;

  constructor(opts: { capturedAt: string; ownerHandle?: string | null; path?: string }) {
    const path = opts.path ?? DB_PATH;
    this.capturedAt = opts.capturedAt;
    this.ownerHandle = opts.ownerHandle ?? null;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        rest_id           TEXT PRIMARY KEY,
        screen_name       TEXT,
        name              TEXT,
        description       TEXT,
        location          TEXT,
        url               TEXT,
        profile_image_url TEXT,
        followers_count   INTEGER,
        following_count   INTEGER,
        statuses_count    INTEGER,
        media_count       INTEGER,
        listed_count      INTEGER,
        favourites_count  INTEGER,
        verified          INTEGER,
        is_owner          INTEGER DEFAULT 0,
        created_at        TEXT,
        first_seen_at     TEXT,
        captured_at       TEXT
      );
      CREATE TABLE IF NOT EXISTS tweets (
        rest_id               TEXT PRIMARY KEY,
        author_rest_id        TEXT,
        author_handle         TEXT,
        text                  TEXT,
        lang                  TEXT,
        likes                 INTEGER,
        retweets              INTEGER,
        replies               INTEGER,
        quotes                INTEGER,
        bookmarks             INTEGER,
        views                 INTEGER,
        is_retweet            INTEGER,
        is_reply              INTEGER,
        in_reply_to_status_id TEXT,
        conversation_id       TEXT,
        quoted_status_id      TEXT,
        hashtags              TEXT,
        media_types           TEXT,
        created_at            TEXT,
        created_ts            INTEGER,
        source                TEXT,
        first_seen_at         TEXT,
        captured_at           TEXT
      );
      CREATE TABLE IF NOT EXISTS edges (
        owner_handle     TEXT,
        kind             TEXT,
        user_rest_id     TEXT,
        captured_at      TEXT,
        PRIMARY KEY (owner_handle, kind, user_rest_id)
      );
      CREATE TABLE IF NOT EXISTS trends (
        name             TEXT,
        domain_context   TEXT,
        url              TEXT,
        rank             INTEGER,
        captured_at      TEXT,
        PRIMARY KEY (name, captured_at)
      );
      CREATE TABLE IF NOT EXISTS stories (
        name             TEXT,
        category         TEXT,
        hook             TEXT,
        created_at_ms    INTEGER,
        captured_at      TEXT,
        PRIMARY KEY (name, captured_at)
      );
      CREATE TABLE IF NOT EXISTS recommendations (
        rest_id          TEXT,
        screen_name      TEXT,
        name             TEXT,
        captured_at      TEXT,
        PRIMARY KEY (rest_id, captured_at)
      );
      -- Time series: tweets/accounts above keep only the LATEST metrics (upsert).
      -- These two append one row per capture so we can see CHANGE over time —
      -- the foundation the learning loop grades against.
      CREATE TABLE IF NOT EXISTS tweet_metrics (
        rest_id      TEXT,
        captured_at  TEXT,
        likes        INTEGER,
        retweets     INTEGER,
        replies      INTEGER,
        quotes       INTEGER,
        bookmarks    INTEGER,
        views        INTEGER,
        PRIMARY KEY (rest_id, captured_at)
      );
      CREATE TABLE IF NOT EXISTS account_history (
        rest_id          TEXT,
        captured_at      TEXT,
        followers_count  INTEGER,
        following_count  INTEGER,
        statuses_count   INTEGER,
        listed_count     INTEGER,
        media_count      INTEGER,
        favourites_count INTEGER,
        PRIMARY KEY (rest_id, captured_at)
      );
      CREATE INDEX IF NOT EXISTS idx_tweets_author  ON tweets(author_handle);
      CREATE INDEX IF NOT EXISTS idx_tweets_source  ON tweets(source);
      CREATE INDEX IF NOT EXISTS idx_edges_user     ON edges(user_rest_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(is_owner);
      CREATE INDEX IF NOT EXISTS idx_tmetrics_rest  ON tweet_metrics(rest_id);
      CREATE INDEX IF NOT EXISTS idx_ahist_rest     ON account_history(rest_id);
    `);
  }

  upsertUser(u: ParsedUser): void {
    const isOwner = this.ownerHandle && u.screen_name === this.ownerHandle ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO accounts (rest_id, screen_name, name, description, location, url, profile_image_url,
            followers_count, following_count, statuses_count, media_count, listed_count, favourites_count,
            verified, is_owner, created_at, first_seen_at, captured_at)
         VALUES (@rest_id, @screen_name, @name, @description, @location, @url, @profile_image_url,
            @followers_count, @following_count, @statuses_count, @media_count, @listed_count, @favourites_count,
            @verified, @is_owner, @created_at, @captured_at, @captured_at)
         ON CONFLICT(rest_id) DO UPDATE SET
           screen_name=excluded.screen_name, name=excluded.name, description=excluded.description,
           location=excluded.location, url=excluded.url, profile_image_url=excluded.profile_image_url,
           followers_count=excluded.followers_count, following_count=excluded.following_count,
           statuses_count=excluded.statuses_count, media_count=excluded.media_count,
           listed_count=excluded.listed_count, favourites_count=excluded.favourites_count,
           verified=excluded.verified, is_owner=MAX(accounts.is_owner, excluded.is_owner),
           created_at=excluded.created_at, captured_at=excluded.captured_at`
      )
      .run({
        ...u,
        verified: u.verified ? 1 : 0,
        is_owner: isOwner,
        captured_at: this.capturedAt,
      });

    // Append this capture's snapshot to the follower/stats time series.
    this.db
      .prepare(
        `INSERT INTO account_history (rest_id, captured_at, followers_count, following_count,
            statuses_count, listed_count, media_count, favourites_count)
         VALUES (@rest_id, @captured_at, @followers_count, @following_count,
            @statuses_count, @listed_count, @media_count, @favourites_count)
         ON CONFLICT(rest_id, captured_at) DO UPDATE SET
           followers_count=excluded.followers_count, following_count=excluded.following_count,
           statuses_count=excluded.statuses_count, listed_count=excluded.listed_count,
           media_count=excluded.media_count, favourites_count=excluded.favourites_count`
      )
      .run({
        rest_id: u.rest_id,
        captured_at: this.capturedAt,
        followers_count: u.followers_count,
        following_count: u.following_count,
        statuses_count: u.statuses_count,
        listed_count: u.listed_count,
        media_count: u.media_count,
        favourites_count: u.favourites_count,
      });
  }

  upsertTweet(t: ParsedTweet, source: TweetSource): void {
    this.db
      .prepare(
        `INSERT INTO tweets (rest_id, author_rest_id, author_handle, text, lang, likes, retweets, replies,
            quotes, bookmarks, views, is_retweet, is_reply, in_reply_to_status_id, conversation_id,
            quoted_status_id, hashtags, media_types, created_at, created_ts, source, first_seen_at, captured_at)
         VALUES (@rest_id, @author_rest_id, @author_handle, @text, @lang, @likes, @retweets, @replies,
            @quotes, @bookmarks, @views, @is_retweet, @is_reply, @in_reply_to_status_id, @conversation_id,
            @quoted_status_id, @hashtags, @media_types, @created_at, @created_ts, @source, @captured_at, @captured_at)
         ON CONFLICT(rest_id) DO UPDATE SET
           likes=excluded.likes, retweets=excluded.retweets, replies=excluded.replies, quotes=excluded.quotes,
           bookmarks=excluded.bookmarks, views=excluded.views, captured_at=excluded.captured_at`
      )
      .run({
        ...t,
        is_retweet: t.is_retweet ? 1 : 0,
        is_reply: t.is_reply ? 1 : 0,
        hashtags: JSON.stringify(t.hashtags),
        media_types: JSON.stringify(t.media_types),
        created_ts: toEpochMs(t.created_at),
        source,
        captured_at: this.capturedAt,
      });

    // Append this capture's metrics to the per-tweet time series, so we can later
    // see how a post's views/likes accrued (and grade what WE posted).
    this.db
      .prepare(
        `INSERT INTO tweet_metrics (rest_id, captured_at, likes, retweets, replies, quotes, bookmarks, views)
         VALUES (@rest_id, @captured_at, @likes, @retweets, @replies, @quotes, @bookmarks, @views)
         ON CONFLICT(rest_id, captured_at) DO UPDATE SET
           likes=excluded.likes, retweets=excluded.retweets, replies=excluded.replies,
           quotes=excluded.quotes, bookmarks=excluded.bookmarks, views=excluded.views`
      )
      .run({
        rest_id: t.rest_id,
        captured_at: this.capturedAt,
        likes: t.likes,
        retweets: t.retweets,
        replies: t.replies,
        quotes: t.quotes,
        bookmarks: t.bookmarks,
        views: t.views,
      });
  }

  addEdge(ownerHandle: string, kind: EdgeKind, userRestId: string): void {
    this.db
      .prepare(
        `INSERT INTO edges (owner_handle, kind, user_rest_id, captured_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_handle, kind, user_rest_id) DO UPDATE SET captured_at=excluded.captured_at`
      )
      .run(ownerHandle, kind, userRestId, this.capturedAt);
  }

  addTrend(t: ParsedTrend): void {
    this.db
      .prepare(
        `INSERT INTO trends (name, domain_context, url, rank, captured_at)
         VALUES (@name, @domain_context, @url, @rank, @captured_at)
         ON CONFLICT(name, captured_at) DO UPDATE SET
           domain_context=excluded.domain_context, url=excluded.url, rank=excluded.rank`
      )
      .run({ ...t, captured_at: this.capturedAt });
  }

  addStory(s: ParsedStory): void {
    this.db
      .prepare(
        `INSERT INTO stories (name, category, hook, created_at_ms, captured_at)
         VALUES (@name, @category, @hook, @created_at_ms, @captured_at)
         ON CONFLICT(name, captured_at) DO UPDATE SET
           category=excluded.category, hook=excluded.hook, created_at_ms=excluded.created_at_ms`
      )
      .run({ ...s, captured_at: this.capturedAt });
  }

  addRecommendation(r: ParsedRecommendation): void {
    this.db
      .prepare(
        `INSERT INTO recommendations (rest_id, screen_name, name, captured_at)
         VALUES (@rest_id, @screen_name, @name, @captured_at)
         ON CONFLICT(rest_id, captured_at) DO UPDATE SET
           screen_name=excluded.screen_name, name=excluded.name`
      )
      .run({ ...r, captured_at: this.capturedAt });
  }

  /** Run many writes in one transaction — far faster for bulk ingest. */
  tx(fn: () => void): void {
    this.db.transaction(fn)();
  }

  counts(): Record<string, number> {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      accounts: one("SELECT COUNT(*) n FROM accounts"),
      tweets: one("SELECT COUNT(*) n FROM tweets"),
      followers: one("SELECT COUNT(*) n FROM edges WHERE kind='follower'"),
      following: one("SELECT COUNT(*) n FROM edges WHERE kind='following'"),
      trends: one("SELECT COUNT(*) n FROM trends"),
      stories: one("SELECT COUNT(*) n FROM stories"),
      recommendations: one("SELECT COUNT(*) n FROM recommendations"),
      metric_snapshots: one("SELECT COUNT(*) n FROM tweet_metrics"),
    };
  }

  close(): void {
    this.db.close();
  }
}
