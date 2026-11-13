/**
 * Builds football/top10.json for Quizzle's Football Top 10s:
 * each club's top 10 Premier League goalscorers and appearance makers
 * (1992-93 to now), straight from the official Premier League stats.
 *
 * Run by .github/workflows/football-data.yml every Monday, so current
 * players' totals stay up to date. Ties for 10th place are all included.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://footballapi.pulselive.com/football";
const HEADERS = {
  "Origin": "https://www.premierleague.com",
  "Referer": "https://www.premierleague.com/",
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; QuizzleBot/1.0)",
};

// Clubs in the game. "match" is the club's name in the Premier League data.
const CLUBS = [
  { key: "manutd",    name: "Man Utd",   match: "Manchester United", colour: "#da291c" },
  { key: "liverpool", name: "Liverpool", match: "Liverpool",         colour: "#c8102e" },
  { key: "arsenal",   name: "Arsenal",   match: "Arsenal",           colour: "#ef0107" },
  { key: "chelsea",   name: "Chelsea",   match: "Chelsea",           colour: "#034694" },
  { key: "mancity",   name: "Man City",  match: "Manchester City",   colour: "#6cabdd" },
  { key: "spurs",     name: "Spurs",     match: "Tottenham Hotspur", colour: "#132257" },
];

const STATS = { goals: "goals", apps: "appearances" };

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, { headers: HEADERS });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`Premier League data ${res.status} for ${path}`);
    await new Promise(r => setTimeout(r, 5000 * attempt));
  }
}

async function main() {
  const teams = await get("/teams?pageSize=100&comps=1&altIds=true&page=0");
  const out = { updated: new Date().toISOString().slice(0, 10), clubs: [] };

  for (const club of CLUBS) {
    const team = teams.content.find(t => t.name === club.match || t.club?.name === club.match);
    if (!team) throw new Error(`Couldn't find ${club.match} in the Premier League data`);
    const entry = { key: club.key, name: club.name, colour: club.colour };

    for (const [field, stat] of Object.entries(STATS)) {
      const data = await get(`/stats/ranked/players/${stat}?page=0&pageSize=20&comps=1&compCodeForActivePlayer=EN_PR&altIds=true&teams=${team.id}`);
      const rows = data.stats.content.map(r => ({
        rank: Math.round(r.rank),
        name: r.owner.name.display,
        first: r.owner.name.first || "",
        last: r.owner.name.last || "",
        value: Math.round(r.value),
        active: !!r.owner.active,
      }));
      // top 10, plus anyone tied with 10th place
      const tenth = rows[9]?.value;
      entry[field] = rows.filter((r, i) => i < 10 || r.value === tenth);
      if (entry[field].length < 10) throw new Error(`Only ${entry[field].length} ${stat} rows for ${club.name}`);
      console.log(`${club.name} ${stat}: ${entry[field].map(r => `${r.name} ${r.value}`).join(", ")}`);
    }
    out.clubs.push(entry);
  }

  const file = join(ROOT, "football", "top10.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 1) + "\n");
}

main().catch(err => { console.error(err); process.exit(1); });
