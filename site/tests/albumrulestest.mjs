// YAADON KI ALBUM, THE RULES, with no database and nothing installed: what
// counts as a JPEG, the size limits, who may see and change what, the plain
// words for the limit, and the one older photo a week. api/_albumrules.mjs
// imports nothing.
import { readFile } from 'node:fs/promises';
import * as A from '../../api/_albumrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

// A real JPEG and a real PNG of the same 16 by 12 picture, both made by a
// browser canvas (the way the app makes every photo).
const REAL_JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAMABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAhEAABAwQCAwEAAAAAAAAAAAARAQQSAgMTFAAGBTFRcf/EABQBAQAAAAAAAAAAAAAAAAAAAAf/xAAhEQABAgQHAAAAAAAAAAAAAAATABIDBBSBESEiI1FSsf/aAAwDAQACEQMRAD8Ao+7dgdeC0tS3YrzTllpVQIgBU+rx0nsDrzu7t27FGGEcVKoTIkqvxOUDtk1eQ221i/Axy20qB9g/icNGTVnPUbWLExLFbSkj0R+rwvq5ShALd7Xx8ySESEFjdXN1/9k=';
const REAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAARUlEQVR4AdyQsQ0AIAgEP4zhAG7kAE7mAJZu4zLYf4EFJCSQXEHzf3nR09SDwHnxAXcOWLBwvAE3/P6KBn1tWPAm+Rs8AAAA//+TOT/gAAAABklEQVQDAAgDRMkHPQ3NAAAAAElFTkSuQmCC';
const bytesOf = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));

// A JPEG put together by hand, so each part can be changed: its size in
// pixels, a camera details block, and how many bytes it weighs.
function makeJpeg({ w = 1600, h = 1200, exif = false, size = 0, extra = null } = {}) {
  const parts = [[0xFF, 0xD8], [0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]];
  if (exif) parts.push([0xFF, 0xE1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8]);
  // Any other segment: [marker, ...its label and bytes].
  if (extra) { const body = extra.slice(1); parts.push([0xFF, extra[0], (body.length + 2) >> 8, (body.length + 2) & 255, ...body]); }
  parts.push([0xFF, 0xC0, 0x00, 0x0B, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  parts.push([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0]);
  const head = parts.flat();
  const fill = Math.max(4, size - head.length - 2);
  return Uint8Array.from([...head, ...new Array(fill).fill(0x11), 0xFF, 0xD9]);
}

// ---- the limits are the ones in the brief
ok('600 KB a photo, 40 KB a thumbnail', A.ALBUM_MAX.photoBytes === 600000 && A.ALBUM_MAX.thumbBytes === 40000);
ok('1600 and 320 pixels on the longest side', A.ALBUM_MAX.photoSide === 1600 && A.ALBUM_MAX.thumbSide === 320);
ok('400 photos a circle, 6 a request, 60 an hour', A.ALBUM_MAX.perCircle === 400 && A.ALBUM_MAX.perRequest === 6 && A.ALBUM_MAX.perHour === 60);
ok('a name up to 60 letters, a caption up to 200', A.ALBUM_MAX.name === 60 && A.ALBUM_MAX.caption === 200);
ok('one upload request stays under the 4.5 MB a Vercel function accepts, as base64',
   Math.ceil(A.ALBUM_MAX.requestBytes * 4 / 3) + 20000 < 4500000, String(Math.ceil(A.ALBUM_MAX.requestBytes * 4 / 3)));
ok('three audiences, the family first', A.ALBUM_AUDIENCES.join() === 'family,chosen,me');
ok('the location line is the one the add sheet shows', A.ALBUM_LOCATION_LINE === 'Parwah removes the location from your photos before saving them.');

// ---- the magic bytes
const real = A.jpegInfo(bytesOf(REAL_JPG));
ok('a real canvas JPEG is read: 16 by 12, no camera details', real && real.width === 16 && real.height === 12 && real.exif === false, JSON.stringify(real));
ok('a real PNG is not a JPEG', A.jpegInfo(bytesOf(REAL_PNG)) === null);
ok('a PNG is refused whatever it is called', /not a JPEG/.test(A.imageError(bytesOf(REAL_PNG), 'photo')));
const made = A.jpegInfo(makeJpeg({ w: 1600, h: 1200 }));
ok('a hand-made JPEG is read too', made && made.width === 1600 && made.height === 1200 && !made.exif);
ok('the first three bytes decide: FF D8 FF', A.jpegInfo(Uint8Array.from([0xFF, 0xD8, 0x00, 0x10, 0, 0])) === null
   && A.jpegInfo(Uint8Array.from([0x89, 0x50, 0x4E, 0x47])) === null && A.jpegInfo(Uint8Array.from([0x47, 0x49, 0x46, 0x38])) === null);
ok('a PNG with a JPEG start glued on is still refused', A.jpegInfo(Uint8Array.from([0xFF, 0xD8, 0xFF, ...bytesOf(REAL_PNG)])) === null);
ok('a JPEG cut short is refused', A.jpegInfo(makeJpeg().slice(0, 30)) === null && A.jpegInfo(bytesOf(REAL_JPG).slice(0, 400)) === null);
ok('a JPEG with no end marker is refused', A.jpegInfo(makeJpeg().slice(0, -2)) === null);
ok('a JPEG with no size in it is refused', A.jpegInfo(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0, 0x11, 0xFF, 0xD9])) === null);
ok('nothing, a string and a short file are refused', A.jpegInfo(null) === null && A.jpegInfo('') === null && A.jpegInfo(Uint8Array.from([0xFF, 0xD8])) === null);
ok('text is not a picture', /not a JPEG/.test(A.imageError(Uint8Array.from(Buffer.from('<script>alert(1)</script>')), 'photo')));

// ---- size
ok('a good photo and a good thumbnail pass', A.imageError(makeJpeg({ w: 1600, h: 1200, size: 300000 }), 'photo') === null
   && A.imageError(makeJpeg({ w: 320, h: 240, size: 15000 }), 'thumb') === null && A.imageError(bytesOf(REAL_JPG), 'thumb') === null);
ok('exactly 600,000 bytes is kept', A.imageError(makeJpeg({ size: 600000 }), 'photo') === null && makeJpeg({ size: 600000 }).length === 600000);
ok('one byte more is refused, in plain words', /larger than 600 KB/.test(A.imageError(makeJpeg({ size: 600001 }), 'photo')));
ok('a thumbnail over 40 KB is refused', /larger than 40 KB/.test(A.imageError(makeJpeg({ w: 320, h: 240, size: 40001 }), 'thumb'))
   && A.imageError(makeJpeg({ w: 320, h: 240, size: 40000 }), 'thumb') === null);
ok('a photo wider than 1600 is refused', /wider or taller than 1600/.test(A.imageError(makeJpeg({ w: 1601, h: 900 }), 'photo')));
ok('a photo taller than 1600 is refused', /wider or taller than 1600/.test(A.imageError(makeJpeg({ w: 900, h: 4000 }), 'photo')));
ok('a full photo sent as a thumbnail is refused', /wider or taller than 320/.test(A.imageError(makeJpeg({ w: 1600, h: 1200, size: 20000 }), 'thumb')));
ok('an empty file is refused', /did not arrive/.test(A.imageError(new Uint8Array(0), 'photo')) && /did not arrive/.test(A.imageError(null, 'thumb')));

// ---- the location never arrives
const withExif = A.jpegInfo(makeJpeg({ exif: true }));
ok('camera details inside a JPEG are seen', withExif && withExif.exif === true);
// XMP sits in APP1 under another label and can carry the same place; IPTC and Photoshop notes sit in APP13.
const label = (t) => [...Buffer.from(t, 'latin1')];
const xmp = makeJpeg({ extra: [0xE1, ...label('http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta><exif:GPSLatitude>28,36.83N</exif:GPSLatitude></x:xmpmeta>')] });
const iptc = makeJpeg({ extra: [0xED, ...label('Photoshop 3.0\u00008BIM'), 4, 4, 0, 0, 0, 0, 0, 9, 0x1C, 2, 90, 0, 4, ...label('Agra')] });
const bare1 = makeJpeg({ extra: [0xE1, 1, 2, 3] });
ok('an XMP block (APP1 with another label) is seen as details too', A.jpegInfo(xmp) && A.jpegInfo(xmp).exif === true && /where it was taken/.test(A.imageError(xmp, 'photo')));
ok('so is an IPTC or Photoshop block (APP13)', A.jpegInfo(iptc) && A.jpegInfo(iptc).exif === true && /where it was taken/.test(A.imageError(iptc, 'photo')) && !!A.imageError(iptc, 'thumb'));
ok('any APP1 at all is refused, whatever its label says', A.jpegInfo(bare1).exif === true && !!A.imageError(bare1, 'photo'));
ok('other segments a plain JPEG may carry are still fine: a comment, an ICC profile, Adobe', [[0xFE, ...label('made by hand')], [0xE2, ...label('ICC_PROFILE\u0000'), 1, 1], [0xEE, ...label('Adobe'), 0, 100, 0, 0, 0, 0, 0]]
   .every(x => { const j = makeJpeg({ extra: x }); return A.jpegInfo(j).exif === false && A.imageError(j, 'photo') === null; }));
ok('and that photo is refused, saying why', /where it was taken/.test(A.imageError(makeJpeg({ exif: true }), 'photo')));
ok('every refusal is a plain sentence', [makeJpeg({ size: 700000 }), bytesOf(REAL_PNG), makeJpeg({ w: 3000 }), makeJpeg({ exif: true }), null]
   .every(b => { const e = A.imageError(b, 'photo'); return e && !/[{}<>]/.test(e) && e.length < 200; }));

// ---- base64, and the label in front of it
ok('base64 is taken as it is', A.cleanB64(REAL_JPG) === REAL_JPG);
ok('a "data:" label is cut off and not believed', A.cleanB64('data:image/jpeg;base64,' + REAL_PNG) === REAL_PNG
   && /not a JPEG/.test(A.imageError(bytesOf(A.cleanB64('data:image/jpeg;base64,' + REAL_PNG)), 'photo')));
ok('anything that is not base64 is refused', A.cleanB64('not base64!') === null && A.cleanB64('') === null && A.cleanB64(null) === null && A.cleanB64('abc') === null);
ok('the size of base64 is worked out without reading it', A.b64Size(REAL_JPG) === bytesOf(REAL_JPG).length && A.b64Size('QQ==') === 1 && A.b64Size('QUI=') === 2);

// ---- words
ok('a caption is trimmed and its spaces tidied', A.cleanLine('  Diwali   at Nani\'s ', 200, 'A caption').value === 'Diwali at Nani\'s');
ok('exactly 200 letters is fine, 201 is refused and never cut', A.cleanLine('x'.repeat(200), 200, 'A caption').value.length === 200
   && /up to 200 letters/.test(A.cleanLine('x'.repeat(201), 200, 'A caption').error));
ok('an album name over 60 letters is refused', /up to 60 letters/.test(A.cleanLine('x'.repeat(61), 60, 'An album name').error));
ok('the year can be left out', A.cleanYear('', 2026).value === null && A.cleanYear(null, 2026).value === null && A.cleanYear(undefined, 2026).value === null);
ok('1900 and this year are both fine', A.cleanYear('1900', 2026).value === 1900 && A.cleanYear(2026, 2026).value === 2026 && A.cleanYear(' 1987 ', 2026).value === 1987);
ok('1899 and next year are refused with the range', /1900 to 2026/.test(A.cleanYear(1899, 2026).error) && /1900 to 2026/.test(A.cleanYear(2027, 2026).error));
ok('a year that is not four digits is refused', /four digits/.test(A.cleanYear('87', 2026).error) && /four digits/.test(A.cleanYear('19870', 2026).error) && /four digits/.test(A.cleanYear('abcd', 2026).error));
ok('an album date can be left out, or be a real day', A.cleanDate('', '2026-11-12').value === null && A.cleanDate('2019-10-27', '2026-11-12').value === '2019-10-27');
ok('a day that is not on the calendar, or has not come, is refused', /not on the calendar/.test(A.cleanDate('2019-02-30', '2026-11-12').error)
   && /not come yet/.test(A.cleanDate('2026-11-13', '2026-11-12').error) && /calendar/.test(A.cleanDate('27/10/2019', '2026-11-12').error));

// ---- who may see an album
const fam = { audience: 'family', chosen: [], by_member: 'asha' };
const some = { audience: 'chosen', chosen: ['rohan'], by_member: 'asha' };
const mine = { audience: 'me', chosen: [], by_member: 'asha' };
const dflt = { audience: 'family', chosen: [], by_member: null };
ok('a family album is for everyone', A.albumCanSee(fam, 'asha') && A.albumCanSee(fam, 'rohan') && A.albumCanSee(fam, 'papa') && A.albumCanSee(dflt, 'papa'));
ok('"people I choose" is for the maker and the people named', A.albumCanSee(some, 'asha') && A.albumCanSee(some, 'rohan') && !A.albumCanSee(some, 'papa'));
ok('"only me" is for the maker alone', A.albumCanSee(mine, 'asha') && !A.albumCanSee(mine, 'rohan') && !A.albumCanSee(mine, 'papa'));
ok('an audience nobody knows is read as the most private', !A.albumCanSee({ audience: 'everyone', chosen: [], by_member: 'asha' }, 'rohan')
   && A.albumCanSee({ audience: 'everyone', chosen: [], by_member: 'asha' }, 'asha'));
ok('nobody is nobody', !A.albumCanSee(fam, null) && !A.albumCanSee(null, 'asha') && !A.albumCanSee(mine, undefined));
ok('a private album whose maker has gone is for nobody', !A.albumCanSee({ audience: 'me', chosen: [], by_member: null }, 'rohan'));
ok('whoever can see an album can add to it', A.albumCanAdd(fam, 'papa') && A.albumCanAdd(some, 'rohan') && !A.albumCanAdd(some, 'papa') && !A.albumCanAdd(mine, 'rohan'));

// ---- who may change or remove a photo
const photo = { by_member: 'rohan' };
ok('whoever added a photo can change it', A.photoCanChange(photo, fam, 'rohan'));
ok('so can whoever made the album', A.photoCanChange(photo, fam, 'asha'));
ok('nobody else can', !A.photoCanChange(photo, fam, 'papa'));
ok('in the album for everyone, which nobody made, only the adder can', A.photoCanChange(photo, dflt, 'rohan') && !A.photoCanChange(photo, dflt, 'asha'));
ok('someone who cannot see a photo cannot change it', !A.photoCanChange({ by_member: 'papa' }, mine, 'papa'));

// ---- an album is never made more private than the people who added to it
ok('going to "only me" is held back while others have photos in it', A.lockedOut('me', [], 'asha', ['asha', 'rohan', 'rohan', 'papa']).join() === 'rohan,papa');
ok('choosing them keeps them', A.lockedOut('chosen', ['rohan', 'papa'], 'asha', ['asha', 'rohan', 'papa']).length === 0
   && A.lockedOut('chosen', ['rohan'], 'asha', ['rohan', 'papa']).join() === 'papa');
ok('the maker alone is never in the way', A.lockedOut('me', [], 'asha', ['asha']).length === 0 && A.lockedOut('family', [], 'asha', ['rohan']).length === 0);

// ---- the limit, in plain words, with the count
ok('far from full: just the count', A.capLine(38, 'family') === '38 of 400 photos, for the whole family.' && A.capLine(0, 'group') === '0 of 400 photos, for the whole group.');
ok('near the limit says so, with how many are left', A.capLine(360, 'family') === 'The album is nearly full: 360 of 400 photos. You can add 40 more.'
   && A.capLine(399, 'family') === 'The album is nearly full: 399 of 400 photos. You can add 1 more.' && !/nearly/.test(A.capLine(359, 'family')));
ok('at the limit it says to remove older ones', A.capLine(400, 'family') === 'The album is full: 400 of 400 photos. Remove some older ones to add more.');
ok('adding is fine while there is room', A.capError(0, 6) === null && A.capError(394, 6) === null && A.capError(399, 1) === null);
ok('adding past the limit is refused, with what is left', /room for 2 more photos/.test(A.capError(398, 3)) && /room for 1 more photo\./.test(A.capError(399, 2)));
ok('a full album refuses and offers a way out', /full: 400 photos\. Remove some older ones/.test(A.capError(400, 1)));

// ---- alt text
ok('alt is the caption and the people', A.albumAlt('Diwali at Nani\'s house.', ['Nani', 'Rohan'], 1987) === 'Diwali at Nani\'s house. With Nani and Rohan, 1987');
ok('three people read as a list', A.albumAlt('', ['Asha', 'Nani', 'Rohan']) === 'Photo with Asha, Nani and Rohan');
ok('a caption alone, a person alone, and neither', A.albumAlt('The old house', []) === 'The old house' && A.albumAlt('', ['Papa']) === 'Photo with Papa'
   && A.albumAlt('', [], null) === 'A family photo' && A.albumAlt(null, null, 1962) === 'A family photo, 1962');

// ---- one older photo a week
ok('an ISO week starts on Monday', A.isoWeekKey('2026-11-09') === '2026-W46' && A.isoWeekKey('2026-11-15') === '2026-W46' && A.isoWeekKey('2026-11-16') === '2026-W47');
ok('the first days of January can belong to the last week of the old year', A.isoWeekKey('2027-01-01') === '2026-W53' && A.isoWeekKey('2027-01-04') === '2027-W01' && A.isoWeekKey('2024-12-30') === '2025-W01');
ok('the week number steps by one each Monday', A.isoWeekIndex('2026-11-16') === A.isoWeekIndex('2026-11-15') + 1 && A.isoWeekIndex('2026-11-09') === A.isoWeekIndex('2026-11-15'));
const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
const picks = week.map(d => A.weeklyPick('member-asha', d, ids));
ok('the pick is the same from Monday to Sunday', new Set(picks).size === 1 && ids.includes(picks[0]), picks.join());
ok('the order the photos arrive in does not change it', A.weeklyPick('member-asha', '2026-11-12', [...ids].reverse()) === picks[0] && A.weeklyPick('member-asha', '2026-11-12', [...ids, 'p3']) === picks[0]);
ok('the next week is a different photo', A.weeklyPick('member-asha', '2026-11-16', ids) !== picks[0]);
const year = []; for (let i = 0; i < 52; i++) { const d = new Date(Date.UTC(2026, 10, 9 + 7 * i)).toISOString().slice(0, 10); year.push(A.weeklyPick('member-asha', d, ids)); }
ok('it is never the same photo two weeks running', year.every((p, i) => i === 0 || p !== year[i - 1]));
ok('over seven weeks every one of seven photos is shown once', new Set(year.slice(0, 7)).size === 7);
const start = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(m => A.weeklyPick('member-' + m, '2026-11-12', ids)));
ok('members do not all start on the same photo', start.size > 1, [...start].join());
ok('with one photo it is that one; with none, nothing', A.weeklyPick('m', '2026-11-12', ['only']) === 'only' && A.weeklyPick('m', '2026-11-12', []) === null && A.weeklyPick('', '2026-11-12', ids) === null);

// ---- this file's promise
const src = await readFile(new URL('../../api/_albumrules.mjs', import.meta.url), 'utf8');
ok('the rules import nothing, so the gate can run them before npm install', !/^\s*import\s/m.test(src) && !/\brequire\(/.test(src) && !/\bimport\(/.test(src));
ok('no dashes in the words a person reads', !new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(src));

if (fails.length) { console.error('albumrulestest: ' + fails.length + ' FAILED of ' + (pass + fails.length)); fails.forEach(f => console.error('  FAIL ' + f)); process.exit(1); }
console.log('albumrulestest: ' + pass + '/' + pass + ' checks pass');
