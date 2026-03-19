import { useCallback, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { fetchComtradeData, fetchMonthlyData } from '../services/api';
import { saveTradeSnapshot, getLatestTradeSnapshot } from '../services/db';
import { HS_CODES, HS_CODE_LIST, TREND_CODES } from '../config/hsCodes';
import { COUNTRIES, IMPORT_MARKETS } from '../config/countries';
import { fmtUSD, fmtPrice, fmtMT, fmtUSDShort } from '../utils/formatters';
import DataTable from '../components/DataTable';

// ── Helper: generate YYYYMM period strings ──────────────────
function monthPeriods(startYear, endYear) {
  const periods = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      periods.push(`${y}${String(m).padStart(2, '0')}`);
    }
  }
  return periods;
}

// ── Sparkline mini-chart component ──────────────────────────
function Sparkline({ data, color, height = 40, width = '100%' }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const pts = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * 100;
    const y = height - (d.value / max) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const areaPath = `M0,${height} L${pts.map((p) => p).join(' L')} L100,${height} Z`;
  const linePath = `M${pts.join(' L')}`;

  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width, height }} className="block">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#grad-${color.replace('#', '')})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Format price per unit with $/MT and $/kg
function PriceCell({ value, weight, color }) {
  if (!value || !weight || weight <= 0) return <span className="text-slate-600">—</span>;
  const perMT = value / (weight / 1000);
  const perKg = perMT / 1000;
  return (
    <div>
      <span className="font-mono font-semibold" style={{ color }}>{fmtPrice(perMT)}/MT</span>
      <div className="text-[9px] text-slate-500 font-mono">${perKg.toFixed(2)}/kg</div>
    </div>
  );
}

// Split rows by unit price threshold (e.g. HAp vs bulk DCP)
function splitRows(rows, thresholdPerKg) {
  const high = [];
  const low = [];
  for (const r of rows) {
    if (r.weight > 0 && r.value / r.weight >= thresholdPerKg) {
      high.push(r);
    } else {
      low.push(r);
    }
  }
  return { high, low };
}

export default function TradeFlows() {
  const { tradeData, setTradeData, loading, setLoading, addLog } = useApp();
  const [fetchMode, setFetchMode] = useState('full');
  const [apiTier, setApiTier] = useState(null);
  const [dataYear, setDataYear] = useState(null); // detected latest year
  const [selectedMarkets, setSelectedMarkets] = useState(
    IMPORT_MARKETS.map((m) => m.code)
  );

  useEffect(() => {
    if (!tradeData) {
      getLatestTradeSnapshot().then((cached) => {
        if (cached) {
          setTradeData(cached);
          addLog('Loaded cached trade data from IndexedDB', 'info');
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMarket = (code) => {
    setSelectedMarkets((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const fetchData = useCallback(async () => {
    if (selectedMarkets.length === 0) {
      addLog('Select at least one import market', 'error');
      return;
    }

    setLoading((p) => ({ ...p, trade: true }));
    addLog('Detecting latest available data year...', 'info');

    const results = { markets: {}, in_: {}, ts: {}, monthly: {} };
    const delay = 1500;
    let detectedTier = null;

    // ── AUTO-DETECT latest available year ──
    // Probe from current year backwards until we find data
    const currentYear = new Date().getFullYear();
    const probeCode = HS_CODE_LIST[0]; // use first HS code to detect
    let bestYear = '2023'; // safe fallback
    for (let yr = currentYear; yr >= currentYear - 3; yr--) {
      try {
        addLog(`  Probing ${yr}...`, 'info');
        const probe = await fetchComtradeData('156', probeCode, 'M', null, String(yr));
        const hasData = probe.some((r) => r.partnerCode !== 0 && r.primaryValue > 0);
        if (hasData) {
          bestYear = String(yr);
          addLog(`  ✓ Found data for ${yr}!`, 'success');
          break;
        }
        addLog(`  ${yr}: no data yet`, 'info');
      } catch {
        addLog(`  ${yr}: unavailable`, 'info');
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    setDataYear(bestYear);
    results.dataYear = bestYear;
    addLog(`Using ${bestYear} as latest available year`, 'success');

    // ── Fetch imports for ALL selected markets ──
    for (const market of IMPORT_MARKETS.filter((m) => selectedMarkets.includes(m.code))) {
      results.markets[market.code] = {};
      addLog(`${market.flag} ${market.name} imports (${bestYear})...`, 'info');

      for (const code of HS_CODE_LIST) {
        const hs = HS_CODES[code];
        try {
          const d = await fetchComtradeData(market.code, code, 'M', null, bestYear);
          if (!detectedTier && d._tier) detectedTier = d._tier;
          results.markets[market.code][code] = d
            .filter((r) => r.partnerCode !== 0 && r.primaryValue > 0)
            .sort((a, b) => b.primaryValue - a.primaryValue)
            .slice(0, 15)
            .map((r) => ({
              partner: r.partnerDesc || COUNTRIES[String(r.partnerCode)] || r.partnerCode,
              partnerCode: String(r.partnerCode),
              value: r.primaryValue,
              weight: r.netWgt,
              qty: r.qty,
              unitPrice: r.netWgt > 0 ? r.primaryValue / (r.netWgt / 1000) : null,
              pricePerKg: r.netWgt > 0 ? r.primaryValue / r.netWgt : null,
            }));
        } catch (err) {
          if (err.message.includes('429')) {
            addLog(`  ⚠ Rate limited — pausing...`, 'warn');
            await new Promise((r) => setTimeout(r, 5000));
          }
          results.markets[market.code][code] = [];
        }
        await new Promise((r) => setTimeout(r, delay));
      }

      const totalVal = Object.values(results.markets[market.code])
        .flat()
        .reduce((s, r) => s + (r.value || 0), 0);
      const productCount = Object.values(results.markets[market.code])
        .filter((rows) => rows.length > 0).length;
      addLog(`  ${market.flag} ${market.name}: ${productCount} products, ${fmtUSDShort(totalVal)}`, 'success');
    }

    // ── India exports ──
    addLog(`🇮🇳 India exports (${bestYear})...`, 'info');
    for (const code of HS_CODE_LIST) {
      try {
        const d2 = await fetchComtradeData('699', code, 'X', null, bestYear);
        results.in_[code] = d2
          .filter((r) => r.partnerCode !== 0 && r.primaryValue > 0)
          .sort((a, b) => b.primaryValue - a.primaryValue)
          .slice(0, 15)
          .map((r) => ({
            partner: r.partnerDesc || COUNTRIES[String(r.partnerCode)] || r.partnerCode,
            value: r.primaryValue,
            weight: r.netWgt,
            unitPrice: r.netWgt > 0 ? r.primaryValue / (r.netWgt / 1000) : null,
            pricePerKg: r.netWgt > 0 ? r.primaryValue / r.netWgt : null,
          }));
        if (results.in_[code].length > 0) {
          addLog(`  ${HS_CODES[code].shortName}: ${results.in_[code].length} destinations`, 'success');
        }
      } catch {
        results.in_[code] = [];
      }
      await new Promise((r) => setTimeout(r, delay));
    }

    // ── Annual trends (China baseline) ──
    if (TREND_CODES.length > 0) {
      const trendEnd = parseInt(bestYear);
      const trendStart = trendEnd - 5;
      const trendYears = [];
      for (let y = trendStart; y <= trendEnd; y++) trendYears.push(String(y));
      addLog(`📈 Annual trends (${trendStart}–${trendEnd})...`, 'info');
      for (const code of TREND_CODES) {
        results.ts[code] = {};
        try {
          const t = await fetchComtradeData('156', code, 'M', '0', trendYears.join(','));
          for (const yr of trendYears) {
            const match = t.find((r) => String(r.period) === yr);
            results.ts[code][yr] = { value: match?.primaryValue || 0, weight: match?.netWgt || 0 };
          }
          addLog(`  ${HS_CODES[code].shortName}: loaded`, 'success');
        } catch {
          for (const yr of trendYears) {
            results.ts[code][yr] = { value: 0, weight: 0 };
          }
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // ── Monthly granular (latest 24 months) ──
    if (fetchMode === 'full' && TREND_CODES.length > 0) {
      const byInt = parseInt(bestYear);
      const monthYr1 = byInt - 1;
      const monthYr2 = byInt;
      addLog(`📊 Monthly detail (${monthYr1}–${monthYr2})...`, 'info');
      for (const code of TREND_CODES) {
        try {
          const months1 = monthPeriods(monthYr1, monthYr1);
          const months2 = monthPeriods(monthYr2, monthYr2);
          const m1 = await fetchMonthlyData('156', code, 'M', months1.join(','), '0');
          await new Promise((r) => setTimeout(r, delay));
          const m2 = await fetchMonthlyData('156', code, 'M', months2.join(','), '0');
          const allMonthly = [...m1, ...m2];
          const allPeriods = [...months1, ...months2];
          results.monthly[code] = allPeriods.map((p) => {
            const match = allMonthly.find((r) => String(r.period) === p);
            return { period: p, label: `${p.slice(0, 4)}-${p.slice(4)}`, value: match?.primaryValue || 0, weight: match?.netWgt || 0 };
          });
          const withData = results.monthly[code].filter((x) => x.value > 0).length;
          if (withData > 0) addLog(`  ${HS_CODES[code].shortName}: ${withData} months`, 'success');
        } catch {
          results.monthly[code] = [];
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    setApiTier(detectedTier);
    setTradeData(results);
    await saveTradeSnapshot(results);
    setLoading((p) => ({ ...p, trade: false }));
    addLog('Trade flow data collection complete!', 'success');
  }, [addLog, setLoading, setTradeData, fetchMode, selectedMarkets]);

  // ── Table columns: Suppliers into a market ──
  const makeColumns = (hs, total) => [
    { key: '#', label: '#', render: (_, i) => <span className="text-slate-500">{i + 1}</span> },
    {
      key: 'partner', label: 'Supplier (Exporter)',
      render: (r) => {
        const isIndia = r.partner === 'India' || r.partnerCode === '699';
        return (
          <span className={`font-medium ${isIndia ? 'text-amber-500' : 'text-slate-200'}`}>
            {r.partner}{isIndia && ' ★'}
          </span>
        );
      },
    },
    { key: 'value', label: 'Value (USD)', className: 'font-mono', render: (r) => fmtUSD(r.value) },
    { key: 'weight', label: 'Net Weight', className: 'font-mono', render: (r) => r.weight ? fmtMT(r.weight) : '—' },
    {
      key: 'unitPrice', label: '$/MT · $/kg',
      render: (r) => <PriceCell value={r.value} weight={r.weight} color={hs.color} />,
    },
    {
      key: 'share', label: 'Share',
      render: (r) => {
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <div className="flex items-center gap-1.5">
            <div className="w-14 h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: hs.color }} />
            </div>
            <span className="text-[9px] text-slate-400">{pct.toFixed(1)}%</span>
          </div>
        );
      },
    },
  ];

  // ── India export columns (Buyers) ──
  const exportColumns = (hs) => [
    { key: '#', label: '#', render: (_, i) => <span className="text-slate-500">{i + 1}</span> },
    { key: 'partner', label: 'Buyer (Importing Country)', render: (r) => <span className="font-medium text-emerald-400">{r.partner}</span> },
    { key: 'value', label: 'Value (USD)', className: 'font-mono', render: (r) => fmtUSD(r.value) },
    { key: 'weight', label: 'Net Weight', className: 'font-mono', render: (r) => r.weight ? fmtMT(r.weight) : '—' },
    { key: 'unitPrice', label: '$/MT · $/kg', render: (r) => <PriceCell value={r.value} weight={r.weight} color={hs.color} /> },
  ];

  // ── Global summary per HS code (with split support) ──
  function buildGlobalSummary() {
    if (!tradeData?.markets) return {};
    const summary = {};

    function summarizeRows(rows, code) {
      const totalVal = rows.reduce((s, r) => s + (r.value || 0), 0);
      const totalWt = rows.reduce((s, r) => s + (r.weight || 0), 0);
      const indiaRow = rows.find((r) => r.partnerCode === '699');
      return {
        totalValue: totalVal, totalWeight: totalWt,
        avgPriceMT: totalWt > 0 ? totalVal / (totalWt / 1000) : null,
        avgPriceKg: totalWt > 0 ? totalVal / totalWt : null,
        topSupplier: rows[0]?.partner || '—',
        supplierCount: rows.length,
        indiaValue: indiaRow?.value || 0,
        indiaShare: indiaRow ? ((indiaRow.value / totalVal) * 100).toFixed(1) + '%' : '—',
      };
    }

    for (const code of HS_CODE_LIST) {
      const hs = HS_CODES[code];
      summary[code] = [];

      // If this code has a split config, also build split summaries
      if (hs.split) {
        summary[code + '_high'] = [];
        summary[code + '_low'] = [];
      }

      for (const market of IMPORT_MARKETS) {
        const rows = tradeData.markets[market.code]?.[code];
        if (!rows?.length) continue;

        const base = { market: market.name, flag: market.flag, marketCode: market.code };
        summary[code].push({ ...base, ...summarizeRows(rows, code) });

        if (hs.split) {
          const { high, low } = splitRows(rows, hs.split.thresholdPerKg);
          if (high.length > 0) {
            summary[code + '_high'].push({ ...base, ...summarizeRows(high, code) });
          }
          if (low.length > 0) {
            summary[code + '_low'].push({ ...base, ...summarizeRows(low, code) });
          }
        }
      }

      summary[code].sort((a, b) => b.totalValue - a.totalValue);
      if (hs.split) {
        summary[code + '_high'].sort((a, b) => b.totalValue - a.totalValue);
        summary[code + '_low'].sort((a, b) => b.totalValue - a.totalValue);
      }
    }
    return summary;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Trade Flow Data</h2>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
            Source: UN Comtrade v1 API · HS 6-digit · {selectedMarkets.length} markets
            {dataYear && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                📅 {dataYear} Data
              </span>
            )}
            {apiTier && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                apiTier === 'premium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                apiTier === 'public-fallback' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                'bg-slate-600/20 text-slate-400 border border-slate-500/30'
              }`}>
                {apiTier === 'premium' ? '⚡ Premium' : apiTier === 'public-fallback' ? '⚠ Fallback' : '○ Free'}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={fetchMode}
            onChange={(e) => setFetchMode(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-brand"
            disabled={loading.trade}
          >
            <option value="full">Full (Annual + Monthly)</option>
            <option value="annual">Annual Only (Faster)</option>
          </select>
          <button onClick={fetchData} disabled={loading.trade} className="btn-primary">
            {loading.trade ? '⏳ Fetching...' : '🔄 Fetch Trade Data'}
          </button>
        </div>
      </div>

      {/* Market selector */}
      <div className="flex flex-wrap gap-1.5 mb-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <span className="text-[10px] text-slate-500 self-center mr-1">Import Markets:</span>
        {IMPORT_MARKETS.map((m) => (
          <button
            key={m.code}
            onClick={() => toggleMarket(m.code)}
            disabled={loading.trade}
            className={`text-[10px] px-2 py-1 rounded-md border transition-all ${
              selectedMarkets.includes(m.code)
                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
            }`}
          >
            {m.flag} {m.name}
          </button>
        ))}
        <button
          onClick={() => setSelectedMarkets(selectedMarkets.length === IMPORT_MARKETS.length ? ['156'] : IMPORT_MARKETS.map((m) => m.code))}
          className="text-[9px] px-2 py-1 rounded-md bg-slate-700 text-slate-400 hover:text-white ml-1"
          disabled={loading.trade}
        >
          {selectedMarkets.length === IMPORT_MARKETS.length ? 'China Only' : 'Select All'}
        </button>
      </div>

      {/* Empty state */}
      {!tradeData && !loading.trade && (
        <div className="empty-state">
          <p className="text-4xl mb-3">⛴</p>
          <p className="text-slate-400 text-sm">Click "Fetch Trade Data" to pull real trade flows from UN Comtrade v1</p>
          <p className="text-slate-500 text-xs mt-2">9 HS codes · {selectedMarkets.length} import markets · Price/MT & Price/kg</p>
        </div>
      )}

      {loading.trade && !tradeData && (
        <div className="empty-state">
          <p className="text-4xl mb-3 animate-pulse">⏳</p>
          <p className="text-slate-400 text-sm">Fetching from UN Comtrade...</p>
          <p className="text-slate-500 text-xs mt-2">Querying {selectedMarkets.length} markets × 9 products</p>
        </div>
      )}

      {/* ═══ Data loaded ═══ */}
      {tradeData && (() => {
        const globalSummary = buildGlobalSummary();

        return (
          <div>
            {/* ── GLOBAL OVERVIEW ── */}
            <h3 className="text-[13px] font-bold text-indigo-400 uppercase tracking-wider mb-3">
              🌍 Global Import Overview — All Markets ({tradeData.dataYear || dataYear || '?'})
            </h3>
            {HS_CODE_LIST.map((code) => {
              const rows = globalSummary[code];
              if (!rows?.length) return null;
              const hs = HS_CODES[code];
              const grandTotal = rows.reduce((s, r) => s + r.totalValue, 0);

              // Render a summary table (reused for split views)
              const renderSummaryTable = (tableRows, accentColor, totalOverride) => {
                const gt = totalOverride ?? tableRows.reduce((s, r) => s + r.totalValue, 0);
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700/50 text-slate-500">
                          <th className="text-left px-3 py-2">#</th>
                          <th className="text-left px-3 py-2">Importing Market</th>
                          <th className="text-left px-3 py-2">Total Imports</th>
                          <th className="text-left px-3 py-2">Volume</th>
                          <th className="text-left px-3 py-2">Avg Trade Price*</th>
                          <th className="text-left px-3 py-2">Top Supplier</th>
                          <th className="text-left px-3 py-2">India Share</th>
                          <th className="text-left px-3 py-2">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((r, i) => {
                          const pct = gt > 0 ? (r.totalValue / gt) * 100 : 0;
                          return (
                            <tr key={r.marketCode} className="border-b border-slate-800/50 hover:bg-slate-800/50">
                              <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                              <td className="px-3 py-2 font-medium text-slate-200">{r.flag} {r.market}</td>
                              <td className="px-3 py-2 font-mono">{fmtUSD(r.totalValue)}</td>
                              <td className="px-3 py-2 font-mono">{r.totalWeight > 0 ? fmtMT(r.totalWeight) : '—'}</td>
                              <td className="px-3 py-2">
                                {r.avgPriceMT ? (
                                  <div>
                                    <span className="font-mono font-semibold" style={{ color: accentColor }}>{fmtPrice(r.avgPriceMT)}/MT</span>
                                    <div className="text-[9px] text-slate-500 font-mono">${r.avgPriceKg?.toFixed(2)}/kg</div>
                                  </div>
                                ) : '—'}
                              </td>
                              <td className="px-3 py-2 text-slate-300">{r.topSupplier}</td>
                              <td className="px-3 py-2">
                                {r.indiaValue > 0 ? (
                                  <span className="text-amber-500 font-medium">{r.indiaShare} ({fmtUSDShort(r.indiaValue)})</span>
                                ) : <span className="text-slate-600">—</span>}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-14 h-1.5 bg-slate-900 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: accentColor }} />
                                  </div>
                                  <span className="text-[9px] text-slate-400">{pct.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              };

              return (
                <div key={code}>
                  {/* Main combined card */}
                  <div className="card mb-2" style={{ borderColor: hs.color + '33' }}>
                    <div className="card-header flex justify-between items-center" style={{ backgroundColor: hs.color + '11', borderColor: hs.color + '22' }}>
                      <span><span style={{ color: hs.color }}>HS {code}</span> · {hs.name}</span>
                      <span className="text-slate-400">Global Total: {fmtUSD(grandTotal)}</span>
                    </div>
                    {hs.note && (
                      <div className="px-3 py-1.5 text-[10px] text-amber-400/80 bg-amber-500/5 border-b border-slate-700/30">
                        ℹ {hs.note}
                      </div>
                    )}
                    {renderSummaryTable(rows, hs.color)}
                  </div>

                  {/* Split cards for HAp vs DCP */}
                  {hs.split && (() => {
                    const highRows = globalSummary[code + '_high'] || [];
                    const lowRows = globalSummary[code + '_low'] || [];
                    const highTotal = highRows.reduce((s, r) => s + r.totalValue, 0);
                    const lowTotal = lowRows.reduce((s, r) => s + r.totalValue, 0);
                    const highWeight = highRows.reduce((s, r) => s + r.totalWeight, 0);
                    const lowWeight = lowRows.reduce((s, r) => s + r.totalWeight, 0);
                    const pctHigh = grandTotal > 0 ? ((highTotal / grandTotal) * 100).toFixed(1) : '0.0';
                    return (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
                        {/* HAp / Specialty */}
                        <div className="card" style={{ borderColor: hs.split.highColor + '44' }}>
                          <div className="card-header flex justify-between items-center" style={{ backgroundColor: hs.split.highColor + '15', borderColor: hs.split.highColor + '33' }}>
                            <span className="text-[11px]">
                              <span className="font-bold" style={{ color: hs.split.highColor }}>⬆ {hs.split.highLabel}</span>
                              <span className="text-slate-500 ml-2">({'>'}{hs.split.thresholdPerKg} $/kg)</span>
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {fmtUSDShort(highTotal)} · {fmtMT(highWeight * 1000)} · <span style={{ color: hs.split.highColor }}>{pctHigh}%</span> of total
                            </span>
                          </div>
                          {hs.split.highNote && (
                            <div className="px-3 py-1 text-[9px] text-purple-300/70 bg-purple-500/5 border-b border-slate-700/30">
                              {hs.split.highNote}
                            </div>
                          )}
                          {highRows.length > 0 ? renderSummaryTable(highRows, hs.split.highColor) : (
                            <div className="p-3 text-[10px] text-slate-500 italic">No high-value shipments detected in selected markets</div>
                          )}
                        </div>

                        {/* Bulk DCP */}
                        <div className="card" style={{ borderColor: hs.split.lowColor + '33' }}>
                          <div className="card-header flex justify-between items-center" style={{ backgroundColor: hs.split.lowColor + '11', borderColor: hs.split.lowColor + '22' }}>
                            <span className="text-[11px]">
                              <span className="font-bold" style={{ color: hs.split.lowColor }}>⬇ {hs.split.lowLabel}</span>
                              <span className="text-slate-500 ml-2">(≤{hs.split.thresholdPerKg} $/kg)</span>
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {fmtUSDShort(lowTotal)} · {fmtMT(lowWeight * 1000)}
                            </span>
                          </div>
                          {hs.split.lowNote && (
                            <div className="px-3 py-1 text-[9px] text-slate-400/70 bg-slate-500/5 border-b border-slate-700/30">
                              {hs.split.lowNote}
                            </div>
                          )}
                          {lowRows.length > 0 ? renderSummaryTable(lowRows, hs.split.lowColor) : (
                            <div className="p-3 text-[10px] text-slate-500 italic">No bulk shipments detected</div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            <p className="text-[9px] text-slate-500 mt-1 mb-4 italic">
              * Avg Trade Price = total declared value ÷ total net weight. This is a customs-weighted average across ALL grades within the HS code.
              For codes covering multiple product types (e.g. HS 283526 includes cheap DCP + expensive HAp), the average is dominated by the bulk commodity.
              Use the Pricing tab for grade-specific market prices.
            </p>

            {/* ── PER-MARKET DETAILED BREAKDOWN ── */}
            {Object.entries(tradeData.markets || {}).map(([marketCode, hsData]) => {
              const market = IMPORT_MARKETS.find((m) => m.code === marketCode);
              if (!market) return null;
              const hasData = Object.values(hsData).some((rows) => rows?.length > 0);
              if (!hasData) return null;
              return (
                <div key={marketCode}>
                  <h3 className="text-[13px] font-bold text-amber-500 uppercase tracking-wider mt-6 mb-3">
                    {market.flag} {market.name} — Suppliers / Exporters ({tradeData.dataYear || dataYear || '?'})
                  </h3>
                  {Object.entries(hsData).map(([code, rows]) => {
                    if (!rows?.length) return null;
                    const hs = HS_CODES[code];
                    const total = rows.reduce((s, r) => s + (r.value || 0), 0);
                    return (
                      <div key={code}>
                        <div className="card mb-2" style={{ borderColor: hs.color + '33' }}>
                          <div className="card-header flex justify-between items-center" style={{ backgroundColor: hs.color + '11', borderColor: hs.color + '22' }}>
                            <span><span style={{ color: hs.color }}>HS {code}</span> · {hs.name}</span>
                            <span className="text-slate-400">Total: {fmtUSD(total)}</span>
                          </div>
                          {hs.note && (
                            <div className="px-3 py-1.5 text-[10px] text-amber-400/80 bg-amber-500/5 border-b border-slate-700/30">
                              ℹ {hs.note}
                            </div>
                          )}
                          <DataTable columns={makeColumns(hs, total)} data={rows.slice(0, 10)} />
                        </div>

                        {/* Split cards for this market */}
                        {hs.split && (() => {
                          const { high, low } = splitRows(rows, hs.split.thresholdPerKg);
                          if (!high.length && !low.length) return null;
                          const highTotal = high.reduce((s, r) => s + (r.value || 0), 0);
                          const lowTotal = low.reduce((s, r) => s + (r.value || 0), 0);
                          const fakeHsHigh = { ...hs, color: hs.split.highColor, shortName: hs.split.highShortName };
                          const fakeHsLow = { ...hs, color: hs.split.lowColor, shortName: hs.split.lowShortName };
                          return (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
                              <div className="card" style={{ borderColor: hs.split.highColor + '44' }}>
                                <div className="card-header text-[11px] flex justify-between items-center" style={{ backgroundColor: hs.split.highColor + '15', borderColor: hs.split.highColor + '33' }}>
                                  <span style={{ color: hs.split.highColor }}>⬆ {hs.split.highLabel}</span>
                                  <span className="text-slate-400">{fmtUSD(highTotal)}</span>
                                </div>
                                {high.length > 0
                                  ? <DataTable columns={makeColumns(fakeHsHigh, highTotal)} data={high.slice(0, 10)} />
                                  : <div className="p-3 text-[10px] text-slate-500 italic">No high-value shipments</div>}
                              </div>
                              <div className="card" style={{ borderColor: hs.split.lowColor + '33' }}>
                                <div className="card-header text-[11px] flex justify-between items-center" style={{ backgroundColor: hs.split.lowColor + '11', borderColor: hs.split.lowColor + '22' }}>
                                  <span style={{ color: hs.split.lowColor }}>⬇ {hs.split.lowLabel}</span>
                                  <span className="text-slate-400">{fmtUSD(lowTotal)}</span>
                                </div>
                                {low.length > 0
                                  ? <DataTable columns={makeColumns(fakeHsLow, lowTotal)} data={low.slice(0, 10)} />
                                  : <div className="p-3 text-[10px] text-slate-500 italic">No bulk shipments</div>}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* ── INDIA EXPORTS (Buyers) ── */}
            <h3 className="text-[13px] font-bold text-emerald-500 uppercase tracking-wider mt-6 mb-3">
              🇮🇳 India Exports — Buyers by Destination ({tradeData.dataYear || dataYear || '?'})
            </h3>
            {Object.entries(tradeData.in_ || {}).map(([code, rows]) => {
              if (!rows?.length) return null;
              const hs = HS_CODES[code];
              const total = rows.reduce((s, r) => s + (r.value || 0), 0);
              return (
                <div key={code}>
                  <div className="card mb-2" style={{ borderColor: hs.color + '33' }}>
                    <div className="card-header flex justify-between items-center" style={{ backgroundColor: '#05966911', borderColor: '#05966922' }}>
                      <span><span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName} — India Exports</span>
                      <span className="text-slate-400">Total: {fmtUSD(total)}</span>
                    </div>
                    <DataTable columns={exportColumns(hs)} data={rows.slice(0, 10)} />
                  </div>

                  {/* Split cards for India exports */}
                  {hs.split && (() => {
                    const { high, low } = splitRows(rows, hs.split.thresholdPerKg);
                    if (!high.length && !low.length) return null;
                    const highTotal = high.reduce((s, r) => s + (r.value || 0), 0);
                    const lowTotal = low.reduce((s, r) => s + (r.value || 0), 0);
                    const fakeHsHigh = { ...hs, color: hs.split.highColor, shortName: hs.split.highShortName };
                    const fakeHsLow = { ...hs, color: hs.split.lowColor, shortName: hs.split.lowShortName };
                    return (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
                        <div className="card" style={{ borderColor: hs.split.highColor + '44' }}>
                          <div className="card-header text-[11px] flex justify-between items-center" style={{ backgroundColor: hs.split.highColor + '15', borderColor: hs.split.highColor + '33' }}>
                            <span style={{ color: hs.split.highColor }}>⬆ {hs.split.highLabel} — India Exports</span>
                            <span className="text-slate-400">{fmtUSD(highTotal)}</span>
                          </div>
                          {high.length > 0
                            ? <DataTable columns={exportColumns(fakeHsHigh)} data={high.slice(0, 10)} />
                            : <div className="p-3 text-[10px] text-slate-500 italic">No high-value HAp exports detected</div>}
                        </div>
                        <div className="card" style={{ borderColor: hs.split.lowColor + '33' }}>
                          <div className="card-header text-[11px] flex justify-between items-center" style={{ backgroundColor: hs.split.lowColor + '11', borderColor: hs.split.lowColor + '22' }}>
                            <span style={{ color: hs.split.lowColor }}>⬇ {hs.split.lowLabel} — India Exports</span>
                            <span className="text-slate-400">{fmtUSD(lowTotal)}</span>
                          </div>
                          {low.length > 0
                            ? <DataTable columns={exportColumns(fakeHsLow)} data={low.slice(0, 10)} />
                            : <div className="p-3 text-[10px] text-slate-500 italic">No bulk exports detected</div>}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* ── Annual Trends ── */}
            {Object.keys(tradeData.ts || {}).length > 0 && (
              <>
                <h3 className="text-[13px] font-bold text-purple-400 uppercase tracking-wider mt-6 mb-3">
                  📈 China Import Trend — Annual ({(() => { const yrs = Object.keys(Object.values(tradeData.ts)[0] || {}); return yrs.length ? `${yrs[0]}–${yrs[yrs.length-1]}` : '?'; })()})
                </h3>
                {Object.entries(tradeData.ts).map(([code, years]) => {
                  const hs = HS_CODES[code];
                  const vals = Object.values(years).map((y) => y.value);
                  const maxVal = Math.max(...vals, 1);
                  const lastTwo = vals.slice(-2);
                  const yoy = lastTwo[0] > 0 ? ((lastTwo[1] - lastTwo[0]) / lastTwo[0]) * 100 : null;
                  return (
                    <div key={code} className="bg-slate-800 rounded-lg p-4 mb-2.5" style={{ border: `1px solid ${hs.color}22` }}>
                      <div className="flex justify-between items-center mb-3">
                        <div className="text-[11px] font-semibold">
                          <span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName}
                        </div>
                        {yoy !== null && (
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${yoy >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                            {yoy >= 0 ? '▲' : '▼'} {Math.abs(yoy).toFixed(1)}% YoY
                          </span>
                        )}
                      </div>
                      <div className="flex items-end gap-3 h-20">
                        {Object.entries(years).map(([yr, d]) => (
                          <div key={yr} className="flex-1 text-center">
                            <div className="rounded-t mx-auto" style={{ height: `${Math.max(4, (d.value / maxVal) * 55)}px`, background: hs.color, width: '65%' }} />
                            <div className="text-[9px] text-slate-400 mt-1">{yr}</div>
                            <div className="text-[9px] font-mono" style={{ color: hs.color }}>{d.value > 0 ? fmtUSDShort(d.value) : '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* ── Monthly Sparklines ── */}
            {Object.keys(tradeData.monthly || {}).length > 0 && (
              <>
                <h3 className="text-[13px] font-bold text-indigo-400 uppercase tracking-wider mt-6 mb-3">
                  📊 Monthly Import Volume — China ({(() => { const by = parseInt(tradeData.dataYear || dataYear || 2024); return `${by-1}–${by}`; })()})
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {Object.entries(tradeData.monthly).map(([code, months]) => {
                    if (!months?.length) return null;
                    const hs = HS_CODES[code];
                    const withData = months.filter((m) => m.value > 0);
                    const total = withData.reduce((s, m) => s + m.value, 0);
                    const avg = withData.length > 0 ? total / withData.length : 0;
                    const peak = withData.length > 0 ? withData.reduce((a, b) => (a.value > b.value ? a : b)) : null;
                    const low = withData.length > 0 ? withData.reduce((a, b) => (a.value < b.value ? a : b)) : null;
                    return (
                      <div key={code} className="bg-slate-800 rounded-lg p-4" style={{ border: `1px solid ${hs.color}22` }}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="text-[11px] font-semibold"><span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName}</div>
                            <div className="text-[9px] text-slate-500 mt-0.5">{withData.length} months · Total: {fmtUSDShort(total)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[9px] text-slate-400">Avg/mo: <span className="font-mono" style={{ color: hs.color }}>{fmtUSDShort(avg)}</span></div>
                            {peak && <div className="text-[9px] text-slate-500">Peak: {peak.label} ({fmtUSDShort(peak.value)})</div>}
                          </div>
                        </div>
                        <div className="mt-2 mb-1"><Sparkline data={months} color={hs.color} height={50} /></div>
                        <div className="flex justify-between text-[8px] text-slate-600 px-0.5">
                          {months.length > 0 && (() => {
                            const first = months[0]?.label || '';
                            const last = months[months.length - 1]?.label || '';
                            const mid = months[Math.floor(months.length / 2)]?.label || '';
                            return <><span>{first}</span><span>{mid}</span><span>{last}</span></>;
                          })()}
                        </div>
                        {peak && low && (
                          <div className="flex gap-3 mt-2 pt-2 border-t border-slate-700/50">
                            <div className="text-[9px]"><span className="text-slate-500">High:</span> <span className="text-emerald-400 font-mono">{fmtUSDShort(peak.value)}</span> <span className="text-slate-600">({peak.label})</span></div>
                            <div className="text-[9px]"><span className="text-slate-500">Low:</span> <span className="text-red-400 font-mono">{fmtUSDShort(low.value)}</span> <span className="text-slate-600">({low.label})</span></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
