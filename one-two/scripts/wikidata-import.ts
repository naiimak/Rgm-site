// Builds data/players.json from Wikidata (CC0), following the spec's "Player database" section.
//
//   npm run data:wikidata
//
// Stages (every query is cached in data/wikidata-cache/, so a rerun resumes where it stopped):
//   1. Find the Wikidata items for the 50 clubs, 24 national teams, coach clubs, leagues and trophies.
//   2. Leagues: every top-flight season of the 5 countries, its champion and its clubs.
//   3. Trophies: Champions League / European Cup winners, World Cup and Euro winners, Ballon d'Or winners.
//   4. Players: everyone with a senior spell at one of the 50 clubs or a cap for one of the 24 nations.
//   5. Each player's name, birth year, nationality, fame (sitelinks), nicknames, spells and tournaments.
//   6. Derive league titles, Champions League and tournament wins, then write players.json
//      plus data/import-report.md (disagreements with the hand-entered seed, for review).
//
// Derived facts are approximations the spec's AI review must check: a league title or Champions
// League counts when the player had a spell at the winning club that covers that season.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../engine/load.ts';
import { normalize } from '../engine/search.ts';
import type { DataClub, PlayerRecord, Spell } from '../engine/types.ts';
import { Sparql, chunks, lit, qid, year } from './lib/sparql.ts';

const config = loadConfig();
const sources = JSON.parse(readFileSync(join(ROOT, 'data/wikidata-sources.json'), 'utf8')) as {
  clubs: Record<string, string>; coaches: Record<string, string>; nations: Record<string, string>;
  coachClubs?: Record<string, string[]>;
  leagues: Record<string, string[]>; competitions: Record<string, string[]>;
  leagueSeasonsBefore?: Record<string, number>;
};
const wd = new Sparql(join(ROOT, 'data/wikidata-cache'));
const NOW = config.currentSeasonEnd;
const BATCH = 250;

// ------------------------------------------------------------------ 1. resolve items by Wikipedia title

async function resolve(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks([...new Set(titles)], 80)) {
    const rows = await wd.query(`SELECT ?title ?item WHERE {
      VALUES ?title { ${part.map(lit).join(' ')} }
      ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }`);
    for (const r of rows) out.set(r.title, qid(r.item));
  }
  return out;
}

function need(map: Map<string, string>, title: string, what: string): string {
  const id = map.get(title);
  if (!id) throw new Error(`No Wikidata item for ${what} "${title}" — fix data/wikidata-sources.json`);
  return id;
}

// ------------------------------------------------------------------ main

async function main() {
  console.log('1/6 Finding cards on Wikidata…');
  const titles = [
    ...Object.values(sources.clubs), ...Object.values(sources.nations), ...Object.values(sources.coaches),
    ...Object.values(sources.coachClubs ?? {}).flat(), ...Object.values(sources.leagues).flat(), ...Object.values(sources.competitions).flat(),
  ];
  const found = await resolve(titles);
  const required = [...Object.values(sources.clubs), ...Object.values(sources.nations), ...Object.values(sources.leagues).flat()];
  const missingTitles = required.filter((t) => !found.has(t));
  if (missingTitles.length) throw new Error(`No Wikidata item for these titles — fix data/wikidata-sources.json:\n  ${missingTitles.join('\n  ')}`);
  const clubCode = new Map<string, string>(); // QID -> card club code (also coach-only clubs like FC Porto)
  for (const [code, title] of Object.entries(sources.clubs)) clubCode.set(need(found, title, 'club'), code);
  for (const [code, options] of Object.entries(sources.coachClubs ?? {})) {
    const hit = options.map((t) => found.get(t)).find(Boolean);
    if (hit) clubCode.set(hit, code);
    else console.warn(`  (coach club ${code} not found: ${options.join(' / ')})`);
  }
  const nationCode = new Map<string, string>();
  for (const [code, title] of Object.entries(sources.nations)) nationCode.set(need(found, title, 'national team'), code);
  const comp = (key: string) => sources.competitions[key].map((t) => found.get(t)).filter((x): x is string => !!x);

  console.log('2/6 Top-flight seasons, champions and clubs…');
  const champions: { league: string; season: number; club: string }[] = [];
  const topFlight = new Map<string, { league: string; seasons: Set<number> }>(); // club QID -> seasons
  for (const [league, names] of Object.entries(sources.leagues)) {
    for (const name of names) {
      const item = need(found, name, 'league');
      const rows = await wd.query(`SELECT ?s ?label ?start ?winner ?team WHERE {
        ?s wdt:P3450 wd:${item} . ?s rdfs:label ?label . FILTER(LANG(?label) = "en")
        OPTIONAL { ?s wdt:P580 ?start } OPTIONAL { ?s wdt:P1346 ?winner } OPTIONAL { ?s wdt:P1923 ?team } }`);
      const seen = new Set<string>();
      const before = sources.leagueSeasonsBefore?.[name] ?? Infinity;
      for (const r of rows) {
        const season = seasonStart(r.label, r.start);
        if (season === null || season >= before) continue;
        if (r.winner && !seen.has(`${r.s}|${r.winner}`)) {
          seen.add(`${r.s}|${r.winner}`);
          champions.push({ league, season, club: qid(r.winner) });
        }
        if (r.team) {
          const t = qid(r.team);
          const entry = topFlight.get(t) ?? { league, seasons: new Set<number>() };
          entry.seasons.add(season);
          topFlight.set(t, entry);
        }
      }
    }
  }
  console.log(`  ${champions.length} champion seasons, ${topFlight.size} clubs that played in a top flight`);

  console.log('3/6 Trophy winners…');
  const clWinners: { season: number; club: string }[] = [];
  for (const item of comp('CL')) {
    const rows = await wd.query(`SELECT ?s ?label ?start ?winner WHERE {
      ?s wdt:P3450 wd:${item} ; wdt:P1346 ?winner . ?s rdfs:label ?label . FILTER(LANG(?label) = "en") OPTIONAL { ?s wdt:P580 ?start } }`);
    for (const r of rows) {
      const season = seasonStart(r.label, r.start);
      if (season !== null) clWinners.push({ season, club: qid(r.winner) });
    }
  }
  // Tournament editions: winner team plus the edition item players list under "participant in" (P1344).
  const editions = new Map<string, { trophy: 'WC' | 'EC'; winnerTeam: string; year: number }>();
  for (const trophy of ['WC', 'EC'] as const) {
    for (const item of comp(trophy)) {
      const rows = await wd.query(`SELECT ?e ?label ?winner WHERE {
        ?e wdt:P3450 wd:${item} ; wdt:P1346 ?winner . ?e rdfs:label ?label . FILTER(LANG(?label) = "en") }`);
      for (const r of rows) {
        const y = Number(r.label.match(/\d{4}/)?.[0]);
        if (y && y <= new Date().getFullYear()) editions.set(qid(r.e), { trophy, winnerTeam: qid(r.winner), year: y });
      }
    }
  }
  const goldenBall = comp('GB');
  console.log(`  ${clWinners.length} European club champions, ${editions.size} World Cup / Euro editions with a winner`);

  console.log('4/6 Finding players…');
  const candidates = new Map<string, number>(); // QID -> sitelinks
  for (const team of [...clubCode.keys(), ...nationCode.keys()]) {
    const rows = await wd.query(`SELECT DISTINCT ?p ?links WHERE {
      ?p p:P54/ps:P54 wd:${team} ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?links . }`);
    for (const r of rows) candidates.set(qid(r.p), Number(r.links));
  }
  const ids = [...candidates.keys()].sort();
  console.log(`  ${ids.length} players`);

  console.log(`5/6 Player details in ${Math.ceil(ids.length / BATCH)} batches…`);
  const info = new Map<string, { name?: string; born?: number; country?: string; aliases: string[] }>();
  const spellsRaw = new Map<string, { team: string; from: number | null; to: number | null }[]>();
  const awards = new Map<string, Set<string>>(); // Ballon d'Or + tournament editions
  let done = 0;
  for (const batch of chunks(ids, BATCH)) {
    const values = batch.map((x) => `wd:${x}`).join(' ');
    const [basic, alias, spells, extra] = [
      await wd.query(`SELECT ?p ?name ?born ?iso WHERE { VALUES ?p { ${values} }
        OPTIONAL { ?p rdfs:label ?name . FILTER(LANG(?name) = "en") }
        OPTIONAL { ?p wdt:P569 ?born }
        OPTIONAL { ?p wdt:P1532|wdt:P27 ?c . ?c wdt:P297 ?iso } }`),
      await wd.query(`SELECT ?p ?alias WHERE { VALUES ?p { ${values} } ?p skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }`),
      await wd.query(`SELECT ?p ?team ?start ?end WHERE { VALUES ?p { ${values} }
        ?p p:P54 ?s . ?s ps:P54 ?team . OPTIONAL { ?s pq:P580 ?start } OPTIONAL { ?s pq:P582 ?end } }`),
      await wd.query(`SELECT ?p ?x WHERE { VALUES ?p { ${values} }
        { ?p wdt:P166 ?x . VALUES ?x { ${goldenBall.map((g) => `wd:${g}`).join(' ')} } } UNION { ?p wdt:P1344 ?x } }`),
    ];
    for (const r of basic) {
      const id = qid(r.p);
      const cur = info.get(id) ?? { aliases: [] };
      cur.name ??= r.name;
      const b = year(r.born);
      if (b && (!cur.born || b < cur.born)) cur.born = b;
      cur.country ??= r.iso;
      info.set(id, cur);
    }
    for (const r of alias) {
      const cur = info.get(qid(r.p));
      if (cur && cur.aliases.length < 6 && r.alias.length <= 40) cur.aliases.push(r.alias);
    }
    for (const r of spells) {
      const list = spellsRaw.get(qid(r.p)) ?? [];
      list.push({ team: qid(r.team), from: year(r.start), to: year(r.end) });
      spellsRaw.set(qid(r.p), list);
    }
    for (const r of extra) {
      const set = awards.get(qid(r.p)) ?? new Set<string>();
      set.add(qid(r.x));
      awards.set(qid(r.p), set);
    }
    done += batch.length;
    if (done % (BATCH * 10) === 0 || done === ids.length) console.log(`  ${done}/${ids.length}`);
  }

  console.log('6/6 Deriving titles and trophies, writing players.json…');
  const nationName = new Map(config.nations.map((n) => [n.id, n.name]));
  const isoToCode = new Map<string, string>(Object.entries(ISO_TO_CODE));
  const clubCodeOf = (team: string) => clubCode.get(team) ?? (topFlight.has(team) ? team : null);
  const players: PlayerRecord[] = [];
  const usedIds = new Set<string>();

  for (const id of ids) {
    const meta = info.get(id);
    if (!meta?.name || /^Q\d+$/.test(meta.name)) continue;
    const raw = spellsRaw.get(id) ?? [];
    const spells: Spell[] = [];
    const caps = new Set<string>();
    const nationalTeams = new Set<string>();
    for (const s of raw) {
      const nation = nationCode.get(s.team);
      if (nation) { caps.add(nation); nationalTeams.add(s.team); continue; }
      nationalTeams.add(s.team); // harmless for non-national teams: only matched against tournament winners
      const code = clubCodeOf(s.team);
      if (!code) continue; // youth, B, women's or foreign clubs: irrelevant for the cards
      spells.push({ club: code, from: s.from, to: s.to !== null && s.from !== null && s.to < s.from ? s.from : s.to });
    }
    if (!spells.some((s) => config.clubs.some((c) => c.id === s.club)) && !caps.size) continue;

    const titles = new Set<string>();
    for (const c of champions) if (spellCovers(spells, clubCodeOf(c.club), c.season)) titles.add(c.league);
    const trophies = new Set<string>();
    const got = awards.get(id) ?? new Set<string>();
    if (goldenBall.some((g) => got.has(g))) trophies.add('GB');
    if (clWinners.some((w) => spellCovers(spells, clubCodeOf(w.club), w.season))) trophies.add('CL');
    for (const e of got) {
      const ed = editions.get(e);
      if (ed && nationalTeams.has(ed.winnerTeam)) trophies.add(ed.trophy);
    }

    const nationality = [...caps][0] ?? (meta.country ? isoToCode.get(meta.country) ?? `iso:${meta.country}` : '');
    let pid = normalize(meta.name).replace(/ /g, '-') || id.toLowerCase();
    if (usedIds.has(pid)) pid = `${pid}-${meta.born ?? id.toLowerCase()}`;
    if (usedIds.has(pid)) pid = `${pid}-${id.toLowerCase()}`;
    usedIds.add(pid);
    players.push({
      id: pid, name: meta.name, aliases: [...new Set(meta.aliases.filter((a) => a !== meta.name))],
      nationality, birthYear: meta.born ?? 0, fame: candidates.get(id) ?? 0,
      spells: spells.sort((a, b) => (a.from ?? 0) - (b.from ?? 0)),
      titles: [...titles].sort(), trophies: [...trophies].sort(), caps: [...caps].sort(),
    });
  }

  // Seed players Wikidata doesn't have are kept; disagreements go to the review report.
  const seed = (JSON.parse(readFileSync(join(ROOT, 'data/players.seed.json'), 'utf8')) as { players: PlayerRecord[] }).players;
  const byKey = new Map<string, PlayerRecord>();
  for (const p of players) for (const n of [p.name, ...p.aliases]) byKey.set(`${normalize(n)}|${p.birthYear}`, p);
  const find = (s: PlayerRecord) => [0, -1, 1].map((d) => byKey.get(`${normalize(s.name)}|${s.birthYear + d}`)).find(Boolean)
    ?? s.aliases.map((a) => byKey.get(`${normalize(a)}|${s.birthYear}`)).find(Boolean);
  const report: string[] = [];
  let added = 0;
  for (const s of seed) {
    const w = find(s);
    if (!w) { if (!usedIds.has(s.id)) { players.push(s); usedIds.add(s.id); added++; } continue; }
    const diffs: string[] = [];
    const cmp = (label: string, a: string[], b: string[], names: (x: string) => string = (x) => x) => {
      const missing = a.filter((x) => !b.includes(x));
      const extra = b.filter((x) => !a.includes(x));
      if (missing.length) diffs.push(`${label} only in seed: ${missing.map(names).join(', ')}`);
      if (extra.length) diffs.push(`${label} only in Wikidata: ${extra.map(names).join(', ')}`);
    };
    const cardClubs = (p: PlayerRecord) => [...new Set(p.spells.map((x) => x.club).filter((c) => config.clubs.some((k) => k.id === c)))];
    cmp('clubs', cardClubs(s), cardClubs(w), (c) => config.clubs.find((k) => k.id === c)!.name);
    cmp('titles', s.titles, w.titles);
    cmp('trophies', s.trophies, w.trophies);
    cmp('caps', s.caps.filter((c) => nationName.has(c)), w.caps);
    if (diffs.length) report.push(`- **${w.name}** (${w.birthYear}, fame ${w.fame}): ${diffs.join('; ')}`);
  }

  const clubs: Record<string, DataClub> = {};
  for (const [team, t] of topFlight) {
    const code = clubCodeOf(team)!;
    clubs[code] = { league: t.league, seasons: [...t.seasons].sort((a, b) => a - b) };
  }
  // Coach-only clubs outside the 5 leagues (e.g. FC Porto) still need an entry so spells keep them.
  for (const code of clubCode.values()) if (!clubs[code] && !config.clubs.some((c) => c.id === code)) clubs[code] = { league: null };

  players.sort((a, b) => b.fame - a.fame);
  const body = JSON.stringify(players);
  const version = `wd-${new Date().toISOString().slice(0, 10)}-${createHash('sha1').update(body).digest('hex').slice(0, 6)}`;
  writeFileSync(join(ROOT, 'data/players.json'), JSON.stringify({
    version,
    source: 'Wikidata (CC0) via scripts/wikidata-import.ts, plus hand-entered seed players Wikidata lacks. Not yet AI-reviewed.',
    clubs, players,
  }));
  writeFileSync(join(ROOT, 'data/import-report.md'), [
    `# Wikidata import report`, ``,
    `Version \`${version}\` · ${players.length} players (${players.length - added} from Wikidata, ${added} kept from the seed).`, ``,
    `## Seed vs Wikidata disagreements (${report.length})`, ``,
    `Both sources can be wrong. These are the first players for the AI review / a human check.`, ``,
    ...report,
  ].join('\n') + '\n');
  console.log(`Wrote ${players.length} players (${added} from the seed only), version ${version}`);
  console.log(`${report.length} seed/Wikidata disagreements listed in data/import-report.md`);
}

/** Start year of a season item: its start date, or the first year in "2007–08 Premier League". */
function seasonStart(label: string, start?: string): number | null {
  const y = year(start) ?? Number(label.match(/(1[89]|20)\d{2}/)?.[0]);
  return y && y <= NOW ? y : null;
}

/** True if a spell at this club covers the season starting in `season`. */
function spellCovers(spells: Spell[], club: string | null, season: number): boolean {
  if (!club) return false;
  return spells.some((s) => s.club === club && s.from !== null && s.from <= season && season < Math.max(s.to ?? NOW, s.from + 1));
}

// Nationalities are shown as flags; countries with a flag in config map to its code, others
// fall back to "iso:XX" and the app draws the flag from the ISO code.
const ISO_TO_CODE: Record<string, string> = {
  ES: 'ESP', FR: 'FRA', IT: 'ITA', DE: 'GER', PT: 'POR', NL: 'NED', BE: 'BEL', HR: 'CRO', PL: 'POL', DK: 'DEN', BR: 'BRA',
  AR: 'ARG', UY: 'URU', MA: 'MAR', NG: 'NGA', CI: 'CIV', CM: 'CMR', SN: 'SEN', EG: 'EGY', DZ: 'ALG', US: 'USA', JP: 'JPN',
  AU: 'AUS', CZ: 'CZE', KR: 'KOR', CL: 'CHI', SE: 'SWE', UA: 'UKR', SK: 'SVK', GE: 'GEO', GA: 'GAB', NO: 'NOR', BG: 'BUL',
  CH: 'SUI', AM: 'ARM', CO: 'COL', PE: 'PER', BA: 'BIH', RS: 'SRB', TR: 'TUR', ME: 'MNE', RO: 'ROU', LR: 'LBR', GH: 'GHA',
  ML: 'MLI', TG: 'TOG', GN: 'GIN', CA: 'CAN', AT: 'AUT', SI: 'SVN', CN: 'CHN',
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
