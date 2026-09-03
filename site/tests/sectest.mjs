// THE SECURITY FIXES, as pure logic. Everything here is a real defect an
// audit found in this app; each check fails against the code as it was.
//
// api/_sec.mjs imports nothing, so the deploy gate runs this on a fresh
// clone before npm install.
import { escHtml, safeImageUri, feedName } from '../../api/_sec.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

// ---- THE ESCAPER DID NOT ESCAPE QUOTES.
// Its output goes inside double-quoted attributes in ten places, so a member
// name or request title containing a quote closed the attribute and the rest
// became live attributes, onerror among them.
ok('a double quote is escaped', escHtml('a"b') === 'a&quot;b');
ok('a single quote is escaped', escHtml("a'b") === 'a&#39;b');
ok('angle brackets are escaped', escHtml('<script>') === '&lt;script&gt;');
ok('ampersand is escaped first, not twice', escHtml('&lt;') === '&amp;lt;');
const attack = 'Papa" onerror="alert(1)';
ok('a name cannot break out of an attribute', escHtml(attack).indexOf('"') < 0);
ok('and what is left is inert', !/onerror="/.test('<b data-x="' + escHtml(attack) + '">'));
ok('null and undefined render as nothing', escHtml(null) === '' && escHtml(undefined) === '');
ok('ordinary text is untouched', escHtml('Papa ji') === 'Papa ji');
ok('Devanagari is untouched', escHtml('परवाह') === 'परवाह');

// ---- A PREFIX IS NOT A VALIDATION.
// The image check tested only that a string STARTED like a data URI, and the
// whole string then went into an src attribute.
ok('a real png data uri passes', safeImageUri('data:image/png;base64,iVBORw0KGgo=') !== null);
ok('jpeg and webp pass too',
   safeImageUri('data:image/jpeg;base64,/9j/4AAQ') !== null && safeImageUri('data:image/webp;base64,UklGRg==') !== null);
ok('an attribute break is refused', safeImageUri('data:image/png;base64,x" onerror=alert(1)') === null);
ok('a space is refused', safeImageUri('data:image/png;base64,AA AA') === null);
ok('a javascript uri is refused', safeImageUri('javascript:alert(1)') === null);
ok('an svg data uri is refused, because svg carries script',
   safeImageUri('data:image/svg+xml;base64,PHN2Zz4=') === null);
ok('a bare http url is refused', safeImageUri('https://example.com/a.png') === null);
ok('empty is refused', safeImageUri('') === null && safeImageUri(null) === null);
ok('padding is allowed but nothing after it', safeImageUri('data:image/png;base64,QQ==') !== null
   && safeImageUri('data:image/png;base64,QQ==x') === null);

// ---- A PRIVATE ENTRY'S NAME IS AS PRIVATE AS THE ENTRY.
// Adding, verifying or removing one wrote its name into the circle-wide feed,
// so a private medicine was announced to everyone the moment it was recorded.
ok('a private entry is not named in the feed', feedName('private', 'Metformin') === 'something private');
ok('a circle entry keeps its name', feedName('circle', 'Plumber') === 'Plumber');
ok('an unset visibility is treated as the circle default', feedName(undefined, 'Plumber') === 'Plumber');
ok('the family still learns the memory grew', feedName('private', 'x').length > 0);

if (fails.length) {
  console.error(`sectest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`sectest: ${pass}/${pass} checks pass`);
