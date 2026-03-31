import { createSeed } from '../utils/seedFactory.mjs';
import { TdClient } from 'tdl';

export const telegramNarrativeSeed = createSeed({
  id: 'telegram-narrative',
  name: 'Telegram Narrative Velocity Tracker',
  interval: 300000, // Every 5 minutes
  
  async fetch() {
    // Connect to Telegram via MTProto
    const channels = [
      // 27+ channels list
      '@channel1', '@channel2', // etc.
    ];
    
    const messages = [];
    
    for (const channel of channels) {
      try {
        const channelMessages = await client.getMessages(channel, { limit: 100 });
        messages.push(...channelMessages);
      } catch (error) {
        console.error(`Error fetching from ${channel}:`, error);
      }
    }
    
    return {
      messages,
      timestamp: Date.now(),
      channelsScanned: channels.length,
    };
  },
  
  async process(data, redis) {
    if (!data) return;
    
    // Store messages for velocity calculation
    await redis.lpush('telegram:messages', JSON.stringify(data.messages));
    await redis.ltrim('telegram:messages', 0, 10000); // Keep last 10k
    
    // Trigger velocity analysis
    await redis.publish('telegram:narrative-update', JSON.stringify({
      timestamp: Date.now(),
      messageCount: data.messages.length,
    }));
  },
});