'use strict';
// End-to-end check of the browser tab, using a real browser (Playwright).
//
// Environment:
//   MBL_ACCESS_TOKEN  token the service was started with (required)
//   BASE_URL          page URL                          (default http://127.0.0.1:6080/)
//   OUT_DIR           where screenshots are written      (default: current directory)
//   WINDOWS_CMD       command listing the X windows     (default "wmctrl -l")
//   X_DISPLAY         display used by WINDOWS_CMD       (default :99)
//   CLICK_X, CLICK_Y  where to click in the page        (default 227,68: "Create Profile")
//   VIEWPORT          browser viewport WxH              (default 1600x900)
const path = require('node:path');
const { execSync } = require('node:child_process');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:6080/';
const TOKEN = process.env.MBL_ACCESS_TOKEN;
const OUT = process.env.OUT_DIR || process.cwd();
const WINDOWS_CMD = process.env.WINDOWS_CMD || 'wmctrl -l';
const X_DISPLAY = process.env.X_DISPLAY || ':99';
const CLICK_X = Number(process.env.CLICK_X || 227);
const CLICK_Y = Number(process.env.CLICK_Y || 68);
const [VW, VH] = (process.env.VIEWPORT || '1600x900').split('x').map(Number);

if (!TOKEN) {
  console.error('MBL_ACCESS_TOKEN is required');
  process.exit(64);
}

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` - ${detail}` : ''}`);
}

function windowCount() {
  try {
    const listing = execSync(WINDOWS_CMD, {
      encoding: 'utf8',
      env: { ...process.env, DISPLAY: X_DISPLAY },
    });
    return listing.split('\n').filter(Boolean).length;
  } catch {
    return -1;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    await page.goto(BASE);

    // 1. A WebSocket without a token must never receive display data.
    const noToken = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let messages = 0;
          const ws = new WebSocket(`ws://${location.host}/websockify`);
          ws.onmessage = () => {
            messages += 1;
          };
          ws.onclose = () => resolve({ closed: true, messages });
          setTimeout(() => resolve({ closed: false, messages }), 8000);
        }),
    );
    check(
      'websocket without a token is closed and receives no display data',
      noToken.closed && noToken.messages === 0,
      JSON.stringify(noToken),
    );

    // 2. A wrong token through the page is refused with a visible message.
    await page.fill('#token', 'x'.repeat(24));
    await page.click('#connect');
    await page.waitForFunction(
      () => window.__mblState === 'login' && document.querySelector('#message').textContent.length > 0,
      null,
      { timeout: 20000 },
    );
    const refused = await page.textContent('#message');
    check('wrong token is refused with a message', refused.length > 0, refused);
    check('the login form is still shown after a wrong token', await page.isVisible('#login'));

    // 3. The right token shows the application.
    await page.fill('#token', TOKEN);
    await page.click('#connect');
    await page.waitForFunction(() => window.__mblState === 'connected', null, { timeout: 40000 });
    await page.waitForSelector('#screen canvas', { timeout: 10000 });
    check('valid token connects and shows a canvas', true);
    check('the login form is hidden once connected', !(await page.isVisible('#login')));

    // Give the display a moment to deliver its first frames.
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'connected.png') });

    // 4. Input typed in the tab must reach the application.
    const before = windowCount();
    await page.mouse.click(CLICK_X, CLICK_Y);
    await page.waitForTimeout(4000);
    const after = windowCount();
    await page.screenshot({ path: path.join(OUT, 'after-click.png') });
    check(
      'a click in the tab reaches the application (a new window appears)',
      before >= 0 && after > before,
      `windows before=${before} after=${after}`,
    );
  } catch (error) {
    check('end-to-end run completed without errors', false, String(error.message || error));
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? 'E2E PASS' : `E2E FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
