import { register } from 'node:module';
register('./loader.mjs', import.meta.url);

// A FIXED WAIT IS A FLOOR, NOT A PROMISE. Many of these tests sleep for a set
// time after a tap. On a slow machine the screen is not ready when the sleep
// ends, and a different test fails each run. So every sleep here also waits
// for the page's requests to come back and for the next paint. A test that
// passes only because a machine is fast is not a test.
try {
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const req = createRequire(import.meta.url);
  const { Page } = req(join(dirname(req.resolve('playwright-core')), 'lib/client/page.js'));
  const sleep = Page.prototype.waitForTimeout;
  Page.prototype.waitForTimeout = async function (ms) {
    await sleep.call(this, ms);
    await this.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  };
} catch (e) { /* no browser driver here: the tests that need one say so themselves */ }
