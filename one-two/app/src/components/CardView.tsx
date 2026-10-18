// Card faces per the spec's "Card face layout": no crests, logos, kits, likenesses or badges.

import type { CSSProperties } from 'react';
import type { Card } from '../../../engine/types.ts';
import { cardTitle, colourHex, colourSymbol, leagueOf, type ClientConfig } from '../model.ts';

interface Props {
  card: Card;
  config: ClientConfig;
  size?: 'sm' | 'md' | 'lg';
  dim?: boolean;
  selected?: boolean;
  onClick?: () => void;
  label?: string;
}

export function CardView({ card, config, size = 'md', dim, selected, onClick, label }: Props) {
  const title = cardTitle(config, card);
  const cls = `card card-${size} kind-${card.kind}${dim ? ' dim' : ''}${selected ? ' selected' : ''}`;
  const hex = card.colour ? colourHex(config, card.colour) : undefined;
  const symbol = card.colour ? colourSymbol(config, card.colour) : '';
  const common = { className: cls, onClick, role: onClick ? 'button' : undefined, 'aria-label': label ?? `${title}${dim ? ' (cannot be played)' : ''}` };

  if (card.kind === 'club') {
    const club = config.clubs.find((c) => c.id === card.ref)!;
    const league = leagueOf(config, club.league);
    return (
      <div {...common} style={{ '--edge': hex } as CSSProperties}>
        <div className="card-top"><span className="sym">{symbol}</span><span className="flag">{league.flag}</span></div>
        <div className="kit">{club.kit.map((k, i) => <span key={i} style={{ background: k }} />)}</div>
        <div className="card-name">{title}</div>
        <div className="card-type">Club</div>
      </div>
    );
  }
  if (card.kind === 'league' || card.kind === 'champion') {
    const league = leagueOf(config, card.ref);
    return (
      <div {...common} style={{ '--edge': hex, '--fill': hex } as CSSProperties}>
        <div className="card-top"><span className="sym">{symbol}</span></div>
        <div className="big-flag">{league.flag}</div>
        {card.kind === 'champion' && <TrophyIcon kind="cup" />}
        <div className="card-name">{league.country}</div>
        <div className="card-type">{card.kind === 'champion' ? 'Champion' : 'Top Flight'}</div>
      </div>
    );
  }
  if (card.kind === 'trophy') {
    const icon = config.trophies.find((t) => t.id === card.ref)?.icon ?? 'cup';
    return (
      <div {...common}>
        <div className="card-top"><span className="nocolour">No colour</span></div>
        <TrophyIcon kind={icon} />
        <div className="card-name">{title}</div>
        <div className="card-type">Trophy</div>
      </div>
    );
  }
  if (card.kind === 'coach') {
    return (
      <div {...common}>
        <div className="card-top"><span className="nocolour">No colour</span><ClipboardIcon /></div>
        <CoachIcon />
        <div className="card-name">{title}</div>
        <div className="card-type">Coach</div>
      </div>
    );
  }
  if (card.kind === 'national') {
    const nation = config.nations.find((n) => n.id === card.ref)!;
    const stripes = `linear-gradient(135deg, ${nation.colours.map((c, i) => `${c} ${(i / nation.colours.length) * 100}% ${((i + 1) / nation.colours.length) * 100}%`).join(', ')})`;
    return (
      <div {...common} style={{ '--flagbg': stripes } as CSSProperties}>
        <div className="big-flag">{nation.flag}</div>
        <ShirtIcon />
        <div className="card-name">{nation.name}</div>
        <div className="card-type">National Team</div>
      </div>
    );
  }
  const wild = card.colour === null;
  return (
    <div {...common} style={{ '--edge': hex ?? '#111', '--fill': hex ?? '#1b1b1b' } as CSSProperties} data-wild={wild || undefined}>
      <div className="card-top"><span className="sym">{symbol}</span>{wild && <span className="wild-tag">Wild</span>}</div>
      <ActionIcon action={card.ref} />
      <div className="card-name">{title}</div>
      <div className="card-type">{card.ref === 'yellow' ? '+2' : card.ref === 'hattrick' ? '+4' : card.ref === 'red' ? 'Skip' : card.ref === 'var' ? 'Reverse' : 'Choose colour'}</div>
    </div>
  );
}

export function CardBack({ style = 'back-default', size = 'md', count }: { style?: string; size?: 'sm' | 'md'; count?: number }) {
  return (
    <div className={`card card-${size} card-back ${style}`} aria-label={count !== undefined ? `Draw pile, ${count} cards` : 'Card'}>
      <span className="back-mark">1·2</span>
      {count !== undefined && <span className="back-count">{count}</span>}
    </div>
  );
}

function TrophyIcon({ kind }: { kind: string }) {
  if (kind === 'ball') return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden><circle cx="24" cy="24" r="16" fill="#f7d774" stroke="#7a5a10" strokeWidth="2" /><path d="M24 14l6 4-2 7h-8l-2-7z" fill="#7a5a10" /><path d="M16 26l4-1 3 6-4 4M32 26l-4-1-3 6 4 4" fill="none" stroke="#7a5a10" strokeWidth="2" /></svg>
  );
  if (kind === 'globe') return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden><path d="M18 40h12l-2-6h-8z" fill="#c99a2e" /><circle cx="24" cy="18" r="11" fill="#f7d774" stroke="#7a5a10" strokeWidth="2" /><path d="M13 18h22M24 7c-6 7-6 15 0 22M24 7c6 7 6 15 0 22" fill="none" stroke="#7a5a10" strokeWidth="1.6" /><rect x="15" y="40" width="18" height="4" rx="1" fill="#7a5a10" /></svg>
  );
  if (kind === 'star') return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden><path d="M16 10h16v8a8 8 0 0 1-16 0z" fill="#d7dde4" stroke="#55606b" strokeWidth="2" /><path d="M24 30v6M17 40h14" stroke="#55606b" strokeWidth="3" /><path d="M24 12l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="#f2b705" /></svg>
  );
  return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden><path d="M14 8h20v8a10 10 0 0 1-20 0z" fill="#f7d774" stroke="#7a5a10" strokeWidth="2" /><path d="M14 11H8c0 6 3 9 7 9M34 11h6c0 6-3 9-7 9" fill="none" stroke="#7a5a10" strokeWidth="2" /><path d="M24 26v8" stroke="#7a5a10" strokeWidth="3" /><rect x="16" y="34" width="16" height="6" rx="1" fill="#7a5a10" /></svg>
  );
}

function CoachIcon() {
  return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden><circle cx="24" cy="15" r="8" fill="#3d4a57" /><path d="M8 44c1-12 8-17 16-17s15 5 16 17z" fill="#3d4a57" /><path d="M20 27l4 6 4-6" fill="none" stroke="#f4f1e8" strokeWidth="2" /></svg>
  );
}

function ClipboardIcon() {
  return (
    <svg className="mini-icon" viewBox="0 0 24 24" aria-hidden><rect x="5" y="4" width="14" height="18" rx="2" fill="#f4f1e8" stroke="#3d4a57" strokeWidth="1.5" /><rect x="9" y="2" width="6" height="4" rx="1" fill="#3d4a57" /><path d="M8 11h8M8 15h6" stroke="#3d4a57" strokeWidth="1.5" /></svg>
  );
}

function ShirtIcon() {
  return (
    <svg className="icon shirt" viewBox="0 0 48 48" aria-hidden><path d="M16 6l-10 6 4 9 5-2v23h18V19l5 2 4-9-10-6c-1 3-4 5-8 5s-7-2-8-5z" fill="#fff" stroke="#14201a" strokeWidth="2" /></svg>
  );
}

function ActionIcon({ action }: { action: string }) {
  switch (action) {
    case 'yellow': return <svg className="icon" viewBox="0 0 48 48" aria-hidden><rect x="14" y="6" width="20" height="30" rx="3" fill="#ffd400" stroke="#14201a" strokeWidth="2" transform="rotate(-8 24 21)" /><text x="24" y="44" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">+2</text></svg>;
    case 'red': return <svg className="icon" viewBox="0 0 48 48" aria-hidden><rect x="14" y="6" width="20" height="30" rx="3" fill="#e01e13" stroke="#14201a" strokeWidth="2" transform="rotate(8 24 21)" /></svg>;
    case 'var': return <svg className="icon" viewBox="0 0 48 48" aria-hidden><rect x="6" y="9" width="36" height="24" rx="3" fill="#14201a" stroke="#fff" strokeWidth="2" /><text x="24" y="26" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">VAR</text><path d="M18 40h12M24 33v7" stroke="#fff" strokeWidth="2" /></svg>;
    case 'transfer': return <svg className="icon" viewBox="0 0 48 48" aria-hidden><path d="M8 17h28l-6-6M40 31H12l6 6" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    default: return <svg className="icon" viewBox="0 0 48 48" aria-hidden>{[12, 24, 36].map((x) => <g key={x}><circle cx={x} cy="24" r="6.5" fill="#fff" stroke="#14201a" strokeWidth="1.5" /><circle cx={x} cy="24" r="2.2" fill="#14201a" /></g>)}</svg>;
  }
}
