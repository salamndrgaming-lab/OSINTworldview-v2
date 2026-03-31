import { AnalysisWorker } from '../workers/analysis.worker';

interface NarrativeData {
  keyword: string;
  mentions: number;
  timestamp: number;
  channel: string;
  sentiment: number;
}

interface VelocityResult {
  keyword: string;
  currentVelocity: number; // Mentions per hour
  baselineVelocity: number;
  accelerationFactor: number;
  trending: boolean;
  alert: boolean;
  channels: string[];
}

export class NarrativeVelocityService {
  private static ALERT_THRESHOLD = 3.0; // 3x baseline = alert
  
  static async calculateVelocity(
    narratives: NarrativeData[],
    historicalData: NarrativeData[],
    timeWindow: number = 3600000 // 1 hour
  ): Promise<VelocityResult[]> {
    
    // Group by keyword
    const keywordGroups = this.groupByKeyword(narratives);
    const results: VelocityResult[] = [];
    
    for (const [keyword, data] of keywordGroups) {
      // Calculate current velocity
      const recentMentions = data.filter(
        d => Date.now() - d.timestamp < timeWindow
      );
      const currentVelocity = (recentMentions.length / timeWindow) * 3600000;
      
      // Calculate baseline from historical data
      const historicalMentions = historicalData.filter(d => d.keyword === keyword);
      const baselineVelocity = this.calculateBaseline(historicalMentions);
      
      // Calculate acceleration
      const accelerationFactor = baselineVelocity > 0
        ? currentVelocity / baselineVelocity
        : currentVelocity > 0 ? 999 : 1;
      
      // Get unique channels
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
    
    // Sort by acceleration factor
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
    
    // Calculate average mentions per hour over historical period
    const timeSpan = Math.max(...historical.map(h => h.timestamp)) -
                     Math.min(...historical.map(h => h.timestamp));
    
    if (timeSpan === 0) return 0;
    
    return (historical.length / timeSpan) * 3600000;
  }
  
  static async extractNarratives(messages: any[]): Promise<NarrativeData[]> {
    const narratives: NarrativeData[] = [];
    
    // Use analysis worker for NLP processing
    const worker = new AnalysisWorker();
    
    for (const message of messages) {
      const keywords = await worker.extractKeywords(message.text);
      const sentiment = await worker.analyzeSentiment(message.text);
      
      keywords.forEach(keyword => {
        narratives.push({
          keyword,
          mentions: 1,
          timestamp: message.date * 1000,
          channel: message.chat.username,
          sentiment,
        });
      });
    }
    
    return narratives;
  }
}