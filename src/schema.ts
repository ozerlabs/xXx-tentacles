import { z } from "zod";

/**
 * The Dossier — xXx-tentacles' long-term memory of the user.
 *
 * The Interrogator fills this in over the course of the loop. Every downstream
 * phase (strategy, content generation, posting) reads from it. The whole point
 * of the interrogation is to fill every field with something true and sharp.
 */
export const DossierSchema = z.object({
  /** Who they actually are underneath the avatar. */
  identity: z.string().describe("Who this person really is — job, age vibe, status, the real them"),
  /** What they genuinely care about / could talk about for hours. */
  interests: z.array(z.string()),
  /** Politics and — crucially — how extreme they're willing to go. */
  politics: z.object({
    lean: z.string().describe("Their actual political lean, no hedging"),
    extremity: z.number().min(0).max(10).describe("0 = milquetoast centrist, 10 = will start a war in the replies"),
  }),
  /** Tech / movies / culture takes — the lanes they can post in. */
  culture_takes: z.array(z.string()),
  /** Vices, guilty pleasures, kinks, the stuff they'd never admit at dinner. */
  vices: z.array(z.string()),
  /** Fears and insecurities — the soft tissue that makes posts feel human. */
  fears: z.array(z.string()),
  /** Ego — how they want the world to see them. */
  ego: z.array(z.string()),
  /** Who they want to dunk on. Enemies make engagement. */
  enemies: z.array(z.string()),
  /** Their voice — tone, cadence, how they actually talk. */
  voice: z.string(),
  /** Content pillars — the recurring lanes the tentacles will post in. */
  content_pillars: z.array(z.string()),
  /** Hot takes they secretly believe but are too polite to post. Gold. */
  hot_takes: z.array(z.string()),
});

export type Dossier = z.infer<typeof DossierSchema>;

/** What the model must return every single turn. */
export const TurnSchema = z.object({
  /** Brutal one-or-two-line reaction to their last answer. Empty on the first turn. */
  roast: z.string(),
  /** The next invasive question. null when done. */
  next_question: z.string().nullable(),
  /** Full replacement of the dossier as it stands right now. */
  dossier: DossierSchema,
  /** 0–10: how well the manager actually GETS this person. */
  confidence: z.number().min(0).max(10),
  /** What's still unknown — drives the next question. */
  gaps: z.array(z.string()),
  /** True only when confidence has hit 10 and the dossier is complete. */
  done: z.boolean(),
});

export type Turn = z.infer<typeof TurnSchema>;

/** Empty dossier to seed the first turn. */
export const EMPTY_DOSSIER: Dossier = {
  identity: "",
  interests: [],
  politics: { lean: "", extremity: 0 },
  culture_takes: [],
  vices: [],
  fears: [],
  ego: [],
  enemies: [],
  voice: "",
  content_pillars: [],
  hot_takes: [],
};
