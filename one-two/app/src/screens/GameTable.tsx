import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Card, Colour, GameStateView, PlayResult } from '../../../engine/types.ts';
import { flagFor, search, type SearchIndex } from '../../../engine/search.ts';
import { api, emit, sfx, track, type Prefs } from '../api.ts';
import { CardBack, CardView } from '../components/CardView.tsx';
import { Avatar, FakeAd, Modal } from '../components/ui.tsx';
import { ERRORS, cardTitle, colourHex, colourSymbol, question, type ClientConfig, type Profile, type RoomView } from '../model.ts';

interface Props {
  config: ClientConfig;
  game: GameStateView;
  clockOffset: number;
  room: RoomView | null;
  socket: Socket;
  profile: Profile;
  prefs: Prefs;
  index: SearchIndex;
  flags: Record<string, string>;
  lastPlay: { result: PlayResult; at: number } | null;
  emotes: { seat: number; emoteId: string; at: number }[];
  onLeave: () => void;
  onSkipTutorial: () => void;
}

export function GameTable({ config, game, clockOffset, room, socket, profile, prefs, index, flags, lastPlay, emotes, onLeave, onSkipTutorial }: Props) {
  const me = game.you ?? -1;
  const myTurn = game.phase === 'playing' && game.turn === me;
  const [selected, setSelected] = useState<string | null>(null);
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [colourFor, setColourFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showEmotes, setShowEmotes] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reported, setReported] = useState<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // Close dialogs that no longer make sense when the turn moves on.
  useEffect(() => {
    if (!myTurn) {
      setAnswerFor(null);
      setColourFor(null);
    }
    if (myTurn) sfx('turn', prefs);
  }, [myTurn, game.turnNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const remaining = Math.max(0, game.turnEndsAt - (now + clockOffset));
  const fraction = remaining / (game.settings.turnSeconds * 1000);
  const playable = new Set(game.playable);
  const dimOn = game.settings.dimUnplayable;
  const tableTheme = profile.equipped.table ?? 'table-grass';
  const back = profile.equipped.cardBack ?? 'back-default';

  const send = async (event: string, payload: unknown = {}) => {
    if (busy.current) return { ok: false, error: 'busy' };
    busy.current = true;
    const res = await emit<{ ok: boolean; error?: string; hint?: { name: string } | null }>(socket, event, payload);
    busy.current = false;
    if (!res.ok && res.error && res.error !== 'already_used') setToast(ERRORS[res.error] ?? res.error);
    return res;
  };

  const tapCard = (card: Card) => {
    sfx('tap', prefs);
    if (selected !== card.id) return setSelected(card.id);
    if (!myTurn) return setToast('Wait for your turn');
    if (card.kind === 'action') {
      if (card.colour === null) return setColourFor(card.id);
      void send('play_card', { cardId: card.id }).then((r) => r.ok && setSelected(null));
      return;
    }
    setAnswerFor(card.id);
  };

  const seatsInOrder = useMemo(() => {
    const n = game.seats.length;
    const start = me >= 0 ? me : 0;
    return Array.from({ length: n - (me >= 0 ? 1 : 0) }, (_, i) => game.seats[(start + 1 + i) % n]);
  }, [game.seats, me]);

  const mySeat = me >= 0 ? game.seats[me] : null;
  const answerCard = game.hand.find((c) => c.id === answerFor) ?? null;
  const drawnCard = game.drawnCardId ? game.hand.find((c) => c.id === game.drawnCardId) : null;
  const activeHex = colourHex(config, game.activeColour);
  const currentName = game.seats[game.turn]?.name;
  const recent = lastPlay && now - lastPlay.at < 6000 ? lastPlay : null;

  const report = async (result: PlayResult) => {
    if (!result.answer || !result.anchorBefore) return;
    try {
      await api('/api/reports', { body: {
        gameId: game.gameId, cardA: `${result.anchorBefore.kind}:${result.anchorBefore.ref}`, cardB: `${result.card.kind}:${result.card.ref}`,
        playerId: result.answer.id, verdict: result.valid ? 'valid' : 'wrong',
      } });
      setReported(lastPlay?.at ?? 0);
      setToast('Thanks — sent for review');
    } catch {
      setToast('Could not send the report');
    }
  };

  return (
    <div className={`table ${tableTheme}`}>
      <div className="table-top">
        <button className="icon-btn" onClick={() => setConfirmLeave(true)} aria-label="Leave game">✕</button>
        <div className="room-chip">{room?.mode === 'tutorial' ? 'Tutorial' : room?.mode === 'solo' ? 'Solo vs Bots' : room?.mode === 'quick' ? 'Quick Match' : `Room ${room?.code ?? ''}`}</div>
        <button className="icon-btn" onClick={() => setShowEmotes(!showEmotes)} aria-label="Emotes">💬</button>
      </div>
      {room?.mode === 'tutorial' && <TutorialTip game={game} onSkip={onSkipTutorial} />}

      <div className="opponents">
        {seatsInOrder.map((s) => {
          const turn = game.turn === s.seat && game.phase === 'playing';
          const bubble = emotes.filter((e) => e.seat === s.seat).slice(-1)[0];
          return (
            <div key={s.seat} className={`opp${turn ? ' turn' : ''}${!s.connected && !s.isBot ? ' away' : ''}`}>
              <Avatar emoji={s.avatar} size={40} ring={turn ? fraction : undefined} active={turn} />
              <div className="opp-name">{s.name}</div>
              <div className="opp-meta">
                {(s.isBot || s.botControlled) && <span className="badge bot">{s.isBot ? 'BOT' : 'BOT (away)'}</span>}
                <span className="badge count">{s.cardCount} 🂠</span>
                {s.whistle && <span className="badge whistle" title="Called Final Whistle">FW</span>}
              </div>
              {bubble && <div className="bubble">{config.emotes.find((e) => e.id === bubble.emoteId)?.text}</div>}
            </div>
          );
        })}
      </div>

      <div className="centre">
        <div className="pile-area" style={{ borderColor: activeHex }}>
          <div className="anchor-label">Link to: <b>{cardTitle(config, game.anchor)}</b></div>
          <div className="pile">
            <CardView card={game.anchor} config={config} size="lg" />
            {game.top.id !== game.anchor.id && <div className="pile-top"><CardView card={game.top} config={config} size="md" /></div>}
          </div>
          <div className="pile-foot">
            <span className="colour-dot" style={{ background: activeHex }}>{colourSymbol(config, game.activeColour)}</span>
            <span>{config.leagues.find((l) => l.colour === game.activeColour)?.country}</span>
            <span className="direction" title="Direction of play">{game.direction === 1 ? '↻' : '↺'}</span>
          </div>
        </div>
        <button className={`draw-pile${myTurn && !game.drawnCardId ? ' can' : ''}`} onClick={() => myTurn && !game.drawnCardId && void send('draw_card')} aria-label="Draw a card" disabled={!myTurn || !!game.drawnCardId}>
          <CardBack style={back} count={game.deckCount} />
          <span>{game.pendingDraw ? `Take ${game.pendingDraw.amount}` : 'Draw'}</span>
        </button>
      </div>

      <div className="playlog">
        {recent && (
          <div className={`latest ${recent.result.valid ? 'good' : 'bad'}`}>
            <div className="latest-text">
              {recent.result.playType === 'link' ? (
                recent.result.valid
                  ? <><b>{recent.result.playerName}: {recent.result.answer!.name}</b>{recent.result.connections!.map((c, i) => <span key={i}> · {c}</span>)}</>
                  : <><b>{recent.result.playerName}: {recent.result.answer!.name}</b> ✗ {recent.result.reason} <span className="muted">(+{recent.result.penalty} cards)</span></>
              ) : logLine(config, recent.result)}
            </div>
            {recent.result.playType === 'link' && reported !== recent.at && <button className="link-btn" onClick={() => report(recent.result)}>Report</button>}
          </div>
        )}
        <button className="log-lines" onClick={() => setShowLog(true)} aria-label="Show the full game log">
          {(recent ? game.log.slice(-3, -1) : game.log.slice(-3)).map((r, i) => <div key={i} className={r.valid ? '' : 'bad'}>{logLine(config, r)}</div>)}
          {!game.log.length && <div className="muted">Plays appear here · tap for the full log</div>}
        </button>
      </div>

      <div className="status">
        {game.phase === 'over' ? 'Full time!'
          : myTurn ? (game.pendingDraw ? `Stack a ${game.pendingDraw.action === 'yellow' ? 'Yellow Card' : 'Hat-trick'} or take ${game.pendingDraw.amount}`
            : drawnCard ? 'You drew a playable card: play it or keep it'
            : 'Your turn: link a card, match the colour, or draw')
          : `${currentName}'s turn`}
        {myTurn && <span className="timer" style={{ color: remaining < 5000 ? '#ff6b6b' : undefined }}>{Math.ceil(remaining / 1000)}s</span>}
      </div>

      <div className="me-bar">
        {mySeat && <Avatar emoji={mySeat.avatar} frame={profile.equipped.frame} size={36} ring={myTurn ? fraction : undefined} active={myTurn} />}
        <span className="me-name">{mySeat?.name}</span>
        {mySeat?.whistle && <span className="badge whistle">FW</span>}
        <div className="me-actions">
          {mySeat && game.hand.length === 2 && !mySeat.whistle && game.phase === 'playing' && (
            <button className="btn whistle-btn" onClick={() => void send('final_whistle')}>Final Whistle!</button>
          )}
          {myTurn && drawnCard && <button className="btn ghost" onClick={() => void send('pass_card')}>Keep it</button>}
        </div>
      </div>

      <div className="hand" role="list" aria-label="Your hand">
        {game.hand.map((card) => (
          <div key={card.id} role="listitem" className={`hand-slot${card.id === game.drawnCardId ? ' drawn' : ''}`}>
            <CardView card={card} config={config} size="md" dim={dimOn && !playable.has(card.id)} selected={selected === card.id} onClick={() => tapCard(card)} />
          </div>
        ))}
      </div>
      <div className="hand-hint muted">{selected ? 'Tap the card again to play it' : 'Tap a card to select it'}</div>

      {answerCard && (
        <AnswerBox
          config={config} game={game} card={answerCard} index={index} flags={flags} remaining={remaining}
          canSafePlay={game.safePlayable.includes(answerCard.id)}
          onClose={() => setAnswerFor(null)}
          onAnswer={async (playerId) => {
            const res = await send('play_card', { cardId: answerCard.id, playerId });
            if (res.ok) { setAnswerFor(null); setSelected(null); }
            return res;
          }}
          onSafePlay={async () => {
            const res = await send('play_card', { cardId: answerCard.id });
            if (res.ok) { setAnswerFor(null); setSelected(null); }
          }}
          onHint={(payment, adReceipt) => send('request_hint', { cardId: answerCard.id, payment, adReceipt })}
        />
      )}

      {colourFor && (
        <Modal title="Choose the colour" onClose={() => setColourFor(null)}>
          <div className="colour-picker">
            {config.leagues.map((l) => (
              <button key={l.id} style={{ background: l.hex }} onClick={async () => {
                const res = await send('play_card', { cardId: colourFor, colour: l.colour as Colour });
                if (res.ok) { setColourFor(null); setSelected(null); }
              }}>
                <span className="sym">{l.symbol}</span><span>{l.country}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showEmotes && (
        <div className="emote-tray">
          {config.emotes.map((e) => <button key={e.id} onClick={() => { socket.emit('emote', { emoteId: e.id }); setShowEmotes(false); }}>{e.text}</button>)}
        </div>
      )}
      {emotes.filter((e) => e.seat === me).slice(-1).map((e) => <div key={e.at} className="bubble mine">{config.emotes.find((x) => x.id === e.emoteId)?.text}</div>)}

      {showLog && (
        <Modal title="Game log" onClose={() => setShowLog(false)}>
          <div className="full-log">{[...game.log].reverse().map((r, i) => (
            <div key={i} className={r.valid ? '' : 'bad'}>
              <div>{logLine(config, r)}</div>
              {r.connections && <small className="muted">{r.connections.join(' · ')}</small>}
              {r.reason && <small className="muted">{r.reason}</small>}
            </div>
          ))}</div>
        </Modal>
      )}

      {confirmLeave && (
        <Modal title="Leave the game?" onClose={() => setConfirmLeave(false)}>
          <p>A bot will take your seat and you won’t earn XP or coins for this game.</p>
          <div className="row"><button className="btn ghost" onClick={() => setConfirmLeave(false)}>Stay</button><button className="btn danger" onClick={onLeave}>Leave</button></div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function logLine(config: ClientConfig, r: PlayResult): string {
  const title = cardTitle(config, r.card);
  if (r.playType === 'link') return r.valid ? `${r.playerName}: ${title} ← ${r.answer!.name}` : `${r.playerName}: ✗ ${r.answer!.name} for ${title}`;
  if (r.playType === 'safe') return `${r.playerName}: ${title} (Safe Play)`;
  if (r.playType === 'wild') return `${r.playerName}: ${title} → ${config.leagues.find((l) => l.colour === r.chosenColour)?.country ?? ''}`;
  return `${r.playerName}: ${title}`;
}

interface AnswerBoxProps {
  config: ClientConfig;
  game: GameStateView;
  card: Card;
  index: SearchIndex;
  flags: Record<string, string>;
  remaining: number;
  canSafePlay: boolean;
  onClose: () => void;
  onAnswer: (playerId: string) => Promise<{ ok: boolean; error?: string }>;
  onSafePlay: () => Promise<void>;
  onHint: (payment: 'card' | 'ad', adReceipt?: string) => Promise<{ ok: boolean; error?: string; hint?: { name: string } | null }>;
}

function AnswerBox({ config, game, card, index, flags, remaining, canSafePlay, onClose, onAnswer, onSafePlay, onHint }: AnswerBoxProps) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [showAd, setShowAd] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(index, query, 8), [index, query]);

  useEffect(() => { input.current?.focus(); }, []);

  const hintResult = (r: { ok: boolean; hint?: { name: string } | null }) => {
    if (!r.ok) return;
    if (r.hint) { setHint(r.hint.name); setQuery(r.hint.name); }
    else setMessage('No unused player links these cards. Draw instead.');
  };

  return (
    <div className="answer-sheet" role="dialog" aria-label="Name a player">
      <div className="answer-head">
        <CardView card={card} config={config} size="sm" />
        <div className="answer-q">
          <div className="muted small">Link {cardTitle(config, game.anchor)} → {cardTitle(config, card)}</div>
          <div className="q">{question(config, game.anchor, card)}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Cancel">✕</button>
      </div>
      <div className="answer-input">
        <input ref={input} value={query} onChange={(e) => { setQuery(e.target.value); setMessage(null); }} placeholder="Type 2+ letters of a player…" autoComplete="off" autoCorrect="off" spellCheck={false} />
        <span className="timer">{Math.ceil(remaining / 1000)}s</span>
      </div>
      {message && <div className="answer-msg">{message}</div>}
      {hint && <div className="answer-msg good">Hint: {hint}</div>}
      <ul className="suggestions">
        {results.map((p) => (
          <li key={p.id}>
            <button onClick={async () => {
              const r = await onAnswer(p.id);
              if (!r.ok && r.error === 'already_used') setMessage('Already used — pick again');
            }}>
              <span className="flag">{flagFor(p.f, flags)}</span>
              <span className="pname">{p.n}</span>
              <span className="muted">{p.b}</span>
            </button>
          </li>
        ))}
        {query.length >= 2 && !results.length && <li className="muted pad">No player by that name</li>}
      </ul>
      <div className="answer-actions">
        {canSafePlay && <button className="btn ghost" onClick={() => void onSafePlay()}>Safe Play (no answer)</button>}
        {!game.hintUsedThisTurn && !hint && (
          <>
            <button className="btn ghost" onClick={async () => hintResult(await onHint('card'))}>Hint: draw 1 card</button>
            {game.adHintAvailable && <button className="btn ghost" onClick={() => { track('ad_offered', { placement: 'hint' }); setShowAd(true); }}>Hint: watch ad</button>}
          </>
        )}
      </div>
      {showAd && <FakeAd onCancel={() => setShowAd(false)} onDone={async () => { setShowAd(false); hintResult(await onHint('ad', 'simulated')); }} />}
    </div>
  );
}

const TUTORIAL_STEPS = [
  'The card in the middle is the anchor. Every card you play links to it. Tap Madrid White twice, then name a player who played for both clubs (try Ronaldo or Beckham).',
  'The active colour is now Spain’s yellow. Safe Play: a club of the active colour can be played with no answer. Tap Barcelona Blue-Red twice and choose “Safe Play”.',
  'Action cards need no answer, just the right colour. Play your yellow Red Card: the next player is skipped.',
  'Trophy cards have no colour. Play Golden Ball: name a Barcelona Blue-Red player who won the Golden Ball.',
  'Transfer Window is a wild card: play it and pick any colour.',
  'Down to 2 cards! Tap “Final Whistle!” before you play your next card, or you draw 2.',
  'Finish it: play Milan Red-Black (a Golden Ball winner who played for Milan), then Milan Blue-Black.',
];

function TutorialTip({ game, onSkip }: { game: GameStateView; onSkip: () => void }) {
  const mine = game.log.filter((r) => r.seat === game.you && r.valid);
  const done = [
    mine.some((r) => r.playType === 'link' && r.card.kind === 'club'),
    mine.some((r) => r.playType === 'safe') || mine.filter((r) => r.playType === 'link').length >= 2,
    mine.some((r) => r.playType === 'match'),
    mine.some((r) => r.card.kind === 'trophy'),
    mine.some((r) => r.playType === 'wild'),
    game.you !== null && (game.seats[game.you].whistle || game.hand.length <= 1),
  ];
  const step = Math.min(done.findIndex((d) => !d) === -1 ? 6 : done.findIndex((d) => !d), 6);
  const last = useRef(-1);
  useEffect(() => {
    if (last.current !== step) track('tutorial_step', { step });
    last.current = step;
  }, [step]);
  if (game.phase === 'over') return null;
  return (
    <div className="tutorial-tip">
      <div className="tut-step">Step {step + 1} of 7</div>
      <p>{TUTORIAL_STEPS[step]}</p>
      <button className="link-btn" onClick={onSkip}>Skip tutorial</button>
    </div>
  );
}
