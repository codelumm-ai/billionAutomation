// ─────────────────────────────────────────────────────────────
//  Twitter/X Trend Posting Scheduler with Banner Generator
//  Fetches trends, generates a banner and tweet, and posts them
//  Features:
//   - Tracks posted trends and image URLs in posted-history.json
//   - Rotates through all scraped trends to prevent repeats
//   - Scans multiple tweets per trend to find a unique image
//   - Falls back to DALL-E if no unique image found anywhere
//  Run: npm run twitter-schedule
// ─────────────────────────────────────────────────────────────

import cron from 'node-cron';
import chalk from 'chalk';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { TwitterPoster } from './twitter-poster.js';
import { ChatGPTImageBot } from './chatgpt-image-automation/bot.js';

dotenv.config({ override: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────
const INTERVAL_MINS = parseInt(process.env.TWITTER_INTERVAL_MINUTES || '10', 10);
const CRON_EXPR = `*/${INTERVAL_MINS} * * * *`;
const HISTORY_FILE = path.join(__dirname, 'posted-history.json');

console.log(chalk.bold.blue('\n╔══════════════════════════════════════════════════════╗'));
console.log(chalk.bold.blue('║   ⏰  Twitter Trend Post Scheduler with Banners     ║'));
console.log(chalk.bold.blue('╚══════════════════════════════════════════════════════╝\n'));
console.log(chalk.gray('  Interval:   ') + chalk.white(`Every ${INTERVAL_MINS} minutes`));
console.log(chalk.gray('  Cron:       ') + chalk.white(CRON_EXPR));
console.log(chalk.gray('  Status:     ') + chalk.green('Running — waiting for next post time...'));
console.log(chalk.gray('\n  Tips:'));
console.log(chalk.gray('  • Change interval: set TWITTER_INTERVAL_MINUTES in .env'));
console.log(chalk.gray('  • Stop:            Ctrl+C\n'));

// ── History Helpers ───────────────────────────────────────────

async function loadHistory() {
  try {
    if (await fs.pathExists(HISTORY_FILE)) {
      const data = await fs.readJson(HISTORY_FILE);
      return {
        trends: Array.isArray(data.trends) ? data.trends : [],
        imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
      };
    }
  } catch (err) {
    console.warn(chalk.yellow(`⚠️ Failed to load history file: ${err.message}. Starting fresh.`));
  }
  return { trends: [], imageUrls: [] };
}

async function saveHistory(history) {
  try {
    await fs.writeJson(HISTORY_FILE, history, { spaces: 2 });
  } catch (err) {
    console.warn(chalk.yellow(`⚠️ Failed to save history file: ${err.message}`));
  }
}

// ── DALL-E Banner Builder ─────────────────────────────────────

function buildImagePrompt(trendName) {
  return (
    `A premium, high-resolution 16:9 technology banner themed on "${trendName}". ` +
    `Sleek web development / app UI mockup elements, floating digital networks, futuristic workspace tools, glowing abstract gradients of electric cyan, magenta, and deep violet. ` +
    `Minimalist corporate design, sharp focus, professional digital art, no spelling mistakes, clean.`
  );
}

// ── Pipeline ──────────────────────────────────────────────────

let isPipelineRunning = false;

async function runPipeline() {
  if (isPipelineRunning) {
    console.log(chalk.yellow('\n⚠️ Trend Post Pipeline is already running. Skipping this interval.'));
    return;
  }
  isPipelineRunning = true;
  const now = new Date().toLocaleString();
  console.log(chalk.bold.cyan(`\n[${now}] 🚀 Starting Twitter Trend Post Pipeline...\n`));

  const poster = new TwitterPoster({ headless: true });

  try {
    await poster.launch();
    await poster.verifyLogin();

    // 1. Scrape all trending topics
    const trends = await poster.fetchTrends();
    if (!trends || trends.length === 0) {
      console.log(chalk.yellow('⚠️ No trends scraped. Postponing until next interval.'));
      return;
    }

    // 2. Load posting history
    const history = await loadHistory();
    console.log(chalk.gray(`📜 History: ${history.trends.length} trends posted, ${history.imageUrls.length} images used`));

    // 3. Filter out already-posted trend names
    let unpostedTrends = trends.filter(t => !history.trends.includes(t.name));

    // If all trends have been posted, reset the trend history (but keep image URL history)
    if (unpostedTrends.length === 0) {
      console.log(chalk.yellow('🔄 All scraped trends have been posted before. Resetting trend history for fresh rotation...'));
      history.trends = [];
      await saveHistory(history);
      unpostedTrends = [...trends];
    }

    console.log(chalk.green(`🎯 ${unpostedTrends.length} unposted trends available: ${unpostedTrends.map(t => t.name).join(' | ')}`));

    // 4. Loop through unposted trends to find one with a unique image
    let selectedTrend = null;
    let mediaTweet = null;
    let imagePath = null;
    let tweetText = null;

    for (const trend of unpostedTrends) {
      console.log(chalk.bold.cyan(`\n🔎 Checking trend: "${trend.name}" (${trend.posts || 'unknown posts'})`));

      try {
        const found = await poster.fetchTrendMedia(trend, history.imageUrls);
        if (found && found.imgSrc) {
          // Found a unique image — select this trend
          selectedTrend = trend;
          mediaTweet = found;
          imagePath = await poster.downloadScrapedImage(mediaTweet.imgSrc);
          if (imagePath) {
            console.log(chalk.green(`✅ Unique image secured for trend: "${trend.name}"`));
            tweetText = await poster.generateViralTweet(trend, mediaTweet.text);
            break; // Stop scanning — we have what we need
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`⚠️ Failed to scrape media for "${trend.name}": ${err.message}`));
      }
    }

    // 5. Fallback: if no unique image found across all trends, use top unposted trend + DALL-E
    if (!selectedTrend) {
      selectedTrend = unpostedTrends[0];
      console.log(chalk.blue(`\nℹ️ No unique images found across any trend. Falling back to DALL-E for: "${selectedTrend.name}"`));

      tweetText = await poster.generateViralTweet(selectedTrend, null);

      const chatgptBot = new ChatGPTImageBot({
        cookiesFile: path.join(__dirname, 'chatgpt-image-automation', 'cookies.json'),
        profileDir: path.join(__dirname, 'chatgpt-image-automation', 'chrome-profile-twitter'),
        outputDir: path.join(__dirname, 'daily-banners'),
        headless: true,
        slowMo: 0,
      });

      try {
        await chatgptBot.launch();
        await chatgptBot.navigate();
        const imagePrompt = buildImagePrompt(selectedTrend.name);
        const timestamp = Date.now();
        const result = await chatgptBot.generateImage(imagePrompt, {
          saveAs: `twitter_banner_${timestamp}`,
        });
        imagePath = result.savedPath;
        console.log(chalk.green(`✅ DALL-E banner generated: ${path.basename(imagePath)}`));
      } catch (imgErr) {
        console.error(chalk.red(`⚠️ DALL-E image generation failed: ${imgErr.message}. Posting text-only tweet.`));
      } finally {
        await chatgptBot.close().catch(() => {});
      }
    }

    // 6. Post the tweet
    await poster.postTweet(tweetText, imagePath);

    // 7. Save trend and image URL to history
    if (!history.trends.includes(selectedTrend.name)) {
      history.trends.push(selectedTrend.name);
    }
    if (mediaTweet && mediaTweet.imgSrc) {
      const baseUrl = mediaTweet.imgSrc.split('?')[0];
      if (!history.imageUrls.some(u => u.split('?')[0] === baseUrl)) {
        history.imageUrls.push(mediaTweet.imgSrc);
      }
    }
    // Keep history from growing indefinitely — cap at 200 each
    if (history.trends.length > 200) history.trends = history.trends.slice(-200);
    if (history.imageUrls.length > 200) history.imageUrls = history.imageUrls.slice(-200);

    await saveHistory(history);
    console.log(chalk.gray(`💾 History saved: ${history.trends.length} trends, ${history.imageUrls.length} images`));
    console.log(chalk.bold.green('🎉 Trend Post Pipeline completed successfully!\n'));

  } catch (err) {
    console.error(chalk.red(`❌ Trend Post Pipeline failed: ${err.message}`));
    console.error(err.stack);
  } finally {
    await poster.close();
    isPipelineRunning = false;
  }
}

// ── Cron + Immediate startup run ──────────────────────────────

cron.schedule(CRON_EXPR, () => {
  runPipeline().catch(err => console.error(err));
}, {
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
});

console.log(chalk.yellow('⏳ Performing immediate run on startup...'));
runPipeline().catch(err => console.error(err));
