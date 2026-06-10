/**
 * Code-rendered fallback for the dossier (used when no LLM design is available).
 * Editorial brutalist "confidential talent file" — bone paper, ink, blood-red.
 */
import type { PersonalityMap } from "./profiler.js";
import type { Evidence } from "./evidence.js";

const esc = (s: string) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join("");
const chips = (xs: string[]) => xs.map((x) => `<span class="chip">${esc(x)}</span>`).join("");

export function renderDossier(m: PersonalityMap, e: Evidence): string {
  const o = e.facts.owner;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Dossier · ${esc(o.name || o.handle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&family=Newsreader:opsz,wght@6..72,300..600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>
<style>
  :root{--paper:#efe9dc;--card:#f6f1e7;--ink:#14110b;--ink2:#4a4334;--blood:#cc1f1a;--line:#cbc1ab;--good:#1f5c3d;
    --serif:"Fraunces",Georgia,serif;--read:"Newsreader",Georgia,serif;--mono:"Space Mono",monospace}
  *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--read);font-size:17px;line-height:1.5}
  body::before{content:"";position:fixed;inset:0;z-index:99;pointer-events:none;opacity:.05;mix-blend-mode:multiply;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .wrap{max-width:980px;margin:0 auto;padding:0 40px 120px}
  .mast{background:var(--ink);color:var(--paper);padding:40px}
  .mast .in{max-width:980px;margin:0 auto;border-bottom:6px solid var(--blood);padding-bottom:26px}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--blood)}
  .arch{font-family:var(--serif);font-weight:800;font-size:clamp(42px,8vw,92px);line-height:.95;letter-spacing:-.02em;margin:14px 0 6px}
  .tag{font-family:var(--mono);font-size:14px;color:#d8cdb4}
  .who{font-family:var(--mono);font-size:11px;color:#8a7f68;margin-top:14px;letter-spacing:.04em}
  section{margin-top:64px;animation:rise .8s cubic-bezier(.2,.7,.2,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  .kick{font-family:var(--mono);font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--blood)}
  h2{font-family:var(--serif);font-weight:600;font-size:clamp(26px,4vw,40px);margin:6px 0 22px;border-bottom:2px solid var(--ink);padding-bottom:10px}
  .essence{font-family:var(--serif);font-style:italic;font-size:clamp(26px,4.4vw,44px);line-height:1.15;max-width:24ch;color:var(--ink)}
  .essence .q{color:var(--blood);font-size:1.4em;vertical-align:-.2em}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:36px}
  .panel h3{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);margin:0 0 12px;border-bottom:1px solid var(--line);padding-bottom:7px}
  ul{margin:0;padding-left:20px}li{margin:5px 0}
  .chips{display:flex;flex-wrap:wrap;gap:8px}.chip{font-family:var(--mono);font-size:12px;border:1px solid var(--ink);padding:5px 11px}
  .judge{background:var(--ink);color:var(--paper);padding:32px;margin-top:10px}
  .judge .rate{font-family:var(--serif);font-weight:800;font-size:72px;line-height:1;color:var(--blood)}
  .judge .rate small{font-family:var(--mono);font-size:14px;color:#8a7f68}
  .judge h3{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#d8cdb4;margin:22px 0 4px}
  .judge p{margin:0;color:#efe9dc}
  .play{background:var(--card);border:1px solid var(--line);padding:28px;margin-top:10px}
  .play .bio{font-family:var(--serif);font-size:22px;font-style:italic;border-left:4px solid var(--blood);padding-left:16px;margin:16px 0}
  .pillars{display:flex;flex-wrap:wrap;gap:8px}.pillars .chip{border-color:var(--blood);color:var(--blood)}
  ol{margin:10px 0 0;padding-left:22px}ol li{margin:7px 0}
  .foot{margin-top:80px;border-top:6px solid var(--blood);padding-top:18px;font-family:var(--mono);font-size:11px;color:var(--ink2);letter-spacing:.04em}
  @media(max-width:720px){.wrap,.mast{padding-left:22px;padding-right:22px}.grid2{grid-template-columns:1fr}}
</style></head><body>
<header class="mast"><div class="in">
  <div class="eyebrow">🐙 Tentacle Partners · Confidential Talent Dossier</div>
  <div class="arch">${esc(m.archetype.name)}</div>
  <div class="tag">${esc(m.archetype.tagline)}</div>
  <div class="who">SUBJECT · ${esc(o.name || o.handle).toUpperCase()} · @${esc(o.handle).toUpperCase()} · ${o.followers} FOLLOWERS · ${o.accountAgeYears?.toFixed(1) ?? "?"} YRS ON PLATFORM</div>
</div></header>
<div class="wrap">
  <section><div class="kick">The read</div><h2>Essence</h2>
    <p class="essence"><span class="q">“</span>${esc(m.essence)}</p></section>

  <section><div class="kick">Who they are</div><h2>The personality</h2>
    <div class="grid2">
      <div class="panel"><h3>Traits</h3><ul>${list(m.personality.traits)}</ul>
        <h3 style="margin-top:20px">Temperament</h3><p>${esc(m.personality.temperament)}</p></div>
      <div class="panel"><h3>What drives them</h3><ul>${list(m.personality.drivers)}</ul>
        <h3 style="margin-top:20px">Voice</h3><p>${esc(m.voice.signature)}</p><div class="chips" style="margin-top:8px">${chips(m.voice.tics)}</div></div>
    </div></section>

  <section><div class="kick">The map</div><h2>Lanes, values & tribe</h2>
    <div class="grid2">
      <div class="panel"><h3>Ownable lanes</h3><div class="chips">${chips(m.themes)}</div>
        <h3 style="margin-top:20px">Values</h3><ul>${list(m.values)}</ul></div>
      <div class="panel"><h3>Enemies</h3><ul>${list(m.enemies)}</ul>
        <h3 style="margin-top:20px">In-group</h3><div class="chips">${chips(m.inGroup)}</div></div>
    </div>
    <div class="grid2" style="margin-top:30px">
      <div class="panel"><h3>Strengths</h3><ul>${list(m.strengths)}</ul></div>
      <div class="panel"><h3>Liabilities</h3><ul>${list(m.liabilities)}</ul></div>
    </div></section>

  <section><div class="kick">No feelings spared</div><h2>The judgment</h2>
    <div class="judge">
      <div class="rate">${m.judgment.starRating}<small>/10 star potential</small></div>
      <h3>Most marketable</h3><p>${esc(m.judgment.marketable)}</p>
      <h3>What's holding them back</h3><p>${esc(m.judgment.holdingBack)}</p>
      <h3>The uncomfortable truth</h3><p>${esc(m.judgment.uncomfortableTruth)}</p>
    </div></section>

  <section><div class="kick">The play</div><h2>Positioning</h2>
    <div class="play">
      <p><b>Persona:</b> ${esc(m.positioning.persona)}</p>
      <p><b>Lane to own:</b> ${esc(m.positioning.lane)}</p>
      <p style="margin-top:14px"><b>Content pillars</b></p><div class="pillars">${chips(m.positioning.pillars)}</div>
      <p style="margin-top:14px"><b>New bio</b></p><div class="bio">${esc(m.positioning.newBio)}</div>
      <p><b>90-day plan</b></p><ol>${list(m.positioning.ninetyDayPlan)}</ol>
      <p style="margin-top:14px"><b>Audience to court:</b> ${esc(m.positioning.audience)}</p>
    </div></section>

  <div class="foot">🐙 XXX-TENTACLES · TALENT DOSSIER · BUILT FROM REAL X BEHAVIOR · INTERPRETATION BY MODEL, EVIDENCE BY CODE.</div>
</div></body></html>`;
}
