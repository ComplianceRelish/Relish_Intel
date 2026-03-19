import { useState, useRef, useCallback, useMemo } from 'react';
import { fmtNum } from '../utils/formatters';

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles quoted fields, commas inside quotes, UTF-8 BOM.
function parseCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, ''); // strip BOM
  const lines = cleaned.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));

  const NUMERIC = ['qty_kgs', 'value_inr_cr', 'value_usd_mn', 'usd_per_kg', 'usd_per_mt'];

  return lines.slice(1).map((line) => {
    const vals = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => {
      const raw = (vals[i] ?? '').trim();
      if (NUMERIC.includes(h)) {
        const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
        row[h] = isNaN(n) ? null : n;
      } else {
        row[h] = raw || null;
      }
    });
    // Normalise legacy column names from older scraper runs
    if (!row.qty_kgs && row.quantity_kgs)  row.qty_kgs      = parseFloat(row.quantity_kgs) || null;
    if (!row.qty_kgs && row.quantity)       row.qty_kgs      = parseFloat(row.quantity)     || null;
    if (!row.value_usd_mn && row.value_usd) row.value_usd_mn = parseFloat(row.value_usd)    || null;
    // Infer group from HS code if missing
    if (!row.group && row.hs_code) {
      row.group = (row.hs_code.startsWith('03') || row.hs_code.startsWith('16')) ? 'CLAM' : 'CALCIUM';
    }
    return row;
  });
}

function splitCSVLine(line) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtKgs    = (v) => v != null ? fmtNum(v) + ' KGS'       : '—';
const fmtMT     = (v) => v != null ? (v / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' MT' : '—';
const fmtINR    = (v) => v != null ? '₹ ' + Number(v).toFixed(2) + ' Cr' : '—';
const fmtUSDMn  = (v) => v != null ? '$ ' + Number(v).toFixed(3) + ' Mn' : '—';
const fmtPerKg  = (v) => v != null ? '$ ' + Number(v).toFixed(4) + '/kg' : '—';
const fmtPerMT  = (v) => v != null ? '$ ' + Number(v).toFixed(2) + '/MT' : '—';

// ── Group pill colours ────────────────────────────────────────────────────────
const GROUP_STYLE = {
  CLAM:    { bg: 'bg-teal-500/10',  text: 'text-teal-400',  border: 'border-teal-500/30'  },
  CALCIUM: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30' },
};
const SOURCE_COLORS = {
  COMTRADE:  'text-indigo-400',
  WITS:      'text-blue-400',
  TRADESTAT: 'text-emerald-400',
  MPEDA:     'text-cyan-400',
  ZAUBA:     'text-purple-400',
  DGFT:      'text-lime-400',
  'DGCT&S':  'text-yellow-400',
};

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = '#6366f1' }) {
  return (
    <div
      className="bg-slate-800 rounded-xl p-4 border border-slate-700 relative overflow-hidden"
      style={{ borderTopColor: accent, borderTopWidth: 2 }}
    >
      <div className="text-[9px] font-bold text-slate-500 tracking-widest uppercase mb-1">{label}</div>
      <div className="text-2xl font-black text-white tracking-tight">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{sub}</div>}
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────
function DropZone({ onFile }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        flex flex-col items-center justify-center gap-3
        h-52 rounded-2xl border-2 border-dashed cursor-pointer transition-all
        ${drag
          ? 'border-indigo-500 bg-indigo-500/10'
          : 'border-slate-700 bg-slate-800/50 hover:border-indigo-500/60 hover:bg-slate-800'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }}
      />
      <div className="text-4xl">📂</div>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-300">Drop the scraper CSV here</p>
        <p className="text-[11px] text-slate-500 mt-1 font-mono">
          relish_trade_data_YYYYMMDD_HHMMSS.csv · or click to browse
        </p>
      </div>
      <div className="text-[10px] text-slate-600 font-mono">
        Output from <span className="text-indigo-400">python scraper.py</span>
        {' '}→ <span className="text-teal-400">output/</span> folder
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ScraperOutput() {
  const [rows, setRows]         = useState([]);
  const [fileName, setFileName] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [error, setError]       = useState(null);

  // Filters
  const [search,    setSearch]    = useState('');
  const [groupFilt, setGroupFilt] = useState('');
  const [srcFilt,   setSrcFilt]   = useState('');
  const [hsFilt,    setHsFilt]    = useState('');

  // Sort
  const [sortCol, setSortCol]   = useState('value_usd_mn');
  const [sortAsc, setSortAsc]   = useState(false);

  // ── Load CSV file ──────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseCSV(e.target.result);
        if (!parsed.length) { setError('No data rows found. Is this a scraper CSV?'); return; }
        setRows(parsed);
        setFileName(file.name);
        setLoadedAt(new Date().toLocaleTimeString('en-IN', { hour12: false }));
        // Reset filters on new file
        setSearch(''); setGroupFilt(''); setSrcFilt(''); setHsFilt('');
      } catch (err) {
        setError('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  }, []);

  // ── Derived filter options ─────────────────────────────────────────────────
  const sources  = useMemo(() => [...new Set(rows.map((r) => r.source).filter(Boolean))].sort(), [rows]);
  const hsCodes  = useMemo(() => [...new Set(rows.map((r) => r.hs_code).filter(Boolean))].sort(), [rows]);
  const groups   = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort(), [rows]);

  // ── Filtered + sorted rows ─────────────────────────────────────────────────
  const NUMERIC_COLS = ['qty_kgs', 'value_inr_cr', 'value_usd_mn', 'usd_per_kg', 'usd_per_mt'];
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      if (groupFilt && r.group !== groupFilt) return false;
      if (srcFilt   && r.source !== srcFilt)  return false;
      if (hsFilt    && r.hs_code !== hsFilt)  return false;
      if (q) {
        return Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q));
      }
      return true;
    });
  }, [rows, search, groupFilt, srcFilt, hsFilt]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = NUMERIC_COLS.includes(sortCol) ? (a[sortCol] ?? -Infinity) : String(a[sortCol] ?? '');
      const bv = NUMERIC_COLS.includes(sortCol) ? (b[sortCol] ?? -Infinity) : String(b[sortCol] ?? '');
      if (NUMERIC_COLS.includes(sortCol)) return sortAsc ? av - bv : bv - av;
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [filtered, sortCol, sortAsc]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const countries    = new Set(filtered.map((r) => r.country).filter(Boolean));
    const totalUSD     = filtered.reduce((s, r) => s + (r.value_usd_mn ?? 0), 0);
    const totalKgs     = filtered.reduce((s, r) => s + (r.qty_kgs ?? 0), 0);
    return { countries: countries.size, totalUSD, totalKgs };
  }, [filtered]);

  // ── Sort toggle ────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(false); }
  };
  const sortIcon = (col) => sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : '';

  // ── CSV export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!sorted.length) return;
    const cols = Object.keys(sorted[0]);
    const csv  = [
      cols.join(','),
      ...sorted.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `relish_filtered_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── Column config ──────────────────────────────────────────────────────────
  const COLS = [
    { key: 'source',       label: 'Source',     sortable: true  },
    { key: 'hs_code',      label: 'HS Code',    sortable: true  },
    { key: 'product',      label: 'Product',    sortable: true  },
    { key: 'country',      label: 'Country',    sortable: true  },
    { key: 'group',        label: 'Group',      sortable: true  },
    { key: 'qty_kgs',      label: 'Qty (KGS)',  sortable: true  },
    { key: 'qty_kgs',      label: 'Qty (MT)',   sortable: false, id: 'mt'  },
    { key: 'value_inr_cr', label: '₹ Cr',       sortable: true  },
    { key: 'value_usd_mn', label: 'USD Mn',     sortable: true  },
    { key: 'usd_per_kg',   label: '$/kg',       sortable: true  },
    { key: 'usd_per_mt',   label: '$/MT',       sortable: true  },
    { key: 'period',       label: 'Period',     sortable: true  },
    { key: 'type',         label: 'Type',       sortable: false },
    { key: 'notes',        label: 'Notes',      sortable: false },
  ];

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!rows.length) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-1">Scraper Output Viewer</h2>
          <p className="text-xs text-slate-400">
            Load the CSV produced by <span className="font-mono text-indigo-400">python scraper.py</span>
            {' '}from the <span className="font-mono text-teal-400">output/</span> folder.
          </p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono">
            ⚠ {error}
          </div>
        )}

        <DropZone onFile={handleFile} />

        {/* Quick-start guide */}
        <div className="mt-6 bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest mb-4">
            // How to generate the CSV
          </h3>
          <div className="space-y-3">
            {[
              {
                n: 1,
                title: 'Install Python dependencies',
                cmd: 'pip install requests beautifulsoup4 pandas openpyxl lxml schedule',
              },
              {
                n: 2,
                title: 'Run the scraper (all 10 HS codes)',
                cmd: 'python scraper.py',
                note: 'Saves to output/ folder',
              },
              {
                n: 3,
                title: 'Primary code only (fastest)',
                cmd: 'python scraper.py --hs 03073910 --sources comtrade wits',
                note: 'Kakka / Clam Meat only',
              },
              {
                n: 4,
                title: 'Primary + shell derivatives',
                cmd: 'python scraper.py --hs 03073910 282510 283526 283650',
              },
              {
                n: 5,
                title: 'Automated daily run',
                cmd: 'python scheduler.py --schedule --time 06:00',
              },
            ].map((s) => (
              <div key={s.n} className="flex gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                <div className="w-6 h-6 rounded-full bg-indigo-500 text-black text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  {s.n}
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-slate-200 mb-1">{s.title}</p>
                  <code className="text-[10px] text-teal-300 font-mono bg-slate-950 px-2 py-0.5 rounded">
                    {s.cmd}
                  </code>
                  {s.note && <span className="text-[10px] text-slate-500 ml-2 font-mono">{s.note}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-[10px] text-slate-500 font-mono mb-2">Then load the file:</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors">
              📂 Load CSV
              <input type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // ── Loaded state ──────────────────────────────────────────────────────────
  return (
    <div>
      {/* Title bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white mb-0.5">Scraper Output Viewer</h2>
          <p className="text-[11px] text-slate-500 font-mono">
            {fileName}
            {loadedAt && <span className="ml-2 text-slate-600">loaded {loadedAt}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            className="px-3 py-1.5 text-[11px] font-bold border border-teal-500/50 text-teal-400 rounded-lg hover:bg-teal-500/10 transition-colors font-mono"
          >
            ↓ CSV
          </button>
          <label className="px-3 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer transition-colors">
            📂 Load New File
            <input type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
          </label>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Records"
          value={fmtNum(filtered.length)}
          sub={rows.length !== filtered.length ? `of ${fmtNum(rows.length)} total` : `${sources.length} source${sources.length !== 1 ? 's' : ''}`}
          accent="#6366f1"
        />
        <StatCard
          label="Countries"
          value={stats.countries}
          sub="importing destinations"
          accent="#06b6d4"
        />
        <StatCard
          label="Total Value"
          value={stats.totalUSD > 0 ? '$ ' + stats.totalUSD.toFixed(2) + ' Mn' : '—'}
          sub="USD (filtered rows)"
          accent="#10b981"
        />
        <StatCard
          label="Total Volume"
          value={stats.totalKgs > 0 ? (stats.totalKgs / 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' MT' : '—'}
          sub="metric tonnes (filtered)"
          accent="#f59e0b"
        />
      </div>

      {/* Group breakdown pills */}
      {groups.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {groups.map((g) => {
            const cnt  = filtered.filter((r) => r.group === g).length;
            const style = GROUP_STYLE[g] || { bg: 'bg-slate-700', text: 'text-slate-300', border: 'border-slate-600' };
            return (
              <button
                key={g}
                onClick={() => setGroupFilt(groupFilt === g ? '' : g)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all
                  ${groupFilt === g ? `${style.bg} ${style.text} ${style.border}` : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500'}`}
              >
                {g === 'CLAM' ? '🦪' : '🧪'} {g} · {cnt}
              </button>
            );
          })}
          {(groupFilt || srcFilt || hsFilt || search) && (
            <button
              onClick={() => { setGroupFilt(''); setSrcFilt(''); setHsFilt(''); setSearch(''); }}
              className="px-3 py-1 rounded-full text-[11px] font-mono border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
            >
              ✕ clear filters
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search country, product, HS code…"
          className="flex-1 min-w-[200px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[12px] font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
        <select
          value={srcFilt}
          onChange={(e) => setSrcFilt(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={hsFilt}
          onChange={(e) => setHsFilt(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All HS Codes</option>
          {hsCodes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Primary code callout */}
      {hsFilt === '03073910' || (!hsFilt && rows.some((r) => r.hs_code === '03073910')) ? (
        <div className="mb-3 px-3 py-2 rounded-lg bg-teal-500/5 border border-teal-500/20 flex items-center gap-2">
          <span className="text-teal-400 text-sm">🦪</span>
          <span className="text-[11px] text-teal-300 font-mono">
            <span className="font-bold">03073910</span> — Kakka / Indian Black Clam
            <span className="text-slate-500 ml-1">(Villorita cyprinoides · Meretrix meretrix · Katelysia spp.)</span>
            <span className="text-slate-500 ml-1">· Primary product · Panavally</span>
          </span>
        </div>
      ) : null}

      {/* Data table */}
      {sorted.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
          <p className="text-slate-400 text-sm">No records match the current filters.</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
                  {COLS.map((col, i) => (
                    <th
                      key={col.id ?? col.key + i}
                      onClick={col.sortable ? () => handleSort(col.key) : undefined}
                      className={`px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 tracking-widest uppercase whitespace-nowrap bg-slate-900
                        ${col.sortable ? 'cursor-pointer hover:text-indigo-400' : ''}
                        ${sortCol === col.key && col.sortable ? 'text-indigo-400' : ''}`}
                    >
                      {col.label}{col.sortable ? sortIcon(col.key) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const grpStyle = GROUP_STYLE[row.group] || {};
                  const srcColor = SOURCE_COLORS[row.source] || 'text-slate-400';
                  const isPrimary = row.hs_code === '03073910';
                  return (
                    <tr
                      key={i}
                      className={`border-b border-slate-800/60 hover:bg-slate-700/30 transition-colors
                        ${isPrimary ? 'border-l-2 border-l-teal-500' : ''}
                      `}
                    >
                      <td className={`px-3 py-2 font-bold font-mono ${srcColor}`}>{row.source ?? '—'}</td>
                      <td className={`px-3 py-2 font-mono font-bold ${isPrimary ? 'text-teal-400' : 'text-indigo-400'}`}>
                        {row.hs_code ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-300 max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {(row.product ?? '—').slice(0, 30)}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-200 whitespace-nowrap">{row.country ?? '—'}</td>
                      <td className={`px-3 py-2`}>
                        {row.group ? (
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${grpStyle.bg} ${grpStyle.text} ${grpStyle.border}`}>
                            {row.group}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-emerald-300 whitespace-nowrap">{fmtKgs(row.qty_kgs)}</td>
                      <td className="px-3 py-2 font-mono text-emerald-400 whitespace-nowrap">{fmtMT(row.qty_kgs)}</td>
                      <td className="px-3 py-2 font-mono text-yellow-300 whitespace-nowrap">{fmtINR(row.value_inr_cr)}</td>
                      <td className="px-3 py-2 font-mono text-emerald-300 font-bold whitespace-nowrap">{fmtUSDMn(row.value_usd_mn)}</td>
                      <td className="px-3 py-2 font-mono text-purple-300 font-bold whitespace-nowrap">{fmtPerKg(row.usd_per_kg)}</td>
                      <td className="px-3 py-2 font-mono text-purple-400 whitespace-nowrap">{fmtPerMT(row.usd_per_mt)}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.period ?? '—'}</td>
                      <td className="px-3 py-2 text-indigo-300">{row.type ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap" title={row.notes ?? ''}>
                        {row.notes ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-700 flex items-center justify-between">
            <span className="text-[10px] text-slate-600 font-mono">
              {fmtNum(sorted.length)} record{sorted.length !== 1 ? 's' : ''}
              {filtered.length !== rows.length ? ` (filtered from ${fmtNum(rows.length)})` : ''}
            </span>
            <span className="text-[10px] text-slate-600 font-mono">
              sorted by <span className="text-indigo-400">{sortCol}</span> {sortAsc ? '↑' : '↓'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
