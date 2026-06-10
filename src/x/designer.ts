/**
 * THE DESIGNER — Stage 4, but the deliverable is GENERATED, not templated.
 *
 * Instead of hand-coded markup, the model writes the entire HTML document. The
 * system prompt is built from Anthropic's frontend-design principles (distinctive,
 * production-grade, anti-"AI slop"); the user payload is the exact report content
 * (numbers from the Data Room + prose from the Analyst). The model DESIGNS — it
 * does not invent data.
 *
 * Returns the HTML string, or null if no key is configured or the output doesn't
 * look like a real document (caller falls back to the code-rendered template).
 */
import { callText, hasLLM } from "../llm.js";
import type { FactBase } from "./factbase.js";
import type { Analysis } from "./analyst.js";
import type { PersonalityMap } from "./profiler.js";
import type { Evidence } from "./evidence.js";

// Distilled from the frontend-design skill — the design philosophy, baked in.
const DESIGN_SYSTEM = `You are an elite frontend designer who builds distinctive, production-grade interfaces that
look nothing like generic AI output. You are producing a single, self-contained HTML document: a
"growth diagnostic dossier" for a person's X (Twitter) account, by a ruthless growth agency called
Tentacle Partners (brand: brutal, no-nuance, theatrical — X rewards extremes, not politeness).

DESIGN MANDATE
- Commit to ONE bold, cohesive aesthetic direction and execute it with precision. Editorial/magazine,
  brutalist, luxury-refined, retro-futuristic — pick one that fits a brutal intelligence dossier and
  go all in. Intentionality over intensity.
- Typography is the centerpiece. Use DISTINCTIVE fonts via Google Fonts <link> (NEVER Inter, Roboto,
  Arial, or system-ui as the headline face). Pair a characterful display face with a refined body face
  and a monospace for data/numbers. High-contrast hierarchy; oversized numerals.
- Color: a dominant palette with sharp accents (NOT timid, evenly-distributed). NO purple-gradient-on-
  white cliché. Use CSS variables.
- Composition: confident, editorial layout — asymmetry, generous negative space or controlled density,
  rules/hairlines, grid-breaking moments, big section markers. Not a boxy dashboard of equal cards.
- Atmosphere: add depth — grain/noise texture, layered detail, dramatic dividers, considered shadows.
- Motion: ONE well-orchestrated page-load reveal (staggered animation-delay) beats scattered micro-
  interactions. CSS-only.
- Must be fully responsive and self-contained (inline <style>; Google Fonts <link> is allowed; no JS
  frameworks, no external CSS/images besides fonts).

HARD RULES
- Use the EXACT numbers and text from the data payload. Do NOT invent or alter a single statistic.
- Render every section provided: verdict, headline KPIs, the stat grid, content mix, cadence by hour,
  top posts, positioning (who the algo groups them with, trends, story angles), the findings
  (stat -> diagnosis -> fix), and the prioritized recommendations.
- Charts: build simple bar charts in pure CSS/HTML from the numbers (no chart libraries).
- Keep the brutal, candid tone in any framing/labels you add.

OUTPUT
Return ONLY the HTML document. Start with <!doctype html> and end with </html>. No markdown, no code
fences, no commentary before or after.`;

/** Build the exact content payload — labeled, so the model designs but never guesses. */
function contentPayload(f: FactBase, analysis: Analysis): string {
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return JSON.stringify(
    {
      subject: {
        name: f.owner.name,
        handle: f.owner.handle,
        followers: f.owner.followers,
        following: f.owner.following,
        lifetimePosts: f.owner.posts,
        accountAgeYears: f.owner.accountAgeYears,
        bio: f.owner.bioPresent ? f.owner.bio : "EMPTY (no bio set)",
        likesGiven: f.owner.likesGiven,
        timesListed: f.owner.listed,
        snapshot: f.capturedAt,
      },
      verdict: analysis.verdict,
      headlineKPIs: [
        { label: "Followers per post", value: f.ratios.followersPerPost.toFixed(2), bad: f.ratios.followersPerPost < 1 },
        { label: "Follower : following", value: f.ratios.followerToFollowing.toFixed(2), bad: f.ratios.followerToFollowing < 1.5 },
        { label: "Original content", value: pct(f.sample.original, f.sample.authored) + "%", bad: pct(f.sample.original, f.sample.authored) < 25 },
        { label: "Bookmarks earned", value: f.engagement.totalBookmarks, bad: f.engagement.totalBookmarks === 0 },
      ],
      stats: {
        avgViews: f.engagement.avgViews,
        medianViews: f.engagement.medianViews,
        avgEngagementRatePct: f.engagement.avgEngagementRatePct.toFixed(1) + "%",
        avgLikesPerPost: f.engagement.avgLikesPerAuthored.toFixed(1),
        postsPerDay: f.ratios.postsPerDay?.toFixed(1),
        mediaUsagePct: pct(f.sample.withMedia, f.sample.authored) + "%",
        bioStatus: f.owner.bioPresent ? "Set" : "EMPTY",
      },
      contentMix: f.contentMix, // [{label,count}]
      cadenceByHourIST: f.cadenceByHourIST, // 24 ints
      topPosts: f.topPosts.map((p) => ({
        text: p.text,
        views: p.views,
        likes: p.likes,
        bookmarks: p.bookmarks,
        engagementRatePct: (p.engagementRate * 100).toFixed(1) + "%",
      })),
      formatLift: f.formatLift,
      hashtags: f.hashtags,
      positioning: {
        algorithmGroupsYouWith: f.niche.recommendations.map((r) => "@" + r.handle),
        biggestAccountsYouFollow: f.niche.following.slice(0, 6),
        trendingNow: f.market.trends.map((t) => t.name),
        storyAngles: f.market.stories,
      },
      findings: analysis.findings, // [{stat,diagnosis,fix}]
      recommendations: analysis.recommendations, // [{move,why,impact,effort}]
    },
    null,
    2
  );
}

/** Strip accidental ```html fences and any prose around the document. */
function cleanHtml(raw: string): string | null {
  let s = raw.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<!doctype html>|<html[\s>]/i);
  if (start === -1) return null;
  s = s.slice(start).trim();
  if (!/<\/html>/i.test(s)) return null;
  return s;
}

export async function designHtml(f: FactBase, analysis: Analysis): Promise<string | null> {
  if (!hasLLM()) return null;
  const raw = await callText(DESIGN_SYSTEM, `REPORT CONTENT (use these exact values):\n${contentPayload(f, analysis)}`, {
    temperature: 0.85,
    maxTokens: 12000,
  });
  return cleanHtml(raw);
}

// ── the dossier variant — a personality file, not a metrics report ────────────────
const DOSSIER_SYSTEM = `You are an elite frontend designer building a single, self-contained HTML document: a
CONFIDENTIAL TALENT DOSSIER — a Hollywood agent's personality file on a client, used to make them go viral on
X. The mood is intimate, theatrical, a little dangerous: this is the file that says who this person really is
and how we make them a star.

DESIGN MANDATE (same bar as a flagship editorial piece)
- Commit to ONE bold, cohesive aesthetic and execute precisely. Think dossier / case file / magazine cover
  story about a person — characterful, not a dashboard.
- DISTINCTIVE fonts via Google Fonts <link> (NEVER Inter/Roboto/Arial/system-ui as the display face). Pair a
  striking display face with a refined body face and a mono for labels/metadata.
- Dominant palette with sharp accents (no purple-on-white cliché). CSS variables. Atmosphere: grain/noise,
  dramatic dividers, layered depth.
- Editorial composition: the archetype name and 'essence' line should feel like a magazine cover. Asymmetry,
  big type, generous space or controlled density. One orchestrated CSS load reveal (staggered).
- Fully responsive, self-contained (inline <style>; Google Fonts <link> only; no JS frameworks, no images).

HARD RULES
- Use the EXACT text from the payload. Do not invent traits, quotes, or numbers.
- Render every part: archetype + tagline, the essence line (hero), personality (traits/temperament/drivers),
  voice signature & tics, themes/lanes, values, enemies, in-group, strengths, liabilities, the JUDGMENT
  (star rating, marketable, what's holding them back, the uncomfortable truth), and the POSITIONING play
  (persona, lane, content pillars, the new bio, the 90-day plan, the audience).
- Keep the candid, theatrical agent tone in any framing/labels you add.

OUTPUT
Return ONLY the HTML document, starting with <!doctype html> and ending with </html>. No markdown, no fences,
no commentary.`;

function dossierPayload(map: PersonalityMap, e: Evidence): string {
  return JSON.stringify(
    {
      subject: { name: e.facts.owner.name, handle: e.facts.owner.handle, followers: e.facts.owner.followers, accountAgeYears: e.facts.owner.accountAgeYears },
      ...map,
    },
    null,
    2
  );
}

export async function designDossier(map: PersonalityMap, e: Evidence): Promise<string | null> {
  if (!hasLLM()) return null;
  const raw = await callText(DOSSIER_SYSTEM, `DOSSIER CONTENT (use these exact values):\n${dossierPayload(map, e)}`, {
    temperature: 0.85,
    maxTokens: 12000,
  });
  return cleanHtml(raw);
}
