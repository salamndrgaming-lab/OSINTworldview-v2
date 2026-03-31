// src/services/narrativeVelocityService.ts
// FIXES:
//   - TS2305: 'AnalysisWorker' has no exported member in '../workers/analysis.worker'
//     The worker only handles cluster/correlation postMessage — no class export.
//     Removed import; replaced with inline NLP helpers.
//   - TS7006: Parameter 'keyword' implicitly has 'any' type (line 103)
//     → explicit : string annotation on forEach callback

export interface NarrativeData {
  keyword: string;
  mentions: number;
  timestamp: number;
  channel: string;
  sentiment: number;
}

export interface VelocityResult {
  keyword: string;
  currentVelocity: number;
  baselineVelocity: number;
  accelerationFactor: number;
  trending: boolean;
  alert: boolean;
  channels: string[];
}

// ---------------------------------------------------------------------------
// Inline NLP helpers (replaces non-existent AnalysisWorker methods)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','this','that','it','its','from',
  'по','и','в','на','с','к','о','за','не','что',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w: string) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, 10);
}

function analyzeSentiment(text: string): number {
  const pos = ['good','great','success','victory','safe','secure','positive','progress'];
  const neg = ['bad','attack','threat','crisis','war','danger','loss','fail','terror'];
  const lower = text.toLowerCase();
  let score = 0;
  pos.forEach((w: string) => { if (lower.includes(w)) score += 0.2; });
  neg.forEach((w: string) => { if (lower.includes(w)) score -= 0.2; });
  return Math.max(-1, Math.min(1, score));
}

// ---------------------------------------------------------------------------

export class NarrativeVelocityService {
  private static readonly ALERT_THRESHOLD = 3.0;

  static async calculateVelocity(
    narratives: NarrativeData[],
    historicalData: NarrativeData[],
    timeWindow: number = 3600000
  ): Promise<VelocityResult[]> {
    const groups = this.groupByKeyword(narratives);
    const results: VelocityResult[] = [];

    for (const [keyword, data] of groups) {
      const recent = data.filter(d => Date.now() - d.timestamp < timeWindow);
      const currentVelocity = (recent.length / timeWindow) * 3600000;
      const historical = historicalData.filter(d => d.keyword === keyword);
      const baselineVelocity = this.calculateBaseline(historical);
      const accelerationFactor =
        baselineVelocity > 0 ? currentVelocity / baselineVelocity
        : currentVelocity > 0 ? 999 : 1;

      results.push({
        keyword,
        currentVelocity,
        baselineVelocity,
        accelerationFactor,
        trending: accelerationFactor > 1.5,
        alert: accelerationFactor > this.ALERT_THRESHOLD,
        channels: [...new Set(recent.map(m => m.channel))],
      });
    }

    return results.sort((a, b) => b.accelerationFactor - a.accelerationFactor);
  }

  private static groupByKeyword(data: NarrativeData[]): Map<string, NarrativeData[]> {
    const groups = new Map<string, NarrativeData[]>();
    data.forEach(item => {
      if (!groups.has(item.keyword)) groups.set(item.keyword, []);
      groups.get(item.keyword)!.push(item);
    });
    return groups;
  }

  private static calculateBaseline(historical: NarrativeData[]): number {
    if (historical.length === 0) return 0;
    const ts = historical.map(h => h.timestamp);
    const span = Math.max(...ts) - Math.min(...ts);
    return span === 0 ? 0 : (historical.length / span) * 3600000;
  }

  static async extractNarratives(messages: any[]): Promise<NarrativeData[]> {
    const narratives: NarrativeData[] = [];
    for (const message of messages) {
      const text: string = message.text ?? '';
      const keywords = extractKeywords(text);
      const sentiment = analyzeSentiment(text);
      // FIX TS7006: explicit : string on forEach param
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
