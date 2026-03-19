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

// ── SOURCE 1: UN Comtrade public preview ─────────────────────────────────
// Free, no API key. 500-row limit per call — one call per (code, year).
// India (M49=356) annual export data is reliably present for 2020-2023.
// Annual data lags 18-24 months: 2024 data may not be published until 2025-26.
async function fetchComtrade(years) {
  const BASE = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
  const records = [];
  const errors  = [];

  // Build one task per (HS code, year) — batching all codes together risks
  // hitting the 500-row cap and silently dropping partners.
  const tasks = [];
  for (const [itcCode, meta] of Object.entries(HS)) {
    for (const year of years) {
      tasks.push({ itcCode, meta, year, ct6: meta.ct6 });
    }
  }

  // Run in small parallel batches to avoid rate-limiting.
  const BATCH = 4;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async ({ itcCode, meta, year, ct6 }) => {
        // Do NOT add includeDesc=true — not supported by public preview.
        const url = `${BASE}?reporterCode=${INDIA_M49}&cmdCode=${ct6}&flowCode=X&period=${year}`;
        const resp = await withTimeout(
          fetch(url, { headers: REQ_HEADERS }), 12000
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status} — ${body.slice(0, 100)}`);
        }
        const json = await resp.json();
        const dataRows = json.data || json.dataset || [];
        if (dataRows.length === 0) {
          // Not an error — data may not yet be published for this year.
          return { rows: [], ct6, year, empty: true };
        }
        return { rows: parseComtradeRows(dataRows, itcCode, meta, year), ct6, year, empty: false };
      })
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      const t = batch[j];
      if (r.status === 'fulfilled') {
        records.push(...r.value.rows);
        if (r.value.empty) {
          errors.push(`COMTRADE/${t.ct6}/${t.year}: 0 rows — annual data may not be published yet (Comtrade lags 18-24 months)`);
        }
      } else {
        errors.push(`COMTRADE/${t.ct6}/${t.year}: ${r.reason?.message}`);
      }
    }
  }
  return { records, errors, source: 'COMTRADE' };
}

function parseComtradeRows(dataRows, itcCode, meta, year) {
  const out = [];
  for (const row of dataRows) {
    // Skip world/aggregate rows
    const partnerCode = String(row.partnerCode ?? row.partner2Code ?? '');
    const partner     = (row.partnerDesc || row.partner2Desc || '').toUpperCase().trim();
    if (partnerCode === '0' || !partner ||
        ['WORLD','ALL','AREAS NES','NOT SPECIFIED'].includes(partner)) continue;

    const qty    = toFloat(row.netWeightKg ?? row.altQty);
    const valUsd = toFloat(row.primaryValue ?? row.TradeValue ?? row.fobvalue);

    out.push({
      source:       'COMTRADE',
      hs_code:      itcCode,
      product:      meta.label,
      country:      partner,
      qty_kgs:      qty,
      value_inr_cr: null,
      value_usd_mn: valUsd != null ? valUsd / 1_000_000 : null,
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
  return out;
}

// ── SOURCE 2: WITS World Bank ─────────────────────────────────────────────
// World Bank trade stats — two URL strategies tried in order:
//   1. WITS REST JSON  (newer endpoint, returns JSON directly)
//   2. WITS SDMX XML   (original endpoint, parsed with regex)
// Data lags similar to Comtrade. Latest reliable: 2021-2023.
async function fetchWITS(years) {
  const records = [];
  const errors  = [];

  const tasks = [];
  for (const [itcCode, meta] of Object.entries(HS)) {
    for (const year of years) {
      tasks.push({ itcCode, meta, year, ct6: meta.ct6 });
    }
  }

  const BATCH = 4;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async ({ itcCode, meta, year, ct6 }) => {
        // Strategy 1: WITS REST JSON endpoint
        const jsonUrl = `https://wits.worldbank.org/API/V1/wits/datasource/tradestats-trade` +
          `/reporter/${INDIA_ISO3}/year/${year}/partner/ALL/product/${ct6}/indicator/XPRT-VAL/?format=json`;
        let resp = await withTimeout(
          fetch(jsonUrl, { headers: { ...REQ_HEADERS, Accept: 'application/json' } }), 12000
        ).catch(() => null);

        if (resp && resp.ok) {
          const json = await resp.json().catch(() => null);
          if (json) return parseWitsJSON(json, itcCode, meta, year);
        }

        // Strategy 2: WITS SDMX XML fallback
        const sdmxUrl = `https://wits.worldbank.org/API/V1/SDMX/V21/datasource/tradestats-trade` +
          `/reporter/${INDIA_ISO3}/year/${year}/partner/ALL/product/${ct6}/indicator/XPRT-VAL`;
        resp = await withTimeout(
          fetch(sdmxUrl, { headers: { ...REQ_HEADERS, Accept: 'application/xml' } }), 12000
        );
        if (resp.status === 404 || resp.status === 204) return [];
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status} — ${body.slice(0, 80)}`);
        }
        const xml = await resp.text();
        return parseWitsSDMX(xml, itcCode, meta, year);
      })
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      const t = batch[j];
      if (r.status === 'fulfilled') records.push(...r.value);
      else errors.push(`WITS/${t.ct6}/${t.year}: ${r.reason?.message || 'failed'}`);
    }
  }
  return { records, errors, source: 'WITS' };
}

function parseWitsJSON(json, itcCode, meta, year) {
  // WITS JSON response: { TradeStats: { trade: [ {TradeFlow,Reporter,Partner,ProductCode,Year,TradeValue}, ... ] } }
  const trades = json?.TradeStats?.trade || json?.data || [];
  if (!Array.isArray(trades)) return [];
  return trades.flatMap(t => {
    const partner = (t.Partner || t.partner || '').toUpperCase().trim();
    if (!partner || ['WLD','ALL','000','WORLD'].includes(partner)) return [];
    const valRaw = t.TradeValue ?? t.tradeValue ?? t.value;
    const valUsd = toFloat(valRaw);
    if (!valUsd) return [];
    return [{
      source: 'WITS', hs_code: itcCode, product: meta.label,
      country: partner, qty_kgs: null, value_inr_cr: null,
      value_usd_mn: valUsd / 1_000_000, usd_per_kg: null, usd_per_mt: null,
      period: String(year), type: 'EXPORT', group: meta.group,
      priority: meta.priority, notes: '', scraped_at: nowISO(),
    }];
  });
}

function parseWitsSDMX(xml, itcCode, meta, year) {
  const records = [];
  const seriesRx = /<(?:\w+:)?Series[^>]*>([\s\S]*?)<\/(?:\w+:)?Series>/gi;
  let sm;
  while ((sm = seriesRx.exec(xml)) !== null) {
    const block = sm[1];
    const partnerM = block.match(/id=["']PARTNER["']\s+value=["']([^"']+)["']/i);
    const partner = (partnerM ? partnerM[1] : '').toUpperCase().trim();
    if (!partner || ['WLD','000','ALL','WORLD'].includes(partner)) continue;
    const obsM = block.match(/ObsValue[^>]+value=["']([^"']+)["']/i);
    const valUsd = obsM ? toFloat(obsM[1]) : null;
    if (!valUsd) continue;
    records.push({
      source: 'WITS', hs_code: itcCode, product: meta.label,
      country: partner, qty_kgs: null, value_inr_cr: null,
      value_usd_mn: valUsd / 1_000_000, usd_per_kg: null, usd_per_mt: null,
      period: String(year), type: 'EXPORT', group: meta.group,
      priority: meta.priority, notes: '', scraped_at: nowISO(),
    });
  }
  return records;
}

// ── SOURCE 3: TRADESTAT / DGCI&S ─────────────────────────────────────────
// Indian government portal. Form POST + HTML table parse.
// NOTE: This source often returns errors from cloud/serverless environments
// because govt sites (NIC-hosted) block AWS/GCP/Vercel egress IPs.
// Errors here are expected and non-fatal.
async function fetchTradestat(years) {
  // Try both known URLs — the site occasionally migrates
  const URLS = [
    'https://tradestat.commerce.gov.in/meidb/comqr.asp',
    'https://tradestat.commerce.gov.in/eidb/comqr.asp',
    'https://tradestat.commerce.gov.in/meidb/cntcomq.asp',
  ];
  const records = [];
  const errors  = [];

  for (const [itcCode, meta] of Object.entries(HS)) {
    for (const year of years) {
      let fetched = false;
      for (const BASE of URLS) {
        if (fetched) break;
        try {
          // Try GET params first (some TRADESTAT pages accept GET)
          const getUrl = `${BASE}?hs_code=${itcCode}&SelectYear=${year}&type=E&hscode=${itcCode}`;
          let resp = await withTimeout(
            fetch(getUrl, { headers: { ...REQ_HEADERS, 'Referer': 'https://tradestat.commerce.gov.in/' } }), 8000
          ).catch(() => null);

          // Fallback to POST
          if (!resp || !resp.ok) {
            const body = new URLSearchParams({
              hs_code: itcCode,
              hscode: itcCode,
              SelectYear: String(year),
              type: 'E',
              btn_go: 'GO',
            });
            resp = await withTimeout(
              fetch(BASE, {
                method: 'POST',
                headers: { ...REQ_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded',
                           'Referer': 'https://tradestat.commerce.gov.in/' },
                body: body.toString(),
              }), 8000
            );
          }

          if (!resp || !resp.ok) {
            throw new Error(`HTTP ${resp?.status ?? 'no response'}`);
          }
          const html = await resp.text();
          // Check if we got an actual data page (not a redirect or error page)
          if (html.includes('Access Denied') || html.includes('403') || html.length < 500) {
            throw new Error(`Blocked or empty response (${html.length} bytes)`);
          }
          const parsed = parseTradestatHTML(html, itcCode, meta, year);
          records.push(...parsed);
          fetched = true;
        } catch (e) {
          if (BASE === URLS[URLS.length - 1]) {
            errors.push(`TRADESTAT/${itcCode}/${year}: ${e.message} (govt site may block cloud IPs)`);
          }
        }
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
  const now     = new Date();
  const curYear = now.getFullYear();

  // ── Year validation ──────────────────────────────────────────────────────
  // Trade databases (Comtrade, WITS) lag 18-24 months.
  // Annual data is reliably published ~2 years after the reference year.
  //   March 2026 → latest reliable annual data = 2023 (maybe 2024).
  // If the user requests years that are too recent, we warn and cap them.
  const MAX_SAFE_YEAR = curYear - 2;  // e.g. 2024 when current = 2026
  const q = req.query || {};

  const requestedYears = q.years
    ? q.years.split(',').map(Number).filter(n => n > 2010 && n <= curYear)
    : [MAX_SAFE_YEAR - 1, MAX_SAFE_YEAR];  // default: e.g. 2023, 2024

  // Separate safe years (likely have data) from future/very recent years
  const safeYears   = requestedYears.filter(y => y <= MAX_SAFE_YEAR);
  const futureYears = requestedYears.filter(y => y > MAX_SAFE_YEAR);

  // Always run with at least the last 2 safe years
  const years = safeYears.length > 0
    ? safeYears
    : [MAX_SAFE_YEAR - 1, MAX_SAFE_YEAR];

  const yearWarnings = futureYears.length > 0
    ? [`Years ${futureYears.join(', ')} skipped — Comtrade/WITS annual data is not yet published for years within 24 months of today. Latest safe year: ${MAX_SAFE_YEAR}.`]
    : [];

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
      errors:        [...yearWarnings, ...allErrors],
      year_warnings: yearWarnings,
      duration_ms:   Date.now() - startMs,
      timestamp:     nowISO(),
      primary_code:  '03073910',
      primary_desc:  'Kakka / Indian Black Clam — Villorita cyprinoides · Meretrix meretrix · Katelysia spp.',
    },
  });
}
