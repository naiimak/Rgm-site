import { useEffect, useState } from 'react';
import type { BotLevel, RoomSettings } from '../../../engine/types.ts';
import { DEFAULT_SETTINGS } from '../../../engine/types.ts';
import { DEMO, FULL_GAME_URL, api, savePrefs, storage, track, type Prefs } from '../api.ts';
import { CardBack, CardView } from '../components/CardView.tsx';
import { Avatar, FakeAd, Modal, Segmented, Toggle, TopBar } from '../components/ui.tsx';
import { ERRORS, type ClientConfig, type GameOverView, type Profile, type RoomView } from '../model.ts';

export type Nav = (screen: 'home' | 'solo' | 'private' | 'profile' | 'leaderboard' | 'shop' | 'settings') => void;

// ------------------------------------------------------------------ Home

export function Home({ profile, config, nav, onQuick, onTutorial, newPlayer, setProfile }: {
  profile: Profile; config: ClientConfig; nav: Nav; onQuick: () => void; onTutorial: () => void; newPlayer: boolean; setProfile: (p: Profile) => void;
}) {
  const [ad, setAd] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="screen home">
      <header className="home-top">
        <button className="profile-chip" onClick={() => nav('profile')}>
          <Avatar emoji={profile.avatar} frame={profile.equipped.frame} size={36} />
          <span><b>{profile.username}</b><small>Level {profile.level}</small></span>
        </button>
        <div className="coins" aria-label={`${profile.coins} coins`}>🪙 {profile.coins}</div>
      </header>
      <div className="level-bar" aria-label="Level progress"><span style={{ width: `${(profile.levelProgress.into / profile.levelProgress.needed) * 100}%` }} /></div>

      <div className="brand">
        <div className="logo">One<span>·</span>Two</div>
        <HeroCards config={config} />
        <p>Link every card with a footballer who played for both.</p>
        {DEMO && <p className="demo-note">Demo: play the tutorial and games against bots. To play with friends, open the full game at <a href={FULL_GAME_URL} target="_blank" rel="noopener">one-two-game.fly.dev</a></p>}
      </div>

      <button className={`btn howto-btn${newPlayer ? ' new' : ''}`} onClick={onTutorial}>
        <span className="howto-icon" aria-hidden>🎓</span>
        <span className="howto-text"><b>How to play</b><small>{newPlayer ? 'New here? 2-minute training match' : 'Training match with tips'}</small></span>
        <span aria-hidden>›</span>
      </button>
      <button className="btn play-btn" onClick={onQuick}>Play<small>{DEMO ? 'Quick game · you vs 3 bots' : `Quick Match · ${config.rules.quickMatchSeats} players`}</small></button>
      <div className="home-grid">
        <button className="tile" onClick={() => nav('private')}><span>👥</span>Private Room</button>
        <button className="tile" onClick={() => nav('solo')}><span>🤖</span>Solo vs Bots</button>
        <button className="tile" onClick={() => nav('leaderboard')}><span>🏆</span>Leaderboard</button>
        <button className="tile" onClick={() => nav('shop')}><span>🛍️</span>Shop</button>
      </div>
      <div className="home-foot">
        <button className="btn ghost" disabled={profile.freeCoinsLeft <= 0} onClick={() => { track('ad_offered', { placement: 'free_coins' }); setAd(true); }}>
          🎬 Free coins ({profile.freeCoinsLeft} left today)
        </button>
        <button className="btn ghost" onClick={() => nav('settings')}>⚙️ Settings</button>
      </div>
      {msg && <div className="toast" role="status" onAnimationEnd={() => setMsg(null)}>{msg}</div>}
      {ad && <FakeAd onCancel={() => setAd(false)} onDone={async () => {
        setAd(false);
        try {
          const r = await api<{ granted: number; profile: Profile }>('/api/ads/reward', { body: { placement: 'free_coins' } });
          setProfile(r.profile);
          setMsg(`+${r.granted} coins`);
        } catch (e) { setMsg((e as Error).message); }
      }} />}
    </div>
  );
}

/** Home hero: two cards and the player who links them, as in the spec's example. */
function HeroCards({ config }: { config: ClientConfig }) {
  const card = (ref: string) => {
    const club = config.clubs.find((c) => c.id === ref);
    return club ? { id: `hero-${ref}`, kind: 'club' as const, ref, colour: config.leagues.find((l) => l.id === club.league)!.colour } : null;
  };
  const a = card('MUN'), b = card('RMA');
  if (!a || !b) return null;
  return (
    <div className="hero" aria-hidden>
      <CardView card={a} config={config} size="md" className="hero-a" />
      <div className="hero-link">Cristiano Ronaldo</div>
      <CardView card={b} config={config} size="md" className="hero-b" />
    </div>
  );
}

// ------------------------------------------------------------------ Settings form shared by Solo and Private

function SettingsForm({ config, settings, setSettings, bots, setBots, minBots }: {
  config: ClientConfig; settings: RoomSettings; setSettings: (s: RoomSettings) => void;
  bots: { count: number; level: BotLevel }; setBots: (b: { count: number; level: BotLevel }) => void; minBots: number;
}) {
  return (
    <div className="form">
      <Segmented label="Bots" value={bots.count} onChange={(count) => setBots({ ...bots, count })}
        options={Array.from({ length: 6 - minBots }, (_, i) => ({ value: i + minBots, label: String(i + minBots) }))} />
      <Segmented label="Bot difficulty" value={bots.level} onChange={(level) => setBots({ ...bots, level })}
        options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
      <Segmented label="Turn timer" value={settings.turnSeconds} onChange={(turnSeconds) => setSettings({ ...settings, turnSeconds })}
        options={config.rules.turnSecondsOptions.map((s) => ({ value: s, label: `${s}s` }))} />
      <Toggle label="Safe Play" hint="Same-colour club with no answer" checked={settings.safePlay} onChange={(safePlay) => setSettings({ ...settings, safePlay })} />
      <Toggle label="Stacking +2 and +4" checked={settings.stacking} onChange={(stacking) => setSettings({ ...settings, stacking })} />
      <Toggle label="Dim unplayable cards" hint="Off = harder game" checked={settings.dimUnplayable} onChange={(dimUnplayable) => setSettings({ ...settings, dimUnplayable })} />
      <LeaguePicker config={config} settings={settings} setSettings={setSettings} />
    </div>
  );
}

/** Turn whole leagues off: their clubs, League, Champion and action cards leave the deck. */
function LeaguePicker({ config, settings, setSettings }: { config: ClientConfig; settings: RoomSettings; setSettings: (s: RoomSettings) => void }) {
  const on = settings.leagues ?? config.leagues.map((l) => l.id);
  const toggle = (id: string) => {
    const next = on.includes(id) ? on.filter((x) => x !== id) : config.leagues.map((l) => l.id).filter((x) => x === id || on.includes(x));
    if (next.length < 2) return;
    setSettings({ ...settings, leagues: next.length === config.leagues.length ? undefined : next });
  };
  return (
    <div className="field">
      <span className="field-label">Leagues in the deck</span>
      <div className="league-picker">
        {config.leagues.map((l) => {
          const active = on.includes(l.id);
          return (
            <button key={l.id} role="switch" aria-checked={active} className={active ? 'on' : ''} style={{ '--c': l.hex } as React.CSSProperties}
              disabled={active && on.length <= 2} onClick={() => toggle(l.id)}>
              <span className="lp-flag">{l.flag}</span><span className="lp-name">{l.country}</span><span className="lp-tick" aria-hidden>{active ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
      <span className="field-hint">Fewer leagues = fewer clubs to know, so an easier game. Keep at least 2.</span>
    </div>
  );
}

const SETTINGS_KEY = 'onetwo.roomSettings';
function savedSettings(): RoomSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(storage(SETTINGS_KEY) ?? '{}') }; } catch { return DEFAULT_SETTINGS; }
}
function useRoomSettings() {
  const [settings, set] = useState<RoomSettings>(savedSettings);
  return [settings, (s: RoomSettings) => { set(s); storage(SETTINGS_KEY, JSON.stringify(s)); }] as const;
}

const LEVEL_DESC: Record<BotLevel, string> = {
  easy: 'Easy bots know the famous names and often miss. Good for learning the cards.',
  medium: 'Medium bots know most regular players and sometimes slip up.',
  hard: 'Hard bots rarely miss, stack penalties and never forget the Final Whistle.',
};

export function SoloSetup({ config, nav, onStart }: { config: ClientConfig; nav: Nav; onStart: (s: RoomSettings, b: { count: number; level: BotLevel }) => void }) {
  const [settings, setSettings] = useRoomSettings();
  const [bots, setBots] = useState<{ count: number; level: BotLevel }>({ count: 3, level: 'medium' });
  return (
    <div className="screen">
      <TopBar title="Solo vs Bots" onBack={() => nav('home')} />
      <SettingsForm config={config} settings={settings} setSettings={setSettings} bots={bots} setBots={setBots} minBots={1} />
      <p className="level-desc">{LEVEL_DESC[bots.level]}</p>
      <p className="muted small center">Games against bots give half XP and don’t count for the leaderboard.</p>
      <button className="btn primary wide" onClick={() => onStart(settings, bots)}>Kick off</button>
    </div>
  );
}

export function PrivateSetup({ config, nav, onCreate, onJoin, initialCode }: {
  config: ClientConfig; nav: Nav; initialCode?: string;
  onCreate: (s: RoomSettings, b: { count: number; level: BotLevel }) => void; onJoin: (code: string) => Promise<string | null>;
}) {
  const [tab, setTab] = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [settings, setSettings] = useRoomSettings();
  const [bots, setBots] = useState<{ count: number; level: BotLevel }>({ count: 0, level: 'medium' });
  const [code, setCode] = useState(initialCode ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="screen">
      <TopBar title="Private Room" onBack={() => nav('home')} />
      <Segmented label="" value={tab} onChange={setTab} options={[{ value: 'create', label: 'Create room' }, { value: 'join', label: 'Join with code' }]} />
      {tab === 'create' ? (
        <>
          <SettingsForm config={config} settings={settings} setSettings={setSettings} bots={bots} setBots={setBots} minBots={0} />
          <button className="btn primary wide" onClick={() => onCreate(settings, bots)}>Create room</button>
        </>
      ) : (
        <div className="form">
          <input className="code-input" value={code} maxLength={6} placeholder="ROOM CODE" aria-label="Room code"
            onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setError(null); }} />
          {error && <div className="error">{error}</div>}
          <button className="btn primary wide" disabled={code.length !== 6} onClick={async () => setError(await onJoin(code))}>Join</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Lobby

export function Lobby({ room, config, clockOffset, onStart, onLeave, onSettings }: {
  room: RoomView; config: ClientConfig; clockOffset: number; onStart: () => Promise<string | null>; onLeave: () => void;
  onSettings: (s: RoomSettings, b: { count: number; level: BotLevel }) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const quick = room.mode === 'quick';
  const left = room.quickStartsAt ? Math.max(0, Math.ceil((room.quickStartsAt - (now + clockOffset)) / 1000)) : null;
  const seats = quick ? config.rules.quickMatchSeats : 6;
  const shareText = `Join my One-Two game! Room code ${room.code}: ${room.shareUrl}`;

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'One-Two', text: shareText, url: room.shareUrl }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(shareText); setCopied(true); } catch { /* ignore */ }
  };

  return (
    <div className="screen lobby">
      <TopBar title={quick ? 'Finding players…' : 'Lobby'} onBack={onLeave} />
      {!quick && (
        <div className="code-card">
          <div className="muted small">Room code</div>
          <div className="room-code">{room.code}</div>
          <div className="row">
            <button className="btn primary" onClick={share}>{copied ? 'Link copied' : 'Share'}</button>
            <a className="btn whatsapp" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        </div>
      )}
      {quick && <p className="center">{left !== null && left > 0 ? `Bots fill empty seats in ${left}s` : 'Starting…'}</p>}
      <ul className="seats">
        {Array.from({ length: seats }, (_, i) => room.members[i]).map((m, i) => (
          <li key={i} className={m ? '' : 'empty'}>
            {m ? (
              <>
                <Avatar emoji={m.avatar} size={36} />
                <span className="seat-name">{m.name}{m.you && ' (you)'}</span>
                {m.isHost && <span className="badge">Host</span>}
                {m.isBot && <span className="badge bot">BOT · {m.botLevel}</span>}
                {!m.connected && !m.isBot && <span className="badge away">away</span>}
              </>
            ) : <span className="muted">Waiting…</span>}
          </li>
        ))}
      </ul>
      {!quick && (
        <div className="lobby-settings muted small">
          {room.settings.turnSeconds}s turns · Safe Play {room.settings.safePlay ? 'on' : 'off'} · Stacking {room.settings.stacking ? 'on' : 'off'} · Dimming {room.settings.dimUnplayable ? 'on' : 'off'} · {room.settings.leagues ? `Leagues: ${room.settings.leagues.join(', ')}` : 'All leagues'}
          {room.isHost && <button className="link-btn" onClick={() => setEditing(true)}>Change</button>}
        </div>
      )}
      {error && <div className="error center">{error}</div>}
      {!quick && room.isHost && <button className="btn primary wide" disabled={room.members.length < 2} onClick={async () => setError(await onStart())}>Start game</button>}
      {!quick && !room.isHost && <p className="center muted">Waiting for the host to start</p>}
      {editing && <LobbySettings room={room} config={config} onClose={() => setEditing(false)} onSave={(s, b) => { onSettings(s, b); setEditing(false); }} />}
    </div>
  );
}

function LobbySettings({ room, config, onClose, onSave }: { room: RoomView; config: ClientConfig; onClose: () => void; onSave: (s: RoomSettings, b: { count: number; level: BotLevel }) => void }) {
  const [settings, setSettings] = useState(room.settings);
  const [bots, setBots] = useState(room.bots);
  return (
    <Modal title="Room settings" onClose={onClose}>
      <SettingsForm config={config} settings={settings} setSettings={setSettings} bots={bots} setBots={setBots} minBots={0} />
      <button className="btn primary wide" onClick={() => onSave(settings, bots)}>Save</button>
    </Modal>
  );
}

// ------------------------------------------------------------------ Results

export function Results({ results, profile, onRematch, onHome, setProfile }: { results: GameOverView; profile: Profile; onRematch: () => void; onHome: () => void; setProfile: (p: Profile) => void }) {
  const [ad, setAd] = useState(false);
  const [doubled, setDoubled] = useState(false);
  const won = results.placings[0]?.seat === results.you;
  const me = results.placings.find((p) => p.seat === results.you);
  const r = results.reward;
  const celebration = profile.equipped.celebration ?? 'win-confetti';
  return (
    <div className="screen results">
      {won && <div className={`celebrate ${celebration}`} aria-hidden>{celebration === 'win-chant' ? 'Olé, olé, olé!' : ''}</div>}
      <div className="result-head">
        <div className="result-badge">{won ? '🏆' : me && me.place <= 2 ? '🥈' : '⏱️'}</div>
        <h1>{won ? 'You win!' : 'Full time'}</h1>
        <p className="muted">{won ? 'Cleared your hand first.' : me ? `You finished ${ordinal(me.place)} with ${me.cardsLeft} card${me.cardsLeft === 1 ? '' : 's'} left.` : ''}</p>
      </div>
      <p className="placings-note">Losers are ranked by the points of the cards left in their hand. Fewer is better.</p>
      <ol className="placings">
        {results.placings.map((p, i) => (
          <li key={p.seat} className={`${p.seat === results.you ? 'you' : ''} p${p.place}`} style={{ animationDelay: `${i * 90}ms` }}>
            <span className="place">{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : p.place}</span>
            <span className="pav">{p.avatar}</span>
            <span className="pn">{p.name}{p.isBot && <span className="badge bot">BOT</span>}</span>
            {p.place === 1
              ? <span className="pts won">Won</span>
              : <span className="pts"><b>−{p.points}</b><small>{p.cardsLeft} card{p.cardsLeft === 1 ? '' : 's'} left</small></span>}
          </li>
        ))}
      </ol>
      {r && (
        <div className="rewards">
          <div className="reward-row">
            <div className="reward"><b>+{r.xp}</b><span>XP{r.solo && <small> (half vs bots)</small>}</span></div>
            <div className="reward"><b>+{doubled ? r.coins * 2 : r.coins}</b><span>🪙 coins</span></div>
          </div>
          {r.levelUps > 0 && <div className="levelup">Level up! You’re level {r.level}</div>}
          {!doubled && profile.doubleCoinsAvailable && (
            <button className="btn ghost" onClick={() => { track('ad_offered', { placement: 'double_coins' }); setAd(true); }}>🎬 Watch an ad: double coins</button>
          )}
          {r.starterPack && <div className="starter">Starter Pack unlocked: coins + an exclusive card back. Available in the shop once store billing is live.</div>}
        </div>
      )}
      <div className="row">
        <button className="btn ghost" onClick={onHome}>Home</button>
        <button className="btn primary" onClick={onRematch}>Rematch</button>
      </div>
      {ad && <FakeAd onCancel={() => setAd(false)} onDone={async () => {
        setAd(false);
        try {
          const res = await api<{ profile: Profile }>('/api/ads/reward', { body: { placement: 'double_coins' } });
          setProfile(res.profile);
          setDoubled(true);
        } catch { /* already used */ }
      }} />}
    </div>
  );
}

function ordinal(n: number) {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

// ------------------------------------------------------------------ Profile

export function ProfileScreen({ profile, config, nav, setProfile }: { profile: Profile; config: ClientConfig; nav: Nav; setProfile: (p: Profile) => void }) {
  const [name, setName] = useState(profile.username);
  const [error, setError] = useState<string | null>(null);
  const save = async (body: Record<string, string>) => {
    try { setProfile(await api<Profile>('/api/me', { method: 'PATCH', body })); setError(null); } catch (e) { setError((e as Error).message); }
  };
  const s = profile.stats;
  const equipped = (cat: string) => config.shop.find((i) => i.id === profile.equipped[cat])?.name ?? '—';
  return (
    <div className="screen">
      <TopBar title="Profile" onBack={() => nav('home')} />
      <div className="profile-head">
        <Avatar emoji={profile.avatar} frame={profile.equipped.frame} size={72} />
        <div>
          <div className="row tight">
            <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} aria-label="Username" />
            {name !== profile.username && <button className="btn primary small" onClick={() => save({ username: name })}>Save</button>}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="muted">Level {profile.level} · {profile.xp} XP · 🪙 {profile.coins}</div>
        </div>
      </div>
      <div className="avatar-pick" role="radiogroup" aria-label="Avatar">
        {config.avatars.map((a) => <button key={a} className={a === profile.avatar ? 'on' : ''} onClick={() => save({ avatar: a })}>{a}</button>)}
      </div>
      <div className="stats-grid">
        <div><b>{s.games}</b><span>Games</span></div>
        <div><b>{s.wins}</b><span>Wins</span></div>
        <div><b>{s.winRate}%</b><span>Win rate</span></div>
        <div><b>{s.correctAnswers}</b><span>Correct answers</span></div>
        <div><b>{s.bestStreak}</b><span>Best answer streak</span></div>
        <div><b className="sm">{s.mostNamed ?? '—'}</b><span>Most-named player</span></div>
        <div><b className="sm">{s.favouriteClub ?? '—'}</b><span>Favourite club card</span></div>
      </div>
      <h3>Equipped</h3>
      <p className="muted">Card back: {equipped('cardBack')} · Table: {equipped('table')} · Frame: {equipped('frame')} · Celebration: {equipped('celebration')}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Leaderboard

type Row = { rank: number; username: string; avatar: string; level: number; xp: number; you: boolean };

export function Leaderboard({ nav }: { nav: Nav }) {
  const [period, setPeriod] = useState<'weekly' | 'all'>('weekly');
  const [data, setData] = useState<{ top: Row[]; me: Row | null } | null>(null);
  useEffect(() => {
    setData(null);
    api<{ top: Row[]; me: Row | null }>(`/api/leaderboard?period=${period}`).then(setData).catch(() => setData({ top: [], me: null }));
  }, [period]);
  return (
    <div className="screen">
      <TopBar title="Leaderboard" onBack={() => nav('home')} />
      <Segmented label="" value={period} onChange={setPeriod} options={[{ value: 'weekly', label: 'This week' }, { value: 'all', label: 'All time' }]} />
      <p className="muted small center">XP from Quick Match and Private Rooms. Weekly resets Monday 00:00 UTC.</p>
      {!data ? <p className="center muted">Loading…</p> : (
        <ol className="board">
          {data.top.map((r) => <BoardRow key={r.rank} r={r} />)}
          {!data.top.length && <li className="muted center">No online games yet this period.</li>}
          {data.me && data.me.rank > 100 && <><li className="gap">⋯</li><BoardRow r={data.me} /></>}
        </ol>
      )}
    </div>
  );
}

function BoardRow({ r }: { r: Row }) {
  return <li className={r.you ? 'you' : ''}><span className="place">{r.rank}</span><span>{r.avatar}</span><span className="pn">{r.username} <small className="muted">L{r.level}</small></span><b>{r.xp} XP</b></li>;
}

// ------------------------------------------------------------------ Shop

const CATEGORIES = [
  { id: 'cardBack', name: 'Card backs' },
  { id: 'table', name: 'Tables' },
  { id: 'frame', name: 'Frames' },
  { id: 'celebration', name: 'Celebrations' },
];

export function Shop({ profile, config, nav, setProfile }: { profile: Profile; config: ClientConfig; nav: Nav; setProfile: (p: Profile) => void }) {
  const [cat, setCat] = useState('cardBack');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (path: string, itemId: string) => {
    try { setProfile(await api<Profile>(path, { body: { itemId } })); setError(null); } catch (e) { setError((e as Error).message); }
  };
  const item = config.shop.find((i) => i.id === preview);
  return (
    <div className="screen">
      <TopBar title="Shop" onBack={() => nav('home')} right={<span className="coins">🪙 {profile.coins}</span>} />
      <div className="chips grid">{CATEGORIES.map((c) => <button key={c.id} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>
      <p className="muted small center">Cosmetic only: nothing in the shop helps you win. Everything shows exactly what you get.</p>
      <div className="shop-grid">
        {config.shop.filter((i) => i.category === cat).map((i) => {
          const owned = profile.owned.includes(i.id);
          const on = profile.equipped[i.category] === i.id;
          return (
            <button key={i.id} className={`shop-item${on ? ' on' : ''}`} onClick={() => setPreview(i.id)}>
              <ShopPreview id={i.id} category={i.category} />
              <span>{i.name}</span>
              <small>{on ? 'Equipped' : owned ? 'Owned' : i.unlockLevel ? `Level ${i.unlockLevel}` : `🪙 ${i.price}`}</small>
            </button>
          );
        })}
      </div>
      <h3>Coin packs</h3>
      <div className="packs">
        {config.coinPacks.map((p) => <div key={p.id} className="pack"><b>🪙 {p.coins}</b><button className="btn ghost small" disabled title="Apple / Google in-app purchase in the store builds">{p.price}</button></div>)}
      </div>
      <p className="muted small">Coin packs are bought through the App Store / Google Play in the mobile builds.</p>
      {item && (
        <Modal title={item.name} onClose={() => setPreview(null)}>
          <div className="preview-big"><ShopPreview id={item.id} category={item.category} big /></div>
          {error && <div className="error">{error}</div>}
          {profile.owned.includes(item.id)
            ? <button className="btn primary wide" disabled={profile.equipped[item.category] === item.id} onClick={() => act('/api/shop/equip', item.id)}>{profile.equipped[item.category] === item.id ? 'Equipped' : 'Equip'}</button>
            : item.unlockLevel
              ? <button className="btn primary wide" disabled={profile.level < item.unlockLevel} onClick={() => act('/api/shop/buy', item.id)}>{profile.level < item.unlockLevel ? `Unlocks at level ${item.unlockLevel}` : 'Claim'}</button>
              : <button className="btn primary wide" disabled={profile.coins < item.price} onClick={() => act('/api/shop/buy', item.id)}>Buy for 🪙 {item.price}</button>}
        </Modal>
      )}
    </div>
  );
}

function ShopPreview({ id, category, big }: { id: string; category: string; big?: boolean }) {
  if (category === 'cardBack') return <CardBack style={id} size={big ? 'md' : 'sm'} />;
  if (category === 'table') return <div className={`table-swatch ${id}${big ? ' big' : ''}`} />;
  if (category === 'frame') return <Avatar emoji="⚽" frame={id} size={big ? 72 : 40} />;
  return <div className={`celebration-swatch ${id}`}>{id === 'win-confetti' ? '🎊' : id === 'win-fireworks' ? '🎆' : '📣'}</div>;
}

// ------------------------------------------------------------------ Settings

export function SettingsScreen({ config, nav, prefs, setPrefs, onReplayTutorial, onDeleted, dataVersion }: {
  config: ClientConfig; nav: Nav; prefs: Prefs; setPrefs: (p: Prefs) => void; onReplayTutorial: () => void; onDeleted: () => void; dataVersion: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const [roomSettings, setRoomSettings] = useRoomSettings();
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const update = (p: Partial<Prefs>) => { const next = { ...prefs, ...p }; setPrefs(next); savePrefs(next); };
  const link = async (provider: string) => {
    try { await api('/api/me/link', { body: { provider } }); } catch (e) { setLinkMsg((e as Error).message); }
  };
  return (
    <div className="screen">
      <TopBar title="Settings" onBack={() => nav('home')} />
      <div className="form">
        <Toggle label="Sound" checked={prefs.sound} onChange={(sound) => update({ sound })} />
        <Toggle label="Music" checked={prefs.music} onChange={(music) => update({ music })} />
        <Toggle label="Vibration" checked={prefs.vibration} onChange={(vibration) => update({ vibration })} />
        <Toggle label="Personalised ads" hint="Your ad consent choice" checked={prefs.personalisedAds} onChange={(personalisedAds) => update({ personalisedAds })} />
      </div>
      <h3>Game</h3>
      <div className="form">
        <LeaguePicker config={config} settings={roomSettings} setSettings={setRoomSettings} />
        <p className="muted small">Used for {DEMO ? 'Play, ' : ''}Solo vs Bots and Private Rooms you create.{DEMO ? '' : ' Online Quick Match always uses all five leagues.'}</p>
      </div>
      <h3>Account</h3>
      <p className="muted small">You’re playing as a guest. Link an account to keep your progress across devices.</p>
      <div className="row">
        <button className="btn ghost" onClick={() => link('apple')}> Sign in with Apple</button>
        <button className="btn ghost" onClick={() => link('google')}>G Sign in with Google</button>
      </div>
      {linkMsg && <p className="muted small">{linkMsg}</p>}
      <div className="list-buttons">
        <button onClick={onReplayTutorial}>Replay tutorial</button>
        <a href="#terms" onClick={(e) => e.preventDefault()}>Terms of use (before launch)</a>
        <a href="#privacy" onClick={(e) => e.preventDefault()}>Privacy policy (before launch)</a>
        <button className="danger-text" onClick={() => setConfirm(true)}>Delete account</button>
      </div>
      <h3>About</h3>
      <p className="muted small">Player data from Wikidata. Club, league and competition names are generic; One-Two is not affiliated with any club, league or federation. Data version {dataVersion}.</p>
      {confirm && (
        <Modal title="Delete your account?" onClose={() => setConfirm(false)}>
          <p>This removes your progress, coins and cosmetics for good.</p>
          <div className="row">
            <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn danger" onClick={async () => { await api('/api/me', { method: 'DELETE' }); onDeleted(); }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function errorText(code: string | undefined): string {
  return code ? ERRORS[code] ?? code : 'Something went wrong';
}
