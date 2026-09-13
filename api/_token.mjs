// Where the session token travels. A header, so it never lands in a server
// log, a Referer, or a screenshot of the address bar the way a query string
// would. The body is accepted too, because the app posts JSON everywhere and
// one shape for both verbs is one thing less to get wrong.
export function tokenOf(req) {
  const h = req && req.headers ? (req.headers['x-parwah-token'] || req.headers['X-Parwah-Token']) : null;
  if (h) return String(h);
  const b = req && req.body ? req.body.token : null;
  return b ? String(b) : null;
}
