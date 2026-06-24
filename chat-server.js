import express from 'express';
import { ChatGPTImageBot } from './chatgpt-image-automation/bot.js';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import { initWhatsApp, whatsappState } from './whatsapp-bot.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || null;

// Ensure persistent directory and copy initial assets if running in persistent env (e.g. Render)
if (DATA_DIR) {
  try {
    fs.ensureDirSync(DATA_DIR);

    const sourceCookies = path.join(__dirname, 'chatgpt-image-automation', 'cookies.json');
    const targetCookies = path.join(DATA_DIR, 'cookies.json');
    if (!fs.existsSync(targetCookies) && fs.existsSync(sourceCookies)) {
      fs.copySync(sourceCookies, targetCookies);
      console.log(chalk.green(`🚚 Migrated initial cookies.json to volume path: ${targetCookies}`));
    }

    const sourceKeys = path.join(__dirname, 'api-keys.json');
    const targetKeys = path.join(DATA_DIR, 'api-keys.json');
    if (!fs.existsSync(targetKeys)) {
      if (fs.existsSync(sourceKeys)) {
        fs.copySync(sourceKeys, targetKeys);
        console.log(chalk.green(`🚚 Migrated initial api-keys.json to volume path: ${targetKeys}`));
      } else {
        const defaultKeys = {
          keys: [
            {
              key: "sk-cgp-3eirgct19bdrvyaosz91ak",
              label: "Default Web Chatbot Key",
              url: null,
              createdAt: new Date().toISOString()
            }
          ]
        };
        fs.writeJsonSync(targetKeys, defaultKeys, { spaces: 2 });
        console.log(chalk.green(`🔑 Created fresh api-keys.json with default key: ${targetKeys}`));
      }
    }
  } catch (err) {
    console.error('Failed to configure DATA_DIR volume storage:', err.message);
  }
}

const COOKIES_FILE = DATA_DIR ? path.join(DATA_DIR, 'cookies.json') : path.join(__dirname, 'chatgpt-image-automation', 'cookies.json');
const KEYS_FILE = DATA_DIR ? path.join(DATA_DIR, 'api-keys.json') : path.join(__dirname, 'api-keys.json');
const THREADS_FILE = DATA_DIR ? path.join(DATA_DIR, 'threads.json') : path.join(__dirname, 'threads.json');

// Ensure key 'sk-cgp-whatsapp-owner' exists in KEYS_FILE
try {
  if (fs.existsSync(KEYS_FILE)) {
    const data = fs.readJsonSync(KEYS_FILE);
    if (!data.keys.some(k => k.key === 'sk-cgp-whatsapp-owner')) {
      data.keys.push({
        key: 'sk-cgp-whatsapp-owner',
        label: 'WhatsApp Owner Bot Key',
        url: null,
        createdAt: new Date().toISOString()
      });
      fs.writeJsonSync(KEYS_FILE, data, { spaces: 2 });
      console.log(chalk.green(`🔑 Added default WhatsApp Owner Bot Key to api-keys.json`));
    }
  } else {
    const defaultKeys = {
      keys: [
        {
          key: "sk-cgp-3eirgct19bdrvyaosz91ak",
          label: "Default Web Chatbot Key",
          url: null,
          createdAt: new Date().toISOString()
        },
        {
          key: "sk-cgp-whatsapp-owner",
          label: "WhatsApp Owner Bot Key",
          url: null,
          createdAt: new Date().toISOString()
        }
      ]
    };
    fs.ensureDirSync(path.dirname(KEYS_FILE));
    fs.writeJsonSync(KEYS_FILE, defaultKeys, { spaces: 2 });
    console.log(chalk.green(`🔑 Created fresh api-keys.json with default and WhatsApp owner keys: ${KEYS_FILE}`));
  }
} catch (err) {
  console.error('Failed to ensure WhatsApp Owner Key in keys file:', err.message);
}

// Parse CHATGPT_COOKIES env var if present and write it to COOKIES_FILE on startup
if (process.env.CHATGPT_COOKIES) {
  try {
    let rawCookies = process.env.CHATGPT_COOKIES.trim();
    // Check if it's base64 encoded
    if (!rawCookies.startsWith('[') && !rawCookies.startsWith('{')) {
      try {
        const decoded = Buffer.from(rawCookies, 'base64').toString('utf8');
        if (decoded.startsWith('[') || decoded.startsWith('{')) {
          rawCookies = decoded;
        }
      } catch (e) {
        // Ignore and use raw
      }
    }
    const parsed = JSON.parse(rawCookies);
    const cookiesArray = Array.isArray(parsed) ? parsed : (parsed.cookies || [parsed]);
    fs.ensureDirSync(path.dirname(COOKIES_FILE));
    fs.writeJsonSync(COOKIES_FILE, cookiesArray, { spaces: 2 });
    console.log(chalk.green(`🔑 Loaded ${cookiesArray.length} cookies from CHATGPT_COOKIES environment variable!`));
  } catch (err) {
    console.error('❌ Failed to parse CHATGPT_COOKIES env variable:', err.message);
  }
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || null;
const HEADLESS = process.env.HEADLESS !== 'false';

// ── Database Helpers ───────────────────────────────────────────

async function updateKeyUrl(key, url) {
  try {
    const data = await fs.readJson(KEYS_FILE).catch(() => ({ keys: [] }));
    const record = data.keys.find(k => k.key === key);
    if (record) {
      record.url = url;
      await fs.writeJson(KEYS_FILE, data, { spaces: 2 });
      console.log(chalk.green(`💾 Mapped API Key "${record.label}" to session: ${url}`));
    }
  } catch (err) {
    console.error('Failed to save key URL mapping:', err);
  }
}

async function getThreadUrl(apiKey, threadId) {
  try {
    if (await fs.pathExists(THREADS_FILE)) {
      const data = await fs.readJson(THREADS_FILE);
      return data[apiKey]?.[threadId] || null;
    }
  } catch (err) {
    console.error('Failed to read threads mapping:', err.message);
  }
  return null;
}

async function saveThreadUrl(apiKey, threadId, url) {
  try {
    let data = {};
    if (await fs.pathExists(THREADS_FILE)) {
      data = await fs.readJson(THREADS_FILE);
    }
    if (!data[apiKey]) data[apiKey] = {};
    data[apiKey][threadId] = url;
    await fs.writeJson(THREADS_FILE, data, { spaces: 2 });
    console.log(chalk.green(`💾 Mapped Thread "${threadId}" for API Key to session: ${url}`));
  } catch (err) {
    console.error('Failed to save thread mapping:', err.message);
  }
}

// ── Auth Middleware ────────────────────────────────────────────

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Unauthorized: Missing or invalid Bearer token.', type: 'invalid_request_error', code: null }
    });
  }

  const token = authHeader.substring(7);

  // 1. Check master key
  if (GATEWAY_API_KEY && token === GATEWAY_API_KEY) {
    req.apiKeyRecord = { key: GATEWAY_API_KEY, label: 'Master Key', url: null };
    return next();
  }

  // 2. Check generated keys database
  try {
    const data = await fs.readJson(KEYS_FILE).catch(() => ({ keys: [] }));
    const record = data.keys.find(k => k.key === token);
    if (record) {
      req.apiKeyRecord = record; // Attach the record containing the dedicated chat URL
      return next();
    }
  } catch (err) {
    console.error('Error checking API keys store:', err.message);
  }

  return res.status(401).json({
    error: { message: 'Unauthorized: Invalid API key.', type: 'invalid_request_error', code: null }
  });
}

// ── Concurrency Request Queue ──────────────────────────────────

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.processing = false;
      this.process();
    }
  }
}

const botQueue = new RequestQueue();

// ── Bot Lifecycle ──────────────────────────────────────────────

let bot = null;
let isInitializing = false;

async function initBot() {
  if (isInitializing) return;
  isInitializing = true;
  console.log(chalk.cyan(`\n🤖 Initializing persistent ChatGPT bot (Headless=${HEADLESS})...`));

  try {
    if (bot) {
      await bot.close().catch(() => { });
    }

    bot = new ChatGPTImageBot({
      cookiesFile: COOKIES_FILE,
      headless: HEADLESS,
      slowMo: 0,
    });

    await bot.launch();
    await bot.navigate();

    console.log(chalk.green('✅ Persistent ChatGPT bot session is READY!'));
  } catch (err) {
    console.error(chalk.red(`❌ Failed to initialize bot: ${err.message}`));
    bot = null;
  } finally {
    isInitializing = false;
  }
}

async function ensureBotActive() {
  const isWorking = bot && bot.page && !bot.page.isClosed() && await bot.page.evaluate(() => true).catch(() => false);
  if (!isWorking) {
    console.log(chalk.yellow('⚠️ Bot session inactive or crashed. Restarting...'));
    await initBot();
  }
}

// Helper to get latest assistant message text
async function getLatestAssistantText(page) {
  return await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (msgs.length === 0) return '';
    const last = msgs[msgs.length - 1];
    const mdDiv = last.querySelector('.markdown') || last.querySelector('.prose') || last;
    return mdDiv.innerText || '';
  }).catch(() => '');
}

// ── WhatsApp Endpoints ──────────────────────────────────────────

// GET /api/whatsapp/status - Return WhatsApp bot connection state
app.get('/api/whatsapp/status', (req, res) => {
  res.json(whatsappState);
});

// POST /api/whatsapp/send - Send a WhatsApp message
app.post('/api/whatsapp/send', async (req, res) => {
  const { number, message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  try {
    const { whatsappClient, whatsappState } = await import('./whatsapp-bot.js');
    if (!whatsappClient || whatsappState.status !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp client is not connected' });
    }
    const targetNumber = number || whatsappState.number;
    if (!targetNumber) {
      return res.status(400).json({ error: 'No recipient number provided and owner number is not available' });
    }
    const chatId = targetNumber.endsWith('@c.us') ? targetNumber : `${targetNumber}@c.us`;
    await whatsappClient.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send WhatsApp message via API:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/logout - Log out/reset WhatsApp bot session
app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    const { whatsappClient } = await import('./whatsapp-bot.js');
    if (whatsappClient) {
      // whatsappClient.logout() removed to prevent EBUSY crash
      try {
        await whatsappClient.destroy();
      } catch (err) {
        console.warn('WhatsApp Client destroy call failed:', err.message);
      }
    }
    // Delete session directory
    const sessionPath = path.join(__dirname, 'whatsapp-session-new4');
    await fs.remove(sessionPath).catch(err => console.error('Failed to remove WhatsApp session directory:', err.message));
    
    // Re-initialize a clean client
    initWhatsApp().catch(err => console.error('Failed to re-initialize WhatsApp client:', err.message));
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API Keys Management Endpoints ──────────────────────────────

// GET /api/keys-mgmt - List keys
app.get('/api/keys-mgmt', async (req, res) => {
  try {
    const data = await fs.readJson(KEYS_FILE).catch(() => ({ keys: [] }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keys-mgmt - Create a key
app.post('/api/keys-mgmt', async (req, res) => {
  const { label, key } = req.body;
  if (!label) {
    return res.status(400).json({ error: 'Label is required' });
  }
  try {
    const data = await fs.readJson(KEYS_FILE).catch(() => ({ keys: [] }));
    const finalKey = key || `sk-cgp-${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

    // Check if key already exists
    const existing = data.keys.find(k => k.key === finalKey);
    if (existing) {
      return res.status(400).json({ error: 'API key already exists' });
    }

    const newRecord = {
      key: finalKey,
      label,
      url: null,
      createdAt: new Date().toISOString()
    };
    data.keys.push(newRecord);
    await fs.writeJson(KEYS_FILE, data, { spaces: 2 });
    res.json(newRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/keys-mgmt/:key - Delete a key
app.delete('/api/keys-mgmt/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const data = await fs.readJson(KEYS_FILE).catch(() => ({ keys: [] }));
    const filtered = data.keys.filter(k => k.key !== key);
    await fs.writeJson(KEYS_FILE, { keys: filtered }, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/debug - Remote diagnostic checks & screenshot
app.get('/api/debug', authMiddleware, async (req, res) => {
  try {
    const isHealthy = bot && bot.page && !bot.page.isClosed();
    const url = isHealthy ? bot.page.url() : 'browser-inactive';
    const title = isHealthy ? await bot.page.title().catch(() => 'error') : '';

    let screenshotBase64 = null;
    let iframes = [];
    let inputsInfo = [];
    if (isHealthy) {
      const buffer = await bot.page.screenshot({ type: 'png' }).catch(() => null);
      if (buffer) {
        screenshotBase64 = buffer.toString('base64');
      }

      iframes = await bot.page.evaluate(() => {
        const list = [];
        const findIframes = (root) => {
          if (!root) return;
          const all = root.querySelectorAll('*');
          for (const el of all) {
            if (el.tagName === 'IFRAME') {
              const r = el.getBoundingClientRect();
              list.push({
                src: el.src,
                id: el.id,
                className: el.className,
                title: el.title,
                rect: { x: r.x, y: r.y, w: r.width, h: r.height }
              });
            }
            if (el.shadowRoot) {
              findIframes(el.shadowRoot);
            }
          }
        };
        findIframes(document);
        return list;
      }).catch(() => []);

      inputsInfo = await bot.page.evaluate(() => {
        const found = [];
        const elements = document.querySelectorAll('textarea, [contenteditable="true"], [name*="prompt"], [placeholder*="Ask"], [placeholder*="Message"]');
        for (const el of elements) {
          const r = el.getBoundingClientRect();
          found.push({
            tagName: el.tagName,
            id: el.id,
            name: el.getAttribute('name'),
            className: el.className,
            placeholder: el.getAttribute('placeholder'),
            visible: r.width > 0 && r.height > 0,
            rect: { x: r.x, y: r.y, w: r.width, h: r.height }
          });
        }
        return found;
      }).catch(() => []);
    }

    res.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      browserActive: !!(bot && bot.context),
      url,
      title,
      iframes,
      inputsInfo,
      framesList: isHealthy ? bot.page.frames().map(f => ({ name: f.name(), url: f.url() })) : [],
      consoleLogs: isHealthy && bot ? bot.consoleLogs || [] : [],
      screenshot: screenshotBase64 ? `data:image/png;base64,${screenshotBase64}` : null,
      html: isHealthy ? await bot.page.content().catch(() => '') : null,
      keysFileExists: await fs.pathExists(KEYS_FILE),
      cookiesFileExists: await fs.pathExists(COOKIES_FILE),
      dataDir: DATA_DIR,
      keysFile: KEYS_FILE,
      cookiesFile: COOKIES_FILE,
      env: {
        CHATGPT_COOKIES_LEN: process.env.CHATGPT_COOKIES ? process.env.CHATGPT_COOKIES.length : 0,
        CHATGPT_COOKIES_START: process.env.CHATGPT_COOKIES ? process.env.CHATGPT_COOKIES.trim().substring(0, 40) : null,
        GATEWAY_API_KEY_LEN: process.env.GATEWAY_API_KEY ? process.env.GATEWAY_API_KEY.length : 0,
        DATA_DIR: process.env.DATA_DIR || null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Chat Endpoints ─────────────────────────────────────────────

// Health Check
app.get('/health', (req, res) => {
  const isHealthy = bot && bot.page && !bot.page.isClosed();
  res.json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    browserActive: !!(bot && bot.context),
    isInitializing
  });
});

app.post('/api/chat', authMiddleware, async (req, res) => {
  const { message, thread_id } = req.body;
  const keyRecord = req.apiKeyRecord;
  const threadId = req.headers['x-thread-id'] || thread_id || 'default';

  if (!message) {
    return res.status(400).json({ error: 'Message payload is required' });
  }

  console.log(chalk.cyan(`\n💬 Prompt from "${keyRecord.label}" (Thread: ${threadId}): "${message.slice(0, 60)}..."`));

  try {
    await botQueue.add(async () => {
      await ensureBotActive();
      const localBot = bot;
      if (!localBot || !localBot.page) {
        throw new Error('ChatGPT bot engine is offline.');
      }

      const threadUrl = await getThreadUrl(keyRecord.key, threadId) || keyRecord.url;

      // ── Session Switching Logic ──
      const currentUrl = localBot.page.url();
      if (threadUrl) {
        if (currentUrl !== threadUrl) {
          console.log(chalk.yellow(`🔄 Switching thread context to: ${threadUrl}`));
          await localBot.page.goto(threadUrl, { waitUntil: 'domcontentloaded', timeout: localBot.pageTimeout });
          await localBot.page.waitForTimeout(3000);
          await localBot._bypassCloudflare();
          await localBot._waitForChatReady();
        }
      } else {
        console.log(chalk.yellow(`🆕 Starting fresh thread context for: "${keyRecord.label}" (Thread ID: ${threadId})`));
        await localBot.newChat();
      }

      // Focus, type, and submit
      await localBot._focusChatInput();
      await localBot._typePrompt(message);
      await localBot._submitPrompt();

      console.log(chalk.gray('⏳ Waiting for ChatGPT response...'));
      await localBot._waitForNotGenerating();
      await localBot.page.waitForTimeout(2000);

      // Capture dynamic thread URL
      const latestUrl = localBot.page.url();
      if (!threadUrl && latestUrl.startsWith(`${localBot.chatgptUrl}/c/`)) {
        await saveThreadUrl(keyRecord.key, threadId, latestUrl);
        if (threadId === 'default') {
          keyRecord.url = latestUrl;
          await updateKeyUrl(keyRecord.key, latestUrl);
        }
      }

      const text = await getLatestAssistantText(localBot.page);
      if (!text) {
        throw new Error('No response text returned from ChatGPT.');
      }

      console.log(chalk.green(`✅ Response delivered successfully`));
      res.json({ response: text });
    });
  } catch (err) {
    console.error(chalk.red(`❌ Chat endpoint error: ${err.message}`));
    res.status(500).json({ error: `Internal execution error: ${err.message}` });
  }
});

// OpenAI-Compatible Models Endpoint
app.get(['/v1/models', '/models', '/api/chat/models', '/api/chat/v1/models'], authMiddleware, (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'gpt-4o',
        object: 'model',
        created: 1715644800,
        owned_by: 'openai'
      },
      {
        id: 'chatgpt',
        object: 'model',
        created: 1715644800,
        owned_by: 'system'
      }
    ]
  });
});

// OpenAI-Compatible Chat Completions Endpoint
app.post(['/v1/chat/completions', '/chat/completions', '/api/chat/chat/completions', '/api/chat/completions'], authMiddleware, async (req, res) => {
  const { messages, model = 'gpt-4o', stream = false, thread_id } = req.body;
  const keyRecord = req.apiKeyRecord;
  const threadId = req.headers['x-thread-id'] || thread_id || 'default';

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'messages is a required array', type: 'invalid_request_error', code: null }
    });
  }

  // Find last user message
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (!lastUserMsg || !lastUserMsg.content) {
    return res.status(400).json({
      error: { message: 'No active user message found in the messages array', type: 'invalid_request_error', code: null }
    });
  }

  const promptText = typeof lastUserMsg.content === 'string'
    ? lastUserMsg.content
    : JSON.stringify(lastUserMsg.content);

  console.log(chalk.cyan(`\n💬 Prompt from "${keyRecord.label}" (Thread: ${threadId}): "${promptText.slice(0, 60)}..."`));

  try {
    await botQueue.add(async () => {
      await ensureBotActive();
      const localBot = bot;
      if (!localBot || !localBot.page) {
        throw new Error('ChatGPT bot engine is offline.');
      }

      const threadUrl = await getThreadUrl(keyRecord.key, threadId) || keyRecord.url;

      // ── Session Switching Logic ──
      const currentUrl = localBot.page.url();
      if (threadUrl) {
        if (currentUrl !== threadUrl) {
          console.log(chalk.yellow(`🔄 Switching thread context to: ${threadUrl}`));
          await localBot.page.goto(threadUrl, { waitUntil: 'domcontentloaded', timeout: localBot.pageTimeout });
          await localBot.page.waitForTimeout(3000);
          await localBot._bypassCloudflare();
          await localBot._waitForChatReady();
        }
      } else {
        console.log(chalk.yellow(`🆕 Starting fresh thread context for: "${keyRecord.label}" (Thread ID: ${threadId})`));
        await localBot.newChat();
      }

      // Focus, type, and submit
      await localBot._focusChatInput();
      await localBot._typePrompt(promptText);

      // Record assistant count before submission
      const countBefore = await localBot.page.evaluate(() => document.querySelectorAll('[data-message-author-role="assistant"]').length);

      await localBot._submitPrompt();

      // Wait for generation to start
      console.log(chalk.gray('⏳ Waiting for ChatGPT response to start...'));
      let started = false;
      for (let i = 0; i < 40; i++) {
        const isGen = await localBot._isGenerating();
        const currentCount = await localBot.page.evaluate(() => document.querySelectorAll('[data-message-author-role="assistant"]').length);
        if (isGen || currentCount > countBefore) {
          started = true;
          break;
        }
        await localBot.page.waitForTimeout(100);
      }

      if (stream === true || stream === 'true') {
        // SSE Streaming Response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const responseId = `chatcmpl-${Math.random().toString(36).substring(2, 15)}`;
        const createdTime = Math.floor(Date.now() / 1000);

        const sendChunk = (content, finishReason = null) => {
          const chunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdTime,
            model,
            choices: [
              {
                index: 0,
                delta: content ? { content } : {},
                finish_reason: finishReason
              }
            ]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        };

        let lastText = '';
        let sameTextCount = 0;
        let isGenerating = true;

        while (isGenerating || sameTextCount < 15) {
          const currentText = await getLatestAssistantText(localBot.page);

          // Capture dynamic thread URL
          const currentUrl = localBot.page.url();
          if (!threadUrl && currentUrl.startsWith(`${localBot.chatgptUrl}/c/`)) {
            await saveThreadUrl(keyRecord.key, threadId, currentUrl);
            if (threadId === 'default') {
              keyRecord.url = currentUrl;
              await updateKeyUrl(keyRecord.key, currentUrl);
            }
          }

          if (currentText.length > lastText.length && currentText.startsWith(lastText)) {
            const delta = currentText.substring(lastText.length);
            sendChunk(delta);
            lastText = currentText;
            sameTextCount = 0;
          } else if (currentText === lastText) {
            sameTextCount++;
          } else if (currentText.length > 0) {
            lastText = currentText;
            sameTextCount = 0;
          }

          isGenerating = await localBot._isGenerating();
          await localBot.page.waitForTimeout(100);
        }

        // Finalize stream
        sendChunk(null, 'stop');
        res.write('data: [DONE]\n\n');
        res.end();
        console.log(chalk.green(`✅ Response streamed successfully`));

      } else {
        // Non-Streaming Response
        console.log(chalk.gray('⏳ Waiting for complete response...'));
        await localBot._waitForNotGenerating();
        await localBot.page.waitForTimeout(2000); // Settle down

        // Capture dynamic thread URL
        const currentUrl = localBot.page.url();
        if (!threadUrl && currentUrl.startsWith(`${localBot.chatgptUrl}/c/`)) {
          await saveThreadUrl(keyRecord.key, threadId, currentUrl);
          if (threadId === 'default') {
            keyRecord.url = currentUrl;
            await updateKeyUrl(keyRecord.key, currentUrl);
          }
        }

        const currentText = await getLatestAssistantText(localBot.page);

        if (!currentText) {
          throw new Error('No response text returned from ChatGPT.');
        }

        console.log(chalk.green(`✅ Response delivered successfully (OpenAI format)`));
        const responseId = `chatcmpl-${Math.random().toString(36).substring(2, 15)}`;
        const createdTime = Math.floor(Date.now() / 1000);

        res.json({
          id: responseId,
          object: 'chat.completion',
          created: createdTime,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: currentText
              },
              logprobs: null,
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: Math.round(promptText.length / 4),
            completion_tokens: Math.round(currentText.length / 4),
            total_tokens: Math.round((promptText.length + currentText.length) / 4)
          }
        });
      }
    });

  } catch (err) {
    console.error(chalk.red(`❌ Chat completion endpoint error: ${err.message}`));
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: `Internal execution error: ${err.message}`, type: 'api_error', code: null }
      });
    } else {
      res.end();
    }
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(chalk.bold.green(`🚀 Chat Gateway Server is running on port ${PORT}`));
  await initBot();
  initWhatsApp().catch(err => console.error('Failed to initialize WhatsApp bot service:', err));

  // Autostart Schedulers in background if enabled
  if (process.env.START_TWITTER_SCHEDULER !== 'false') {
    console.log(chalk.bold.blue('⏰ Autostarting Twitter Trend Scheduler in background...'));
    import('./twitter-scheduler.js').catch(err => {
      console.error('❌ Failed to autostart Twitter scheduler:', err.message);
    });
  }

  if (process.env.START_LINKEDIN_SCHEDULER !== 'false') {
    console.log(chalk.bold.blue('⏰ Autostarting LinkedIn Daily Scheduler in background...'));
    import('./scheduler.js').catch(err => {
      console.error('❌ Failed to autostart LinkedIn scheduler:', err.message);
    });
  }
});
