# Agent Orchestration — xXx-tentacles

How we build the swarm. Grounded in Anthropic's [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents), mapped onto our actual system: the local `buffer/x.db`, the relevance layer (Phase 2b), and the four tentacles.

---

## 0. The one rule that overrides the rest

> **Find the simplest thing that works. Add orchestration only when a simpler version demonstrably falls short.**

Agentic systems trade latency and cost for capability. Most of our pipeline is *predictable* — it should be **workflows** (LLM steps wired through code we control), not autonomous agents. We reserve genuine autonomy for the two places the path genuinely can't be predicted in advance.

Two terms we'll use precisely:

- **Workflow** — LLM calls orchestrated through *predefined code paths*. Predictable, debuggable, cheap. Our default.
- **Agent** — the LLM *dynamically directs its own process and tool use* in a loop. Flexible, expensive, harder to control. Used sparingly.

---

## 1. The building block: our Augmented LLM

Every tentacle is the same core unit — an LLM (DeepSeek) augmented with three things, all of which we already have or are building:

| Augmentation | In our system |
|---|---|
| **Retrieval** | The relevance layer over `buffer/x.db` — pull the N most relevant tweets/accounts/trends for *this* decision (relevance × importance × recency), not the whole table. |
| **Memory** | The buffer itself (system of record) + `dossier.json` (who you are) + `learnings.json` (what worked). |
| **Tools** | Query the buffer, embed/retrieve, (later) post via the recon write-path. |

**Before reaching for any pattern below, ask: can one augmented-LLM call do this?** If yes, ship that.

---

## 2. The pattern catalog (and where each lives in our swarm)

### Prompt chaining — *sequential steps with gates*
Decompose a task into fixed steps; each LLM call works on the previous output; programmatic **gates** validate between steps.
- **Our use:** **The Writer.** Draft post → gate (length, on-voice, banned-topics check) → refine → schedule to peak hour. Deterministic; pure workflow.

### Routing — *classify, then send to a specialist*
Classify the input and dispatch to a prompt/model tuned for that class.
- **Our use:** **Beat-type routing** inside the Show Runner. A "hot take" beat, a "story-jacking a trend" beat, and a "reply-guy" beat want different generation prompts. Also **model routing** — cheap model for classification/cleanup, strong model for the spicy generation.

### Parallelization — *run several at once*
- **Sectioning:** split into independent subtasks run in parallel.
  - **Our use:** **The Analyst** scoring multiple dimensions at once (reach, resonance, virality, on-brand drift) — independent, parallel.
  - **Our use:** A **safety gate** running beside generation — one call writes the spiciest post, another independently screens it for ban-risk.
- **Voting:** run the *same* task N times for confidence / diversity.
  - **Our use:** **Tree-of-Thoughts in the Show Runner** — generate K candidate angles per beat, score each on virality × on-voice, ship the best. This is the heart of "spicy but on-brand."

### Orchestrator–workers — *a lead LLM decomposes and delegates dynamically*
Differs from parallelization: the subtasks are **not predefined** — the orchestrator decides them at runtime, then synthesizes.
- **Our use:** **The Show Runner as orchestrator.** It reads the dossier + this week's trends/stories and *decides* the week's beats (can't be hardcoded — depends on what's happening), delegates each beat to a writer-worker, then synthesizes the calendar.

### Evaluator–optimizer — *generator + critic loop*
One LLM generates, another critiques against clear criteria, loop until good enough.
- **Our use:** **The Interrogator/Profiler.** It drafts its understanding of you, self-scores confidence 0→10, and keeps probing until it hits "I get this person." Critic = the confidence score; optimizer = the next question.
- **Our use (macro):** the whole **Reflexion loop** is an evaluator-optimizer at system scale — the Analyst is the evaluator, the next Show Runner cycle is the optimizer.

### Autonomous agent — *loop with tools, ground truth, stopping conditions*
The model plans and acts over many turns, using tool feedback, until done or a checkpoint.
- **Our use:** mostly **avoided for v1.** The one candidate is the **deep-recon crawler** (Phase 2c) — "go fill the dangling pointers" (quoted tweets, threads, network tweets) is open-ended enough to justify it, with a hard iteration cap and read-only guardrail. Even there, a bounded workflow is the safer first cut.

---

## 3. Our orchestration design

The top level is a **workflow**, not an autonomous agent — a predefined Reflexion loop with agentic *sub-steps*:

```
                                  ┌─────────────────────────────────────┐
                                  │   buffer/x.db  +  relevance layer    │
                                  │  (accounts · tweets · edges ·         │
                                  │   trends · stories · recs)            │
                                  └─────────────────────────────────────┘
                                        ▲ retrieve            ▲ read/write
        ┌───────────────────────────────┼─────────────────────┼───────────────────────────┐
        │                                │                     │                           │
   ┌─────────┐  dossier.json     ┌──────────────┐  showplan   ┌────────┐  posted   ┌──────────┐
   │PROFILER │ ───────────────▶  │ SHOW RUNNER  │ ─────────▶  │ WRITER │ ───────▶  │ ANALYST  │
   │(eval-   │                   │(orchestrator │             │(prompt │           │(parallel │
   │ optim.) │                   │ + voting/ToT)│             │ chain) │           │ scoring) │
   └─────────┘                   └──────────────┘             └────────┘           └──────────┘
                                        ▲                                                │
                                        │              learnings.json                    │
                                        └────────────────────────────────────────────────┘
                                              (evaluator → optimizer, system scale)
```

Per-tentacle pattern assignment:

| Tentacle | Primary pattern | Why |
|---|---|---|
| **Profiler** ("know you") | Evaluator–optimizer | Adaptive: keep probing until confidence is high. Grounded in buffer data first, questions only for gaps. |
| **Show Runner** | Orchestrator–workers + voting (ToT) | Beats depend on live trends/stories → can't predefine; each beat's post is chosen from K voted candidates. |
| **Writer** | Prompt chaining + sectioned safety gate | Deterministic: draft → validate → refine → schedule. A parallel screener guards ban-risk. |
| **Analyst** | Parallelization (sectioning) | Score independent dimensions concurrently; **metrics computed in code, never by the LLM** (the LLM interprets, it doesn't self-grade). |
| **System loop** | Evaluator–optimizer workflow | Analyst grades on real numbers → learnings steer the next Show Runner cycle. |

---

## 4. Build order (the simplicity ladder)

Don't build the diagram above on day one. Climb:

1. **One augmented-LLM call** per job, reading straight from the buffer. Profiler that drafts a dossier from your real tweets — no loop yet.
2. **Add the gate/loop** only where step 1 visibly underperforms — e.g. the Profiler's confidence loop, the Writer's validation gate.
3. **Add voting** (ToT) to the Show Runner when single-shot posts are mediocre.
4. **Add orchestration** (dynamic beat decomposition) once the workers are good in isolation.
5. **Close the loop** (Analyst → learnings → Show Runner) last — it's only meaningful once we have temporal metrics (Phase 2a) to grade against.

Each rung must earn the next. If rung 1 is good enough for a job, stop there.

---

## 5. Agent–Computer Interface (our tools)

The article's hard-won lesson: they spent *more* time engineering tools than prompts. Our tools are the seam between the swarm and the buffer/X — they deserve that care.

- **Document every tool like a docstring for a junior dev** — what it returns, units, edge cases, an example call.
- **Poka-yoke:** make wrong calls hard. e.g. a `getMyTweets()` that can't accidentally return the home timeline; retrieval that requires an explicit `k` and intent.
- **Give the model room to think** before committing to an action (especially the Show Runner's beat decisions).
- **Ground every step in real data** — tool results from the buffer, never the model's recollection. Metrics especially: computed in code, handed to the LLM as facts.
- **Stopping conditions** on every loop (max questions for the Profiler, max iterations for any crawler) to keep control and bound cost.

---

## 6. Principles (pinned)

1. **Simplicity** — fewest moving parts that hit the goal.
2. **Transparency** — every tentacle shows its plan/score/reasoning; no silent magic.
3. **Well-crafted ACI** — invest in tools as much as prompts; ground truth at every step.

> One agent is a chatbot. A swarm of specialized agents — each gripping a different lever, grounded in your real data, pulling the same direction — is a machine. Build the machine one earned rung at a time.
