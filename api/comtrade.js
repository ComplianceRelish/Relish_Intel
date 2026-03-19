// ═══════════════════════════════════════════════════════════
// GET /api/comtrade — Full v1 UN Comtrade API proxy
// Swagger: https://comtradeapi.un.org/data/v1
// Auth: Ocp-Apim-Subscription-Key header
// Fallback: public/v1 (free preview, 500 records, no key)
// ═══════════════════════════════════════════════════════════

const PREMIUM_BASE = 'https://comtradeapi.un.org/data/v1';
const PUBLIC_BASE  = 'https://comtradeapi.un.org/public/v1/preview';

// Endpoints that take /{typeCode}/{freqCode}/{clCode} path params
const PATH_ENDPOINTS = ['get', 'getTariffline', 'getDaTariffline', 'getDa', 'getMetadata', 'getSUV', 'getTradeMatrix'];
// Endpoints with no path params
const SIMPLE_ENDPOINTS = ['getMBS', 'getLiveUpdate'];
const ALL_ENDPOINTS = [...PATH_ENDPOINTS, ...SIMPLE_ENDPOINTS];

// Simple in-memory rate limit counter (resets on cold-start / redeploy)
let callCount = 0;
let callDate = new Date().toISOString().slice(0, 10);
const DAILY_LIMIT = 490; // leave buffer below 500

function checkRateLimit() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== callDate) { callCount = 0; callDate = today; }
  callCount++;
  return callCount <= DAILY_LIMIT;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const apiKey = process.env.COMTRADE_API_KEY;
  const withinLimit = apiKey ? checkRateLimit() : false;
  const usePremium = apiKey && withinLimit;

  const {
    // Routing
    endpoint = 'get',
    // Path params (for PATH_ENDPOINTS)
    typeCode = 'C',        // C = commodities, S = services
    freqCode = 'A',        // A = annual, M = monthly
    clCode   = 'HS',       // HS, H0-H6, S1-S4, BE, BE5, EB, TM, etc.
    // Common query params (per swagger)
    reporterCode,
    period,                 // 4-digit year or YYYYMM; CSV for multi
    partnerCode,
    partner2Code,
    cmdCode,                // HS commodity code(s); CSV for multi
    flowCode,               // M, X, RX, RM, MIP, XIP, etc.
    customsCode,
    motCode,
    aggregateBy,
    breakdownMode,
    includeDesc = 'true',
    // getSUV-specific
    qtyUnitCode,
    // getDa / getDaTariffline-specific
    publishedDateFrom,
    publishedDateTo,
    // getMBS-specific
    series_type,
    year,
    country_code,
    period_type,
    table_type,
    format,
  } = req.query || {};

  // Validate endpoint
  if (!ALL_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({
      error: `Invalid endpoint "${endpoint}". Valid: ${ALL_ENDPOINTS.join(', ')}`,
    });
  }

  // Public API only supports /get — fall back for others
  const effectiveEndpoint = usePremium ? endpoint : 'get';
  const base = usePremium ? PREMIUM_BASE : PUBLIC_BASE;

  // Build URL
  let url;
  if (SIMPLE_ENDPOINTS.includes(effectiveEndpoint)) {
    url = new URL(`${base}/${effectiveEndpoint}`);
  } else {
    // Public preview uses /preview/{typeCode}/{freqCode}/{clCode}
    url = new URL(`${base}/${usePremium ? effectiveEndpoint + '/' : ''}${typeCode}/${freqCode}/${clCode}`);
  }

  // Map all query params (only set if truthy to avoid empty strings)
  const qp = url.searchParams;
  if (reporterCode)      qp.set('reporterCode', reporterCode);
  if (period)            qp.set('period', period);
  if (partnerCode)       qp.set('partnerCode', partnerCode);
  if (partner2Code)      qp.set('partner2Code', partner2Code);
  if (cmdCode)           qp.set('cmdCode', cmdCode);
  if (flowCode)          qp.set('flowCode', flowCode);
  if (customsCode)       qp.set('customsCode', customsCode);
  if (motCode)           qp.set('motCode', motCode);
  if (aggregateBy)       qp.set('aggregateBy', aggregateBy);
  if (breakdownMode)     qp.set('breakdownMode', breakdownMode);
  qp.set('includeDesc', includeDesc);

  // Endpoint-specific params (premium only)
  if (usePremium) {
    if (qtyUnitCode)       qp.set('qtyUnitCode', qtyUnitCode);
    if (publishedDateFrom) qp.set('publishedDateFrom', publishedDateFrom);
    if (publishedDateTo)   qp.set('publishedDateTo', publishedDateTo);
    // MBS-specific
    if (series_type)       qp.set('series_type', series_type);
    if (year)              qp.set('year', year);
    if (country_code)      qp.set('country_code', country_code);
    if (period_type)       qp.set('period_type', period_type);
    if (table_type)        qp.set('table_type', table_type);
    if (format)            qp.set('format', format);
  }

  const headers = usePremium ? { 'Ocp-Apim-Subscription-Key': apiKey } : {};
  const tier = usePremium ? 'premium' : 'public';

  console.log(`[Comtrade:${tier}] ${effectiveEndpoint} → reporterCode=${reporterCode || '-'}&cmdCode=${cmdCode || '-'}&flowCode=${flowCode || '-'} (call #${callCount})`);

  try {
    const response = await fetch(url.toString(), { headers });

    // If premium returns 429 (rate limit), retry with public
    if (response.status === 429 && usePremium) {
      console.warn('[Comtrade] 429 rate limited — falling back to public API');
      callCount = DAILY_LIMIT + 1; // force public for rest of day
      // Retry request through public API
      const pubUrl = new URL(`${PUBLIC_BASE}/${typeCode}/${freqCode}/${clCode}`);
      for (const [k, v] of qp.entries()) pubUrl.searchParams.set(k, v);
      const pubRes = await fetch(pubUrl.toString());
      if (!pubRes.ok) {
        return res.status(pubRes.status).json({ error: `Public fallback also failed: ${pubRes.status}` });
      }
      const pubJson = await pubRes.json();
      return res.status(200).json({
        endpoint: effectiveEndpoint,
        tier: 'public-fallback',
        data: pubJson.data || [],
        count: pubJson.count ?? pubJson.data?.length ?? 0,
        elapsedTime: pubJson.elapsedTime || null,
        error: pubJson.error || null,
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Comtrade] ${response.status}:`, errText.slice(0, 500));
      return res.status(response.status).json({
        error: `Comtrade API ${response.status}: ${response.statusText}`,
        detail: errText.slice(0, 300),
      });
    }

    const json = await response.json();

    return res.status(200).json({
      endpoint: effectiveEndpoint,
      tier,
      data: json.data || [],
      count: json.count ?? json.data?.length ?? 0,
      elapsedTime: json.elapsedTime || null,
      error: json.error || null,
      callsRemaining: usePremium ? Math.max(0, DAILY_LIMIT - callCount) : 'unlimited',
    });
  } catch (err) {
    console.error('[Comtrade] proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
