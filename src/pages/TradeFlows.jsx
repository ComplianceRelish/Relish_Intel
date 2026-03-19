import { useCallback, useState } from 'react';
import { useApp } from '../context/AppContext';
import { fetchComtradeData, fetchMonthlyData } from '../services/api';
import { saveTradeSnapshot, getLatestTradeSnapshot } from '../services/db';
import { HS_CODES, HS_CODE_LIST, TREND_CODES } from '../config/hsCodes';
import { COUNTRIES } from '../config/countries';
import { CLAM_SPECIES } from '../config/clamSpecies';
import { fmtUSD, fmtPrice, fmtMT, fmtUSDShort } from '../utils/formatters';
import DataTable from '../components/DataTable';
import { useEffect } from 'react';

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

export default function TradeFlows() {
  const { tradeData, setTradeData, loading, setLoading, addLog } = useApp();
  const [fetchMode, setFetchMode] = useState('full'); // 'full' | 'annual' | 'monthly'
  const [apiTier, setApiTier] = useState(null); // 'premium' | 'public' | 'public-fallback'

  // Load cached data on mount
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

  const fetchData = useCallback(async () => {
    setLoading((p) => ({ ...p, trade: true }));
    addLog('Starting UN Comtrade v1 data pull...', 'info');

    const results = { cn: {}, in_: {}, ts: {}, monthly: {} };
    const delay = 1200; // Respect Comtrade rate limits
    let detectedTier = null;

    for (const code of HS_CODE_LIST) {
      const hs = HS_CODES[code];

      // ── China imports (annual) ──
      addLog(`China imports: ${hs.shortName} (HS ${code})...`);
      try {
        const d = await fetchComtradeData('156', code, 'M');
        // Detect tier from first response
        if (!detectedTier && d._tier) detectedTier = d._tier;
        results.cn[code] = d
          .filter((r) => r.partnerCode !== 0 && r.primaryValue > 0)
          .sort((a, b) => b.primaryValue - a.primaryValue)
          .slice(0, 15)
          .map((r) => ({
            partner: r.partnerDesc || COUNTRIES[String(r.partnerCode)] || r.partnerCode,
            value: r.primaryValue,
            weight: r.netWgt,
            unitPrice: r.netWgt > 0 ? r.primaryValue / (r.netWgt / 1000) : null,
          }));
        addLog(`  → ${results.cn[code].length} partners found`, 'success');
      } catch (err) {
        addLog(`  ✗ ${err.message}`, 'error');
        results.cn[code] = [];
      }
      await new Promise((r) => setTimeout(r, delay));

      // ── India exports (annual) ──
      addLog(`India exports: ${hs.shortName}...`);
      try {
        const d2 = await fetchComtradeData('699', code, 'X');
        results.in_[code] = d2
          .filter((r) => r.partnerCode !== 0 && r.primaryValue > 0)
          .sort((a, b) => b.primaryValue - a.primaryValue)
          .slice(0, 15)
          .map((r) => ({
            partner: r.partnerDesc || COUNTRIES[String(r.partnerCode)] || r.partnerCode,
            value: r.primaryValue,
            weight: r.netWgt,
            unitPrice: r.netWgt > 0 ? r.primaryValue / (r.netWgt / 1000) : null,
          }));
        addLog(`  → ${results.in_[code].length} destinations`, 'success');
      } catch (err) {
        addLog(`  ✗ ${err.message}`, 'error');
        results.in_[code] = [];
      }
      await new Promise((r) => setTimeout(r, delay));

      // ── Annual time series (batched CSV) ──
      if (TREND_CODES.includes(code)) {
        addLog(`  Annual trend: ${hs.shortName} (2019–2024)...`);
        results.ts[code] = {};
        try {
          const trendYears = ['2019', '2020', '2021', '2022', '2023', '2024'];
          const t = await fetchComtradeData('156', code, 'M', '0', trendYears.join(','));
          for (const yr of trendYears) {
            const match = t.find((r) => String(r.period) === yr);
            results.ts[code][yr] = { value: match?.primaryValue || 0, weight: match?.netWgt || 0 };
          }
          addLog(`  → Annual trend loaded (${t.length} records)`, 'success');
        } catch (err) {
          addLog(`  ✗ Annual trend: ${err.message}`, 'error');
          for (const yr of ['2019', '2020', '2021', '2022', '2023', '2024']) {
            results.ts[code][yr] = { value: 0, weight: 0 };
          }
        }
        await new Promise((r) => setTimeout(r, delay));
      }

      // ── Monthly granular data (premium only — 2023-2024) ──
      if (fetchMode === 'full' && TREND_CODES.includes(code)) {
        addLog(`  Monthly detail: ${hs.shortName} (2023–2024)...`);
        try {
          // Batch months in groups of 12 to stay within Comtrade query limits
          const months2023 = monthPeriods(2023, 2023);
          const months2024 = monthPeriods(2024, 2024);
          const m1 = await fetchMonthlyData('156', code, 'M', months2023.join(','), '0');
          await new Promise((r) => setTimeout(r, delay));
          const m2 = await fetchMonthlyData('156', code, 'M', months2024.join(','), '0');
          const allMonthly = [...m1, ...m2];
          const allPeriods = [...months2023, ...months2024];
          results.monthly[code] = allPeriods.map((p) => {
            const match = allMonthly.find((r) => String(r.period) === p);
            return {
              period: p,
              label: `${p.slice(0, 4)}-${p.slice(4)}`,
              value: match?.primaryValue || 0,
              weight: match?.netWgt || 0,
            };
          });
          addLog(`  → ${results.monthly[code].filter((x) => x.value > 0).length} months with data`, 'success');
        } catch (err) {
          addLog(`  ✗ Monthly: ${err.message}`, 'error');
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
  }, [addLog, setLoading, setTradeData, fetchMode]);

  // ── Table columns ──────────────────────────────────────
  const makeColumns = (hs, total) => [
    { key: '#', label: '#', render: (_, i) => <span className="text-slate-500">{i + 1}</span> },
    {
      key: 'partner', label: 'Partner',
      render: (r) => (
        <span className={`font-medium ${r.partner === 'India' ? 'text-amber-500' : 'text-slate-200'}`}>
          {r.partner}{r.partner === 'India' && ' ★'}
        </span>
      ),
    },
    { key: 'value', label: 'Value (USD)', className: 'font-mono', render: (r) => fmtUSD(r.value) },
    { key: 'weight', label: 'Net Weight', className: 'font-mono', render: (r) => r.weight ? fmtMT(r.weight) : '—' },
    {
      key: 'unitPrice', label: '$/MT', className: 'font-mono',
      render: (r) => <span style={{ color: hs.color }}>{r.unitPrice ? fmtPrice(r.unitPrice) : '—'}</span>,
    },
    {
      key: 'share', label: 'Share',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <div className="w-12 h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, (r.value / total) * 100)}%`, backgroundColor: hs.color }}
            />
          </div>
          <span className="text-[9px] text-slate-400">{((r.value / total) * 100).toFixed(1)}%</span>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold">Trade Flow Data</h2>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
            Source: UN Comtrade v1 API · HS 6-digit
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
          {/* Fetch mode selector */}
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

      {/* Empty state */}
      {!tradeData && !loading.trade && (
        <div className="empty-state">
          <p className="text-4xl mb-3">⛴</p>
          <p className="text-slate-400 text-sm">
            Click "Fetch Trade Data" to pull real trade flows from UN Comtrade v1
          </p>
          <p className="text-slate-500 text-xs mt-2">
            9 HS codes · China imports + India exports · Annual trends + Monthly granular
          </p>
          <p className="text-slate-600 text-xs mt-1">
            Premium key detected · Auto-fallback to free API if daily limit reached
          </p>
        </div>
      )}

      {/* Loading indicator */}
      {loading.trade && !tradeData && (
        <div className="empty-state">
          <p className="text-4xl mb-3 animate-pulse">⏳</p>
          <p className="text-slate-400 text-sm">Fetching data from UN Comtrade...</p>
          <p className="text-slate-500 text-xs mt-2">Check the activity log for progress</p>
        </div>
      )}

      {/* Data loaded */}
      {tradeData && (
        <div>
          {/* ── China Imports ── */}
          <h3 className="text-[13px] font-bold text-amber-500 uppercase tracking-wider mb-3">
            🇨🇳 China Imports by Partner (2023)
          </h3>
          {Object.entries(tradeData.cn).map(([code, rows]) => {
            if (!rows?.length) return null;
            const hs = HS_CODES[code];
            const total = rows.reduce((s, r) => s + (r.value || 0), 0);
            return (
              <div key={code} className="card mb-3.5" style={{ borderColor: hs.color + '33' }}>
                <div
                  className="card-header flex justify-between items-center"
                  style={{ backgroundColor: hs.color + '11', borderColor: hs.color + '22' }}
                >
                  <span>
                    <span style={{ color: hs.color }}>HS {code}</span> · {hs.name}
                  </span>
                  <span className="text-slate-400">Total: {fmtUSD(total)}</span>
                </div>
                <DataTable columns={makeColumns(hs, total)} data={rows.slice(0, 10)} />
              </div>
            );
          })}

          {/* ── India Exports ── */}
          <h3 className="text-[13px] font-bold text-emerald-500 uppercase tracking-wider mt-6 mb-3">
            🇮🇳 India Exports by Destination (2023)
          </h3>
          {Object.entries(tradeData.in_).map(([code, rows]) => {
            if (!rows?.length) return null;
            const hs = HS_CODES[code];
            return (
              <div
                key={code}
                className="bg-slate-800 rounded-lg mb-2.5 p-3.5"
                style={{ border: `1px solid ${hs.color}22` }}
              >
                <div className="text-[11px] font-semibold mb-2">
                  <span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName} — Top destinations
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rows.slice(0, 8).map((r, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2.5 py-1 rounded-md border"
                      style={{
                        backgroundColor: i === 0 ? hs.color + '22' : '#0a0f1a',
                        borderColor: hs.color + (i === 0 ? '44' : '11'),
                        color: i === 0 ? hs.color : '#94a3b8',
                      }}
                    >
                      {r.partner}: {fmtUSD(r.value)}
                      {r.unitPrice ? ` (${fmtPrice(r.unitPrice)}/MT)` : ''}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Annual Time Series ── */}
          {Object.keys(tradeData.ts || {}).length > 0 && (
            <>
              <h3 className="text-[13px] font-bold text-purple-400 uppercase tracking-wider mt-6 mb-3">
                📈 China Import Trend — Annual (2019–2024)
              </h3>
              {Object.entries(tradeData.ts).map(([code, years]) => {
                const hs = HS_CODES[code];
                const vals = Object.values(years).map((y) => y.value);
                const maxVal = Math.max(...vals, 1);
                const lastTwo = vals.slice(-2);
                const yoy = lastTwo[0] > 0 ? ((lastTwo[1] - lastTwo[0]) / lastTwo[0]) * 100 : null;
                return (
                  <div
                    key={code}
                    className="bg-slate-800 rounded-lg p-4 mb-2.5"
                    style={{ border: `1px solid ${hs.color}22` }}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="text-[11px] font-semibold">
                        <span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName}
                      </div>
                      {yoy !== null && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          yoy >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {yoy >= 0 ? '▲' : '▼'} {Math.abs(yoy).toFixed(1)}% YoY
                        </span>
                      )}
                    </div>
                    <div className="flex items-end gap-3 h-20">
                      {Object.entries(years).map(([yr, d]) => (
                        <div key={yr} className="flex-1 text-center">
                          <div
                            className="rounded-t mx-auto transition-all duration-500"
                            style={{
                              height: `${Math.max(4, (d.value / maxVal) * 55)}px`,
                              background: hs.color,
                              width: '65%',
                            }}
                          />
                          <div className="text-[9px] text-slate-400 mt-1">{yr}</div>
                          <div className="text-[9px] font-mono" style={{ color: hs.color }}>
                            {d.value > 0 ? fmtUSDShort(d.value) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ── Monthly Sparkline Charts ── */}
          {Object.keys(tradeData.monthly || {}).length > 0 && (
            <>
              <h3 className="text-[13px] font-bold text-indigo-400 uppercase tracking-wider mt-6 mb-3">
                📊 Monthly Import Volume — China (2023–2024)
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
                    <div
                      key={code}
                      className="bg-slate-800 rounded-lg p-4"
                      style={{ border: `1px solid ${hs.color}22` }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-[11px] font-semibold">
                            <span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName}
                          </div>
                          <div className="text-[9px] text-slate-500 mt-0.5">
                            {withData.length} months with data · Total: {fmtUSDShort(total)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-slate-400">Avg/mo: <span className="font-mono" style={{ color: hs.color }}>{fmtUSDShort(avg)}</span></div>
                          {peak && (
                            <div className="text-[9px] text-slate-500">
                              Peak: {peak.label} ({fmtUSDShort(peak.value)})
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sparkline */}
                      <div className="mt-2 mb-1">
                        <Sparkline data={months} color={hs.color} height={50} />
                      </div>

                      {/* Month labels */}
                      <div className="flex justify-between text-[8px] text-slate-600 px-0.5">
                        <span>Jan 23</span>
                        <span>Jul 23</span>
                        <span>Jan 24</span>
                        <span>Jul 24</span>
                        <span>Dec 24</span>
                      </div>

                      {/* Stats bar */}
                      {peak && low && (
                        <div className="flex gap-3 mt-2 pt-2 border-t border-slate-700/50">
                          <div className="text-[9px]">
                            <span className="text-slate-500">High:</span>{' '}
                            <span className="text-emerald-400 font-mono">{fmtUSDShort(peak.value)}</span>{' '}
                            <span className="text-slate-600">({peak.label})</span>
                          </div>
                          <div className="text-[9px]">
                            <span className="text-slate-500">Low:</span>{' '}
                            <span className="text-red-400 font-mono">{fmtUSDShort(low.value)}</span>{' '}
                            <span className="text-slate-600">({low.label})</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Target Species ── */}
          <h3 className="text-[13px] font-bold text-cyan-500 uppercase tracking-wider mt-6 mb-3">
            🐚 Target Clam Species
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {CLAM_SPECIES.map((sp, i) => (
              <div key={i} className="bg-slate-800 rounded-lg p-3.5 border border-cyan-900/30">
                <div className="text-[12px] font-bold text-cyan-300 italic">{sp.scientific}</div>
                <div className="text-[11px] text-slate-200 mt-1">{sp.common}</div>
                <div className="text-[10px] text-slate-500 mt-1">📍 {sp.region}</div>
                <div className="text-[9px] text-slate-400 mt-1 leading-relaxed">{sp.notes}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
