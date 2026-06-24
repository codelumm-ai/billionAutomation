import { LinkedInPoster } from './linkedin-poster.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const linkedIn = new LinkedInPoster({
  cookiesFile: path.join(__dirname, 'linkedin-cookies.json'),
  headless: true
});

try {
  await linkedIn.launch();
  await linkedIn.verifyLogin();
  
  const feedUrl = 'https://www.linkedin.com/company/107276202/admin/feed/';
  console.log(`Navigating to company feed URL: ${feedUrl}`);
  await linkedIn.page.goto(feedUrl, { waitUntil: 'domcontentloaded' });
  await linkedIn.page.waitForTimeout(5000);

  // Find all elements containing "Create"
  const elements = await linkedIn.page.evaluate(() => {
    const results = [];
    const all = document.querySelectorAll('button, div, span, a');
    all.forEach((el, idx) => {
      const text = el.innerText?.trim() || '';
      if (text === 'Create' || text.includes('Create') && text.length < 50) {
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

  console.log('--- Elements containing "Create" ---');
  console.log(JSON.stringify(elements, null, 2));

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await linkedIn.close();
}
