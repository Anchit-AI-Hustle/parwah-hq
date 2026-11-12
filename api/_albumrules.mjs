// YAADON KI ALBUM, THE RULES: what a photo, a thumbnail, an album, a caption
// and a year may be, who may see and change what, and which older photo a
// person is shown in a given week. Imports nothing, so the gate can check
// every rule before npm install, and the app mirrors the same numbers.
//
// A photo is kept only as a JPEG that the family's own phone re-made on a
// canvas. Re-making it drops everything the camera wrote beside the picture
// (where it was taken, which phone took it), so the server refuses a file
// that still carries those details, whatever the sender says it is.

export const ALBUM_MAX = {
  photoBytes: 600000,      // one photo, as stored
  thumbBytes: 40000,       // its thumbnail
  photoSide: 1600,         // longest side of a photo, in pixels
  thumbSide: 320,          // longest side of a thumbnail
  perCircle: 400,          // photos a circle may hold
  nearAt: 360,             // from here on, the screen says how many are left
  perRequest: 6,           // photos in one upload request
  // Vercel refuses a request body over about 4.5 MB. Base64 adds a third,
  // so 3.2 MB of pictures is about 4.3 MB on the wire.
  requestBytes: 3200000,
  perHour: 60,             // uploads by one member in an hour
  name: 60, caption: 200, people: 40, chosen: 60, albums: 60,
  minYear: 1900
};
export const ALBUM_AUDIENCES = ['family', 'chosen', 'me'];
export const ALBUM_LOCATION_LINE = 'Parwah removes the location from your photos before saving them.';

// ---- is it really a JPEG?
// Walks the file the way a decoder does: start marker, then segment after
// segment up to the picture data. Returns its size in pixels and whether a
// details block (Exif, XMP, IPTC: `exif`) is still inside, or null when the
// bytes are not a JPEG at all. A PNG renamed to .jpg fails on the first two bytes.
export function jpegInfo(b) {
  if (!b || typeof b.length !== 'number' || b.length < 4) return null;
  if (b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF) return null;
  let i = 2, width = 0, height = 0, exif = false;
  while (i + 3 < b.length) {
    if (b[i] !== 0xFF) return null;
    let m = b[i + 1];
    // Fill bytes before a marker are allowed.
    if (m === 0xFF) { i++; continue; }
    if (m === 0xD8 || m === 0x00) return null;
    if (m === 0xD9) return null;                       // ended before any picture
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    // Details that travel beside the picture. APP1 holds Exif (the camera,
    // the place) and also XMP, which can carry the same place under another
    // name; APP13 holds IPTC and Photoshop notes (a caption, a city, a
    // name). None of them is part of the picture, and a canvas re-encode
    // writes none, so ANY APP1 or APP13 segment is refused, whatever its
    // label says.
    if (m === 0xE1 || m === 0xED) exif = true;
    const sof = m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
    if (sof) {
      if (len < 7) return null;
      height = (b[i + 5] << 8) | b[i + 6];
      width = (b[i + 7] << 8) | b[i + 8];
    }
    if (m === 0xDA) {
      // The picture data starts here. A real file has a size by now and
      // closes with the end marker.
      if (!width || !height) return null;
      if (b[b.length - 2] !== 0xFF || b[b.length - 1] !== 0xD9) return null;
      return { width, height, exif };
    }
    i += 2 + len;
  }
  return null;
}

// Why these bytes are refused as a photo or a thumbnail, or null when they
// are fine. The sender's own word for the type is never looked at.
export function imageError(bytes, kind) {
  const thumb = kind === 'thumb';
  const what = thumb ? 'The small preview' : 'That photo';
  const maxBytes = thumb ? ALBUM_MAX.thumbBytes : ALBUM_MAX.photoBytes;
  const maxSide = thumb ? ALBUM_MAX.thumbSide : ALBUM_MAX.photoSide;
  if (!bytes || !bytes.length) return what + ' did not arrive. Please try again.';
  if (bytes.length > maxBytes) return what + ' is larger than ' + Math.round(maxBytes / 1000) + ' KB. Add it from the Parwah app, which makes it smaller first.';
  const info = jpegInfo(bytes);
  if (!info) return what + ' is not a JPEG picture. Add it from the Parwah app, which saves every photo as a JPEG.';
  if (Math.max(info.width, info.height) > maxSide) return what + ' is wider or taller than ' + maxSide + ' pixels. Add it from the Parwah app, which makes it smaller first.';
  if (info.exif) return what + ' still carries details from the camera, which can include where it was taken. Add it from the Parwah app, which removes them first.';
  return null;
}

// Base64 and nothing else. A "data:image/png;base64," label in front is cut
// off and ignored: what the bytes are is decided by reading them.
export function cleanB64(v) {
  const s = String(v == null ? '' : v).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  return s;
}
export function b64Size(s) {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return s.length / 4 * 3 - pad;
}

// ---- words
// One line of text. Too long is refused, never cut: a cut caption is a
// different caption. Returns { value } or { error }.
export function cleanLine(v, max, what) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > max) return { error: what + ' can be up to ' + max + ' letters. Make it shorter.' };
  return { value: s };
}

// The year a photo was taken: empty, or a whole year from 1900 to this year.
// Old scanned photos are the point, so nothing recent is assumed.
export function cleanYear(v, nowYear) {
  if (v === null || v === undefined || String(v).trim() === '') return { value: null };
  const s = String(v).trim();
  if (!/^\d{4}$/.test(s)) return { error: 'Write the year as four digits, like 1987.' };
  const y = +s;
  if (y < ALBUM_MAX.minYear || y > nowYear) return { error: 'The year can be from ' + ALBUM_MAX.minYear + ' to ' + nowYear + '.' };
  return { value: y };
}

// An album's date: empty, or a real day that is not in the future.
export function cleanDate(v, today) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { error: 'Pick the date from the calendar.' };
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return { error: 'That date is not on the calendar.' };
  if (+m[1] < ALBUM_MAX.minYear) return { error: 'The date can be from ' + ALBUM_MAX.minYear + ' onwards.' };
  if (today && s > today) return { error: 'That date has not come yet.' };
  return { value: s };
}

// ---- who may see and change what
// The SQL in _album.mjs says the same thing; this is the rule in words the
// tests can read.
//   family: everyone in the circle (the default)
//   chosen: whoever made the album and the members they named
//   me:     whoever made the album, nobody else
export function albumCanSee(album, viewerId) {
  if (!album || !viewerId) return false;
  const a = ALBUM_AUDIENCES.includes(album.audience) ? album.audience : 'me';
  if (a === 'family') return true;
  if (album.by_member && album.by_member === viewerId) return true;
  if (a === 'chosen') return Array.isArray(album.chosen) && album.chosen.includes(viewerId);
  return false;
}
// Whoever can see an album can add to it.
export const albumCanAdd = albumCanSee;
// A photo is changed or removed by whoever added it, or whoever made its
// album, and only while they can still see it.
export function photoCanChange(photo, album, viewerId) {
  if (!photo || !viewerId || !albumCanSee(album, viewerId)) return false;
  return photo.by_member === viewerId || (!!album.by_member && album.by_member === viewerId);
}
// Before an album is made more private: the people who added photos to it
// and would no longer be able to see their own. The change is refused while
// this list is not empty, so nobody loses sight of what they added.
export function lockedOut(audience, chosen, makerId, adderIds) {
  const next = { audience, chosen: Array.isArray(chosen) ? chosen : [], by_member: makerId };
  return [...new Set((adderIds || []).filter(Boolean))].filter(id => !albumCanSee(next, id));
}

// ---- the limit, said plainly
export function capLine(count, word) {
  const cap = ALBUM_MAX.perCircle, left = Math.max(0, cap - count);
  const w = word === 'group' ? 'group' : 'family';
  if (left === 0) return 'The album is full: ' + cap + ' of ' + cap + ' photos. Remove some older ones to add more.';
  if (count >= ALBUM_MAX.nearAt) return 'The album is nearly full: ' + count + ' of ' + cap + ' photos. You can add ' + left + ' more.';
  return count + ' of ' + cap + ' photos, for the whole ' + w + '.';
}
// Why adding n photos is refused, or null when there is room.
export function capError(count, n) {
  const cap = ALBUM_MAX.perCircle, left = Math.max(0, cap - count);
  if (left === 0) return 'The album is full: ' + cap + ' photos. Remove some older ones to add more.';
  if (n > left) return 'There is room for ' + left + ' more ' + (left === 1 ? 'photo' : 'photos') + '. The album holds ' + cap + '. Add fewer, or remove some older ones.';
  return null;
}

// ---- words for a picture
// What a screen reader says for a photo: its caption and who is in it.
export function albumAlt(caption, names, year) {
  const who = (names || []).filter(Boolean);
  const list = who.length > 1 ? who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1] : (who[0] || '');
  let s = String(caption || '').trim();
  if (s && list) s = s.replace(/[.!?]+$/, '') + '. With ' + list;
  else if (!s && list) s = 'Photo with ' + list;
  else if (!s) s = 'A family photo';
  return s + (year ? ', ' + year : '');
}

// ---- one older photo a week
// ISO weeks start on Monday. The key names the week ("2026-W46"); the index
// counts weeks since 1970 so the pick can step forward one photo a week.
function dayNumber(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export function isoWeekIndex(day) { return Math.floor((dayNumber(day) + 3) / 7); }
export function isoWeekKey(day) {
  const n = dayNumber(day);
  const dow = ((n + 3) % 7 + 7) % 7;                    // Monday is 0
  const thu = new Date((n - dow + 3) * 86400000);        // the Thursday of this week
  const y = thu.getUTCFullYear();
  const jan1 = Math.floor(Date.UTC(y, 0, 1) / 86400000);
  const week = Math.floor((n - dow + 3 - jan1) / 7) + 1;
  return y + '-W' + String(week).padStart(2, '0');
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
// Which photo this member sees this week. The same answer all week, on
// every phone; the next photo along the week after, so with two or more to
// choose from it is never the same one two weeks running. Each member starts
// at a different place, so the family is not all shown the same picture.
export function weeklyPick(memberId, day, ids) {
  const list = [...new Set(ids || [])].sort();
  if (!list.length || !memberId) return null;
  return list[(hash(String(memberId)) + isoWeekIndex(day)) % list.length];
}
