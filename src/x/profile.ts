/**
 * `npm run x:profile` — the Profiler deliverable.
 *
 * Evidence Room → 5 read passes → Personality Map → partner review → dossier.
 * Writes buffer/dossier.json (the structured "know you" memory the swarm reads)
 * and buffer/dossier.html (the visual talent file). Requires an LLM key — the
 * profiler is interpretation end-to-end; with no key it explains how to set one.
 */
import { writeFileSync } from "node:fs";
import { hasLLM } from "../llm.js";
import { buildEvidence } from "./evidence.js";
import { profile } from "./profiler.js";
import { designDossier } from "./designer.js";
import { renderDossier } from "./dossier-template.js";

const JSON_OUT = "buffer/dossier.json";
const HTML_OUT = "buffer/dossier.html";
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function main() {
  if (!hasLLM()) {
    console.error("\n✗ The Profiler needs a model. Copy .env.example to .env and set DEEPSEEK_API_KEY.\n");
    process.exit(1);
  }

  console.log(dim("\n  Evidence Room: gathering behavioral evidence from buffer/x.db…"));
  const evidence = buildEvidence();

  const result = await profile(evidence, { log: (m) => console.log(dim(`  · ${m}`)) });
  if (!result) {
    console.error("\n✗ Profiling failed (no reads returned). Check the API key / connection.\n");
    process.exit(1);
  }

  writeFileSync(JSON_OUT, JSON.stringify(result.map, null, 2));

  console.log(dim("  · designing the dossier…"));
  let html = await designDossier(result.map, evidence).catch(() => null);
  let source = "LLM-designed";
  if (!html) {
    html = renderDossier(result.map, evidence);
    source = "code template";
  }
  writeFileSync(HTML_OUT, html);

  const m = result.map;
  console.log(bold(`\n  ✓ "${m.archetype.name}" — ${m.archetype.tagline}`));
  console.log(`  ${dim("essence:")} ${m.essence}`);
  console.log(`  ${dim("star potential:")} ${m.judgment.starRating}/10  ${dim(`· review ${result.meta.reviewScore}/10`)}`);
  console.log(`\n  ${bold("→")} ${JSON_OUT}   (the structured map)`);
  console.log(`  ${bold("→")} ${HTML_OUT}   ${dim(`(${source})`)}`);
  console.log(dim(`  Open it:  open ${HTML_OUT}\n`));
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
