// ─────────────────────────────────────────────────────────────
//  Universal Cookie Grabber
//  Opens a headed Chrome browser, allows you to log into any site,
//  and automatically captures and saves session cookies grouped by domain.
//  Run: npm run grab-cookies
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║                 Universal Cookie Grabber                     ║
  ╚══════════════════════════════════════════════════════════════╝

   1. A Chrome browser will open.
   2. Navigate to ANY website (e.g. x.com, linkedin.com, etc.) and log in.
   3. Go to the home feed of the website to ensure session cookies are set.
   4. Press ENTER in this terminal OR close the browser when done.
   5. Cookies will be automatically grouped and saved to '<domain>-cookies.json'.
   
`);

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: null,
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = await context.newPage();
await page.goto('https://google.com'); // Starting point

const saveCookies = async () => {
  console.log('\n⏳ Extracting and saving cookies...');
  const allCookies = await context.cookies();
  
  if (allCookies.length === 0) {
    console.log('⚠️ No cookies found in the current session.');
    return;
  }

  // Group cookies by domain (cleaning up leading dots and subdomains if necessary)
  const groups = {};
  for (const cookie of allCookies) {
    let domain = cookie.domain.replace(/^\./, '');
    // Group subdomains together to parent domain (e.g., mail.google.com -> google.com)
    const parts = domain.split('.');
    if (parts.length > 2) {
      domain = parts.slice(-2).join('.');
    }
    
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(cookie);
  }

  for (const [domain, cookies] of Object.entries(groups)) {
    // Only save cookies for main domains (ignore trackers, CDNs unless they have important login cookies)
    if (cookies.length < 2) continue;

    const safeDomainName = domain.replace(/\./g, '-');
    const filename = `${safeDomainName}-cookies.json`;
    const filepath = path.join(__dirname, filename);
    
    await fs.writeJson(filepath, cookies, { spaces: 2 });
    console.log(`💾 Saved ${cookies.length} cookies for ${domain} -> ${filename}`);
  }
  
  console.log('✅ Cookie capture complete!\n');
};

// Handle input waiting
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const runPromise = new Promise((resolve) => {
  // If browser window is closed, resolve
  page.on('close', () => resolve());
  browser.on('disconnected', () => resolve());

  rl.question('👉 Press ENTER in this terminal when you have logged into your site(s)... ', () => {
    rl.close();
    resolve();
  });
});

await runPromise;
await saveCookies();
await browser.close();
process.exit(0);
