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
  followers_count: number | null;
  following_count: number | null;
  verified: boolean;
  created_at: string | null;
}

export interface ParsedTweet {
  rest_id: string;
  author_rest_id: string | null;
  author_handle: string | null;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  is_retweet: boolean;
  created_at: string | null;
}

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
    followers_count: legacy.followers_count ?? null,
    following_count: legacy.friends_count ?? null,
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
  return {
    rest_id: String(r.rest_id),
    author_rest_id: author?.rest_id ?? null,
    author_handle: author?.screen_name ?? null,
    text: legacy.full_text ?? "",
    likes: legacy.favorite_count ?? 0,
    retweets: legacy.retweet_count ?? 0,
    replies: legacy.reply_count ?? 0,
    quotes: legacy.quote_count ?? 0,
    is_retweet: Boolean(legacy.retweeted_status_result),
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

/** Convert Twitter's date string ("Wed Jun 10 10:19:24 +0000 2026") to epoch ms. */
export function toEpochMs(twitterDate: string | null): number | null {
  if (!twitterDate) return null;
  const ms = Date.parse(twitterDate);
  return Number.isNaN(ms) ? null : ms;
}
