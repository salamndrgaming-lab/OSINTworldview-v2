import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Israeli Home Front Command (Pikud HaOref) public alert endpoints
const OREF_ALERTS_URL = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
const OREF_HISTORY_URL = 'https://www.oref.org.il/WarningMessages/alert/History/AlertsHistory.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// OREF requires these headers or it returns empty/403
const OREF_HEADERS = {
  'Accept': 'application/json',
  'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
  'User-Agent': UA,
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

async function fetchOref(url) {
  const res = await fetch(url, {
    headers: OREF_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OREF HTTP ${res.status}`);
  const text = await res.text();
  // OREF sometimes returns empty string when no active alerts
  if (!text || text.trim() === '') return [];
  try { return JSON.parse(text); } catch { return []; }
}

function transformAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((a, i) => ({
    id: a.id || `oref-${Date.now()}-${i}`,
    cat: String(a.cat || a.category || ''),
    title: a.title || '',
    data: Array.isArray(a.data) ? a.data : typeof a.data === 'string' ? [a.data] : [],
    desc: a.desc || a.description || '',
    alertDate: a.alertDate || new Date().toISOString(),
  }));
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const isHistory = url.searchParams.get('endpoint') === 'history';

  try {
    if (isHistory) {
      // History endpoint
      const raw = await fetchOref(OREF_HISTORY_URL);
      const entries = Array.isArray(raw) ? raw : [];
      // Count alerts in last 24h
      const dayAgo = Date.now() - 86400000;
      let count24h = 0;
      const history = entries.slice(0, 200).map(entry => {
        const alerts = transformAlerts(entry.alerts || (entry.data ? [entry] : []));
        const ts = entry.alertDate || entry.timestamp || new Date().toISOString();
        if (new Date(ts).getTime() > dayAgo) count24h += alerts.length;
        return { alerts, timestamp: ts };
      });

      return new Response(JSON.stringify({
        configured: true,
        history,
        historyCount24h: count24h,
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          ...corsHeaders,
        },
      });
    }

    // Current alerts endpoint
    const raw = await fetchOref(OREF_ALERTS_URL);
    const alerts = transformAlerts(Array.isArray(raw) ? raw : []);

    return new Response(JSON.stringify({
      configured: true,
      alerts,
      historyCount24h: alerts.length,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20',
        ...corsHeaders,
      },
    });
  } catch (err) {
    // Return empty but configured:true so the frontend doesn't show "not configured" error
    return new Response(JSON.stringify({
      configured: true,
      alerts: [],
      historyCount24h: 0,
      timestamp: new Date().toISOString(),
      error: `OREF fetch error: ${err.message}`,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        ...corsHeaders,
      },
    });
  }
}
