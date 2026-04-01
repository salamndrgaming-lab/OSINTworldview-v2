/**
 * geo-extract.mjs — Lightweight headline → ISO2 country code extractor.
 *
 * Combines a full country-names.json base with city/capital/adjective aliases
 * and geopolitical short-forms that appear frequently in OSINT news headlines.
 *
 * Design goals (vs worldmonitor's version which this builds on):
 *  - Extended ALIAS_MAP with more conflict-zone capitals and militia/faction terms
 *  - Supranational markers (NATO, EU) return null instead of 'XX' — consumers
 *    get a clean null rather than a sentinel they have to filter
 *  - UNIGRAM_STOPWORDS expanded for OSINT context (Sahel region names, etc.)
 *  - extractAllCountryCodes() added — returns every ISO2 found (deduped, ordered)
 *    for multi-country stories; extractCountryCode() still returns first match only
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const countryNames = require(join(__dirname, 'country-names.json'));

// Aliases → ISO2. Takes precedence over country-names.json.
// Supranational markers use null (not 'XX') — null is unambiguous for consumers.
const ALIAS_MAP = {
  // Major capitals & common short-forms
  'moscow': 'RU', 'kremlin': 'RU', 'russian': 'RU',
  'beijing': 'CN', 'chinese': 'CN', 'prc': 'CN',
  'washington': 'US', 'american': 'US', 'pentagon': 'US',
  'kyiv': 'UA', 'ukrainian': 'UA',
  'tehran': 'IR', 'iranian': 'IR',
  'pyongyang': 'KP', 'north korean': 'KP',
  'taipei': 'TW', 'taiwanese': 'TW',
  'riyadh': 'SA', 'saudi': 'SA',
  'tel aviv': 'IL', 'israeli': 'IL',
  'gaza': 'PS', 'west bank': 'PS', 'palestinian': 'PS',
  'damascus': 'SY', 'syrian': 'SY',
  'kabul': 'AF', 'afghan': 'AF',
  'islamabad': 'PK', 'pakistani': 'PK',
  'new delhi': 'IN', 'indian': 'IN',
  'ankara': 'TR', 'turkish': 'TR',
  'berlin': 'DE', 'german': 'DE',
  'paris': 'FR', 'french': 'FR',
  'london': 'GB', 'british': 'GB', 'uk': 'GB',
  'tokyo': 'JP', 'japanese': 'JP',
  'seoul': 'KR', 'south korean': 'KR',
  'manila': 'PH', 'philippine': 'PH',
  'hanoi': 'VN', 'vietnamese': 'VN',
  'caracas': 'VE', 'venezuelan': 'VE',
  'havana': 'CU', 'cuban': 'CU',
  'minsk': 'BY', 'belarusian': 'BY',
  'belgrade': 'RS', 'serbian': 'RS',
  'warsaw': 'PL', 'polish': 'PL',
  'budapest': 'HU', 'hungarian': 'HU',
  'prague': 'CZ', 'czech': 'CZ',
  'baghdad': 'IQ', 'iraqi': 'IQ',
  'sanaa': 'YE', 'yemeni': 'YE',
  'tripoli': 'LY', 'libyan': 'LY',
  'khartoum': 'SD', 'sudanese': 'SD',
  'addis ababa': 'ET', 'ethiopian': 'ET',
  'nairobi': 'KE', 'kenyan': 'KE',
  'lagos': 'NG', 'nigerian': 'NG',
  'pretoria': 'ZA', 'south african': 'ZA',
  'brasilia': 'BR', 'brazilian': 'BR',
  'bogota': 'CO', 'colombian': 'CO',
  'buenos aires': 'AR', 'argentine': 'AR',
  'lima': 'PE', 'peruvian': 'PE',
  'mexico city': 'MX', 'mexican': 'MX',
  'ottawa': 'CA', 'canadian': 'CA',
  'canberra': 'AU', 'australian': 'AU',
  // OSINT-specific: conflict zones, faction HQs, militia terms
  'donbas': 'UA', 'donbass': 'UA', 'zaporizhzhia': 'UA', 'kharkiv': 'UA', 'kherson': 'UA',
  'mariupol': 'UA', 'bakhmut': 'UA', 'avdiivka': 'UA',
  'rafah': 'PS', 'khan yunis': 'PS', 'jenin': 'PS',
  'hezbollah': 'LB', 'beirut': 'LB', 'lebanese': 'LB',
  'houthi': 'YE', 'houthis': 'YE',
  'hamas': 'PS',
  'idlib': 'SY', 'aleppo': 'SY', 'deir ez-zor': 'SY',
  'mosul': 'IQ', 'fallujah': 'IQ', 'erbil': 'IQ',
  'benghazi': 'LY',
  'bucha': 'UA', 'irpin': 'UA',
  // Supranational — null means no single country
  'nato': null, 'eu': null, 'europe': null, 'g7': null, 'g20': null,
  'un': null, 'united nations': null, 'iaea': null,
  // Regions used as topic labels
  'taiwan strait': 'TW',
  'south china sea': 'CN',
  'strait of hormuz': 'IR',
  'black sea': null,
  'ukraine': 'UA',
};

// Unigrams too ambiguous for bare-word matching.
// Bigram aliases still work fine (e.g. "South Sudan", "North Korea").
const UNIGRAM_STOPWORDS = new Set([
  'chad',    // English given name
  'jordan',  // English given name
  'georgia', // US state (alias map handles 'georgian' → GE via country-names)
  'niger',   // easily confused with nigeria; 'nigerien' is rare
  'guinea',  // appears in many compound names
  'mali',    // suffix in many demonyms (Somali, Bengali)
  'peru',    // low geopolitical frequency
  'iran',    // kept — high enough frequency in OSINT to override
  // OSINT additions: short Sahel/African country names with high false-positive rate
  'togo',    // too short; 'togolese' is the reliable form
  'laos',    // 'lao' is a common surname; 'laotian' is preferred
]);
// Note: 'iran' is intentionally NOT in stopwords — it's unambiguous in OSINT context.

// Build merged lookup (alias map takes precedence)
const LOOKUP = {};
for (const [name, iso2] of Object.entries(countryNames)) {
  LOOKUP[name.toLowerCase()] = iso2;
}
for (const [alias, iso2] of Object.entries(ALIAS_MAP)) {
  LOOKUP[alias.toLowerCase()] = iso2 ?? '__NULL__'; // sentinel for explicit nulls
}

/**
 * Extract the FIRST matching ISO2 country code from text.
 * Returns null if no match, or if the match is a supranational marker.
 * @param {string} text
 * @returns {string|null}
 */
export function extractCountryCode(text) {
  if (!text) return null;
  const normalized = text.replace(/\bUS\b/g, 'United States');
  const lower = normalized.toLowerCase();
  const words = lower.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    // Try bigram first (longest match wins at each position)
    if (i < words.length - 1) {
      const left  = words[i].replace(/[^a-z]/g, '');
      const right = words[i + 1].replace(/[^a-z]/g, '');
      if (left && right) {
        const bigram = `${left} ${right}`;
        if (bigram in LOOKUP) {
          const val = LOOKUP[bigram];
          return val === '__NULL__' ? null : val;
        }
      }
    }
    const clean = words[i].replace(/[^a-z]/g, '');
    if (clean.length < 2) continue;
    if (UNIGRAM_STOPWORDS.has(clean)) continue;
    if (clean in LOOKUP) {
      const val = LOOKUP[clean];
      return val === '__NULL__' ? null : val;
    }
  }
  return null;
}

/**
 * Extract ALL distinct ISO2 codes from text, in order of first appearance.
 * Supranational markers (null entries) are excluded from results.
 * Useful for multi-country stories (e.g. "US and China trade talks").
 * @param {string} text
 * @returns {string[]}
 */
export function extractAllCountryCodes(text) {
  if (!text) return [];
  const normalized = text.replace(/\bUS\b/g, 'United States');
  const lower = normalized.toLowerCase();
  const words = lower.split(/\s+/);
  const seen = new Set();
  const result = [];

  for (let i = 0; i < words.length; i++) {
    let matched = false;
    if (i < words.length - 1) {
      const left  = words[i].replace(/[^a-z]/g, '');
      const right = words[i + 1].replace(/[^a-z]/g, '');
      if (left && right) {
        const bigram = `${left} ${right}`;
        if (bigram in LOOKUP) {
          const val = LOOKUP[bigram];
          if (val && val !== '__NULL__' && !seen.has(val)) {
            seen.add(val);
            result.push(val);
          }
          matched = true;
          i++; // skip the second word of the bigram
        }
      }
    }
    if (matched) continue;
    const clean = words[i].replace(/[^a-z]/g, '');
    if (clean.length < 2) continue;
    if (UNIGRAM_STOPWORDS.has(clean)) continue;
    if (clean in LOOKUP) {
      const val = LOOKUP[clean];
      if (val && val !== '__NULL__' && !seen.has(val)) {
        seen.add(val);
        result.push(val);
      }
    }
  }
  return result;
}
