// NOTES AND CHECKLISTS AGAINST A REAL DATABASE: the real handler behind
// /api/book?area=notes, the real schema and SQL.
//
// What it proves: a family list is the family's and nobody else's; ticking
// and adding at the same moment never undoes someone else; a private note
// is invisible to everyone else, server side; a note never keeps a card
// number or a banking secret, and happily keeps a phone number or a wifi
// password.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('notes.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('notes.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: book } = await import('../../../api/book.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function user(name) {
  const phone = '+9198400' + String(++n).padStart(5, '0');
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
const U = { rohan: await user('Rohan'), meera: await user('Meera'), vikram: await user('Vikram') };
const rohan = await seat(fam, 'SHARMA', U.rohan), meera = await seat(fam, 'SHARMA', U.meera);
const rohanG = await seat(grp, 'COUSIN', U.rohan), vikramG = await seat(grp, 'COUSIN', U.vikram);


async function call(who, { method = 'POST', body = {} } = {}) {
  const req = { method, headers: { 'x-parwah-token': who.token },
                query: { area: 'notes', circle: who.code, member: who.id },
                body: { area: 'notes', code: who.code, memberId: who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await book(req, res);
  return { ...json, status };
}
const notes = async (who) => (await call(who, { method: 'GET' })).notes || [];
const note = async (who, id) => (await notes(who)).find(n => n.id === id);

// ---- a family list
let list;
{
  let r = await call(rohan, { body: { action: 'add', title: '  ' } });
  ok('a note needs a title', r.status === 400 && /title/.test(r.error));
  r = await call(rohan, { body: { action: 'add', title: 'Groceries', items: ['Atta 5 kg', 'Milk', '', 'Haldi'] } });
  ok('Rohan starts a grocery list', r.status === 201 && !!r.id);
  list = r.id;
  const m = await note(meera, list);
  ok('Meera sees it, with its three items, none ticked', m && m.items.length === 3 && m.items.every(i => !i.done) && m.items.map(i => i.t).join() === 'Atta 5 kg,Milk,Haldi');
  ok('the family is told a list was started', (await admin.query(`select count(*)::int as n from events where text = 'Rohan started a list: Groceries'`)).rows[0].n === 1);
  ok('nobody in another group sees it', (await notes(vikramG)).length === 0 && (await notes(rohanG)).length === 0);
  ok('and nobody outside can touch it', (await call(vikramG, { body: { action: 'remove', id: list } })).status === 404);
}

// ---- ticking at the same moment never undoes the other
{
  const items = (await note(meera, list)).items;
  await Promise.all([
    call(meera, { body: { action: 'item_toggle', id: list, itemId: items[0].id, done: true } }),
    call(rohan, { body: { action: 'item_toggle', id: list, itemId: items[2].id, done: true } }),
    call(meera, { body: { action: 'item_add', id: list, text: 'Eggs' } }),
    call(rohan, { body: { action: 'item_add', id: list, text: 'Bread' } })
  ]);
  const n = await note(rohan, list);
  ok('two ticks and two additions at once: all four land', n.items.length === 5 && n.items[0].done && !n.items[1].done && n.items[2].done
     && n.items.some(i => i.t === 'Eggs') && n.items.some(i => i.t === 'Bread'), JSON.stringify(n.items.map(i => [i.t, i.done])));
  ok('the order stays as written', n.items.slice(0, 3).map(i => i.t).join() === 'Atta 5 kg,Milk,Haldi');
  ok('a tick says who ticked it', n.items[0].by === 'Meera' && n.items[2].by === 'Rohan');
  await call(meera, { body: { action: 'item_toggle', id: list, itemId: items[0].id, done: false } });
  ok('and can be unticked', !(await note(rohan, list)).items[0].done);
  await call(meera, { body: { action: 'item_remove', id: list, itemId: items[1].id } });
  ok('an item can be removed', !(await note(rohan, list)).items.some(i => i.t === 'Milk'));
  ok('a missing item says so', (await call(meera, { body: { action: 'item_toggle', id: list, itemId: items[1].id, done: true } })).status === 404);
  ok('an empty item is refused', (await call(meera, { body: { action: 'item_add', id: list, text: '  ' } })).status === 400);
  ok('the last change says who made it', (await note(rohan, list)).updated_name === 'Meera');
}

// ---- a private note
{
  const r = await call(meera, { body: { action: 'add', title: 'Gift ideas for Rohan', body: 'Running shoes, size 9', private: true } });
  ok('Meera keeps a private note', r.status === 201);
  ok('only she sees it', !!(await note(meera, r.id)) && !(await note(rohan, r.id)));
  ok('Rohan cannot change or remove it, or even learn it exists', (await call(rohan, { body: { action: 'edit', id: r.id, title: 'x' } })).status === 404
     && (await call(rohan, { body: { action: 'remove', id: r.id } })).status === 404);
  ok('and the family is not told about it', (await admin.query(`select count(*)::int as n from events where text like '%Gift ideas%'`)).rows[0].n === 0);
}

// ---- edit, pin, remove
{
  await call(meera, { body: { action: 'edit', id: list, title: 'Groceries for Sunday', body: 'From the shop near the temple' } });
  const n = await note(rohan, list);
  ok('a family note can be changed by anyone in it', n.title === 'Groceries for Sunday' && n.body === 'From the shop near the temple');
  ok('a title cannot be emptied', (await call(meera, { body: { action: 'edit', id: list, title: '' } })).status === 400);
  const other = await call(rohan, { body: { action: 'add', title: 'Packing for Goa' } });
  await call(rohan, { body: { action: 'pin', id: list, pinned: true } });
  ok('a pinned note comes first', (await notes(meera))[0].id === list);
  await call(rohan, { body: { action: 'remove', id: other.id } });
  ok('a note can be removed', !(await note(meera, other.id)));
}

// ---- what a note will not keep
{
  const card = await call(rohan, { body: { action: 'add', title: 'Cards', body: 'HDFC 4111 1111 1111 1111' } });
  ok('a full card number is refused', card.status === 400 && /card number/.test(card.error));
  const otp = await call(rohan, { body: { action: 'item_add', id: list, text: 'OTP 482913' } });
  ok('an OTP is refused', otp.status === 400);
  const fine = await call(rohan, { body: { action: 'add', title: "Dadi's flat", body: 'Wifi password: Ghar@123. PIN code 110048. Plumber +91 98100 12345.' } });
  ok('a wifi password, a PIN code and a phone number are fine', fine.status === 201, JSON.stringify(fine));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`notes.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`notes.dbtest: ${pass}/${pass} checks pass`);
