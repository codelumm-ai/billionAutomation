// ─────────────────────────────────────────────────────────────
//  ChatGPT Browser Automation - Core Engine
//  Uses Playwright + your cookies to generate images via ChatGPT
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateRandomDeviceProfile() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  ];

  const screens = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 }
  ];

  const gpus = [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (ATI Technologies Inc.)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
  ];

  const memories = [8, 16, 32];
  const cores = [4, 8, 12, 16];

  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
  const sc = screens[Math.floor(Math.random() * screens.length)];
  const gpu = gpus[Math.floor(Math.random() * gpus.length)];
  const mem = memories[Math.floor(Math.random() * memories.length)];
  const cpu = cores[Math.floor(Math.random() * cores.length)];

  const match = ua.match(/Chrome\/(\d+)\./);
  const chromeVersion = match ? match[1] : '126';

  return {
    userAgent: ua,
    chromeVersion,
    screen: sc,
    viewport: { width: sc.width, height: sc.height - 80 },
    webgl: gpu,
    memory: mem,
    cores: cpu
  };
}

export class ChatGPTImageBot {
  constructor(options = {}) {
    this.cookiesFile = options.cookiesFile || path.join(__dirname, 'cookies.json');
    this.outputDir = options.outputDir || path.join(__dirname, 'generated-images');
    this.headless = options.headless ?? true;
    this.slowMo = options.slowMo ?? 0;
    this.chatgptUrl = options.chatgptUrl || process.env.CHATGPT_URL || 'https://chatgpt.com';
    this.pageTimeout = options.pageTimeout || 90000;
    this.imageTimeout = options.imageTimeout || 300000; // 5 min

    this.browser = null;
    this.context = null;
    this.page = null;
    this.lastChatUrlFile = path.join(path.dirname(this.cookiesFile), 'last-chat-url.json');
    this.profileDir = options.profileDir || path.join(path.dirname(this.cookiesFile), 'chrome-profile');
  }

  // ──────────────────────────────────────────────
  //  Launch & authenticate
  // ──────────────────────────────────────────────
  async launch() {
    const profile = generateRandomDeviceProfile();
    console.log('🤖 Selected Real Device Profile (A to Z):', JSON.stringify(profile, null, 2));

    const profileDir = this.profileDir;
    await fs.ensureDir(profileDir);

    const launchArgs = [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      `--window-size=${profile.screen.width},${profile.screen.height}`,
      '--lang=en-US',
      '--disable-gpu-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--js-flags=--max-old-space-size=256',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
    ];

    try {
      this.context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: this.headless,
        slowMo: this.slowMo,
        args: launchArgs,
        userAgent: profile.userAgent,
        viewport: null,
        locale: 'en-US',
        timezoneId: 'Asia/Kolkata',
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      console.log('✅ Launched Google Chrome with persistent profile');
    } catch (err) {
      console.warn('⚠️ Google Chrome persistent launch failed, falling back to bundled Chromium:', err.message);
      this.context = await chromium.launchPersistentContext(profileDir, {
        headless: this.headless,
        slowMo: this.slowMo,
        args: launchArgs,
        userAgent: profile.userAgent,
        viewport: null,
        locale: 'en-US',
        timezoneId: 'Asia/Kolkata',
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      console.log('✅ Launched bundled Chromium with persistent profile');
    }

    // Stealth: inject advanced randomized device fingerprints matching Chrome
    await this.context.addInitScript((profile) => {
      // Clean up any automation variables injected by Playwright/Chromium driver
      for (const prop of Object.getOwnPropertyNames(window)) {
        if (prop.includes('cdc_') || prop.includes('playwright')) {
          try { delete window[prop]; } catch (e) { }
        }
      }

      // 1. Webdriver undefined
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 2. Languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // Spoof navigator.connection
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          onchange: null,
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false
        })
      });

      // 3. Touch support
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

      // 4. PDF Viewer
      Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => true });

      // 5. Device Memory & Hardware Concurrency
      Object.defineProperty(navigator, 'deviceMemory', { get: () => profile.memory });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => profile.cores });

      // 6. Spoof Plugins and MimeTypes (Native-looking structures)
      const makePlugin = (name, filename, description) => {
        const p = Object.create(Plugin.prototype);
        Object.defineProperties(p, {
          name: { get: () => name, enumerable: true },
          filename: { get: () => filename, enumerable: true },
          description: { get: () => description, enumerable: true },
          length: { get: () => 0, enumerable: true }
        });
        return p;
      };

      const pluginsList = [
        makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format')
      ];

      const pluginArray = Object.create(PluginArray.prototype);
      pluginsList.forEach((p, idx) => {
        pluginArray[idx] = p;
        Object.defineProperty(pluginArray, p.name, { get: () => p, enumerable: false });
      });
      Object.defineProperties(pluginArray, {
        length: { get: () => pluginsList.length, enumerable: true },
        item: { value: (idx) => pluginsList[idx], enumerable: true },
        namedItem: { value: (name) => pluginsList.find(p => p.name === name) || null, enumerable: true }
      });
      Object.defineProperty(navigator, 'plugins', { get: () => pluginArray, enumerable: true });

      // 7. Screen Dimensions
      const screenProps = {
        width: profile.screen.width,
        height: profile.screen.height,
        availWidth: profile.screen.width,
        availHeight: profile.screen.height - 40,
        colorDepth: 24,
        pixelDepth: 24,
      };

      for (const [prop, val] of Object.entries(screenProps)) {
        Object.defineProperty(window.screen, prop, { get: () => val });
      }

      // Outer window size matching
      Object.defineProperty(window, 'outerWidth', { get: () => profile.screen.width });
      Object.defineProperty(window, 'outerHeight', { get: () => profile.screen.height });
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });

      // 8. Permissions query override
      if (window.navigator.permissions) {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters && parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission, onchange: null })
            : originalQuery(parameters);
      }

      // 9. WebGL Spoofing Proxy
      const getParameterProxy = (target, thisArg, argList) => {
        const parameter = argList[0];
        if (parameter === 37445) return profile.webgl.vendor; // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return profile.webgl.renderer; // UNMASKED_RENDERER_WEBGL
        if (parameter === 3379) return 16384; // MAX_TEXTURE_SIZE
        if (parameter === 35661) return 80; // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        return Reflect.apply(target, thisArg, argList);
      };

      const proxyHandler = {
        apply: getParameterProxy
      };

      if (window.WebGLRenderingContext) {
        WebGLRenderingContext.prototype.getParameter = new Proxy(WebGLRenderingContext.prototype.getParameter, proxyHandler);
      }
      if (window.WebGL2RenderingContext) {
        WebGL2RenderingContext.prototype.getParameter = new Proxy(WebGL2RenderingContext.prototype.getParameter, proxyHandler);
      }

      // 10. Navigator UserAgentData (Client Hints)
      const uaData = {
        brands: [
          { brand: 'Not/A)Brand', version: '8' },
          { brand: 'Chromium', version: profile.chromeVersion },
          { brand: 'Google Chrome', version: profile.chromeVersion }
        ],
        mobile: false,
        platform: 'Windows'
      };
      navigator.userAgentData = {
        brands: uaData.brands,
        mobile: uaData.mobile,
        platform: uaData.platform,
        getHighEntropyValues: (hints) => {
          return Promise.resolve({
            brands: uaData.brands,
            mobile: uaData.mobile,
            platform: uaData.platform,
            architecture: 'x86',
            bitness: '64',
            model: '',
            platformVersion: '10.0.0',
            uaFullVersion: `${profile.chromeVersion}.0.0.0`
          });
        }
      };

      // 11. Realistic window.chrome object (with full runtime APIs)
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
        },
        csi: () => { },
        loadTimes: () => { },
        runtime: {
          sendMessage: () => { },
          connect: () => { },
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86_32', X86_64: 'x86_64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86_32', X86_64: 'x86_64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
        }
      };

      // 12. AudioContext baseLatency spoofing
      if (window.AudioContext) {
        Object.defineProperty(AudioContext.prototype, 'baseLatency', { get: () => 0.005 });
      }
    }, profile);

    await this._loadCookies();

    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(this.pageTimeout);

    this.consoleLogs = [];
    this.page.on('console', msg => {
      const txt = msg.text();
      const type = msg.type();
      this.consoleLogs.push(`[${type}] ${txt}`);
      if (this.consoleLogs.length > 100) this.consoleLogs.shift();
    });
    this.page.on('pageerror', err => {
      this.consoleLogs.push(`[error] ${err.message}`);
      if (this.consoleLogs.length > 100) this.consoleLogs.shift();
    });

    console.log('✅ Browser launched');
    return this;
  }

  // ──────────────────────────────────────────────
  //  Cookie management
  // ──────────────────────────────────────────────
  async _loadCookies() {
    if (!fs.existsSync(this.cookiesFile)) {
      console.warn(`⚠️  Cookie file not found: ${this.cookiesFile}`);
      console.warn('   Run: npm run setup-cookies');
      return false;
    }
    try {
      const raw = await fs.readJson(this.cookiesFile);
      const cookies = this._normalizeCookies(raw);
      await this.context.addCookies(cookies);
      console.log(`🍪 Loaded ${cookies.length} cookies`);
      return true;
    } catch (err) {
      console.error('❌ Failed to load cookies:', err.message);
      return false;
    }
  }

  async saveCookies() {
    const cookies = await this.context.cookies();
    await fs.ensureDir(path.dirname(this.cookiesFile));
    await fs.writeJson(this.cookiesFile, cookies, { spaces: 2 });
    console.log(`💾 Saved ${cookies.length} cookies`);
  }

  async saveCurrentChatUrl() {
    try {
      const currentUrl = this.page.url();
      if (currentUrl.startsWith(`${this.chatgptUrl}/c/`)) {
        await fs.writeJson(this.lastChatUrlFile, { url: currentUrl }, { spaces: 2 });
        console.log(`💾 Saved current chat session URL: ${currentUrl}`);
        return true;
      }
    } catch (err) {
      console.warn('⚠️ Failed to save current chat URL:', err.message);
    }
    return false;
  }

  _normalizeCookies(raw) {
    return raw.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || (() => {
        try {
          const host = new URL(this.chatgptUrl).hostname;
          return host.startsWith('.') ? host : '.' + host;
        } catch {
          return '.chatgpt.com';
        }
      })(),
      path: c.path || '/',
      expires: c.expirationDate || c.expires || -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? true,
      sameSite: c.sameSite === 'no_restriction' ? 'None'
        : c.sameSite === 'lax' ? 'Lax'
          : c.sameSite === 'strict' ? 'Strict'
            : 'None',
    }));
  }

  // ──────────────────────────────────────────────
  //  Navigate & verify login
  // ──────────────────────────────────────────────
  async navigate(customUrl = null) {
    let urlToGo = customUrl;
    if (!urlToGo && fs.existsSync(this.lastChatUrlFile)) {
      try {
        const savedState = await fs.readJson(this.lastChatUrlFile);
        if (savedState && savedState.url && savedState.url.startsWith(`${this.chatgptUrl}/c/`)) {
          urlToGo = savedState.url;
          console.log(`🔄 Found previous chat session URL: ${urlToGo}`);
        }
      } catch (err) {
        console.warn('⚠️ Failed to load previous chat URL:', err.message);
      }
    }

    if (!urlToGo) {
      urlToGo = this.chatgptUrl;
    }

    console.log(`🌐 Navigating to ${urlToGo}...`);

    await this.page.goto(urlToGo, {
      waitUntil: 'domcontentloaded',
      timeout: this.pageTimeout,
    });

    // Wait for page JS to load
    await this.page.waitForTimeout(4000);

    // Cloudflare check
    await this._bypassCloudflare();

    // Take a screenshot to see what we're dealing with
    await this._screenshot('after_navigate');

    const loggedIn = await this._checkLoggedIn();
    if (!loggedIn) {
      await this._screenshot('not_logged_in');
      throw new Error(
        '❌ Not logged in! Your cookies may be expired.\n' +
        '   Run setup-cookies to refresh them.'
      );
    }

    console.log('✅ Authenticated with ChatGPT');
    await this._screenshot('logged_in');

    // Wait for the chat input to be ready
    await this._waitForChatReady();

    return this;
  }

  async _waitForChatReady(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ready = await this.page.evaluate(() => {
        return !!(
          document.querySelector('#prompt-textarea') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector('textarea[placeholder]')
        );
      }).catch(() => false);

      if (ready) {
        console.log('  ↳ Chat input ready');
        return;
      }
      await this.page.waitForTimeout(1000);
    }
    console.warn('  ⚠️ Chat input not found within timeout');
  }

  async _bypassCloudflare() {
    for (let i = 0; i < 20; i++) {
      // 1. Check if chat input is already visible. If so, return immediately!
      const isInputVisible = await this.page.evaluate(() => {
        const input = document.querySelector('#prompt-textarea') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector('textarea[placeholder]');
        if (!input) return false;
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).catch(() => false);

      if (isInputVisible) {
        return;
      }

      // 2. Check if a Cloudflare challenge is present
      const hasChallenge = await this.page.evaluate(() => {
        return document.title.includes('Just a moment') ||
          document.body?.innerText?.includes('Verify you are human') ||
          document.body?.innerText?.includes('checking your browser') ||
          !!document.querySelector('iframe[src*="cloudflare"]') ||
          !!document.querySelector('iframe[src*="challenges"]');
      }).catch(() => false);

      if (!hasChallenge) {
        // If no challenge is detected but the input is still not visible,
        // the page might still be transitioning or loading. Keep waiting.
        console.log(`  ⏳ No challenge or input detected yet, waiting for page load (${i + 1}/20)...`);
        await this.page.waitForTimeout(1000);
        continue;
      }

      console.log(`  ⏳ Cloudflare challenge — waiting/solving (${i + 1}/20)...`);

      // 3. Try to locate and click the Turnstile checkbox inside any cloudflare/challenges iframe
      try {
        const allIframes = await this.page.locator('iframe').all().catch(() => []);
        console.log(`    ℹ️ Total iframes found by Playwright: ${allIframes.length}`);
        for (let idx = 0; idx < allIframes.length; idx++) {
          const src = await allIframes[idx].getAttribute('src').catch(() => 'error');
          const title = await allIframes[idx].getAttribute('title').catch(() => 'error');
          const id = await allIframes[idx].getAttribute('id').catch(() => 'error');
          console.log(`      [${idx}] id="${id}" title="${title}" src="${src}"`);
        }

        const iframeElement = await this.page.$('iframe[src*="cloudflare"], iframe[src*="challenges"], iframe[title*="verification"], iframe[src*="turnstile"]');
        if (iframeElement) {
          const iframeBox = await iframeElement.boundingBox().catch(() => null);
          if (iframeBox && iframeBox.width > 0 && iframeBox.height > 0) {
            console.log(`    👉 Found Turnstile iframe box: x=${iframeBox.x}, y=${iframeBox.y}, w=${iframeBox.width}, h=${iframeBox.height}`);

            // Try content frame click first
            const frame = await iframeElement.contentFrame().catch(() => null);
            let clickedInsideFrame = false;
            if (frame) {
              const clickTargets = [
                'input[type="checkbox"]',
                '#challenge-stage',
                '.ctp-checkbox-label',
                'span.mark',
                '.ctp-checkbox-container',
                '#cf-stage',
              ];
              for (const target of clickTargets) {
                const checkEl = await frame.$(target).catch(() => null);
                if (checkEl) {
                  const elBox = await checkEl.boundingBox().catch(() => null);
                  if (elBox && elBox.width > 0 && elBox.height > 0) {
                    console.log(`      ↳ Found checkbox target inside frame: "${target}", clicking...`);
                    await checkEl.click({ force: true, timeout: 3000 }).catch(() => { });
                    clickedInsideFrame = true;
                    break;
                  }
                }
              }
            }

            // Fallback: Click the checkbox coordinate on the parent page (real mouse click)
            // The checkbox is located on the left-side center of the Turnstile container
            const clickX = iframeBox.x + Math.min(35, iframeBox.width / 2);
            const clickY = iframeBox.y + (iframeBox.height / 2);
            console.log(`      ↳ Performing parent-level mouse click at coordinates: (${clickX}, ${clickY})`);
            await this.page.mouse.click(clickX, clickY).catch(() => { });
            await this.page.waitForTimeout(2000);
          }
        } else {
          // If no iframe is found, search page frames fallback
          const frames = this.page.frames();
          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('cloudflare') || url.includes('challenges')) {
              const clickTargets = [
                'input[type="checkbox"]',
                '#challenge-stage',
                '.ctp-checkbox-label',
                'span.mark',
                '.ctp-checkbox-container',
                '#cf-stage',
              ];
              for (const target of clickTargets) {
                const el = await frame.$(target);
                if (el) {
                  const box = await el.boundingBox().catch(() => null);
                  if (box && box.width > 0 && box.height > 0) {
                    console.log(`    👉 Clicked Turnstile element: "${target}" in iframe (loop fallback)`);
                    await el.click({ force: true, timeout: 2000 }).catch(() => { });
                    await this.page.waitForTimeout(1000);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('    ⚠️ Error trying to click Turnstile checkbox:', err.message);
      }

      await this.page.waitForTimeout(2000);
    }
  }

  async _checkLoggedIn() {
    try {
      const selectors = [
        '#prompt-textarea',
        'div[contenteditable="true"]',
        'textarea[placeholder]',
        'nav[aria-label*="Chat"]',
        '[data-testid="send-button"]',
      ];
      for (const sel of selectors) {
        const el = await this.page.$(sel);
        if (el) return true;
      }
      const body = await this.page.textContent('body').catch(() => '');
      if (body.includes('Log in') || body.includes('Sign in')) {
        if (!body.includes('Log out') && !body.includes('Sign out')) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────
  //  Image generation
  // ──────────────────────────────────────────────
  async generateImage(prompt, options = {}) {
    const { saveAs = null } = options;

    console.log(`\n🎨 Generating image: "${prompt.slice(0, 80)}..."`);
    await fs.ensureDir(this.outputDir);

    try {
      // Make sure ChatGPT isn't busy
      await this._waitForNotGenerating();

      // Focus the text input
      const inputEl = await this._focusChatInput();

      // Type the prompt - keep it simple and direct
      const finalPrompt = this._buildPrompt(prompt);
      await this._typePrompt(finalPrompt, inputEl);

      // Take screenshot before submitting
      await this._screenshot('before_submit');

      // Submit
      await this._submitPrompt();

      console.log('⏳ Waiting for ChatGPT to generate the image...');
      await this._screenshot('after_submit');

      // Wait for image result
      const result = await this._waitForImage();

      if (!result) {
        throw new Error('No image was generated — ChatGPT may have refused or timed out');
      }

      // Save the image
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const slug = (saveAs || prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')).toLowerCase();
      const filename = `${slug}_${timestamp}.png`;
      const savedPath = path.join(this.outputDir, filename);

      if (result.type === 'element') {
        await result.handle.screenshot({ path: savedPath });
      } else if (result.type === 'fullpage') {
        // Already saved
        return { imageUrl: 'fullpage', savedPath: result.path };
      } else {
        await this._downloadImage(result.url, savedPath);
      }

      console.log(`✅ Image saved: ${savedPath}`);
      return { imageUrl: result.url || 'element-screenshot', savedPath };

    } catch (err) {
      await this._screenshot(`error_${Date.now()}`);
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  //  Build final prompt
  // ──────────────────────────────────────────────
  _buildPrompt(userPrompt) {
    const lower = userPrompt.toLowerCase();
    const hasKeyword = ['generate', 'create', 'draw', 'make', 'paint', 'design',
      'image', 'picture', 'photo', 'illustration', 'banner'].some(k => lower.includes(k));
    // Keep the prompt short and natural — just ask for the image
    if (hasKeyword) return userPrompt;
    return `Create an image of: ${userPrompt}`;
  }

  // ──────────────────────────────────────────────
  //  Wait for ChatGPT to NOT be generating
  // ──────────────────────────────────────────────
  async _waitForNotGenerating(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const busy = await this._isGenerating();
      if (!busy) return;
      console.log('  ⌛ Waiting for previous response to finish...');
      await this.page.waitForTimeout(2000);
    }
  }

  async _isGenerating() {
    return await this.page.evaluate(() => {
      return !!(
        document.querySelector('[data-testid="stop-button"]') ||
        document.querySelector('button[aria-label*="Stop"]') ||
        document.querySelector('.result-streaming') ||
        document.body?.innerText?.includes('Stop answering')
      );
    }).catch(() => false);
  }

  // ──────────────────────────────────────────────
  //  Focus the chat text input
  // ──────────────────────────────────────────────
  async _focusChatInput() {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => { });
    await this.page.waitForTimeout(500);
    await this._bypassCloudflare();

    const selectors = [
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Ask"]',
      'textarea',
    ];

    for (const sel of selectors) {
      try {
        const el = await this.page.waitForSelector(sel, { timeout: 8000, state: 'visible' });
        if (el) {
          console.log(`  ↳ Input found: ${sel}`);
          await el.click();
          await this.page.waitForTimeout(400);
          return el;
        }
      } catch { /* try next */ }
    }

    await this._screenshot('no_input_found');
    throw new Error('Could not find chat input. Is ChatGPT loaded?');
  }

  // ──────────────────────────────────────────────
  //  Type the prompt into the input
  // ──────────────────────────────────────────────
  async _typePrompt(text, el = null) {
    console.log('  ↳ Preparing to type prompt via native paste...');
    try {
      const activeEl = el || await this._focusChatInput().catch(() => null);
      if (activeEl) {
        await activeEl.click();
        
        // Use evaluate to clear the ProseMirror content completely
        await activeEl.evaluate((editor) => {
          editor.innerHTML = '<p><br></p>'; // Standard empty ProseMirror state
        }).catch(() => {});
        await this.page.waitForTimeout(100);
        
        await activeEl.click();
        
        // Dispatch a paste event which is the most reliable way to inject text into ProseMirror
        await activeEl.evaluate((editor, txt) => {
           const dt = new DataTransfer();
           dt.setData('text/plain', txt);
           const evt = new ClipboardEvent('paste', {
             clipboardData: dt,
             bubbles: true,
             cancelable: true
           });
           editor.dispatchEvent(evt);
        }, text);
        
        console.log(`  ↳ Prompt pasted via event dispatch (${text.length} chars)`);
        await this.page.waitForTimeout(500);
        return;
      }
    } catch (err) {
      console.warn('  ⚠️ Paste event typing failed:', err.message);
    }

    // Fallback
    console.log('  ↳ Using keyboard type fallback...');
    try {
      const activeEl = el || await this._focusChatInput().catch(() => null);
      if (activeEl) {
        await activeEl.click();
        await this.page.keyboard.type(text, { delay: 5 });
      } else {
        await this.page.keyboard.type(text, { delay: 5 });
      }
    } catch {
      await this.page.keyboard.type(text, { delay: 5 });
    }
    await this.page.waitForTimeout(600);
  }

  // ──────────────────────────────────────────────
  //  Submit the prompt
  // ──────────────────────────────────────────────
  async _submitPrompt() {
    // Wait for the send button to become enabled (text was typed)
    await this.page.waitForTimeout(1000);

    // Debug: screenshot what the input looks like before submit
    await this._screenshot('pre_submit');

    // Log current input value
    const inputVal = await this.page.evaluate(() => {
      const el = document.querySelector('#prompt-textarea, div[contenteditable="true"], textarea');
      return el ? (el.innerText || el.value || '').trim().slice(0, 80) : '(not found)';
    }).catch(() => '(error)');
    console.log(`  ↳ Input value: "${inputVal}"`);

    // Try clicking the send button
    const selectors = [
      '[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
    ];

    for (const sel of selectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn && await btn.isVisible() && await btn.isEnabled()) {
          await btn.click();
          console.log(`  ↳ Submitted via: ${sel}`);
          await this.page.waitForTimeout(2000);
          await this._screenshot('post_submit');
          return;
        } else if (btn) {
          const vis = await btn.isVisible().catch(() => false);
          const ena = await btn.isEnabled().catch(() => false);
          console.log(`  ↳ ${sel}: visible=${vis}, enabled=${ena}`);
        }
      } catch { /* try next */ }
    }

    // Fallback: press Enter directly on the input
    console.log('  ↳ Submitting via Enter key (fallback)');
    const input = await this.page.$('#prompt-textarea, div[contenteditable="true"], textarea');
    if (input) {
      await input.press('Enter');
    } else {
      await this.page.keyboard.press('Enter');
    }
    await this.page.waitForTimeout(2000);
    await this._screenshot('post_submit_enter');
  }

  // ──────────────────────────────────────────────
  //  Wait for the generated image
  // ──────────────────────────────────────────────
  async _waitForImage() {
    const startTime = Date.now();
    const timeout = this.imageTimeout;

    let wasGenerating = false;
    let doneAt = null;
    let screenshotCount = 0;

    console.log('🔄 Polling for generated image...');

    while (Date.now() - startTime < timeout) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // ── Check generation status ─────────────────────────────
      const generating = await this._isGenerating();

      if (generating) {
        wasGenerating = true;
        doneAt = null;
        process.stdout.write('.');

        // Periodic screenshot while generating
        if (++screenshotCount % 10 === 0) {
          await this._screenshot(`gen_${elapsed}s`);
          console.log(`\n  📸 @${elapsed}s — still generating...`);
        }

        await this.page.waitForTimeout(2000);
        continue;
      }

      // ── Generation stopped (or not started yet) ──────────────
      if (wasGenerating) {
        // It was generating, and now it has stopped!
        if (!doneAt) {
          doneAt = Date.now();
          console.log(`\n  ✓ Generation stopped @${elapsed}s — waiting for render...`);
          await this.page.waitForTimeout(4000); // Extra time for image to render
        }

        // Now search for the image!
        const img = await this._findGeneratedImage();
        if (img) {
          console.log('\n  ↳ Image element found and fully loaded!');
          return img;
        }

        // If we've been done for > 15s and still no image, check for errors / fallback
        if (Date.now() - doneAt > 15000) {
          await this._screenshot(`done_no_image_${elapsed}s`);

          const errorText = await this.page.evaluate(() => {
            const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            const last = msgs[msgs.length - 1];
            return last?.innerText?.trim() || null;
          }).catch(() => null);

          if (errorText) {
            console.log(`\n  ⚠️  ChatGPT response (no image): "${errorText.slice(0, 200)}"`);
          }

          throw new Error(errorText ? `ChatGPT failed to generate image: ${errorText}` : 'No image element found - ChatGPT did not generate an image');
        }
      } else {
        // Not generating yet (still waiting for response to start after submission)
        if (++screenshotCount % 5 === 0) {
          await this._screenshot(`poll_${elapsed}s`);
        }
      }

      await this.page.waitForTimeout(2000);
    }

    await this._screenshot('timeout');
    return null;
  }

  async _findGeneratedImage() {
    // Search globally for images inside assistant turns to handle layout variations robustly
    try {
      const imgs = await this.page.$$('img');
      for (const img of imgs.reverse()) { // Newest first
        if (!await img.isVisible()) continue;

        // Check if the image is inside an assistant message (agent turn)
        const isDalleImage = await img.evaluate((el) => {
          let p = el.parentElement;
          while (p) {
            if (
              p.getAttribute('data-message-author-role') === 'assistant' ||
              p.classList.contains('agent-turn') ||
              p.tagName === 'ARTICLE'
            ) {
              return true;
            }
            p = p.parentElement;
          }
          return false;
        }).catch(() => false);

        if (!isDalleImage) continue;

        // Ensure image is fully loaded
        const isLoaded = await img.evaluate(el => el.complete && el.naturalWidth > 0).catch(() => false);
        if (!isLoaded) continue;

        const box = await img.boundingBox();
        if (!box || box.width < 100 || box.height < 100) continue;

        const src = await img.getAttribute('src') || '';
        if (
          src.includes('oaidalleapiprodscus') ||
          src.includes('oaiusercontent') ||
          src.includes('dalle') ||
          src.includes('cdn.openai') ||
          src.includes('blob:') ||
          src.startsWith('https') ||
          src.startsWith('http')
        ) {
          return { type: 'element', handle: img, url: src };
        }
      }
    } catch (err) {
      console.error('Error in _findGeneratedImage:', err.message);
    }

    // JS scan for image URLs in the latest message
    const url = await this.page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (msgs.length === 0) return null;
      const lastMsg = msgs[msgs.length - 1];
      const imgs = Array.from(lastMsg.querySelectorAll('img')).reverse();
      for (const img of imgs) {
        const src = img.src || '';
        if (
          src.includes('oaidalleapiprodscus') ||
          src.includes('oaiusercontent') ||
          src.includes('dalle') ||
          src.includes('cdn.openai') ||
          (src.startsWith('https') && img.naturalWidth > 200 && img.naturalHeight > 200)
        ) {
          if (img.complete && img.naturalWidth > 0) {
            return src;
          }
        }
      }
      return null;
    }).catch(() => null);

    if (url) return { type: 'url', url };
    return null;
  }

  async _downloadImage(url, filepath) {
    const response = await this.page.request.get(url);
    if (!response.ok()) throw new Error(`Failed to download image: HTTP ${response.status()}`);
    const buffer = await response.body();
    await fs.writeFile(filepath, buffer);
  }

  // ──────────────────────────────────────────────
  //  Screenshot helper
  // ──────────────────────────────────────────────
  async _screenshot(label = 'debug') {
    try {
      await fs.ensureDir(this.outputDir);
      const filepath = path.join(this.outputDir, `${label}_${Date.now()}.png`);
      await this.page.screenshot({ path: filepath, fullPage: true });
      return filepath;
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  New chat
  // ──────────────────────────────────────────────
  async newChat() {
    console.log('🔄 Starting new chat session...');
    try {
      const currentUrl = this.page.url();
      const isMainPage = currentUrl === this.chatgptUrl || currentUrl === `${this.chatgptUrl}/` || currentUrl === `${this.chatgptUrl}/?oai-dm=1`;

      const isInputVisible = await this.page.evaluate(() => {
        const input = document.querySelector('#prompt-textarea') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector('textarea[placeholder]');
        if (!input) return false;
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).catch(() => false);

      // If we are already on the main page and the input is visible, we don't need to do anything!
      if (isMainPage && isInputVisible) {
        console.log('  ↳ Already on a fresh main page and input is visible.');
        return this;
      }

      // Try to click the "New chat" button in the sidebar
      const newChatBtn = this.page.locator('[data-testid="create-new-chat-button"]').first();
      const count = await newChatBtn.count().catch(() => 0);
      if (count > 0) {
        console.log('  ↳ Clicking "New chat" button via Playwright...');
        await newChatBtn.click({ force: true });
      } else {
        console.log('  ↳ "New chat" button not found. Evaluating client-side click...');
        await this.page.evaluate(() => {
          const btn = document.querySelector('[data-testid="create-new-chat-button"]');
          if (btn) {
            btn.click();
          } else {
            // fallback to client routing
            window.location.href = '/';
          }
        }).catch(() => { });
      }

      // Wait a moment for transition and chat input readiness
      await this.page.waitForTimeout(2000);
      await this._waitForChatReady();
    } catch (err) {
      console.warn('⚠️ Failed to click New Chat button:', err.message);
      // Fallback: full reload navigation
      console.log('  ↳ Falling back to full page navigation...');
      await this.page.goto(this.chatgptUrl, { waitUntil: 'domcontentloaded', timeout: this.pageTimeout });
      await this.page.waitForTimeout(3000);
      await this._bypassCloudflare();
      await this._waitForChatReady();
    }
    return this;
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
      this.browser = this.context = this.page = null;
      console.log('👋 Browser closed');
    }
  }
}
