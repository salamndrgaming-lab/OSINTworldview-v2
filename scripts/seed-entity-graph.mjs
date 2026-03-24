#!/usr/bin/env node

// seed-entity-graph.mjs — Builds and updates a knowledge graph in Neo4j AuraDB
// from World Monitor's intelligence data. Creates nodes for persons, countries,
// events, and regions, then links them with typed relationships.
//
// Node types:
//   (:Person)   — POI with name, role, riskLevel, region
//   (:Country)  — Countries with ISO code, risk data
//   (:Event)    — Missile strikes, disease outbreaks, conflict events
//   (:Region)   — Geographic regions (Middle East, Eastern Europe, etc.)
//
// Relationship types:
//   (Person)-[:LOCATED_IN]->(Country)
//   (Person)-[:LEADS]->(Country)        — heads of state
//   (Event)-[:TARGETS]->(Country)       — strike/outbreak location
//   (Event)-[:OCCURRED_IN]->(Region)
//   (Country)-[:IN_REGION]->(Region)
//   (Country)-[:CONFLICT_FORECAST {risk}]->(Country)  — self-referencing forecast data

import { loadEnvFile, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

// ---------- Neo4j HTTP API ----------

function getNeo4jCredentials() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !password) {
    console.error('Missing NEO4J_URI or NEO4J_PASSWORD');
    process.exit(0);
  }

  // Convert bolt/neo4j URI to AuraDB Query API v2 endpoint
  // neo4j+s://xxxxx.databases.neo4j.io -> https://xxxxx.databases.neo4j.io/db/neo4j/query/v2
  // The HTTP API (port 7473) is NOT available on AuraDB — must use Query API on port 443
  // Extract host and point to the default database endpoint
  const host = uri.replace(/^neo4j\+s?:\/\//, '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const queryUrl = `https://${host}/db/query/v2`;

  const authToken = Buffer.from(`${username}:${password}`).toString('base64');
  return { queryUrl, authToken };
}

// Execute a single Cypher statement via the AuraDB Query API v2
// Docs: https://neo4j.com/docs/query-api/current/
// Body format: { "statement": "CYPHER", "parameters": {} }
async function runCypherSingle(queryUrl, authToken, query, params = {}) {
  const body = {
    statement: query,
    parameters: params,
  };

  const resp = await fetch(queryUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Neo4j Query API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const result = await resp.json();

  // Check for errors in the Query API response
  if (result.errors && result.errors.length > 0) {
    const firstErr = result.errors[0];
    throw new Error(`Cypher error: ${firstErr.code || ''} — ${(firstErr.message || '').slice(0, 200)}`);
  }

  return result;
}

// Execute multiple Cypher statements sequentially (Query API v2 = one per request)
async function runCypher(queryUrl, authToken, statements) {
  const results = [];
  for (const s of statements) {
    const result = await runCypherSingle(queryUrl, authToken, s.query, s.params || {});
    results.push(result);
  }
  return results;
}

// ---------- Redis Helpers ----------

async function redisGet(url, token, key) {
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

// ---------- Region Mapping ----------

const COUNTRY_TO_REGION = {
  UA: 'Eastern Europe', RU: 'Eastern Europe', BY: 'Eastern Europe', MD: 'Eastern Europe',
  PL: 'Eastern Europe', RO: 'Eastern Europe', HU: 'Eastern Europe',
  SY: 'Middle East', IQ: 'Middle East', IR: 'Middle East', YE: 'Middle East',
  IL: 'Middle East', LB: 'Middle East', JO: 'Middle East', SA: 'Middle East',
  AE: 'Middle East', QA: 'Middle East', KW: 'Middle East', BH: 'Middle East', OM: 'Middle East',
  SD: 'Sub-Saharan Africa', SS: 'Sub-Saharan Africa', ET: 'Sub-Saharan Africa',
  SO: 'Sub-Saharan Africa', CD: 'Sub-Saharan Africa', NG: 'Sub-Saharan Africa',
  ML: 'Sub-Saharan Africa', NE: 'Sub-Saharan Africa', BF: 'Sub-Saharan Africa',
  CM: 'Sub-Saharan Africa', MZ: 'Sub-Saharan Africa', KE: 'Sub-Saharan Africa',
  AF: 'Central/South Asia', PK: 'Central/South Asia', IN: 'Central/South Asia',
  BD: 'Central/South Asia', NP: 'Central/South Asia', LK: 'Central/South Asia',
  MM: 'Southeast Asia', PH: 'Southeast Asia', TH: 'Southeast Asia', ID: 'Southeast Asia',
  CN: 'East Asia', KP: 'East Asia', KR: 'East Asia', TW: 'East Asia', JP: 'East Asia',
  LY: 'North Africa', DZ: 'North Africa', EG: 'North Africa', TN: 'North Africa', MA: 'North Africa',
  CO: 'Latin America', VE: 'Latin America', MX: 'Latin America', HT: 'Latin America',
  BR: 'Latin America', AR: 'Latin America', CL: 'Latin America',
  US: 'North America', CA: 'North America',
  GB: 'Western Europe', FR: 'Western Europe', DE: 'Western Europe', IT: 'Western Europe', ES: 'Western Europe',
};

function getRegion(countryCode) {
  return COUNTRY_TO_REGION[countryCode] || 'Other';
}

// Rough mapping from location names to country codes
function locationToCountry(locationName) {
  const lower = (locationName || '').toLowerCase();
  const mapping = {
    'ukraine': 'UA', 'kyiv': 'UA', 'kharkiv': 'UA', 'odesa': 'UA', 'dnipro': 'UA',
    'russia': 'RU', 'moscow': 'RU', 'belgorod': 'RU',
    'gaza': 'IL', 'israel': 'IL', 'tel aviv': 'IL',
    'syria': 'SY', 'damascus': 'SY', 'aleppo': 'SY',
    'iraq': 'IQ', 'baghdad': 'IQ',
    'iran': 'IR', 'tehran': 'IR',
    'yemen': 'YE', 'sanaa': 'YE',
    'lebanon': 'LB', 'beirut': 'LB',
    'sudan': 'SD', 'khartoum': 'SD',
    'south sudan': 'SS',
    'ethiopia': 'ET',
    'somalia': 'SO', 'mogadishu': 'SO',
    'nigeria': 'NG',
    'mali': 'ML',
    'niger': 'NE',
    'afghanistan': 'AF', 'kabul': 'AF',
    'pakistan': 'PK',
    'india': 'IN', 'kashmir': 'IN',
    'myanmar': 'MM',
    'north korea': 'KP',
    'china': 'CN',
    'taiwan': 'TW',
    'libya': 'LY',
    'congo': 'CD',
  };
  for (const [name, code] of Object.entries(mapping)) {
    if (lower.includes(name)) return code;
  }
  return null;
}

// ---------- Graph Builders ----------

function buildPOIStatements(poiData) {
  if (!poiData?.persons) return [];
  const stmts = [];

  for (const p of poiData.persons.slice(0, 50)) {
    const name = (p.name || '').trim();
    if (!name) continue;

    // Create/merge Person node
    stmts.push({
      query: `MERGE (p:Person {name: $name})
              SET p.role = $role, p.riskLevel = $riskLevel, p.region = $region,
                  p.activityScore = $activityScore, p.source = $source,
                  p.updatedAt = datetime()`,
      params: {
        name,
        role: p.role || '',
        riskLevel: (p.riskLevel || 'unknown').toLowerCase(),
        region: p.region || '',
        activityScore: p.activityScore || 0,
        source: p.source || 'tracked',
      },
    });

    // Link to country if location is known
    const loc = p.lastKnownLocation || p.region || '';
    const countryCode = locationToCountry(loc);
    if (countryCode) {
      stmts.push({
        query: `MERGE (p:Person {name: $name})
                MERGE (c:Country {code: $code})
                MERGE (p)-[:LOCATED_IN]->(c)`,
        params: { name, code: countryCode },
      });

      // Heads of state get a LEADS relationship
      const role = (p.role || '').toLowerCase();
      if (role.includes('president') || role.includes('prime minister') || role.includes('leader') || role.includes('supreme')) {
        stmts.push({
          query: `MERGE (p:Person {name: $name})
                  MERGE (c:Country {code: $code})
                  MERGE (p)-[:LEADS]->(c)`,
          params: { name, code: countryCode },
        });
      }
    }
  }

  return stmts;
}

function buildConflictForecastStatements(forecastData) {
  if (!forecastData?.forecasts) return [];
  const stmts = [];

  for (const f of forecastData.forecasts.filter(x => x.predictedLogFatalities > 0.5).slice(0, 40)) {
    const code = f.countryCode;
    const countryName = f.countryName || code;
    const region = getRegion(code);
    const riskLevel = f.predictedLogFatalities > 5 ? 'extreme' : f.predictedLogFatalities > 3 ? 'high' : f.predictedLogFatalities > 1 ? 'elevated' : 'moderate';

    // Create/merge Country node with forecast data
    stmts.push({
      query: `MERGE (c:Country {code: $code})
              SET c.name = $name, c.riskLevel = $riskLevel,
                  c.predictedFatalities = $fatalities, c.forecastModel = 'VIEWS',
                  c.updatedAt = datetime()`,
      params: {
        code,
        name: countryName,
        riskLevel,
        fatalities: f.estimatedFatalities || 0,
      },
    });

    // Link country to region
    stmts.push({
      query: `MERGE (c:Country {code: $code})
              MERGE (r:Region {name: $region})
              MERGE (c)-[:IN_REGION]->(r)`,
      params: { code, region },
    });
  }

  return stmts;
}

function buildMissileEventStatements(missileData) {
  if (!missileData?.events) return [];
  const stmts = [];

  for (const e of missileData.events.slice(0, 30)) {
    const eventId = `missile:${e.id || (e.title || '').slice(0, 30)}`;
    const countryCode = locationToCountry(e.locationName);

    // Create Event node
    stmts.push({
      query: `MERGE (e:Event {eventId: $eventId})
              SET e.type = 'missile_strike', e.subtype = $subtype,
                  e.title = $title, e.severity = $severity,
                  e.location = $location, e.timestamp = $timestamp,
                  e.dataSource = 'GDELT', e.updatedAt = datetime()`,
      params: {
        eventId,
        subtype: e.eventType || 'strike',
        title: (e.title || '').slice(0, 200),
        severity: e.severity || 'unknown',
        location: e.locationName || '',
        timestamp: e.timestamp || 0,
      },
    });

    // Link event to country
    if (countryCode) {
      stmts.push({
        query: `MERGE (e:Event {eventId: $eventId})
                MERGE (c:Country {code: $code})
                MERGE (e)-[:TARGETS]->(c)`,
        params: { eventId, code: countryCode },
      });

      // Link event to region
      const region = getRegion(countryCode);
      stmts.push({
        query: `MERGE (e:Event {eventId: $eventId})
                MERGE (r:Region {name: $region})
                MERGE (e)-[:OCCURRED_IN]->(r)`,
        params: { eventId, region },
      });
    }
  }

  return stmts;
}

function buildDiseaseStatements(diseaseData) {
  if (!diseaseData?.events) return [];
  const stmts = [];

  for (const e of diseaseData.events.slice(0, 20)) {
    const eventId = `disease:${e.id || (e.title || '').slice(0, 30)}`;

    stmts.push({
      query: `MERGE (e:Event {eventId: $eventId})
              SET e.type = 'disease_outbreak', e.subtype = $subtype,
                  e.title = $title, e.severity = $severity,
                  e.country = $country, e.timestamp = $timestamp,
                  e.dataSource = 'WHO-DON', e.updatedAt = datetime()`,
      params: {
        eventId,
        subtype: e.diseaseType || 'unknown',
        title: (e.title || '').slice(0, 200),
        severity: e.severity || 'unknown',
        country: e.country || '',
        timestamp: e.timestamp || 0,
      },
    });

    // Try to link to country
    const countryCode = locationToCountry(e.country);
    if (countryCode) {
      stmts.push({
        query: `MERGE (e:Event {eventId: $eventId})
                MERGE (c:Country {code: $code})
                MERGE (e)-[:TARGETS]->(c)`,
        params: { eventId, code: countryCode },
      });
    }
  }

  return stmts;
}

function buildUnrestStatements(unrestData) {
  if (!unrestData?.events && !unrestData?.topics) return [];
  const events = unrestData.events || (unrestData.topics?.flatMap(t => t.events || []) || []);
  const stmts = [];

  for (const e of events.slice(0, 20)) {
    const loc = e.location?.name || e.country || '';
    const eventId = `unrest:${(e.id || loc + ':' + (e.description || '').slice(0, 20))}`;
    const countryCode = locationToCountry(loc);

    stmts.push({
      query: `MERGE (e:Event {eventId: $eventId})
              SET e.type = 'unrest', e.subtype = $subtype,
                  e.title = $title, e.severity = $severity,
                  e.location = $location, e.dataSource = 'ACLED/GDELT',
                  e.updatedAt = datetime()`,
      params: {
        eventId,
        subtype: e.eventType || e.type || 'civil_unrest',
        title: (e.description || e.title || '').slice(0, 200),
        severity: (e.severityLevel || e.severity || 'unknown').toLowerCase(),
        location: loc,
      },
    });

    if (countryCode) {
      stmts.push({
        query: `MERGE (e:Event {eventId: $eventId})
                MERGE (c:Country {code: $code})
                MERGE (e)-[:TARGETS]->(c)`,
        params: { eventId, code: countryCode },
      });
    }
  }

  return stmts;
}

// ---------- Main ----------

async function main() {
  const neo4j = getNeo4jCredentials();
  const redis = getRedisCredentials();

  console.log('=== Entity Graph Seed ===');
  console.log(`  Neo4j: ${neo4j.queryUrl}`);

  // Test Neo4j connectivity
  try {
    await runCypher(neo4j.queryUrl, neo4j.authToken, [{ query: 'RETURN 1 AS ok' }]);
    console.log('  Neo4j: Connected ✅');
  } catch (err) {
    console.error(`  Neo4j connection failed: ${err.message}`);
    process.exit(0);
  }

  // Create indexes for performance (idempotent)
  console.log('  Creating indexes...');
  try {
    await runCypher(neo4j.queryUrl, neo4j.authToken, [
      { query: 'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)' },
      { query: 'CREATE INDEX country_code IF NOT EXISTS FOR (c:Country) ON (c.code)' },
      { query: 'CREATE INDEX event_id IF NOT EXISTS FOR (e:Event) ON (e.eventId)' },
      { query: 'CREATE INDEX region_name IF NOT EXISTS FOR (r:Region) ON (r.name)' },
    ]);
    console.log('  Indexes: OK');
  } catch (err) {
    console.warn(`  Index creation warning: ${err.message}`);
  }

  // Read all data sources from Redis
  const [poi, forecasts, missiles, diseases, unrest] = await Promise.all([
    redisGet(redis.url, redis.token, 'intelligence:poi:v1'),
    redisGet(redis.url, redis.token, 'forecast:conflict:v1'),
    redisGet(redis.url, redis.token, 'intelligence:missile-events:v1'),
    redisGet(redis.url, redis.token, 'health:outbreaks:v1'),
    redisGet(redis.url, redis.token, 'unrest:events:v1'),
  ]);

  console.log(`  Data sources:`);
  console.log(`    POI: ${poi?.persons?.length ?? 0}`);
  console.log(`    Forecasts: ${forecasts?.forecasts?.length ?? 0}`);
  console.log(`    Missiles: ${missiles?.events?.length ?? 0}`);
  console.log(`    Diseases: ${diseases?.events?.length ?? 0}`);
  console.log(`    Unrest: ${(unrest?.events || unrest?.topics?.flatMap(t => t.events || []))?.length ?? 0}`);

  // Build all Cypher statements
  const allStatements = [
    ...buildPOIStatements(poi),
    ...buildConflictForecastStatements(forecasts),
    ...buildMissileEventStatements(missiles),
    ...buildDiseaseStatements(diseases),
    ...buildUnrestStatements(unrest),
  ];

  console.log(`  Total Cypher statements: ${allStatements.length}`);

  if (allStatements.length === 0) {
    console.log('  No data to graph — exiting');
    process.exit(0);
  }

  // Execute statements sequentially via Query API v2 (one statement per request)
  // Process in logical batches for logging, but each statement runs individually
  const BATCH_SIZE = 20;
  let executed = 0;
  let errors = 0;

  for (let i = 0; i < allStatements.length; i += BATCH_SIZE) {
    const batch = allStatements.slice(i, i + BATCH_SIZE);
    let batchOk = 0;
    for (const stmt of batch) {
      try {
        await runCypherSingle(neo4j.queryUrl, neo4j.authToken, stmt.query, stmt.params || {});
        batchOk++;
      } catch (err) {
        errors++;
        // Log first error per batch, skip rest silently
        if (batchOk === 0) console.warn(`  Statement error: ${err.message.slice(0, 120)}`);
      }
    }
    executed += batchOk;
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchOk}/${batch.length} OK (${executed}/${allStatements.length})`);

    if (i + BATCH_SIZE < allStatements.length) await sleep(300);
  }

  console.log(`  Executed: ${executed}/${allStatements.length} (${errors} errors)`);

  // Get node/relationship counts
  try {
    const nodeResult = await runCypherSingle(neo4j.queryUrl, neo4j.authToken,
      'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count');
    const relResult = await runCypherSingle(neo4j.queryUrl, neo4j.authToken,
      'MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count');

    // Query API v2 returns { data: { fields: [...], values: [[...], ...] } }
    const nodeValues = nodeResult.data?.values || [];
    const relValues = relResult.data?.values || [];
    console.log('  Node counts:');
    for (const row of nodeValues) {
      console.log(`    ${row[0]}: ${row[1]}`);
    }
    console.log('  Relationship counts:');
    for (const row of relValues) {
      console.log(`    ${row[0]}: ${row[1]}`);
    }
  } catch { /* silent */ }

  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
