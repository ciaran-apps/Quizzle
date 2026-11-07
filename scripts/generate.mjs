/**
 * Writes Quizzle's daily questions. Run by the GitHub Action in
 * .github/workflows/daily-questions.yml every evening.
 *
 * For each day it asks an AI for twice as many questions as needed, has a
 * second AI call fact-check them, drops anything doubtful or already used,
 * and saves the result to questions/YYYY-MM-DD.json, which the app reads.
 *
 * The AI is GitHub Models: free, built into GitHub Actions, no key or card.
 * Inside the Action it signs in with the repo's own GITHUB_TOKEN.
 *
 * Usage: node scripts/generate.mjs            (builds today and tomorrow if missing)
 *        node scripts/generate.mjs 2026-12-25 (builds that date if missing)
 * Needs the GITHUB_TOKEN environment variable (set automatically in the Action).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tried in order; if the first isn't available or is busy, the next is used.
const MODELS = (process.env.QUIZZLE_MODELS || "openai/gpt-4.1,openai/gpt-4o").split(",");
// Two addresses for the same free GitHub Models service; the second is a backup.
const ENDPOINTS = [
  "https://models.github.ai/inference/chat/completions",
  "https://models.inference.ai.azure.com/chat/completions",
];
const TIMEZONE = "Europe/London";   // when "today" flips over
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const QUIZZES = {
  general: {
    label: "General Knowledge",
    count: 5,
    brief: "General knowledge: geography, science, nature, history, food and drink, language and words, the human body, space, landmarks, inventions, sport.",
  },
  pop: {
    label: "Pop Culture",
    count: 5,
    brief: "Pop culture from the 1970s to today: films, TV (especially British TV), video games, toys and crazes, adverts, catchphrases, famous characters, viral moments, and celebrities' careers and achievements.",
  },
  music: {
    label: "Music Trivia",
    count: 5,
    brief: "Music from the 1960s to today: artists, bands, albums, song titles, UK chart history, Christmas number ones, festivals, Eurovision, instruments, music videos, band line-ups.",
  },
  mix: {
    label: "Daily Mix",
    count: 10,
    brief: "A roughly even mix of general knowledge, pop culture and music trivia.",
  },
};

/* ------------------------------------------------------------------ */

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.log("::warning::No GITHUB_TOKEN, so no questions were written. Run this from the GitHub Action.");
    return;
  }
  const dates = process.argv[2] ? [process.argv[2]] : [dateIn(TIMEZONE), dateIn(TIMEZONE, 1)];
  for (const date of dates) {
    const file = join(ROOT, "questions", `${date}.json`);
    if (existsSync(file)) { console.log(`${date}: already done`); continue; }
    console.log(`${date}: writing questions…`);
    const day = { date, quizzes: {} };
    for (const [key, cfg] of Object.entries(QUIZZES)) {
      day.quizzes[key] = await buildQuiz(key, cfg, date);
      console.log(`  ${cfg.label}: ${day.quizzes[key].length} questions`);
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(day, null, 1) + "\n");
  }
}

async function buildQuiz(key, cfg, date) {
  // seen.json = every question ever used, across all quizzes (so nothing repeats)
  const seen = new Set(await readJson("data/seen.json", []));
  // recent-<key>.json = latest questions in this category, shown to the AI so
  // it avoids the same facts even when worded differently
  const recent = await readJson(`data/recent-${key}.json`, []);

  const picked = [];
  for (let attempt = 0; attempt < 3 && picked.length < cfg.count; attempt++) {
    const avoid = [...recent, ...picked.map(asLine)].slice(-120);
    const drafts = await draftQuestions(cfg, cfg.count * 2, avoid, date);
    const checked = await factCheck(drafts);
    for (const q of checked) {
      const id = fingerprint(q.q);
      if (seen.has(id) || picked.some(p => fingerprint(p.q) === id)) continue;
      picked.push(q);
      if (picked.length === cfg.count) break;
    }
  }
  if (picked.length < cfg.count) {
    throw new Error(`Only got ${picked.length}/${cfg.count} good questions for ${cfg.label}`);
  }

  picked.forEach(q => seen.add(fingerprint(q.q)));
  await writeJson("data/seen.json", [...seen]);
  await writeJson(`data/recent-${key}.json`, [...recent, ...picked.map(asLine)].slice(-600));
  return picked;
}

/* ---------- AI calls ---------- */

async function draftQuestions(cfg, n, avoid, date) {
  const prompt = `Write ${n} multiple-choice questions for the "${cfg.label}" quiz on ${date} in Quizzle, a daily quiz app for a UK audience.

Topic: ${cfg.brief}

Rules:
- Every fact must be well established and easy to verify. Nothing from the last 12 months. If you are not certain of a fact, choose a different one.
- Exactly 4 options. Put the CORRECT answer FIRST, then 3 plausible wrong answers of the same kind. Only one option may be correct.
- Make them HARD: pitched at a keen pub-quiz team, not a casual player. Roughly 30% medium, 50% hard, 20% very hard. Avoid famous "everyone knows it" facts (capital of France, number of continents, who painted the Mona Lisa).
- Make the wrong answers tempting: the kind of thing a well-informed person might pick (e.g. the Severn for "longest river entirely in England").
- Hard means less well known, never obscure trivia only a specialist could know, and never ambiguous.
- Questions under 130 characters, options under 40 characters.
- "why": one short, fun sentence explaining the answer (under 120 characters).
- Never ask about crimes, allegations, scandals, deaths, illness, relationships or private lives of real people.
- Never quote song lyrics, poems or other copyrighted text.
- British spelling. Every question about a different subject.
- Do NOT reuse or reword any of these previously used questions:
${avoid.length ? avoid.map(l => "  • " + l).join("\n") : "  (none yet)"}

Reply with ONLY a JSON array, no other text:
[{"q":"...","a":["correct","wrong","wrong","wrong"],"why":"..."}]`;

  const reply = await askAI(prompt, 3000);
  return parseArray(reply).filter(isValidQuestion);
}

async function factCheck(drafts) {
  if (!drafts.length) return [];
  const prompt = `You are a strict fact-checker for a quiz app. For each question, check that:
1. the FIRST option is definitely correct,
2. the other three options are definitely wrong,
3. the question is clear, has only one possible answer, and won't go out of date soon.

When in doubt, fail it.

${JSON.stringify(drafts.map((d, i) => ({ i, q: d.q, options: d.a })), null, 1)}

Reply with ONLY a JSON array of the "i" numbers that pass, e.g. [0,2,3]`;

  const reply = await askAI(prompt, 300);
  const passed = new Set(parseArray(reply).filter(Number.isInteger));
  return drafts.filter((_, i) => passed.has(i));
}

async function askAI(prompt, maxTokens) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    for (const model of MODELS) {
      // the older backup address uses model names without the "openai/" part
      const name = endpoint.includes("azure") ? model.split("/").pop() : model;
      for (let attempt = 1; attempt <= 3; attempt++) {
        let res, text;
        try {
          res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
              "Content-Type": "application/json",
              "Accept": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
              model: name,
              max_tokens: maxTokens,
              temperature: 0.9,
              messages: [{ role: "user", content: prompt }],
            }),
          });
          text = await res.text();
        } catch (err) {
          lastError = `Network error (${name} @ ${endpoint}): ${err.message}`;
          console.log(lastError);
          await sleep(10000);
          continue;
        }
        let data = null;
        try { data = JSON.parse(text); } catch {}
        const content = data?.choices?.[0]?.message?.content;
        if (res.ok && typeof content === "string") return content;

        lastError = `GitHub Models ${res.status} (${name} @ ${endpoint}): ${text.slice(0, 300).replace(/\s+/g, " ")}`;
        console.log(lastError);
        if (res.status === 429 || res.status >= 500) {
          // busy: wait (honouring Retry-After if given, up to 2 minutes) and try again
          const wait = Math.min(120, Number(res.headers.get("retry-after")) || 30 * attempt);
          await sleep(wait * 1000);
          continue;
        }
        break; // not usable (unknown model, odd reply…): try the next model/address
      }
    }
  }
  throw new Error(lastError || "AI request failed");
}

/* ---------- helpers ---------- */

async function readJson(rel, fallback) {
  try { return JSON.parse(await readFile(join(ROOT, rel), "utf8")); } catch { return fallback; }
}
async function writeJson(rel, value) {
  await mkdir(dirname(join(ROOT, rel)), { recursive: true });
  await writeFile(join(ROOT, rel), JSON.stringify(value) + "\n");
}

function parseArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { const v = JSON.parse(match[0]); return Array.isArray(v) ? v : []; } catch { return []; }
}

function isValidQuestion(q) {
  return q && typeof q.q === "string" && q.q.trim() &&
    Array.isArray(q.a) && q.a.length === 4 &&
    q.a.every(o => typeof o === "string" && o.trim()) &&
    new Set(q.a.map(o => o.trim().toLowerCase())).size === 4 &&
    (q.why === undefined || typeof q.why === "string");
}

// Same question with different punctuation/capitals counts as a repeat
const fingerprint = text => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const asLine = q => `${q.q} → ${q.a[0]}`;

// YYYY-MM-DD in the given time zone, offset by whole days
function dateIn(timeZone, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

main().catch(err => { console.error(err); process.exit(1); });
