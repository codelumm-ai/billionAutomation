import { LinkedInPoster } from './linkedin-poster.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const linkedIn = new LinkedInPoster({
  cookiesFile: path.join(__dirname, 'linkedin-cookies.json'),
  headless: true
});

try {
  await linkedIn.launch();
  await linkedIn.verifyLogin();
  
  const targetUrl = 'https://www.linkedin.com/in/me/recent-activity/articles/';
  console.log(`🌐 Navigating to Articles page: ${targetUrl}`);
  await linkedIn.page.goto(targetUrl, { waitUntil: 'networkidle' });
  await linkedIn.page.waitForTimeout(5000);
  
  // Capture screenshot of the articles list
  const sp = path.join(__dirname, 'daily-banners', 'articles_list_verification.png');
  await linkedIn.page.screenshot({ path: sp, fullPage: true });
  console.log(`📸 Screenshot saved to: ${sp}`);
  
  // Extract article titles
  const articles = await linkedIn.page.evaluate(() => {
    const list = [];
    const elements = document.querySelectorAll('span, a, h3, h4');
    elements.forEach(el => {
      const text = el.innerText?.trim();
      if (text && (text.includes('Tech Partner') || text.includes('Multiplies Your Business Value') || text.includes('Web Nova Crew'))) {
        list.push({ tagName: el.tagName, text });
      }
    });
    return list;
  });
  
  console.log('--- Matching elements on articles page ---');
  console.log(JSON.stringify(articles, null, 2));
  
} catch (err) {
  console.error('❌ Verification failed:', err.message);
} finally {
  await linkedIn.close();
}
