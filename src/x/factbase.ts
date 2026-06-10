/**
 * STAGE 0 — THE DATA ROOM.
 *
 * Computes the fact base for the Analyst engagement: every hard number, in code,
 * from buffer/x.db. NO LLM here — per agent-orchestration.md, metrics are computed
 * deterministically and handed to the model as facts. The LLM interprets; it never
 * invents a statistic.
 *
 * `computeFactBase()` returns one structured object that every downstream
 * workstream (and the HTML report) reads from.
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./db.js";

export interface TopPost {
  text: string;
  views: number;
  likes: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
  replies: number;
  engagementRate: number; // (likes+rt+replies+quotes+bookmarks) / views
  createdAt: string | null;
}

export interface FactBase {
  owner: {
    handle: string;
    name: string | null;
    bio: string;
    bioPresent: boolean;
    followers: number;
    following: number;
    posts: number;
    likesGiven: number;
    media: number;
    listed: number;
    createdAt: string | null;
    accountAgeYears: number | null;
  };
  ratios: {
    followerToFollowing: number;
    followersPerPost: number;
    postsPerDay: number | null;
  };
  sample: {
    total: number;
    authored: number;
    retweets: number;
    quotes: number;
    replies: number;
    original: number;
    withViews: number;
    withMedia: number;
  };
  engagement: {
    avgViews: number;
    medianViews: number;
    avgEngagementRatePct: number;
    totalLikesReceived: number;
    totalBookmarks: number;
    avgLikesPerAuthored: number;
  };
  topPosts: TopPost[];
  contentMix: { label: string; count: number }[];
  cadenceByHourIST: number[]; // 24 buckets
  cadenceByDow: number[]; // 7 buckets, 0=Sun
  formatLift: { mediaAvgViews: number; textAvgViews: number };
  niche: {
    following: { handle: string; followers: number }[];
    recommendations: { handle: string; name: string | null }[];
  };
  market: {
    trends: { name: string; context: string | null }[];
    stories: { name: string; category: string | null; hook: string | null }[];
  };
  hashtags: { tag: string; count: number }[];
  /** Raw text of authored posts — fuel for the voice workstream (capped). */
  authoredTexts: string[];
  capturedAt: string | null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeFactBase(path = DB_PATH): FactBase {
  const db = new Database(path, { readonly: true });
  const get = (sql: string): any => db.prepare(sql).get();
  const all = (sql: string): any[] => db.prepare(sql).all();

  const o = get("SELECT * FROM accounts WHERE is_owner=1");
  if (!o) {
    db.close();
    throw new Error("No owner in buffer (accounts.is_owner=1). Run x:login → x:recon → x:ingest first.");
  }

  const createdMs = o.created_at ? Date.parse(o.created_at) : NaN;
  const capturedMs = o.captured_at ? Date.parse(o.captured_at) : Date.now();
  const ageYears = Number.isNaN(createdMs) ? null : (capturedMs - createdMs) / (365.25 * 864e5);

  // Authored = your real output (excludes pure retweets, which carry the ORIGINAL
  // author's metrics, not yours).
  const authored = all(
    "SELECT * FROM tweets WHERE source='user_tweets' AND is_retweet=0"
  );
  const allMine = all("SELECT * FROM tweets WHERE source='user_tweets'");
  const withViews = authored.filter((t) => t.views != null && t.views > 0);

  const engRate = (t: any): number => {
    if (!t.views) return 0;
    return (t.likes + t.retweets + t.replies + t.quotes + t.bookmarks) / t.views;
  };

  const retweets = allMine.filter((t) => t.is_retweet).length;
  const quotes = authored.filter((t) => t.quoted_status_id != null).length;
  const replies = authored.filter((t) => t.is_reply).length;
  const original = authored.filter(
    (t) => !t.is_reply && t.quoted_status_id == null
  ).length;

  const cadenceByHourIST = new Array(24).fill(0);
  const cadenceByDow = new Array(7).fill(0);
  for (const t of authored) {
    if (!t.created_ts) continue;
    const ist = new Date(t.created_ts + IST_OFFSET_MS);
    cadenceByHourIST[ist.getUTCHours()]++;
    cadenceByDow[ist.getUTCDay()]++;
  }

  const withMedia = authored.filter((t) => t.media_types && t.media_types !== "[]");
  const textOnly = authored.filter((t) => !t.media_types || t.media_types === "[]");
  const mediaViews = withMedia.filter((t) => t.views).map((t) => t.views);
  const textViews = textOnly.filter((t) => t.views).map((t) => t.views);

  const topPosts: TopPost[] = withViews
    .sort((a, b) => b.views - a.views)
    .slice(0, 6)
    .map((t) => ({
      text: t.text,
      views: t.views,
      likes: t.likes,
      retweets: t.retweets,
      quotes: t.quotes,
      bookmarks: t.bookmarks,
      replies: t.replies,
      engagementRate: engRate(t),
      createdAt: t.created_at,
    }));

  // Hashtag frequency across authored posts.
  const tagCounts = new Map<string, number>();
  for (const t of authored) {
    try {
      for (const tag of JSON.parse(t.hashtags || "[]")) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    } catch {
      /* ignore */
    }
  }

  const followingTop = all(
    `SELECT a.screen_name handle, a.followers_count followers
     FROM edges e JOIN accounts a ON a.rest_id = e.user_rest_id
     WHERE e.kind='following' AND a.followers_count IS NOT NULL
     ORDER BY a.followers_count DESC LIMIT 8`
  );
  const recs = all("SELECT screen_name handle, name FROM recommendations LIMIT 10");
  const trends = all("SELECT name, domain_context context FROM trends ORDER BY rank LIMIT 10");
  const stories = all("SELECT name, category, hook FROM stories LIMIT 5");

  const totalLikes = authored.reduce((s, t) => s + t.likes, 0);
  const totalBookmarks = authored.reduce((s, t) => s + t.bookmarks, 0);

  db.close();

  return {
    owner: {
      handle: o.screen_name,
      name: o.name,
      bio: o.description ?? "",
      bioPresent: Boolean((o.description ?? "").trim()),
      followers: o.followers_count ?? 0,
      following: o.following_count ?? 0,
      posts: o.statuses_count ?? 0,
      likesGiven: o.favourites_count ?? 0,
      media: o.media_count ?? 0,
      listed: o.listed_count ?? 0,
      createdAt: o.created_at,
      accountAgeYears: ageYears,
    },
    ratios: {
      followerToFollowing: o.following_count ? o.followers_count / o.following_count : 0,
      followersPerPost: o.statuses_count ? o.followers_count / o.statuses_count : 0,
      postsPerDay: ageYears && ageYears > 0 ? o.statuses_count / (ageYears * 365.25) : null,
    },
    sample: {
      total: allMine.length,
      authored: authored.length,
      retweets,
      quotes,
      replies,
      original,
      withViews: withViews.length,
      withMedia: withMedia.length,
    },
    engagement: {
      avgViews: Math.round(avg(withViews.map((t) => t.views))),
      medianViews: Math.round(median(withViews.map((t) => t.views))),
      avgEngagementRatePct: avg(withViews.map(engRate)) * 100,
      totalLikesReceived: totalLikes,
      totalBookmarks,
      avgLikesPerAuthored: avg(authored.map((t) => t.likes)),
    },
    topPosts,
    contentMix: [
      { label: "Original", count: original },
      { label: "Quote-tweets", count: quotes },
      { label: "Replies", count: replies },
      { label: "Retweets", count: retweets },
    ],
    cadenceByHourIST,
    cadenceByDow,
    formatLift: {
      mediaAvgViews: Math.round(avg(mediaViews)),
      textAvgViews: Math.round(avg(textViews)),
    },
    niche: {
      following: followingTop,
      recommendations: recs,
    },
    market: {
      trends: trends.map((t) => ({ name: t.name, context: t.context })),
      stories: stories.map((s) => ({ name: s.name, category: s.category, hook: s.hook })),
    },
    hashtags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    authoredTexts: authored
      .map((t) => (t.text ?? "").trim())
      .filter(Boolean)
      .slice(0, 30),
    capturedAt: o.captured_at ?? null,
  };
}
