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

  console.log('Locating Create button...');
  const createBtn = await linkedIn.page.waitForSelector('button.org-organizational-page-admin-navigation__cta, button:has-text("Create")', { timeout: 10000 });
  
  console.log('Clicking Create button...');
  await createBtn.click();
  await linkedIn.page.waitForTimeout(4000);
  
  // Take screenshot of the result
  const sp = path.join(__dirname, 'daily-banners', 'create_button_clicked.png');
  await linkedIn.page.screenshot({ path: sp });
  console.log(`📸 Screenshot saved to: ${sp}`);
  
  // Dump all visible buttons and menu items to see what options appeared
  const options = await linkedIn.page.evaluate(() => {
    const list = [];
    const elements = document.querySelectorAll('button, div, li, span, a');
    elements.forEach((el) => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        const text = el.innerText?.trim() || '';
        if (text && text.length < 100 && (text.includes('post') || text.includes('Share') || text.includes('Event') || text.includes('Job') || text.includes('Document'))) {
          list.push({ tagName: el.tagName, className: el.className, text });
        }
      }
    });
    return list;
  });
  
  console.log('--- Visible options after clicking Create ---');
  console.log(JSON.stringify(options, null, 2));

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await linkedIn.close();
}
