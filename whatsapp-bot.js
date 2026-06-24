import fs from 'fs-extra';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import util from 'util';
import { EdgeTTS } from 'node-edge-tts';

const execFileAsync = util.promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Connection State
export const whatsappState = {
  status: 'disconnected', // 'disconnected', 'qr', 'connecting', 'connected'
  qr: null,
  number: null,
  error: null
};

function getChromePath() {
  if (os.platform() === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
    ];
    return winPaths.find(p => fs.existsSync(p)) || null;
  } else {
    const linuxPaths = [
      '/opt/google/chrome/chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    return linuxPaths.find(p => fs.existsSync(p)) || null;
  }
}

export let whatsappClient = null;

export async function initWhatsApp() {
  console.log('🤖 Initializing WhatsApp Web Relay...');
  whatsappState.status = 'connecting';
  whatsappState.error = null;

  const chromePath = getChromePath();
  console.log(`👉 Selected Chrome Executable Path: ${chromePath || 'Bundled Chromium'}`);

  const sessionPath = path.join(__dirname, 'whatsapp-session-new5');
  await fs.ensureDir(sessionPath);

  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      clientId: 'whatsapp-owner-relay',
      dataPath: sessionPath
    }),
    puppeteer: {
      executablePath: chromePath || undefined,
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      ]
    }
  });

  whatsappClient.on('qr', async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr);
      whatsappState.qr = dataUrl;
      whatsappState.status = 'qr';
      console.log('👉 WhatsApp QR Code generated. View it in the dashboard UI!');
    } catch (err) {
      console.error('Failed to generate QR data URL:', err.message);
    }
  });

  whatsappClient.on('ready', () => {
    whatsappState.status = 'connected';
    whatsappState.qr = null;
    whatsappState.number = whatsappClient.info.wid.user;
    console.log(`✅ WhatsApp Client is READY! Authenticated as: ${whatsappState.number}`);
  });

  whatsappClient.on('auth_failure', (msg) => {
    whatsappState.status = 'disconnected';
    whatsappState.error = `Authentication failure: ${msg}`;
    console.error('❌ WhatsApp Authentication Failure:', msg);
  });

  whatsappClient.on('disconnected', (reason) => {
    whatsappState.status = 'disconnected';
    whatsappState.qr = null;
    whatsappState.number = null;
    console.log('❌ WhatsApp Client was disconnected:', reason);
  });

  // Handle messages
  whatsappClient.on('message_create', async (msg) => {
    try {
      const from = msg.from || '';
      const to = msg.to || '';
      const author = msg.author || '';

      // If it's an outgoing message sent by this account, and it's NOT sent to ourselves, ignore it!
      if (msg.fromMe && !to.includes(from)) {
        return;
      }

      const isOwner = from.includes('7706829707') || from.includes('9872364476') || author.includes('7706829707') || author.includes('9872364476') || from.includes('3857484656665') || (whatsappState.number && (from.includes(whatsappState.number) || author.includes(whatsappState.number)));

      console.log(`[DEBUG] msg_create: from=${from}, to=${to}, author=${author}, fromMe=${msg.fromMe}, body=${msg.body}, isOwner=${isOwner}`);

      // If it's a message from the owner (or sent by Sateesh)
      if (isOwner) {
        const text = (msg.body || '').trim();
        if (!text) return;

        // 1. Check if this is a "message to" command
        // Format: "message to <number/name>: <text>" or "send message to <number/name>: <text>"
        const messageToMatch = text.match(/^(?:send\s+)?message\s+to\s+([^:]+):\s*([\s\S]+)$/i);
        if (messageToMatch) {
          const targetSearch = messageToMatch[1].trim();
          const textToSend = messageToMatch[2].trim();
          
          console.log(`💬 Executing owner command: send message to "${targetSearch}" -> "${textToSend.substring(0, 30)}..."`);
          
          try {
            let chatId = null;
            // Check if target is a number (starts with + or contains only digits after cleaning)
            const isNumber = /^\+?\d[\d\s-]{5,15}$/.test(targetSearch);
            if (isNumber) {
              const cleanNumber = targetSearch.replace(/\D/g, '');
              chatId = cleanNumber.endsWith('@c.us') ? cleanNumber : `${cleanNumber}@c.us`;
              await whatsappClient.sendMessage(chatId, textToSend);
              await msg.reply(`✅ Message sent to number ${targetSearch}`);
            } else {
              // Find contact by name (checking name, pushname, and shortName)
              const contacts = await whatsappClient.getContacts();
              const targetContact = contacts.find(c => {
                const nameLower = (c.name || '').toLowerCase();
                const pushnameLower = (c.pushname || '').toLowerCase();
                const shortNameLower = (c.shortName || '').toLowerCase();
                const searchLower = targetSearch.toLowerCase();
                return nameLower.includes(searchLower) || pushnameLower.includes(searchLower) || shortNameLower.includes(searchLower);
              });
              if (targetContact) {
                chatId = targetContact.id._serialized;
                await whatsappClient.sendMessage(chatId, textToSend);
                await msg.reply(`✅ Message sent to contact "${targetContact.name || targetContact.pushname || targetSearch}"`);
              } else {
                await msg.reply(`❌ Contact not found matching: "${targetSearch}"`);
              }
            }
          } catch (err) {
            await msg.reply(`❌ Failed to send message: ${err.message}`);
          }
          return;
        }

        // Handle Voice Messages
        if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
          try {
            await msg.reply('⏳ Listening and transcribing...');
            const media = await msg.downloadMedia();
            
            // Save to temp file
            const tempId = Date.now().toString();
            const tempDir = os.tmpdir();
            const oggPath = path.join(tempDir, `${tempId}.ogg`);
            const wavPath = path.join(tempDir, `${tempId}.wav`);
            const mp3Path = path.join(tempDir, `${tempId}.mp3`);
            
            await fs.writeFile(oggPath, Buffer.from(media.data, 'base64'));
            
            // Convert to WAV
            await execFileAsync(ffmpegPath, ['-y', '-i', oggPath, '-ac', '1', '-ar', '16000', wavPath]);
            
            // Call Python STT
            const { stdout } = await execFileAsync('python', ['stt.py', wavPath], { cwd: process.cwd() });
            const transcribedText = stdout.trim();
            
            if (!transcribedText) {
              await msg.reply('❌ Could not transcribe the voice clearly. Please try again.');
              return;
            }
            
            console.log(`🗣️ Heard: "${transcribedText}"`);
            const chat = await msg.getChat();
            await chat.sendStateRecording();
            
            // Get text response from ChatGPT
            const gptResponse = await queryChatGPTCompletions(transcribedText, null, from);
            console.log(`🤖 Reply text: "${gptResponse.substring(0, 50)}..."`);
            
            // Generate TTS
            const tts = new EdgeTTS({ voice: 'hi-IN-SwaraNeural' });
            await tts.ttsPromise(gptResponse, mp3Path);
            
            // Convert MP3 to OGG OPUS for WhatsApp Voice Notes
            const replyOggPath = path.join(tempDir, `reply-${tempId}.ogg`);
            await execFileAsync(ffmpegPath, ['-y', '-i', mp3Path, '-c:a', 'libopus', replyOggPath]);
            
            // Send back as voice note
            const responseMedia = MessageMedia.fromFilePath(replyOggPath);
            await msg.reply(responseMedia, null, { sendAudioAsVoice: true });
            
            // Cleanup
            await fs.unlink(oggPath).catch(() => {});
            await fs.unlink(wavPath).catch(() => {});
            await fs.unlink(mp3Path).catch(() => {});
            await fs.unlink(replyOggPath).catch(() => {});
            
          } catch (err) {
            console.error('Voice Processing Error:', err);
            await msg.reply(`❌ Voice Processing Error: ${err.message}`);
          }
          return;
        }

        // Handle Post LinkedIn/Search Leads triggers
        const postMatch = text.match(/^(?:create|make|write|generate)?\s*(?:a\s+)?(?:linkedin\s+)?(?:post|article|blog)s?\s*(?:on\s+linkedin|for\s+linkedin)?\s*(?:as\s+(personal|company))?\s*(?:an?\s+(post|article|blog))?\s*(?:about|on|for|:|-)?\s*(.*)$/i);
        const isPostIntent = /^(?:post|create|make|write)\b/i.test(text) || (text.toLowerCase().includes('linkedin') && (text.toLowerCase().includes('post') || text.toLowerCase().includes('article') || text.toLowerCase().includes('blog')));

        if (postMatch && isPostIntent) {
          const target = text.toLowerCase().includes('company') ? 'company' : 'personal';
          const type = (text.toLowerCase().includes('article') || text.toLowerCase().includes('blog')) ? 'article' : 'post';
          
          let topic = postMatch[3] ? postMatch[3].trim() : '';
          if (!topic) {
            const aboutMatch = text.match(/(?:about|on|for|:)\s+(.+)$/i);
            if (aboutMatch) topic = aboutMatch[1].trim();
          }
          
          if (!topic) {
            await msg.reply(`Please provide a topic! For example:\n\n*Post on linkedin about the future of AI*`);
            return;
          }
          
          await msg.reply(`🚀 Starting LinkedIn pipeline...\n📌 Target: ${target}\n📝 Type: ${type}\n💡 Topic: "${topic}"`);
          try {
            const { default: runPipeline } = await import('./daily-post.js');
            const result = await runPipeline(topic, { target, type });
            if (type === 'article') {
              await msg.reply(`✅ Posted successfully to LinkedIn!\n\n📝 Title: ${result.title}\n📖 Length: ${result.caption.length} chars`);
            } else {
              await msg.reply(`✅ Posted successfully to LinkedIn!\n\n📝 Topic: ${result.topic}\n🎨 Image saved: ${path.basename(result.imagePath)}`);
            }
          } catch (err) {
            await msg.reply(`❌ LinkedIn post pipeline failed: ${err.message}`);
          }
          return;
        }

        const searchMatch = text.match(/^(?:search|find|get)\s*(?:linkedin\s+)?leads\s*(?:for|about|:|-)?\s*(.*)$/i);
        const isLeadIntent = text.toLowerCase().includes('leads');

        if (searchMatch && isLeadIntent) {
          const keyword = searchMatch[1].trim();
          if (!keyword) {
            await msg.reply(`Please provide a keyword to search! For example:\n\n*Search leads: App developers in India*`);
            return;
          }
          
          await msg.reply(`🔍 Searching LinkedIn for leads matching: "${keyword}"...`);
          try {
            const { LinkedInLeads } = await import('./linkedin-leads.js');
            const leadSearcher = new LinkedInLeads({ headless: true });
            await leadSearcher.launch();
            const leads = await leadSearcher.searchLeads(keyword);
            await leadSearcher.close();
            
            if (leads.length === 0) {
              await msg.reply(`❌ No leads found for "${keyword}".`);
            } else {
              let responseText = `✅ Found ${leads.length} leads for "${keyword}":\n\n`;
              leads.forEach((l, i) => {
                responseText += `${i+1}. *${l.name}*\n${l.headline}\n${l.profileUrl}\n_"${l.text.substring(0, 100)}..."_\n\n`;
              });
              await msg.reply(responseText);
            }
          } catch (err) {
            await msg.reply(`❌ LinkedIn lead search failed: ${err.message}`);
          }
          return;
        }

        // Default: Talk to ChatGPT
        try {
          const chat = await msg.getChat();
          await chat.sendStateTyping();

          let reply = await queryChatGPTCompletions(text, null, from);

          const articleMatch = reply.match(/\[ACTION:\s*POST_LINKEDIN_ARTICLE\]\s*Topic:\s*(.+)/i);
          const postMatch = reply.match(/\[ACTION:\s*POST_LINKEDIN_POST\]\s*Topic:\s*(.+)/i);
          const leadsMatch = reply.match(/\[ACTION:\s*SEARCH_LEADS\]\s*Keyword:\s*(.+)/i);

          if (articleMatch || postMatch) {
            const isArticle = !!articleMatch;
            const topic = isArticle ? articleMatch[1].trim() : postMatch[1].trim();
            const type = isArticle ? 'article' : 'post';
            
            reply = reply.replace(/\[ACTION:.*?\]\s*Topic:\s*.+/gi, '').trim();
            if (reply) await msg.reply(reply);
            
            await msg.reply(`🚀 AI is starting LinkedIn pipeline...\n📌 Target: personal\n📝 Type: ${type}\n💡 Topic: "${topic}"`);
            try {
              const { default: runPipeline } = await import('./daily-post.js');
              const result = await runPipeline(topic, { target: 'personal', type });
              if (type === 'article') {
                await msg.reply(`✅ AI posted successfully to LinkedIn!\n\n📝 Title: ${result.title}\n📖 Length: ${result.caption.length} chars`);
              } else {
                await msg.reply(`✅ AI posted successfully to LinkedIn!\n\n📝 Topic: ${result.topic}\n🎨 Image saved: ${path.basename(result.imagePath)}`);
              }
            } catch (err) {
              await msg.reply(`❌ LinkedIn post pipeline failed: ${err.message}`);
            }
            return;
          }

          if (leadsMatch) {
            const keyword = leadsMatch[1].trim();
            reply = reply.replace(/\[ACTION:\s*SEARCH_LEADS\]\s*Keyword:\s*.+/gi, '').trim();
            if (reply) await msg.reply(reply);

            await msg.reply(`🔍 AI is searching LinkedIn for leads matching: "${keyword}"...`);
            try {
              const { LinkedInLeads } = await import('./linkedin-leads.js');
              const leadSearcher = new LinkedInLeads({ headless: true });
              await leadSearcher.launch();
              const leads = await leadSearcher.searchLeads(keyword);
              await leadSearcher.close();
              
              if (leads.length === 0) {
                await msg.reply(`❌ No leads found for "${keyword}".`);
              } else {
                let responseText = `✅ Found ${leads.length} leads for "${keyword}":\n\n`;
                leads.forEach((l, i) => {
                  responseText += `${i+1}. *${l.name}*\n${l.headline}\n${l.profileUrl}\n_"${l.text.substring(0, 100)}..."_\n\n`;
                });
                await msg.reply(responseText);
              }
            } catch (err) {
              await msg.reply(`❌ LinkedIn lead search failed: ${err.message}`);
            }
            return;
          }

          await msg.reply(reply);
        } catch (err) {
          await msg.reply(`❌ ChatGPT Error: ${err.message}`);
        }
        return;
      }

      // If it's NOT from the owner (incoming from clients or groups)
      if (!isOwner && !msg.fromMe) {
        const text = (msg.body || '').trim();
        if (!text) return;

        const chat = await msg.getChat();

        // Check if it's a group chat
        if (chat.isGroup) {
          console.log(`👥 Group chat message received from ${msg.author} in ${chat.name}: "${text.substring(0, 50)}"`);
          
          // Keywords to quickly filter out irrelevant group messages before calling ChatGPT
          const keywords = ['app', 'website', 'seo', 'seio', 'developer', 'development', 'software', 'lead', 'leads', 'design', 'coder', 'programming', 'application', 'site', 'mobile'];
          const textLower = text.toLowerCase();
          const hasKeyword = keywords.some(k => textLower.includes(k));
          
          if (hasKeyword) {
            console.log('🔍 Group message contains business keywords. Querying ChatGPT for relevance...');
            try {
              await chat.sendStateTyping();
              const groupContext = `You are Sateesh Kumar, Founder and CEO of Web Nova Crew. We provide premium digital services (mobile app development, website creation, custom software, and SEO).
You are monitoring a WhatsApp group chat.
Analyze this message: "${text}".
If the message is looking for, asking for, or discussing a need for digital services (like app development, website, custom software, UI/UX design, or SEO), write a very short, precise, and professional reply (1-2 lines max) offering our services and looking exactly like a quick reply from Sateesh Kumar.
If the message is NOT relevant to our digital services, reply with exactly the word "IRRELEVANT" and nothing else.`;
              
              const reply = await queryChatGPTCompletions(text, groupContext, from);
              if (reply && reply.trim() !== 'IRRELEVANT' && !reply.includes('IRRELEVANT')) {
                console.log(`🤖 Auto-replying to group chat: "${reply}"`);
                await msg.reply(reply);
              } else {
                console.log('🔇 Group message determined to be irrelevant.');
              }
            } catch (err) {
              console.error('Group auto-reply error:', err.message);
            }
          }
          return;
        }

        // Direct Message (DM) from a client/external user
        console.log(`👤 DM received from client ${from}: "${text.substring(0, 50)}"`);
        try {
          await chat.sendStateTyping();
          const clientContext = `You are Sateesh Kumar, Founder and CEO of Web Nova Crew. We provide premium digital services (app development, website design, SEO, and custom software).
Respond to this client message on WhatsApp.
Keep the response extremely precise, brief, and short (1-2 lines max).
Sound professional, friendly, helpful, and natural—exactly like Sateesh Kumar replying quickly from their phone.
Do not use placeholders. Provide a real, professional response.`;
          
          const reply = await queryChatGPTCompletions(text, clientContext, from);
          if (reply && reply.trim()) {
            console.log(`🤖 Auto-replying to client DM: "${reply}"`);
            await msg.reply(reply);
          }
        } catch (err) {
          console.error('Client DM auto-reply error:', err.message);
        }
      }
    } catch (err) {
      console.error(chalk.red(`❌ Error handling WhatsApp message_create event: ${err.message}`));
    }
  });

  await whatsappClient.initialize().catch((err) => {
    whatsappState.status = 'disconnected';
    whatsappState.error = err.message;
    console.error('❌ Failed to initialize WhatsApp client:', err.message);
  });
}
export function queryChatGPTCompletions(prompt, customSystemContext = null, threadId = 'default') {
  return new Promise((resolve, reject) => {
    let postData;
    let options;
    let requestModule;

    const useOfficialOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '';

    if (useOfficialOpenAI) {
      const systemContext = customSystemContext || `[SYSTEM NOTE: You are the Web Nova Crew AI Assistant on WhatsApp. YOU HAVE BACKGROUND AUTOMATION SCRIPTS ATTACHED TO YOU.
If the user wants you to publish an article or post to LinkedIn, YOU CAN DO IT! You MUST trigger the automation by including this exact string on a new line in your reply:
[ACTION: POST_LINKEDIN_ARTICLE] Topic: <topic here>
or
[ACTION: POST_LINKEDIN_POST] Topic: <topic here>

If the user wants you to find leads, trigger it by including:
[ACTION: SEARCH_LEADS] Keyword: <keyword here>

Do NOT tell the user to use a command. YOU execute the command yourself using the ACTION tags. The backend will intercept your ACTION tag and do the work.]`;

      postData = JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: prompt }
        ],
        stream: false
      });

      options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      requestModule = https;
      console.log(`🤖 Querying official OpenAI API using model: ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
    } else {
      const systemContext = customSystemContext || `[SYSTEM NOTE: You are the Web Nova Crew AI Assistant on WhatsApp. YOU HAVE BACKGROUND AUTOMATION SCRIPTS ATTACHED TO YOU.
If the user wants you to publish an article or post to LinkedIn, YOU CAN DO IT! You MUST trigger the automation by including this exact string on a new line in your reply:
[ACTION: POST_LINKEDIN_ARTICLE] Topic: <topic here>
or
[ACTION: POST_LINKEDIN_POST] Topic: <topic here>

If the user wants you to find leads, trigger it by including:
[ACTION: SEARCH_LEADS] Keyword: <keyword here>

Do NOT tell the user to use a command. YOU execute the command yourself using the ACTION tags. The backend will intercept your ACTION tag and do the work.]\n\n`;

      const finalPrompt = systemContext + "User: " + prompt;

      postData = JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: finalPrompt }],
        stream: false
      });

      options = {
        hostname: '127.0.0.1',
        port: process.env.PORT || 3000,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-cgp-whatsapp-owner',
          'Content-Length': Buffer.byteLength(postData),
          'X-Thread-ID': threadId
        }
      };
      requestModule = http;
      console.log('🤖 Querying local Playwright ChatGPT Gateway fallback on port 3000...');
    }

    const req = requestModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          console.log('[DEBUG] Raw completions response:', data);
          const parsed = JSON.parse(data);
          if (parsed.choices?.[0]?.message?.content) {
            resolve(parsed.choices[0].message.content);
          } else if (parsed.error) {
            const errMsg = typeof parsed.error === 'string' ? parsed.error : parsed.error.message;
            reject(new Error(errMsg || 'Unknown API error'));
          } else {
            reject(new Error('Unexpected completions response format.'));
          }
        } catch {
          reject(new Error(data || 'Failed to parse response.'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
