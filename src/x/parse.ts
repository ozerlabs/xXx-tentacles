/**
 * Parsers for X's internal GraphQL responses.
 *
 * X buries users and tweets several layers deep inside "timeline instructions"
 * and rotates where fields live (some moved from `legacy` into `core`). These
 * helpers normalize all that into flat objects, defensively — so both the
 * recon ingest AND the live crawler read responses the same way.
 *
 * Shapes confirmed against real captures in .x-recon/responses/.
 */

export interface ParsedUser {
  rest_id: string;
  screen_name: string | null;
  name: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  profile_image_url: string | null;
  followers_count: number | null;
  following_count: number | null;
  /** total posts the account has made */
  statuses_count: number | null;
  media_count: number | null;
  listed_count: number | null;
  /** likes this account has given out */
  favourites_count: number | null;
  verified: boolean;
  created_at: string | null;
}

export interface ParsedTweet {
  rest_id: string;
  author_rest_id: string | null;
  author_handle: string | null;
  text: string;
  lang: string | null;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  /** impressions — the denominator for true engagement rate */
  views: number | null;
  is_retweet: boolean;
  is_reply: boolean;
  in_reply_to_status_id: string | null;
  conversation_id: string | null;
  quoted_status_id: string | null;
  hashtags: string[];
  media_types: string[];
  created_at: string | null;
}

export interface ParsedTrend {
  name: string;
  domain_context: string | null;
  url: string | null;
  /** position in the trend list (1 = top) */
  rank: number;
}

export interface ParsedStory {
  name: string;
  category: string | null;
  /** the AI-written one-line angle X attaches to the story */
  hook: string | null;
  created_at_ms: number | null;
}

export interface ParsedRecommendation {
  rest_id: string;
  screen_name: string | null;
  name: string | null;
}

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Where the timeline instructions live varies by operation — try each spot. */
function instructionsOf(json: any): any[] {
  const r = json?.data?.user?.result ?? json?.data?.home ?? json?.data?.user;
  return (
    r?.timeline?.timeline?.instructions ??
    r?.timeline_v2?.timeline?.instructions ??
    r?.timeline?.instructions ??
    r?.home_timeline_urt?.instructions ??
    []
  );
}

/** All timeline entries (the `TimelineAddEntries` instruction). */
export function entriesOf(json: any): any[] {
  const add = instructionsOf(json).find((i) => i?.type === "TimelineAddEntries");
  return add?.entries ?? [];
}

/** The "load more" cursor for the next page, or null when the list is exhausted. */
export function bottomCursor(json: any): string | null {
  for (const e of entriesOf(json)) {
    const c = e?.content;
    if (c?.cursorType === "Bottom" && c?.value) return c.value;
  }
  return null;
}

/** Normalize a `user_results.result` (or `data.user.result`) node. */
export function parseUser(result: any): ParsedUser | null {
  if (!result || (result.__typename && result.__typename !== "User")) return null;
  const core = result.core ?? {};
  const legacy = result.legacy ?? {};
  if (!result.rest_id) return null;
  return {
    rest_id: String(result.rest_id),
    screen_name: core.screen_name ?? legacy.screen_name ?? null,
    name: core.name ?? legacy.name ?? null,
    description: legacy.description ?? result.profile_bio?.description ?? null,
    location: result.location?.location ?? legacy.location ?? null,
    url: legacy.url ?? result.legacy?.url ?? null,
    profile_image_url:
      result.avatar?.image_url ?? legacy.profile_image_url_https ?? null,
    followers_count: toInt(legacy.followers_count),
    following_count: toInt(legacy.friends_count),
    statuses_count: toInt(legacy.statuses_count),
    media_count: toInt(legacy.media_count),
    listed_count: toInt(legacy.listed_count),
    favourites_count: toInt(legacy.favourites_count),
    verified: Boolean(result.is_blue_verified ?? legacy.verified ?? false),
    created_at: core.created_at ?? legacy.created_at ?? null,
  };
}

/** Unwrap and normalize a `tweet_results.result` node. */
export function parseTweet(result: any): ParsedTweet | null {
  // Visibility-limited tweets nest the real thing under `.tweet`.
  const r = result?.tweet ?? result;
  if (!r || !r.rest_id) return null;
  const legacy = r.legacy ?? {};
  const author = parseUser(r.core?.user_results?.result);
  const entities = legacy.entities ?? {};
  const media = legacy.extended_entities?.media ?? entities.media ?? [];
  // note_tweet carries the full text for long-form posts (>280).
  const noteText = r.note_tweet?.note_tweet_results?.result?.text;
  return {
    rest_id: String(r.rest_id),
    author_rest_id: author?.rest_id ?? null,
    author_handle: author?.screen_name ?? null,
    text: noteText ?? legacy.full_text ?? "",
    lang: legacy.lang ?? null,
    likes: toInt(legacy.favorite_count) ?? 0,
    retweets: toInt(legacy.retweet_count) ?? 0,
    replies: toInt(legacy.reply_count) ?? 0,
    quotes: toInt(legacy.quote_count) ?? 0,
    bookmarks: toInt(legacy.bookmark_count) ?? 0,
    views: toInt(r.views?.count),
    is_retweet: Boolean(legacy.retweeted_status_result),
    is_reply: Boolean(legacy.in_reply_to_status_id_str),
    in_reply_to_status_id: legacy.in_reply_to_status_id_str ?? null,
    conversation_id: legacy.conversation_id_str ?? null,
    quoted_status_id: legacy.quoted_status_id_str ?? null,
    hashtags: (entities.hashtags ?? []).map((h: any) => h.text).filter(Boolean),
    media_types: media.map((m: any) => m.type).filter(Boolean),
    created_at: legacy.created_at ?? null,
  };
}

/** Pull every user out of a Followers/Following-style response. */
export function usersFromResponse(json: any): ParsedUser[] {
  const out: ParsedUser[] = [];
  for (const e of entriesOf(json)) {
    const u = parseUser(e?.content?.itemContent?.user_results?.result);
    if (u) out.push(u);
  }
  return out;
}

/** Pull every tweet out of a UserTweets/HomeTimeline-style response (skips ads). */
export function tweetsFromResponse(json: any): ParsedTweet[] {
  const out: ParsedTweet[] = [];
  for (const e of entriesOf(json)) {
    if (typeof e?.entryId === "string" && e.entryId.startsWith("promoted-")) continue;
    const t = parseTweet(e?.content?.itemContent?.tweet_results?.result);
    if (t) out.push(t);
  }
  return out;
}

/** Pull trending topics out of an ExploreSidebar response, in display order. */
export function trendsFromResponse(json: any): ParsedTrend[] {
  const out: ParsedTrend[] = [];
  (function walk(o: any): void {
    if (!o || typeof o !== "object") return;
    if (o.__typename === "TimelineTrend" && o.name) {
      out.push({
        name: String(o.name),
        domain_context: o.trend_metadata?.domain_context ?? null,
        url: o.trend_metadata?.url?.url ?? o.trend_url?.url ?? null,
        rank: out.length + 1,
      });
    }
    for (const k in o) walk(o[k]);
  })(json);
  return out;
}

/** Pull the AI "what's happening" stories out of a useStoryTopicQuery response. */
export function storiesFromResponse(json: any): ParsedStory[] {
  const out: ParsedStory[] = [];
  (function walk(o: any): void {
    if (!o || typeof o !== "object") return;
    if (o.__typename === "AiTrend" && o.core?.name) {
      out.push({
        name: String(o.core.name),
        category: o.core.category ?? null,
        hook: o.core.hook ?? null,
        created_at_ms: toInt(o.core.created_at_ms),
      });
    }
    for (const k in o) walk(o[k]);
  })(json);
  return out;
}

/** Pull who-to-follow suggestions out of a SidebarUserRecommendations response. */
export function recommendationsFromResponse(json: any): ParsedRecommendation[] {
  const arr = json?.data?.sidebar_user_recommendations ?? [];
  const out: ParsedRecommendation[] = [];
  for (const item of arr) {
    const u = parseUser(item?.user_results?.result);
    if (u) out.push({ rest_id: u.rest_id, screen_name: u.screen_name, name: u.name });
  }
  return out;
}

/** Convert Twitter's date string ("Wed Jun 10 10:19:24 +0000 2026") to epoch ms. */
export function toEpochMs(twitterDate: string | null): number | null {
  if (!twitterDate) return null;
  const ms = Date.parse(twitterDate);
  return Number.isNaN(ms) ? null : ms;
}
