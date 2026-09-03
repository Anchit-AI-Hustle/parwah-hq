// The small rules that keep one family's data out of another's screen, in one
// dependency-free module so the deploy gate can unit-test them on a fresh
// clone, before npm install. Each one exists because it was got wrong.

// THE ESCAPER DID NOT ESCAPE QUOTES. textContent -> innerHTML handles &, <
// and >, but the output is placed inside DOUBLE-QUOTED attributes in ten
// places (data-mention, data-qtalk, data-gopen and the rest), so a family
// member whose name or request title contained a quote closed the attribute
// and everything after it became live attributes - onerror included.
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escHtml(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

// A data: URI that merely STARTS correctly is not safe: everything after the
// prefix went into an src attribute unescaped, so `data:image/png;base64,x"
// onerror=...` ran in every member's browser. The whole string must be
// base64 and nothing else. SVG is deliberately absent: it carries script.
const IMG_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function safeImageUri(t) {
  const s = String(t === null || t === undefined ? '' : t);
  return IMG_URI.test(s) ? s : null;
}

// A private entry's NAME is as private as the entry. The circle still learns
// that the memory grew - that is the habit worth encouraging - but not what
// was written.
export function feedName(visibility, name) {
  return visibility === 'private' ? 'something private' : name;
}
