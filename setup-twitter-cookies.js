// ─────────────────────────────────────────────────────────────
//  Twitter Cookie Setup — One-time login
//  Run: npm run setup-twitter
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, 'twitter-cookies.json');

console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║            Twitter Cookie Setup — One Time Login             ║
  ╚══════════════════════════════════════════════════════════════╝

   A Chrome browser will open.
   1. Log into YOUR Twitter/X account normally
   2. Once your home feed is visible → auto-detected and saved!
   3. Or press ENTER manually in this terminal if needed
   
`);

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1400, height: 900 },
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

// Load existing cookies if any
if (fs.existsSync(COOKIES_FILE)) {
  try {
    const existing = await fs.readJson(COOKIES_FILE);
    await context.addCookies(existing);
    console.log('🍪 Loaded existing cookies — trying auto-login...');
  } catch { /* ignore */ }
}

const page = await context.newPage();
await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded' });

console.log('🌐 Browser opened. Log into Twitter/X...\n');

// Auto-detect login
let loginDetected = false;

const autoDetect = (async () => {
  for (let i = 0; i < 150; i++) {
    try {
      const loggedIn = await page.evaluate(() => {
        const body = document.body?.innerText || '';
        const url  = window.location.href;
        const hasHome = url.includes('/home') || url.includes('/explore') || !!document.querySelector('[data-testid="SideNav_AccountSidebarHoverCard_Button"]');
        const notLogin = !url.includes('/login') && !url.includes('/i/flow/login');
        return hasHome && notLogin;
      });
      if (loggedIn) {
        loginDetected = true;
        console.log('\n✅ Twitter/X login detected!');
        return true;
      }
    } catch { /* page loading */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
})();

const manualEnter = new Promise(resolve => {
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', d => {
    if (d === '\n' || d === '\r' || d === '\r\n' || d === '\x0d') {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      resolve('manual');
    }
    if (d === '\x03') process.exit(0);
  });
  process.stdout.write('Press ENTER when logged in (or wait for auto-detect)... ');
});

await Promise.race([autoDetect, manualEnter]);

console.log('\n⏳ Saving cookies...');
await page.waitForTimeout(2000);

const cookies = await context.cookies([
  'https://x.com',
  'https://twitter.com',
]);

await fs.writeJson(COOKIES_FILE, cookies, { spaces: 2 });

const names = cookies.map(c => c.name);
console.log(`\n💾 Saved ${cookies.length} cookies`);
console.log(`   Key cookies: ${names.filter(n => ['auth_token', 'ct0', 'twid', 'personalization_id'].includes(n)).join(', ')}`);

if (!names.includes('auth_token')) {
  console.log('\n⚠️  WARNING: "auth_token" cookie missing — you may not be fully logged in.');
  console.log('   Make sure you are on your Twitter feed before saving.\n');
} else {
  console.log('\n✅ Ready! Run: npm run twitter-schedule\n');
}

await browser.close();
process.exit(0);
