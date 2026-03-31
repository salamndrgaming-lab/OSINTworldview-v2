// src/services/analystService.ts
// BUG FIX 5: Analyst service with proper error handling and data transformation

import axios from 'axios';
import { AnalystData, AnalystDataResponse } from '../types/analyst';

const API_BASE = process.env.REACT_APP_API_BASE || '/api';

export class AnalystService {
  static async fetchData(): Promise<AnalystData> {
    try {
      const response = await axios.get<AnalystDataResponse>(
        `${API_BASE}/analyst/data`,
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data) {
        throw new Error('No data received from server');
      }

      return this.transformData(response.data);
    } catch (error) {
      console.error('Error fetching analyst data:', error);

      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`Server error: ${error.response.status}`);
        } else if (error.request) {
          throw new Error('No response from server');
        }
      }

      throw new Error('Failed to fetch analyst data');
    }
  }

  private static transformData(raw: AnalystDataResponse): AnalystData {
    return {
      intelligence: raw.intelligence?.map(item => ({
        id: item.id || `intel-${Date.now()}`,
        title: item.title || 'Untitled',
        content: item.content || '',
        timestamp: item.timestamp || Date.now(),
        priority: item.priority || 'medium',
        source: item.source || 'unknown',
      })) || [],

      correlation: raw.correlation?.map(item => ({
        id: item.id || `corr-${Date.now()}`,
        entities: item.entities || [],
        score: item.score || 0,
        description: item.description || '',
        timestamp: item.timestamp || Date.now(),
      })) || [],

      threats: raw.threats?.map(item => ({
        id: item.id || `threat-${Date.now()}`,
        type: item.type || 'unknown',
        severity: item.severity || 'low',
        description: item.description || '',
        indicators: item.indicators || [],
        timestamp: item.timestamp || Date.now(),
      })) || [],

      analysis: raw.analysis?.map(item => ({
        id: item.id || `analysis-${Date.now()}`,
        title: item.title || 'Untitled Analysis',
        summary: item.summary || '',
        details: item.details || '',
        confidence: item.confidence || 0,
        timestamp: item.timestamp || Date.now(),
      })) || [],
    };
  }
}
