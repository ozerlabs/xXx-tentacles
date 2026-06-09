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

// ── Tentacle 2: The Show Runner ───────────────────────────────────────────────

/** The kinds of beats the Show Runner can call. Free-form, but these are the lanes. */
export const BEAT_TYPES = [
  "hot_take",
  "manufactured_beef",
  "vulnerable_arc",
  "callback_bit",
  "reply_bait",
  "flex",
  "contrarian_thread",
] as const;

/** A planned slot in the week — the skeleton, before posts are written. */
export const BeatSchema = z.object({
  day: z.string().describe("e.g. 'Mon', 'Tue' — the slot in the week"),
  type: z.string().describe(`one of: ${BEAT_TYPES.join(", ")}`),
  topic: z.string().describe("what it's about — tied to the user's lanes / live drama"),
  intent: z.string().describe("what this beat is supposed to DO for the arc / engagement"),
});
export type Beat = z.infer<typeof BeatSchema>;

/** The week skeleton produced by the planning step. */
export const WeekPlanSchema = z.object({
  arc: z.string().describe("the week's narrative throughline — the story being told"),
  beats: z.array(BeatSchema),
});
export type WeekPlan = z.infer<typeof WeekPlanSchema>;

/** One candidate post — a single branch in the Tree of Thoughts. */
export const PostCandidateSchema = z.object({
  angle: z.string().describe("the strategic angle this branch takes"),
  text: z.string().describe("the actual post, ready to ship"),
  virality: z.number().min(0).max(10).describe("engagement potential — reward for extremes"),
  on_voice: z.number().min(0).max(10).describe("how much it sounds like THIS user"),
  risk: z.string().describe("ban/cancel risk in a few words — keep it spicy, not suicidal"),
  why: z.string().describe("one line on why this lands"),
});
export type PostCandidate = z.infer<typeof PostCandidateSchema>;

/** The Tree-of-Thoughts output for a single beat: branches + the chosen one. */
export const BeatDraftSchema = z.object({
  candidates: z.array(PostCandidateSchema).min(2),
  chosen_index: z.number().int().min(0),
  reasoning: z.string().describe("why the chosen branch beats the others"),
});
export type BeatDraft = z.infer<typeof BeatDraftSchema>;

/** A fully-resolved slot: the beat plus its chosen post and the runners-up. */
export const SlotSchema = BeatSchema.extend({
  chosen: PostCandidateSchema,
  alternates: z.array(PostCandidateSchema),
  reasoning: z.string(),
});
export type Slot = z.infer<typeof SlotSchema>;

/** The finished plan written to showplan.json. */
export const ShowPlanSchema = z.object({
  arc: z.string(),
  slots: z.array(SlotSchema),
});
export type ShowPlan = z.infer<typeof ShowPlanSchema>;

// ── Tentacle 3: The Writer ────────────────────────────────────────────────────

/** One line in the posted log — what went out (or would have), when. */
export const PostedItemSchema = z.object({
  day: z.string(),
  type: z.string(),
  topic: z.string(),
  scheduled_for: z.string().describe("ISO timestamp the post is slotted for"),
  text: z.string(),
  status: z.string().describe("e.g. 'posted (dry-run)'"),
  id: z.string(),
  url: z.string(),
});
export type PostedItem = z.infer<typeof PostedItemSchema>;

// ──────────────────────────────────────────────────────────────────────────────

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
