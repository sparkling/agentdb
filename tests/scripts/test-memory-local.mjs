import { AgentDB } from './dist/src/index.js';

async function test() {
  try {
    console.log('Testing AgentDB with :memory:...');
    const db = new AgentDB({ dbPath: ':memory:' });
    await db.initialize();
    console.log('✅ SUCCESS: :memory: works without path traversal error!');
    
    // Try a quick operation
    const memory = db.getController('memory');
    await memory.logEpisode({
      sessionId: 'test',
      task: 'Test task',
      success: true,
      reward: 1.0
    });
    console.log('✅ SUCCESS: Episode logged successfully');
    
    await db.close();
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
