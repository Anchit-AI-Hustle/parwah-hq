// The games LIST, as pure logic. Imports api/_gamelist.mjs, which imports
// nothing, so the deploy gate runs this on a fresh clone before npm install.
//
// What it is here to protect: a circle can have several games at once,
// including two of the same kind, and a family must be able to tell them
// apart and see which one is waiting on them.
import { gameName, gameSummary, numberAfter, GAME_LABEL, MAX_ACTIVE, isBot, currentPlayer }
  from '../../api/_gamelist.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

const ME = '11111111-1111-4111-8111-111111111111';
const PA = '22222222-2222-4222-8222-222222222222';
const BE = '33333333-3333-4333-8333-333333333333';
const row = (state, id) => ({ id: id || 'g1', kind: state.kind, status: 'active', state, created_at: '2026-09-02T10:00:00Z' });

// ---- naming: the first of a kind is unadorned, the rest are numbered
ok('the first game of a kind is just its name', gameName('snakes', 1) === 'Saanp Seedhi 🐍🪜');
ok('a second game of the same kind is numbered', gameName('snakes', 2) === 'Saanp Seedhi 🐍🪜 2');
ok('a missing number reads as the first', gameName('ttt', undefined) === 'Tic-Tac-Toe ⭕✕');
ok('every kind has a name', Object.keys(GAME_LABEL).length === 4 && !!GAME_LABEL.charades);
ok('an unknown kind still gets a name', gameName('ludo', 1) === 'Game');

// ---- numbering counts from the highest still running, not from how many
// there are: ending the first game must never make a later game collide.
ok('the first number is 1', numberAfter([]) === 1);
ok('a second game takes 2', numberAfter([{ n: 1 }]) === 2);
ok('ending the first does not reissue 2', numberAfter([{ n: 2 }, { n: 3 }]) === 4);
ok('a game saved before numbering counts as 1', numberAfter([{}]) === 2);

// ---- the row: which game, who is in it, and whether it wants me
const duel = { kind: 'ttt', n: 2, by: 'Rohan', players: [{ id: ME, name: 'Rohan' }, { id: PA, name: 'Papa' }], turn: 0, board: [null,null,null,null,null,null,null,null,null], winner: null, draw: false };
const mine = gameSummary(row(duel), ME), theirs = gameSummary(row(duel), PA);
ok('the row names the numbered game', mine.name === 'Tic-Tac-Toe ⭕✕ 2');
ok('it is my turn when the turn is mine', mine.myTurn === true && theirs.myTurn === false);
ok('both players are in it', mine.mine === true && theirs.mine === true);
ok('the other player is told whose turn it is', theirs.turnName === 'Rohan');
ok('the players are listed by name', mine.players.join(',') === 'Rohan,Papa');

const outsider = gameSummary(row(duel), BE);
ok('someone not playing is not in it', outsider.mine === false && outsider.myTurn === false);
ok('a spectator still sees whose turn it is', outsider.turnName === 'Rohan');

// ---- a finished game asks nothing of anybody
const won = JSON.parse(JSON.stringify(duel)); won.winner = 'Papa';
const w = gameSummary(row(won), ME);
ok('a won game is marked over', w.over === true);
ok('a won game is nobody’s turn', w.myTurn === false && w.turnName === null);
ok('the winner is named', w.winner === 'Papa');
const drawn = JSON.parse(JSON.stringify(duel)); drawn.draw = true;
ok('a drawn game is over too', gameSummary(row(drawn), ME).over === true);

// ---- playing alone is marked, so the list does not imply company
const solo = { kind: 'snakes', n: 1, players: [{ id: ME, name: 'Rohan', pos: 0 }, { id: 'bot', name: 'Parwah', bot: true, pos: 0 }], turn: 0 };
ok('a solo game is marked solo', gameSummary(row(solo), ME).solo === true);
ok('a family game is not marked solo', gameSummary(row(duel), ME).solo === undefined);
ok('the bot is recognised', isBot({ bot: true }) && !isBot({ id: ME }));

// ---- a party lobby is waiting for people, not for a turn
const lobby = { kind: 'antakshari', n: 1, status: 'lobby', admins: [ME], players: [{ id: ME, name: 'Rohan', team: 0, score: 0 }], teamScores: [0,0], teamTurn: 0, ptr: [0,0] };
const L = gameSummary(row(lobby), ME);
ok('a lobby is marked as a lobby', L.lobby === true);
ok('a lobby has no turn to wait on', L.turnName === null && L.myTurn === false);
const playing = JSON.parse(JSON.stringify(lobby)); playing.status = 'playing';
playing.players.push({ id: PA, name: 'Papa', team: 1, score: 0 });
const P = gameSummary(row(playing), ME);
ok('a started party game is not a lobby', P.lobby === undefined);
ok('a started party game has a current player', P.turnName === 'Rohan' && P.myTurn === true);
ok('currentPlayer picks from the team whose turn it is', currentPlayer(playing).id === ME);

// ---- two games of the same kind are two different rows
const a = gameSummary(row({ ...solo, n: 1 }, 'ga'), ME);
const b = gameSummary(row({ ...solo, n: 2 }, 'gb'), ME);
ok('two games of one kind have different ids', a.id !== b.id);
ok('two games of one kind have different names', a.name !== b.name);

ok('the cap is a real limit', Number.isInteger(MAX_ACTIVE) && MAX_ACTIVE >= 2);

if (fails.length) {
  console.error(`gametest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`gametest: ${pass}/${pass} checks pass`);
