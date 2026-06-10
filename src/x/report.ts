/**
 * `npm run x:report` — STAGE 4, the deliverable.
 *
 * Reads the Data Room (factbase.ts), runs the Analyst engagement (analyst.ts),
 * and renders a self-contained HTML growth diagnostic to buffer/profile.html.
 *
 * Aesthetic: editorial brutalist "confidential dossier" — bone paper, black ink,
 * one blood-red accent, a high-contrast display serif (Fraunces) against a clinical
 * monospace (Space Mono). Answer-first, every claim nailed to a number, brutal.
 *
 * Findings/recs come from the LLM workstreams when a key is configured, else from
 * the rule-derived fallback. Numbers are always computed in code; the model only
 * interprets them.
 */
import { writeFileSync } from "node:fs";
import { computeFactBase, type FactBase, type TopPost } from "./factbase.js";
import { analyze, type Analysis } from "./analyst.js";
import { designHtml } from "./designer.js";

const OUT = "buffer/profile.html";

interface Finding {
  stat: string;
  diagnosis: string;
  fix: string;
}
interface Rec {
  move: string;
  why: string;
  impact: "High" | "Medium";
  effort: "Low" | "Medium" | "High";
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("en-US");
const esc = (s: string) =>
  (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const pad2 = (n: number) => String(n).padStart(2, "0");

// ── findings: stat → diagnosis → fix, all threshold-driven off real numbers ──────
function deriveFindings(f: FactBase): Finding[] {
  const out: Finding[] = [];
  const originalPct = pct(f.sample.original, f.sample.authored);

  if (f.ratios.followersPerPost < 1) {
    out.push({
      stat: `${fmt(f.owner.posts)} posts → ${fmt(f.owner.followers)} followers = ${f.ratios.followersPerPost.toFixed(2)} followers earned per post.`,
      diagnosis: "This is not a frequency problem — it's a conversion problem. Volume isn't the lever; quality and originality are.",
      fix: "Stop measuring output in tweets. Measure it in followers-per-post and ship fewer, sharper originals.",
    });
  }
  if (f.ratios.followerToFollowing < 1.5) {
    out.push({
      stat: `Follower / following ratio ≈ ${f.ratios.followerToFollowing.toFixed(2)} (${fmt(f.owner.followers)} / ${fmt(f.owner.following)}).`,
      diagnosis: "The timeline reads you as a peer, not a voice worth following. A ~1:1 ratio signals 'mutuals', not authority.",
      fix: "Prune the follow list and stop reflexive follow-backs. Let the ratio climb — it's a public authority signal.",
    });
  }
  if (originalPct < 25) {
    out.push({
      stat: `Only ${f.sample.original} of ${f.sample.authored} authored posts are original (${originalPct}%); ${f.sample.retweets} of ${f.sample.total} recent posts are pure retweets.`,
      diagnosis: "You're a passenger, not a driver. Reactions and amplification don't build a voice — and they don't earn original reach.",
      fix: "Lead with declaratives. Aim for a 70% original / 30% reactive mix, reversed from today.",
    });
  }
  if (f.engagement.totalBookmarks === 0) {
    out.push({
      stat: `~${f.engagement.totalBookmarks} bookmarks across the analyzed sample.`,
      diagnosis: "Bookmarks are the strongest 'this resonated' signal on X — people save what they want to act on. You generate none.",
      fix: "Ship one genuinely useful, save-worthy post per week (a how-to, a list, a sharp framework).",
    });
  }
  if (!f.owner.bioPresent) {
    out.push({
      stat: `Bio is empty${f.owner.accountAgeYears ? `, on a ${f.owner.accountAgeYears.toFixed(0)}-year-old account` : ""}.`,
      diagnosis: "The single highest-leverage real estate on the profile is blank. Every profile visit lands on nothing.",
      fix: "Write a one-line positioning bio today: who you are + the lane you own + a reason to follow.",
    });
  }
  if (f.owner.accountAgeYears && f.owner.accountAgeYears > 5 && f.owner.followers < 2000) {
    out.push({
      stat: `${f.owner.accountAgeYears.toFixed(1)} years old, ${fmt(f.owner.followers)} followers (≈${f.ratios.postsPerDay?.toFixed(1)} posts/day).`,
      diagnosis: "A decade of consistent posting that never compounded. The effort is there; the strategy isn't.",
      fix: "Treat the next 90 days as a relaunch with a single owned topic — not more of the same.",
    });
  }
  return out;
}

function deriveRecs(f: FactBase): Rec[] {
  const recs: Rec[] = [];
  if (!f.owner.bioPresent)
    recs.push({ move: "Write a positioning bio", why: "Highest-leverage blank space on the profile.", impact: "High", effort: "Low" });
  recs.push({
    move: "Flip the content mix to 70% original",
    why: `Today only ${pct(f.sample.original, f.sample.authored)}% of authored posts are original — reactions don't earn reach.`,
    impact: "High",
    effort: "Medium",
  });
  recs.push({
    move: `Own the ${f.niche.recommendations[0]?.handle ? "dev/tech" : "core"} lane`,
    why: `The algorithm files you with ${f.niche.recommendations.slice(0, 2).map((r) => "@" + r.handle).join(", ") || "your niche"} — a high-ceiling lane you under-serve.`,
    impact: "High",
    effort: "Medium",
  });
  recs.push({ move: "Ship one save-worthy post / week", why: "You currently generate zero bookmarks — the strongest growth signal.", impact: "Medium", effort: "Medium" });
  recs.push({ move: "Let the follower/following ratio climb", why: "A ~1:1 ratio reads as mutuals, not authority.", impact: "Medium", effort: "Low" });
  return recs;
}

// ── chart helpers (CSS, no deps) ─────────────────────────────────────────────────
function hbars(items: { label: string; value: number; note?: string }[], accent = false): string {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars">${items
    .map(
      (i) => `<div class="bar-row">
        <div class="bar-label">${esc(i.label)}</div>
        <div class="bar-track"><div class="bar-fill ${accent ? "fill-red" : ""}" style="width:${Math.max(2, pct(i.value, max))}%"></div></div>
        <div class="bar-val">${fmt(i.value)}${i.note ? `<span class="bar-note">${esc(i.note)}</span>` : ""}</div>
      </div>`
    )
    .join("")}</div>`;
}

function hourChart(hours: number[]): string {
  const max = Math.max(1, ...hours);
  return `<div class="hours">${hours
    .map(
      (v, h) => `<div class="hour-col" title="${v} posts @ ${h}:00 IST">
        <div class="hour-bar ${v === max ? "peak" : ""}" style="height:${v ? Math.max(6, pct(v, max)) : 0}%"></div>
        <div class="hour-tick">${h % 6 === 0 ? pad2(h) : ""}</div>
      </div>`
    )
    .join("")}</div>`;
}

function statCard(label: string, value: string, sub = "", flag = false): string {
  return `<div class="stat ${flag ? "stat-bad" : ""}">
    <div class="stat-value">${value}</div>
    <div class="stat-label">${esc(label)}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

function topPostsTable(posts: TopPost[]): string {
  if (!posts.length) return `<p class="muted">No posts with view counts in the current snapshot.</p>`;
  return `<table class="posts"><thead><tr>
      <th>Post</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Bkmk</th><th class="num">Eng.</th>
    </tr></thead><tbody>${posts
      .map(
        (p, i) => `<tr>
        <td class="post-rank">${pad2(i + 1)}</td>
        <td class="post-text">${esc(p.text.slice(0, 96))}${p.text.length > 96 ? "…" : ""}</td>
        <td class="num">${fmt(p.views)}</td>
        <td class="num">${fmt(p.likes)}</td>
        <td class="num">${fmt(p.bookmarks)}</td>
        <td class="num">${(p.engagementRate * 100).toFixed(1)}%</td>
      </tr>`
      )
      .join("")}</tbody></table>`;
}

type Llm = { analysis: Analysis; meta: { workstreams: number; reviewScore: number; iterations: number } } | null;

function render(f: FactBase, llm: Llm): string {
  const findings: Finding[] = llm?.analysis.findings ?? deriveFindings(f);
  const recs: Rec[] = llm?.analysis.recommendations ?? deriveRecs(f);
  const age = f.owner.accountAgeYears ? `${f.owner.accountAgeYears.toFixed(1)} yrs` : "—";
  const verdict =
    llm?.analysis.verdict ??
    `${fmt(f.owner.posts)} posts to acquire ${fmt(f.owner.followers)} followers. You are not under-posting — you are mis-posting.`;
  const provenance = llm
    ? `${llm.meta.workstreams} workstreams · partner review ${llm.meta.reviewScore}/10`
    : `rule-derived · no model key`;

  const sectionHead = (n: string, kicker: string, title: string) =>
    `<div class="sec-head"><span class="sec-figure">${n}</span><div><div class="kicker">${esc(kicker)}</div><h2>${esc(title)}</h2></div></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Dossier · @${esc(f.owner.handle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"/>
<style>
  :root{
    --paper:#efe9dc; --paper2:#e6decd; --card:#f6f1e7;
    --ink:#14110b; --ink2:#4a4334; --blood:#cc1f1a; --blood-ink:#8f1410;
    --line:#cbc1ab; --good:#1f5c3d; --gold:#9a7019;
    --serif:"Fraunces",Georgia,"Times New Roman",serif;
    --read:"Newsreader",Georgia,serif;
    --mono:"Space Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;
  }
  *{box-sizing:border-box}
  html{-webkit-font-smoothing:antialiased}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--read);font-size:17px;line-height:1.5;
    background-image:radial-gradient(var(--paper2) 1px,transparent 1px);background-size:4px 4px}
  /* grain overlay */
  body::before{content:"";position:fixed;inset:0;z-index:9999;pointer-events:none;opacity:.05;mix-blend-mode:multiply;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .wrap{max-width:1040px;margin:0 auto;padding:0 40px 120px}
  .mono{font-family:var(--mono)}
  a{color:var(--blood-ink)}

  /* ── masthead ── */
  .masthead{background:var(--ink);color:var(--paper);padding:0}
  .masthead .inner{max-width:1040px;margin:0 auto;padding:34px 40px 30px;border-bottom:6px solid var(--blood)}
  .brandline{display:flex;justify-content:space-between;align-items:baseline;font-family:var(--mono);
    font-size:11px;letter-spacing:.34em;text-transform:uppercase;color:#b9ad93}
  .brandline .stamp{color:var(--blood);border:1px solid var(--blood);padding:3px 8px;letter-spacing:.2em;transform:rotate(-1.5deg)}
  .doc-title{font-family:var(--serif);font-weight:800;font-size:clamp(46px,9vw,104px);line-height:.92;
    letter-spacing:-.02em;margin:22px 0 10px}
  .doc-sub{font-family:var(--mono);font-size:13px;color:#d8cdb4;letter-spacing:.04em}
  .doc-sub b{color:var(--paper)}
  .doc-meta{font-family:var(--mono);font-size:11px;color:#8a7f68;margin-top:16px;line-height:1.7;letter-spacing:.02em}

  /* ── sections ── */
  section{margin-top:84px;animation:rise .8s cubic-bezier(.2,.7,.2,1) both}
  section:nth-of-type(1){animation-delay:.05s}section:nth-of-type(2){animation-delay:.12s}
  section:nth-of-type(3){animation-delay:.19s}section:nth-of-type(4){animation-delay:.26s}
  section:nth-of-type(5){animation-delay:.33s}section:nth-of-type(6){animation-delay:.4s}
  section:nth-of-type(7){animation-delay:.47s}
  @keyframes rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
  .sec-head{display:flex;gap:22px;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:34px}
  .sec-figure{font-family:var(--mono);font-weight:700;font-size:15px;color:var(--blood);padding-top:12px}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--ink2)}
  h2{font-family:var(--serif);font-weight:600;font-size:clamp(30px,5vw,46px);line-height:1;letter-spacing:-.015em;margin:6px 0 0}

  /* ── verdict ── */
  .verdict{font-family:var(--serif);font-style:italic;font-weight:500;font-size:clamp(28px,4.6vw,48px);
    line-height:1.12;letter-spacing:-.015em;color:var(--ink);max-width:22ch;margin:0 0 8px}
  .verdict .hl{background:linear-gradient(transparent 62%,rgba(204,31,26,.28) 62%)}
  .verdict-mark{font-family:var(--serif);font-size:90px;line-height:0;color:var(--blood);vertical-align:-.35em;margin-right:6px}

  /* ── headline KPI strip ── */
  .kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);margin-top:44px;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink)}
  .kpi{padding:22px 20px;border-right:1px solid var(--line)}
  .kpi:last-child{border-right:0}
  .kpi .v{font-family:var(--serif);font-weight:800;font-size:clamp(34px,5vw,52px);line-height:1;letter-spacing:-.02em}
  .kpi.bad .v{color:var(--blood)}
  .kpi .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin-top:10px}
  .kpi .s{font-family:var(--mono);font-size:11px;color:#9b9079;margin-top:3px}

  /* ── stat grid ── */
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}
  .stat{background:var(--card);padding:20px 18px}
  .stat-value{font-family:var(--mono);font-weight:700;font-size:26px;letter-spacing:-.01em;color:var(--ink)}
  .stat-bad .stat-value{color:var(--blood)}
  .stat-label{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);margin-top:9px}
  .stat-sub{font-family:var(--mono);font-size:11px;color:#9b9079;margin-top:3px}

  /* ── panels / charts ── */
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:34px}
  .panel{padding:0}
  .panel h3{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);
    margin:0 0 18px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .bars{display:flex;flex-direction:column;gap:12px}
  .bar-row{display:grid;grid-template-columns:130px 1fr 70px;align-items:center;gap:12px;font-family:var(--mono);font-size:12px}
  .bar-track{background:var(--paper2);height:18px;border:1px solid var(--line)}
  .bar-fill{height:100%;background:var(--ink)}
  .bar-fill.fill-red{background:var(--blood)}
  .bar-val{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  .bar-note{display:block;font-size:10px;color:#9b9079;font-weight:400;letter-spacing:.04em}
  .hours{display:flex;align-items:flex-end;gap:3px;height:140px;border-bottom:2px solid var(--ink);padding-bottom:0}
  .hour-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
  .hour-bar{width:100%;background:var(--ink);min-height:0}
  .hour-bar.peak{background:var(--blood)}
  .hour-tick{font-family:var(--mono);font-size:9px;color:#9b9079;margin-top:5px;height:11px}

  /* ── posts table ── */
  table.posts{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:13px}
  table.posts th{text-align:left;border-bottom:2px solid var(--ink);padding:10px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:var(--ink2)}
  table.posts td{border-bottom:1px solid var(--line);padding:13px 10px;vertical-align:top}
  .post-rank{color:var(--blood);font-weight:700;width:28px}
  .post-text{font-family:var(--read);font-size:15px;color:var(--ink);line-height:1.4}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}

  /* ── chips ── */
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{font-family:var(--mono);font-size:12px;border:1px solid var(--ink);padding:5px 11px;background:transparent;color:var(--ink)}
  .story{padding:12px 0;border-bottom:1px solid var(--line)}
  .story .cat{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--blood);font-weight:700}
  .story .nm{font-family:var(--read);font-weight:600;font-size:15px;margin-top:3px}
  .story .hk{font-size:13px;color:var(--ink2);line-height:1.4}

  /* ── findings ── */
  .finding{display:grid;grid-template-columns:64px 1fr;gap:8px;padding:26px 0;border-bottom:1px solid var(--line)}
  .finding:first-of-type{border-top:1px solid var(--line)}
  .f-idx{font-family:var(--mono);font-weight:700;font-size:13px;color:var(--blood);padding-top:8px}
  .f-stat{font-family:var(--serif);font-weight:600;font-size:23px;line-height:1.18;letter-spacing:-.01em;color:var(--ink)}
  .f-diag{margin:10px 0;color:var(--ink2);font-size:16px;max-width:62ch}
  .f-fix{font-family:var(--mono);font-size:13px;color:var(--good);font-weight:700;letter-spacing:.01em;max-width:70ch;line-height:1.5}
  .f-fix:before{content:"→ FIX ";color:var(--blood)}

  /* ── recs ── */
  table.recs{width:100%;border-collapse:collapse;font-family:var(--read);font-size:15px}
  table.recs th{text-align:left;background:var(--ink);color:var(--paper);padding:12px 14px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.16em}
  table.recs td{border-bottom:1px solid var(--line);padding:15px 14px;vertical-align:top}
  table.recs td.move{font-family:var(--serif);font-weight:600;font-size:17px;width:30%}
  .pill{display:inline-block;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 9px;text-transform:uppercase;border:1px solid currentColor}
  .pill.High{color:var(--blood)} .pill.Medium{color:var(--gold)} .pill.Low{color:var(--good)}

  .muted{color:var(--ink2)}
  .footer{margin-top:90px;border-top:6px solid var(--blood);padding-top:20px;font-family:var(--mono);font-size:11px;color:var(--ink2);line-height:1.8;letter-spacing:.02em}

  @media (max-width:760px){
    .wrap,.masthead .inner{padding-left:22px;padding-right:22px}
    .kpi-strip,.stats{grid-template-columns:repeat(2,1fr)}
    .grid2{grid-template-columns:1fr}
    .finding{grid-template-columns:1fr}.f-idx{padding-top:0}
    .bar-row{grid-template-columns:92px 1fr 56px}
  }
  @media print{body::before{display:none}section{animation:none}.masthead{background:var(--ink)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body>
  <header class="masthead"><div class="inner">
    <div class="brandline"><span>🐙 Tentacle&nbsp;Partners — Growth&nbsp;Intelligence</span><span class="stamp">Confidential Dossier</span></div>
    <h1 class="doc-title">${esc(f.owner.name || f.owner.handle)}</h1>
    <div class="doc-sub">@${esc(f.owner.handle)} &nbsp;·&nbsp; <b>${fmt(f.owner.followers)}</b> followers &nbsp;·&nbsp; <b>${age}</b> on platform &nbsp;·&nbsp; <b>${fmt(f.owner.posts)}</b> lifetime posts</div>
    <div class="doc-meta">SUBJECT FILE · @${esc(f.owner.handle).toUpperCase()} &nbsp;|&nbsp; SNAPSHOT ${esc(f.capturedAt || "—")} &nbsp;|&nbsp; BASIS ${f.sample.authored} AUTHORED POSTS (${f.sample.withViews} WITH REACH DATA) &nbsp;|&nbsp; ${esc(provenance).toUpperCase()} &nbsp;|&nbsp; METRICS COMPUTED IN CODE</div>
  </div></header>

  <div class="wrap">

  <section>
    ${sectionHead("01", "Bottom line up front", "The verdict")}
    <p class="verdict"><span class="verdict-mark">“</span>${esc(verdict)}</p>
    <div class="kpi-strip">
      <div class="kpi ${f.ratios.followersPerPost < 1 ? "bad" : ""}"><div class="v">${f.ratios.followersPerPost.toFixed(2)}</div><div class="l">Followers / post</div><div class="s">${fmt(f.owner.posts)} posts</div></div>
      <div class="kpi ${f.ratios.followerToFollowing < 1.5 ? "bad" : ""}"><div class="v">${f.ratios.followerToFollowing.toFixed(2)}</div><div class="l">Follower : following</div><div class="s">${fmt(f.owner.followers)} / ${fmt(f.owner.following)}</div></div>
      <div class="kpi ${pct(f.sample.original, f.sample.authored) < 25 ? "bad" : ""}"><div class="v">${pct(f.sample.original, f.sample.authored)}%</div><div class="l">Original content</div><div class="s">${f.sample.original}/${f.sample.authored} authored</div></div>
      <div class="kpi ${f.engagement.totalBookmarks === 0 ? "bad" : ""}"><div class="v">${fmt(f.engagement.totalBookmarks)}</div><div class="l">Bookmarks earned</div><div class="s">save signal</div></div>
    </div>
  </section>

  <section>
    ${sectionHead("02", "Diagnostic at a glance", "The numbers")}
    <div class="stats">
      ${statCard("Avg views / post", fmt(f.engagement.avgViews), `median ${fmt(f.engagement.medianViews)}`)}
      ${statCard("Avg engagement rate", f.engagement.avgEngagementRatePct.toFixed(1) + "%", "of impressions")}
      ${statCard("Avg likes / post", f.engagement.avgLikesPerAuthored.toFixed(1), `${fmt(f.engagement.totalLikesReceived)} in sample`)}
      ${statCard("Posts / day (life)", f.ratios.postsPerDay ? f.ratios.postsPerDay.toFixed(1) : "—", "consistency")}
      ${statCard("Likes given out", fmt(f.owner.likesGiven), "vs received")}
      ${statCard("Media usage", pct(f.sample.withMedia, f.sample.authored) + "%", `${f.sample.withMedia}/${f.sample.authored} posts`)}
      ${statCard("Times listed", fmt(f.owner.listed), "curation")}
      ${statCard("Bio", f.owner.bioPresent ? "Set" : "EMPTY", "profile real estate", !f.owner.bioPresent)}
    </div>
  </section>

  <section>
    ${sectionHead("03", "How you show up", "Content mix & cadence")}
    <div class="grid2">
      <div class="panel"><h3>Content mix · recent posts</h3>
        ${hbars(f.contentMix.map((c) => ({ label: c.label, value: c.count })), true)}
        <p class="muted" style="margin-top:16px;font-size:13px;font-family:var(--mono)">Originals build a voice. Retweets &amp; quotes amplify others, not you.</p>
      </div>
      <div class="panel"><h3>When you post · hour of day, IST</h3>
        ${hourChart(f.cadenceByHourIST)}
        <p class="muted" style="margin-top:12px;font-size:13px;font-family:var(--mono)">Distribution of authored posts across the day.</p>
      </div>
    </div>
  </section>

  <section>
    ${sectionHead("04", "Reach & engagement", "Your best posts")}
    ${topPostsTable(f.topPosts)}
    <div class="grid2" style="margin-top:30px">
      <div class="panel"><h3>Format lift · avg views</h3>
        ${hbars([{ label: "With media", value: f.formatLift.mediaAvgViews, note: "avg views" }, { label: "Text only", value: f.formatLift.textAvgViews, note: "avg views" }])}
      </div>
      <div class="panel"><h3>Hashtags you use</h3>
        ${f.hashtags.length ? `<div class="chips">${f.hashtags.map((h) => `<span class="chip">#${esc(h.tag)} ·${h.count}</span>`).join("")}</div>` : `<p class="muted" style="font-family:var(--mono);font-size:13px">You use almost no hashtags — neither discoverable nor noisy.</p>`}
      </div>
    </div>
  </section>

  <section>
    ${sectionHead("05", "Positioning", "Where the algorithm files you")}
    <div class="grid2">
      <div class="panel"><h3>X groups you with</h3>
        <div class="chips">${f.niche.recommendations.map((r) => `<span class="chip">@${esc(r.handle)}</span>`).join("") || '<span class="muted">none captured</span>'}</div>
        <h3 style="margin-top:26px">Biggest accounts you follow</h3>
        ${hbars(f.niche.following.slice(0, 6).map((u) => ({ label: "@" + u.handle, value: u.followers })))}
      </div>
      <div class="panel"><h3>Trending now</h3>
        <div class="chips">${f.market.trends.map((t) => `<span class="chip">${esc(t.name)}</span>`).join("") || '<span class="muted">none</span>'}</div>
        <h3 style="margin-top:26px">Story angles in the air</h3>
        ${f.market.stories.map((s) => `<div class="story"><div class="cat">${esc(s.category || "")}</div><div class="nm">${esc(s.name)}</div><div class="hk">${esc((s.hook || "").slice(0, 120))}</div></div>`).join("") || '<p class="muted">none captured</p>'}
      </div>
    </div>
  </section>

  <section>
    ${sectionHead("06", "No feelings spared", "The brutal truth")}
    ${findings.map((f2, i) => `<div class="finding"><div class="f-idx">${pad2(i + 1)}</div><div><div class="f-stat">${esc(f2.stat)}</div><div class="f-diag">${esc(f2.diagnosis)}</div><div class="f-fix">${esc(f2.fix)}</div></div></div>`).join("")}
  </section>

  <section>
    ${sectionHead("07", "The play", "Prioritized growth moves")}
    <table class="recs"><thead><tr><th>Move</th><th>Why it matters</th><th>Impact</th><th>Effort</th></tr></thead>
    <tbody>${recs.map((r) => `<tr><td class="move">${esc(r.move)}</td><td>${esc(r.why)}</td><td><span class="pill ${r.impact}">${r.impact}</span></td><td><span class="pill ${r.effort}">${r.effort}</span></td></tr>`).join("")}</tbody></table>
  </section>

  <div class="footer">🐙 XXX-TENTACLES · GROWTH DOSSIER · GENERATED FROM BUFFER/X.DB · NO FEELINGS SPARED, NO NUANCE WASTED.
    <br>${esc(provenance).toUpperCase()} · NUMBERS COMPUTED IN CODE (DATA ROOM); THE MODEL ONLY INTERPRETS THEM.</div>
  </div>
</body></html>`;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const f = computeFactBase();
  console.log(dim("\n  Data Room: fact base computed from buffer/x.db."));
  const llm = await analyze(f, { log: (m) => console.log(dim(`  · ${m}`)) }).catch((e) => {
    console.log(dim(`  · LLM analysis failed (${e.message}); falling back to rule-derived.`));
    return null;
  });

  // Stage 4: let the model DESIGN the HTML; fall back to the code template.
  let html: string | null = null;
  let source = "code-rendered template";
  if (llm) {
    console.log(dim("  · designer: generating HTML…"));
    html = await designHtml(f, llm.analysis).catch((e) => {
      console.log(dim(`  · designer failed (${e.message}); using template.`));
      return null;
    });
    if (html) source = "LLM-designed";
  }
  if (!html) html = render(f, llm);

  writeFileSync(OUT, html);
  console.log(`\n  \x1b[1m✓ Growth diagnostic written to ${OUT}\x1b[0m  ${dim(`(${source})`)}`);
  console.log(dim(`  Open it:  open ${OUT}\n`));
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
