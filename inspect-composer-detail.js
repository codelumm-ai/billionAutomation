import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const cookiesFile = 'C:\\Linkedin Posting\\x-com-cookies.json';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
  });

  const raw = await fs.readJson(cookiesFile);
  const cookies = raw.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.x.com',
    path: c.path || '/',
    expires: c.expirationDate || c.expires || -1,
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? true,
    sameSite: c.sameSite === 'no_restriction' ? 'None'
      : c.sameSite === 'lax' ? 'Lax'
        : c.sameSite === 'strict' ? 'Strict'
          : 'Lax',
  }));
  await context.addCookies(cookies);

  const page = await context.newPage();
  console.log('🌐 Navigating to home...');
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const details = await page.evaluate(() => {
    const report = [];
    
    // 1. Find all contenteditable elements
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    report.push(`Total contenteditable elements: ${editables.length}`);
    editables.forEach((el, idx) => {
      report.push(`\n[Editable #${idx}]`);
      report.push(`  TagName: ${el.tagName}`);
      report.push(`  ClassName: ${el.className}`);
      report.push(`  Parent data-testid: ${el.parentElement ? el.parentElement.getAttribute('data-testid') : 'none'}`);
      report.push(`  Placeholder: ${el.getAttribute('placeholder') || 'none'}`);
      
      // Get path up to body
      let path = el.tagName;
      let p = el.parentElement;
      while (p && p.tagName !== 'BODY') {
        const idStr = p.id ? `#${p.id}` : '';
        const testId = p.getAttribute('data-testid') ? `[data-testid="${p.getAttribute('data-testid')}"]` : '';
        path = `${p.tagName}${idStr}${testId} > ${path}`;
        p = p.parentElement;
      }
      report.push(`  DOM Path: ${path}`);
    });

    // 2. Find tweetTextarea_0
    const textareas = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
    report.push(`\nTotal tweetTextarea_0 elements: ${textareas.length}`);
    textareas.forEach((el, idx) => {
      report.push(`\n[TextareaWrapper #${idx}]`);
      report.push(`  TagName: ${el.tagName}`);
      report.push(`  ClassName: ${el.className}`);
      report.push(`  HTML: ${el.outerHTML.slice(0, 300)}...`);
    });

    return report;
  });

  console.log(details.join('\n'));

  await context.close();
  await browser.close();
}

main().catch(err => console.error(err));
