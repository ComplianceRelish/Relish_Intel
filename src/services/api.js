// ═══════════════════════════════════════════════════════════
// API Service — all external calls go through /api proxy
// API keys stay on the server, never exposed to the browser
// ═══════════════════════════════════════════════════════════

const API = '/api';

// Default to previous year (most likely to have complete data)
const DEFAULT_PERIOD = String(new Date().getFullYear() - 1);

// ── Comtrade v1 helpers ────────────────────────────────────

/**
 * Generic Comtrade v1 API call via our backend proxy.
 * Maps directly to the swagger endpoints:
 *   get, getTariffline, getSUV, getMBS, getTradeMatrix, getDa, getMetadata, getLiveUpdate
 * Auto-fallback to public API when premium limit exhausted.
 *
 * @param {object} opts - All params passed as query string to /api/comtrade
 * @returns {Promise<{data: Array, count: number, endpoint: string, tier: string}>}
 */
export async function comtradeQuery(opts = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }

  const res = await fetch(`${API}/comtrade?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Comtrade API error: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch trade data (the main /get endpoint).
 * @param {string} reporterCode - M49 country code (e.g. '156' for China)
 * @param {string} cmdCode      - HS commodity code(s), CSV for multi
 * @param {string} flowCode     - 'M' imports, 'X' exports
 * @param {string|null} partnerCode - M49 partner code or null for all
 * @param {string} period       - Year(s) CSV (e.g. '2023' or '2020,2021,2022,2023')
 * @param {object} extra        - Additional v1 params (freqCode, clCode, etc.)
 * @returns {Promise<Array>} Trade data records
 */
export async function fetchComtradeData(
  reporterCode,
  cmdCode,
  flowCode,
  partnerCode = null,
  period = DEFAULT_PERIOD,
  extra = {}
) {
  const opts = {
    endpoint: 'get',
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'HS',
    reporterCode,
    cmdCode,
    flowCode,
    period,
    breakdownMode: 'classic',
    includeDesc: 'true',
    ...extra,
  };
  if (partnerCode) opts.partnerCode = partnerCode;

  const json = await comtradeQuery(opts);
  return json.data || [];
}

/**
 * Fetch MONTHLY trade data for granular trend analysis.
 * Returns data with period formatted as YYYYMM.
 * @param {string} reporterCode - M49 country code
 * @param {string} cmdCode      - HS code(s)
 * @param {string} flowCode     - 'M' or 'X'
 * @param {string} period       - YYYYMM values, CSV for multi (e.g. '202301,202302,...')
 * @param {string|null} partnerCode - M49 partner code or null
 * @returns {Promise<Array>} Monthly records
 */
export async function fetchMonthlyData(
  reporterCode,
  cmdCode,
  flowCode,
  period,
  partnerCode = null,
) {
  const opts = {
    endpoint: 'get',
    typeCode: 'C',
    freqCode: 'M', // Monthly!
    clCode: 'HS',
    reporterCode,
    cmdCode,
    flowCode,
    period,
    breakdownMode: 'classic',
    includeDesc: 'true',
  };
  if (partnerCode) opts.partnerCode = partnerCode;

  const json = await comtradeQuery(opts);
  return json.data || [];
}

/**
 * Fetch tariff-line level data.
 */
export async function fetchTariffLine(reporterCode, cmdCode, flowCode, period = DEFAULT_PERIOD, extra = {}) {
  const json = await comtradeQuery({
    endpoint: 'getTariffline',
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'HS',
    reporterCode,
    cmdCode,
    flowCode,
    period,
    includeDesc: 'true',
    ...extra,
  });
  return json.data || [];
}

/**
 * Fetch Standard Unit Values (price benchmarks).
 */
export async function fetchSUV(cmdCode, flowCode, period = DEFAULT_PERIOD, extra = {}) {
  const json = await comtradeQuery({
    endpoint: 'getSUV',
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'HS',
    cmdCode,
    flowCode,
    period,
    ...extra,
  });
  return json.data || [];
}

/**
 * Fetch bilateral Trade Matrix.
 */
export async function fetchTradeMatrix(reporterCode, cmdCode, flowCode, period = DEFAULT_PERIOD, extra = {}) {
  const json = await comtradeQuery({
    endpoint: 'getTradeMatrix',
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'TM', // Trade Matrix requires TM
    reporterCode,
    cmdCode,
    flowCode,
    period,
    includeDesc: 'true',
    ...extra,
  });
  return json.data || [];
}

/**
 * Fetch MBS (Monthly Bulletin of Statistics) historical data.
 * @param {string} series_type - e.g. 'T35.A.V.$' for annual trade value
 * @param {string} country_code - M49 code
 * @param {string} year - e.g. '2020,2021,2022,2023'
 */
export async function fetchMBS(series_type, country_code, year, extra = {}) {
  const json = await comtradeQuery({
    endpoint: 'getMBS',
    series_type,
    country_code,
    year,
    ...extra,
  });
  return json.data || [];
}

/**
 * Check data availability for a reporter/period.
 */
export async function fetchDataAvailability(reporterCode, period, extra = {}) {
  const json = await comtradeQuery({
    endpoint: 'getDa',
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'HS',
    reporterCode,
    period,
    ...extra,
  });
  return json.data || [];
}

// ── Comtrade Reference Data (Tools v1) ─────────────────────

/**
 * Fetch reference data from Comtrade Tools (country codes, HS codes, etc.)
 * Results are cached server-side for 24h.
 * @param {'Reporters'|'partnerAreas'|'HS'|'flowCode'|'customsCode'|'motCode'|'qtyUnitCode'} type
 * @returns {Promise<Array>} Reference records
 */
export async function fetchComtradeRef(type) {
  const res = await fetch(`${API}/comtrade-ref?type=${encodeURIComponent(type)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Reference API error: ${res.status}`);
  }
  const json = await res.json();
  return json.data || [];
}

// Convenience wrappers
export const fetchReporterCodes = () => fetchComtradeRef('Reporters');
export const fetchPartnerCodes  = () => fetchComtradeRef('partnerAreas');
export const fetchHSClassification = () => fetchComtradeRef('HS');
export const fetchFlowCodes     = () => fetchComtradeRef('flowCode');

// ── Claude AI ──────────────────────────────────────────────

/**
 * Ask Claude AI via backend proxy (keeps API key server-side)
 * @param {string} prompt       - The user prompt
 * @param {string} systemPrompt - Optional system prompt override
 * @returns {Promise<{content: string, parsed: object|null}>}
 */
export async function askClaude(prompt, systemPrompt = null) {
  const body = { prompt };
  if (systemPrompt) body.systemPrompt = systemPrompt;

  const res = await fetch(`${API}/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Claude API error: ${res.status}`);
  }

  return res.json();
}

// ── Health ──────────────────────────────────────────────────

/**
 * Get server health / configured source status
 * @returns {Promise<{status: string, sources: object}>}
 */
export async function getHealth() {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error('Server unreachable');
  return res.json();
}
