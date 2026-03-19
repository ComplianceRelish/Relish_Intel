// =============================================================================
// ScraperOutput.jsx — LIVE integrated trade data scraper dashboard
//
// Calls GET /api/scrape which orchestrates:
//   UN Comtrade public preview . WITS World Bank . TRADESTAT . MPEDA
//
// Primary product: ITC-HS 03073910 - Kakka / Indian Black Clam
//   Villorita cyprinoides . Meretrix meretrix . Katelysia spp. (Panavally, Kerala)
// =============================================================================

import { useState, useRef, useCallback, useMemo } from 'react';

// ---- Formatters --------------------------------------------------------------
const fmtN   = v => v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtMT  = kg => kg == null ? '—' : (kg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' MT';
const fmtMn  = v => v == null ? '—' : '$' + Number(v).toFixed(2) + ' Mn';
const fmtCr  = v => v == null ? '—' : '\u20B9' + Number(v).toFixed(2) + ' Cr';
const fmtPKg = v => v == null ? '—' : '$' + Number(v).toFixed(3) + '/kg';

function exportToCSV(records, filename) {
  const COLS = ['source','hs_code','product','country','qty_kgs','value_inr_cr','value_usd_mn','usd_per_kg','usd_per_mt','period','type','group'];
  const esc = v => typeof v === 'string' && (v.includes(',') || v.includes('"'))
    ? '"' + v.replace(/"/g,'""') + '"' : (v ?? '');
  const lines = [COLS.join(','), ...records.map(r => COLS.map(c => esc(r[c])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename || 'trade_scrape.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ---- Source badge colours ---------------------------------------------------
const SRC_STYLE = {
  COMTRADE:  'bg-blue-900 text-blue-200 border border-blue-700',
  WITS:      'bg-indigo-900 text-indigo-200 border border-indigo-700',
  TRADESTAT: 'bg-orange-900 text-orange-200 border border-orange-700',
  MPEDA:     'bg-green-900 text-green-200 border border-green-700',
};

// ---- Animated progress steps ------------------------------------------------
const STEPS = [
  { label: 'UN Comtrade public preview', icon: '\uD83C\uDF10' },
  { label: 'WITS World Bank SDMX API',   icon: '\uD83C\uDFE6' },
  { label: 'TRADESTAT / DGCI&S India',   icon: '\uD83C\uDDF3\uD83C\uDDF3' },
  { label: 'MPEDA Marine Export Stats',  icon: '\uD83E\uDDAA' },
];

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 inline-block text-current" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" />
    </svg>
  );
}

// =============================================================================
export default function ScraperOutput() {
  const [phase,   setPhase]   = useState('idle');
  const [records, setRecords] = useState([]);
  const [meta,    setMeta]    = useState(null);
  const [errMsg,  setErrMsg]  = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [filter,  setFilter]  = useState('');
  const [grpFilt, setGrpFilt] = useState('ALL');
  const [sortCol, setSortCol] = useState('value_usd_mn');
  const [sortDir, setSortDir] = useState('desc');
  const [years,   setYears]   = useState(() => {
    const y = new Date().getFullYear(); return `${y-2},${y-1}`;
  });
  const timerRef = useRef(null);

  // ---- Run scraper ----------------------------------------------------------
  const run = useCallback(async () => {
    setPhase('running'); setStepIdx(0); setRecords([]); setMeta(null); setErrMsg('');
    timerRef.current = setInterval(() => setStepIdx(i => (i + 1) % STEPS.length), 1400);
    try {
      const resp = await fetch(`/api/scrape?years=${encodeURIComponent(years)}`,
        { signal: AbortSignal.timeout(120000) });
      clearInterval(timerRef.current);
      if (!resp.ok) {
        const txt = await resp.text().catch(() => resp.statusText);
        throw new Error(`Server ${resp.status}: ${txt.slice(0,160)}`);
      }
      const data = await resp.json();
      setRecords(data.records || []);
      setMeta(data.meta || null);
      setPhase('done');
    } catch (e) {
      clearInterval(timerRef.current);
      setErrMsg(e.message || 'Unknown error');
      setPhase('error');
    }
  }, [years]);

  // ---- Filtering & sorting --------------------------------------------------
  const filtered = useMemo(() => {
    let rows = records;
    if (grpFilt !== 'ALL') rows = rows.filter(r => r.group === grpFilt);
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.country||'').toLowerCase().includes(q) ||
        (r.hs_code||'').includes(q) ||
        (r.source||'').toLowerCase().includes(q) ||
        (r.product||'').toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? (sortDir==='asc' ? Infinity : -Infinity);
      const bv = b[sortCol] ?? (sortDir==='asc' ? Infinity : -Infinity);
      if (typeof av === 'string') return sortDir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir==='asc' ? av-bv : bv-av;
    });
  }, [records, filter, grpFilt, sortCol, sortDir]);

  const onSort = col => {
    if (col === sortCol) setSortDir(d => d==='asc'?'desc':'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };
  const si = col => col!==sortCol ? ' \u21C5' : sortDir==='asc' ? ' \u2191' : ' \u2193';

  // ---- Stats ----------------------------------------------------------------
  const stats = useMemo(() => {
    if (!filtered.length) return null;
    return {
      usd:       filtered.reduce((s,r) => s+(r.value_usd_mn??0), 0),
      kgs:       filtered.reduce((s,r) => s+(r.qty_kgs??0), 0),
      countries: new Set(filtered.map(r=>r.country)).size,
    };
  }, [filtered]);

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-6 space-y-5">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Trade Data Scraper</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            ITC-HS <span className="text-teal-400 font-mono font-bold">03073910</span>
            {' '}\u2014 Kakka / Indian Black Clam
            <span className="text-gray-600 ml-1">\u00B7 UN Comtrade \u00B7 WITS \u00B7 TRADESTAT \u00B7 MPEDA</span>
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Years</label>
            <input
              value={years} onChange={e => setYears(e.target.value)}
              disabled={phase==='running'} placeholder="2023,2024"
              title="Comma-separated calendar years, e.g. 2023,2024"
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <button onClick={run} disabled={phase==='running'}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all
              ${phase==='running'
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-teal-600 hover:bg-teal-500 text-white cursor-pointer shadow-lg shadow-teal-900/40'}`}>
            {phase==='running' ? <><Spinner /> Scraping&hellip;</> : <>&#9654; RUN SCRAPER</>}
          </button>
          {phase==='done' && filtered.length>0 && (
            <button onClick={() => exportToCSV(filtered)}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200">
              &#11015; CSV
            </button>
          )}
        </div>
      </div>

      {/* Idle */}
      {phase==='idle' && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-10 text-center space-y-4">
          <div className="text-5xl">&#129450;</div>
          <p className="text-lg font-semibold text-gray-300">Ready to scrape live trade data</p>
          <p className="text-sm text-gray-500 max-w-lg mx-auto">
            Press <span className="text-teal-400 font-bold">&#9654; RUN SCRAPER</span> to query
            UN Comtrade, WITS World Bank, TRADESTAT and MPEDA simultaneously &#8212;
            live HTTP requests, no file upload needed.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {STEPS.map((s,i) => (
              <span key={i} className="text-xs bg-gray-800 border border-gray-700 text-gray-400 rounded-full px-3 py-1">
                {s.icon} {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Running */}
      {phase==='running' && (
        <div className="rounded-xl border border-teal-800 bg-gray-900 p-10 text-center space-y-5">
          <div className="text-4xl animate-bounce">{STEPS[stepIdx].icon}</div>
          <div>
            <p className="text-teal-400 font-semibold text-lg">Querying {STEPS[stepIdx].label}&hellip;</p>
            <p className="text-sm text-gray-500 mt-1">10 HS codes &#183; India export data &#183; live API calls</p>
          </div>
          <div className="flex justify-center gap-3">
            {STEPS.map((_,i) => (
              <div key={i} className={`w-3 h-3 rounded-full transition-all duration-500
                ${i===stepIdx ? 'bg-teal-400 scale-125' : i<stepIdx ? 'bg-teal-700' : 'bg-gray-700'}`} />
            ))}
          </div>
          <p className="text-xs text-gray-600">May take 15&#8211;60 s depending on API response times</p>
        </div>
      )}

      {/* Error */}
      {phase==='error' && (
        <div className="rounded-xl border border-red-800 bg-red-950 p-6 space-y-3">
          <p className="font-semibold text-red-300">&#9888; Scrape failed</p>
          <p className="text-sm text-red-400 font-mono break-all">{errMsg}</p>
          <button onClick={run}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold text-white">
            &#8635; Retry
          </button>
        </div>
      )}

      {/* Done */}
      {phase==='done' && (
        <>
          {/* Meta bar */}
          {meta && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span className="text-gray-400">
                &#10003; {meta.total} records in{' '}
                <span className="text-teal-400">{(meta.duration_ms/1000).toFixed(1)}s</span>
              </span>
              <span>&#183; years: <span className="text-gray-300">{meta.years?.join(', ')}</span></span>
              <span>&#183; {new Date(meta.timestamp).toLocaleTimeString()}</span>
              {meta.sources?.map(s => (
                <span key={s.source}
                  className={`px-2 py-0.5 rounded-full ${SRC_STYLE[s.source]||'bg-gray-800 text-gray-400'}`}>
                  {s.source}: {s.count}{s.errors>0 ? ` (\u26A0${s.errors})` : ''}
                </span>
              ))}
              {meta.errors?.length>0 && (
                <span className="text-yellow-600" title={meta.errors.join('\n')}>
                  &#9888; {meta.errors.length} partial error{meta.errors.length>1?'s':''}
                </span>
              )}
            </div>
          )}

          {/* Stat cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:'Records',       value:fmtN(filtered.length), accent:'text-teal-400'  },
                { label:'Countries',     value:fmtN(stats.countries), accent:'text-sky-400'   },
                { label:'Export Value',  value:fmtMn(stats.usd),      accent:'text-green-400' },
                { label:'Export Volume', value:fmtMT(stats.kgs),      accent:'text-yellow-400'},
              ].map(c => (
                <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <div className={`text-xl font-bold ${c.accent}`}>{c.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Group pills + filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            {['ALL','CLAM','CALCIUM'].map(g => (
              <button key={g} onClick={() => setGrpFilt(g)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all
                  ${grpFilt===g
                    ? g==='CLAM'    ? 'bg-teal-700 border-teal-500 text-white'
                    : g==='CALCIUM' ? 'bg-yellow-800 border-yellow-600 text-yellow-200'
                    :                 'bg-gray-600 border-gray-500 text-white'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                {g==='CLAM' ? '&#129450; CLAM' : g==='CALCIUM' ? '&#9879; CALCIUM' : 'ALL'}
              </button>
            ))}
            <div className="flex-1" />
            <input
              value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Filter country / HS / source&hellip;"
              className="bg-gray-900 border border-gray-700 text-gray-200 rounded px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* Results table */}
          {filtered.length===0
            ? <div className="text-center text-gray-500 py-12">No records match filters.</div>
            : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-900 border-b border-gray-800">
                  <tr>
                    {[
                      {k:'source',       l:'Source'},
                      {k:'hs_code',      l:'HS Code'},
                      {k:'product',      l:'Product',   cls:'min-w-[180px]'},
                      {k:'country',      l:'Country'},
                      {k:'period',       l:'Period'},
                      {k:'qty_kgs',      l:'Volume (MT)'},
                      {k:'value_usd_mn', l:'USD (Mn)'},
                      {k:'value_inr_cr', l:'\u20B9 (Cr)'},
                      {k:'usd_per_kg',   l:'$/kg'},
                    ].map(col => (
                      <th key={col.k} onClick={() => onSort(col.k)}
                        className={`px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-teal-400 ${col.cls||''}`}>
                        {col.l}<span className="text-gray-600">{si(col.k)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {filtered.map((r,i) => (
                    <tr key={i} className="hover:bg-gray-900/50 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${SRC_STYLE[r.source]||'bg-gray-800 text-gray-400'}`}>
                          {r.source||'&#8212;'}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-mono text-xs whitespace-nowrap font-bold
                        ${r.hs_code==='03073910' ? 'text-teal-400' : 'text-gray-400'}`}>
                        {r.hs_code||'&#8212;'}
                        {r.hs_code==='03073910' && <span className="ml-1 text-teal-600">&#9733;</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate" title={r.product}>
                        {r.product||'&#8212;'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-200 font-medium">{r.country||'&#8212;'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400 text-xs">{r.period||'&#8212;'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${r.qty_kgs ? 'text-yellow-300' : 'text-gray-600'}`}>
                        {fmtMT(r.qty_kgs)}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap text-right font-semibold ${r.value_usd_mn ? 'text-green-400' : 'text-gray-600'}`}>
                        {fmtMn(r.value_usd_mn)}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${r.value_inr_cr ? 'text-orange-300' : 'text-gray-600'}`}>
                        {fmtCr(r.value_inr_cr)}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap text-right ${r.usd_per_kg ? 'text-purple-300' : 'text-gray-600'}`}>
                        {fmtPKg(r.usd_per_kg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-500 flex justify-between">
                <span>Showing {filtered.length} of {records.length} records</span>
                <button onClick={() => exportToCSV(filtered)} className="text-teal-500 hover:text-teal-400">
                  &#11015; Export filtered view as CSV
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
