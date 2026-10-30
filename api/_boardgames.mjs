// LUDO, BHABHI AND VYAPAR - the rules, and nothing else.
//
// Imports nothing, so the deploy gate tests every rule on a fresh clone,
// before npm install (site/tests/boardgametest.mjs). Each game is a pure
// state machine: start, then apply one move at a time. Dice and shuffles
// come from an injected random source, so a test can fix them and the
// server can use Math.random. A move that breaks a rule returns { error }
// and changes nothing.
//
// Every state carries `v`, a version the server bumps on each saved move:
// two phones moving at once cannot both land (see api/games.mjs).

const rnd = (R) => (R || Math.random);
const die = (R) => 1 + Math.floor(rnd(R)() * 6);
function shuffle(arr, R) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(R)() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const seat = (p) => (p.bot ? { id: p.id, name: p.name, bot: true } : { id: p.id, name: p.name });
const bot = (st, i) => !!(st.players[i] && (st.players[i].bot || st.players[i].away));

// Opponents for playing alone: players like any other, marked `bot`.
export function botSeats(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: i ? 'bot' + (i + 1) : 'bot', name: i ? 'Computer ' + (i + 1) : 'Computer', bot: true });
  return out;
}

// =====================================================================
// LUDO
// A token's progress is counted from its own start square:
//   -1 in base; 0..50 on the shared track; 51..55 its home column; 56 home.
// The shared track has 52 squares. Seat c starts on square 13*c.
// =====================================================================
export const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
export const LUDO_HOME = 56;
export const LUDO_COLORS = ['Red', 'Green', 'Yellow', 'Blue'];

export function ludoSquare(color, p) { return p >= 0 && p <= 50 ? (13 * color + p) % 52 : null; }

export function ludoStart(people) {
  if (people.length < 2 || people.length > 4) return { error: 'Ludo is for 2 to 4 players' };
  // Two players sit opposite each other, as at a real board.
  const colors = people.length === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, people.length);
  return {
    kind: 'ludo', v: 0,
    players: people.map((p, i) => ({ ...seat(p), color: colors[i], tokens: [-1, -1, -1, -1] })),
    turn: 0, roll: null, sixes: 0, moves: null, last: null, winner: null
  };
}

// Which tokens can move with this roll.
export function ludoMoves(pl, roll) {
  const out = [];
  pl.tokens.forEach((p, i) => {
    if (p === LUDO_HOME) return;
    if (p === -1) { if (roll === 6) out.push(i); return; }
    if (p + roll <= LUDO_HOME) out.push(i);
  });
  return out;
}

function ludoNext(st) { st.turn = (st.turn + 1) % st.players.length; st.sixes = 0; }

export function ludoRoll(st, memberId, R) {
  if (st.winner) return { error: 'The game is over' };
  const me = st.players[st.turn];
  if (!me || me.id !== memberId) return { error: 'Not your turn yet' };
  if (st.moves) return { error: 'Move a token first' };
  const roll = die(R);
  st.roll = roll;
  st.sixes = roll === 6 ? st.sixes + 1 : 0;
  if (st.sixes === 3) {
    st.last = { by: me.name, roll, text: 'three sixes in a row - the turn passes' };
    st.roll = null; ludoNext(st);
    return { roll };
  }
  const moves = ludoMoves(me, roll);
  if (!moves.length) {
    st.last = { by: me.name, roll, text: 'no move possible' };
    st.roll = null;
    if (roll !== 6) ludoNext(st);
    return { roll };
  }
  // One choice is no choice: make it, rather than ask for a tap.
  if (moves.length === 1) return { roll, ...ludoApply(st, moves[0]) };
  st.moves = moves;
  return { roll };
}

export function ludoMove(st, memberId, token) {
  if (st.winner) return { error: 'The game is over' };
  const me = st.players[st.turn];
  if (!me || me.id !== memberId) return { error: 'Not your turn yet' };
  if (!st.moves) return { error: 'Roll the dice first' };
  const t = Number(token);
  if (!st.moves.includes(t)) return { error: 'That token cannot move ' + st.roll };
  return ludoApply(st, t);
}

function ludoApply(st, t) {
  const me = st.players[st.turn];
  const roll = st.roll;
  const from = me.tokens[t];
  const to = from === -1 ? 0 : from + roll;
  me.tokens[t] = to;
  let text = from === -1 ? 'brought a token out' : to === LUDO_HOME ? 'got a token home' : 'moved ' + roll;
  let captured = [];
  const sq = ludoSquare(me.color, to);
  if (sq !== null && !LUDO_SAFE.includes(sq)) {
    st.players.forEach((o, oi) => {
      if (oi === st.turn) return;
      o.tokens.forEach((p, pi) => {
        if (ludoSquare(o.color, p) === sq) { o.tokens[pi] = -1; captured.push(o.name); }
      });
    });
  }
  if (captured.length) text += ' and sent ' + captured.join(' and ') + ' back to base';
  st.last = { by: me.name, roll, text, captured: captured.length ? captured : undefined };
  st.moves = null; st.roll = null;
  let announce = null;
  if (me.tokens.every(p => p === LUDO_HOME)) {
    st.winner = me.name;
    announce = '🎯 ' + me.name + ' won Ludo! All four home.';
    return { announce };
  }
  // A six, a capture or a token home earns another roll.
  if (!(roll === 6 || captured.length || to === LUDO_HOME)) ludoNext(st);
  return { announce, captured };
}

// The opponent: capture if it can, then get a token home, then bring one
// out, then land somewhere safe, then push the furthest token along.
export function ludoBotToken(st) {
  const me = st.players[st.turn], roll = st.roll;
  const score = (t) => {
    const from = me.tokens[t], to = from === -1 ? 0 : from + roll;
    const sq = ludoSquare(me.color, to);
    let s = to;
    if (sq !== null && !LUDO_SAFE.includes(sq) &&
        st.players.some((o, oi) => oi !== st.turn && o.tokens.some(p => ludoSquare(o.color, p) === sq))) s += 1000;
    if (to === LUDO_HOME) s += 500;
    if (from === -1) s += 300;
    if (sq !== null && LUDO_SAFE.includes(sq)) s += 100;
    return s;
  };
  return st.moves.slice().sort((a, b) => score(b) - score(a))[0];
}

// =====================================================================
// BHABHI (also called Get Away) - the Indian family card game.
// The whole deck is dealt. The Ace of Spades leads the first round.
// Everyone follows suit if they can. If someone cannot, they drop any card
// (a "thulla") and the round stops: whoever played the highest card of the
// suit led picks up every card played in it, and leads next. If everyone
// follows suit, the cards are set aside and the highest card leads next.
// A hand emptied is a player escaped. The last one holding cards is the
// one who loses.
// Cards are strings: suit letter then rank, 2..14 (J 11, Q 12, K 13, A 14).
// =====================================================================
export const SUITS = ['S', 'H', 'D', 'C'];
export const deck = () => SUITS.flatMap(s => Array.from({ length: 13 }, (_, i) => s + (i + 2)));
export const suitOf = (c) => c[0];
export const rankOf = (c) => Number(c.slice(1));
const sortHand = (h) => h.slice().sort((a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(a) - rankOf(b));

export function bhabhiStart(people, R) {
  if (people.length < 3 || people.length > 6) return { error: 'Get Away is for 3 to 6 players' };
  const cards = shuffle(deck(), R);
  const hands = people.map(() => []);
  cards.forEach((c, i) => hands[i % people.length].push(c));
  const first = hands.findIndex(h => h.includes('S14'));
  return {
    kind: 'bhabhi', v: 0,
    players: people.map(seat),
    hands: hands.map(sortHand),
    out: people.map(() => false),        // escaped: hand empty after a round
    turn: first, trick: [], leadSuit: null, first: true,
    last: null, winner: null, loser: null, order: []
  };
}

const inRound = (st, i) => !st.out[i];
function nextToPlay(st, from) {
  const n = st.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (inRound(st, i) && !st.trick.some(t => t.p === i)) return i;
  }
  return -1;
}

// Which cards this hand may play now.
export function bhabhiPlayable(st, i) {
  const hand = st.hands[i] || [];
  if (st.first && !st.trick.length) return hand.includes('S14') ? ['S14'] : hand;
  if (!st.leadSuit) return hand;
  const follow = hand.filter(c => suitOf(c) === st.leadSuit);
  return follow.length ? follow : hand;
}

export function bhabhiPlay(st, memberId, card) {
  if (st.loser) return { error: 'The game is over' };
  const i = st.turn;
  if (!st.players[i] || st.players[i].id !== memberId) return { error: 'Not your turn yet' };
  const c = String(card || '');
  if (!st.hands[i].includes(c)) return { error: 'That card is not in your hand' };
  if (!bhabhiPlayable(st, i).includes(c)) {
    return { error: st.first && !st.trick.length ? 'The Ace of Spades starts the game' : 'Follow suit - you have a ' + ({ S: 'spade', H: 'heart', D: 'diamond', C: 'club' })[st.leadSuit] };
  }
  st.hands[i] = st.hands[i].filter(x => x !== c);
  if (!st.trick.length) st.leadSuit = suitOf(c);
  st.trick.push({ p: i, card: c });
  const me = st.players[i].name;
  // Somebody could not follow: the round stops here.
  if (suitOf(c) !== st.leadSuit) {
    const high = highest(st);
    const taker = high.p;
    const pile = st.trick.map(t => t.card);
    st.hands[taker] = sortHand(st.hands[taker].concat(pile));
    st.last = { by: me, text: me + ' could not follow and dropped a card. ' + st.players[taker].name + ' picks up ' + pile.length + ' cards.', thulla: true, taker: st.players[taker].name };
    return endRound(st, taker);
  }
  const nxt = nextToPlay(st, i);
  if (nxt === -1) {
    // Everyone followed: the cards are set aside.
    const high = highest(st);
    st.last = { by: me, text: 'Everyone followed ' + suitName(st.leadSuit) + '. ' + st.players[high.p].name + ' played highest and leads next.' };
    return endRound(st, high.p);
  }
  st.turn = nxt;
  return {};
}
const suitName = (s) => ({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' })[s];
function highest(st) {
  return st.trick.filter(t => suitOf(t.card) === st.leadSuit)
    .sort((a, b) => rankOf(b.card) - rankOf(a.card))[0];
}
function endRound(st, leader) {
  st.lastTrick = st.trick.slice();
  st.trick = []; st.leadSuit = null; st.first = false;
  const escaped = [];
  st.players.forEach((p, i) => {
    if (!st.out[i] && !st.hands[i].length) { st.out[i] = true; st.order.push(p.name); escaped.push(p.name); }
  });
  const left = st.players.map((p, i) => i).filter(i => !st.out[i]);
  let announce = null;
  if (left.length <= 1) {
    st.loser = left.length ? st.players[left[0]].name : null;
    st.winner = st.order[0] || null;
    announce = '🃏 Get Away is over! ' + (st.order[0] ? st.order[0] + ' got away first' : '') + (st.loser ? (st.order[0] ? '; ' : '') + st.loser + ' holds the last cards.' : '.');
    return { announce, escaped };
  }
  // The one who leads next may have just escaped: the lead passes on.
  let lead = leader;
  while (st.out[lead]) lead = (lead + 1) % st.players.length;
  st.turn = lead;
  return { announce, escaped };
}

// The opponent: lead low from its longest suit; follow low; with nothing to
// follow, drop its highest card on someone else.
export function bhabhiBotCard(st) {
  const i = st.turn, ok = bhabhiPlayable(st, i);
  if (ok.length === 1) return ok[0];
  const following = st.leadSuit && ok.every(c => suitOf(c) === st.leadSuit);
  if (!st.leadSuit) {
    const bySuit = {};
    ok.forEach(c => { (bySuit[suitOf(c)] = bySuit[suitOf(c)] || []).push(c); });
    const longest = Object.values(bySuit).sort((a, b) => b.length - a.length)[0];
    return longest.sort((a, b) => rankOf(a) - rankOf(b))[0];
  }
  if (following) return ok.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
  return ok.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
}

// Each player sees their own hand, and only how many cards everyone else has.
export function bhabhiView(st, memberId) {
  const me = st.players.findIndex(p => p.id === memberId);
  const v = JSON.parse(JSON.stringify(st));
  v.counts = st.hands.map(h => h.length);
  v.hands = st.hands.map((h, i) => (i === me ? h : []));
  v.me = me;
  v.playable = me >= 0 && st.turn === me && !st.loser ? bhabhiPlayable(st, me) : [];
  return v;
}

// =====================================================================
// VYAPAR - the business board game, with Indian cities. Play money only.
// =====================================================================
export const VY_START_MONEY = 1500;
export const VY_PASS_START = 200;
export const VY_BOARD = [
  { t: 'start', name: 'Start' },
  { t: 'city', name: 'Jaipur', g: 'brown', price: 60, rent: 6 },
  { t: 'card', name: 'Family card' },
  { t: 'city', name: 'Udaipur', g: 'brown', price: 60, rent: 8 },
  { t: 'tax', name: 'Income tax', amount: 100 },
  { t: 'rail', name: 'Rajdhani Express', price: 200 },
  { t: 'city', name: 'Lucknow', g: 'sky', price: 100, rent: 10 },
  { t: 'city', name: 'Varanasi', g: 'sky', price: 100, rent: 10 },
  { t: 'city', name: 'Amritsar', g: 'sky', price: 120, rent: 12 },
  { t: 'rest', name: 'Chai break' },
  { t: 'city', name: 'Pune', g: 'pink', price: 140, rent: 14 },
  { t: 'city', name: 'Hyderabad', g: 'pink', price: 140, rent: 14 },
  { t: 'card', name: 'Family card' },
  { t: 'city', name: 'Chennai', g: 'pink', price: 160, rent: 16 },
  { t: 'rail', name: 'Shatabdi Express', price: 200 },
  { t: 'city', name: 'Kolkata', g: 'orange', price: 180, rent: 18 },
  { t: 'city', name: 'Bengaluru', g: 'orange', price: 200, rent: 20 },
  { t: 'rest', name: 'Rest house' },
  { t: 'city', name: 'Ahmedabad', g: 'red', price: 220, rent: 22 },
  { t: 'card', name: 'Family card' },
  { t: 'city', name: 'Delhi', g: 'red', price: 240, rent: 24 },
  { t: 'jam', name: 'Traffic jam' },
  { t: 'city', name: 'Mumbai', g: 'blue', price: 350, rent: 35 },
  { t: 'city', name: 'Goa', g: 'blue', price: 400, rent: 50 }
];
// Rent: the base; double for the whole colour; then more for each house.
export const VY_RENT_MULT = [1, 2, 5, 15, 30];
export const VY_MAX_HOUSES = 3;
export const VY_CARDS = [
  { text: "Dadi's blessings - collect 50", money: 50 },
  { text: 'Diwali bonus - collect 100', money: 100 },
  { text: 'You forgot a birthday - pay 30 for the gift', money: -30 },
  { text: 'Fix the leaking roof - pay 50', money: -50 },
  { text: 'Won the colony cricket match - collect 40', money: 40 },
  { text: 'Wedding season shagun - every player gives you 20', each: 20 },
  { text: 'Family trip to Goa - go to Goa', to: 23 },
  { text: 'Back to Start - collect 200', to: 0 },
  { text: 'Treat everyone to chaat - pay each player 15', each: -15 },
  { text: 'School fee refund - collect 60', money: 60 }
];

export function vyStart(people, R, opts = {}) {
  if (people.length < 2 || people.length > 6) return { error: 'Vyapar is for 2 to 6 players' };
  return {
    kind: 'vyapar', v: 0,
    players: people.map(p => ({ ...seat(p), money: VY_START_MONEY, pos: 0, out: false, skip: false })),
    owners: {}, houses: {}, turn: 0, phase: 'roll', pending: null, doubles: 0,
    turns: 0, maxTurns: opts.maxTurns || 30 * people.length,
    last: null, deck: shuffle(VY_CARDS.map((_, i) => i), R), winner: null
  };
}

export function vyGroup(g) { return VY_BOARD.map((s, i) => i).filter(i => VY_BOARD[i].g === g); }
export function vyHasSet(st, pi, g) { return vyGroup(g).every(i => st.owners[i] === pi); }
export function vyRent(st, sq) {
  const s = VY_BOARD[sq], owner = st.owners[sq];
  if (owner === undefined) return 0;
  if (s.t === 'rail') {
    const n = VY_BOARD.filter((b, i) => b.t === 'rail' && st.owners[i] === owner).length;
    return 25 * Math.pow(2, n - 1);
  }
  const h = st.houses[sq] || 0;
  const mult = h ? VY_RENT_MULT[h + 1] : vyHasSet(st, owner, s.g) ? VY_RENT_MULT[1] : VY_RENT_MULT[0];
  return s.rent * mult;
}
export function vyWorth(st, pi) {
  const p = st.players[pi];
  let w = p.money;
  Object.keys(st.owners).forEach(k => {
    if (st.owners[k] === pi) w += VY_BOARD[k].price + (st.houses[k] || 0) * Math.floor(VY_BOARD[k].price / 2);
  });
  return w;
}
const alive = (st) => st.players.map((p, i) => i).filter(i => !st.players[i].out);

function vyPay(st, from, to, amount, lines) {
  const p = st.players[from];
  // A player who cannot pay in full hands over everything they have.
  const paid = Math.min(amount, Math.max(0, p.money));
  p.money -= amount;
  if (to !== null) st.players[to].money += paid;
  if (p.money < 0) {
    // Bankrupt: out of the game, and what they owned goes back to the bank.
    p.out = true; p.money = 0;
    Object.keys(st.owners).forEach(k => { if (st.owners[k] === from) { delete st.owners[k]; delete st.houses[k]; } });
    lines.push(p.name + ' could not pay and is out of the game');
  }
}

function vyMoveTo(st, pi, to, lines) {
  const p = st.players[pi];
  if (to < p.pos && to !== p.pos) { p.money += VY_PASS_START; lines.push(p.name + ' passed Start: +' + VY_PASS_START); }
  p.pos = to;
}

function vyLand(st, pi, lines, R) {
  const p = st.players[pi], sq = p.pos, s = VY_BOARD[sq];
  if (s.t === 'city' || s.t === 'rail') {
    const owner = st.owners[sq];
    if (owner === undefined) {
      if (p.money >= s.price) { st.phase = 'buy'; st.pending = sq; lines.push(p.name + ' can buy ' + s.name + ' for ' + s.price); }
      else lines.push(p.name + ' cannot afford ' + s.name);
      return;
    }
    if (owner !== pi && !st.players[owner].out) {
      const rent = vyRent(st, sq);
      lines.push(p.name + ' paid ' + rent + ' rent to ' + st.players[owner].name + ' for ' + s.name);
      vyPay(st, pi, owner, rent, lines);
    }
    return;
  }
  if (s.t === 'tax') { lines.push(p.name + ' paid ' + s.amount + ' income tax'); vyPay(st, pi, null, s.amount, lines); return; }
  if (s.t === 'jam') { p.skip = true; lines.push(p.name + ' is stuck in a traffic jam and misses the next turn'); return; }
  if (s.t === 'card') {
    if (!st.deck.length) st.deck = shuffle(VY_CARDS.map((_, i) => i), R);
    const c = VY_CARDS[st.deck.shift()];
    lines.push('Family card for ' + p.name + ': ' + c.text);
    st.lastCard = c.text;
    if (c.money > 0) p.money += c.money;
    else if (c.money < 0) vyPay(st, pi, null, -c.money, lines);
    else if (c.each) {
      alive(st).forEach(oi => {
        if (oi === pi) return;
        if (c.each > 0) vyPay(st, oi, pi, c.each, lines);
        else vyPay(st, pi, oi, -c.each, lines);
      });
    } else if (c.to !== undefined) { vyMoveTo(st, pi, c.to, lines); if (c.to !== 0) vyLand(st, pi, lines, R); }
  }
}

function vyEndTurn(st, again) {
  st.phase = 'roll'; st.pending = null;
  const live = alive(st);
  if (live.length <= 1) { st.winner = live.length ? st.players[live[0]].name : null; return; }
  st.turns += 1;
  if (st.turns >= st.maxTurns) {
    const best = live.sort((a, b) => vyWorth(st, b) - vyWorth(st, a))[0];
    st.winner = st.players[best].name; st.byWorth = true;
    return;
  }
  if (again && !st.players[st.turn].out) return;
  st.doubles = 0;
  do { st.turn = (st.turn + 1) % st.players.length; } while (st.players[st.turn].out);
  // A traffic jam costs exactly one turn.
  if (st.players[st.turn].skip) {
    st.players[st.turn].skip = false;
    const skipped = st.players[st.turn].name;
    do { st.turn = (st.turn + 1) % st.players.length; } while (st.players[st.turn].out);
    st.skipped = skipped;
  } else st.skipped = null;
}

export function vyRoll(st, memberId, R) {
  if (st.winner) return { error: 'The game is over' };
  const pi = st.turn, p = st.players[pi];
  if (!p || p.id !== memberId) return { error: 'Not your turn yet' };
  if (st.phase !== 'roll') return { error: 'Buy it or pass first' };
  const d = [die(R), die(R)];
  const lines = [];
  const doubles = d[0] === d[1];
  st.doubles = doubles ? st.doubles + 1 : 0;
  if (st.doubles === 3) {
    p.skip = true; lines.push(p.name + ' rolled three doubles and is stuck in a traffic jam');
    st.last = { by: p.name, dice: d, lines };
    vyEndTurn(st, false);
    return { dice: d, lines };
  }
  vyMoveTo(st, pi, (p.pos + d[0] + d[1]) % VY_BOARD.length, lines);
  lines.unshift(p.name + ' rolled ' + d[0] + ' and ' + d[1] + ' to ' + VY_BOARD[p.pos].name);
  vyLand(st, pi, lines, R);
  st.last = { by: p.name, dice: d, lines };
  if (st.phase !== 'buy') vyEndTurn(st, doubles && !p.out);
  return { dice: d, lines, announce: vyWinLine(st) };
}

export function vyBuy(st, memberId, yes) {
  if (st.winner) return { error: 'The game is over' };
  const pi = st.turn, p = st.players[pi];
  if (!p || p.id !== memberId) return { error: 'Not your turn yet' };
  if (st.phase !== 'buy') return { error: 'Nothing to buy right now' };
  const sq = st.pending, s = VY_BOARD[sq];
  const lines = [];
  if (yes) {
    if (p.money < s.price) return { error: 'Not enough money' };
    p.money -= s.price; st.owners[sq] = pi;
    lines.push(p.name + ' bought ' + s.name + ' for ' + s.price);
  } else lines.push(p.name + ' passed on ' + s.name);
  st.last = { by: p.name, dice: st.last && st.last.dice, lines: (st.last ? st.last.lines : []).concat(lines) };
  vyEndTurn(st, st.doubles > 0);
  return { lines, announce: vyWinLine(st) };
}

// A house: only on a full colour set you own, on your turn before you roll.
export function vyBuild(st, memberId, sq) {
  if (st.winner) return { error: 'The game is over' };
  const pi = st.turn, p = st.players[pi];
  if (!p || p.id !== memberId) return { error: 'Not your turn yet' };
  if (st.phase !== 'roll') return { error: 'Finish this move first' };
  const i = Number(sq), s = VY_BOARD[i];
  if (!s || s.t !== 'city') return { error: 'Houses go on cities' };
  if (st.owners[i] !== pi) return { error: 'You do not own ' + s.name };
  if (!vyHasSet(st, pi, s.g)) return { error: 'Own every city of that colour first' };
  const h = st.houses[i] || 0;
  if (h >= VY_MAX_HOUSES) return { error: s.name + ' has all its houses' };
  const cost = Math.floor(s.price / 2);
  if (p.money < cost) return { error: 'A house on ' + s.name + ' costs ' + cost };
  p.money -= cost; st.houses[i] = h + 1;
  st.last = { by: p.name, lines: [p.name + ' built house ' + (h + 1) + ' on ' + s.name + ' for ' + cost] };
  return { lines: st.last.lines };
}
function vyWinLine(st) {
  if (!st.winner) return null;
  return '🏠 ' + st.winner + ' won Vyapar' + (st.byWorth ? ' - richest when the game ran its course' : ' - last business standing') + '!';
}
export function vyEnd(st) {
  const live = alive(st);
  const best = live.sort((a, b) => vyWorth(st, b) - vyWorth(st, a))[0];
  st.winner = best !== undefined ? st.players[best].name : null; st.byWorth = true;
  return vyWinLine(st);
}

// The opponent buys while it keeps a cushion, and builds when it can
// afford to.
export function vyBotStep(st, R) {
  const p = st.players[st.turn];
  if (st.phase === 'buy') {
    const s = VY_BOARD[st.pending];
    return vyBuy(st, p.id, p.money - s.price >= 150);
  }
  for (let i = 0; i < VY_BOARD.length; i++) {
    const s = VY_BOARD[i];
    if (s.t === 'city' && st.owners[i] === st.turn && vyHasSet(st, st.turn, s.g) &&
        (st.houses[i] || 0) < VY_MAX_HOUSES && p.money - Math.floor(s.price / 2) >= 300) {
      return vyBuild(st, p.id, i);
    }
  }
  return vyRoll(st, p.id, R);
}

// =====================================================================
// Shared: whose turn, over or not, and running the opponents.
// =====================================================================
export function currentSeat(st) { return st.players[st.turn]; }
export function isOver(st) { return !!(st.winner || st.loser || st.draw); }

// Play every opponent turn until a person is up, or the game ends.
export function runBoardBots(st, R) {
  const lines = [];
  for (let guard = 0; guard < 400; guard++) {
    if (isOver(st) || !bot(st, st.turn)) break;
    const p = st.players[st.turn];
    let r;
    if (st.kind === 'ludo') r = st.moves ? ludoMove(st, p.id, ludoBotToken(st)) : ludoRoll(st, p.id, R);
    else if (st.kind === 'bhabhi') r = bhabhiPlay(st, p.id, bhabhiBotCard(st));
    else if (st.kind === 'vyapar') r = vyBotStep(st, R);
    else break;
    if (!r || r.error) break;
    if (r.announce) lines.push(r.announce);
  }
  return lines;
}

// One move by a person, for any of the three games.
export function boardMove(st, memberId, mv, R) {
  const m = mv || {};
  if (st.kind === 'ludo') return m.do === 'move' ? ludoMove(st, memberId, m.token) : ludoRoll(st, memberId, R);
  if (st.kind === 'bhabhi') return bhabhiPlay(st, memberId, m.card);
  if (st.kind === 'vyapar') {
    if (m.do === 'buy') return vyBuy(st, memberId, true);
    if (m.do === 'pass') return vyBuy(st, memberId, false);
    if (m.do === 'build') return vyBuild(st, memberId, m.sq);
    return vyRoll(st, memberId, R);
  }
  return { error: 'Unknown game' };
}

export function boardStart(kind, people, R) {
  if (kind === 'ludo') return ludoStart(people);
  if (kind === 'bhabhi') return bhabhiStart(people, R);
  if (kind === 'vyapar') return vyStart(people, R);
  return { error: 'Unknown game' };
}
// How many seats each game takes, and how many opponents a solo game gets.
export const BOARD_SEATS = { ludo: [2, 4, 1], bhabhi: [3, 6, 2], vyapar: [2, 6, 1] };
