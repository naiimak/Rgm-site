// Minimal admin page: review answer reports and publish a new data version.

import { cardTitle } from '../engine/cards.ts';
import type { PlayerDB } from '../engine/database.ts';
import type { GameConfig } from '../engine/types.ts';
import type { AnswerReport } from './store.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderAdmin(reports: AnswerReport[], db: PlayerDB, config: GameConfig, key: string, filter: string): string {
  const title = (k: string) => {
    const [kind, ref] = k.split(':');
    try { return cardTitle(config, { kind: kind as never, ref }) || k; } catch { return k; }
  };
  const shown = reports.filter((r) => filter === 'all' || r.status === filter);
  const q = encodeURIComponent(key);
  const rows = shown.map((r) => {
    const p = db.byId.get(r.playerId);
    const facts = p ? `${p.spells.map((s) => `${s.club} ${s.from}–${s.to ?? ''}`).join(', ')} · titles ${p.titles.join(' ') || '–'} · ${p.trophies.join(' ') || '–'} · caps ${p.caps.join(' ') || '–'}` : '(player not in current data)';
    return `<tr>
      <td>${esc(r.createdAt.slice(0, 16).replace('T', ' '))}<br><small>${esc(r.dataVersion)}</small></td>
      <td><b>${esc(title(r.cardA))}</b> → <b>${esc(title(r.cardB))}</b></td>
      <td>${esc(r.playerName)}<br><small>${esc(facts)}</small></td>
      <td>Judged <b>${esc(r.verdict)}</b>${r.reporter === 'demo' ? '<br><small>from the demo</small>' : ''}</td>
      <td><form method="post" action="/admin/reports/${r.id}?key=${q}">
        <select name="status">${['open', 'confirmed', 'rejected'].map((s) => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <input name="note" value="${esc(r.reviewerNote)}" placeholder="Reviewer note">
        <button>Save</button></form></td>
    </tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>One-Two admin</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#14201a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}small{color:#666}nav a{margin-right:12px}input{width:180px}</style></head>
<body><h1>One-Two admin</h1>
<p>Data version <b>${esc(db.version)}</b> · ${db.players.length} players.
To change player data: edit <code>data/players.seed.psv</code> (or re-run the import), run <code>npm run data</code>, then
<form method="post" action="/admin/reload-data?key=${q}" style="display:inline"><button>Publish new data version</button></form>
(games in progress keep their version).</p>
<nav>${['open', 'confirmed', 'rejected', 'all'].map((s) => `<a href="/admin?key=${q}&status=${s}">${s}${s === filter ? ' ✓' : ''}</a>`).join('')}</nav>
<h2>Answer reports (${shown.length})</h2>
<table><tr><th>When</th><th>Cards</th><th>Player named</th><th>Verdict</th><th>Decision</th></tr>${rows || '<tr><td colspan="5">Nothing here.</td></tr>'}</table>
</body></html>`;
}
