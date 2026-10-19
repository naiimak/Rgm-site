// Card faces per the spec's "Card face layout": no crests, logos, kits, likenesses or badges.
// Every coloured card carries its league's colour band, symbol and flag, so colours never rely on hue alone.

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
  className?: string;
  style?: CSSProperties;
}

export function CardView({ card, config, size = 'md', dim, selected, onClick, label, className = '', style }: Props) {
  const title = cardTitle(config, card);
  const hex = card.colour ? colourHex(config, card.colour) : undefined;
  const symbol = card.colour ? colourSymbol(config, card.colour) : '';
  const cls = `card card-${size} kind-${card.kind}${card.kind === 'action' && !card.colour ? ' wild' : ''}${dim ? ' dim' : ''}${selected ? ' selected' : ''} ${className}`;
  const common = {
    className: cls, onClick, role: onClick ? 'button' : undefined, tabIndex: onClick ? 0 : undefined,
    onKeyDown: onClick ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined,
    'aria-label': label ?? `${title}${dim ? ' (cannot be played)' : ''}`,
    style: { ...(hex ? { '--c': hex } : {}), ...style } as CSSProperties,
  };
  const band = (left: string, right?: string) => (
    <div className="band"><span className="sym" aria-hidden>{symbol}</span><span className="band-text">{left}</span>{right && <span className="band-flag">{right}</span>}</div>
  );

  if (card.kind === 'club') {
    const club = config.clubs.find((c) => c.id === card.ref)!;
    const league = leagueOf(config, club.league);
    return (
      <div {...common}>
        {band(league.id, league.flag)}
        <div className="art"><Shirt kit={club.kit} /></div>
        <div className="name">{title}</div>
        <div className="type">Club</div>
      </div>
    );
  }
  if (card.kind === 'league' || card.kind === 'champion') {
    const league = leagueOf(config, card.ref);
    return (
      <div {...common}>
        {band(league.id, league.flag)}
        <div className="art">{card.kind === 'champion' ? <TrophyArt kind="cup" /> : <span className="big-flag">{league.flag}</span>}</div>
        <div className="name">{card.kind === 'champion' ? `${league.country} Champion` : league.country}</div>
        <div className="type">{card.kind === 'champion' ? 'League title' : 'Top Flight'}</div>
      </div>
    );
  }
  if (card.kind === 'trophy') {
    const icon = config.trophies.find((t) => t.id === card.ref)?.icon ?? 'cup';
    return (
      <div {...common}>
        <div className="band neutral"><span className="band-text">Trophy</span></div>
        <div className="art"><TrophyArt kind={icon} /></div>
        <div className="name">{title}</div>
        <div className="type">Any colour</div>
      </div>
    );
  }
  if (card.kind === 'coach') {
    return (
      <div {...common}>
        <div className="band neutral"><span className="band-text">Coach</span></div>
        <div className="art"><CoachArt /></div>
        <div className="name">{title}</div>
        <div className="type">Any colour</div>
      </div>
    );
  }
  if (card.kind === 'national') {
    const nation = config.nations.find((n) => n.id === card.ref)!;
    const stripes = `linear-gradient(160deg, ${nation.colours.map((c, i) => `${c} ${(i / nation.colours.length) * 100}% ${((i + 1) / nation.colours.length) * 100}%`).join(', ')})`;
    return (
      <div {...common} style={{ ...common.style, '--flagbg': stripes } as CSSProperties}>
        <div className="band neutral"><span className="band-text">Nation</span></div>
        <div className="art"><span className="big-flag">{nation.flag}</span></div>
        <div className="name">{nation.name}</div>
        <div className="type">Any colour</div>
      </div>
    );
  }
  const wild = card.colour === null;
  const sub = card.ref === 'yellow' ? 'Next draws 2' : card.ref === 'hattrick' ? 'Next draws 4' : card.ref === 'red' ? 'Skip next' : card.ref === 'var' ? 'Reverse' : 'Pick colour';
  return (
    <div {...common}>
      {wild ? <div className="band neutral"><span className="band-text">Wild</span></div> : band('Action')}
      <div className="art"><ActionArt action={card.ref} /></div>
      <div className="name">{title}</div>
      <div className="type">{sub}</div>
    </div>
  );
}

export function CardBack({ style = 'back-default', size = 'md', count }: { style?: string; size?: 'sm' | 'md'; count?: number }) {
  return (
    <div className={`card card-${size} card-back ${style}`} aria-label={count !== undefined ? `Draw pile, ${count} cards` : 'Card'}>
      <svg className="back-mark" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="2" opacity=".6" />
        <text x="20" y="25" textAnchor="middle" fontSize="13" fontWeight="900" fill="currentColor">1·2</text>
      </svg>
      {count !== undefined && <span className="back-count">{count}</span>}
    </div>
  );
}

/** Generic football shirt in the club's kit colours (no crest, no sponsor). */
function Shirt({ kit }: { kit: string[] }) {
  const [main, second = main, third] = kit;
  const id = `k${kit.join('').replace(/#/g, '')}`;
  return (
    <svg viewBox="0 0 60 56" className="shirt-art" aria-hidden>
      <defs>
        <clipPath id={id}><path d="M18 4 L6 10 L1 24 L11 28 L13 22 L13 54 L47 54 L47 22 L49 28 L59 24 L54 10 L42 4 Q36 10 30 10 Q24 10 18 4 Z" /></clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="60" height="56" fill={main} />
        {second !== main && [17, 26, 35, 44].map((x) => <rect key={x} x={x} width="4.5" height="56" fill={second} />)}
        {third && <rect x="0" y="30" width="60" height="5" fill={third} />}
        <rect x="0" y="0" width="13" height="56" fill={main} opacity={second !== main ? 1 : 0} />
        <rect x="47" y="0" width="13" height="56" fill={main} opacity={second !== main ? 1 : 0} />
      </g>
      <path d="M18 4 L6 10 L1 24 L11 28 L13 22 L13 54 L47 54 L47 22 L49 28 L59 24 L54 10 L42 4 Q36 10 30 10 Q24 10 18 4 Z" fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M24 6 Q30 12 36 6" fill="none" stroke="rgba(0,0,0,.4)" strokeWidth="1.5" />
    </svg>
  );
}

function TrophyArt({ kind }: { kind: string }) {
  const gold = <linearGradient id="gold" x1="0" x2="1"><stop offset="0" stopColor="#b8860b" /><stop offset=".5" stopColor="#ffe08a" /><stop offset="1" stopColor="#b8860b" /></linearGradient>;
  if (kind === 'ball') return (
    <svg viewBox="0 0 60 60" aria-hidden><defs>{gold}</defs>
      <circle cx="30" cy="28" r="20" fill="url(#gold)" stroke="#7a5a10" strokeWidth="2" />
      <path d="M30 17l7 5-3 8h-8l-3-8z" fill="#7a5a10" />
      <path d="M23 22l-9-2M37 22l9-2M26 30l-5 8M34 30l5 8M21 38h18" stroke="#7a5a10" strokeWidth="2" fill="none" />
      <rect x="22" y="50" width="16" height="6" rx="1" fill="#7a5a10" />
    </svg>
  );
  if (kind === 'globe') return (
    <svg viewBox="0 0 60 60" aria-hidden><defs>{gold}</defs>
      <path d="M22 56h16l-2-10c6-3 10-9 10-17a16 16 0 1 0-32 0c0 8 4 14 10 17z" fill="url(#gold)" stroke="#7a5a10" strokeWidth="2" />
      <path d="M16 26h28M30 13c-6 7-6 22 0 30M30 13c6 7 6 22 0 30" stroke="#7a5a10" strokeWidth="1.8" fill="none" />
      <rect x="18" y="54" width="24" height="5" rx="1" fill="#2f7d46" />
    </svg>
  );
  if (kind === 'star') return (
    <svg viewBox="0 0 60 60" aria-hidden>
      <path d="M18 8h24v14a12 12 0 0 1-24 0z" fill="#dfe5ec" stroke="#5b6672" strokeWidth="2" />
      <path d="M18 12H10c0 8 4 12 9 12M42 12h8c0 8-4 12-9 12" fill="none" stroke="#5b6672" strokeWidth="2" />
      <path d="M30 34v12M20 52h20" stroke="#5b6672" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 11l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="#2c5bd4" />
    </svg>
  );
  return (
    <svg viewBox="0 0 60 60" aria-hidden><defs>{gold}</defs>
      <path d="M17 6h26v16a13 13 0 0 1-26 0z" fill="url(#gold)" stroke="#7a5a10" strokeWidth="2" />
      <path d="M17 10C7 10 6 22 17 26M43 10c10 0 11 12 0 16" fill="none" stroke="#7a5a10" strokeWidth="3" />
      <path d="M30 35v10" stroke="#7a5a10" strokeWidth="4" />
      <path d="M20 46h20l2 8H18z" fill="#7a5a10" />
    </svg>
  );
}

function CoachArt() {
  return (
    <svg viewBox="0 0 60 60" aria-hidden>
      <circle cx="30" cy="18" r="9" fill="#2d3a46" />
      <path d="M20 13q10-9 20 0v-3q-10-6-20 0z" fill="#2d3a46" />
      <path d="M12 58c1-15 8-22 18-22s17 7 18 22z" fill="#2d3a46" />
      <rect x="35" y="38" width="13" height="17" rx="2" fill="#f4f1e8" stroke="#2d3a46" strokeWidth="1.5" />
      <path d="M38 44h7M38 48h5" stroke="#2d3a46" strokeWidth="1.5" />
      <circle cx="22" cy="44" r="3" fill="#c9a227" /><path d="M24 42l6-6" stroke="#c9a227" strokeWidth="1.5" />
    </svg>
  );
}

function ActionArt({ action }: { action: string }) {
  switch (action) {
    case 'yellow': return <svg viewBox="0 0 60 60" aria-hidden><rect x="18" y="6" width="24" height="36" rx="3" fill="#ffd400" stroke="#14201a" strokeWidth="2" transform="rotate(-10 30 24)" /><text x="30" y="57" textAnchor="middle" fontSize="13" fontWeight="900" fill="currentColor">+2</text></svg>;
    case 'red': return <svg viewBox="0 0 60 60" aria-hidden><rect x="18" y="8" width="24" height="36" rx="3" fill="#e01e13" stroke="#14201a" strokeWidth="2" transform="rotate(10 30 26)" /><path d="M12 54l36 0" stroke="currentColor" strokeWidth="3" strokeDasharray="4 4" /></svg>;
    case 'var': return <svg viewBox="0 0 60 60" aria-hidden><rect x="6" y="12" width="48" height="30" rx="4" fill="#14201a" stroke="currentColor" strokeWidth="2" /><text x="30" y="32" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff">VAR</text><path d="M22 50h16M30 42v8" stroke="currentColor" strokeWidth="3" /></svg>;
    case 'transfer': return <svg viewBox="0 0 60 60" aria-hidden><circle cx="30" cy="30" r="24" fill="rgba(0,0,0,.45)" /><path d="M14 24h28l-7-7M46 36H18l7 7" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    default: return <svg viewBox="0 0 60 60" aria-hidden><circle cx="30" cy="30" r="25" fill="rgba(0,0,0,.45)" />{[16, 30, 44].map((x) => <g key={x}><circle cx={x} cy="30" r="6.5" fill="#fff" stroke="#14201a" strokeWidth="1.5" /><path d={`M${x} 26l3 2-1 3h-4l-1-3z`} fill="#14201a" /></g>)}<text x="30" y="52" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff">+4</text></svg>;
  }
}
