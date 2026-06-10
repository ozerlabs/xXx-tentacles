<div align="center">

# 🐙 xXx-tentacles

### **3x your X.com — with agents that wrap around everything.**

*A swarm of autonomous AI agents that run your X like a Hollywood studio runs a star.*

<br>

![status](https://img.shields.io/badge/status-data_foundation_live-00d26a?style=flat-square)
![stack](https://img.shields.io/badge/stack-TypeScript-3178c6?style=flat-square)
![brain](https://img.shields.io/badge/brain-DeepSeek-5b6ee1?style=flat-square)
![nuance](https://img.shields.io/badge/nuance-0%25-red?style=flat-square)

</div>

<br>

You've got two hands and one timeline. **xXx-tentacles gives you tentacles** — a pit of autonomous agents, each gripping a different lever: one gets to know you, one runs the show, one writes the posts, one watches the numbers and squeezes harder where it's working.

You don't manage them. They manage **you** — toward one outcome:

<div align="center">

### you, 3x bigger.

</div>

---

## ⚡ The uncomfortable truth

> **X.com doesn't reward nuance. It rewards extremes.**

Politics, tech, movies, takes — nothing goes viral by being measured and fair. The timeline is a knife fight, and *"I want to please everyone"* is how you stay at 200 followers forever. Everybody's there to fuck with each other. The accounts that win figured that out.

Most growth tools hand you a content calendar and a pat on the head. **xXx-tentacles hands you a pit of agents that have watched a thousand careers die from politeness — and refuse to let yours be next.**

---

## 🩸 What's live: the data foundation

Agents are only as sharp as what they know. So the foundation comes first — the part that reads your **real** X and remembers it.

No paid API. No scraping farm. **Your own logged-in browser**, driven once by hand, then read like a human: it watches the timeline X's own app loads and harvests the data straight from the inside. Read-only — nothing posts, nothing touches your credentials.

| Stage | Command | What it does |
|---|---|---|
| 🔑 **Sign in** | `npm run x:login` | You log in by hand once. Cookies saved locally, gitignored. No credentials in the repo. |
| 👁️ **Recon** | `npm run x:recon` | Browses like a human and captures X's internal data — your posts, followers, timeline — plus a map of the API. |
| 🗄️ **Ingest** | `npm run x:ingest` | Parses the capture into `buffer/x.db` — a local SQLite store of users, tweets, and the follow graph. |

That buffer is the long-term memory the whole swarm will feed on.

---

## 🐙 The tentacles &nbsp;·&nbsp; <sub>in the lab</sub>

Every tentacle is an autonomous agent. Together they're your studio. The first generation taught us the shape — now they're being rebuilt sharper on top of the data foundation.

| | Tentacle | What it grips | Status |
|---|---|---|---|
| 🐙 | **The Interrogator** | Profiles you to the bone. Roasts, pries, and won't stop until it *gets* you. | 🧪 rebuilding |
| 🐙 | **The Show Runner** | Plans the week as a narrative arc, then finds the spiciest post per beat. | 🧪 rebuilding |
| 🐙 | **The Writer** | Schedules each post to its peak hour and ships it. | 🧪 rebuilding |
| 🐙 | **The Analyst** | Grades the week on real numbers, then steers the next one. Closes the loop. | 🧪 rebuilding |

> A tentacle that doesn't know your edges can't sharpen them. That's why the data comes first — and why the next generation of agents reads from your real timeline, not a guess.

---

## 🚀 Quickstart

```bash
# 1. install
npm install

# 2. add your key
cp .env.example .env        # then paste your DEEPSEEK_API_KEY

# 3. sign in to X by hand (once)
npm run x:login

# 4. read your timeline from the inside (read-only — nothing posts)
npm run x:recon

# 5. store it in the local buffer
npm run x:ingest
```

> `x:login` opens a real browser — sign in by hand (username/password, **not** "Sign in with Google"), and your session is saved locally. `x:recon` reuses it to browse like a human and capture X's internal data to `.x-recon/`. `x:ingest` parses that into `buffer/x.db`. All read-only; nothing is ever posted.

---

## 🧠 Why "tentacles"

Growth isn't one move — it's a dozen, all at once, all the time.

> One agent is a chatbot. A **swarm** of specialized agents, each gripping a different part of your presence and pulling the same direction, is a machine.

That's the **3x**. You bring the raw material — a person worth paying attention to. The tentacles make the world pay attention.

---

## 🎯 Who it's for

<table>
<tr>
<th align="left">✅ &nbsp;Built for you if…</th>
<th align="left">❌ &nbsp;Not for you if…</th>
</tr>
<tr>
<td valign="top">

- You know you should be posting — and aren't
- You've got takes you're too polite to ship
- You're tired of louder, dumber accounts lapping you

</td>
<td valign="top">

- You want to "stay on brand" and offend no one
- You think the timeline is fair
- You'd rather feel comfortable than get big

</td>
</tr>
</table>

---

## 🗺️ Roadmap

- [x] 🩸 **Data foundation** — read your real X, store it · `x:login` → `x:recon` → `x:ingest`
- [ ] 🔄 **Live crawler** — paginate past the first scroll, refresh on a schedule
- [ ] 🐙 **The Interrogator** — profiles you into a dossier the swarm feeds on
- [ ] 🐙 **The Show Runner** — plans the week as a narrative arc
- [ ] 🐙 **The Writer** — schedules to peak hours and ships
- [ ] 🐙 **The Analyst** — grades on real numbers from the buffer, steers the next week

---

<div align="center">

**No feelings spared. No nuance wasted. Just growth, over and over again.**

*The show starts the moment you sit in the chair.*

<br>

<sub>⚠️ Built to be brutal, not reckless. The tentacles push hard on edge and extremes — they won't push you off a cliff that gets you banned. 3x means you keep growing, not flame out in a week.</sub>

</div>
