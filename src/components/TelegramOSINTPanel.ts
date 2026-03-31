// src/panels/TelegramOSINTPanel.ts
import { Panel } from '../components/Panel'; // matches your existing pattern
import { getTelegramOSINT } from '../services/telegram-osint';

export class TelegramOSINTPanel extends Panel {
  async render() {
    const channels = await getTelegramOSINT();
    return `
      <div class="panel telegram-osint">
        <h3>OSINT Telegram Channels</h3>
        <ul>${channels.map(c => `
          <li>
            <strong>${c.name}</strong> @${c.handle}<br>
            Score: ${c.relevanceScore.toFixed(0)} | ${c.lastPost}
          </li>`).join('')}
        </ul>
      </div>`;
  }
}