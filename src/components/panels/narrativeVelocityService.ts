// src/services/narrativeVelocityService.ts
// FIXES:
//   - TS2305: 'AnalysisWorker' has no exported member in '../workers/analysis.worker'
//     → removed import; analysis.worker only handles cluster/correlation messages via
//     postMessage — it has no extractKeywords() or analyzeSentiment() API.
//     Replaced with lightweight inline NLP helpers.
//   - TS7006: Parameter 'keyword' implicitly has an 'any' type (line 103)
//     → explicitly typed forEach callback parameter as string

export interface NarrativeData {
  keyword: string;
  mentions: number;
  timestamp: number;
  channel: string;
  sentiment: number;
}

export interface VelocityResult {
  keyword: string;
  currentVelocity: number; // Mentions per hour
  baselineVelocity: number;
  accelerationFactor: number;
  trending: boolean;
  alert: boolean;
  channels: string[];
}

// ---------------------------------------------------------------------------
// Lightweight inline NLP helpers — replaces missing AnalysisWorker methods
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','this','that','it','its','from',
  'по','и','в','на','с','к','о','за','не','что',
]);

function extractKeywordsInline(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w: string) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, 10);
}

function analyzeSentimentInline(text: string): number {
  const positive = ['good','great','success','victory','safe','secure','positive','progress'];
  const negative = ['bad','attack','threat','crisis','war','danger','loss','fail','terror'];
  const lower = text.toLowerCase();
  let score = 0;
  positive.forEach((w: string) => { if (lower.includes(w)) score += 0.2; });
  negative.forEach((w: string) => { if (lower.includes(w)) score -= 0.2; });
  return Math.max(-1, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// NarrativeVelocityService
// ---------------------------------------------------------------------------

export class NarrativeVelocityService {
  private static readonly ALERT_THRESHOLD = 3.0; // 3x baseline = alert

  static async calculateVelocity(
    narratives: NarrativeData[],
    historicalData: NarrativeData[],
    timeWindow: number = 3600000 // 1 hour in ms
  ): Promise<VelocityResult[]> {

    const keywordGroups = this.groupByKeyword(narratives);
    const results: VelocityResult[] = [];

    for (const [keyword, data] of keywordGroups) {
      const recentMentions = data.filter(
        d => Date.now() - d.timestamp < timeWindow
      );
      const currentVelocity = (recentMentions.length / timeWindow) * 3600000;

      const historicalMentions = historicalData.filter(d => d.keyword === keyword);
      const baselineVelocity = this.calculateBaseline(historicalMentions);

      const accelerationFactor =
        baselineVelocity > 0
          ? currentVelocity / baselineVelocity
          : currentVelocity > 0
          ? 999
          : 1;

      const channels = [...new Set(recentMentions.map(m => m.channel))];

      results.push({
        keyword,
        currentVelocity,
        baselineVelocity,
        accelerationFactor,
        trending: accelerationFactor > 1.5,
        alert: accelerationFactor > this.ALERT_THRESHOLD,
        channels,
      });
    }

    return results.sort((a, b) => b.accelerationFactor - a.accelerationFactor);
  }

  private static groupByKeyword(data: NarrativeData[]): Map<string, NarrativeData[]> {
    const groups = new Map<string, NarrativeData[]>();
    data.forEach(item => {
      if (!groups.has(item.keyword)) {
        groups.set(item.keyword, []);
      }
      groups.get(item.keyword)!.push(item);
    });
    return groups;
  }

  private static calculateBaseline(historical: NarrativeData[]): number {
    if (historical.length === 0) return 0;
    const timestamps = historical.map(h => h.timestamp);
    const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
    if (timeSpan === 0) return 0;
    return (historical.length / timeSpan) * 3600000;
  }

  static async extractNarratives(messages: any[]): Promise<NarrativeData[]> {
    const narratives: NarrativeData[] = [];

    for (const message of messages) {
      const text: string = message.text ?? '';
      const keywords = extractKeywordsInline(text);
      const sentiment = analyzeSentimentInline(text);

      // FIX TS7006: explicit string type on forEach callback parameter
      keywords.forEach((keyword: string) => {
        narratives.push({
          keyword,
          mentions: 1,
          timestamp: (message.date ?? 0) * 1000,
          channel: message.chat?.username ?? 'unknown',
          sentiment,
        });
      });
    }

    return narratives;
  }
}
