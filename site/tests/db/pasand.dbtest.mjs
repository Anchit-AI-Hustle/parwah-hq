// PASAND AGAINST A REAL DATABASE: the real handler behind
// /api/games?area=pasand, the real schema and SQL.
//
// What it proves: a person's likes and platforms go to exactly the people
// they chose (the whole family, named members, or only them), and that is
// the server's answer, not the screen's; another circle sees nothing and
// can change nothing; a recommendation is read only by its sender and its
// recipients; each recipient has one answer and can change it; a password,
// a sign-in or a link that is not plain https is refused with a reason and
// nothing is kept; the sender can remove what they sent.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('pasand.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('pasand.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: games } = await import('../../../api/games.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { canSee, NO_PASSWORD, PASAND_MAX } = await import('../../../api/_pasandrules.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function user(name) {
  const phone = '+9198422' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}
async function seat(circleId, code, u) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id) values ($1,$2,$3) returning id`, [circleId, u.name, u.userId])).rows[0];
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const grp = (await admin.query(`insert into circles (code, name, kind) values ('COUSIN','Cousins','group') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), meera: await user('Meera'), papa: await user('Papa'), vikram: await user('Vikram') };
const rohan = await seat(fam, 'SHARMA', U.rohan), meera = await seat(fam, 'SHARMA', U.meera), papa = await seat(fam, 'SHARMA', U.papa);
const vikram = await seat(grp, 'COUSIN', U.vikram);
// Dadi is in the family by name only: she never signs in.
const dadi = (await admin.query(`insert into members (circle_id, name) values ($1,'Dadi') returning id`, [fam])).rows[0];

async function call(who, { method = 'POST', body = {}, as = null } = {}) {
  const req = { method, headers: { 'x-parwah-token': who.token },
                query: { area: 'pasand', circle: who.code, member: as || who.id },
                body: { area: 'pasand', code: who.code, memberId: as || who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await games(req, res);
  return { ...json, status };
}
const get = (who) => call(who, { method: 'GET' });
const seen = async (viewer, owner) => ((await get(viewer)).people || []).find(p => p.memberId === owner.id) || null;
const count = async (q, p) => (await admin.query(q, p)).rows[0].n;

// ---- the route
{
  const r = await get(rohan);
  ok('GET answers with an empty start', r.status === 200 && r.ok && r.me.audience === 'family' && r.me.likes.length === 0 && r.me.platforms.length === 0
     && r.people.length === 0 && r.forMe.length === 0 && r.fromMe.length === 0, JSON.stringify(r));
  ok('the games list still answers on the same route', await (async () => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
    await games({ method: 'GET', headers: { 'x-parwah-token': rohan.token }, query: { circle: 'SHARMA', member: rohan.id }, body: {} }, res);
    return status === 200 && json.ok && Array.isArray(json.games);
  })());
  ok('the five tables exist', (await count(`select count(*)::int as n from information_schema.tables where table_name in ('pasand_prefs','pasand_likes','pasand_platforms','pasand_recs','pasand_rec_to')`)) === 5);
}

// ---- who is asking
{
  ok('no token: sign in', (await call({ ...rohan, token: '' }, { method: 'GET' })).status === 401);
  ok('Meera cannot ask as Rohan', (await call(meera, { method: 'GET', as: rohan.id })).status === 403);
  ok('Meera cannot write as Rohan', (await call(meera, { as: rohan.id, body: { action: 'like_add', kind: 'shows', text: 'Not mine' } })).status === 403);
  ok('an outsider with the family code and a member id is refused', (await call({ ...vikram, code: 'SHARMA' }, { method: 'GET', as: rohan.id })).status === 403);
  ok('an outsider with the family code and their own id is refused', (await call({ ...vikram, code: 'SHARMA' }, { method: 'GET' })).status === 403);
  ok('a code that is no family is not found', (await call({ ...vikram, code: 'NOPE99' }, { method: 'GET' })).status === 404);
  ok('nobody signs in as Dadi, who is not on the app', (await call(rohan, { method: 'GET', as: dadi.id })).status === 403);
  ok('a bad member id is refused', (await call(rohan, { method: 'GET', as: 'not-a-uuid' })).status === 403);
  ok('only GET and POST', (await call(rohan, { method: 'DELETE' })).status === 405);
  ok('an unknown action is refused', (await call(rohan, { body: { action: 'drop_everything' } })).status === 400);
}

// ---- my likes
let likeId;
{
  let r = await call(rohan, { body: { action: 'like_add', kind: 'shows', text: '  Panchayat  ' } });
  ok('Rohan adds a like', r.status === 201 && !!r.id); likeId = r.id;
  r = await call(rohan, { body: { action: 'like_add', kind: 'shows', text: 'panchayat' } });
  ok('the same like twice is one like', r.status === 200 && r.already === true && (await count(`select count(*)::int as n from pasand_likes`)) === 1);
  ok('a like needs words', (await call(rohan, { body: { action: 'like_add', kind: 'shows', text: '   ' } })).status === 400);
  ok('and a kind from the list', (await call(rohan, { body: { action: 'like_add', kind: 'secrets', text: 'x' } })).status === 400);
  r = await call(rohan, { body: { action: 'like_add', kind: 'music', text: 'x'.repeat(61) } });
  ok('61 letters is refused, not cut', r.status === 400 && /up to 60/.test(r.error));
  await call(rohan, { body: { action: 'like_add', kind: 'music', text: 'Old Hindi songs' } });
  await call(rohan, { body: { action: 'like_add', kind: 'food', text: 'Rajma chawal' } });
  const mine = (await get(rohan)).me.likes;
  ok('Rohan sees his three, tidied', mine.length === 3 && mine[0].text === 'Panchayat' && mine.map(l => l.kind).join() === 'shows,music,food');
  ok('Meera cannot remove Rohan\'s like', (await call(meera, { body: { action: 'like_remove', id: likeId } })).status === 404);
  ok('a bad like id is refused', (await call(rohan, { body: { action: 'like_remove', id: 'x' } })).status === 400);
}

// ---- the audience, enforced by the query
{
  let p = await seen(meera, rohan);
  ok('family (the default): Meera sees Rohan\'s likes', p && p.likes.length === 3 && p.name === 'Rohan');
  ok('and so does Papa', (await seen(papa, rohan))?.likes.length === 3);
  ok('another circle sees nobody', (await get(vikram)).people.length === 0);

  let r = await call(rohan, { body: { action: 'audience_set', audience: 'chosen', chosen: [] } });
  ok('"people I choose" needs at least one person', r.status === 400 && /at least one/.test(r.error));
  ok('someone from another circle cannot be chosen', (await call(rohan, { body: { action: 'audience_set', audience: 'chosen', chosen: [vikram.id] } })).status === 400);
  ok('a bad id cannot be chosen', (await call(rohan, { body: { action: 'audience_set', audience: 'chosen', chosen: ['x'] } })).status === 400);
  ok('a made-up audience is refused', (await call(rohan, { body: { action: 'audience_set', audience: 'world' } })).status === 400);
  ok('nothing changed while those were refused', (await seen(papa, rohan))?.likes.length === 3);

  r = await call(rohan, { body: { action: 'audience_set', audience: 'chosen', chosen: [meera.id] } });
  ok('Rohan shares with Meera only', r.status === 200 && r.audience === 'chosen');
  ok('CHOSEN: Meera, who was named, sees them', (await seen(meera, rohan))?.likes.length === 3);
  ok('CHOSEN: Papa, who was not named, sees nothing of Rohan', (await seen(papa, rohan)) === null);
  ok('the pure rule agrees', canSee(rohan.id, { audience: 'chosen', chosen: [meera.id] }, meera.id) && !canSee(rohan.id, { audience: 'chosen', chosen: [meera.id] }, papa.id));
  ok('Rohan still sees his own, and his setting', (await get(rohan)).me.likes.length === 3 && (await get(rohan)).me.chosen.join() === meera.id);

  await call(rohan, { body: { action: 'platform_set', platform: 'prime', on: true } });
  ok('CHOSEN covers platforms too: Meera sees Prime Video, Papa does not', (await seen(meera, rohan)).platforms.map(x => x.platform).join() === 'prime' && (await seen(papa, rohan)) === null);

  await call(rohan, { body: { action: 'audience_set', audience: 'me' } });
  ok('ME: Meera sees nothing', (await seen(meera, rohan)) === null);
  ok('ME: Papa sees nothing', (await seen(papa, rohan)) === null);
  ok('ME: the owner sees everything', (await get(rohan)).me.likes.length === 3 && (await get(rohan)).me.platforms.length === 1 && (await get(rohan)).me.audience === 'me');
  ok('ME: the chosen list is cleared', (await count(`select cardinality(chosen)::int as n from pasand_prefs where member_id = $1`, [rohan.id])) === 0);
  ok('ME: no like of Rohan\'s is in anyone else\'s answer at all', !JSON.stringify(await get(meera)).includes('Panchayat') && !JSON.stringify(await get(papa)).includes('Rajma'));

  await call(rohan, { body: { action: 'audience_set', audience: 'family' } });
  ok('back to family: Papa sees them again', (await seen(papa, rohan))?.likes.length === 3);
  ok('Rohan removes a like', (await call(rohan, { body: { action: 'like_remove', id: likeId } })).status === 200 && (await seen(papa, rohan)).likes.length === 2);
}

// ---- 40 likes each
{
  for (let i = 0; i < 40; i++) await call(papa, { body: { action: 'like_add', kind: 'music', text: 'Song ' + i } });
  const r = await call(papa, { body: { action: 'like_add', kind: 'music', text: 'Song 41' } });
  ok('40 likes is the limit, said plainly', r.status === 400 && /40 likes/.test(r.error) && (await count(`select count(*)::int as n from pasand_likes where member_id = $1`, [papa.id])) === 40);
}

// ---- where I watch and listen: never a password, only a plain https link
{
  let r = await call(meera, { body: { action: 'platform_set', platform: 'netflix', on: true } });
  ok('Meera ticks Netflix', r.status === 200 && (await get(meera)).me.platforms[0].platform === 'netflix' && (await get(meera)).me.platforms[0].link === null);
  ok('a platform that is not on the list is refused', (await call(meera, { body: { action: 'platform_set', platform: 'hbo', on: true } })).status === 400);
  r = await call(meera, { body: { action: 'platform_set', platform: 'spotify', on: true, link: 'https://open.spotify.com/playlist/37i9dQZF1DX0XUfTFmNBRM' } });
  ok('Spotify with a public playlist link', r.status === 200);
  for (const [what, link] of [['http', 'http://open.spotify.com/x'], ['a script link', 'javascript:alert(1)'], ['a bare word', 'my playlist'],
                              ['a sign-in inside the link', 'https://meera:hunter2@netflix.com/'], ['a password in the link', 'https://netflix.com/?password=hunter2'],
                              ['a password typed in the link box', 'password: hunter2'], ['301 letters', 'https://example.com/' + 'a'.repeat(282)],
                              ['a link with words after it', 'https://example.com/list and my pwd hunter2']]) {
    r = await call(meera, { body: { action: 'platform_set', platform: 'youtube', on: true, link } });
    ok('link refused with a reason: ' + what, r.status === 400 && typeof r.error === 'string' && r.error.length > 10, JSON.stringify(r));
  }
  ok('nothing was kept from any refusal', (await count(`select count(*)::int as n from pasand_platforms where platform = 'youtube'`)) === 0);
  r = await call(meera, { body: { action: 'platform_set', platform: 'netflix', on: true, link: 'https://meera:hunter2@netflix.com/' } });
  ok('the reason for a sign-in is the password sentence', r.error === NO_PASSWORD);
  ok('and Netflix stays ticked, with no link', (await get(meera)).me.platforms.find(x => x.platform === 'netflix').link === null);
  await call(meera, { body: { action: 'platform_set', platform: 'spotify', on: true } });
  ok('ticking again without a link keeps the link', /37i9dQ/.test((await get(meera)).me.platforms.find(x => x.platform === 'spotify').link));
  await call(meera, { body: { action: 'platform_set', platform: 'spotify', on: true, link: '' } });
  ok('an empty link clears it', (await get(meera)).me.platforms.find(x => x.platform === 'spotify').link === null);
  ok('Rohan sees where Meera watches', (await seen(rohan, meera)).platforms.map(x => x.platform).join() === 'netflix,spotify');
  await call(meera, { body: { action: 'platform_set', platform: 'spotify', on: false } });
  ok('unticking removes it', (await get(meera)).me.platforms.map(x => x.platform).join() === 'netflix');
  ok('no column anywhere is named for a password', (await count(`select count(*)::int as n from information_schema.columns where table_name like 'pasand_%' and column_name ~* 'pass|secret|token|login|credential'`)) === 0);
}

// ---- a password is refused in every text field
{
  for (const [what, body] of [
    ['a like', { action: 'like_add', kind: 'other', text: 'Netflix password hunter2' }],
    ['a like with a sign-in', { action: 'like_add', kind: 'shows', text: 'login: rohan@example.com' }],
    ['a recommendation title', { action: 'rec_add', title: 'Hotstar pwd hunter2', kind: 'show', toAll: true }],
    ['a recommendation note', { action: 'rec_add', title: 'Panchayat', kind: 'show', note: 'use my account rohan@example.com / hunter22', toAll: true }],
    ['a recommendation link', { action: 'rec_add', title: 'Panchayat', kind: 'show', link: 'https://rohan:hunter2@primevideo.com/', toAll: true }]
  ]) {
    const r = await call(rohan, { body });
    ok('password refused in ' + what, r.status === 400 && r.error === NO_PASSWORD, JSON.stringify(r));
  }
  const r = await call(rohan, { body: { action: 'rec_add', title: 'Pay with 4111 1111 1111 1111', kind: 'other', toAll: true } });
  ok('a card number is refused too, by the notes rule', r.status === 400 && /card number/.test(r.error));
  ok('none of it was kept', (await count(`select count(*)::int as n from pasand_recs`)) === 0 && (await count(`select count(*)::int as n from pasand_likes where text ~* 'hunter|login'`)) === 0);
}

// ---- recommend to one person
let rec;
{
  let r = await call(rohan, { body: { action: 'rec_add', title: '', kind: 'show', to: [meera.id] } });
  ok('a recommendation needs a name', r.status === 400);
  ok('and a kind', (await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'nope', to: [meera.id] } })).status === 400);
  ok('and someone to send it to', (await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show' } })).status === 400);
  ok('a platform must be from the list', (await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show', platform: 'hbo', to: [meera.id] } })).status === 400);
  ok('a title over 80 letters is refused', (await call(rohan, { body: { action: 'rec_add', title: 'x'.repeat(81), kind: 'show', to: [meera.id] } })).status === 400);
  ok('a note over 200 letters is refused', (await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show', note: 'x'.repeat(201), to: [meera.id] } })).status === 400);
  ok('not to someone in another circle', (await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show', to: [vikram.id] } })).status === 400);
  ok('not to yourself', (await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show', to: [rohan.id] } })).status === 400);
  r = await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show', to: [dadi.id] } });
  ok('not to Dadi, who is not on the app, and it says why', r.status === 400 && /Dadi is not on Parwah yet/.test(r.error));
  ok('nothing was made by any of those', (await count(`select count(*)::int as n from pasand_recs`)) === 0);

  r = await call(rohan, { body: { action: 'rec_add', title: 'Panchayat', kind: 'show', platform: 'prime', link: 'https://www.primevideo.com/detail/Panchayat', note: 'You will love Pradhan ji.', to: [meera.id] } });
  ok('Rohan recommends Panchayat to Meera', r.status === 201 && !!r.id && r.to === 1, JSON.stringify(r)); rec = r.id;

  const m = (await get(meera)).forMe;
  ok('Meera has it under For me, with who, where and the note', m.length === 1 && m[0].title === 'Panchayat' && m[0].by_name === 'Rohan' && m[0].platform === 'prime' && m[0].note === 'You will love Pradhan ji.' && m[0].response === null);
  ok('Meera does not get the list of who else it went to', m[0].to === undefined);
  const s = (await get(rohan)).fromMe;
  ok('Rohan has it under From me, with Meera not yet answered', s.length === 1 && s[0].to.length === 1 && s[0].to[0].name === 'Meera' && s[0].to[0].response === null);
  ok('it is not in Rohan\'s For me', (await get(rohan)).forMe.length === 0);
  const p = await get(papa);
  ok('PAPA, not a recipient, cannot read it', p.forMe.length === 0 && p.fromMe.length === 0 && !JSON.stringify(p).includes('Pradhan'));
  ok('another circle cannot read it', !JSON.stringify(await get(vikram)).includes('Panchayat'));
}

// ---- one answer per recipient, changeable
{
  ok('Papa, not a recipient, cannot answer it', (await call(papa, { body: { action: 'rec_respond', id: rec, response: 'loved' } })).status === 404);
  ok('the sender cannot answer their own', (await call(rohan, { body: { action: 'rec_respond', id: rec, response: 'loved' } })).status === 404);
  ok('another circle cannot answer it', (await call(vikram, { body: { action: 'rec_respond', id: rec, response: 'loved' } })).status === 404);
  ok('an answer must be one of the four', (await call(meera, { body: { action: 'rec_respond', id: rec, response: 'hated' } })).status === 400);
  ok('a bad id is refused', (await call(meera, { body: { action: 'rec_respond', id: 'x', response: 'saved' } })).status === 400);
  let r = await call(meera, { body: { action: 'rec_respond', id: rec, response: 'saved', reply: 'This weekend!' } });
  ok('Meera says Will try it', r.status === 200);
  let to = (await get(rohan)).fromMe[0].to[0];
  ok('Rohan sees who answered with what', to.name === 'Meera' && to.response === 'saved' && to.reply === 'This weekend!');
  r = await call(meera, { body: { action: 'rec_respond', id: rec, response: 'loved', reply: 'Watched it all in two days.' } });
  to = (await get(rohan)).fromMe[0].to[0];
  ok('Meera changes her answer to Loved it', r.status === 200 && to.response === 'loved' && /two days/.test(to.reply));
  ok('still one answer row for her', (await count(`select count(*)::int as n from pasand_rec_to where rec_id = $1`, [rec])) === 1);
  ok('her own view shows her answer', (await get(meera)).forMe[0].response === 'loved');
  r = await call(meera, { body: { action: 'rec_respond', id: rec, response: 'loved', reply: 'my password is hunter2' } });
  ok('a password in a reply is refused, and the old reply stays', r.status === 400 && r.error === NO_PASSWORD && /two days/.test((await get(rohan)).fromMe[0].to[0].reply));
  ok('a reply over 200 letters is refused', (await call(meera, { body: { action: 'rec_respond', id: rec, response: 'loved', reply: 'x'.repeat(201) } })).status === 400);
  await call(meera, { body: { action: 'rec_respond', id: rec, response: 'done' } });
  ok('an answer with no reply clears the reply', (await get(rohan)).fromMe[0].to[0].reply === null && (await get(rohan)).fromMe[0].to[0].response === 'done');
}

// ---- the whole circle
let recAll;
{
  const r = await call(meera, { body: { action: 'rec_add', title: 'Kishore Kumar hits', kind: 'album', platform: 'jiosaavn', toAll: true } });
  ok('Meera recommends an album to the whole family', r.status === 201 && r.to === 2, JSON.stringify(r)); recAll = r.id;
  ok('it goes to Rohan and Papa, who are on the app, not to Dadi and not to herself',
     (await admin.query(`select member_id from pasand_rec_to where rec_id = $1`, [recAll])).rows.map(x => x.member_id).sort().join() === [rohan.id, papa.id].sort().join());
  ok('Rohan and Papa both have it', (await get(rohan)).forMe[0].title === 'Kishore Kumar hits' && (await get(papa)).forMe[0].title === 'Kishore Kumar hits' && (await get(papa)).forMe[0].toAll === true);
  await call(papa, { body: { action: 'rec_respond', id: recAll, response: 'loved' } });
  await call(rohan, { body: { action: 'rec_respond', id: recAll, response: 'pass' } });
  const to = (await get(meera)).fromMe[0].to;
  ok('each recipient has their own answer', to.length === 2 && to.find(t => t.name === 'Papa').response === 'loved' && to.find(t => t.name === 'Rohan').response === 'pass');
  ok('Papa does not see Rohan\'s answer', !JSON.stringify((await get(papa)).forMe).includes('pass'));
  const solo = await call(vikram, { body: { action: 'rec_add', title: 'Sholay', kind: 'film', toAll: true } });
  ok('with nobody else in the group, it says so', solo.status === 400 && /Nobody else/.test(solo.error));
}

// ---- removal
{
  ok('a recipient cannot remove it', (await call(meera, { body: { action: 'rec_remove', id: rec } })).status === 404);
  ok('Papa cannot remove it', (await call(papa, { body: { action: 'rec_remove', id: rec } })).status === 404);
  ok('another circle cannot remove it', (await call(vikram, { body: { action: 'rec_remove', id: rec } })).status === 404);
  ok('it is still there', (await get(meera)).forMe.some(x => x.id === rec));
  ok('the sender removes it', (await call(rohan, { body: { action: 'rec_remove', id: rec } })).status === 200);
  ok('it is gone for the recipient, with its answers', !(await get(meera)).forMe.some(x => x.id === rec) && (await count(`select count(*)::int as n from pasand_rec_to where rec_id = $1`, [rec])) === 0);
  ok('removing it twice says it is gone', (await call(rohan, { body: { action: 'rec_remove', id: rec } })).status === 404);
  ok('the other recommendation is untouched', (await get(rohan)).forMe.some(x => x.id === recAll));
}

// ---- a sensible limit on sending
{
  // Rohan has made 1 so far this hour; the limit is 20.
  let last;
  for (let i = 0; i < PASAND_MAX.perHour - 1; i++) last = await call(rohan, { body: { action: 'rec_add', title: 'Song ' + i, kind: 'song', to: [meera.id] } });
  ok('twenty in an hour go through', last.status === 201);
  const r = await call(rohan, { body: { action: 'rec_add', title: 'One too many', kind: 'song', to: [meera.id] } });
  ok('the twenty-first is held back, said plainly', r.status === 429 && /Try again later/.test(r.error) && (await count(`select count(*)::int as n from pasand_recs where title = 'One too many'`)) === 0);
  ok('a refused one (bad input) does not use up the limit', (await call(papa, { body: { action: 'rec_add', title: '', kind: 'song', to: [meera.id] } })).status === 400
     && (await count(`select count(*)::int as n from rate_limit where bucket = 'pasand_rec' and k = $1`, [papa.id])) === 0);
}

// ---- a member who leaves takes their likes and what they sent
{
  await admin.query(`delete from members where id = $1`, [meera.id]);
  ok('when Meera leaves, her likes, platforms and recommendations go with her',
     (await count(`select count(*)::int as n from pasand_platforms where member_id = $1`, [meera.id])) === 0
     && (await count(`select count(*)::int as n from pasand_recs where id = $1`, [recAll])) === 0
     && (await count(`select count(*)::int as n from pasand_rec_to where member_id = $1`, [meera.id])) === 0);
  ok('and Rohan\'s page still loads', (await get(rohan)).status === 200);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error('pasand.dbtest: ' + fails.length + ' FAILED of ' + (pass + fails.length) + '\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('pasand.dbtest: ' + pass + '/' + pass + ' checks pass');
