import run from './daily-post.js';

try {
  console.log('🚀 Triggering daily banner post pipeline for company...');
  const result = await run(null, { target: 'company', type: 'post' });
  console.log('🎉 Company banner post completed successfully!', result);
} catch (err) {
  console.error('❌ Company post failed:', err.stack || err.message);
  process.exit(1);
}
