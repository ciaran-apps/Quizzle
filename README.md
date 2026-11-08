# Quizzle

A daily quiz with General Knowledge, Pop Culture, Music Trivia and a Daily Mix. New questions every day, never repeated.

Live at **https://quiz.ciarandevine.uk** (install from Chrome: ⋮ → Install app).

## How the daily questions work

Every evening at about 20:17 UK winter time, the **Daily questions** GitHub Action (`.github/workflows/daily-questions.yml`) runs `scripts/generate.mjs`. It:

1. asks an AI for twice as many questions as needed,
2. has a second AI call fact-check them and drops anything doubtful,
3. drops anything already used before (tracked in `data/seen.json`),
4. saves tomorrow's set to `questions/YYYY-MM-DD.json`.

The app loads that day's file. If it's missing, it uses the free Open Trivia Database, then the questions built into `index.html`, so it always works.

The AI is **Google's Gemini API** on its free tier: no card and no charges. If it ever goes over the free limit, requests just fail for that day and the app uses its backup questions. This job uses about 10 requests a day.

## Setup (from a phone)

1. **Free Gemini key:** at aistudio.google.com tap **Get API key → Create API key**, copy it, then add it here under **Settings → Secrets and variables → Actions** as `GEMINI_API_KEY`.
2. **Make today's questions now:** **Actions → Daily questions → Run workflow**. It takes a few minutes.
3. **GitHub Pages:** **Settings → Pages**. Source: **Deploy from a branch**, branch **main**, folder **/(root)**. Custom domain: `quiz.ciarandevine.uk`.
4. **Cloudflare:** add a DNS record: type `CNAME`, name `quiz`, target `ciaran-apps.github.io`, proxy **off** (DNS only).

## Changing things

- **Topics, number of questions, how hard:** `scripts/generate.mjs` (`QUIZZES` and the rules in `draftQuestions`). If you add a topic, add it to `TOPICS` and `ORDER` in `index.html` too.
- **AI model:** `MODELS` in `scripts/generate.mjs`.
- **Icons:** `python3 scripts/make-icons.py`.

Don't delete `data/seen.json`, or old questions could come back.
