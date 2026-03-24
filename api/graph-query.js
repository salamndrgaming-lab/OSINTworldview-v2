import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Graph Query API — queries the Neo4j entity graph.
//
// Usage:
//   GET /api/graph-query?entity=Ukraine           → find all entities connected to Ukraine
//   GET /api/graph-query?entity=Putin&depth=2     → 2-hop traversal from Putin
//   GET /api/graph-query?type=Person&risk=high    → all high-risk persons
//   GET /api/graph-query?region=Middle East        → all entities in Middle East
//   GET /api/graph-query?stats=true               → graph statistics
//   GET /api/graph-query?format=json              → JSON output (default: HTML)

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNeo4jCredentials() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !password) return null;

  let httpUrl;
  if (uri.startsWith('neo4j+s://') || uri.startsWith('neo4j://')) {
    const host = uri.replace(/^neo4j\+s?:\/\//, '').replace(/:\d+$/, '');
    httpUrl = `https://${host}:7473/db/neo4j/tx/commit`;
  } else if (uri.startsWith('https://')) {
    httpUrl = uri.endsWith('/tx/commit') ? uri : `${uri}/db/neo4j/tx/commit`;
  } else {
    httpUrl = `https://${uri}:7473/db/neo4j/tx/commit`;
  }

  const authToken = btoa(`${username}:${password}`);
  return { httpUrl, authToken };
}

async function runCypher(httpUrl, authToken, query, params = {}) {
  const resp = await fetch(httpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      statements: [{ statement: query, parameters: params }],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Neo4j ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const result = await resp.json();
  if (result.errors?.length > 0) {
    throw new Error(`Cypher: ${result.errors[0].message?.slice(0, 200)}`);
  }

  return result;
}

function extractRows(result, resultIndex = 0) {
  const data = result.results?.[resultIndex]?.data || [];
  const columns = result.results?.[resultIndex]?.columns || [];
  return data.map(d => {
    const row = {};
    columns.forEach((col, i) => { row[col] = d.row[i]; });
    return row;
  });
}

// Build a Cypher query based on the request parameters
function buildQuery(params) {
  const entity = params.get('entity');
  const type = params.get('type');
  const risk = params.get('risk');
  const region = params.get('region');
  const depth = Math.min(parseInt(params.get('depth') || '1', 10) || 1, 3);
  const stats = params.get('stats');
  const limit = Math.min(parseInt(params.get('limit') || '50', 10) || 50, 100);

  // Graph statistics
  if (stats === 'true') {
    return {
      query: `
        CALL {
          MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count
        }
        RETURN label, count ORDER BY count DESC`,
      params: {},
      description: 'Graph statistics',
    };
  }

  // Entity neighborhood query (most common use case)
  if (entity) {
    if (depth === 1) {
      return {
        query: `
          MATCH (n)-[r]-(m)
          WHERE n.name =~ $pattern OR n.code =~ $pattern
          RETURN n.name AS source, labels(n)[0] AS sourceType,
                 type(r) AS relationship,
                 m.name AS target, labels(m)[0] AS targetType,
                 m.riskLevel AS targetRisk, m.severity AS targetSeverity
          LIMIT $limit`,
        params: { pattern: `(?i).*${entity}.*`, limit: parseInt(String(limit)) },
        description: `Entities connected to "${entity}"`,
      };
    } else {
      return {
        query: `
          MATCH path = (n)-[*1..${depth}]-(m)
          WHERE n.name =~ $pattern OR n.code =~ $pattern
          WITH n, relationships(path) AS rels, m
          UNWIND rels AS r
          RETURN DISTINCT
            startNode(r).name AS source, labels(startNode(r))[0] AS sourceType,
            type(r) AS relationship,
            endNode(r).name AS target, labels(endNode(r))[0] AS targetType
          LIMIT $limit`,
        params: { pattern: `(?i).*${entity}.*`, limit: parseInt(String(limit)) },
        description: `${depth}-hop traversal from "${entity}"`,
      };
    }
  }

  // Type + risk filter
  if (type) {
    const riskFilter = risk ? `AND n.riskLevel = $risk` : '';
    return {
      query: `
        MATCH (n:${type.replace(/[^a-zA-Z]/g, '')})
        WHERE true ${riskFilter}
        OPTIONAL MATCH (n)-[r]->(m)
        RETURN n.name AS name, n.riskLevel AS riskLevel, n.role AS role,
               type(r) AS relationship, m.name AS connected, labels(m)[0] AS connectedType
        LIMIT $limit`,
      params: { risk: risk || '', limit: parseInt(String(limit)) },
      description: `${type} entities${risk ? ` (risk: ${risk})` : ''}`,
    };
  }

  // Region query
  if (region) {
    return {
      query: `
        MATCH (r:Region {name: $region})<-[:IN_REGION]-(c:Country)
        OPTIONAL MATCH (c)<-[rel]-(e)
        RETURN c.name AS country, c.code AS code, c.riskLevel AS riskLevel,
               type(rel) AS relationship, e.title AS event, labels(e)[0] AS eventType,
               e.severity AS severity
        LIMIT $limit`,
      params: { region, limit: parseInt(String(limit)) },
      description: `Entities in ${region}`,
    };
  }

  // Default: show top entities by connection count
  return {
    query: `
      MATCH (n)-[r]-()
      WITH n, count(r) AS connections, labels(n)[0] AS type
      RETURN n.name AS name, type, connections, n.riskLevel AS riskLevel
      ORDER BY connections DESC
      LIMIT $limit`,
    params: { limit: parseInt(String(limit)) },
    description: 'Most connected entities',
  };
}

function renderHtml(rows, description, queryParams) {
  const entityParam = queryParams.get('entity') || '';

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entity Graph — ${escHtml(description)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #fff; }
  .meta { font-size: 12px; color: #888; margin-bottom: 16px; }
  .search-box { display: flex; gap: 8px; margin-bottom: 20px; }
  .search-box input { flex: 1; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 10px 14px; color: #fff; font-size: 14px; outline: none; }
  .search-box button { background: #4a90d9; color: #fff; border: none; border-radius: 6px; padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .quick-links { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .quick-links a { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 4px 10px; color: #4a90d9; text-decoration: none; font-size: 12px; }
  .quick-links a:hover { border-color: #4a90d9; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px; border-bottom: 2px solid #333; color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 6px 8px; border-bottom: 1px solid #1a1a1a; }
  .type-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
</style></head><body>
<h1>🕸️ Entity Graph</h1>
<div class="meta">${escHtml(description)} · ${rows.length} results</div>
<form class="search-box" method="GET" action="/api/graph-query">
  <input type="text" name="entity" value="${escHtml(entityParam)}" placeholder="Search entity (person, country, event...)">
  <button type="submit">Query</button>
</form>
<div class="quick-links">
  <a href="/api/graph-query?stats=true">📊 Stats</a>
  <a href="/api/graph-query?type=Person&risk=high">👤 High-Risk POI</a>
  <a href="/api/graph-query?region=Middle East">🕌 Middle East</a>
  <a href="/api/graph-query?region=Eastern Europe">🏰 Eastern Europe</a>
  <a href="/api/graph-query?region=Sub-Saharan Africa">🌍 Africa</a>
  <a href="/api/graph-query?entity=Ukraine&depth=2">🇺🇦 Ukraine (2-hop)</a>
</div>`;

  if (rows.length === 0) {
    html += `<div class="empty">No entities found. The graph may not be populated yet — run seed-entity-graph.mjs.</div>`;
  } else {
    const cols = Object.keys(rows[0] || {});
    const typeColors = {
      Person: '#8b5cf6', Country: '#3b82f6', Event: '#ef4444', Region: '#22c55e',
    };

    html += `<table><tr>${cols.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr>`;
    for (const row of rows) {
      html += '<tr>';
      for (const col of cols) {
        let val = row[col];
        if (val === null || val === undefined) val = '—';

        // Color-code type columns
        if ((col.includes('Type') || col === 'type') && typeColors[val]) {
          html += `<td><span class="type-badge" style="background:${typeColors[val]};color:#fff">${escHtml(val)}</span></td>`;
        } else if (col === 'riskLevel' || col === 'targetRisk') {
          const riskColors = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', extreme: '#dc2626' };
          const rc = riskColors[val] || '#6b7280';
          html += `<td><span style="color:${rc};font-weight:700;text-transform:uppercase;font-size:11px">${escHtml(val)}</span></td>`;
        } else if (col === 'name' || col === 'source' || col === 'target' || col === 'country') {
          // Make entity names clickable
          const linkVal = encodeURIComponent(String(val));
          html += `<td><a href="/api/graph-query?entity=${linkVal}" style="color:#4a90d9;text-decoration:none">${escHtml(val)}</a></td>`;
        } else {
          html += `<td>${escHtml(String(val))}</td>`;
        }
      }
      html += '</tr>';
    }
    html += '</table>';
  }

  html += `<div style="margin-top:16px;font-size:11px;opacity:.4;text-align:center">World Monitor Entity Graph · Powered by Neo4j AuraDB</div>`;
  html += `</body></html>`;
  return html;
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const neo4j = getNeo4jCredentials();
  if (!neo4j) {
    return new Response(JSON.stringify({ error: 'Neo4j not configured. Add NEO4J_URI and NEO4J_PASSWORD.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get('format') || 'html';

  try {
    const { query, params, description } = buildQuery(url.searchParams);
    const result = await runCypher(neo4j.httpUrl, neo4j.authToken, query, params);
    const rows = extractRows(result);

    if (format === 'json') {
      return new Response(JSON.stringify({ description, rows, count: rows.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=30', ...corsHeaders },
      });
    }

    const html = renderHtml(rows, description, url.searchParams);
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=30', ...corsHeaders },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (format === 'json') {
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    return new Response(`<html><body style="background:#0a0a0a;color:#e0e0e0;padding:24px;font-family:sans-serif"><h1>Graph Query Error</h1><p>${escHtml(errMsg)}</p></body></html>`, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
    });
  }
}
