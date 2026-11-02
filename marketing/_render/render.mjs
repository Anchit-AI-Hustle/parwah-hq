// RENDERS EVERY LAUNCH IMAGE FROM HTML, in the Mela brand.
//
// Tokens are copied from site/public/styles.css (jamun, day, marigold, flame,
// rani, peacock, ink); fonts are the site's three Google Fonts, kept in
// ./fonts so a render looks the same offline. Phone screens in ./screens are
// the real app at 390px wide (2x), signed in as an example family on a test
// database: no real person's data.
//
// Run from the repo root (needs playwright-core and a Chromium):
//   PW_CHROMIUM=/opt/pw-browsers/chromium node marketing/_render/render.mjs [only-this-prefix]
// Every text colour pair used here is listed in PAIRS and its contrast is
// printed; the run fails if one is under WCAG AA for its size.
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MK = path.resolve(HERE, '..');
const ONLY = process.argv[2] || '';
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('render: playwright-core is not installed (npm i --no-save playwright-core)'); process.exit(1); }

const T = {
  jamun: '#2A1235', day: '#FFF6EA', blush: '#FFE9DA', marigold: '#FFB31A', flame: '#FF5B2E',
  rani: '#D9146F', peacock: '#00A19A', ink: '#221428', cream: '#FFF3E6', dim: '#D2BCD9',
  onBright: '#1E0F26', sindoor: '#B80F5E', inkSoft: '#5E4B5E',
};

// ---- contrast: every pair this file paints text with
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [
  ['cream on jamun (body, headline)', T.cream, T.jamun, 4.5],
  ['dim on jamun (sub copy)', T.dim, T.jamun, 4.5],
  ['marigold on jamun (eyebrow, accent)', T.marigold, T.jamun, 4.5],
  ['on-bright on marigold (button)', T.onBright, T.marigold, 4.5],
  ['on-bright on flame (button, worst stop)', T.onBright, T.flame, 4.5],
  ['rani on jamun (gradient headline, worst stop, large text)', T.rani, T.jamun, 3],
  ['ink on day (light slides)', T.ink, T.day, 4.5],
  ['ink-soft on day (light sub copy)', T.inkSoft, T.day, 4.5],
  ['sindoor on day (light eyebrow)', T.sindoor, T.day, 4.5],
  ['rani on day (gradient headline on light, large text)', T.rani, T.day, 3],
  ['ink on blush', T.ink, T.blush, 4.5],
];
let lowContrast = 0;
for (const [name, fg, bg, need] of PAIRS) {
  const r = ratio(fg, bg);
  console.log(`contrast ${r.toFixed(2)}:1 ${r >= need ? 'ok ' : 'LOW'} (needs ${need}) ${name}`);
  if (r < need) lowContrast++;
}

const FONTS = 'file://' + path.join(HERE, 'fonts', 'local.css');
const SCREEN = (n) => 'file://' + path.join(HERE, 'screens', n + '.png');

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{overflow:hidden}
body{position:relative;font-family:"Plus Jakarta Sans",sans-serif;-webkit-font-smoothing:antialiased}
.dark{color:${T.cream};background:
  radial-gradient(55% 45% at 100% 0%,rgba(255,79,154,.34),transparent 70%),
  radial-gradient(50% 40% at 0% 100%,rgba(255,179,26,.26),transparent 100%),
  radial-gradient(40% 30% at 0% 35%,rgba(0,161,154,.16),transparent 100%),${T.jamun}}
.light{color:${T.ink};background:
  radial-gradient(60% 45% at 0% 0%,rgba(255,179,26,.30),transparent 70%),
  radial-gradient(55% 40% at 100% 10%,rgba(217,20,111,.13),transparent 70%),
  radial-gradient(70% 50% at 60% 110%,rgba(0,161,154,.13),transparent 70%),${T.day}}
.dots{position:absolute;inset:0;pointer-events:none;background-size:26px 26px}
.dark .dots{background-image:radial-gradient(rgba(255,190,59,.16) 1.5px,transparent 1.8px)}
.light .dots{background-image:radial-gradient(rgba(34,20,40,.09) 1.5px,transparent 1.8px)}
.toran{position:absolute;left:0;right:0;top:0;height:22px;z-index:2;
  background:radial-gradient(circle at 18px 0,${T.marigold} 12px,transparent 12.5px) 0 0/36px 22px repeat-x,
             radial-gradient(circle at 18px 0,${T.flame} 6px,transparent 6.5px) 18px 0/36px 22px repeat-x}
.ghost{position:absolute;font-family:"Baloo 2";font-weight:800;line-height:1;pointer-events:none}
.dark .ghost{color:rgba(255,190,59,.07)} .light .ghost{color:rgba(217,20,111,.06)}
.mark{display:flex;align-items:baseline;gap:14px}
.mark .dev{font-family:"Baloo 2";font-weight:800;background:linear-gradient(115deg,${T.marigold},${T.flame} 45%,${T.rani});-webkit-background-clip:text;background-clip:text;color:transparent}
.mark .lat{font-family:"Bricolage Grotesque";font-weight:800;letter-spacing:-.03em}
.eyebrow{align-self:flex-start;display:inline-flex;align-items:center;gap:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;border-radius:999px}
.dark .eyebrow{color:${T.marigold};background:rgba(255,255,255,.10)}
.light .eyebrow{color:${T.sindoor};background:rgba(217,20,111,.08)}
.eyebrow::before{content:"";width:12px;height:12px;border-radius:50%;background:linear-gradient(115deg,${T.marigold},${T.flame} 45%,${T.rani})}
h1,h2{font-family:"Bricolage Grotesque";font-weight:800;letter-spacing:-.035em;line-height:1.02}
em{font-style:normal;background:linear-gradient(115deg,${T.marigold},${T.flame} 45%,${T.rani});-webkit-background-clip:text;background-clip:text;color:transparent}
.light em{background:linear-gradient(115deg,${T.flame},${T.rani});-webkit-background-clip:text;background-clip:text}
.sub{font-weight:500;line-height:1.4}
.dark .sub{color:${T.dim}} .light .sub{color:${T.inkSoft}}
.cta{display:inline-flex;align-items:center;gap:14px;border-radius:999px;font-weight:800;color:${T.onBright};background:linear-gradient(115deg,${T.marigold},${T.flame});box-shadow:0 14px 34px rgba(255,120,30,.32)}
.cta svg{flex:none}
.free{font-weight:700}
.dark .free{color:${T.cream}} .light .free{color:${T.ink}}
.url{font-weight:600}
.dark .url{color:${T.dim}} .light .url{color:${T.inkSoft}}
.phone{position:relative;border-radius:56px;padding:14px;background:#140A1A;box-shadow:0 40px 90px rgba(20,8,30,.45),0 0 0 2px rgba(255,255,255,.08) inset}
.phone img{display:block;width:100%;border-radius:44px}
.light .phone{box-shadow:0 40px 80px rgba(42,18,53,.28)}
.flower{position:absolute}
`;
const WA = `<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z"/></svg>`;
const FLOWER = (size) => `<svg class="flower-svg" width="${size}" height="${size}" viewBox="-100 -100 200 200" aria-hidden="true"><g fill="${T.marigold}">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<ellipse rx="22" ry="44" cy="-52" transform="rotate(${a})"/>`).join('')}</g><circle r="34" fill="${T.flame}"/></svg>`;
const DIYA = (w) => `<svg width="${w}" height="${w * 0.8}" viewBox="0 0 200 160" aria-hidden="true"><defs><radialGradient id="fl" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".45" stop-color="${T.marigold}"/><stop offset="1" stop-color="${T.flame}"/></radialGradient></defs><path d="M100 8c14 22 22 36 22 50a22 22 0 0 1-44 0c0-14 8-28 22-50z" fill="url(#fl)"/><path d="M20 92h160c-6 34-38 58-80 58S26 126 20 92z" fill="${T.flame}"/><path d="M20 92h160c-2 8-6 15-11 21H31c-5-6-9-13-11-21z" fill="${T.marigold}"/><circle cx="60" cy="120" r="6" fill="${T.rani}"/><circle cx="100" cy="126" r="6" fill="${T.rani}"/><circle cx="140" cy="120" r="6" fill="${T.rani}"/></svg>`;

// "Mummy-Papa" is one word to a reader; never break it at the hyphen.
const nb = (t) => String(t).replace(/Mummy-Papa|to-dos|check-in|check-up/g, (w) => '<span style="white-space:nowrap">' + w + '</span>');
const mark = (s) => `<div class="mark"><span class="dev" style="font-size:${s}px">परवाह</span><span class="lat" style="font-size:${s}px">Parwah</span></div>`;

// ---- layouts -----------------------------------------------------------
// POSTER: an ad or a post. Text block, a real phone screen, one CTA.
function poster(a, W, H) {
  const theme = a.theme || 'dark';
  const square = W === H && W <= 1200;
  const tall = H / W > 1.6;
  const pad = Math.round(W * 0.074);
  const h1 = a.h1size || (square ? 72 : tall ? 104 : 88);
  const phoneW = square ? Math.round(W * 0.34) : tall ? Math.round(W * 0.60) : Math.round(W * 0.50);
  const phone = a.screen ? `<div class="phone" style="width:${phoneW}px"><img src="${SCREEN(a.screen)}"></div>` : '';
  const ctaRow = `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      <span class="cta" style="white-space:nowrap;font-size:${square ? 27 : 34}px;padding:${square ? '20px 30px' : '24px 40px'}">${WA}${a.cta || 'Message us on WhatsApp'}</span>
      <span class="free" style="font-size:${square ? 26 : 30}px">${a.free || 'Free for families'}</span></div>
    <p class="url" style="font-size:${square ? 22 : 26}px;margin-top:18px">parwah-hq.anchit-tandon.com</p>`;
  const text = `
    ${mark(square ? 40 : 46)}
    <p class="eyebrow" style="margin-top:${square ? 40 : 56}px;font-size:${square ? 20 : 24}px;padding:10px 22px">${a.eyebrow}</p>
    <h1 style="margin-top:24px;font-size:${h1}px">${nb(a.h1)}</h1>
    <p class="sub" style="margin-top:24px;font-size:${square ? 28 : 34}px">${nb(a.sub)}</p>`;
  let body;
  if (square) {
    body = `<div style="position:absolute;left:${pad}px;top:${pad + 10}px;width:${W - pad * 2 - phoneW - 30}px;bottom:${pad}px;display:flex;flex-direction:column">
      ${text}<div style="margin-top:auto">${ctaRow}</div></div>
      <div style="position:absolute;right:${pad - 10}px;top:50%;transform:translateY(-50%)">${phone}</div>`;
  } else {
    // Stories keep the top 250px and the bottom 340px clear of anything that matters.
    const top = tall ? 250 : pad + 10, bottom = tall ? 300 : pad;
    body = `<div style="position:absolute;left:${pad}px;right:${pad}px;top:${top}px;bottom:${bottom}px;display:flex;flex-direction:column">
      ${text}
      <div style="flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start;margin-top:40px;overflow:hidden;border-radius:56px 56px 0 0">${phone}</div>
      <div style="margin-top:36px">${ctaRow}</div></div>`;
  }
  return `<div class="${theme}" style="width:${W}px;height:${H}px;position:relative;overflow:hidden">
    <div class="dots"></div><div class="toran"></div>
    <div class="ghost" style="right:-40px;top:-90px;font-size:${Math.round(W * 0.5)}px">प</div>
    ${body}</div>`;
}

// SLIDE: a LinkedIn carousel page, 1080x1350.
function slide(a, W, H, i, n) {
  const theme = a.theme || 'dark';
  const pad = 88;
  const list = a.list ? `<ul style="list-style:none;margin-top:48px;display:grid;gap:30px">${a.list.map(x => `<li style="display:flex;gap:20px;font-size:42px;line-height:1.3;font-weight:600"><span style="flex:none;width:20px;height:20px;margin-top:18px;border-radius:50%;background:linear-gradient(115deg,${T.marigold},${T.flame} 45%,${T.rani})"></span><span>${x}</span></li>`).join('')}</ul>` : '';
  const phone = a.screen ? `<div style="flex:1;min-height:0;display:flex;justify-content:center;margin-top:44px;overflow:hidden;border-radius:56px 56px 0 0"><div class="phone" style="width:${a.phoneW || 470}px"><img src="${SCREEN(a.screen)}"></div></div>` : '';
  return `<div class="${theme}" style="width:${W}px;height:${H}px;position:relative;overflow:hidden">
    <div class="dots"></div><div class="toran"></div>
    <div class="ghost" style="right:-60px;bottom:-120px;font-size:560px">प</div>
    <div style="position:absolute;left:${pad}px;right:${pad}px;top:96px;bottom:150px;display:flex;flex-direction:column">
      ${a.eyebrow ? `<p class="eyebrow" style="font-size:24px;padding:10px 22px">${a.eyebrow}</p>` : ''}
      <h2 style="margin-top:${a.eyebrow ? 34 : 0}px;font-size:${a.size || 84}px">${nb(a.h)}</h2>
      ${a.sub ? `<p class="sub" style="margin-top:30px;font-size:40px">${nb(a.sub)}</p>` : ''}
      ${list}${phone}${a.extra || ''}
    </div>
    <div style="position:absolute;left:${pad}px;right:${pad}px;bottom:56px;display:flex;align-items:center;justify-content:space-between">
      ${mark(34)}
      <span class="url" style="font-size:26px">${i + 1} / ${n}${i + 1 < n ? ' &nbsp;Swipe &#8594;' : ''}</span>
    </div></div>`;
}

// STATUS: a WhatsApp Status for a festival, 1080x1920.
function status(a, W, H) {
  return `<div class="dark" style="width:${W}px;height:${H}px;position:relative;overflow:hidden">
    <div class="dots"></div><div class="toran"></div>
    <div class="ghost" style="left:-80px;top:120px;font-size:720px">प</div>
    <div style="position:absolute;left:96px;right:96px;top:260px;bottom:320px;display:flex;flex-direction:column;align-items:center;text-align:center">
      ${a.art}
      <p class="eyebrow" style="align-self:center;margin-top:56px;font-size:30px;padding:12px 28px">${a.eyebrow}</p>
      <h1 style="margin-top:40px;font-size:108px">${nb(a.h1)}</h1>
      <p class="sub" style="margin-top:40px;font-size:40px">${nb(a.sub)}</p>
      <div style="margin-top:auto">${mark(56)}</div>
      <p class="url" style="margin-top:22px;font-size:30px">Free family app · parwah-hq.anchit-tandon.com</p>
    </div></div>`;
}

// STORE: an app store screenshot, 1080x1920, caption over a real screen.
function store(a, W, H) {
  return `<div class="${a.theme || 'dark'}" style="width:${W}px;height:${H}px;position:relative;overflow:hidden">
    <div class="dots"></div><div class="toran"></div>
    <div style="position:absolute;left:80px;right:80px;top:120px;text-align:center">
      <h1 style="font-size:84px">${nb(a.h1)}</h1>
      <p class="sub" style="margin-top:22px;font-size:36px">${nb(a.sub)}</p>
    </div>
    <div style="position:absolute;left:50%;transform:translateX(-50%);top:${a.sub ? 470 : 420}px">
      <div class="phone" style="width:620px"><img src="${SCREEN(a.screen)}"></div></div></div>`;
}

// ---- the assets ----------------------------------------------------------
const ANGLES = {
  'angle1-11pm-call': { screen: 'papa-home', eyebrow: 'The 11pm phone call',
    h1: 'One tap from Papa. <em>Calm for all of you.</em>',
    sub: 'A daily "I am okay", shared to-dos, and the family\'s doctors and papers in one place.' },
  'angle2-siblings': { screen: 'rohan-care', eyebrow: 'Bhai, behen, saath mein',
    h1: 'Stop being the only one <em>who remembers it all.</em>',
    sub: 'Invite your brother or sister. Share Mummy-Papa\'s to-dos, doctors and bills, and see who has what.' },
  'angle3-nri-home-visit': { screen: 'rohan-home', eyebrow: 'Home for the holidays?',
    h1: 'Set Mummy-Papa up <em>before you fly back.</em>',
    sub: 'One evening together at home. Then a daily check-in, their doctors and papers, and family video calls, from anywhere.' },
};
const JOBS = [];
for (const [k, a] of Object.entries(ANGLES)) {
  JOBS.push([`meta/${k}-1080x1080.png`, 1080, 1080, () => poster(a, 1080, 1080)]);
  JOBS.push([`meta/${k}-1080x1350.png`, 1080, 1350, () => poster(a, 1080, 1350)]);
  JOBS.push([`meta/${k}-1080x1920.png`, 1080, 1920, () => poster(a, 1080, 1920)]);
}
JOBS.push(['linkedin/launch-post-1200x1200.png', 1200, 1200, () => poster({ screen: 'papa-home', eyebrow: 'Launching today · Free',
  h1: '"Sab theek hai, beta." <em>Now the whole family knows.</em>', h1size: 80,
  sub: 'Parwah is a free family-care app for India. Parents stay in charge.', cta: 'Try Parwah', free: 'Made in India' }, 1200, 1200)]);

const SLIDES = [
  { eyebrow: 'Why I built Parwah', h: 'The 11pm phone call <em>every one of us knows.</em>', size: 116,
    sub: 'A short story about my parents, distance, and a family app that keeps everyone close.',
    extra: `<div style="margin-top:auto;display:flex;align-items:center;gap:28px">${FLOWER(150)}<p style="font-size:34px;font-weight:700">Anchit Tandon<br><span style="font-weight:500;color:${T.dim}">Founder, Parwah</span></p></div>` },
  { eyebrow: 'The call', h: '"Sab theek hai, beta." <em>And the call ends.</em>', size: 96,
    sub: 'You hear the words. You do not hear the week: the missed check-up, the bill, the scam call, the knee on the stairs.',
    extra: `<p style="margin-top:auto;font-size:44px;font-weight:700;line-height:1.35">So many of us live in one city while our parents live in another. Some of us in another country.</p>` },
  { theme: 'light', eyebrow: 'The real problem', h: 'Caring for parents is a group project <em>with no real place to do it.</em>', size: 78,
    list: ['The doctor\'s number is in one phone', 'The insurance papers are in a drawer back home', 'One sibling remembers everything, and is tired', 'The family WhatsApp group is full of forwards'],
    extra: `<p style="margin-top:auto;font-size:46px;font-weight:800;line-height:1.25">Parwah gives the family <em>one place to share it.</em></p>` },
  { eyebrow: 'What Parwah is', h: 'One family app. <em>Parents in charge.</em>', size: 92, screen: 'rohan-home', phoneW: 440,
    sub: 'Check-ins, to-dos, doctors, medicines, papers and an emergency card, shared by the whole family.' },
  { theme: 'light', eyebrow: 'On Papa\'s phone', h: 'Three big buttons. <em>Nothing else to learn.</em>', size: 84, screen: 'papa-home', phoneW: 440,
    sub: 'SOS, All is well, and Medicines taken. A calm, large-text mode they can read.' },
  { eyebrow: 'Consent first', h: 'Together, <em>with their yes.</em>', size: 92,
    extra: `<p style="margin-top:auto;font-size:52px;font-weight:800;font-family:'Bricolage Grotesque';letter-spacing:-.02em">Reassurance, <em>never surveillance.</em></p>`,
    list: ['Parents switch on location sharing themselves, and stopping deletes it', 'Nobody joins the family without someone saying yes', 'ID papers keep only the last 4 digits', 'Ekta, our helper, checks scam messages for free'] },
  { eyebrow: 'Free for families', h: 'Set it up together <em>this Diwali.</em>', size: 104,
    sub: 'Open it in your phone\'s browser and add it to your Home Screen. Invite a sibling. Then invite Mummy-Papa.',
    extra: `<div style="margin-top:auto"><span class="cta" style="font-size:36px;padding:24px 42px">Link in the first comment</span><p style="margin-top:28px;font-size:42px;font-weight:700;line-height:1.3">What is one thing that would make caring for your parents easier?</p></div>` },
];
SLIDES.forEach((s, i) => JOBS.push([`linkedin/carousel/slide-${i + 1}.png`, 1080, 1350, () => slide(s, 1080, 1350, i, SLIDES.length)]));

JOBS.push(['whatsapp/status-diwali-1080x1920.png', 1080, 1920, () => status({ art: DIYA(300), eyebrow: 'Shubh Deepavali',
  h1: 'Ghar ki safai ho gayi? <em>Ab family ke papers bhi.</em>',
  sub: 'Doctors, medicines, insurance and the emergency card, in one family app. Mummy-Papa in charge.' }, 1080, 1920)]);
JOBS.push(['whatsapp/status-bhai-dooj-1080x1920.png', 1080, 1920, () => status({ art: `<div style="display:flex;gap:30px">${FLOWER(170)}${FLOWER(170)}</div>`, eyebrow: 'Happy Bhai Dooj',
  h1: 'Is Bhai Dooj, ek vaada: <em>Mummy-Papa ki parwah, milkar.</em>',
  sub: 'Invite your brother or sister to Parwah. Share the to-dos, the doctor visits and the bills.' }, 1080, 1920)]);

const STORE = [
  { screen: 'papa-home', h1: 'Big, calm buttons <em>for Mummy-Papa</em>', sub: 'SOS, All is well and Medicines taken' },
  { screen: 'rohan-home', h1: 'Your whole family, <em>at a glance</em>', sub: 'Who checked in, what is due, what is missing' },
  { screen: 'rohan-care', h1: 'Share the to-dos. <em>Know who has it.</em>', sub: 'Repeating tasks, reminders, and Hinglish voice to-dos' },
  { screen: 'rohan-memory', h1: 'Doctors, medicines <em>and papers, together</em>', sub: 'Plus an emergency card that works offline' },
  { screen: 'rohan-ekta', h1: 'Ekta answers, <em>and checks scams free</em>', sub: 'Your family helper, from your own records' },
  { screen: 'rohan-fun-plans', h1: 'Video calls and games, <em>together</em>', sub: 'Ludo, Vyapar and Antakshari, from anywhere' },
];
STORE.forEach((s, i) => JOBS.push([`stores/screenshot-${i + 1}-1080x1920.png`, 1080, 1920, () => store(s, 1080, 1920)]));

// ---- run -----------------------------------------------------------------
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
const tmp = path.join(tmpdir(), 'parwah-render-' + process.pid + '.html');
for (const [out, W, H, html] of JOBS) {
  if (ONLY && !out.startsWith(ONLY)) continue;
  writeFileSync(tmp, `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="${FONTS}"><style>${BASE_CSS}html,body{width:${W}px;height:${H}px}</style></head><body>${html()}</body></html>`);
  await page.setViewportSize({ width: W, height: H });
  await page.goto('file://' + tmp);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const over = await page.evaluate(() => [...document.querySelectorAll('h1,h2,p,li,span')].filter(e => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible').length);
  mkdirSync(path.dirname(path.join(MK, out)), { recursive: true });
  await page.screenshot({ path: path.join(MK, out), clip: { x: 0, y: 0, width: W, height: H } });
  console.log('rendered', out, W + 'x' + H, over ? `(${over} clipped)` : '');
}
// The carousel as one PDF, one slide per page, for LinkedIn's document post.
if (!ONLY || 'linkedin/carousel'.startsWith(ONLY) || ONLY.startsWith('linkedin')) {
  const imgs = SLIDES.map((_, i) => `<div style="width:1080px;height:1350px;page-break-after:always"><img style="display:block;width:1080px;height:1350px" src="file://${path.join(MK, 'linkedin/carousel/slide-' + (i + 1) + '.png')}"></div>`).join('');
  writeFileSync(tmp, `<!DOCTYPE html><html><head><style>@page{size:1080px 1350px;margin:0}body{margin:0}</style></head><body>${imgs}</body></html>`);
  await page.goto('file://' + tmp); await page.waitForTimeout(300);
  await page.pdf({ path: path.join(MK, 'linkedin/carousel/parwah-launch-carousel.pdf'), width: '1080px', height: '1350px', printBackground: true });
  console.log('rendered linkedin/carousel/parwah-launch-carousel.pdf');
}
// The HR one-pager, A4, from its own HTML (the same words as b2b/hr-caregiving-benefit.md).
if (!ONLY || ONLY.startsWith('b2b')) {
  await page.goto('file://' + path.join(MK, 'b2b', 'hr-one-pager.html'));
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200);
  await page.pdf({ path: path.join(MK, 'b2b/parwah-hr-caregiving-benefit.pdf'), format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  const spill = await page.evaluate(() => { const p = document.querySelector('.page'); return p.scrollHeight - p.clientHeight; });
  console.log('rendered b2b/parwah-hr-caregiving-benefit.pdf', spill > 0 ? '(TOO LONG: ' + spill + 'px past one A4 page)' : '(fits one A4 page)');
}
await browser.close();
if (lowContrast) { console.error(lowContrast + ' text pair(s) under AA'); process.exit(1); }
