/**
 * Telegram Intelligence Report Service
 *
 * Aggregates data from all dashboard panels (bootstrap cache),
 * generates a formatted intelligence brief with context, predictions,
 * and market impact analysis, then sends it via Telegram Bot API.
 *
 * Location in repo: src/services/telegram-report.ts
 */

// --- Types ---

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface BootstrapPayload {
  data: Record<string, unknown>;
  missing?: string[];
}

// --- Storage ---

const CONFIG_KEY = 'wm-telegram-config';

export function getTelegramConfig(): TelegramConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as TelegramConfig;
    return cfg.botToken && cfg.chatId ? cfg : null;
  } catch {
    return null;
  }
}

export function saveTelegramConfig(cfg: TelegramConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearTelegramConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

export function isTelegramConfigured(): boolean {
  return getTelegramConfig() !== null;
}

// --- Data Aggregation ---

async function fetchBootstrapTier(tier: string): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch(`/api/bootstrap?tier=${tier}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return {};
    const payload = (await resp.json()) as BootstrapPayload;
    return payload.data ?? {};
  } catch {
    return {};
  }
}

/** Fetch both fast + slow bootstrap tiers and merge */
async function fetchAllBootstrapData(): Promise<Record<string, unknown>> {
  const [fast, slow] = await Promise.all([
    fetchBootstrapTier('fast'),
    fetchBootstrapTier('slow'),
  ]);
  return { ...slow, ...fast };
}

// --- HTML Escaping (Telegram HTML mode) ---

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Time Helpers ---

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// --- Report Generation ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArray(val: unknown): any[] {
  if (Array.isArray(val)) return val;
  return [];
}

export async function generateIntelligenceReport(): Promise<string> {
  const data = await fetchAllBootstrapData();
  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  const sections: string[] = [];

  // Header
  sections.push('<b>🌐 INTELLIGENCE BRIEF</b>');
  sections.push(`<i>${timestamp} UTC</i>`);
  sections.push('<i>Covering the last 60 minutes of global activity</i>');
  sections.push('');

  // --- EXECUTIVE SUMMARY (AI Insights) ---
  const insights = asArray(data.insights);
  if (insights.length > 0) {
    sections.push('<b>━━ 🧠 EXECUTIVE SUMMARY ━━</b>');
    const recent = insights.slice(0, 6);
    for (const i of recent) {
      const sev = i.severity ? ` [${String(i.severity).toUpperCase()}]` : '';
      const cat = i.category ? ` <i>(${esc(String(i.category))})</i>` : '';
      sections.push(`▸ ${esc(String(i.title ?? ''))}${sev}${cat}`);
      if (i.summary) {
        const summary = String(i.summary).slice(0, 200);
        sections.push(`  <i>${esc(summary)}</i>`);
      }
    }
    sections.push('');
  }

  // --- SEISMOLOGY ---
  const earthquakes = asArray(data.earthquakes);
  const recentQuakes = earthquakes
    .filter((q: Record<string, unknown>) => (q.magnitude as number ?? q.mag as number ?? 0) >= 4.5)
    .slice(0, 6);
  if (recentQuakes.length > 0) {
    sections.push('<b>━━ 🌍 SEISMIC ACTIVITY ━━</b>');
    for (const q of recentQuakes) {
      const mag = (q.magnitude ?? q.mag ?? 0) as number;
      const place = (q.place ?? 'Unknown location') as string;
      const depth = (q.depthKm ?? q.depth ?? 0) as number;
      const tsunami = q.tsunami ? ' ⚠️ TSUNAMI WARNING' : '';
      const time = q.occurredAt ? timeAgo(q.occurredAt as number) : '';
      sections.push(`▸ <b>M${Number(mag).toFixed(1)}</b> — ${esc(String(place))} (${Number(depth).toFixed(0)}km deep) ${time}${tsunami}`);
    }
    const maxMag = Math.max(...recentQuakes.map((q: Record<string, unknown>) => (q.magnitude ?? q.mag ?? 0) as number));
    if (maxMag >= 6.0) {
      sections.push(`\n⚠️ <b>Context:</b> M${maxMag.toFixed(1)}+ event detected. Regional infrastructure disruption possible.`);
    }
    sections.push('');
  }

  // --- MARKETS ---
  const markets = asArray(data.marketQuotes);
  const commodities = asArray(data.commodityQuotes);
  const allQuotes = [...markets, ...commodities];
  if (allQuotes.length > 0) {
    sections.push('<b>━━ 📊 MARKET OVERVIEW ━━</b>');
    const sorted = [...allQuotes]
      .filter((q: Record<string, unknown>) => q.changePercent != null)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Math.abs(b.changePercent as number) - Math.abs(a.changePercent as number));
    const topMovers = sorted.slice(0, 10);
    for (const q of topMovers) {
      const pct = q.changePercent as number;
      const sign = pct >= 0 ? '+' : '';
      const emoji = pct >= 0 ? '🟢' : '🔴';
      const price = Number(q.price);
      const priceStr = price >= 1000 ? price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : price.toFixed(2);
      sections.push(`${emoji} <b>${esc(String(q.symbol))}</b> ${priceStr} (${sign}${pct.toFixed(2)}%)`);
    }
    const upCount = allQuotes.filter((q: Record<string, unknown>) => ((q.changePercent as number) ?? 0) > 0).length;
    const downCount = allQuotes.filter((q: Record<string, unknown>) => ((q.changePercent as number) ?? 0) < 0).length;
    const avg = allQuotes.reduce((sum: number, q: Record<string, unknown>) => sum + ((q.changePercent as number) ?? 0), 0) / (allQuotes.length || 1);
    sections.push(`\n📈 <b>Market Impact:</b> ${upCount} advancing, ${downCount} declining. Average move: ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%.`);
    const bigMovers = sorted.filter((q: Record<string, unknown>) => Math.abs(q.changePercent as number) > 3);
    if (bigMovers.length > 0) {
      sections.push(`⚠️ <b>${bigMovers.length} asset(s) moved 3%+</b> — elevated volatility.`);
    }
    sections.push('');
  }

  // --- CONFLICTS ---
  const conflicts = asArray(data.ucdpEvents).concat(asArray(data.unrestEvents));
  if (conflicts.length > 0) {
    sections.push('<b>━━ ⚔️ CONFLICT &amp; UNREST ━━</b>');
    for (const c of conflicts.slice(0, 6)) {
      const type = (c.event_type ?? c.type ?? 'Event') as string;
      const loc = c.location ? `${c.location}, ${c.country ?? ''}` : ((c.country ?? 'Unknown') as string);
      const fat = (c.fatalities && c.fatalities > 0) ? ` — <b>${c.fatalities} fatalities</b>` : '';
      sections.push(`▸ <b>${esc(String(type))}</b>: ${esc(String(loc).trim())}${fat}`);
    }
    const totalFat = conflicts.reduce((sum: number, c: Record<string, unknown>) => sum + ((c.fatalities as number) ?? 0), 0);
    if (totalFat > 0) {
      sections.push(`\n💀 <b>Context:</b> ${totalFat} total reported fatalities across ${conflicts.length} events.`);
    }
    sections.push('');
  }

  // --- CYBER THREATS ---
  const cyber = asArray(data.cyberThreats);
  const criticalCyber = cyber.filter((t: Record<string, unknown>) =>
    ['critical', 'high'].includes(String(t.severity ?? '').toLowerCase())
  );
  if (criticalCyber.length > 0) {
    sections.push('<b>━━ 🛡️ CYBER THREATS ━━</b>');
    for (const t of criticalCyber.slice(0, 5)) {
      sections.push(`▸ [${String(t.severity ?? '').toUpperCase()}] <b>${esc(String(t.name ?? ''))}</b>`);
      if (t.type) sections.push(`  Type: ${esc(String(t.type))}`);
    }
    sections.push('');
  }

  // --- PREDICTIONS ---
  const predictions = asArray(data.predictions);
  if (predictions.length > 0) {
    sections.push('<b>━━ 🔮 PREDICTION MARKETS ━━</b>');
    for (const p of predictions.slice(0, 6)) {
      const prob = (p.probability as number) > 1 ? (p.probability as number) : ((p.probability as number) ?? 0) * 100;
      const bar = prob >= 70 ? '🟢' : prob >= 40 ? '🟡' : '🔴';
      sections.push(`${bar} <b>${prob.toFixed(0)}%</b> — ${esc(String(p.title ?? ''))}`);
    }
    sections.push('');
  }

  // --- INFRASTRUCTURE ---
  const outages = asArray(data.outages);
  const wildfires = asArray(data.wildfires);
  if (outages.length > 0 || wildfires.length > 0) {
    sections.push('<b>━━ ⚡ INFRASTRUCTURE ━━</b>');
    if (outages.length > 0) sections.push(`▸ <b>${outages.length}</b> active outages`);
    if (wildfires.length > 0) sections.push(`▸ <b>${wildfires.length}</b> wildfires detected`);
    sections.push('');
  }

  // --- SUPPLY CHAIN ---
  const chokepoints = asArray(data.chokepoints);
  const disrupted = chokepoints.filter((cp: Record<string, unknown>) => cp.status && cp.status !== 'normal');
  if (disrupted.length > 0) {
    sections.push('<b>━━ 🚢 SUPPLY CHAIN ━━</b>');
    for (const cp of disrupted) {
      sections.push(`▸ <b>${esc(String(cp.name))}</b>: ${String(cp.status ?? 'disrupted').toUpperCase()}`);
    }
    sections.push('');
  }

  sections.push('<i>— World Monitor Intelligence Brief</i>');
  return sections.join('\n');
}

// --- Sending ---

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const MAX = 4000;
  const chunks: string[] = [];

  if (html.length <= MAX) {
    chunks.push(html);
  } else {
    const parts = html.split('\n\n');
    let buf = '';
    for (const part of parts) {
      if ((buf + '\n\n' + part).length > MAX && buf.length > 0) {
        chunks.push(buf.trim());
        buf = part;
      } else {
        buf = buf ? buf + '\n\n' + part : part;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }

  for (let i = 0; i < chunks.length; i++) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const result = (await resp.json()) as { ok: boolean; description?: string };
      if (!result.ok) {
        return { ok: false, error: result.description ?? `Telegram error on chunk ${i + 1}` };
      }
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 1100));
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: true };
}

export async function sendReport(
  config?: TelegramConfig
): Promise<{ ok: boolean; error?: string }> {
  const cfg = config ?? getTelegramConfig();
  if (!cfg) return { ok: false, error: 'Telegram not configured.' };

  let report: string;
  try {
    report = await generateIntelligenceReport();
  } catch (err) {
    return { ok: false, error: `Report generation failed: ${(err as Error).message}` };
  }
  return sendTelegramMessage(cfg.botToken, cfg.chatId, report);
}

export async function testTelegramConnection(
  botToken: string,
  chatId: string
): Promise<{ ok: boolean; error?: string }> {
  return sendTelegramMessage(botToken, chatId, '✅ <b>World Monitor</b> connected successfully!');
}
