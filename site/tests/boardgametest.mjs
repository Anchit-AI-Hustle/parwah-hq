// LUDO, BHABHI AND VYAPAR: every rule, with the dice fixed.
// api/_boardgames.mjs imports nothing, so this runs in the deploy gate
// before npm install.
import * as G from '../../api/_boardgames.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

// A random source that rolls the dice we say, then carries on seeded.
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function dice(...vals) { const rest = seeded(7); return () => vals.length ? (vals.shift() - 1) / 6 + 0.01 : rest(); }
const A = { id: 'a', name: 'Asha' }, B = { id: 'b', name: 'Bittu' }, C = { id: 'c', name: 'Chachi' }, D = { id: 'd', name: 'Dadu' };
const clone = (x) => JSON.parse(JSON.stringify(x));

// ============================== LUDO ==============================
{
  ok('ludo: one player is not a game', !!G.ludoStart([A]).error);
  ok('ludo: five is too many', !!G.ludoStart([A, B, C, D, { id: 'e', name: 'E' }]).error);
  const two = G.ludoStart([A, B]);
  ok('ludo: two players sit opposite (red and yellow)', two.players[0].color === 0 && two.players[1].color === 2);
  ok('ludo: everyone starts with four tokens in base', two.players.every(p => p.tokens.join() === '-1,-1,-1,-1'));

  let st = G.ludoStart([A, B]);
  ok('ludo: not your turn', !!G.ludoRoll(st, 'b', dice(6)).error);
  G.ludoRoll(st, 'a', dice(3));
  ok('ludo: without a six nobody leaves base, and the turn passes', st.turn === 1 && st.players[0].tokens.every(p => p === -1));
  G.ludoRoll(st, 'b', dice(6));
  ok('ludo: a six with four tokens in base asks which one', st.moves && st.moves.length === 4 && st.turn === 1);
  ok('ludo: rolling again before moving is refused', !!G.ludoRoll(st, 'b', dice(2)).error);
  ok('ludo: a token that cannot move is refused', !!G.ludoMove(st, 'b', 9).error);
  G.ludoMove(st, 'b', 2);
  ok('ludo: the token comes out onto its start square', st.players[1].tokens[2] === 0);
  ok('ludo: and a six rolls again', st.turn === 1);
  G.ludoRoll(st, 'b', dice(4));
  ok('ludo: with one token out, a 4 moves it without asking', st.players[1].tokens[2] === 4 && st.turn === 0);

  // Capture: Asha lands on Bittu's square.
  st = G.ludoStart([A, B]);
  st.players[0].tokens = [2, -1, -1, -1];
  st.players[1].tokens = [31, -1, -1, -1];      // yellow: (26 + 31) % 52 = 5
  ok('ludo: squares are counted from each colour\'s own start', G.ludoSquare(2, 31) === 5 && G.ludoSquare(0, 5) === 5);
  G.ludoRoll(st, 'a', dice(3));
  ok('ludo: landing on an opponent sends it back to base', st.players[1].tokens[0] === -1 && st.players[0].tokens[0] === 5);
  ok('ludo: and a capture earns another roll', st.turn === 0);
  ok('ludo: the capture is told', /back to base/.test(st.last.text));

  // Safe squares protect.
  st = G.ludoStart([A, B]);
  st.players[0].tokens = [5, -1, -1, -1];
  st.players[1].tokens = [34, -1, -1, -1];      // (26 + 34) % 52 = 8, a star
  G.ludoRoll(st, 'a', dice(3));
  ok('ludo: a star square is safe - no capture', st.players[1].tokens[0] === 34 && st.turn === 1);

  // Exact roll home.
  st = G.ludoStart([A, B]);
  st.players[0].tokens = [54, 56, 56, 56];
  G.ludoRoll(st, 'a', dice(3));
  ok('ludo: home needs the exact number - 3 from 54 cannot move', st.players[0].tokens[0] === 54 && st.turn === 1);
  st.turn = 0;
  G.ludoRoll(st, 'a', dice(2));
  ok('ludo: the exact roll takes the last token home, and wins', st.players[0].tokens[0] === 56 && st.winner === 'Asha');
  ok('ludo: no moves after the game is won', !!G.ludoRoll(st, 'b', dice(3)).error);

  // Three sixes.
  st = G.ludoStart([A, B]);
  st.players[0].tokens = [10, -1, -1, -1];
  G.ludoRoll(st, 'a', dice(6)); if (st.moves) G.ludoMove(st, 'a', 0);
  G.ludoRoll(st, 'a', dice(6)); if (st.moves) G.ludoMove(st, 'a', 0);
  const before = clone(st.players[0].tokens);
  G.ludoRoll(st, 'a', dice(6));
  ok('ludo: a third six in a row passes the turn and moves nothing', st.turn === 1 && JSON.stringify(st.players[0].tokens) === JSON.stringify(before));

  // The opponent captures when it can.
  st = G.ludoStart([A, { ...G.botSeats(1)[0] }]);
  st.turn = 1;
  st.players[1].tokens = [2, 20, -1, -1];      // yellow squares 28 and 46
  st.players[0].tokens = [31, -1, -1, -1];     // red square 31: yellow 2 + 3 = 5 lands on it
  st.roll = 3; st.moves = G.ludoMoves(st.players[1], 3);
  // Without the capture rule it would push token 1, which is further along.
  ok('ludo: the opponent takes the capture over pushing its lead token', G.ludoBotToken(st) === 0);

  // Whole games, opponents only, end with a winner.
  let finished = 0;
  for (let s = 1; s <= 20; s++) {
    const R = seeded(s);
    const g = G.ludoStart(G.botSeats(2 + (s % 3)));
    for (let i = 0; i < 60 && !g.winner; i++) G.runBoardBots(g, R);
    if (g.winner) finished++;
  }
  ok('ludo: twenty games between opponents all finish with a winner', finished === 20, finished);
}

// ============================== BHABHI ==============================
{
  ok('bhabhi: two players is too few', !!G.bhabhiStart([A, B]).error);
  const st = G.bhabhiStart([A, B, C, D], seeded(3));
  const all = st.hands.flat();
  ok('bhabhi: the whole deck is dealt, every card once', all.length === 52 && new Set(all).size === 52);
  ok('bhabhi: four players get 13 each', st.hands.every(h => h.length === 13));
  const five = G.bhabhiStart([A, B, C, D, { id: 'e', name: 'E' }], seeded(3));
  ok('bhabhi: five players: hands differ by at most one', Math.max(...five.hands.map(h => h.length)) - Math.min(...five.hands.map(h => h.length)) <= 1);
  ok('bhabhi: whoever holds the Ace of Spades starts', st.hands[st.turn].includes('S14'));
  const lead = st.players[st.turn].id;
  const other = st.hands[st.turn].find(c => c !== 'S14');
  ok('bhabhi: the first card must be the Ace of Spades', /Ace of Spades/.test(G.bhabhiPlay(st, lead, other).error || ''));
  ok('bhabhi: a card you do not hold is refused', !!G.bhabhiPlay(st, lead, 'Z99').error);
  G.bhabhiPlay(st, lead, 'S14');
  const nextI = st.turn, nh = st.hands[nextI];
  const spade = nh.find(c => c[0] === 'S'), nonSpade = nh.find(c => c[0] !== 'S');
  if (spade && nonSpade) ok('bhabhi: holding a spade, you must follow spades', /Follow suit/.test(G.bhabhiPlay(st, st.players[nextI].id, nonSpade).error || ''));

  // A thulla: the highest of the led suit picks everything up.
  let t = G.bhabhiStart([A, B, C], seeded(1));
  t.first = false; t.turn = 0;
  t.hands = [['H10', 'C2'], ['H13', 'D5'], ['S3', 'S4']];
  G.bhabhiPlay(t, 'a', 'H10');
  G.bhabhiPlay(t, 'b', 'H13');
  const r = G.bhabhiPlay(t, 'c', 'S3');
  ok('bhabhi: no heart to follow: a thulla stops the round', t.trick.length === 0 && t.last.thulla);
  ok('bhabhi: the highest heart (Bittu, King) picks up all three cards', t.hands[1].length === 4 && ['H10', 'H13', 'S3', 'D5'].every(c => t.hands[1].includes(c)));
  ok('bhabhi: and leads the next round', t.turn === 1 && !r.error);

  // Everyone follows: the cards leave the game; the highest leads.
  t = G.bhabhiStart([A, B, C], seeded(1));
  t.first = false; t.turn = 0;
  t.hands = [['D4', 'C9'], ['D12', 'C3'], ['D7', 'H2']];
  G.bhabhiPlay(t, 'a', 'D4'); G.bhabhiPlay(t, 'b', 'D12'); G.bhabhiPlay(t, 'c', 'D7');
  ok('bhabhi: all followed: the three diamonds are set aside', t.hands.flat().length === 3 && !t.hands.flat().some(c => c[0] === 'D'));
  ok('bhabhi: the Queen leads next', t.turn === 1);

  // Escaping, and the Bhabhi.
  t = G.bhabhiStart([A, B, C], seeded(1));
  t.first = false; t.turn = 0;
  t.hands = [['S5'], ['S9', 'H4'], ['S2', 'C7']];
  G.bhabhiPlay(t, 'a', 'S5'); G.bhabhiPlay(t, 'b', 'S9'); G.bhabhiPlay(t, 'c', 'S2');
  ok('bhabhi: an empty hand after a round escapes', t.out[0] === true && t.order[0] === 'Asha');
  ok('bhabhi: the round\'s winner (Bittu) leads', t.turn === 1);
  G.bhabhiPlay(t, 'b', 'H4');
  G.bhabhiPlay(t, 'c', 'C7');
  ok('bhabhi: Chachi cannot follow hearts: Bittu picks both up', t.hands[1].length === 2 && t.hands[2].length === 0);
  ok('bhabhi: Chachi escapes, so Bittu is the Bhabhi', t.loser === 'Bittu' && t.winner === 'Asha');
  ok('bhabhi: nothing more can be played', !!G.bhabhiPlay(t, 'b', 'H4').error);

  // The lead passes on when the leader has just escaped.
  t = G.bhabhiStart([A, B, C], seeded(1));
  t.first = false; t.turn = 0;
  t.hands = [['S14'], ['S9', 'H4'], ['S2', 'C7']];
  G.bhabhiPlay(t, 'a', 'S14'); G.bhabhiPlay(t, 'b', 'S9'); G.bhabhiPlay(t, 'c', 'S2');
  ok('bhabhi: the Ace wins but Asha escaped, so the next player leads', t.out[0] && t.turn === 1);

  // Nobody sees anyone else's cards.
  const v = G.bhabhiView(st, st.players[0].id);
  ok('bhabhi: you see your own hand', v.hands[0].length === st.hands[0].length);
  ok('bhabhi: and only how many cards the others hold', v.hands.slice(1).every(h => h.length === 0) && v.counts[1] === st.hands[1].length);
  ok('bhabhi: the view never carries anyone else\'s cards', !JSON.stringify(v).includes('"' + st.hands[1][0] + '"') || st.trick.some(x => x.card === st.hands[1][0]));

  // Whole games between opponents end with a Bhabhi and conserve cards.
  let done = 0, lost = 0;
  for (let s = 1; s <= 20; s++) {
    const R = seeded(s);
    const g = G.bhabhiStart(G.botSeats(3 + (s % 4)), R);
    for (let i = 0; i < 40 && !g.loser; i++) {
      G.runBoardBots(g, R);
      const cards = g.hands.flat().concat(g.trick.map(x => x.card));
      if (new Set(cards).size !== cards.length) lost++;
    }
    if (g.loser) done++;
  }
  ok('bhabhi: twenty games between opponents all end with a Bhabhi', done === 20, done);
  ok('bhabhi: no card is ever duplicated along the way', lost === 0, lost);
}

// ============================== VYAPAR ==============================
{
  ok('vyapar: one player is not a game', !!G.vyStart([A]).error);
  let st = G.vyStart([A, B], seeded(1));
  ok('vyapar: everyone starts with 1500 at Start', st.players.every(p => p.money === 1500 && p.pos === 0));
  ok('vyapar: the board has 24 squares of Indian cities', G.VY_BOARD.length === 24 && G.VY_BOARD.some(s => s.name === 'Jaipur'));

  G.vyRoll(st, 'a', dice(1, 2));                  // 3: Udaipur
  ok('vyapar: dice move you: 1 and 2 to Udaipur', st.players[0].pos === 3 && st.phase === 'buy');
  ok('vyapar: rolling again before deciding is refused', !!G.vyRoll(st, 'a', dice(1, 1)).error);
  G.vyBuy(st, 'a', true);
  ok('vyapar: buying pays the price and takes the deed', st.players[0].money === 1440 && st.owners[3] === 0 && st.turn === 1);
  G.vyRoll(st, 'b', dice(1, 2));
  ok('vyapar: landing on someone\'s city pays them rent', st.players[1].money === 1500 - 8 && st.players[0].money === 1440 + 8);

  // Full set doubles rent; houses multiply it.
  st = G.vyStart([A, B], seeded(1));
  st.owners = { 1: 0, 3: 0 };
  ok('vyapar: the whole colour doubles rent', G.vyRent(st, 3) === 16);
  ok('vyapar: a house needs the whole colour', !G.vyBuild(st, 'a', 3).error && st.houses[3] === 1 && st.players[0].money === 1470);
  ok('vyapar: one house: rent x5', G.vyRent(st, 3) === 40);
  G.vyBuild(st, 'a', 3); G.vyBuild(st, 'a', 3);
  ok('vyapar: three houses at most', !!G.vyBuild(st, 'a', 3).error && G.vyRent(st, 3) === 240);
  st.owners = { 6: 0 };
  ok('vyapar: no house without the whole colour', /every city/.test(G.vyBuild(st, 'a', 6).error || ''));
  st.owners = { 5: 1, 14: 1 };
  ok('vyapar: both railways: 50 rent', G.vyRent(st, 5) === 50);

  // Passing Start, tax, traffic jam.
  st = G.vyStart([A, B], seeded(1));
  st.players[0].pos = 22;
  G.vyRoll(st, 'a', dice(1, 3));                  // 22 + 4 = 26 -> 2 (Family card)
  ok('vyapar: passing Start pays 200', st.players[0].money >= 1500 + 200 - 50 && /passed Start/.test(st.last.lines.join(' ')));
  st = G.vyStart([A, B], seeded(1));
  G.vyRoll(st, 'a', dice(2, 2));                  // doubles to 4: tax
  ok('vyapar: income tax takes 100', st.players[0].money === 1400);
  ok('vyapar: doubles roll again', st.turn === 0);
  st = G.vyStart([A, B, C], seeded(1));
  st.players[0].pos = 18;
  G.vyRoll(st, 'a', dice(1, 2));                  // 21: traffic jam
  G.vyRoll(st, 'b', dice(1, 2));
  if (st.phase === 'buy') G.vyBuy(st, 'b', false);
  G.vyRoll(st, 'c', dice(1, 2));
  if (st.phase === 'buy') G.vyBuy(st, 'c', false);
  ok('vyapar: a traffic jam costs exactly one turn', st.turn === 1 && st.skipped === 'Asha');

  // Bankruptcy.
  st = G.vyStart([A, B], seeded(1));
  st.owners = { 23: 0 }; st.houses = { 23: 3 };
  st.players[1].money = 90; st.players[1].pos = 20; st.turn = 1;
  G.vyRoll(st, 'b', dice(1, 2));                  // 23: Goa, rent 50 x30
  ok('vyapar: a rent you cannot pay puts you out', st.players[1].out === true);
  ok('vyapar: the owner gets everything you had', st.players[0].money === 1500 + 90);
  ok('vyapar: the last business standing wins', st.winner === 'Asha');

  // A card, exactly.
  st = G.vyStart([A, B, C], seeded(1));
  st.deck = [5];                                  // shagun: every player gives you 20
  G.vyRoll(st, 'a', dice(1, 1));                  // 2: Family card (doubles, rolls again)
  ok('vyapar: shagun: every player gives you 20', st.players[0].money === 1540 && st.players[1].money === 1480 && st.players[2].money === 1480);

  // Whole games between opponents finish.
  let done = 0;
  for (let s = 1; s <= 20; s++) {
    const R = seeded(s);
    const g = G.vyStart(G.botSeats(2 + (s % 3)), R);
    for (let i = 0; i < 80 && !g.winner; i++) G.runBoardBots(g, R);
    if (g.winner) done++;
  }
  ok('vyapar: twenty games between opponents all finish with a winner', done === 20, done);
  st = G.vyStart([A, B], seeded(1));
  st.players[1].money = 5000;
  ok('vyapar: ending early names the richest', /Bittu won/.test(G.vyEnd(st)));
}

// ============================== shared ==============================
{
  const st = G.ludoStart([A, ...G.botSeats(1)]);
  G.ludoRoll(st, 'a', dice(3));
  const lines = G.runBoardBots(st, dice(4));
  ok('shared: after your move the opponent plays until it is your turn again', st.turn === 0 && Array.isArray(lines));
  ok('shared: the move router refuses an unknown game', !!G.boardMove({ kind: 'chess' }, 'a', {}).error);
  ok('shared: seats and solo opponents per game', G.BOARD_SEATS.ludo.join() === '2,4,1' && G.BOARD_SEATS.bhabhi.join() === '3,6,2');
}

if (fails.length) {
  console.error(`boardgametest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`boardgametest: ${pass}/${pass} checks pass`);
