// YAADON KI ALBUM AGAINST A REAL DATABASE: the real handler behind
// /api/book?area=album, the real schema and SQL.
//
// What it proves: only a JPEG is kept (a PNG, a renamed PNG, a file that is
// too big, too wide or still carries camera details is refused, whatever
// the sender calls it); a photo goes to exactly the people its album is for
// and that is the server's answer for the list AND for the bytes, the
// thumbnail included, fetched by direct id; another circle sees nothing;
// who may change or remove a photo; a tagged person takes off their own
// name and nobody else's; the 400 cap, the 6 a request cap and the 60 an
// hour limit; and the one older photo a week on Today.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('album.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('album.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: book } = await import('../../../api/book.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { albumGetBytes, albumPutBytes } = await import('../../../api/_album.mjs');
const R = await import('../../../api/_albumrules.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function user(name) {
  const phone = '+9198455' + String(++n).padStart(5, '0');
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
const U = { asha: await user('Asha'), rohan: await user('Rohan'), papa: await user('Papa'), vikram: await user('Vikram') };
const asha = await seat(fam, 'SHARMA', U.asha), rohan = await seat(fam, 'SHARMA', U.rohan), papa = await seat(fam, 'SHARMA', U.papa);
const vikram = await seat(grp, 'COUSIN', U.vikram);
// Nani is in the family by name only: she never signs in, and she is in the old photos.
const nani = (await admin.query(`insert into members (circle_id, name) values ($1,'Nani') returning id`, [fam])).rows[0];

// The handler, called the way Vercel calls it. A photo comes back as bytes
// through res.end, everything else as JSON.
async function call(who, { method = 'POST', body = {}, query = {}, as = null, headers = {} } = {}) {
  const req = { method, headers: { 'x-parwah-token': who.token, 'x-parwah-tz': 'Asia/Kolkata', ...headers },
                query: { area: 'album', circle: who.code, member: as || who.id, ...query },
                body: { area: 'album', code: who.code, memberId: as || who.id, ...body } };
  let status = 200, json = null, bytes = null; const head = {};
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; },
                setHeader(k, v) { head[k.toLowerCase()] = v; return this; }, end(b) { bytes = b || Buffer.alloc(0); return this; } };
  await book(req, res);
  return { ...(json || {}), status, bytes, head, isJson: json !== null };
}
const get = (who, query = {}) => call(who, { method: 'GET', query });
const img = (who, id, size = 'thumb', headers = {}) => call(who, { method: 'GET', query: { view: 'photo', id, size }, headers });
const count = async (q, p) => (await admin.query(q, p)).rows[0].n;

// A JPEG put together by hand, so each part can be changed.
function makeJpeg({ w = 1600, h = 1200, exif = false, size = 0 } = {}) {
  const parts = [[0xFF, 0xD8], [0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]];
  if (exif) parts.push([0xFF, 0xE1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8]);
  parts.push([0xFF, 0xC0, 0x00, 0x0B, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  parts.push([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0]);
  const head = parts.flat();
  const fill = Math.max(4, size - head.length - 2);
  return Buffer.from([...head, ...new Array(fill).fill(0x11), 0xFF, 0xD9]);
}
const b64 = (buf) => Buffer.from(buf).toString('base64');
const PHOTO = b64(makeJpeg({ w: 1600, h: 1200, size: 5000 }));
const THUMB = b64(makeJpeg({ w: 320, h: 240, size: 900 }));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAARUlEQVR4AdyQsQ0AIAgEP4zhAG7kAE7mAJZu4zLYf4EFJCSQXEHzf3nR09SDwHnxAXcOWLBwvAE3/P6KBn1tWPAm+Rs8AAAA//+TOT/gAAAABklEQVQDAAgDRMkHPQ3NAAAAAElFTkSuQmCC';
const one = (extra = {}) => ({ photo: PHOTO, thumb: THUMB, ...extra });
const add = (who, albumId, extra = {}, photos = [one()]) => call(who, { body: { action: 'photo_add', albumId, photos, ...extra } });
const clearRate = () => admin.query(`delete from rate_limit where bucket = 'album_up'`);

// ---- the route, and an empty start
let famAlbum;
{
  const r = await get(asha);
  ok('GET answers with an empty album and the count', r.status === 200 && r.ok && r.photos.length === 0 && r.count === 0 && r.cap === 400 && r.left === 400 && r.near === false && r.full === false, JSON.stringify(r).slice(0, 300));
  ok('there is always one album for everyone: Our family', r.albums.length === 1 && r.albums[0].name === 'Our family' && r.albums[0].isDefault && r.albums[0].audience === 'family' && r.albums[0].count === 0);
  famAlbum = r.albums[0].id;
  ok('asked twice, it is still one', (await get(rohan)).albums.length === 1 && (await count(`select count(*)::int as n from album_albums where circle_id = $1`, [fam])) === 1);
  ok('a group gets "Our group"', (await get(vikram)).albums[0].name === 'Our group');
  ok('the members to tick include Nani, who is not on the app', r.members.some(m => m.id === nani.id && m.on_app === false) && r.members.length === 4);
  ok('the limits travel with the answer, so the app and the server agree', r.max.photoBytes === 600000 && r.max.thumbBytes === 40000 && r.max.photoSide === 1600 && r.max.thumbSide === 320 && r.max.perRequest === 6);
  ok('the five tables exist', (await count(`select count(*)::int as n from information_schema.tables where table_name in ('album_albums','album_photos','album_people','album_bytes','album_weeks')`)) === 5);
  ok('the bytes are stored as they are, not packed again', (await count(`select count(*)::int as n from pg_attribute where attrelid = 'album_bytes'::regclass and attname in ('photo','thumb') and attstorage = 'e'`)) === 2);
  // Health and contacts still answers on the same route.
  let status = 200, json = null;
  await book({ method: 'GET', headers: { 'x-parwah-token': asha.token }, query: { circle: 'SHARMA', member: asha.id }, body: {} },
             { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} });
  ok('Health and contacts still answers on the same route', status === 200 && json.ok && Array.isArray(json.entries));
}

// ---- who is asking
{
  ok('no token: sign in', (await call({ ...asha, token: '' }, { method: 'GET' })).status === 401);
  ok('Rohan cannot ask as Asha', (await call(rohan, { method: 'GET', as: asha.id })).status === 403);
  ok('Rohan cannot add as Asha', (await call(rohan, { as: asha.id, body: { action: 'photo_add', albumId: famAlbum, photos: [one()] } })).status === 403);
  ok('an outsider with the family code and a member id is refused', (await call({ ...vikram, code: 'SHARMA' }, { method: 'GET', as: asha.id })).status === 403);
  ok('an outsider with the family code and their own id is refused', (await call({ ...vikram, code: 'SHARMA' }, { method: 'GET' })).status === 403);
  ok('nobody signs in as Nani, who is not on the app', (await call(asha, { method: 'GET', as: nani.id })).status === 403);
  ok('a code that is no family is not found', (await call({ ...vikram, code: 'NOPE99' }, { method: 'GET' })).status === 404);
  ok('only GET and POST', (await call(asha, { method: 'DELETE' })).status === 405);
  ok('an unknown action and an unknown view are refused', (await call(asha, { body: { action: 'drop_everything' } })).status === 400 && (await get(asha, { view: 'everything' })).status === 400);
  ok('nothing was kept while those were refused', (await count(`select count(*)::int as n from album_photos`)) === 0);
}

// ---- only a JPEG is kept, whatever it is called
{
  let r = await add(asha, famAlbum, {}, [{ photo: PNG, thumb: THUMB }]);
  ok('A PNG IS REFUSED, in plain words', r.status === 400 && /not a JPEG/.test(r.error), r.error);
  r = await add(asha, famAlbum, {}, [{ photo: 'data:image/jpeg;base64,' + PNG, thumb: THUMB, type: 'image/jpeg', name: 'holiday.jpg', mime: 'image/jpeg' }]);
  ok('A PNG RENAMED TO .jpg AND CALLED image/jpeg IS REFUSED: the bytes are read, not the label', r.status === 400 && /not a JPEG/.test(r.error), r.error);
  r = await add(asha, famAlbum, {}, [{ photo: PHOTO, thumb: PNG }]);
  ok('a PNG as the thumbnail is refused too', r.status === 400 && /small preview is not a JPEG/.test(r.error), r.error);
  r = await add(asha, famAlbum, {}, [{ photo: b64(Buffer.from('<script>alert(1)</script>')), thumb: THUMB }]);
  ok('a page of script is not a picture', r.status === 400 && /not a JPEG/.test(r.error));
  r = await add(asha, famAlbum, {}, [{ photo: b64(Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.from(PNG, 'base64')])), thumb: THUMB }]);
  ok('a PNG with a JPEG start glued on is refused', r.status === 400 && /not a JPEG/.test(r.error));
  r = await add(asha, famAlbum, {}, [{ photo: 'not base64 at all!', thumb: THUMB }]);
  ok('something that is not base64 is refused', r.status === 400 && /could not be read/.test(r.error));
  r = await add(asha, famAlbum, {}, [{ photo: PHOTO }]);
  ok('a photo with no thumbnail is refused', r.status === 400);
  r = await add(asha, famAlbum, {}, [{ photo: b64(makeJpeg({ size: 600001 })), thumb: THUMB }]);
  ok('A PHOTO OVER 600 KB IS REFUSED', r.status === 413 && /larger than 600 KB/.test(r.error), r.error);
  r = await add(asha, famAlbum, {}, [{ photo: PHOTO, thumb: b64(makeJpeg({ w: 320, h: 240, size: 40001 })) }]);
  ok('A THUMBNAIL OVER 40 KB IS REFUSED', r.status === 413 && /larger than 40 KB/.test(r.error), r.error);
  r = await add(asha, famAlbum, {}, [{ photo: b64(makeJpeg({ w: 4000, h: 3000, size: 9000 })), thumb: THUMB }]);
  ok('a photo that was never made smaller (4000 wide) is refused', r.status === 400 && /wider or taller than 1600/.test(r.error));
  r = await add(asha, famAlbum, {}, [{ photo: PHOTO, thumb: PHOTO }]);
  ok('a full photo sent as the thumbnail is refused', r.status === 400 && /wider or taller than 320/.test(r.error));
  r = await add(asha, famAlbum, {}, [{ photo: b64(makeJpeg({ exif: true, size: 5000 })), thumb: THUMB }]);
  ok('A PHOTO THAT STILL CARRIES CAMERA DETAILS (where it was taken) IS REFUSED', r.status === 400 && /where it was taken/.test(r.error), r.error);
  r = await add(asha, famAlbum, {}, []);
  ok('no photo at all is refused', r.status === 400 && /Choose a photo/.test(r.error));
  ok('NOTHING was kept from any of those', (await count(`select count(*)::int as n from album_photos`)) === 0 && (await count(`select count(*)::int as n from album_bytes`)) === 0);
  ok('exactly 600,000 and 40,000 bytes are kept', (await add(asha, famAlbum, {}, [{ photo: b64(makeJpeg({ size: 600000 })), thumb: b64(makeJpeg({ w: 320, h: 240, size: 40000 })) }])).status === 201);
  const row = (await admin.query(`select p.photo_bytes, p.thumb_bytes, p.width, p.height, octet_length(b.photo) as pl, octet_length(b.thumb) as tl from album_photos p join album_bytes b on b.photo_id = p.id`)).rows[0];
  ok('and the row says what was stored: its size and its pixels', row.photo_bytes === 600000 && row.thumb_bytes === 40000 && row.pl === 600000 && row.tl === 40000 && row.width === 1600 && row.height === 1200, JSON.stringify(row));
  await admin.query(`delete from album_photos`);
}

// ---- adding, with a caption, the people in it and the year
let p1;
{
  let r = await add(asha, famAlbum, { caption: '  Diwali   at Nani\'s house ', year: '1987', people: [nani.id, rohan.id] });
  ok('Asha adds a photo to the family album', r.status === 201 && r.ids.length === 1 && r.count === 1 && r.left === 399, JSON.stringify(r));
  p1 = r.ids[0];
  const p = (await get(asha)).photos[0];
  ok('with its caption tidied, the year and who is in it', p.caption === 'Diwali at Nani\'s house' && p.year === 1987 && p.people.map(x => x.name).join() === 'Nani,Rohan' && p.byName === 'Asha' && p.albumName === 'Our family', JSON.stringify(p));
  ok('alt text is built from the caption and the people', p.alt === 'Diwali at Nani\'s house. With Nani and Rohan, 1987');
  ok('Nani, who is not on the app, can be in a photo', p.people.some(x => x.id === nani.id));
  ok('the adder can change it; a tagged person is told they are in it', p.canChange === true && (await get(rohan)).photos[0].taggedMe === true && (await get(rohan)).photos[0].canChange === false);
  ok('the family feed hears about it', (await count(`select count(*)::int as n from events where circle_id = $1 and text like 'Asha added a photo to Our family%'`, [fam])) >= 1);

  r = await add(asha, famAlbum, { caption: 'x'.repeat(201) });
  ok('a caption of 201 letters is refused, not cut', r.status === 400 && /up to 200 letters/.test(r.error));
  ok('exactly 200 is kept', (await add(asha, famAlbum, { caption: 'y'.repeat(200) })).status === 201);
  r = await add(asha, famAlbum, { caption: 'Papa card 4111 1111 1111 1111' });
  ok('a card number in a caption is refused (noteRisk)', r.status === 400 && /card number/.test(r.error), r.error);
  r = await add(asha, famAlbum, { caption: 'the OTP is 482913' });
  ok('so is an OTP', r.status === 400 && /OTP/.test(r.error));
  ok('a year before 1900 or after this one is refused', (await add(asha, famAlbum, { year: 1899 })).status === 400 && (await add(asha, famAlbum, { year: new Date().getFullYear() + 1 })).status === 400);
  ok('a year that is not a year is refused', (await add(asha, famAlbum, { year: 'long ago' })).status === 400);
  ok('1900 is fine: old scanned photos are the point', (await add(asha, famAlbum, { year: 1900 })).status === 201);
  ok('someone from another circle cannot be put in a photo', (await add(asha, famAlbum, { people: [vikram.id] })).status === 400);
  ok('a bad person id is refused', (await add(asha, famAlbum, { people: ['x'] })).status === 400);
  ok('a bad album id, or one from another circle, is not found', (await add(asha, 'x')).status === 404 && (await add(asha, (await get(vikram)).albums[0].id)).status === 404);
  ok('anyone in the circle can add to a family album', (await add(papa, famAlbum, { caption: 'Papa at the shop', year: 1979, people: [papa.id] })).status === 201);
  ok('three good photos and Papa\'s are there; nothing from the refusals', (await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])) === 4);
  const order = (await get(asha)).photos;
  ok('newest first', order[0].caption === 'Papa at the shop' && order[order.length - 1].id === p1);
}

// ---- the bytes: through the signed-in route only, private, never cached for others
{
  const t = await img(asha, p1, 'thumb');
  ok('the thumbnail comes back as the bytes that went in', t.status === 200 && !t.isJson && Buffer.compare(t.bytes, Buffer.from(THUMB, 'base64')) === 0);
  const f = await img(asha, p1, 'full');
  ok('and so does the photo', f.status === 200 && Buffer.compare(f.bytes, Buffer.from(PHOTO, 'base64')) === 0);
  ok('served as image/jpeg, stated by the server', f.head['content-type'] === 'image/jpeg' && f.head['x-content-type-options'] === 'nosniff' && f.head['content-length'] === String(f.bytes.length));
  ok('Cache-Control is private, and asked for again each time', /^private\b/.test(f.head['cache-control']) && /no-cache/.test(f.head['cache-control']) && !/public/.test(f.head['cache-control']), f.head['cache-control']);
  ok('and it varies by who is signed in', /x-parwah-token/i.test(f.head.vary || ''));
  ok('with no size named, the small one is sent', (await call(asha, { method: 'GET', query: { view: 'photo', id: p1 } })).bytes.length === Buffer.from(THUMB, 'base64').length);
  const again = await img(asha, p1, 'full', { 'if-none-match': f.head.etag });
  ok('an unchanged photo is "you already have it", with no bytes', again.status === 304 && again.bytes.length === 0 && /^private/.test(again.head['cache-control']));
  ok('no token: no photo', (await img({ ...asha, token: '' }, p1)).status === 401 && (await img({ ...asha, token: '' }, p1)).bytes === null);
  ok('a signed-in member of the family can open a family photo', (await img(papa, p1, 'full')).status === 200);
  ok('AN OUTSIDER CANNOT LIST: another circle sees no photos of this family', (await get(vikram)).photos.length === 0 && (await get(vikram)).count === 0);
  const o1 = await img(vikram, p1, 'full'), o2 = await img(vikram, p1, 'thumb');
  ok('AN OUTSIDER CANNOT FETCH THE BYTES by id, photo or thumbnail', o1.status === 404 && o1.bytes === null && o2.status === 404 && o2.bytes === null, o1.status + ' ' + o2.status);
  const o3 = await img({ ...vikram, code: 'SHARMA' }, p1, 'full');
  ok('nor with the family\'s code', o3.status === 403 && o3.bytes === null);
  const o4 = await img(vikram, p1, 'full', { 'if-none-match': f.head.etag });
  ok('nor by claiming to have it already', o4.status === 404 && o4.bytes === null);
  ok('a bad id or one that is not there is not found, in the same words', (await img(asha, 'x')).status === 404 && (await img(asha, '00000000-0000-4000-8000-000000000000')).error === (await img(vikram, p1)).error);
  ok('the two byte functions agree with the route', Buffer.compare(await albumGetBytes(db(), fam, asha.id, p1, 'full'), Buffer.from(PHOTO, 'base64')) === 0
     && (await albumGetBytes(db(), grp, vikram.id, p1, 'full')) === null);
}

// ---- albums and their audience, enforced by the query
let onlyMe, chosenAlbum, mePhoto, chosenPhoto;
{
  let r = await call(asha, { body: { action: 'album_save', name: '   ', audience: 'family' } });
  ok('an album needs a name', r.status === 400 && /Give the album a name/.test(r.error));
  ok('a name of 61 letters is refused', (await call(asha, { body: { action: 'album_save', name: 'x'.repeat(61), audience: 'family' } })).status === 400);
  ok('a made-up audience is refused', (await call(asha, { body: { action: 'album_save', name: 'Trip', audience: 'world' } })).status === 400);
  ok('"people I choose" needs at least one person', /at least one/.test((await call(asha, { body: { action: 'album_save', name: 'Trip', audience: 'chosen', chosen: [] } })).error));
  ok('someone from another circle cannot be chosen', (await call(asha, { body: { action: 'album_save', name: 'Trip', audience: 'chosen', chosen: [vikram.id] } })).status === 400);
  r = await call(asha, { body: { action: 'album_save', name: 'Trip', audience: 'chosen', chosen: [nani.id] } });
  ok('someone who is not on Parwah cannot be chosen, and it says why', r.status === 400 && /Nani is not on Parwah yet/.test(r.error));
  // Someone marked as remembered cannot be chosen for an album, but can still be named in a photo.
  await admin.query(`alter table members add column if not exists remembered boolean not null default false`);
  await admin.query(`update members set remembered = true where id = $1`, [papa.id]);
  r = await call(asha, { body: { action: 'album_save', name: 'Trip', audience: 'chosen', chosen: [rohan.id, papa.id] } });
  ok('someone marked as remembered cannot be chosen for an album, and it says why', r.status === 400 && r.error === 'Papa is remembered here, so cannot be chosen.', JSON.stringify(r));
  ok('but can still be tagged in a photo: that is what an album is for', await (async () => { const x = await add(asha, famAlbum, { caption: 'Papa, long ago', people: [papa.id] });
    const ok2 = x.status === 201 && (await count(`select count(*)::int as n from album_people where photo_id = $1 and member_id = $2`, [x.ids[0], papa.id])) === 1;
    await call(asha, { body: { action: 'photo_remove', id: x.ids[0] } }); return ok2; })());
  await admin.query(`update members set remembered = false where id = $1`, [papa.id]);
  ok('a date that has not come is refused', (await call(asha, { body: { action: 'album_save', name: 'Trip', audience: 'family', date: '2999-01-01' } })).status === 400);
  ok('nothing was made while those were refused', (await count(`select count(*)::int as n from album_albums where circle_id = $1`, [fam])) === 1);

  r = await call(asha, { body: { action: 'album_save', name: 'Just for me', audience: 'me', year: 2001 } });
  ok('Asha makes an "only me" album, with a year', r.status === 201 && !!r.id); onlyMe = r.id;
  r = await call(asha, { body: { action: 'album_save', name: 'Shimla 2019', audience: 'chosen', chosen: [rohan.id], date: '2019-06-14' } });
  ok('and a "people I choose" album for Rohan, with a date', r.status === 201); chosenAlbum = r.id;
  const mine = (await get(asha)).albums;
  ok('Asha sees all three, the family one first', mine.length === 3 && mine[0].isDefault && mine.find(a => a.id === chosenAlbum).date === '2019-06-14' && mine.find(a => a.id === onlyMe).year === 2001 && mine.find(a => a.id === chosenAlbum).chosen.join() === rohan.id);
  ok('ROHAN, who was chosen, sees two; who else was chosen is not told to him', (await get(rohan)).albums.map(a => a.name).sort().join() === 'Our family,Shimla 2019' && (await get(rohan)).albums.find(a => a.id === chosenAlbum).chosen.length === 0);
  ok('PAPA, who was not, sees only the family album', (await get(papa)).albums.map(a => a.name).join() === 'Our family');

  mePhoto = (await add(asha, onlyMe, { caption: 'A letter I kept', people: [rohan.id] })).ids[0];
  chosenPhoto = (await add(asha, chosenAlbum, { caption: 'On the Mall Road', people: [rohan.id, papa.id] })).ids[0];
  ok('Asha adds a photo to each', !!mePhoto && !!chosenPhoto);
  ok('a private album stays out of the family feed', (await count(`select count(*)::int as n from events where text like '%Just for me%' or text like '%Shimla%'`)) === 0);

  // the list
  const lists = { rohan: await get(rohan), papa: await get(papa), vikram: await get(vikram) };
  ok('ONLY ME: the photo is in nobody else\'s list', !lists.rohan.photos.some(p => p.id === mePhoto) && !lists.papa.photos.some(p => p.id === mePhoto) && !JSON.stringify(lists.rohan).includes('A letter I kept') && !JSON.stringify(lists.papa).includes('A letter I kept'));
  ok('PEOPLE I CHOOSE: in Rohan\'s list, not in Papa\'s', lists.rohan.photos.some(p => p.id === chosenPhoto) && !lists.papa.photos.some(p => p.id === chosenPhoto) && !JSON.stringify(lists.papa).includes('Mall Road'));
  ok('asking for the album by id does not open it', (await get(papa, { album: chosenAlbum })).photos.length === 0 && (await get(rohan, { album: onlyMe })).photos.length === 0);
  ok('nor does asking by person: Papa is tagged in a photo he may not see', !(await get(papa, { person: papa.id })).photos.some(p => p.id === chosenPhoto)
     && !(await get(rohan, { person: rohan.id })).photos.some(p => p.id === mePhoto));

  // the bytes, by direct id
  for (const [who, name] of [[rohan, 'Rohan (tagged in it)'], [papa, 'Papa'], [vikram, 'an outsider']]) {
    const a = await img(who, mePhoto, 'full'), b = await img(who, mePhoto, 'thumb');
    ok('ONLY ME: ' + name + ' cannot fetch the photo or the thumbnail by direct id', a.status === 404 && a.bytes === null && b.status === 404 && b.bytes === null, a.status + ' ' + b.status);
  }
  for (const [who, name] of [[papa, 'Papa (tagged in it)'], [vikram, 'an outsider']]) {
    const a = await img(who, chosenPhoto, 'full'), b = await img(who, chosenPhoto, 'thumb');
    ok('PEOPLE I CHOOSE: ' + name + ' cannot fetch the photo or the thumbnail by direct id', a.status === 404 && a.bytes === null && b.status === 404 && b.bytes === null, a.status + ' ' + b.status);
  }
  const etag = (await img(asha, mePhoto, 'full')).head.etag;
  ok('claiming to have it already does not get round it', (await img(rohan, mePhoto, 'full', { 'if-none-match': etag })).status === 404 && (await img(papa, chosenPhoto, 'full', { 'if-none-match': '"ab-' + chosenPhoto + '-full"' })).status === 404);
  ok('the byte function itself says no, with no route in front of it', (await albumGetBytes(db(), fam, rohan.id, mePhoto, 'full')) === null && (await albumGetBytes(db(), fam, rohan.id, mePhoto, 'thumb')) === null
     && (await albumGetBytes(db(), fam, papa.id, chosenPhoto, 'full')) === null && (await albumGetBytes(db(), fam, papa.id, chosenPhoto, 'thumb')) === null);
  ok('the maker opens both', (await img(asha, mePhoto, 'full')).status === 200 && (await img(asha, chosenPhoto, 'thumb')).status === 200);
  ok('the chosen person opens the chosen one, photo and thumbnail', (await img(rohan, chosenPhoto, 'full')).status === 200 && (await img(rohan, chosenPhoto, 'thumb')).status === 200);
  ok('the pure rule agrees with the query', R.albumCanSee({ audience: 'chosen', chosen: [rohan.id], by_member: asha.id }, rohan.id) && !R.albumCanSee({ audience: 'chosen', chosen: [rohan.id], by_member: asha.id }, papa.id)
     && !R.albumCanSee({ audience: 'me', chosen: [], by_member: asha.id }, rohan.id));

  // who may add, change, remove in a private album
  ok('Papa cannot add to an album that is not for him', (await add(papa, chosenAlbum)).status === 404 && (await add(rohan, onlyMe)).status === 404);
  ok('Papa cannot change, remove or untag in it either', (await call(papa, { body: { action: 'photo_edit', id: chosenPhoto, caption: 'mine now' } })).status === 404
     && (await call(papa, { body: { action: 'photo_remove', id: chosenPhoto } })).status === 404 && (await call(papa, { body: { action: 'untag', id: chosenPhoto } })).status === 404);
  ok('his tag is still there, untouched', (await count(`select count(*)::int as n from album_people where photo_id = $1 and member_id = $2`, [chosenPhoto, papa.id])) === 1);
  ok('Rohan, who was chosen, can add to it', (await add(rohan, chosenAlbum, { caption: 'Rohan on the toy train' })).status === 201);

  // changing an album
  ok('only the maker changes an album', (await call(rohan, { body: { action: 'album_save', id: chosenAlbum, name: 'Mine', audience: 'family' } })).status === 403);
  ok('someone it is not for cannot even find it', (await call(papa, { body: { action: 'album_save', id: chosenAlbum, name: 'Mine', audience: 'family' } })).status === 404);
  ok('the album for everyone stays as it is', (await call(asha, { body: { action: 'album_save', id: famAlbum, name: 'Secret', audience: 'me' } })).status === 403 && (await call(asha, { body: { action: 'album_remove', id: famAlbum } })).status === 403);
  r = await call(asha, { body: { action: 'album_save', id: chosenAlbum, name: 'Shimla 2019', audience: 'me' } });
  ok('an album is not made "only me" while it holds Rohan\'s photo: nobody loses sight of what they added', r.status === 409 && /photos added by Rohan/.test(r.error), r.error);
  ok('and Rohan still sees it', (await img(rohan, chosenPhoto, 'full')).status === 200);
  r = await call(asha, { body: { action: 'album_save', id: chosenAlbum, name: 'Shimla, June 2019', audience: 'chosen', chosen: [rohan.id, papa.id] } });
  ok('the maker renames it and adds Papa', r.status === 200 && (await get(papa)).albums.some(a => a.name === 'Shimla, June 2019'));
  ok('now Papa can fetch the photo he is in', (await img(papa, chosenPhoto, 'full')).status === 200 && (await img(papa, chosenPhoto, 'thumb')).status === 200);
  await call(asha, { body: { action: 'album_save', id: chosenAlbum, name: 'Shimla, June 2019', audience: 'chosen', chosen: [rohan.id] } });
  ok('taken off again, he cannot, at once', (await img(papa, chosenPhoto, 'full')).status === 404 && (await img(papa, chosenPhoto, 'thumb')).status === 404);
}

// ---- change and remove: whoever added it, or whoever made the album
{
  const papaPhoto = (await get(asha)).photos.find(p => p.caption === 'Papa at the shop').id;
  let r = await call(rohan, { body: { action: 'photo_edit', id: p1, caption: 'Changed by Rohan' } });
  ok('Rohan cannot change a photo Asha added to the family album', r.status === 403 && /Only the person who added this photo, or whoever made the album/.test(r.error));
  ok('nor remove it', (await call(rohan, { body: { action: 'photo_remove', id: p1 } })).status === 403 && (await count(`select count(*)::int as n from album_photos where id = $1`, [p1])) === 1);
  ok('Asha cannot change Papa\'s photo in the family album, which nobody made', (await call(asha, { body: { action: 'photo_edit', id: papaPhoto, caption: 'x' } })).status === 403);
  r = await call(asha, { body: { action: 'photo_edit', id: p1, caption: 'Diwali, 1987', year: 1988, people: [nani.id, rohan.id, papa.id] } });
  const p = (await get(asha)).photos.find(x => x.id === p1);
  ok('the adder changes the caption, the year and the people', r.status === 200 && p.caption === 'Diwali, 1987' && p.year === 1988 && p.people.map(x => x.name).join() === 'Nani,Papa,Rohan');
  ok('an edit follows the same rules: 201 letters, a card number and a bad year are refused', (await call(asha, { body: { action: 'photo_edit', id: p1, caption: 'x'.repeat(201) } })).status === 400
     && (await call(asha, { body: { action: 'photo_edit', id: p1, caption: 'cvv 123' } })).status === 400 && (await call(asha, { body: { action: 'photo_edit', id: p1, year: 1800 } })).status === 400);
  ok('and changed nothing', (await get(asha)).photos.find(x => x.id === p1).caption === 'Diwali, 1987');
  const rohanInChosen = (await get(rohan, { album: chosenAlbum })).photos.find(x => x.caption === 'Rohan on the toy train').id;
  ok('whoever made an album can change a photo someone else added to it', (await call(asha, { body: { action: 'photo_edit', id: rohanInChosen, caption: 'Rohan on the toy train, Shimla' } })).status === 200);
  ok('and remove it', (await call(asha, { body: { action: 'photo_remove', id: rohanInChosen } })).status === 200 && (await count(`select count(*)::int as n from album_photos where id = $1`, [rohanInChosen])) === 0);
  ok('its bytes went with it', (await count(`select count(*)::int as n from album_bytes where photo_id = $1`, [rohanInChosen])) === 0);
  ok('a bad photo id is not found', (await call(asha, { body: { action: 'photo_remove', id: 'x' } })).status === 404);
  ok('an outsider cannot change or remove a family photo', (await call(vikram, { body: { action: 'photo_remove', id: p1 } })).status === 404 && (await call(vikram, { body: { action: 'photo_edit', id: p1, caption: 'x' } })).status === 404);
}

// ---- a tagged person takes off their own name, and only their own
{
  ok('Rohan is in the photo', (await get(rohan)).photos.find(x => x.id === p1).taggedMe === true);
  let r = await call(rohan, { body: { action: 'untag', id: p1 } });
  const p = (await get(asha)).photos.find(x => x.id === p1);
  ok('ROHAN REMOVES HIS OWN TAG', r.status === 200 && p.people.map(x => x.name).join() === 'Nani,Papa');
  ok('the others are still in it: Nani and Papa', p.people.length === 2);
  ok('he cannot take off anyone else: naming Papa changes nothing', (await call(rohan, { body: { action: 'untag', id: p1, targetId: papa.id, memberIdToRemove: papa.id, people: [] } })).status === 404
     && (await count(`select count(*)::int as n from album_people where photo_id = $1`, [p1])) === 2);
  ok('and he cannot do it through an edit, which is not his to make', (await call(rohan, { body: { action: 'photo_edit', id: p1, people: [] } })).status === 403);
  ok('twice is "your name is not on this photo"', /Your name is not on this photo/.test((await call(rohan, { body: { action: 'untag', id: p1 } })).error));
  ok('the photo itself is untouched', (await img(rohan, p1, 'full')).status === 200 && p.caption === 'Diwali, 1987');
  // Asha added the photo and may change its people, but not put back a name its owner took off.
  r = await call(asha, { body: { action: 'photo_edit', id: p1, caption: 'Diwali, 1987', year: 1988, people: [nani.id, papa.id, rohan.id] } });
  ok('THE ADDER CANNOT RE-ADD A TAG THE PERSON REMOVED THEMSELF, and is told why', r.status === 409 && r.error === 'Rohan took their name off this photo, so it stays off.'
     && (await get(asha)).photos.find(x => x.id === p1).people.map(x => x.name).join() === 'Nani,Papa', JSON.stringify(r));
  ok('the rest of that edit was not half applied', (await get(asha)).photos.find(x => x.id === p1).caption === 'Diwali, 1987' && (await count(`select count(*)::int as n from album_people where photo_id = $1`, [p1])) === 2);
  ok('she can still change the caption and the other people', (await call(asha, { body: { action: 'photo_edit', id: p1, caption: 'Diwali, 1987', year: 1988, people: [nani.id, papa.id] } })).status === 200);
  ok('on another photo Rohan can be named as before', await (async () => { const other = (await add(asha, famAlbum, { caption: 'Holi', people: [rohan.id] })).ids[0];
    const x = (await get(rohan)).photos.find(q => q.id === other); await call(asha, { body: { action: 'photo_remove', id: other } }); return !!x && x.taggedMe === true; })());
  ok('a filter by person finds Papa\'s photos, not Rohan\'s any more', (await get(asha, { person: papa.id })).photos.some(x => x.id === p1) && !(await get(asha, { person: rohan.id })).photos.some(x => x.id === p1));
  ok('up to six for a person\'s page', (await get(asha, { person: papa.id, limit: 1 })).photos.length === 1);
}

// ---- six photos a request
{
  await clearRate();
  const before = await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam]);
  let r = await add(asha, famAlbum, {}, new Array(7).fill(0).map(() => one()));
  ok('SEVEN IN ONE REQUEST IS REFUSED, in plain words', r.status === 413 && /up to 6 photos at a time/.test(r.error), r.error);
  ok('and none of the seven was kept', (await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])) === before);
  r = await add(asha, famAlbum, { caption: 'Six at once' }, new Array(6).fill(0).map(() => one()));
  ok('six in one request is fine', r.status === 201 && r.ids.length === 6 && r.count === before + 6);
  const big = b64(makeJpeg({ size: 599000 }));
  r = await add(asha, famAlbum, {}, new Array(6).fill(0).map(() => ({ photo: big, thumb: THUMB })));
  ok('six of the largest are too much for one request, and it says to send fewer', r.status === 413 && /fewer photos at a time/.test(r.error), r.error);
  ok('one bad photo among six refuses all six', (await add(asha, famAlbum, {}, [one(), one(), { photo: PNG, thumb: THUMB }, one()])).status === 400
     && (await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])) === before + 6);
}

// ---- sixty uploads an hour, for each member
{
  await clearRate();
  await admin.query(`delete from album_photos where caption = 'Six at once'`);
  let okAll = true;
  for (let i = 0; i < 10; i++) { const r = await add(rohan, famAlbum, { caption: 'Rohan batch' }, new Array(6).fill(0).map(() => one())); if (r.status !== 201) okAll = false; }
  ok('Rohan adds sixty photos in the hour', okAll && (await count(`select count(*)::int as n from album_photos where caption = 'Rohan batch'`)) === 60);
  const r = await add(rohan, famAlbum, { caption: 'One too many' });
  ok('THE SIXTY-FIRST IS REFUSED, with the number', r.status === 429 && /60 photos in the last hour/.test(r.error), r.error);
  ok('and it was not kept', (await count(`select count(*)::int as n from album_photos where caption = 'One too many'`)) === 0);
  ok('the limit is each person\'s own: Asha can still add', (await add(asha, famAlbum, { caption: 'Asha is fine' })).status === 201);
  ok('it is counted in the database, failing closed', /rateLimit\(sql, 'album_up', me\.id, ALBUM_MAX\.perHour, 3600, \{ failClosed: true \}\)/.test(await (await import('node:fs/promises')).readFile(new URL('../../../api/_album.mjs', import.meta.url), 'utf8')));
}

// ---- four hundred photos a circle
{
  await clearRate();
  const have = await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam]);
  // Filled straight into the tables, through the same byte function the route uses.
  const fill = async (target) => {
    const cur = await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam]);
    for (let i = cur; i < target; i++) {
      const id = (await admin.query(`insert into album_photos (circle_id, album_id, by_member, caption, photo_bytes, thumb_bytes, created_at)
                                     values ($1,$2,$3,'filler',5000,900, now() - interval '400 days' + ($4 || ' minutes')::interval) returning id`, [fam, famAlbum, papa.id, String(i)])).rows[0].id;
      await albumPutBytes(db(), id, PHOTO, THUMB);
    }
  };
  ok('there is room to begin with', have < 360 && (await get(asha)).near === false);
  await fill(360);
  let g = await get(asha);
  ok('NEAR THE LIMIT, it says so with the count', g.count === 360 && g.near === true && g.full === false && g.left === 40 && g.line === 'The album is nearly full: 360 of 400 photos. You can add 40 more.', g.line);
  await fill(398);
  let r = await add(asha, famAlbum, {}, [one(), one(), one()]);
  ok('three more when there is room for two is refused, with what is left', r.status === 409 && r.full === true && /room for 2 more photos/.test(r.error) && r.count === 398 && r.cap === 400, r.error);
  ok('none of the three was kept', (await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])) === 398);
  r = await add(asha, famAlbum, {}, [one(), one()]);
  ok('two more fit: the album is at 400', r.status === 201 && r.count === 400 && r.left === 0 && /full: 400 of 400/.test(r.line));
  r = await add(asha, famAlbum);
  ok('THE 401ST PHOTO IS REFUSED, in plain words, with a way out', r.status === 409 && r.full === true && r.error === 'The album is full: 400 photos. Remove some older ones to add more.', r.error);
  ok('a private album counts too: it is the same database', (await add(asha, onlyMe)).status === 409);
  g = await get(asha);
  ok('the screen is told it is full', g.full === true && g.count === 400 && g.left === 0 && g.line === 'The album is full: 400 of 400 photos. Remove some older ones to add more.');
  ok('the count is of the circle, never of another one', (await get(vikram)).count === 0 && (await add(vikram, (await get(vikram)).albums[0].id)).status === 201);
  ok('exactly 400 rows, and 400 sets of bytes', (await count(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])) === 400 && (await count(`select count(*)::int as n from album_bytes b join album_photos p on p.id = b.photo_id where p.circle_id = $1`, [fam])) === 400);
  const oldest = g.photos[g.photos.length - 1];
  ok('Papa removes an older one of his', oldest.caption === 'filler' && (await call(papa, { body: { action: 'photo_remove', id: oldest.id } })).count === 399);
  ok('and now there is room for one', (await add(asha, famAlbum, { caption: 'After making room' })).status === 201);
  await admin.query(`delete from album_photos where caption in ('filler', 'Rohan batch')`);
}

// ---- one older photo a week, on Today
{
  const today = (who) => get(who, { view: 'today' });
  await admin.query(`delete from album_weeks`);
  const t1 = await today(asha);
  ok('Today offers Asha one older photo she may see', t1.status === 200 && t1.pick && t1.pick.year < new Date().getFullYear() && !!t1.pick.photo.id && /^\d{4}-W\d\d$/.test(t1.pick.week), JSON.stringify(t1).slice(0, 200));
  ok('asked again, on any phone, it is the same one all week', (await today(asha)).pick.photo.id === t1.pick.photo.id && (await today(asha)).pick.photo.id === t1.pick.photo.id);
  ok('it is claimed once for the week', (await count(`select count(*)::int as n from album_weeks where member_id = $1`, [asha.id])) === 1);
  ok('it is the pure rule\'s pick', t1.pick.photo.id === R.weeklyPick(asha.id, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
     (await admin.query(`select p.id from album_photos p join album_albums a on a.id = p.album_id where p.circle_id = $1 and coalesce(p.taken_year, extract(year from p.created_at)::int) < extract(year from now())::int
                         and (a.audience = 'family' or a.by_member = $2 or (a.audience = 'chosen' and $2 = any(a.chosen)))`, [fam, asha.id])).rows.map(r => r.id)));
  ok('only photos from an earlier year are offered: nothing added this year with no year on it', (await admin.query(`select taken_year from album_photos where id = $1`, [t1.pick.photo.id])).rows[0].taken_year < new Date().getFullYear());
  // Papa may see only the family album: his pick is never from a private one.
  const tp = await today(papa);
  ok('Papa\'s is from an album he may see', tp.pick && tp.pick.photo.albumName === 'Our family');
  await admin.query(`update album_photos set taken_year = 1990 where id = any($1::uuid[])`, [[mePhoto, chosenPhoto]]);
  await admin.query(`delete from album_weeks`);
  await admin.query(`update album_photos set taken_year = null where album_id = $1`, [famAlbum]);
  ok('with older photos only in albums that are not for him, Papa is offered nothing', (await today(papa)).pick === null);
  ok('and nothing was claimed, so a photo added later this week can still show', (await count(`select count(*)::int as n from album_weeks where member_id = $1`, [papa.id])) === 0);
  const ta = await today(asha);
  ok('Asha is offered one of her private ones', ta.pick && [mePhoto, chosenPhoto].includes(ta.pick.photo.id) && ta.pick.year === 1990);
  // made private after it was claimed: gone at once
  const tr = await today(rohan);
  ok('Rohan is offered the Shimla photo, the only older one for him', tr.pick && tr.pick.photo.id === chosenPhoto);
  await admin.query(`update album_albums set chosen = '{}' where id = $1`, [chosenAlbum]);
  ok('when the album stops being for him, it leaves his Today at once', (await today(rohan)).pick === null);
  await admin.query(`update album_albums set chosen = $2::uuid[] where id = $1`, [chosenAlbum, [rohan.id]]);
  ok('"Not now" hides it for the week', (await call(rohan, { body: { action: 'today_hide' } })).status === 200 && (await today(rohan)).pick === null);
  ok('for him only', (await today(asha)).pick !== null);
  // someone the family remembers is not brought up by itself
  await admin.query(`delete from album_weeks`);
  await admin.query(`update album_photos set taken_year = null where id = any($1::uuid[])`, [[mePhoto, chosenPhoto]]);
  await admin.query(`update album_photos set taken_year = 1962 where id = $1`, [p1]);
  ok('the 1962 photo with Nani is offered', (await today(papa)).pick?.photo.id === p1 && (await today(papa)).pick.year === 1962);
  await admin.query(`update members set remembered = true where id = $1`, [nani.id]);
  ok('once Nani is marked as remembered, the photo already on Papa\'s Today is put away at once', (await today(papa)).pick === null);
  await admin.query(`delete from album_weeks`);
  ok('and it is not brought up by itself in a new week either', (await today(papa)).pick === null && (await today(rohan)).pick === null);
  ok('it is still in the album for anyone who looks', (await get(papa)).photos.some(x => x.id === p1));
  await admin.query(`update members set remembered = false where id = $1`, [nani.id]);
}

// ---- removing an album, and people leaving
{
  ok('only the maker removes an album', (await call(rohan, { body: { action: 'album_remove', id: chosenAlbum } })).status === 403 && (await call(papa, { body: { action: 'album_remove', id: chosenAlbum } })).status === 404);
  const r = await call(asha, { body: { action: 'album_remove', id: chosenAlbum } });
  ok('the maker removes it, and is told how many photos went', r.status === 200 && r.removed === 1 && (await count(`select count(*)::int as n from album_photos where id = $1`, [chosenPhoto])) === 0
     && (await count(`select count(*)::int as n from album_bytes where photo_id = $1`, [chosenPhoto])) === 0);
  await admin.query(`delete from members where id = $1`, [papa.id]);
  ok('when Papa leaves, his tags go and the photos stay', (await count(`select count(*)::int as n from album_people where member_id = $1`, [papa.id])) === 0 && (await get(asha)).photos.some(x => x.id === p1));
  await admin.query(`delete from members where id = $1`, [asha.id]);
  const after = await get(rohan);
  ok('when Asha leaves, her "only me" album goes with its photo, and the family album stays', after.status === 200 && after.albums.length === 1
     && (await count(`select count(*)::int as n from album_albums where id = $1`, [onlyMe])) === 0 && (await count(`select count(*)::int as n from album_photos where id = $1`, [mePhoto])) === 0);
  ok('the photos she added to the family album are still there', after.photos.some(x => x.id === p1) && (await img(rohan, p1, 'full')).status === 200);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error('album.dbtest: ' + fails.length + ' FAILED of ' + (pass + fails.length) + '\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('album.dbtest: ' + pass + '/' + pass + ' checks pass');
