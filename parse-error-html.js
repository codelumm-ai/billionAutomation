import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'daily-banners', 'linkedin_error_1782296601037.html');

async function run() {
  if (!fs.existsSync(htmlPath)) {
    console.error('HTML file not found:', htmlPath);
    process.exit(1);
  }

  const html = await fs.readFile(htmlPath, 'utf-8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  const elements = await page.evaluate(() => {
    const results = [];
    const all = document.querySelectorAll('button, div, span, a, p, h1, h2, h3, h4');
    all.forEach((el, idx) => {
      const text = el.innerText?.trim() || '';
      if (text === 'Create' || (text.includes('Create') && text.length < 50)) {
        results.push({
          index: idx,
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          text,
          ariaLabel: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || ''
        });
      }
    });
    return results;
  });

  console.log(JSON.stringify(elements, null, 2));
  await browser.close();
}

run().catch(console.error);
