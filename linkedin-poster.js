// ─────────────────────────────────────────────────────────────
//  LinkedIn Headless Poster — Playwright-based, no visible browser
//  Uses LinkedIn session cookies to post image + text
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class LinkedInPoster {
  constructor(options = {}) {
    this.cookiesFile  = options.cookiesFile  || path.join(__dirname, 'linkedin-cookies.json');
    this.headless     = options.headless     ?? true;
    this.slowMo       = options.slowMo       ?? 0;
    this.pageTimeout  = options.pageTimeout  || 60000;
    this.browser      = null;
    this.context      = null;
    this.page         = null;
  }

  // ──────────────────────────────────────────────
  //  Launch
  // ──────────────────────────────────────────────
  async launch() {
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo:   this.slowMo,
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

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await this._loadCookies();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.pageTimeout);
    return this;
  }

  // ──────────────────────────────────────────────
  //  Cookies
  // ──────────────────────────────────────────────
  async _loadCookies() {
    if (!fs.existsSync(this.cookiesFile)) {
      throw new Error(`LinkedIn cookies not found: ${this.cookiesFile}\nRun: npm run setup-linkedin`);
    }
    const raw = await fs.readJson(this.cookiesFile);
    const cookies = raw.map(c => ({
      name:     c.name,
      value:    c.value,
      domain:   c.domain || '.linkedin.com',
      path:     c.path   || '/',
      expires:  c.expirationDate || c.expires || -1,
      httpOnly: c.httpOnly ?? false,
      secure:   c.secure  ?? true,
      sameSite: c.sameSite === 'no_restriction' ? 'None'
               : c.sameSite === 'lax'           ? 'Lax'
               : c.sameSite === 'strict'        ? 'Strict'
               : 'Lax',
    }));
    await this.context.addCookies(cookies);
    console.log(`🍪 Loaded ${cookies.length} LinkedIn cookies`);
  }

  async saveCookies() {
    const cookies = await this.context.cookies();
    await fs.writeJson(this.cookiesFile, cookies, { spaces: 2 });
    console.log(`💾 Saved ${cookies.length} LinkedIn cookies`);
  }

  // ──────────────────────────────────────────────
  //  Verify login
  // ──────────────────────────────────────────────
  async verifyLogin() {
    console.log('🔐 Verifying LinkedIn login...');
    await this.page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: this.pageTimeout,
    });
    await this.page.waitForTimeout(3000);

    const loggedIn = await this.page.evaluate(() => {
      const body = document.body.innerText;
      return !body.includes('Sign in') || !!document.querySelector('.share-box-feed-entry__trigger');
    });

    if (!loggedIn) throw new Error('❌ LinkedIn login failed. Re-run: npm run setup-linkedin');
    console.log('✅ LinkedIn: Logged in');
    return this;
  }

  // ──────────────────────────────────────────────
  //  POST: image + text (main method)
  // ──────────────────────────────────────────────
  async post({ imagePath, title, caption, target = 'personal', type = 'post' }) {
    const fullCaption = caption || title;
    console.log(`\n📤 Posting to LinkedIn...`);
    console.log(`   Target:  ${target}`);
    console.log(`   Type:    ${type}`);
    console.log(`   Title:   ${title}`);
    if (imagePath) console.log(`   Image:   ${path.basename(imagePath)}`);

    try {
      // Go to feed
      const feedUrl = target === 'company' 
        ? 'https://www.linkedin.com/company/107276202/admin/feed/' 
        : 'https://www.linkedin.com/feed/';
        
      await this.page.goto(feedUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(4000); // Give extra time to load

      // Click "Start a post" button
      if (type === 'article') {
        await this._clickWriteArticle();
        await this.page.waitForTimeout(5000);
        await this._fillArticle(title, fullCaption);
      } else {
        await this._clickStartPost();

        // Wait for the post modal
        await this.page.waitForSelector('.share-creation-state__content, .editor-content, [data-placeholder]', { timeout: 15000 });
        await this.page.waitForTimeout(1000);

        // Type the post text
        await this._typePostText(fullCaption);

        // Upload image or video if provided
        if (imagePath) {
          await this._uploadImage(imagePath);
        }

        // Submit
        await this._submitPost();
      }

      console.log('✅ Posted to LinkedIn successfully!');
      return true;
    } catch (err) {
      const ts = Date.now();
      const baseDir = imagePath ? path.dirname(imagePath) : path.join(process.cwd(), 'daily-banners');
      
      const sp = path.join(baseDir, `linkedin_error_${ts}.png`);
      await this.page.screenshot({ path: sp, fullPage: true }).catch(() => {});
      console.log(`📸 Error screenshot saved to: ${path.basename(sp)}`);
      
      const hp = path.join(baseDir, `linkedin_error_${ts}.html`);
      const html = await this.page.content().catch(() => '');
      await fs.writeFile(hp, html, 'utf-8').catch(() => {});
      console.log(`💾 Error HTML saved to: ${path.basename(hp)}`);
      
      throw err;
    }
  }

  async _clickStartPost() {
    const triggers = [
      '.share-box-feed-entry__trigger',
      '[aria-label*="Start a post"]',
      'div[role="button"]:has-text("Draft:")',
      'button[aria-label*="Start a post"]',
      '[data-control-name="create_post"]',
      '.share-box-feed-entry__closed-share-box',
      'button.artdeco-button:has-text("Start a post")',
    ];

    for (const sel of triggers) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          console.log(`  ↳ Opened post dialog via: ${sel}`);
          await this.page.waitForTimeout(1500);
          return;
        }
      } catch { /* try next */ }
    }

    // Fallback: click by text
    try {
      await this.page.getByText('Start a post').first().click();
      await this.page.waitForTimeout(1500);
    } catch (err) {
      try {
        await this.page.getByText('Draft:').first().click();
        await this.page.waitForTimeout(1500);
      } catch {
        throw new Error('❌ Could not open LinkedIn post dialog');
      }
    }
  }

  async _clickWriteArticle() {
    const triggers = [
      'button[aria-label="Write article"]',
      'button[aria-label="Write an article"]',
      'button:has-text("Write article")',
      'button:has-text("Write an article")',
      'span:has-text("Write article")',
      '[data-control-name="create_article"]',
      'a[href*="/article/new/"]'
    ];
    for (const sel of triggers) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          // LinkedIn sometimes opens article writer in a new tab
          const [newPage] = await Promise.all([
            this.context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
            el.click()
          ]);
          if (newPage) {
            this.page = newPage;
            await this.page.waitForLoadState('domcontentloaded');
          }
          console.log(`  ↳ Opened article writer via: ${sel}`);
          return;
        }
      } catch { /* try next */ }
    }
    
    // Fallback: direct navigation
    console.log(`  ↳ Button not found, trying direct navigation...`);
    await this.page.goto('https://www.linkedin.com/article/new/', { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(3000);
  }

  async _fillArticle(title, text) {
    console.log('  ↳ Waiting for article editor...');
    await this.page.waitForSelector('.ProseMirror, #article-editor-headline__textarea', { timeout: 30000 });
    
    // Fill Title
    try {
      const titleInput = await this.page.$('#article-editor-headline__textarea');
      if (titleInput) {
        await titleInput.click();
        await this.page.waitForTimeout(500);
        await titleInput.fill(title);
      }
    } catch (e) {
      console.log('  ↳ Warning: Could not fill article title automatically', e.message);
    }

    // Fill body
    try {
      const p = await this.page.locator('.ProseMirror p').first();
      if (p) {
        await p.click();
        await this.page.waitForTimeout(1000);
        
        // Dispatch Paste Event to activeElement
        await this.page.evaluate((txt) => {
          const activeEl = document.activeElement;
          if (!activeEl) return;
          
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', txt);
          const event = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
          });
          activeEl.dispatchEvent(event);
        }, text);
        
        console.log('  ↳ Article body injected. Waiting for draft to auto-save...');
        await this.page.waitForTimeout(7000); // 7s to be absolutely sure the draft is saved
      }
    } catch (e) {
      console.log('  ↳ Warning: Could not fill article body automatically', e.message);
    }

    // Click publish (usually opens a sidebar to add tags)
    try {
      const publishBtn = await this.page.waitForSelector('button.article-editor-nav__publish, button:has-text("Next"), button:has-text("Publish")', { timeout: 15000 });
      if (publishBtn) {
        await publishBtn.click();
        await this.page.waitForTimeout(5000);
        
        // Secondary publish in the sidebar
        const finalPublishBtn = await this.page.waitForSelector('button.share-actions__primary-action, button:has-text("Publish")', { timeout: 15000 });
        if (finalPublishBtn) {
          await finalPublishBtn.click();
          await this.page.waitForTimeout(3000);
        } else {
          throw new Error('Could not find final Publish button');
        }
      } else {
        throw new Error('Could not find primary Next/Publish button');
      }
    } catch (e) {
      throw new Error('❌ Could not publish article: ' + e.message);
    }
  }

  async _typePostText(text) {
    const editorSelectors = [
      '.ql-editor',
      'div[contenteditable="true"]',
      '[data-placeholder]',
      '.share-creation-state__editor',
    ];

    let typed = false;
    for (const sel of editorSelectors) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          await this.page.waitForTimeout(300);
          await el.fill(text);
          typed = true;
          console.log('  ↳ Post text entered');
          break;
        }
      } catch { /* try next */ }
    }

    if (!typed) {
      // Last resort: keyboard type
      await this.page.keyboard.type(text, { delay: 10 });
      console.log('  ↳ Post text entered via keyboard');
    }

    await this.page.waitForTimeout(500);
  }

  async _uploadImage(imagePath) {
    console.log('  ↳ Uploading image...');

    // Click the image/media button in the post dialog
    const mediaSelectors = [
      'button[aria-label="Add media"]',
      'button.share-promoted-detour-button[aria-label="Add media"]',
      'button.share-promoted-detour-button',
      'button[aria-label*="media"]',
      'button[aria-label*="image"]',
      'button[aria-label*="Add a photo"]',
      'label[aria-label*="image"]',
      '.share-creation-state__media-button',
      'button.share-creation-state__media-asset-button',
      '[data-control-name="add_photo_video"]',
    ];

    let fileInputTriggered = false;

    for (const sel of mediaSelectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn && await btn.isVisible()) {
          // Set up file chooser before clicking
          const [fileChooser] = await Promise.all([
            this.page.waitForEvent('filechooser', { timeout: 8000 }),
            btn.evaluate(el => el.click()).catch(() => btn.click({ force: true })),
          ]);
          await fileChooser.setFiles(imagePath);
          fileInputTriggered = true;
          console.log(`  ↳ Image selected via media button (${sel})`);
          break;
        }
      } catch (err) {
        console.log(`  ↳ Media button attempt (${sel}) failed: ${err.message}`);
      }
    }

    if (!fileInputTriggered) {
      // Direct file input fallback
      try {
        const [fileChooser] = await Promise.all([
          this.page.waitForEvent('filechooser', { timeout: 10000 }),
          this.page.evaluate(() => {
            const btn = document.querySelector('button[aria-label="Add media"], button.share-promoted-detour-button, button[aria-label*="photo"], button[aria-label*="image"], button[aria-label*="media"]');
            if (btn) btn.click();
          }),
        ]);
        await fileChooser.setFiles(imagePath);
        fileInputTriggered = true;
        console.log('  ↳ Image selected via direct input fallback');
      } catch (err) {
        console.log(`  ↳ Direct input fallback failed: ${err.message}`);
      }
    }

    if (!fileInputTriggered) {
      throw new Error('Could not trigger image upload file chooser');
    }

    // Wait for crop editor "Next" button to appear and click it
    console.log('  ↳ Waiting for crop editor...');
    const nextBtnSelector = 'button.share-box-footer__primary-btn, button:has-text("Next"), button[aria-label="Next"]';
    try {
      const nextBtn = await this.page.waitForSelector(nextBtnSelector, { timeout: 15000 });
      await nextBtn.click();
      console.log('  ↳ Confirmed image in crop editor (clicked Next)');
    } catch (err) {
      console.log(`  ↳ No crop editor detected or timed out: ${err.message}`);
    }

    // Wait for upload to complete on main composer
    console.log('  ↳ Waiting for image preview in main composer...');
    try {
      await this.page.waitForSelector('.share-creation-state__attached-image, img[alt="Image preview"], .share-creation-state__preview-container', { timeout: 15000 });
      console.log('  ↳ Image uploaded successfully');
    } catch (err) {
      console.log(`  ↳ Warning: Image preview container not detected: ${err.message}`);
      await this.page.waitForTimeout(3000);
    }
  }

  async _submitPost() {
    const submitSelectors = [
      'button[aria-label="Post"]',
      'button.share-actions__primary-action',
      'button:has-text("Post")',
      '[data-control-name="share.post"]',
    ];

    for (const sel of submitSelectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn && await btn.isVisible() && await btn.isEnabled()) {
          await btn.click();
          console.log('  ↳ Post submitted!');
          await this.page.waitForTimeout(4000);
          return;
        }
      } catch { /* try next */ }
    }

    // Fallback: get by role
    try {
      await this.page.getByRole('button', { name: 'Post' }).last().click();
      await this.page.waitForTimeout(4000);
    } catch {
      throw new Error('❌ Could not submit LinkedIn post');
    }
  }

  // ──────────────────────────────────────────────
  //  Cleanup
  // ──────────────────────────────────────────────
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page    = null;
    }
  }
}
