// ═══════════════════════════════════════════════════════════════════════════
// GET /api/scrape — Live multi-source trade data scraper
//
// Primary product : ITC-HS 03073910 — Kakka / Indian Black Clam
//   (Villorita cyprinoides · Meretrix meretrix · Katelysia spp.)
// Shell derivatives: 282510 (CaO) · 283526 (CaPO4) · 283650 (CaCO3)
//
// Sources hit on every run (no API keys required):
//   1. UN Comtrade public preview  — comtradeapi.un.org/public/v1/preview
//   2. WITS World Bank SDMX        — wits.worldbank.org
//   3. TRADESTAT / DGCI&S          — tradestat.commerce.gov.in (form POST)
//   4. MPEDA FishEx stats          — mpeda.gov.in
//
// Query params:
//   years   — comma-separated 4-digit years  (default: last 2 complete years)
//   sources — comma-separated source names   (default: all)
//             values: comtrade | wits | tradestat | mpeda
// ═══════════════════════════════════════════════════════════════════════════

// ── HS registry ──────────────────────────────────────────────────────────────
// ct6: 6-digit code used by Comtrade/WITS (international databases)
// itc8: full ITC-HS 8-digit code used on all Indian portals
const HS = {
  '03073910': { label: 'Clams & Clam Meat (Villorita/Meretrix/Katelysia)', short: 'Clam Meat',    group: 'CLAM',    priority: 'PRIMARY', ct6: '030739' },
  '030771':   { label: 'Clams, Live/Fresh/Chilled',                         short: 'Clams-Live',  group: 'CLAM',    priority: 'HIGH',    ct6: '030771' },
  '030772':   { label: 'Clams, Frozen (in/out shell)',                      short: 'Clams-Frozen',group: 'CLAM',    priority: 'HIGH',    ct6: '030772' },
  '030779':   { label: 'Clams, Dried/Salted/Smoked',                        short: 'Clams-Dried', group: 'CLAM',    priority: 'HIGH',    ct6: '030779' },
  '030791':   { label: 'Molluscs n.e.s., Live/Fresh',                       short: 'Molluscs',    group: 'CLAM',    priority: 'MEDIUM',  ct6: '030791' },
  '160556':   { label: 'Clams, Prepared/Preserved',                         short: 'Clams-Prep',  group: 'CLAM',    priority: 'HIGH',    ct6: '160556' },
  '282510':   { label: 'Calcium Oxide (CaO/Quicklime)',                     short: 'CaO',         group: 'CALCIUM', priority: 'HIGH',    ct6: '282510' },
  '283526':   { label: 'Calcium Phosphates (DCP/TCP/HAp)',                  short: 'CaPO4',       group: 'CALCIUM', priority: 'HIGH',    ct6: '283526' },
  '283650':   { label: 'Calcium Carbonate (CaCO3/GCC)',                     short: 'CaCO3',       group: 'CALCIUM', priority: 'HIGH',    ct6: '283650' },
  '291811':   { label: 'Lactic Acid & Salts (Ca-Lactate)',                  short: 'Ca-Lactate',  group: 'CALCIUM', priority: 'MEDIUM',  ct6: '291811' },
};

const INDIA_M49   = '356';   // UN M49 code for India (Comtrade)
const INDIA_ISO3  = 'IND';   // ISO3 for India (WITS)
const CALL_TIMEOUT = 9000;   // ms per individual HTTP call

const REQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Utilities ──────────────────────────────────────────────────────────────
function withTimeout(promise, ms = CALL_TIMEOUT) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  return Promise.race([promise, t]);
}

function toFloat(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function nowISO() {
  return new Date().toISOString();
}

/** Naive HTML table extractor — no DOM library needed */
function extractHtmlTables(html) {
  const tables = [];
  const tableRx = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRx.exec(html)) !== null) {
    const rows = [];
    const rowRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRx.exec(tm[1])) !== null) {
      const cells = [];
      const cellRx = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cellRx.exec(rm[1])) !== null) {
        const text = cm[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(text);
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length > 1) tables.push(rows);
  }
  return tables;
}

// ── SOURCE 1: UN Comtrade public preview ──────────────────────────────────
// Free, no API key. Groups all 10 HS codes into 2 calls (one per year).
// Returns FOB USD values, partner-level breakdown.
async function fetchComtrade(years) {
  const BASE = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
  const records = [];
  const errors  = [];

  // Use unique 6-digit codes (03073910 → 030739, rest already 6-digit)
  const uniqueCt6 = [...new Set(Object.values(HS).map(m => m.ct6))];
  const cmdCode   = uniqueCt6.join(',');

  for (const year of years) {
    const url = `${BASE}?reporterCode=${INDIA_M49}&cmdCode=${cmdCode}&flowCode=X&period=${year}&includeDesc=true`;
    try {
      const resp = await withTimeout(fetch(url, { headers: REQ_HEADERS }));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      for (const row of (json.data || [])) {
        const partner = (row.partnerDesc || row.partner2Desc || '').toUpperCase().trim();
        if (!partner || ['WORLD', '0', 'ALL'].includes(partner)) continue;

        // Map ct6 back to ITC-HS code (03073910 for 030739, others are identical)
        const ct6Reported = String(row.cmdCode || '').padStart(6, '0');
        const hsCode = Object.keys(HS).find(k => HS[k].ct6 === ct6Reported
          || k === ct6Reported) || ct6Reported;
        const meta = HS[hsCode] || { label: ct6Reported, group: 'UNKNOWN', priority: 'MEDIUM' };

        // Preferred quantity: netWeightKg, else altQty in KGM
        let qty = toFloat(row.netWeightKg);
        if (!qty && row.altQtyUnitAbbr in ['KGM','KG']) qty = toFloat(row.altQty);

        const valUsd  = toFloat(row.primaryValue || row.TradeValue);
        records.push({
          source:       'COMTRADE',
          hs_code:      hsCode,
          product:      meta.label,
          country:      partner,
          qty_kgs:      qty,
          value_inr_cr: null,
          value_usd_mn: valUsd ? valUsd / 1_000_000 : null,
          usd_per_kg:   (qty && valUsd) ? valUsd / qty : null,
          usd_per_mt:   (qty && valUsd) ? (valUsd / qty) * 1000 : null,
          period:       String(year),
          type:         'EXPORT',
          group:        meta.group,
          priority:     meta.priority,
          notes:        '',
          scraped_at:   nowISO(),
        });
      }
    } catch (e) {
      errors.push(`COMTRADE/${year}: ${e.message}`);
    }
  }
  return { records, errors, source: 'COMTRADE' };
}

// ── SOURCE 2: WITS World Bank (SDMX REST) ────────────────────────────────
// Free, no key. Annual data. Returns export values.
// XPRT-VAL = export value (USD). Called per HS code per year in parallel.
async function fetchWITS(years) {
  const BASE = 'https://wits.worldbank.org/API/V1/SDMX/V21/datasource/tradestats-trade';
  const records = [];
  const errors  = [];

  const tasks = [];
  for (const [itcCode, meta] of Object.entries(HS)) {
    for (const year of years) {
      tasks.push({ itcCode, meta, year, ct6: meta.ct6 });
    }
  }

  // Run in parallel (WITS is stateless, handles concurrent well)
  const results = await Promise.allSettled(
    tasks.map(async ({ itcCode, meta, year, ct6 }) => {
      const url = `${BASE}/reporter/${INDIA_ISO3}/year/${year}/partner/ALL/product/${ct6}/indicator/XPRT-VAL`;
      const resp = await withTimeout(fetch(url, { headers: { ...REQ_HEADERS, Accept: 'application/xml' } }));
      if (resp.status === 404) return []; // no data for this period
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xml = await resp.text();
      return parseWitsSDMX(xml, itcCode, meta, year);
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      records.push(...r.value);
    } else {
      const t = tasks[i];
      errors.push(`WITS/${t.ct6}/${t.year}: ${r.reason?.message || 'failed'}`);
    }
  }
  return { records, errors, source: 'WITS' };
}

function parseWitsSDMX(xml, itcCode, meta, year) {
  const records = [];
  // Extract <generic:Value id="PARTNER" value="CHN"/>
  // and <generic:ObsValue value="1234567"/>
  const seriesRx = /<(?:\w+:)?Series[^>]*>([\s\S]*?)<\/(?:\w+:)?Series>/gi;
  let sm;
  while ((sm = seriesRx.exec(xml)) !== null) {
    const block = sm[1];

    // Partner
    const partnerM = block.match(/id=["']PARTNER["']\s+value=["']([^"']+)["']/i)
                  || block.match(/value=["']([A-Z]{3})["']/i);
    const partner = (partnerM ? partnerM[1] : '').toUpperCase().trim();
    if (!partner || partner === 'WLD' || partner === '000') continue;

    // Observation value (USD)
    const obsM = block.match(/ObsValue[^>]+value=["']([^"']+)["']/i);
    const valUsd = obsM ? toFloat(obsM[1]) : null;
    if (!valUsd) continue;

    records.push({
      source:       'WITS',
      hs_code:      itcCode,
      product:      meta.label,
      country:      partner,
      qty_kgs:      null,
      value_inr_cr: null,
      value_usd_mn: valUsd / 1_000_000,
      usd_per_kg:   null,
      usd_per_mt:   null,
      period:       String(year),
      type:         'EXPORT',
      group:        meta.group,
      priority:     meta.priority,
      notes:        '',
      scraped_at:   nowISO(),
    });
  }
  return records;
}

// ── SOURCE 3: TRADESTAT / DGCI&S ─────────────────────────────────────────
// Indian government portal. Form POST + HTML table parse.
// Uses full 8-digit ITC-HS for 03073910 (critical — 6-digit loses precision).
// Returns ₹ values.
async function fetchTradestat(years) {
  const BASE = 'https://tradestat.commerce.gov.in/meidb/cntcomq.asp';
  const records = [];
  const errors  = [];

  for (const [itcCode, meta] of Object.entries(HS)) {
    for (const year of years) {
      try {
        const body = new URLSearchParams({
          hs_code: itcCode,   // full ITC-HS — 03073910 for primary, 6-digit for rest
          SelectYear: String(year),
          btn_go: 'GO',
        });
        const resp = await withTimeout(fetch(BASE, {
          method: 'POST',
          headers: { ...REQ_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        const parsed = parseTradestatHTML(html, itcCode, meta, year);
        records.push(...parsed);
      } catch (e) {
        errors.push(`TRADESTAT/${itcCode}/${year}: ${e.message}`);
      }
    }
  }
  return { records, errors, source: 'TRADESTAT' };
}

function parseTradestatHTML(html, itcCode, meta, year) {
  const tables = extractHtmlTables(html);
  const records = [];

  for (const rows of tables) {
    if (rows.length < 2) continue;
    const headers = rows[0].map(h => h.toLowerCase());
    const hasCountry = headers.some(h => h.includes('country') || h.includes('destination'));
    const hasValue   = headers.some(h => h.includes('value') || h.includes('amount'));
    if (!hasCountry || !hasValue) continue;

    const idxCountry = headers.findIndex(h => h.includes('country') || h.includes('destination'));
    const idxQty     = headers.findIndex(h => h.includes('quant') || h.includes('qty'));
    const idxValInr  = headers.findIndex(h => (h.includes('value') || h.includes('amount')) && !h.includes('usd') && !h.includes('$'));
    const idxValUsd  = headers.findIndex(h => h.includes('usd') || h.includes('$'));

    for (const row of rows.slice(1)) {
      const country = row[idxCountry]?.toUpperCase().trim();
      if (!country || ['TOTAL', 'GRAND TOTAL', 'S.NO', ''].includes(country)) continue;

      const rawQty   = idxQty >= 0     ? row[idxQty]     : null;
      const rawInr   = idxValInr >= 0  ? row[idxValInr]  : null;
      const rawUsd   = idxValUsd >= 0  ? row[idxValUsd]  : null;
      const qty      = toFloat(rawQty);

      // TRADESTAT reports in ₹ Lakhs — convert to Crores (÷ 100)
      let valInrCr = toFloat(rawInr);
      if (valInrCr && headers[idxValInr]?.includes('lakh')) valInrCr /= 100;

      const valUsdMn = toFloat(rawUsd);

      records.push({
        source:       'TRADESTAT',
        hs_code:      itcCode,
        product:      meta.label,
        country,
        qty_kgs:      qty,
        value_inr_cr: valInrCr,
        value_usd_mn: valUsdMn,
        usd_per_kg:   (qty && valUsdMn) ? (valUsdMn * 1_000_000) / qty : null,
        usd_per_mt:   (qty && valUsdMn) ? (valUsdMn * 1_000_000_000) / qty : null,
        period:       String(year),
        type:         'EXPORT',
        group:        meta.group,
        priority:     meta.priority,
        notes:        '',
        scraped_at:   nowISO(),
      });
    }
  }
  return records;
}

// ── SOURCE 4: MPEDA FishEx ────────────────────────────────────────────────
// Marine Products Export Development Authority — clam/seafood specific.
// Maps to primary code 03073910 and clam group.
async function fetchMpeda(years) {
  const records = [];
  const errors  = [];

  const urls = [
    'https://mpeda.gov.in/MPEDA/marine_export_st.php',
    'https://mpeda.gov.in/?page_id=439',
  ];

  for (const url of urls) {
    try {
      const resp = await withTimeout(fetch(url, { headers: REQ_HEADERS }));
      if (!resp.ok) { errors.push(`MPEDA: HTTP ${resp.status} — ${url}`); continue; }
      const html = await resp.text();
      const parsed = parseMpedaHTML(html, Math.max(...years));
      records.push(...parsed);
      if (records.length > 0) break; // stop once we have data
    } catch (e) {
      errors.push(`MPEDA: ${e.message}`);
    }
  }
  return { records, errors, source: 'MPEDA' };
}

function parseMpedaHTML(html, latestYear) {
  const tables = extractHtmlTables(html);
  const records = [];

  for (const rows of tables) {
    if (rows.length < 2) continue;
    const headers = rows[0].map(h => h.toLowerCase());
    const hasCountry = headers.some(h => h.includes('country') || h.includes('destination'));
    if (!hasCountry) continue;

    const idxCountry = headers.findIndex(h => h.includes('country') || h.includes('destination'));
    const idxQtyMt   = headers.findIndex(h => (h.includes('quant') || h.includes('qty')) && h.includes('mt'));
    const idxQty     = idxQtyMt >= 0 ? idxQtyMt : headers.findIndex(h => h.includes('quant') || h.includes('qty'));
    const idxUsd     = headers.findIndex(h => h.includes('usd') || h.includes('$') || h.includes('dollar'));
    const idxInr     = headers.findIndex(h => (h.includes('rs') || h.includes('inr') || h.includes('crore') || h.includes('value')) && !h.includes('usd'));

    for (const row of rows.slice(1)) {
      const country = row[idxCountry]?.toUpperCase().trim();
      if (!country || ['TOTAL', 'GRAND TOTAL', ''].includes(country)) continue;

      const rawQty  = idxQty >= 0  ? row[idxQty]  : null;
      const rawUsd  = idxUsd >= 0  ? row[idxUsd]  : null;
      const rawInr  = idxInr >= 0  ? row[idxInr]  : null;
      // MPEDA reports quantity in MT → convert to KGS
      const qtyMt   = toFloat(rawQty);
      const qtyKgs  = qtyMt ? qtyMt * 1_000 : null;
      const valUsd  = toFloat(rawUsd);
      const valInr  = toFloat(rawInr);

      records.push({
        source:       'MPEDA',
        hs_code:      '03073910',
        product:      'Marine Products — Clam (MPEDA)',
        country,
        qty_kgs:      qtyKgs,
        value_inr_cr: valInr,
        value_usd_mn: valUsd ? valUsd / 1_000_000 : null,
        usd_per_kg:   (qtyKgs && valUsd) ? valUsd / qtyKgs : null,
        usd_per_mt:   (qtyKgs && valUsd) ? (valUsd / qtyKgs) * 1000 : null,
        period:       `FY ${latestYear}-${String(latestYear + 1).slice(2)}`,
        type:         'EXPORT',
        group:        'CLAM',
        priority:     'PRIMARY',
        notes:        'MPEDA — species: Villorita cyprinoides (Kakka) + Meretrix + Katelysia',
        scraped_at:   nowISO(),
      });
    }
  }
  return records;
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const startMs = Date.now();
  const now = new Date();

  // Parse query params
  const q = req.query || {};

  const years = q.years
    ? q.years.split(',').map(Number).filter(n => n > 2000 && n <= now.getFullYear())
    : [now.getFullYear() - 1, now.getFullYear() - 2];

  const requestedSources = q.sources
    ? q.sources.toLowerCase().split(',')
    : ['comtrade', 'wits', 'tradestat', 'mpeda'];

  // Fire all requested sources in parallel
  const jobs = [];
  if (requestedSources.includes('comtrade'))  jobs.push(fetchComtrade(years));
  if (requestedSources.includes('wits'))       jobs.push(fetchWITS(years));
  if (requestedSources.includes('tradestat'))  jobs.push(fetchTradestat(years));
  if (requestedSources.includes('mpeda'))      jobs.push(fetchMpeda(years));

  const settled = await Promise.allSettled(jobs);

  const allRecords = [];
  const sourceMeta = [];
  const allErrors  = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const { records, errors, source } = result.value;
      allRecords.push(...records);
      allErrors.push(...(errors || []));
      sourceMeta.push({ source, count: records.length, errors: errors?.length || 0 });
    } else {
      allErrors.push(`Source failed: ${result.reason?.message}`);
    }
  }

  // Sort: primary code first, then by group, then by value desc
  allRecords.sort((a, b) => {
    if (a.hs_code === '03073910' && b.hs_code !== '03073910') return -1;
    if (b.hs_code === '03073910' && a.hs_code !== '03073910') return 1;
    const av = a.value_usd_mn ?? 0;
    const bv = b.value_usd_mn ?? 0;
    return bv - av;
  });

  return res.status(200).json({
    records: allRecords,
    meta: {
      total:         allRecords.length,
      years,
      sources:       sourceMeta,
      errors:        allErrors,
      duration_ms:   Date.now() - startMs,
      timestamp:     nowISO(),
      primary_code:  '03073910',
      primary_desc:  'Kakka / Indian Black Clam — Villorita cyprinoides · Meretrix meretrix · Katelysia spp.',
    },
  });
}
