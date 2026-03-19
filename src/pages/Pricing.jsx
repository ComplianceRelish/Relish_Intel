import { useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { askClaude } from '../services/api';
import { savePriceSnapshot, getLatestPriceSnapshot } from '../services/db';
import { parseJSON } from '../utils/formatters';
import DataTable from '../components/DataTable';

const PRODUCTS = [
  { name: 'Hydroxyapatite powder', grades: 'industrial (>95%), food/cosmetic (>98%), medical (>99.5%), nano-HAp' },
  { name: 'Ground Calcium Carbonate (GCC)', grades: 'filler, food, coated, paper coating' },
  { name: 'Calcium Oxide (Quicklime)', grades: 'industrial, food, water treatment' },
  { name: 'Calcium Lactate', grades: 'food grade, pharmaceutical' },
  { name: 'Phosphoric Acid 85% (input)', grades: 'technical, food grade' },
  { name: 'Frozen Clam Meat (Villorita/Corbicula/Yellow)', grades: 'IQF shell-on, IQF shucked, block frozen, blanched' },
  { name: 'Dried Clam Meat', grades: 'sun-dried, oven-dried, smoked, salted-dried' },
  { name: 'Fresh/Chilled Clam Meat', grades: 'fresh shucked, vacuum packed, MAP' },
];

const TABLE_COLS = [
  { key: 'grade', label: 'Grade', render: (r) => <span className="font-medium">{r.grade}</span> },
  {
    key: 'price', label: 'Price Range', className: 'font-mono',
    render: (r) => (
      <span className="text-emerald-500">
        {r.priceMin != null ? `$${r.priceMin}–$${r.priceMax}` : '—'}
      </span>
    ),
  },
  { key: 'unit', label: 'Unit', render: (r) => <span className="text-slate-400">{r.unit || '—'}</span> },
  { key: 'moq', label: 'MOQ', render: (r) => <span className="text-slate-400">{r.moq || '—'}</span> },
  { key: 'source', label: 'Source', render: (r) => <span className="text-slate-400">{r.source || '—'}</span> },
  { key: 'notes', label: 'Notes', className: 'text-[10px] text-slate-500', render: (r) => r.notes || '—' },
];

export default function Pricing() {
  const { priceData, setPriceData, loading, setLoading, addLog } = useApp();

  useEffect(() => {
    if (!priceData) {
      getLatestPriceSnapshot().then((cached) => {
        if (cached) { setPriceData(cached); addLog('Loaded cached price data', 'info'); }
      });
    }
  }, []); // eslint-disable-line

  const fetchPricing = useCallback(async () => {
    setLoading((p) => ({ ...p, price: true }));
    addLog('Starting Claude AI price research...', 'info');

    const results = [];
    for (const prod of PRODUCTS) {
      addLog(`🔍 ${prod.name}...`);
      try {
        const { content, parsed } = await askClaude(
          `Search current 2025-2026 bulk pricing for ${prod.name} across grades: ${prod.grades}. ` +
          `Find from Alibaba, Made-in-China, IndiaMART, industry reports. Return ONLY JSON array: ` +
          `[{"grade":"...","priceMin":5,"priceMax":25,"unit":"USD/kg","source":"Alibaba","moq":"1 MT","notes":"FOB China"}]`
        );
        const data = parsed || parseJSON(content) || [];
        results.push({ name: prod.name, data: Array.isArray(data) ? data : [], raw: parsed ? null : content });
        addLog(`  → ${Array.isArray(data) ? data.length + ' prices' : 'text response'}`, data?.length ? 'success' : 'warn');
      } catch (err) {
        addLog(`  ✗ ${err.message}`, 'error');
        results.push({ name: prod.name, data: [], error: err.message });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    setPriceData(results);
    await savePriceSnapshot(results);
    setLoading((p) => ({ ...p, price: false }));
    addLog('Price research complete!', 'success');
  }, [addLog, setLoading, setPriceData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold">Pricing Intelligence</h2>
          <p className="text-xs text-slate-400 mt-1">
            Source: Claude AI + web search · Alibaba · Made-in-China · IndiaMART
          </p>
        </div>
        <button onClick={fetchPricing} disabled={loading.price} className="btn-amber">
          {loading.price ? '⏳ AI Researching...' : '🔍 Research Pricing'}
        </button>
      </div>

      {!priceData && !loading.price && (
        <div className="empty-state">
          <p className="text-4xl mb-3">💰</p>
          <p className="text-slate-400 text-sm">
            Claude AI will search the web for current bulk pricing across 8 product categories
          </p>
          <p className="text-slate-500 text-xs mt-2">
            Chemicals + clam meat · Searches Alibaba, indiaMART, ChemAnalyst · ~2 min
          </p>
        </div>
      )}

      {loading.price && !priceData && (
        <div className="empty-state">
          <p className="text-4xl mb-3 animate-pulse">🔍</p>
          <p className="text-slate-400 text-sm">Claude AI is researching pricing...</p>
        </div>
      )}

      {priceData?.map((prod, i) => (
        <div key={i} className="card mb-3.5">
          <div className="card-header bg-indigo-500/5">{prod.name}</div>
          {prod.data.length > 0 ? (
            <DataTable columns={TABLE_COLS} data={prod.data} />
          ) : (
            <div className="p-4 text-xs text-slate-400">
              {prod.raw ? (
                <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed">
                  {prod.raw.slice(0, 1200)}
                </pre>
              ) : prod.error ? (
                <span className="text-red-500">Error: {prod.error}</span>
              ) : (
                'No data available'
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
