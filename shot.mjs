import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const p = await (await b.newContext({ viewport:{width:1080,height:560}, deviceScaleFactor:2 })).newPage();
await p.goto('file:///home/user/logos/sheet.html');
await p.waitForTimeout(300);
await p.screenshot({ path: '/home/user/logo-options.png', fullPage: true });
await b.close();
