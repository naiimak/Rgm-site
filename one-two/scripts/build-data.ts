// Builds data/players.json from the hand-entered seed (data/players.seed.psv).
// The Wikidata import (see README) is meant to write the same players.json format.
//
//   npm run data

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../engine/load.ts';
import { normalize } from '../engine/search.ts';
import type { PlayerRecord, Spell } from '../engine/types.ts';

const config = loadConfig();
const cardClubs = new Set(config.clubs.map((c) => c.id));
const otherClubs = new Set(Object.keys(config.otherClubs).filter((k) => !k.startsWith('_')));
const leagues = new Set(config.leagues.map((l) => l.id));
const trophies = new Set(config.trophies.map((t) => t.id));
const nations = new Set(config.nations.map((n) => n.id));

const lines = readFileSync(join(ROOT, 'data/players.seed.psv'), 'utf8').split('\n');
const players: PlayerRecord[] = [];
const ids = new Set<string>();
const problems: string[] = [];
const foreignClubs = new Map<string, number>();

lines.forEach((line, i) => {
  if (!line.trim() || line.startsWith('#')) return;
  const cols = line.split('|').map((c) => c.trim());
  if (cols.length !== 9) { problems.push(`line ${i + 1}: expected 9 columns, got ${cols.length}`); return; }
  const [name, aliases, nationality, born, fame, spellsRaw, titlesRaw, trophiesRaw, capsRaw] = cols;

  const spells: Spell[] = [];
  for (const part of spellsRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Z0-9]+) (\d{4})-(\d{4})?$/);
    if (!m) { problems.push(`line ${i + 1} (${name}): bad spell "${part}"`); continue; }
    const [, club, from, to] = m;
    if (to && Number(to) < Number(from)) problems.push(`line ${i + 1} (${name}): spell ends before it starts "${part}"`);
    if (!cardClubs.has(club) && !otherClubs.has(club)) foreignClubs.set(club, (foreignClubs.get(club) ?? 0) + 1);
    spells.push({ club, from: Number(from), to: to ? Number(to) : null });
  }
  const list = (s: string) => s.split(/\s+/).filter(Boolean);
  const titles = list(titlesRaw);
  const won = list(trophiesRaw);
  const caps = list(capsRaw);
  for (const t of titles) if (!leagues.has(t)) problems.push(`line ${i + 1} (${name}): unknown league title ${t}`);
  for (const t of won) if (!trophies.has(t)) problems.push(`line ${i + 1} (${name}): unknown trophy ${t}`);
  if (!config.flags[nationality]) problems.push(`line ${i + 1} (${name}): no flag for nationality ${nationality}`);

  let id = normalize(name).replace(/ /g, '-');
  while (ids.has(id)) id += '-2';
  ids.add(id);
  players.push({
    id,
    name,
    aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
    nationality,
    birthYear: Number(born),
    fame: Number(fame),
    spells,
    titles,
    trophies: won,
    // caps for countries outside the 24 National cards are kept: they never matter for a card
    caps: caps.filter((c) => nations.has(c) || config.flags[c]),
  });
});

const body = JSON.stringify(players);
const version = `seed-${createHash('sha1').update(body).digest('hex').slice(0, 8)}`;
writeFileSync(join(ROOT, 'data/players.json'), JSON.stringify({ version, source: 'hand-entered seed (not yet verified against Wikidata)', players }, null, 1));

console.log(`${players.length} players written to data/players.json (version ${version})`);
console.log(`Clubs outside the 5 leagues (ignored for leagues, never cards): ${[...foreignClubs.keys()].sort().join(' ')}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exitCode = 1;
}
