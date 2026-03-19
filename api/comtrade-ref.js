// ═══════════════════════════════════════════════════════════
// GET /api/comtrade-ref — Comtrade Tools v1 (Reference Data)
// Country codes, HS code lookups, data availability, etc.
// Same subscription key as comtrade v1
// ═══════════════════════════════════════════════════════════

const TOOLS_BASE = 'https://comtradeapi.un.org/files/v1/app/reference';

// In-memory LRU-style cache for reference data (rarely changes)
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const { type } = req.query || {};

  // Available reference datasets
  const VALID_TYPES = {
    'Reporters':     'ListofReporters.json',        // Reporter countries
    'partnerAreas':  'partnerAreas.json',            // Partner countries
    'HS':            'HS.json',                      // Full HS classification
    'S1':            'S1.json',                      // SITC Rev 1
    'S2':            'S2.json',                      // SITC Rev 2
    'S3':            'S3.json',                      // SITC Rev 3
    'S4':            'S4.json',                      // SITC Rev 4
    'BEC':           'BEC.json',                     // Broad Econ Categories
    'EB02':          'EB02.json',                    // EBOPS 2002
    'EB10':          'EB10.json',                    // EBOPS 2010
    'flowCode':      'flowCode.json',                // Flow codes (M, X, etc.)
    'customsCode':   'customsCode.json',             // Customs procedure codes
    'motCode':       'motCode.json',                 // Mode of transport codes
    'qtyUnitCode':   'qtyUnitCode.json',             // Quantity unit codes
  };

  if (!type || !VALID_TYPES[type]) {
    return res.status(400).json({
      error: `Missing or invalid "type" param. Valid: ${Object.keys(VALID_TYPES).join(', ')}`,
    });
  }

  // Check cache first
  const cached = getCached(type);
  if (cached) {
    console.log(`[ComtradeRef] ${type} → cache hit`);
    return res.status(200).json({ type, data: cached, cached: true });
  }

  const url = `${TOOLS_BASE}/${VALID_TYPES[type]}`;
  console.log(`[ComtradeRef] ${type} → ${url}`);

  try {
    // Reference files are public — no subscription key needed
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Comtrade reference API ${response.status}: ${response.statusText}`,
      });
    }

    const json = await response.json();
    const data = json.results || json || [];

    // Cache the result
    cache.set(type, { data, ts: Date.now() });

    return res.status(200).json({
      type,
      data,
      count: Array.isArray(data) ? data.length : Object.keys(data).length,
      cached: false,
    });
  } catch (err) {
    console.error('[ComtradeRef] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
