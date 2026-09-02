#!/usr/bin/env python3
"""Parwah site test suite — run after ANY change; all checks must pass before commit."""
import re, sys, subprocess, tempfile
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
PAGES = [ROOT / "public" / "index.html", ROOT / "public" / "story" / "index.html", ROOT / "public" / "launch" / "index.html", ROOT / "public" / "get" / "index.html"]
FAILS = []

def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  — " + detail) if detail else ""))
    if not ok: FAILS.append(name)

# ---------- 1. HTML well-formedness ----------
class Validator(HTMLParser):
    VOID = {"area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"}
    def __init__(self):
        super().__init__(convert_charrefs=True); self.stack=[]; self.errors=[]
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID: self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack: self.errors.append(f"stray </{tag}>"); return
        if self.stack[-1]==tag: self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1]!=tag: self.errors.append(f"unclosed <{self.stack.pop()}>")
            self.stack.pop()
        else: self.errors.append(f"unmatched </{tag}>")

for p in PAGES:
    v = Validator(); v.feed(p.read_text(encoding="utf-8"))
    errs = v.errors + [f"unclosed <{t}>" for t in v.stack]
    check(f"HTML structure: {p.relative_to(ROOT)}", not errs, "; ".join(errs[:4]))

# ---------- 2. Internal links resolve ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8"); bad = []
    for href in re.findall(r'href="([^"]+)"', html):
        if href.startswith(("http","mailto:","#")): continue
        target = (p.parent / href.split("#")[0]).resolve()
        if target.is_dir(): target = target / "index.html"
        if not target.exists(): bad.append(href)
    check(f"internal links: {p.relative_to(ROOT)}", not bad, ", ".join(bad))

# ---------- 3. Anchor targets exist ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    ids = set(re.findall(r'id="([^"]+)"', html)); bad = []
    for href in re.findall(r'href="#([^"]+)"', html):
        if href not in ids: bad.append("#"+href)
    check(f"anchor targets: {p.relative_to(ROOT)}", not bad, ", ".join(bad))

# ---------- 4. Banned therapeutic claims (ASCI guardrail) ----------
BANNED = ["cure","treats ","treatment","heals","prevent","reverse","remedy",
          "medicine","therapeutic","clinically proven","doctor recommended",
          "pain relief","arthritis relief","guaranteed result"]
for p in PAGES:
    text = re.sub(r"<[^>]+>"," ", p.read_text(encoding="utf-8")).lower()
    # mandatory legal disclaimer uses negative claim language — exempt it, keep marketing copy strict
    text = text.replace("our products are not medicines and are not intended to diagnose", "")
    hits = sorted({b for b in BANNED if b in text})
    check(f"zero-claims scan: {p.relative_to(ROOT)}", not hits, ", ".join(hits))

# ---------- 5. WhatsApp number guard (real number live; placeholder must never return) ----------
WA_NUMBER = "919873945238"
ph = sum(p.read_text(encoding="utf-8").count("91XXXXXXXXXX") for p in PAGES)
wa = sum(p.read_text(encoding="utf-8").count(f"wa.me/{WA_NUMBER}") for p in PAGES)
check("wa.me placeholder fully replaced", ph == 0, f"found {ph} leftover placeholder link(s)")
check("wa.me links present and consistent", wa == 3, f"expected 3 links to wa.me/{WA_NUMBER}, found {wa}")

# ---------- 6. A11y basics ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    ok = ('lang="en"' in html and 'name="viewport"' in html
          and html.count("<h1") == 1 and 'aria-label' in html)
    check(f"a11y basics (lang/viewport/single-h1/aria): {p.relative_to(ROOT)}", ok)
css = (ROOT/"public"/"styles.css").read_text(encoding="utf-8")
check("a11y: focus-visible style", ":focus-visible" in css)
check("a11y: reduced motion respected", "prefers-reduced-motion" in css)

# ---------- 7. CSS sanity ----------
check("css braces balanced", css.count("{") == css.count("}"),
      f'{css.count("{")} open vs {css.count("}")} close')
for var in ["--dusk","--marigold","--day","--disp","--body","--dev"]:
    check(f"css token defined: {var}", var+":" in css)

# ---------- 8. JS syntax (node --check on extracted scripts) ----------
for p in PAGES:
    for i, js in enumerate(re.findall(r"<script>(.*?)</script>", p.read_text(encoding="utf-8"), re.S)):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(js); tmp = f.name
        r = subprocess.run(["node","--check",tmp], capture_output=True, text=True)
        check(f"js syntax: {p.relative_to(ROOT)} script#{i}", r.returncode == 0, r.stderr.strip()[:120])

# ---------- 9. Shared stylesheet + fonts wired ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    check(f"styles.css linked: {p.relative_to(ROOT)}", "styles.css" in html)
    check(f"fonts wired: {p.relative_to(ROOT)}", "fonts.googleapis.com" in html and "Fraunces" in html)


# ---------- 10. SECURITY ----------
import json as _json
REPO = ROOT.parent.parent if (ROOT.parent.parent / "vercel.json").exists() else ROOT.parent
API_DIR = REPO / "api"

# 10a. secret scan — no credentials anywhere in tracked source
SECRET_PATTERNS = [
    (r"sk-ant-[A-Za-z0-9\-_]{10,}", "anthropic key"),
    (r"sk-[A-Za-z0-9]{40,}", "api secret key"),
    (r"vcp_[A-Za-z0-9]{20,}", "vercel token"),
    (r"napi_[A-Za-z0-9]{20,}", "neon token"),
    (r"AKIA[0-9A-Z]{16}", "aws key"),
    (r"-----BEGIN( RSA| EC)? PRIVATE KEY-----", "private key"),
    (r"postgres(ql)?://[^\s\"']*:[^\s\"']*@", "db url with password"),
    (r"eyJhbGciOi[A-Za-z0-9_\-]{30,}", "jwt token"),
]
scan_files = [f for f in REPO.rglob("*")
              if f.is_file() and f.suffix in (".mjs", ".js", ".html", ".json", ".md", ".yml", ".sql", ".sh", ".py")
              and ".git" not in f.parts and "node_modules" not in f.parts]
for pat, label in SECRET_PATTERNS:
    hits = [str(f.relative_to(REPO)) for f in scan_files if re.search(pat, f.read_text(encoding="utf-8", errors="ignore"))]
    check(f"security: no {label} committed", not hits, ", ".join(hits[:3]))

# 10b. security headers enforced platform-wide
vj = _json.loads((REPO / "vercel.json").read_text(encoding="utf-8"))
hdrs = {h["key"] for blk in vj.get("headers", []) for h in blk.get("headers", [])}
for need in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
    check(f"security header set: {need}", need in hdrs)

# 10c. every data endpoint proves circle membership before touching data
# every module that touches circle data must prove membership first
GUARDED = ["_boardapi", "_keysapi", "_pushapi", "_vaultapi", "book", "care", "chats", "circle", "events", "games", "plans"]
for name in GUARDED:
    f = API_DIR / f"{name}.mjs"
    if not f.exists():
        check(f"membership guard present: api/{name}.mjs", False, "file missing"); continue
    src = f.read_text(encoding="utf-8")
    check(f"membership guard present: api/{name}.mjs",
          "Not a member of this circle" in src and "circleByCode" in src)

# 10d. SQL only ever through the tagged-template driver (parameterized)
for f in sorted(API_DIR.glob("*.mjs")):
    src = f.read_text(encoding="utf-8")
    check(f"security: no string-built sql in api/{f.name}",
          "sql(" not in src.replace("sql('','')", "") and ".query(" not in src)

# 10e. service worker never caches API responses; app JS avoids eval
sw = (REPO / "site/public/app/sw.js").read_text(encoding="utf-8")
check("security: service worker bypasses /api/", "/api/" in sw)
app_html = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("security: no eval in app", "eval(" not in app_html and "new Function(" not in app_html)

# 10f. THE VAULT — the promises made to the family are checked here, not
# trusted to the interface. A change that breaks one of these cannot deploy.
vault = (API_DIR / "_vaultapi.mjs").read_text(encoding="utf-8")
check("vault: a full identity number is never stored",
      "last4" in vault and not re.search(r"(number|aadhaar|pan)\s*(text|=\s*clean\()", vault),
      "only the last four digits may be persisted")
# The ID rules moved to _docid.mjs so the FIELD can apply them as the family
# types, instead of the server refusing at save time. Both still check.
docid = (API_DIR / "_docid.mjs").read_text(encoding="utf-8")
check("vault: Aadhaar numbers are checksum-verified",
      "verhoeffOk" in docid and "V_D" in docid and "checkNumber" in vault)
check("vault: the server still has the last word on a number",
      "const chk = checkNumber(kind, body.number);" in vault
      and "return res.status(400).json({ ok: false, error: chk.why });" in vault)
# The only free, legitimate PAN signals: the 4th and 5th characters, both
# published by the Income Tax Department. The 10th is a check digit whose
# algorithm has never been published — so we must not pretend to check it.
check("vault: a PAN is read for what it actually encodes",
      "PAN_HOLDER" in docid and "panFacts" in docid
      and "an individual" in docid and "a company" in docid)
check("vault: and never claims to verify the undisclosed check digit",
      "has never published" in docid and "does NOT pretend" in docid)
_appv = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("vault: a surname mismatch is a note, never a refusal",
      "Worth a look" in _appv and "not every name puts the surname last" in _appv
      and "vPanNote" in _appv)
check("vault: card credentials are refused outright",
      "credentialRisk" in vault and "cvv" in vault.lower() and "never stores a full card number" in vault)
check("vault: a document is invisible without a grant",
      "a.member_id is not null" in vault and "not shared with you" in vault)
check("vault: only the owner decides who sees their papers",
      "Only the person this document belongs to can decide who sees it" in vault)
check("vault: opening a document is logged and the owner is told",
      "'opened'" in vault and "every open is recorded" in vault)
check("vault: you cannot verify a document you uploaded yourself",
      "someone else in the family needs to check it" in vault)
check("vault: only the owner re-permissions their payment method",
      "ownedMethod" in vault and "owner_member !== me.id" in vault)
check("vault: uploads are size- and type-limited",
      "MAX_FILE" in vault and "OK_MIME" in vault)
app_src = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("vault: the app never renders more than a masked number",
      "'•••• •••• '" in app_src and "'••••' + esc(d.last4)" in app_src)

# 10g. WAY IN — a short invite code must not be the whole security model.
dbsrc = (API_DIR / "_db.mjs").read_text(encoding="utf-8")
circ = (API_DIR / "circle.mjs").read_text(encoding="utf-8")
auth = (API_DIR / "auth.mjs").read_text(encoding="utf-8")
check("join: approval is the default for every circle",
      "join_policy text not null default 'approve'" in dbsrc)
check("join: a code alone creates a request, not a membership",
      "insert into join_requests" in circ and "pending: true" in circ)
check("join: any member can decide, there is no owner",
      "approve_join" in circ and "decline_join" in circ and "Not a member of this circle" in circ)
check("rate limit: join attempts are capped", "rateLimit(sql, 'join'" in circ)
check("rate limit: sign-in attempts are capped", "rateLimit(sql, 'auth'" in auth)
check("rate limit: counted in the database, not per instance",
      "create table if not exists rate_limit" in dbsrc and "make_interval" in dbsrc)
check("rate limit: a broken limiter never locks the family out",
      "catch (e) { return true; }" in dbsrc)

# 10h. COINS — the credit that pays for Ekta.
coins = (API_DIR / "_coins.mjs").read_text(encoding="utf-8")
ekta = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
check("coins: the balance is the ledger, never a stored number",
      "sum(delta)" in coins and "balance integer" not in coins)
check("coins: earning pays once, enforced by an index",
      "coins_once" in coins and "on conflict do nothing" in coins)
check("coins: awarding can never break the action that earned it",
      "catch (e) { return 0; }" in coins)
check("coins: Ekta is paid for out of the family pot",
      "spend(sql, circle.id, me.id, 'ekta')" in ekta and "needCoins" in ekta)
check("coins: an unanswered turn is refunded", "'refund'" in ekta)
check("coins: an empty pot refuses rather than going negative",
      "if (have < cost) return { ok: false" in coins)

# 10i. MULTI-CIRCLE — a person in several families must see which needs them.
check("circles: each carries what is waiting in it",
      all(k in auth for k in ('"unread"', '"waiting"', '"openRequests"', '"live"')))
check("circles: your own messages never count as unread",
      "ms.member_id is distinct from m.id" in auth)
check("circles: unread respects private chats you are not in",
      "ch.kind = 'circle' or cm.member_id is not null" in auth)
appsrc = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("circles: the sign-in list leads with the circle that needs you",
      "circleSignals" in appsrc and "needsyou" in appsrc)

# 10j. MEMORY CONSENT — a fact about a person is that person's to share.
book = (API_DIR / "book.mjs").read_text(encoding="utf-8")
check("memory: entries can be private to their subject",
      "visibility text not null default 'circle'" in book and "book_access" in book)
check("memory: consent belongs to the person it is about, not the author",
      "Only the person this is about can decide who sees it" in book and "subjectOf" in book)
check("memory: a private entry cannot be read, edited or removed without a grant",
      book.count("readable(") >= 4 and "That is not shared with you" in book)
check("memory: every consent change is written to a ledger", "book_consent" in book)
check("memory: preparedness counts private entries without exposing them",
      "const mine = all.filter" in book and "can_see" in book)

# 10k. ONBOARDING — a first-ever sign-in must explain the app, and everyone
# must be able to start a family or a group.
check("onboarding: the introduction is recorded per person, not per device",
      "toured_at" in dbsrc and "action === 'toured'" in auth and "toured: !!user.toured_at" in auth)
check("onboarding: a circle is a family or a group",
      "kind text not null default 'family'" in dbsrc and "kind === 'group' ? 'group' : 'family'" in circ)
check("onboarding: a first-ever sign-in is shown what the app is",
      "TOUR = [" in appsrc and "if (toured === false) { showTour(); return; }" in appsrc)
check("onboarding: the interface is pointed at once, then never again",
      "startCoach" in appsrc and "action:'toured'" in appsrc)
check("onboarding: starting a family or a group is offered everywhere",
      all(k in appsrc for k in ("cs-newfam", "cs-newgrp", "side-newcircle", "d-newcircle", "pickkind")))

# 10l. LAYOUT — sidebar-only controls must never reach the mobile tab bar.
check("layout: .side-only is specific enough to beat .tabs button",
      ".tabs .side-only{display:none}" in appsrc and ".tabs .side-only{display:flex}" in appsrc)
check("layout: the desktop content is not capped at a phone width",
      "body.inapp .wrap{max-width:1560px" in appsrc)
# Memory and the Vault are "a list, and a form to add to it". On a wide window
# that was one narrow ribbon with the form scrolled off. The grid spans below
# must match how many children each list view actually puts in column one —
# add a filter row and forget the span, and the form detaches from the list.
_lv = {"book-list-view": 4, "vd-list-view": 2}
_spans = []
for cid, want in _lv.items():
    m = re.search(r'<div id="%s">' % cid, appsrc)
    depth, i, kids = 1, m.end(), 0
    for t in re.finditer(r'<(/?)(div|select|details)\b[^>]*>', appsrc[i:]):
        closing, name = t.group(1), t.group(2)
        if name == "select":
            if depth == 1 and not closing: kids += 1
            continue
        if closing:
            depth -= 1
            if depth == 0: break
        else:
            if depth == 1: kids += 1
            depth += 1
    left = kids - 1                       # the last child is the form itself
    css = "#%s>.card{grid-row:1/span %d}" % (cid, left)
    if left != want or css not in appsrc:
        _spans.append("%s: %d in the left column, css says %s" % (cid, left, want))
check("layout: the add-form rail spans the whole list beside it",
      not _spans, "; ".join(_spans))
check("layout: a list that owns a column is allowed to use it",
      "#pane-memory .feed,#pane-vault .feed,.subsec .feed{max-width:none}" in appsrc
      and "@media(min-width:1180px)" in appsrc)
# The sidebar is taller than many laptop screens. Everything below "Together"
# used to be clipped with no way to reach it.
check("layout: the sidebar scrolls instead of clipping what does not fit",
      ".tabs .inner{flex-direction:column" in appsrc and "overflow-y:auto" in appsrc
      and "was simply clipped and unreachable" in appsrc)
check("layout: the brand and the account line stay put while it scrolls",
      ".side-brand{position:sticky" in appsrc and ".side-user{position:sticky" in appsrc)
check("layout: Today uses two columns on a wide screen",
      "homerail" in appsrc and "homemain" in appsrc and "@media(min-width:1240px)" in appsrc)

# 10m. THINGS TO DO, SOS ESCALATION, PRICING.
care = (API_DIR / "care.mjs").read_text(encoding="utf-8")
events = (API_DIR / "events.mjs").read_text(encoding="utf-8")
plan = (API_DIR / "_planapi.mjs").read_text(encoding="utf-8")
check("todo: reminders and jobs are one list, not two tabs",
      "Anyone can pick these up" in appsrc and "'#qlist'" not in appsrc.split("id=\"qlist\"")[0])
check("todo: one form raises either kind, decided by who it is for",
      "who === 'any'" in appsrc and "request_create" in appsrc and "reminder_create" in appsrc)
check("todo: suggestions come from what the family already recorded",
      "careSuggestions" in care and "vault_docs" in care and "family_book" in care)
check("todo: a suggestion is never created behind the family's back",
      "data-sadd" in appsrc and "Nothing here is real until you add it" in appsrc)
check("todo: nothing already being done is suggested again",
      "busy.has(s.title.toLowerCase())" in care)
check("sos: an SOS is an open state, not a feed line",
      "create table if not exists sos" in events and "sos_ack" in events and "sos_resolve" in events)
check("sos: escalation fires exactly once across instances",
      "escalated = true" in events and "and escalated = false returning id" in events)
check("sos: escalation never breaks a read",
      "escalation must never break a read" in events)
check("pricing: dual currency at a fixed, stated rate",
      "USD_RATE = 85" in plan and "priceOf" in plan)
check("pricing: no payment rails, and the page says so",
      "charged: false" in plan and "Nothing is charged" in appsrc)
check("pricing: Indian digit grouping is not hand-rolled",
      "Intl.NumberFormat('en-IN')" in appsrc)

# 10n. THE GATE MUST RUN ON A FRESH CLONE.
# It failed on a real machine because the phone unit test imported _db.mjs,
# which imports the database driver — absent before npm install.
phonesrc = (REPO / "site/tests/phonetest.mjs").read_text(encoding="utf-8")
phonemod = (API_DIR / "_phone.mjs").read_text(encoding="utf-8")
check("gate: the phone unit test does not need the database driver",
      "_phone.mjs" in phonesrc and "_db.mjs" not in phonesrc)
check("gate: the phone rules module has no imports at all",
      not re.search(r"^\s*import\s", phonemod, re.M))
check("gate: _db still re-exports the phone helpers for everything else",
      "export { PHONE_CC, normPhone, phoneError } from './_phone.mjs'" in dbsrc)
deploysh = (REPO / "ops/deploy.sh").read_text(encoding="utf-8")
check("deploy: dependencies are installed before the gate runs",
      "npm install" in deploysh and "node_modules" in deploysh)
check("deploy: a gate failure shows its output instead of hiding it",
      "tail -40" in deploysh and "Full output" in deploysh)
check("deploy: every vercel step shows its output on failure",
      "run_vercel()" in deploysh and ">/dev/null 2>&1" not in deploysh.split("run_vercel()")[1])
# The anti-pattern is `local rc=$?` as a STATEMENT; the comment explaining it
# mentions the same text, so match code lines only.
_codelines = [l.strip() for l in deploysh.splitlines() if not l.strip().startswith("#")]
check("deploy: the exit status captured is the command's, not local's",
      not any(re.match(r"^local\s+\w+=\$\?", l) for l in _codelines))
check("deploy: a failure names its own kind instead of blaming the token",
      "vercel_hint()" in deploysh and "could not reach api.vercel.com" in deploysh)
check("deploy: a fresh clone gets its project link written",
      ".vercel/project.json" in deploysh and "mkdir -p .vercel" in deploysh)
vign = (REPO / ".vercelignore").read_text(encoding="utf-8")
check("deploy: the private hq/ directory can never be uploaded",
      "hq/" in vign and ".claude/" in vign and "CLAUDE.md" in vign)
check("deploy: local artefacts stay out of the upload",
      "node_modules/" in vign and ".git/" in vign)
# Match CODE lines only — the comment explaining why pull and build were
# dropped necessarily names them, and tripped the first version of this.
_dcode = "\n".join(l for l in deploysh.splitlines() if not l.strip().startswith("#"))
check("deploy: source is deployed and built by Vercel, not pushed prebuilt",
      "deploy --prod --yes" in _dcode and "--prebuilt" not in _dcode
      and "vercel pull" not in _dcode and "vercel build" not in _dcode)
# A token in a shell profile goes stale long before anyone notices. Falling
# back to the login this machine already has is the difference between a
# deploy and a support round trip.
check("deploy: a stale token falls back to the login on this machine",
      "AUTH_MODE=login" in deploysh and "falling back to the login" in deploysh
      and 'AUTH_MODE=token' in deploysh)
check("deploy: no token at all is not a failure when someone is signed in",
      'if [ -n "${VERCEL_TOKEN:-}" ]; then' in deploysh
      and "no VERCEL_TOKEN" not in deploysh)
check("deploy: credentials are chosen once, not repeated at every call",
      "vc deploy --prod" in _dcode and "vc whoami" in _dcode
      and _dcode.count("--token=") == 1)
# macOS still ships bash 3.2, where an empty array under `set -u` is an
# unbound variable — which is why the credential is a string, not an array.
check("deploy: the credential switch works on bash 3.2",
      "AUTH_MODE" in deploysh and "=()" not in _dcode)
check("deploy: a gate failure reports the gate's exit code, not the if's",
      "RC=$?" in _dcode and "if ! bash scripts/checks.sh" not in _dcode)
check("deploy: the day's arithmetic is checked on the build that went live",
      "probe=day" in deploysh and "muhurat self-test is RED" in deploysh)
check("deploy: someone else's uptime never fails our deploy",
      '*\'"ok":false\'*' in deploysh and "not fatal" in deploysh)
# A silent wait looks exactly like a hang. The first real deploy was killed
# with Ctrl-C during it — and the red self-test underneath went unseen.
check("deploy: the wait says what it is waiting for",
      "attempt $i/40" in deploysh and "waiting for the build to go live" in deploysh)
check("deploy: it says the deploy is already live before it starts verifying",
      "ALREADY LIVE" in deploysh and "Ctrl-C" in deploysh)
check("deploy: a red self-test is called in two minutes, not seven",
      "RED=$((RED + 1))" in deploysh and '[ "$RED" -ge 12 ]' in deploysh)
check("deploy: a failure names the steps that failed",
      "failing steps:" in deploysh and "grep -vx ok" in deploysh)
check("deploy: works on a machine without flock (macOS)",
      "command -v flock" in deploysh and 'mkdir "$LOCK.d"' in deploysh)

# 10o. THE PARENT VALIDATION GUIDE — the five concept screens it specifies.
pulse = (API_DIR / "_pulse.mjs").read_text(encoding="utf-8")
# This one passed for weeks against no database and failed the first time it
# met a real one — because it asserted a comparison instead of the counts, and
# never exercised the read cursor at all.
_st = (API_DIR / "_selftest.mjs").read_text(encoding="utf-8")
check("selftest: unread asserts exact counts, not a vague comparison",
      "papaUnread === 2 && betaUnread === 2" in _st and "betaUnread[0].n < papaUnread" not in _st)
check("selftest: reading a chat is what makes its messages stop counting",
      "papaAfterReading === 1" in _st and "insert into chat_reads" in _st)
check("selftest: a read cursor belongs to one person",
      "betaStillUnread === 2" in _st)
check("guide: one readiness number for the FAMILY, not six per-person bars",
      '"Your family is <span id="rd-pct">' in appsrc.replace("'", '"') or 'id="rd-pct"' in appsrc)
check("guide: the number is backed by named gaps and a complete-N call to action",
      "gapCount" in book and "rd-gaps" in appsrc and "Complete " in appsrc)
check("guide: someone near a person living away is a first-class contact",
      "'local'" in book and "someone near them to call" in book)
check("guide: the pulse asks how people are, in a style that rotates daily",
      "How are my people today" in appsrc and "styleFor" in pulse and len(re.findall(r"^\s{2}\w+: \{ name:", pulse, re.M)) == 5)
check("guide: an answer can quietly say a call would be nice",
      "call: true" in pulse and "could do with a call" in (API_DIR / "events.mjs").read_text(encoding="utf-8"))
check("guide: everyone in a circle sees the same question on the same day",
      "derived from the date" in pulse or "same style for everyone" in pulse)
check("guide: the plan is named and bundled as the guide names it",
      "Parwah Family Plan" in plan and "'Family Readiness'" in plan and "'Family Pulse'" in plan)

# 10p. THE GUIDE'S REMAINING SCREENS — 1, 2 and 4.
ekta_src = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
check("guide screen 1: the home leads with people carrying a short status line",
      'id="fam-cards"' in appsrc and "Important information up to date" in appsrc
      and "View family" in appsrc and "You decide who can see what" in appsrc)
check("guide screen 2: one person, in the five sections the guide names",
      all(x in appsrc for x in (">🩺 Health<", ">📄 Records<", ">📞 People to call<",
                                ">💡 Useful to know<", ">🕒 Freshness<")))
check("guide screen 2: Records shows that a document exists, never the document",
      "has_file" in book and "d.about_member" in book and "encode(bytes" not in book)
check("guide screen 4: Ekta can prepare a summary for a doctor visit",
      "prepare_summary" in ekta_src and "someoneNearThem" in ekta_src)
check("guide screen 4: the summary reports what is MISSING, not only what is there",
      "missing" in ekta_src and "what is absent matters as much" in ekta_src)
check("guide screen 4: Ekta retrieves and organises, and never diagnoses",
      "not medical advice" in ekta_src and "ZERO medical advice" in ekta_src)

# 10q. WHO GETS TOLD.
# A notification about something involving two people must not reach the whole
# family. Every circle-wide push has to be one of a short, deliberate list.
CIRCLE_WIDE_OK = {
    # (file, fragment of the title) -> why the whole circle is right
    ("circle.mjs", "wants to join"):      "any member can let them in",
    ("circle.mjs", "joined"):             "a new family member concerns everyone",
    ("circle.mjs", "Invite code is now"): "old invite links stop working for all",
    ("circle.mjs", "how people join"):    "changes the door for everyone",
    ("circle.mjs", "left"):               "everyone should know who is in",
    ("events.mjs", "SOS"):                "an emergency is everyone's business",
    ("events.mjs", "STILL NOBODY"):       "nobody answered — shout louder",
    ("events.mjs", "is on it"):           "so nobody else duplicates the trip",
    ("events.mjs", "alright"):            "stop the whole family worrying",
    ("events.mjs", "on now"):             "a live call is open to all",
    ("events.mjs", "could do with a call"): "the point of the pulse",
    ("care.mjs",   "needs a hand"):       "a job anyone can pick up",
    ("plans.mjs",  ""):                   "a plan invites the whole circle",
    ("games.mjs",  "lobby is open"):      "an open lobby invites everyone",
}
def _push_calls(src):
    out = []
    for m in re.finditer(r"pushCircle\(", src):
        i, depth = m.end(), 1
        while depth and i < len(src):
            if src[i] == "(": depth += 1
            elif src[i] == ")": depth -= 1
            i += 1
        out.append(src[m.start():i])
    return out
broadcasts, targeted = [], 0
for f in sorted(API_DIR.glob("*.mjs")):
    if f.name == "_push.mjs": continue
    for call in _push_calls(f.read_text(encoding="utf-8")):
        # A targeted push names only: or except: somewhere in its options; a
        # broadcast passes {} or nothing. Scanning the whole call avoids
        # depending on the payload being a literal object.
        if re.search(r"\{\s*(only|except)\s*:", call):
            targeted += 1; continue
        # Titles are built by concatenation, so the first string literal is
        # only a prefix — match the fragment anywhere in the call.
        if not any(f.name == fn and (frag == "" or frag in call) for (fn, frag) in CIRCLE_WIDE_OK):
            t = re.search(r"title:\s*'([^']*)", call)
            broadcasts.append(f"{f.name}: {(t.group(1) if t else call[:40])[:44]}")
check(f"notifications: every circle-wide push is a deliberate one ({targeted} targeted)",
      not broadcasts, "; ".join(broadcasts[:4]))
games = (API_DIR / "games.mjs").read_text(encoding="utf-8")
check("notifications: game news reaches the players, not the family",
      "pushPlayers" in games and "!isBot(p)" in games)
check("games: you can play alone, against a named opponent",
      "export const BOT" in games and "soloPlayers" in games and "tttBotCell" in games)
check("games: a solo game is never announced to the family",
      "if (!solo)" in games and "not announced to the family" in games)
check("games: the bot flag survives seating, or a solo duel freezes",
      "const seat = (p)" in games)

# ---------- 10b. The day: muhurat and rashi ----------
# The point of the section is that a family split across cities sees the SAME
# screen: the parent reads the Choghadiya they have always kept, the grandchild
# in London reads what it means. So the English gloss is not decoration — it is
# the feature, and it is checked.
pan = (API_DIR / "_panchang.mjs").read_text(encoding="utf-8")
horo = (API_DIR / "_horoscope.mjs").read_text(encoding="utf-8")
plc = (API_DIR / "_places.mjs").read_text(encoding="utf-8")
dayapi = (API_DIR / "_dayapi.mjs").read_text(encoding="utf-8")
appday = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")

check("day: muhurat is computed from sunrise, never fetched",
      "fetch(" not in pan and "import" not in pan.split("export")[0],
      "_panchang.mjs must stay dependency-free and offline")
check("day: every Choghadiya name carries a plain-English meaning",
      all(f"{n}:" in pan and "en:" in pan for n in
          ("Udveg", "Chal", "Labh", "Amrit", "Kaal", "Shubh", "Rog")))
_named = {"rahuKaal": "Rahu Kaal", "gulikaKaal": "Gulika", "yamaganda": "Yamaganda", "abhijit": "Abhijit"}
_unexplained = [k for k, word in _named.items()
                if not re.search(k + r":[^}]*?en:\s*'([^']{40,})'", pan, re.S)
                or word not in (re.search(k + r":[^}]*?en:\s*'([^']{40,})'", pan, re.S).group(1))]
check("day: Rahu Kaal, Gulika, Yamaganda and Abhijit each carry a real English explanation",
      not _unexplained, ", ".join(_unexplained))
check("day: the timings belong to a city, not to the country",
      "placeOf" in dayapi and "me.place" in dayapi and "lat" in plc)
check("day: an unrecognised place is flagged rather than passed off as known",
      "guessed: true" in plc and "mu-guess" in appday)
check("day: all twelve rashis, named in English and Hindi",
      horo.count("hi: '") == 12 and "SIGNS" in horo)
check("day: a horoscope is never invented when the source is unreachable",
      "never a fabrication" in horo and "if (!g.text) continue;" in horo
      and "unavailable" in horo and "rather than inventing one" in appday)
check("day: readings are fetched once a day for the whole family, not per screen",
      "on conflict (day, sign) do nothing" in horo and "create table if not exists horoscope" in horo)
# The screen answers one question — "is now a good time?" — before it shows
# anything else. Sixteen equal cards was the answer to a different question.
check("day: the screen leads with a verdict, not a table",
      "currentPeriod" in pan and "renderMuhurat" in appday
      and "A good time right now" in appday and "Better to wait" in appday)
check("day: and says what to do next, so the verdict is actionable",
      "Next good window:" in appday and "This window ends at" in appday)
# Abhijit is auspicious and used to sit under a heading that said "avoid".
check("day: the fixed-times card does not call an auspicious window a bad one",
      "Times to avoid today" not in appday and "Times worth knowing" in appday)
check("day: the sixteen windows are a reference, behind a disclosure",
      "See every Choghadiya" in appday and "details class=\"more\"" in appday)
check("day: all twelve rashis are behind a disclosure too, yours is not",
      "See all twelve rashis" in appday and 'id="ho-mine"' in appday)
# Good/avoid is a STATUS, and status must never be carried by colour alone.
check("day: the day band never means anything by colour alone",
      "tlkey" in appday and "Better to wait</span>" in appday
      and 'class="sr"' in appday and 'role="img"' in appday)
check("day: the band is drawn in real time, not equal boxes",
      "/ span * 100" in appday and "flex:0 0 " in appday)
# The screen explains the arithmetic to the family, so the explanation has to
# be the truth: the tables are regenerated from the planets, not copied.
check("day: the Choghadiya sequence is derived from the planets, not a copied table",
      "derivedDaySeq" in pan and "derivedNightSeq" in pan and "CHALDEAN" in pan
      and "WEEKDAY_LORD" in pan and "LORD_OF" in pan)
check("day: every period carries the planet that rules it",
      "lord: LORD_OF[n]" in pan and 'mu-lords' in appday)
check("day: Abhijit is the 8th of fifteen muhurtas, not an eighth of the day",
      "dayMs / 30" in pan and "EIGHTH MUHURTA OF FIFTEEN" in pan)
check("day: the day is the member's own day, not the server's",
      "Intl.DateTimeFormat('en-CA', { timeZone: place.tz })" in dayapi)
check("day: the screen explains how the timings are worked out",
      'id="mu-how"' in appday and "How this is worked out" in appday
      and "eight equal parts" in appday and "NOAA" in appday)
# It computes a tropical sun sign. Calling that a Vedic rashi would be a lie.
check("day: the app never claims to know a rashi it cannot compute",
      "SIGN_BASIS" in horo and "MOON sign" in horo and "must not say that it does" in horo
      and "does not claim" in appday and "moon sign" in appday)
check("day: and says which zodiac the reading is actually written for",
      'id="ho-how"' in appday and "signBasis" in appday and "sun sign" in appday)
check("day: the rashi needs a birthday, and asks for one instead of guessing",
      "ho-nodob" in appday and "e-dob" in appday and "signOf" in horo)
check("day: the day section is reachable from the tabs and the drawer",
      appday.count('data-tab="day"') >= 2 and "'day'" in appday and "refreshDay" in appday)
check("day: the unit test runs in the deploy gate",
      "daytest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("day: the source is testable from production with one URL",
      "probe=day" in (API_DIR / "diag.mjs").read_text(encoding="utf-8")
      and (API_DIR / "_dayselftest.mjs").exists()
      and "almanac" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8"))
check("day: the probe separates our arithmetic from someone else's uptime",
      "arithmetic: { ok:" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8")
      and "source" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8")
      and "never invents one" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8"))

# ---------- 10c. Knowing what this is, without an account ----------
# Feedback from a tester: "I can't know a lot about this without signing in."
# They were right — on a phone the entry screen was a headline and a phone
# field. The validation guide asks for the same thing from the other side:
# show five narrow concept screens, and NOT the full app.
appob = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("entry: a phone sees what Parwah is, not only a sign-in box",
      '<div class="obpoints">' in appob and 'class="obpoints deskonly"' not in appob)
check("entry: the explanation is legible on the cream ground, not sidebar grey",
      ".obpoint{display:flex;gap:11px;align-items:flex-start;font-size:.92rem;line-height:1.45;color:var(--ink-soft)}" in appob)
check("entry: there is a way to see the product before it asks for anything",
      'id="au-see"' in appob and 'id="demo-step"' in appob and "showStep('demo')" in appob)
check("entry: an interview can open straight onto the concept",
      "demoWanted()" in appob and "get('demo') === '1'" in appob)
_demo = appob[appob.index("var DEMO = ["):appob.index("var demoAt = 0;")]
check("guide demo: the five screens the guide specifies, then the price",
      all(k in _demo for k in ("'promise'", "'memory'", "'ekta'", "'pulse'", "'ready'", "'plan'")))
check("guide demo: screen 1 is the promise and four people, nothing else",
      "nobody should have to scramble" in _demo and "You decide who can see what" in _demo)
check("guide demo: screen 2 carries the guide's own five sections",
      all(x in _demo for x in ("🩺 Health", "📁 Records", "📞 People to call",
                               "💡 Useful to know", "🕒 Freshness")))
check("guide demo: screen 3 is the readiness number with named gaps",
      "78% ready" in _demo and "insurance card missing" in _demo)
check("guide demo: Ekta retrieves and never diagnoses",
      "Prepare summary" in _demo and "does not diagnose" in _demo)
check("guide demo: the pulse can quietly ask for a call",
      "a call would be nice" in _demo)
check("guide demo: the price comes last, per family, in both currencies",
      "2,499" in _demo and "per family, per year" in _demo and "29.99" in _demo)
# "Do NOT show chat, games, gifting, calls or a feature menu here."
_banned = [w for w in ("chat", "game", "gift", "video call", "Snakes", "Antakshari")
           if w.lower() in _demo.lower()]
check("guide demo: none of what the guide forbids on these screens",
      not _banned, ", ".join(_banned))
check("guide demo: it is plainly an example, not someone's real family",
      "not real people" in appob and "nothing is sent anywhere" in appob)

# ---------- 10d. Addresses that are real, not just typed ----------
# A free-text box gives you "S-354, Greater Kailash 2" — no city, no state,
# and no way to know the PIN even matches the locality. India Post publishes
# that mapping free, so six digits fill in the rest.
pin = (API_DIR / "_pin.mjs").read_text(encoding="utf-8")
pinapi = (API_DIR / "_pinapi.mjs").read_text(encoding="utf-8")
appad = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")

check("address: the PIN rules are dependency-free, like the phone rules",
      "import" not in pin.split("export")[0] and "PIN_SOURCE" in pin)
check("address: six digits, and never one starting 0",
      "p[0] === '0'" in pin and "p.length !== 6" in pin)
check("address: a PIN is fetched once and kept, not on every keystroke",
      "create table if not exists pincode" in pin and "on conflict (pin) do nothing" in pin
      and "where pin = ${pin}" in pin)
check("address: a city is never guessed from a PIN we could not check",
      "unknown: true" in pin and "type the city and state yourself" in pin
      and "nothing here fills a gap with a plausible value" in pin)
check("address: the lookup needs circle membership and is rate limited",
      "circleByCode" in pinapi and "rateLimit" in pinapi and "Not a member of this circle" in pinapi)
# A 404 for an unknown PIN also logs a console error in every browser that
# asks. The circle-not-found 404 above it is a different thing and stays.
check("address: an unknown PIN is a 200 answer, not a 404 error",
      "return res.status(200).json(out)" in pinapi
      and "status(out.ok ? 200 : 404)" not in pinapi)
check("address: the form asks for a PIN and shows what it will save",
      'id="b-pin"' in appad and 'id="b-area"' in appad and 'id="b-city"' in appad
      and 'id="b-state"' in appad and 'id="b-addrfull"' in appad)
check("address: a PIN that cannot be checked is never a locked door",
      "function pinManual" in appad and "saved as you write it" in appad)
check("address: an old free-text address re-saves unchanged",
      "the whole stored line goes back into the first box" in appad)
check("address: the source is checkable from production",
      "probe=pin" in (API_DIR / "diag.mjs").read_text(encoding="utf-8")
      and (API_DIR / "_pinselftest.mjs").exists())
check("address: the unit test runs in the deploy gate",
      "pintest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("memory: every filter carries a word, not just an emoji",
      appad.count('class="bkw"') == 5 and '<button type="button" data-bk="contact">☎️</button>' not in appad)

# ---------- 10e. Nothing half-merged ever ships ----------
# A merge resolved by committing the conflict markers reached origin/main and
# sailed through 200 checks: the HTML validator only reads tags, and "<<<<<<<
# HEAD" is just text to it. It would have rendered, literally, on the family
# memory screen. Cheap to check, so it is checked everywhere.
_srcs = (list((REPO / "api").glob("*.mjs")) + list((REPO / "scripts").glob("*.sh"))
         + list((REPO / "ops").glob("*.sh")) + list((REPO / "site" / "tests").glob("*.py"))
         + list((REPO / "site" / "tests").glob("*.mjs"))
         + list((REPO / "site" / "tests" / "browser").glob("*.mjs"))
         + [p for p in (REPO / "site" / "public").rglob("*.html")]
         + [p for p in (REPO / "site" / "public").rglob("*.js")]
         + [REPO / "vercel.json", REPO / "package.json"])
_conflicted = []
for f in _srcs:
    if not f.is_file():
        continue
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if line.startswith("<<<<<<< ") or line.startswith(">>>>>>> ") or line.rstrip() == "=======":
            _conflicted.append(f"{f.relative_to(REPO)}:{i}")
            break
check(f"merge: no conflict markers anywhere in the source ({len(_srcs)} files)",
      not _conflicted, "; ".join(_conflicted[:4]))

# ---------- 10f. The brand name lives in 350 places ----------
# It appears as Parwah, parwah, PARWAH and परवाह across markup, code, tests,
# the manifest, the service worker, the SVG marks and four filenames. Renaming
# that by hand is how a rename ends up half done, so it is one command.
_ren = (REPO / "ops/rename-brand.sh")
check("brand: renaming is one reviewed command, not a find-and-replace",
      _ren.exists() and _ren.stat().st_mode & 0o111)
if _ren.exists():
    _r = _ren.read_text(encoding="utf-8")
    check("brand: it shows what it would do before it does anything",
          'APPLY=0' in _r and 'Re-run with --apply' in _r)
    check("brand: it handles every form the name takes",
          all(x in _r for x in ("s/Parwah/", "s/parwah/", "s/PARWAH/", "OLD_DEV=")))
    # Renaming these signs every existing user out of their circle.
    check("brand: browser storage keys are left alone unless asked for",
          "STORAGE=0" in _r and "signs every existing user out" in _r
          and "is_browser" in _r)
    check("brand: the sentinel cannot be eaten by the rename it protects",
          "STORAGEKEY" in _r and "PARWAHKEY" not in _r)
    check("brand: the new name is written as bytes, not double-encoded",
          "NO -C layers" in _r and "-CSD" not in _r)
    check("brand: it names what only a human can rename",
          "Vercel project name" in _r and "GitHub repository name" in _r
          and "domain" in _r)

# ---------- 10g. Light and dark ----------
# A second theme is only possible if NOTHING is a bare colour outside the token
# block. These checks are what stop the next feature quietly hardcoding #fff
# into a card and being invisible at night.
_appt = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
_css = _appt[_appt.index("<style>"):_appt.index("</style>")]
_dark_end = _css.index("}", _css.index(':root[data-theme="dark"]{'))
_after = _css[_dark_end:]
_loose = re.findall(r"#[0-9A-Fa-f]{3,8}\b", _after)
check(f"theme: every colour is a token, none loose in the components ({len(_loose)} loose)",
      not _loose, ", ".join(sorted(set(_loose))[:6]))

_light = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);",
                         _css[_css.index(":root{"):_css.index("}", _css.index(":root{"))]))
_dark = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", _css[_css.index(':root[data-theme="dark"]{'):_dark_end]))
_notype = {"--tabs-h", "--side-w", "--disp", "--body", "--dev", "color-scheme"}
_missing = sorted(t for t in _light if t not in _notype and t not in _dark)
check(f"theme: every colour token has a dark value ({len(_dark)} of {len(_light) - len(_notype)})",
      not _missing, ", ".join(_missing[:6]))

# The automatic case and the chosen-by-hand case must not drift apart.
_auto = _css[_css.index('@media(prefers-color-scheme:dark)'):]
_auto = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", _auto[:_auto.index("}\n}")]))
# Same VALUES and the same SET: a token dropped from one block is exactly the
# drift this is here to catch, and comparing only the overlap misses it.
_drift = sorted(t for t in _dark if t in _auto and _auto[t].strip() != _dark[t].strip())
_drift += sorted("missing from automatic: " + t for t in _dark if t not in _auto)
_drift += sorted("missing from chosen: " + t for t in _auto if t not in _dark)
check("theme: automatic dark and chosen dark are the same palette",
      not _drift, "; ".join(_drift[:6]))

check("theme: three states, not two, and the device is one of them",
      'data-theme-set="auto"' in _appt and 'data-theme-set="light"' in _appt
      and 'data-theme-set="dark"' in _appt and "prefers-color-scheme: dark" in _appt)
# A script at the end of body draws the app light and repaints it dark.
check("theme: the choice is applied before the first paint",
      _appt.index("localStorage.getItem('parwah-theme')") < _appt.index("</head>")
      and "before the first paint" in _appt)
check("theme: the browser's own chrome is told too, since CSS cannot reach it",
      'meta[name="theme-color"]' in _appt and "#0C100D" in _appt)
check("theme: on Automatic it follows the device as it changes, not at next reload",
      "addEventListener('change'" in _appt and "themePref() === 'auto'" in _appt)
# Marigold is a light amber; white on it measures 2.17, which is why every
# button in this app puts --dusk on it instead.
_amber = [l for l in _css.splitlines()
          if "var(--marigold)" in l and "color:var(--on-accent)" in l]
check("theme: nothing puts white text on the amber", not _amber, "; ".join(_amber)[:110])
check("theme: text on a coloured chip and on a dark panel are separate tokens",
      "--on-accent:" in _css and "--on-dark:" in _css
      and "is how a themed app ends up with invisible buttons" in _css)

# ---------- 11. Serverless function budget (Hobby plan allows 12) ----------
FN_CAP = 12
fns = [f for f in sorted(API_DIR.glob("*.mjs")) if not f.name.startswith("_")]
check(f"serverless functions within plan cap ({len(fns)}/{FN_CAP})", len(fns) <= FN_CAP,
      "merge endpoints behind a router (see api/diag.mjs) — deploys are REJECTED above the cap")

print()
if FAILS:
    print(f"{len(FAILS)} CHECK(S) FAILED"); sys.exit(1)
print("ALL SITE CHECKS PASS")
