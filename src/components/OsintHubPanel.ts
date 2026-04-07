import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';

const TABS: CompoundTab[] = [
  { id: 'osint-toolkit', label: 'Toolkit', loader: () => import('./OsintToolkitPanel').then(m => new m.OsintToolkitPanel()) },
  { id: 'osint-report', label: 'Report', loader: () => import('./OsintReportPanel').then(m => new m.OsintReportPanel()) },
  { id: 'telegram-osint', label: 'Telegram OSINT', loader: () => import('./TelegramOSINTPanel').then(m => new m.TelegramOSINTPanel()) },
  { id: 'telegram-intel', label: 'Telegram Intel', loader: () => import('./TelegramIntelPanel').then(m => new m.TelegramIntelPanel()) },
];

export class OsintHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'osint-hub', title: 'OSINT Workspace', defaultRowSpan: 2 }, TABS);
  }
}
