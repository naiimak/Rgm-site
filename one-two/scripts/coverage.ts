// Link-coverage check (spec: Player database > Cleaning steps, step 5).
// For every pair of the 98 subject cards, count the valid players, and report pairs with 0 or 1.
//
//   npm run coverage            -> summary + data/coverage-report.md

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardTitle } from '../engine/cards.ts';
import { ROOT, loadDatabase } from '../engine/load.ts';

const { config, db } = loadDatabase();
const keys = db.subjectKeys();
const title = (key: string) => {
  const [kind, ref] = key.split(':');
  return cardTitle(config, { kind: kind as never, ref });
};

const rows: { a: string; b: string; n: number }[] = [];
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) rows.push({ a: keys[i], b: keys[j], n: db.validPlayers(keys[i], keys[j]).length });
}

const empty = rows.filter((r) => r.n === 0);
const single = rows.filter((r) => r.n === 1);
const perCard = new Map<string, { empty: number; total: number }>();
for (const r of rows) {
  for (const k of [r.a, r.b]) {
    const s = perCard.get(k) ?? { empty: 0, total: 0 };
    s.total++;
    if (r.n === 0) s.empty++;
    perCard.set(k, s);
  }
}
const worst = [...perCard.entries()].sort((x, y) => y[1].empty - x[1].empty).slice(0, 25);

const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;
const lines = [
  `# Link coverage report`,
  ``,
  `Data version: \`${db.version}\` · ${db.players.length} players · ${keys.length} subject cards · ${rows.length} pairs`,
  ``,
  `| Valid players | Pairs | Share |`,
  `| --- | --- | --- |`,
  `| 0 (unplayable as a link) | ${empty.length} | ${pct(empty.length)} |`,
  `| 1 | ${single.length} | ${pct(single.length)} |`,
  `| 2–4 | ${rows.filter((r) => r.n >= 2 && r.n <= 4).length} | ${pct(rows.filter((r) => r.n >= 2 && r.n <= 4).length)} |`,
  `| 5+ | ${rows.filter((r) => r.n >= 5).length} | ${pct(rows.filter((r) => r.n >= 5).length)} |`,
  ``,
  `## Cards with the most empty pairs`,
  ``,
  `Candidates to swap for another club or country once the full Wikidata import is in (the seed is small, so most gaps are data gaps, not real ones).`,
  ``,
  `| Card | Empty pairs (of 97) |`,
  `| --- | --- |`,
  ...worst.map(([k, s]) => `| ${title(k)} (${k}) | ${s.empty} |`),
  ``,
  `## Pairs with exactly one valid player`,
  ``,
  ...single.slice(0, 300).map((r) => `- ${title(r.a)} + ${title(r.b)}: ${db.byId.get(db.validPlayers(r.a, r.b)[0])!.name}`),
  single.length > 300 ? `- … and ${single.length - 300} more` : '',
];
writeFileSync(join(ROOT, 'data/coverage-report.md'), lines.join('\n') + '\n');

console.log(`${rows.length} pairs: ${empty.length} with 0 valid players (${pct(empty.length)}), ${single.length} with 1 (${pct(single.length)})`);
console.log(`Most empty pairs: ${worst.slice(0, 10).map(([k, s]) => `${title(k)} ${s.empty}`).join(', ')}`);
console.log('Full report: data/coverage-report.md');
