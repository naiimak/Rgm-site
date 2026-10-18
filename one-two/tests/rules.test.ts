import { describe, expect, it } from 'vitest';
import { Game, PlayerDB, buildDeck, search, buildIndex, normalize, type Card, type PlayerRecord, type RoomSettings, DEFAULT_SETTINGS } from '../engine/index.ts';
import { loadConfig, loadDatabase } from '../engine/load.ts';

const config = loadConfig();

// A tiny hand-made database so every rule can be checked exactly.
const P = (id: string, name: string, spells: string, extra: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name, aliases: [], nationality: 'POR', birthYear: 1985, fame: 50, titles: [], trophies: [], caps: [],
  spells: spells.split(',').map((s) => {
    const [club, years] = s.trim().split(' ');
    const [from, to] = years.split('-');
    return { club, from: Number(from), to: to ? Number(to) : null };
  }),
  ...extra,
});
const fixture: PlayerRecord[] = [
  P('ronaldo', 'Cristiano Ronaldo', 'MUN 2003-2009, RMA 2009-2018, JUV 2018-2021', { titles: ['ENG', 'ESP', 'ITA'], trophies: ['GB', 'CL'], caps: ['POR'], fame: 99 }),
  P('figo', 'Luís Figo', 'BAR 1995-2000, RMA 2000-2005, INT 2005-2009', { titles: ['ESP', 'ITA'], trophies: ['GB'], caps: ['POR'], fame: 70 }),
  P('messi', 'Lionel Messi', 'BAR 2004-2021, PSG 2021-2023', { titles: ['ESP', 'FRA'], trophies: ['GB', 'CL', 'WC'], caps: ['ARG'], fame: 99, nationality: 'ARG' }),
  P('kaka', 'Kaká', 'MIL 2003-2009, RMA 2009-2013', { titles: ['ITA', 'ESP'], trophies: ['GB', 'CL', 'WC'], caps: ['BRA'], nationality: 'BRA', aliases: ['Kaka'] }),
  P('beckham', 'David Beckham', 'MUN 1992-2003, RMA 2003-2007', { titles: ['ENG', 'ESP'], caps: ['ENG'], nationality: 'ENG' }),
  P('ibra', 'Zlatan Ibrahimović', 'INT 2006-2009, BAR 2009-2010', { titles: ['ITA', 'ESP'], caps: ['SWE'], nationality: 'SWE' }),
  P('costa', 'Diego Costa', 'ATM 2010-2014, CHE 2014-2017', { titles: ['ESP', 'ENG'], caps: ['BRA', 'ESP'], nationality: 'BRA' }),
  P('neymar', 'Neymar', 'BAR 2013-2017, PSG 2017-2023', { titles: ['ESP', 'FRA'], caps: ['BRA'], nationality: 'BRA' }),
  P('ronaldinho', 'Ronaldinho', 'PSG 2001-2003, BAR 2003-2008', { titles: ['ESP'], caps: ['BRA'], nationality: 'BRA' }),
  P('drogba', 'Didier Drogba', 'OMR 2003-2004, CHE 2004-2012', { titles: ['ENG'], caps: ['CIV'], nationality: 'CIV' }),
  P('buffon', 'Gianluigi Buffon', 'PAR 1995-2001, JUV 2001-2018, PAR 2021-2023', { titles: ['ITA'], caps: ['ITA'], nationality: 'ITA' }),
  P('kroos', 'Toni Kroos', 'BAY 2007-2014, RMA 2014-2024', { titles: ['GER', 'ESP'], caps: ['GER'], nationality: 'GER' }),
];
const db = new PlayerDB(config, fixture, 'test');

const card = (kind: Card['kind'], ref: string, id = `${kind}-${ref}`): Card => {
  const league = kind === 'club' ? config.clubs.find((c) => c.id === ref)!.league : ref;
  const colour = ['club', 'league', 'champion'].includes(kind) ? config.leagues.find((l) => l.id === league)!.colour : null;
  return { id, kind, ref, colour };
};
const action = (ref: string, colour: Card['colour'], id = `a-${ref}-${colour}`): Card => ({ id, kind: 'action', ref, colour });

/** Builds a started game with exact hands and a fixed anchor. */
function setup(hands: Card[][], anchor: Card, opts: Partial<RoomSettings> = {}, deck: Card[] = []): Game {
  const filler = buildDeck(config).filter((c) => c.kind === 'trophy').map((c, i) => ({ ...c, id: `fill${i}` }));
  const g = new Game({
    id: 't', config, db, settings: { ...DEFAULT_SETTINGS, ...opts }, rng: seeded(1), firstSeat: 0,
    seats: hands.map((_, i) => ({ name: `P${i}`, isBot: false })),
  });
  g.start = () => [];
  hands.forEach((h, i) => { g.seats[i].hand = [...h]; });
  g.anchor = anchor;
  g.pile = [anchor];
  g.activeColour = anchor.colour!;
  g.deck = [...filler, ...deck.slice().reverse()];
  g.turn = 0;
  g.turnNumber = 1;
  return g;
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

describe('what you must answer (link table)', () => {
  const rows: [string, Card, Card, string, boolean][] = [
    ['Club X + Club Y: played for X and Y', card('club', 'MUN'), card('club', 'RMA'), 'ronaldo', true],
    ['Club X + Club Y rejects one-club players', card('club', 'MUN'), card('club', 'RMA'), 'messi', false],
    ['Club X + League L: played for X and in L', card('club', 'BAR'), card('league', 'ITA'), 'ibra', true],
    ['Club X + League L rejects', card('club', 'BAR'), card('league', 'ITA'), 'neymar', false],
    ['Club X + League Champion L: played for X, won L anywhere', card('club', 'BAR'), card('champion', 'ITA'), 'figo', true],
    ['Club X + Trophy T', card('club', 'BAR'), card('trophy', 'GB'), 'messi', true],
    ['League L + Club Y', card('league', 'ITA'), card('club', 'RMA'), 'kaka', true],
    ['League L + League M', card('league', 'ENG'), card('league', 'ITA'), 'ronaldo', true],
    ['League L + Trophy T', card('league', 'ITA'), card('trophy', 'GB'), 'kaka', true],
    ['Trophy T + Club Y', card('trophy', 'GB'), card('club', 'MIL'), 'kaka', true],
    ['Trophy T + League L', card('trophy', 'WC'), card('league', 'FRA'), 'messi', true],
    ['Trophy T + Trophy U', card('trophy', 'CL'), card('trophy', 'WC'), 'kaka', true],
    ['Trophy T + Trophy U rejects', card('trophy', 'CL'), card('trophy', 'WC'), 'ronaldo', false],
    ['League Champion L + any', card('champion', 'ENG'), card('club', 'CHE'), 'drogba', true],
    ['Club X + National N', card('club', 'BAR'), card('national', 'BRA'), 'neymar', true],
    ['National N + Club Y (Ivory Coast + Chelsea)', card('national', 'CIV'), card('club', 'CHE'), 'drogba', true],
    ['National N + National M (Diego Costa)', card('national', 'BRA'), card('national', 'ESP'), 'costa', true],
    ['Coach C + Club Y: Ferguson + Madrid White (Ronaldo)', card('coach', 'FER'), card('club', 'RMA'), 'ronaldo', true],
    ['Club X + Coach C: Manchester Red + Ferguson (Beckham)', card('club', 'MUN'), card('coach', 'FER'), 'beckham', true],
    ['Coach C + Coach D: Mourinho + Guardiola (Ibrahimović)', card('coach', 'MOU'), card('coach', 'GUA'), 'ibra', true],
    ['Coach rejects a player at the club before the coach', card('club', 'BAR'), card('coach', 'GUA'), 'figo', false],
    ['League card same as anchor club league: any player of that club', card('club', 'JUV'), card('league', 'ITA'), 'buffon', true],
  ];
  for (const [name, anchor, played, player, valid] of rows) {
    it(name, () => {
      const g = setup([[played, card('club', 'LIV', 'spare1')], [card('club', 'ARS', 'x')]], anchor);
      const r = g.play(0, played.id, { playerId: player });
      expect(r.ok).toBe(true);
      const result = r.events.find((e) => e.type === 'play_result');
      expect(result && result.type === 'play_result' && result.result.valid).toBe(valid);
    });
  }

  it('top-flight seasons: Buffon at Parma 2021-23 (second tier) still counts for Parma 1995-2001', () => {
    expect(db.isValid('club:PAR', 'league:ITA', 'buffon')).toBe(true);
  });
});

describe('answers and penalties', () => {
  it('valid answer lands the card, names both connections and becomes the anchor', () => {
    const played = card('club', 'RMA');
    const g = setup([[played, card('club', 'LIV', 's')], [card('club', 'ARS')]], card('club', 'MUN'));
    const r = g.play(0, played.id, { playerId: 'ronaldo' });
    const res = r.events.find((e) => e.type === 'play_result');
    expect(res?.type === 'play_result' && res.result.connections).toEqual(['Manchester Red 2003–09', 'Madrid White 2009–18']);
    expect(g.anchor.id).toBe(played.id);
    expect(g.activeColour).toBe('yellow');
    expect(g.turn).toBe(1);
  });

  it('wrong answer: card returns, draw 2, turn ends, reason shown', () => {
    const played = card('club', 'RMA');
    const g = setup([[played, card('club', 'LIV', 's')], [card('club', 'ARS')]], card('club', 'MUN'));
    const r = g.play(0, played.id, { playerId: 'messi' });
    const res = r.events.find((e) => e.type === 'play_result');
    expect(res?.type === 'play_result' && res.result.reason).toBe('Never played for Madrid White');
    expect(g.seats[0].hand).toHaveLength(4);
    expect(g.seats[0].hand.some((c) => c.id === played.id)).toBe(true);
    expect(g.turn).toBe(1);
  });

  it('already named this game: rejected with no penalty, still your turn', () => {
    const g = setup([[card('club', 'RMA'), card('club', 'JUV'), card('club', 'LIV', 's')], [card('club', 'ARS')]], card('club', 'MUN'));
    g.used.add('ronaldo');
    const r = g.play(0, 'club-RMA', { playerId: 'ronaldo' });
    expect(r).toMatchObject({ ok: false, error: 'already_used' });
    expect(g.seats[0].hand).toHaveLength(3);
    expect(g.turn).toBe(0);
  });

  it('timer runs out: draw 2, turn ends', () => {
    const g = setup([[card('club', 'RMA')], [card('club', 'ARS')]], card('club', 'MUN'));
    g.timeout();
    expect(g.seats[0].hand).toHaveLength(3);
    expect(g.turn).toBe(1);
  });

  it('safe play: same-colour club with no answer, only when Safe Play is on', () => {
    const anchor = card('club', 'MUN');
    const g = setup([[card('club', 'ARS'), card('club', 'LIV', 's')], [card('club', 'CHE')]], anchor);
    expect(g.play(0, 'club-ARS').ok).toBe(true);
    const off = setup([[card('club', 'ARS'), card('club', 'LIV', 's')], [card('club', 'CHE')]], anchor, { safePlay: false });
    expect(off.play(0, 'club-ARS')).toMatchObject({ ok: false, error: 'answer_required' });
  });

  it('colourless cards (trophy, coach, national) keep the active colour', () => {
    const g = setup([[card('trophy', 'GB'), card('club', 'LIV', 's')], [card('club', 'CHE')]], card('club', 'BAR'));
    g.play(0, 'trophy-GB', { playerId: 'messi' });
    expect(g.anchor.kind).toBe('trophy');
    expect(g.activeColour).toBe('yellow');
  });
});

describe('action cards', () => {
  const anchor = card('club', 'MUN'); // red
  it('Yellow Card (+2): next player draws 2 and loses their turn', () => {
    const g = setup([[action('yellow', 'red'), card('club', 'LIV', 's')], [card('club', 'ARS')], [card('club', 'CHE')]], anchor);
    g.play(0, 'a-yellow-red');
    expect(g.seats[1].hand).toHaveLength(3);
    expect(g.turn).toBe(2);
    expect(g.anchor.id).toBe(anchor.id); // actions never become the anchor
  });
  it('Red Card: next player is skipped', () => {
    const g = setup([[action('red', 'red'), card('club', 'LIV', 's')], [card('club', 'ARS')], [card('club', 'CHE')]], anchor);
    g.play(0, 'a-red-red');
    expect(g.turn).toBe(2);
  });
  it('VAR reverses direction; with 2 players it acts as a skip', () => {
    const g = setup([[action('var', 'red'), card('club', 'LIV', 's')], [card('club', 'ARS')], [card('club', 'CHE')]], anchor);
    g.play(0, 'a-var-red');
    expect(g.direction).toBe(-1);
    expect(g.turn).toBe(2);
    const two = setup([[action('var', 'red'), card('club', 'LIV', 's')], [card('club', 'ARS')]], anchor);
    two.play(0, 'a-var-red');
    expect(two.turn).toBe(0);
  });
  it('Transfer Window: wild, choose colour, no answer', () => {
    const g = setup([[action('transfer', null), card('club', 'LIV', 's')], [card('club', 'ARS')]], anchor);
    expect(g.play(0, 'a-transfer-null')).toMatchObject({ ok: false, error: 'colour_required' });
    g.play(0, 'a-transfer-null', { colour: 'green' });
    expect(g.activeColour).toBe('green');
    expect(g.turn).toBe(1);
  });
  it('Hat-trick: choose colour, next draws 4 and loses their turn', () => {
    const g = setup([[action('hattrick', null), card('club', 'LIV', 's')], [card('club', 'ARS')], [card('club', 'CHE')]], anchor);
    g.play(0, 'a-hattrick-null', { colour: 'blue' });
    expect(g.seats[1].hand).toHaveLength(5);
    expect(g.turn).toBe(2);
    expect(g.activeColour).toBe('blue');
  });
  it('match play needs the active colour or the same symbol as the top card', () => {
    const g = setup([[action('red', 'blue'), card('club', 'LIV', 's')], [card('club', 'ARS')]], anchor);
    expect(g.play(0, 'a-red-blue')).toMatchObject({ ok: false, error: 'no_match' });
    g.pile.push(action('red', 'red', 'top'));
    expect(g.play(0, 'a-red-blue').ok).toBe(true);
  });
  it('stacking (private rooms): +2 on +2 passes the penalty on', () => {
    const g = setup([[action('yellow', 'red', 'y1'), card('club', 'LIV', 's')], [action('yellow', 'blue', 'y2'), card('club', 'ARS')], [card('club', 'CHE')]], anchor, { stacking: true });
    g.play(0, 'y1');
    expect(g.pendingDraw).toEqual({ amount: 2, action: 'yellow' });
    expect(g.play(1, 'club-ARS', { playerId: 'x' })).toMatchObject({ ok: false, error: 'must_stack_or_draw' });
    g.play(1, 'y2');
    expect(g.pendingDraw).toEqual({ amount: 4, action: 'yellow' });
    g.draw(2);
    expect(g.seats[2].hand).toHaveLength(5);
    expect(g.turn).toBe(0);
  });
});

describe('draw, hints, Final Whistle, end of game', () => {
  it('draw: a playable drawn card may be played now, otherwise the turn ends', () => {
    const playable = card('club', 'RMA', 'drawn');
    const g = setup([[card('national', 'JPN')], [card('club', 'ARS')]], card('club', 'MUN'), {}, [playable]);
    g.draw(0);
    expect(g.drawnCardId).toBe('drawn');
    expect(g.play(0, 'national-JPN', { playerId: 'ronaldo' })).toMatchObject({ ok: false, error: 'must_play_drawn' });
    expect(g.play(0, 'drawn', { playerId: 'ronaldo' }).ok).toBe(true);
    const g2 = setup([[card('national', 'JPN')], [card('club', 'ARS')]], card('club', 'MUN'), {}, [card('national', 'AUS', 'dead')]);
    g2.draw(0);
    expect(g2.turn).toBe(1);
  });

  it('hint: once per turn, costs a card or the one ad hint per game', () => {
    const g = setup([[card('club', 'RMA'), card('club', 'LIV', 's')], [card('club', 'ARS')]], card('club', 'MUN'));
    const r = g.hint(0, 'club-RMA', 'card');
    expect(r.ok && r.hint?.playerId).toMatch(/ronaldo|beckham/);
    expect(g.seats[0].hand).toHaveLength(3);
    expect(g.hint(0, 'club-RMA', 'ad')).toMatchObject({ ok: false, error: 'hint_used' });
  });

  it('Final Whistle: playing down to 1 card without calling it draws 2 at the end of the turn', () => {
    const g = setup([[card('club', 'RMA'), card('club', 'LIV', 's')], [card('club', 'ARS'), card('club', 'CHE')]], card('club', 'MUN'));
    g.play(0, 'club-RMA', { playerId: 'ronaldo' });
    expect(g.seats[0].hand).toHaveLength(3);
    const g2 = setup([[card('club', 'RMA'), card('club', 'LIV', 's')], [card('club', 'ARS'), card('club', 'CHE')]], card('club', 'MUN'));
    expect(g2.callWhistle(0).ok).toBe(true);
    g2.play(0, 'club-RMA', { playerId: 'ronaldo' });
    expect(g2.seats[0].hand).toHaveLength(1);
  });

  it('first to play their last card wins at once; others ranked by points left', () => {
    const g = setup(
      [[action('red', 'red')], [action('transfer', null, 'w'), card('club', 'ARS')], [card('club', 'CHE'), card('club', 'NEW')]],
      card('club', 'MUN'),
    );
    g.seats[0].whistle = true;
    const r = g.play(0, 'a-red-red');
    expect(g.phase).toBe('over');
    const over = r.events.find((e) => e.type === 'game_over');
    expect(over?.type === 'game_over' && over.placings.map((p) => [p.seat, p.points])).toEqual([[0, 0], [2, 10], [1, 55]]);
  });

  it('deck runs out: discard pile except anchor and top card is reshuffled', () => {
    const g = setup([[card('club', 'RMA')], [card('club', 'ARS')]], card('club', 'MUN'));
    g.deck = [];
    g.pile = [card('club', 'LIV', 'old1'), card('club', 'CHE', 'old2'), g.anchor];
    g.draw(0);
    expect(g.pile.map((c) => c.id)).toEqual([g.anchor.id]);
    expect(g.countCards()).toBe(5);
  });

  it('views never contain other players\' hands', () => {
    const g = setup([[card('club', 'RMA')], [card('club', 'ARS')]], card('club', 'MUN'));
    const v = g.view(1);
    expect(v.hand.map((c) => c.id)).toEqual(['club-ARS']);
    expect(JSON.stringify(v)).not.toContain('club-RMA');
  });
});

describe('deck and setup', () => {
  it('has 151 cards: 110 subject + 41 action', () => {
    const deck = buildDeck(config);
    expect(deck).toHaveLength(151);
    expect(deck.filter((c) => c.kind === 'action')).toHaveLength(41);
  });
  it('deals 7 each and starts on a Club card', () => {
    const { db: real } = loadDatabase();
    const g = new Game({ id: 'g', config, db: real, settings: DEFAULT_SETTINGS, rng: seeded(7), seats: [{ name: 'a', isBot: false }, { name: 'b', isBot: true }] });
    g.start();
    expect(g.seats.every((s) => s.hand.length === 7)).toBe(true);
    expect(g.anchor.kind).toBe('club');
    expect(g.activeColour).toBe(g.anchor.colour);
    expect(g.countCards()).toBe(151);
  });
});

describe('autocomplete', () => {
  const index = buildIndex(db.playerList());
  it('ignores accents and case and matches nicknames', () => {
    expect(search(index, 'kaka')[0].id).toBe('kaka');
    expect(search(index, 'IBRAHIMOVIC')[0].id).toBe('ibra');
    expect(normalize('Mesut Özil')).toBe('mesut ozil');
  });
  it('needs 2 characters and lists the most famous first', () => {
    expect(search(index, 'r')).toEqual([]);
    expect(search(index, 'ro')[0].id).toBe('ronaldo');
  });
});
