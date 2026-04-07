import { CompoundPanel } from './CompoundPanel';
import type { CompoundTab } from './CompoundPanel';
import { t } from '@/services/i18n';

const TABS: CompoundTab[] = [
  { id: 'politics', label: 'World', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('politics', t('panels.politics'))) },
  { id: 'us', label: 'US', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('us', t('panels.us'))) },
  { id: 'europe', label: 'Europe', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('europe', t('panels.europe'))) },
  { id: 'middleeast', label: 'Middle East', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('middleeast', t('panels.middleeast'))) },
  { id: 'africa', label: 'Africa', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('africa', t('panels.africa'))) },
  { id: 'latam', label: 'Latin America', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('latam', t('panels.latam'))) },
  { id: 'asia', label: 'Asia-Pacific', loader: () => import('./NewsPanel').then(m => new m.NewsPanel('asia', t('panels.asia'))) },
];

export class NewsHubPanel extends CompoundPanel {
  constructor() {
    super({ id: 'news-hub', title: 'Regional News', defaultRowSpan: 2 }, TABS);
  }
}
