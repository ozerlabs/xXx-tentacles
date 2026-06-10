/**
 * The augmented LLM — the one seam between the swarm and the model.
 *
 * DeepSeek through the OpenAI SDK (see stack decisions). Every tentacle calls
 * the model through `callJSON`, which forces JSON output and validates it against
 * a zod schema, retrying on malformed JSON (DeepSeek occasionally drifts at higher
 * temperature) rather than dropping the result.
 */
import "dotenv/config";
import OpenAI from "openai";
import type { z } from "zod";

const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

/** True once a key is configured. Callers fall back gracefully when false. */
export function hasLLM(): boolean {
  return Boolean(API_KEY);
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!API_KEY) throw new Error("DEEPSEEK_API_KEY is missing — copy .env.example to .env and fill it in.");
  _client ??= new OpenAI({ apiKey: API_KEY, baseURL: "https://api.deepseek.com" });
  return _client;
}

type Msg = OpenAI.Chat.ChatCompletionMessageParam;

/**
 * Call the model for free-form TEXT (no JSON). Used when the deliverable IS the
 * raw output — e.g. the designer stage generating a full HTML document.
 */
export async function callText(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const { temperature = 0.8, maxTokens = 8000 } = opts;
  const res = await client().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content ?? "";
}

/**
 * Call the model and validate the JSON response against `schema`.
 * Retries on parse/validation failure (default 2 extra attempts).
 */
export async function callJSON<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  opts: { temperature?: number; retries?: number } = {}
): Promise<T> {
  const { temperature = 0.6, retries = 2 } = opts;
  const messages: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client().chat.completions.create({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature,
      });
      return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
