// src/services/analystService.ts
// FIXES:
//   - TS2307: Cannot find module 'axios' — not in package.json; replaced with fetch
//   - TS2307: Cannot find module '../types/analyst' — file doesn't exist; types inlined
//   - TS18046: 'error' is of type 'unknown' — narrowed with instanceof Error guard
//   - TS7006: Parameter 'item' implicitly has 'any' — added explicit 'any' annotation
//     (acceptable: raw API response data is untyped by nature)

// ---------------------------------------------------------------------------
// Inlined types (../types/analyst does not exist in this project)
// ---------------------------------------------------------------------------

interface IntelItem {
  id?: string;
  title?: string;
  content?: string;
  timestamp?: number;
  priority?: string;
  source?: string;
}

interface CorrelationItem {
  id?: string;
  entities?: string[];
  score?: number;
  description?: string;
  timestamp?: number;
}

interface ThreatItem {
  id?: string;
  type?: string;
  severity?: string;
  description?: string;
  indicators?: string[];
  timestamp?: number;
}

interface AnalysisItem {
  id?: string;
  title?: string;
  summary?: string;
  details?: string;
  confidence?: number;
  timestamp?: number;
}

export interface AnalystDataResponse {
  intelligence?: IntelItem[];
  correlation?: CorrelationItem[];
  threats?: ThreatItem[];
  analysis?: AnalysisItem[];
}

export interface AnalystData {
  intelligence: Required<IntelItem>[];
  correlation: Required<CorrelationItem>[];
  threats: Required<ThreatItem>[];
  analysis: Required<AnalysisItem>[];
}

// ---------------------------------------------------------------------------

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE)
  || '/api';

export class AnalystService {
  static async fetchData(): Promise<AnalystData> {
    // FIX: replaced axios with fetch (axios is not in package.json)
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/analyst/data`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      // FIX TS18046: 'error' is unknown — narrow before accessing .message
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error: ${msg}`);
    }

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const raw: AnalystDataResponse = await response.json() as AnalystDataResponse;
    return this.transformData(raw);
  }

  private static transformData(raw: AnalystDataResponse): AnalystData {
    return {
      // FIX TS7006: explicit 'any' on item — raw API data is untyped
      intelligence: (raw.intelligence ?? []).map((item: any) => ({
        id: item.id ?? `intel-${Date.now()}`,
        title: item.title ?? 'Untitled',
        content: item.content ?? '',
        timestamp: item.timestamp ?? Date.now(),
        priority: item.priority ?? 'medium',
        source: item.source ?? 'unknown',
      })),

      correlation: (raw.correlation ?? []).map((item: any) => ({
        id: item.id ?? `corr-${Date.now()}`,
        entities: item.entities ?? [],
        score: item.score ?? 0,
        description: item.description ?? '',
        timestamp: item.timestamp ?? Date.now(),
      })),

      threats: (raw.threats ?? []).map((item: any) => ({
        id: item.id ?? `threat-${Date.now()}`,
        type: item.type ?? 'unknown',
        severity: item.severity ?? 'low',
        description: item.description ?? '',
        indicators: item.indicators ?? [],
        timestamp: item.timestamp ?? Date.now(),
      })),

      analysis: (raw.analysis ?? []).map((item: any) => ({
        id: item.id ?? `analysis-${Date.now()}`,
        title: item.title ?? 'Untitled Analysis',
        summary: item.summary ?? '',
        details: item.details ?? '',
        confidence: item.confidence ?? 0,
        timestamp: item.timestamp ?? Date.now(),
      })),
    };
  }
}
