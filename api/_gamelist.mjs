// The games LIST: how a circle's games are named, numbered and summarised.
// Its own module, and importing nothing, for the same reason _phone.mjs is:
// the deploy gate runs its unit test on a fresh clone, before npm install,
// and api/games.mjs pulls in the database driver.
//
// A circle can have several games running at once, including two of the same
// kind. Two Snakes and Ladders games are two different games with their own players,
// turns and boards, so each keeps the number it was started as.
export const MAX_ACTIVE = 12;
export const GAME_LABEL = {
  snakes: 'Snakes & Ladders 🐍🪜', ttt: 'Tic-Tac-Toe ⭕✕',
  antakshari: 'Song Chain 🎤', charades: 'Dumb Charades 🎭',
  ludo: 'Ludo 🎯', bhabhi: 'Get Away 🃏', vyapar: 'Business 🏠'
};
export function gameName(kind, n) {
  const base = GAME_LABEL[kind] || 'Game';
  return Number(n) > 1 ? base + ' ' + Number(n) : base;
}
// Numbering from the highest number still running, not from the count, so
// ending the first game never makes a later game share a name with another.
export function numberAfter(states) {
  let max = 0;
  for (const st of states || []) { const n = Number(st && st.n) || 1; if (n > max) max = n; }
  return max + 1;
}

// Who Parwah plays for: its own seats, and anyone who left a game or whose
// turn the family handed to Parwah after a long wait (away).
export function isBot(p) { return !!(p && (p.bot || p.away)); }
// Parwah's own seats only: a game against Parwah is a game played alone.
export function isParwah(p) { return !!(p && p.bot); }
export function teamList(st, t) { return st.players.filter(p => p.team === t); }
export function currentPlayer(st) {
  let t = st.teamTurn;
  if (!teamList(st, t).length) t = 1 - t;
  const list = teamList(st, t);
  if (!list.length) return null;
  return list[st.ptr[t] % list.length];
}

// One row of the list: enough to choose between two Snakes and Ladders games without
// opening either, and to see at a glance which one is waiting on you.
export function gameSummary(g, memberId) {
  const st = g.state || {};
  const kind = st.kind || g.kind;
  const seats = Array.isArray(st.players) ? st.players : [];
  const party = kind === 'antakshari' || kind === 'charades';
  const lobby = party && st.status === 'lobby';
  const cur = party ? (lobby ? null : currentPlayer(st)) : seats[st.turn];
  const over = !!(st.winner || st.draw || st.loser);
  return {
    id: g.id, kind, n: Number(st.n) || 1, name: gameName(kind, st.n),
    status: g.status, lobby: lobby || undefined,
    solo: seats.some(isParwah) || undefined,
    by: st.by || null,
    players: seats.map(p => p && p.name).filter(Boolean),
    mine: seats.some(p => p && p.id === memberId),
    turnName: over ? null : (cur ? cur.name : null),
    myTurn: !over && !!(cur && cur.id === memberId),
    over: over || undefined,
    winner: st.winner || null,
    createdAt: g.created_at
  };
}
