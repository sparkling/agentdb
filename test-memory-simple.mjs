import { AgentDB } from './dist/src/index.js';

async function test() {
  console.log('Testing AgentDB with :memory:...');
  const db = new AgentDB({ dbPath: ':memory:' });
  await db.initialize();
  console.log('✅ SUCCESS: :memory: works without path traversal error!');
  await db.close();
}

test().catch(err => {
  console.error('❌ ERROR:', err.message);
  process.exit(1);
});
