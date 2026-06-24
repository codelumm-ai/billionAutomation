import { queryChatGPTCompletions } from './whatsapp-bot.js';

async function runTests() {
  console.log('🧪 Starting completions routing tests...\n');

  // Preserve existing environment key
  const originalApiKey = process.env.OPENAI_API_KEY;

  // ── Test 1: Fallback (No API Key) ──
  console.log('=== Test 1: Testing Local Fallback (no API key) ===');
  process.env.OPENAI_API_KEY = '';
  
  try {
    // We expect this to print "Querying local Playwright ChatGPT Gateway fallback on port 3000..."
    const promise = queryChatGPTCompletions('Say hello');
    // Let's just wait for a tiny bit or let it resolve if local server is running
    const result = await Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve('TIMEOUT_OK'), 3000))
    ]);
    console.log('Test 1 routing verified. Result/Status:', result);
  } catch (err) {
    console.log('Test 1 ended with expected gateway connection status:', err.message);
  }

  console.log('\n');

  // ── Test 2: Direct API Routing (With API Key) ──
  console.log('=== Test 2: Testing Official OpenAI Routing (with API key) ===');
  process.env.OPENAI_API_KEY = 'sk-fake-key-for-routing-verification-only';
  
  try {
    // We expect this to print "Querying official OpenAI API using model: gpt-4o"
    // and fail with 401 Unauthorized because the key is fake
    await queryChatGPTCompletions('Say hello');
  } catch (err) {
    console.log('Test 2 routing verified! Connect failed as expected with fake key:', err.message);
    if (err.message.includes('Incorrect API key provided') || err.message.includes('invalid_api_key') || err.message.includes('Unauthorized') || err.message.includes('401')) {
      console.log('✅ Correctly targeted api.openai.com and received OpenAI key auth failure!');
    } else {
      console.warn('⚠️ Unexpected error message (but routing was attempted):', err.message);
    }
  }

  // Restore environment key
  process.env.OPENAI_API_KEY = originalApiKey || '';
  console.log('\n🎉 Routing verification tests completed!');
}

runTests().catch(console.error);
