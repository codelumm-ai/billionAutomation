// ─────────────────────────────────────────────────────────────
//  Twitter/X Trend Poster & Scraper
//  Uses Twitter session cookies to scrape trending topics and post tweets
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryChatGPTCompletions } from './whatsapp-bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class TwitterPoster {
  constructor(options = {}) {
    let defaultCookiesFile = path.join(__dirname, 'twitter-cookies.json');
    if (fs.existsSync(path.join(__dirname, 'x-com-cookies.json'))) {
      defaultCookiesFile = path.join(__dirname, 'x-com-cookies.json');
    }
    this.cookiesFile = options.cookiesFile || defaultCookiesFile;
    this.headless = options.headless ?? true;
    this.slowMo = options.slowMo ?? 0;
    this.pageTimeout = options.pageTimeout || 60000;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  // ──────────────────────────────────────────────
  //  Launch
  // ──────────────────────────────────────────────
  async launch() {
    const useChromeProfile = process.env.TWITTER_USE_CHROME_PROFILE === 'true';

    if (useChromeProfile) {
      const userDataDir = process.env.CHROME_USER_DATA_DIR || 'C:\\Users\\Web Nova Crew\\AppData\\Local\\Google\\Chrome\\User Data';
      const profileDirName = process.env.CHROME_PROFILE || 'Default';
      console.log(`🚀 Launching persistent Google Chrome context from: ${userDataDir} (profile: ${profileDirName})`);

      this.context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: this.headless,
        slowMo: this.slowMo,
        viewport: null,
        locale: 'en-US',
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          `--profile-directory=${profileDirName}`
        ],
      });
      this.browser = null;
    } else {
      console.log(`🚀 Launching normal Chromium browser instance...`);
      this.browser = await chromium.launch({
        headless: this.headless,
        slowMo: this.slowMo,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
      });

      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        viewport: { width: 1400, height: 900 },
        locale: 'en-US',
      });
    }

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (!useChromeProfile) {
      await this._loadCookies();
    }

    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(this.pageTimeout);
    return this;
  }

  // ──────────────────────────────────────────────
  //  Cookies
  // ──────────────────────────────────────────────
  async _loadCookies() {
    if (!fs.existsSync(this.cookiesFile)) {
      throw new Error(`Twitter cookies not found: ${this.cookiesFile}\nRun: npm run setup-twitter`);
    }
    const raw = await fs.readJson(this.cookiesFile);
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
    await this.context.addCookies(cookies);
    console.log(`🍪 Loaded ${cookies.length} Twitter/X cookies`);
  }

  // ──────────────────────────────────────────────
  //  Verify Login
  // ──────────────────────────────────────────────
  async verifyLogin() {
    console.log('🔐 Verifying Twitter login...');
    await this.page.goto('https://x.com/home', {
      waitUntil: 'domcontentloaded',
      timeout: this.pageTimeout,
    });
    await this.page.waitForTimeout(4000);

    const loggedIn = await this.page.evaluate(() => {
      const url = window.location.href;
      return url.includes('/home') || url.includes('/explore') || !!document.querySelector('[data-testid="SideNav_AccountSidebarHoverCard_Button"]');
    });

    if (!loggedIn) throw new Error('❌ Twitter login verification failed. Re-run: npm run setup-twitter');
    console.log('✅ Twitter/X: Logged in successfully');
    return this;
  }

  // ──────────────────────────────────────────────
  //  Scrape Trends
  // ──────────────────────────────────────────────
  async fetchTrends() {
    console.log('🔍 Scraping trending topics from x.com/explore...');
    await this.page.goto('https://x.com/explore', { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(4000);

    // Wait up to 10 seconds for any trend elements to render dynamically
    await this.page.waitForSelector('[data-testid="trend"], [data-testid="cellInner"]', { timeout: 10000 }).catch(() => {
      console.log('⚠️ Timeout waiting for trend cells. Evaluating page anyway...');
    });

    const trends = await this.page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-testid="trend"], [data-testid="cellInner"]'));

      const foundTrends = [];
      elements.forEach(el => {
        const text = el.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          let name = '';
          let category = '';
          let posts = '';

          if (lines[0].toLowerCase().includes('trending')) {
            name = lines[1];
            category = lines[0];
            posts = lines[2] || '';
          } else if (lines[1].toLowerCase().includes('posts') || lines[1].toLowerCase().includes('ago') || lines[1].toLowerCase().includes('trending')) {
            name = lines[0];
            category = lines[1];
            const match = lines[1].match(/([\d\.]+[KMB]?\s+posts)/i);
            if (match) {
              posts = match[1];
            }
          } else {
            name = lines[0];
            category = lines[1];
          }

          if (name && (name.startsWith('#') || name.length > 2) && name.length < 100) {
            if (!foundTrends.some(t => t.name === name)) {
              foundTrends.push({ name, category, posts });
            }
          }
        }
      });

      // Fallback selector for trend list items
      if (foundTrends.length === 0) {
        const textSpans = Array.from(document.querySelectorAll('span'));
        textSpans.forEach(span => {
          const text = (span.innerText || '').trim();
          if (text.startsWith('#') && text.length > 2 && text.length < 50) {
            if (!foundTrends.some(t => t.name === text)) {
              foundTrends.push({ name: text, category: 'Trending', posts: '' });
            }
          }
        });
      }

      return foundTrends;
    });

    console.log(`📈 Scraped ${trends.length} trends`);
    return trends;
  }

  // ──────────────────────────────────────────────
  //  Fetch Trend Media and Context from Twitter Search
  //  Scans multiple tweets and skips already-posted image URLs
  // ──────────────────────────────────────────────
  async fetchTrendMedia(trend, postedImageUrls = []) {
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(trend.name)}&src=trend_click`;
    console.log(`🔍 Navigating to search results for trend: "${trend.name}"...`);
    console.log(`🌐 URL: ${searchUrl}`);

    try {
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(5000);

      // Wait for tweets to render
      await this.page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => {
        console.log('⚠️ Timeout waiting for search results to load.');
      });

      // Scroll once to load more tweets
      await this.page.evaluate(() => window.scrollBy(0, 600));
      await this.page.waitForTimeout(2000);

      // Collect ALL candidate tweets with images from user posts
      const allMediaTweets = await this.page.evaluate(() => {
        const results = [];
        const tweets = Array.from(document.querySelectorAll('[data-testid="tweet"]'));
        for (const tweet of tweets) {
          const photoEl = tweet.querySelector('[data-testid="tweetPhoto"]');
          if (photoEl) {
            const img = photoEl.querySelector('img');
            const imgSrc = img ? img.src : null;
            const textEl = tweet.querySelector('[data-testid="tweetText"]');
            const text = textEl ? textEl.innerText : '';
            if (imgSrc) {
              results.push({ text, imgSrc });
            }
          }
        }
        return results;
      });

      console.log(`🖼️ Found ${allMediaTweets.length} total tweets with images for trend "${trend.name}"`);

      // Normalise URL to high-res and check against posted history
      for (const candidate of allMediaTweets) {
        let highResUrl = candidate.imgSrc;
        // Strip query params except format so we can do a base-URL comparison
        const baseUrl = highResUrl.split('?')[0];

        if (highResUrl.includes('name=')) {
          highResUrl = highResUrl.replace(/name=\w+/, 'name=large');
        } else if (highResUrl.includes('?')) {
          highResUrl += '&name=large';
        } else {
          highResUrl += '?name=large';
        }

        // Check if base URL was already posted (ignoring resolution params)
        const alreadyPosted = postedImageUrls.some(
          posted => posted.split('?')[0] === baseUrl
        );

        if (alreadyPosted) {
          console.log(`⏭️ Skipping already-posted image: ${baseUrl.slice(-40)}`);
          continue;
        }

        // Found a unique image!
        candidate.imgSrc = highResUrl;
        console.log(`✅ Found unique media tweet under trend!`);
        console.log(`📝 Tweet Context: "${candidate.text.slice(0, 100)}..."`);
        console.log(`🖼️ Image: ${candidate.imgSrc}`);
        return candidate;
      }

      console.log('⚠️ No unique (unposted) tweet image found under this trend.');
      return null;
    } catch (err) {
      console.warn('⚠️ Error during fetching trend media:', err.message);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  Download Scraped Image
  // ──────────────────────────────────────────────
  async downloadScrapedImage(url) {
    console.log(`📥 Downloading scraped image from: ${url}`);
    try {
      let ext = '.png';
      if (url.includes('format=jpg') || url.includes('.jpg')) { ext = '.jpg'; }
      else if (url.includes('format=jpeg') || url.includes('.jpeg')) { ext = '.jpg'; }
      else if (url.includes('format=png')) { ext = '.png'; }

      const timestamp = Date.now();
      const outputDir = path.join(__dirname, 'daily-banners');
      await fs.ensureDir(outputDir);
      const filename = `scraped_banner_${timestamp}${ext}`;
      const savedPath = path.join(outputDir, filename);

      const response = await this.page.request.get(url);
      if (!response.ok()) throw new Error(`Failed to download: HTTP ${response.status()}`);
      const buffer = await response.body();
      await fs.writeFile(savedPath, buffer);
      console.log(`✅ Scraped image downloaded and saved to: ${savedPath}`);
      return savedPath;
    } catch (err) {
      console.error(`❌ Failed to download scraped image: ${err.message}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  Generate Tweet with local ChatGPT API
  // ──────────────────────────────────────────────
  async generateViralTweet(trend, contextText = null) {
    console.log(`🤖 Generating viral Hindi tweet content for trend: "${trend.name}"...`);
    let prompt = `Write a short, highly engaging, manipulative, and clickbaity/viral tweet in HINDI (using Devanagari script) about "${trend.name}" (which is currently trending on Twitter). 

Style & Guidelines:
1. Language: Write entirely in Hindi (Devanagari script). Make it sound natural, conversational, and appealing to a Hindi-speaking audience.
2. Tone: Manipulative, curiosity-inducing, thought-provoking, or controversial in the style of top tech/business creators. Start with a hook (e.g. "क्या आप जानते हैं...", "सच तो यह है...", "एक कड़वा सच...").
3. Length: Strictly under 240 characters so it fits easily within the limit.
4. Hashtags: Include 1-2 relevant trending hashtags in Hindi or English (e.g. #Tech, #Startups).
5. CRITICAL: Output ONLY the raw tweet text itself. Do NOT include preambles, intros, quotes, or "Here is a tweet draft:". Just the Hindi tweet.`;

    if (contextText) {
      prompt += `\n\nBase the Hindi tweet on the context/story from this popular trending post:\n"${contextText}"`;
    }

    try {
      const response = await queryChatGPTCompletions(prompt);
      let tweetText = response.replace(/^"|"$/g, '').trim();
      // Clean up common ChatGPT UI artifact words and preambles
      tweetText = tweetText.replace(/^(here's\s+a\s+(?:tweet\s+)?draft:|here\s+is\s+a\s+(?:tweet\s+)?draft:)\s*/i, '').trim();
      tweetText = tweetText.replace(/^edit\s+/i, '').trim();
      tweetText = tweetText.replace(/^"|"$/g, '').trim(); // re-strip quotes if preamble contained quotes
      console.log(`✍️ Generated Hindi tweet (${tweetText.length} chars):\n"${tweetText}"`);
      return tweetText;
    } catch (err) {
      console.error('❌ Failed to generate tweet text:', err.message);
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  //  Post Tweet
  // ──────────────────────────────────────────────
  async postTweet(text, imagePath = null) {
    console.log('📤 Posting tweet...');
    try {
      await this.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(4000);

      // 1. Locate tweet input editor
      const editorSelector = '[data-testid="tweetTextarea_0"], [contenteditable="true"]';
      await this.page.waitForSelector(editorSelector, { timeout: 15000 });

      const editorLocator = this.page.locator(editorSelector).first();
      await editorLocator.click({ force: true });
      await this.page.waitForTimeout(500);

      // Clear editor natively
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Backspace');
      await this.page.waitForTimeout(500);

      // Type text natively
      await this.page.keyboard.insertText(text);
      await this.page.waitForTimeout(1500);

      // 2. Upload image if provided
      if (imagePath) {
        console.log(`🖼️ Uploading banner: ${path.basename(imagePath)}`);
        const fileInputSelector = 'input[type="file"][data-testid="fileInput"]';
        await this.page.waitForSelector(fileInputSelector, { timeout: 10000 });
        const fileInput = this.page.locator(fileInputSelector).first();
        await fileInput.setInputFiles(imagePath);
        console.log('⏳ Waiting for image upload preview to load...');
        await this.page.waitForTimeout(7000);
      }

      // Diagnostic screenshot: before posting
      const ts = Date.now();
      const prePostScreenshot = path.join(__dirname, `daily-banners`, `twitter_pre_post_${ts}.png`);
      await this.page.screenshot({ path: prePostScreenshot, fullPage: true }).catch(() => {});
      console.log(`📸 Pre-post screenshot saved to: daily-banners/${path.basename(prePostScreenshot)}`);

      // 3. Locate and click Submit/Post button
      const postBtnSelector = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
      await this.page.waitForSelector(postBtnSelector, { timeout: 10000 });

      const enabled = await this.page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (!btn) return false;
        return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
      }, postBtnSelector);

      if (!enabled) {
        throw new Error('❌ Post button is disabled. Content may be too long or input was empty.');
      }

      // Click via DOM click to bypass pointer-intercepting overlays from #layers
      await this.page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn) btn.click();
      }, postBtnSelector);
      console.log('⏳ Tweet submitted. Waiting for confirmation...');

      // Wait for success toast or composer to clear
      let posted = false;
      const toastSelector = '[data-testid="toast"]';
      try {
        await this.page.waitForSelector(toastSelector, { timeout: 12000 });
        const toastText = await this.page.textContent(toastSelector).catch(() => '');
        console.log(`💬 Twitter Toast: "${toastText.trim()}"`);
        posted = true;
      } catch (err) {
        console.log('⚠️ Success toast not detected. Checking composer reset...');
        const editorText = await this.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? el.innerText : '';
        }, editorSelector);
        if (!editorText || editorText.trim() === '') {
          console.log('✅ Composer is empty. Tweet likely posted.');
          posted = true;
        }
      }

      if (!posted) {
        console.log('⚠️ Could not confirm post. Waiting 8s fallback...');
        await this.page.waitForTimeout(8000);
      } else {
        await this.page.waitForTimeout(4000);
      }

      // Diagnostic screenshot: after posting
      const postSubmittedScreenshot = path.join(__dirname, `daily-banners`, `twitter_post_submitted_${ts}.png`);
      await this.page.screenshot({ path: postSubmittedScreenshot, fullPage: true }).catch(() => {});
      console.log(`📸 Post-submitted screenshot saved to: daily-banners/${path.basename(postSubmittedScreenshot)}`);

      console.log('✅ Tweet posted successfully!');
      return true;
    } catch (err) {
      const ts = Date.now();
      const errorScreenshot = path.join(__dirname, `daily-banners`, `twitter_error_${ts}.png`);
      await fs.ensureDir(path.dirname(errorScreenshot));
      await this.page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});
      console.log(`📸 Error screenshot saved to: daily-banners/${path.basename(errorScreenshot)}`);
      throw err;
    }
  }

  async close() {
    if (this.context) {
      console.log('⏳ Closing browser context...');
      try {
        await Promise.race([
          this.context.close(),
          new Promise(resolve => setTimeout(resolve, 10000))
        ]);
      } catch (err) {
        console.warn('⚠️ Warning during context close:', err.message);
      }
      this.browser = null;
      this.context = null;
      this.page = null;
      console.log('👋 Browser closed');
    }
  }
}
