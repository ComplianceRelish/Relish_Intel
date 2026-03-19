import { useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { askClaude } from '../services/api';
import { savePriceSnapshot, getLatestPriceSnapshot } from '../services/db';
import { parseJSON } from '../utils/formatters';

const PRODUCTS = [
  { name: 'Hydroxyapatite powder', grades: 'industrial (>95%), food/cosmetic (>98%), medical (>99.5%), nano-HAp', color: '#a855f7' },
  { name: 'Ground Calcium Carbonate (GCC)', grades: 'filler, food, coated, paper coating', color: '#2563eb' },
  { name: 'Calcium Oxide (Quicklime)', grades: 'industrial, food, water treatment', color: '#dc2626' },
  { name: 'Calcium Lactate', grades: 'food grade, pharmaceutical', color: '#059669' },
  { name: 'Phosphoric Acid 85% (input)', grades: 'technical, food grade', color: '#d97706' },
  { name: 'Frozen Clam Meat (Villorita/Corbicula/Yellow)', grades: 'IQF shell-on, IQF shucked, block frozen, blanched', color: '#0e7490' },
  { name: 'Dried Clam Meat', grades: 'sun-dried, oven-dried, smoked, salted-dried', color: '#7c3aed' },
  { name: 'Fresh/Chilled Clam Meat', grades: 'fresh shucked, vacuum packed, MAP', color: '#0891b2' },
];

// ── Styled price card for a single grade row ──
function PriceRow({ item, color }) {
  const hasPrice = item.priceMin != null && item.priceMax != null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/50 hover:bg-slate-800/30">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-slate-200">{item.grade}</div>
        {item.notes && <div className="text-[10px] text-slate-500 mt-0.5">{item.notes}</div>}
      </div>
      <div className="text-right shrink-0">
        {hasPrice ? (
          <div>
            <span className="text-[13px] font-mono font-bold" style={{ color }}>
              ${item.priceMin}–${item.priceMax}
            </span>
            <span className="text-[10px] text-slate-400 ml-1">/{item.unit?.replace('USD/', '') || 'kg'}</span>
          </div>
        ) : (
          <span className="text-slate-500 text-[11px]">—</span>
        )}
      </div>
      <div className="text-right shrink-0 w-20">
        <div className="text-[10px] text-slate-400">{item.source || '—'}</div>
        {item.moq && <div className="text-[9px] text-slate-600">MOQ: {item.moq}</div>}
      </div>
    </div>
  );
}

export default function Pricing() {
  const { priceData, setPriceData, loading, setLoading, addLog } = useApp();

  useEffect(() => {
    if (!priceData) {
      getLatestPriceSnapshot().then((cached) => {
        if (cached) { setPriceData(cached); addLog('Loaded cached price data', 'info'); }
      });
    }
  }, []); // eslint-disable-line

  // Fetch with 429 retry + exponential backoff
  async function claudeWithRetry(prompt, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await askClaude(prompt);
      } catch (err) {
        if (err.message.includes('429') && attempt < retries) {
          const wait = attempt * 15000; // 15s, 30s, 45s
          addLog(`  ⏳ Rate limited — waiting ${wait / 1000}s (attempt ${attempt}/${retries})...`, 'warn');
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
  }

  const fetchPricing = useCallback(async () => {
    setLoading((p) => ({ ...p, price: true }));
    addLog('Starting Claude AI price research (8 products)...', 'info');

    const results = [];
    for (let idx = 0; idx < PRODUCTS.length; idx++) {
      const prod = PRODUCTS[idx];
      addLog(`🔍 [${idx + 1}/${PRODUCTS.length}] ${prod.name}...`);
      try {
        const { content, parsed } = await claudeWithRetry(
          `Search current 2025-2026 bulk pricing for ${prod.name} across grades: ${prod.grades}. ` +
          `Find from Alibaba, Made-in-China, IndiaMART, industry reports. ` +
          `Return ONLY a valid JSON array, no other text. Format: ` +
          `[{"grade":"...","priceMin":5,"priceMax":25,"unit":"USD/kg","source":"Alibaba","moq":"1 MT","notes":"FOB China"}]`
        );
        const data = parsed || parseJSON(content) || [];
        results.push({ name: prod.name, data: Array.isArray(data) ? data : [], raw: parsed ? null : content, color: prod.color });
        addLog(`  ✓ ${Array.isArray(data) && data.length ? data.length + ' grades found' : 'text response'}`, data?.length ? 'success' : 'warn');
      } catch (err) {
        addLog(`  ✗ ${err.message}`, 'error');
        results.push({ name: prod.name, data: [], error: err.message, color: prod.color });
      }
      // Progressive results — update UI after each product
      setPriceData([...results]);
      // 8s delay between queries to stay under rate limits
      if (idx < PRODUCTS.length - 1) {
        await new Promise((r) => setTimeout(r, 8000));
      }
    }

    setPriceData(results);
    await savePriceSnapshot(results);
    setLoading((p) => ({ ...p, price: false }));
    addLog('Price research complete!', 'success');
  }, [addLog, setLoading, setPriceData]); // eslint-disable-line

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
            Chemicals + clam meat · Searches Alibaba, IndiaMART, ChemAnalyst · ~3 min
          </p>
        </div>
      )}

      {loading.price && !priceData?.length && (
        <div className="empty-state">
          <p className="text-4xl mb-3 animate-pulse">🔍</p>
          <p className="text-slate-400 text-sm">Claude AI is researching pricing...</p>
          <p className="text-slate-600 text-[10px] mt-1">Results appear as each product completes</p>
        </div>
      )}

      {priceData?.map((prod, i) => {
        const color = prod.color || '#6366f1';
        return (
          <div key={i} className="card mb-3.5" style={{ borderColor: color + '33' }}>
            <div className="card-header flex justify-between items-center" style={{ backgroundColor: color + '11', borderColor: color + '22' }}>
              <span style={{ color }}>{prod.name}</span>
              {prod.data.length > 0 && (
                <span className="text-[10px] text-slate-400">{prod.data.length} grades</span>
              )}
            </div>
            {prod.data.length > 0 ? (
              <div>
                {/* Column headers */}
                <div className="flex items-center gap-3 px-4 py-1.5 border-b border-slate-700/50 text-[10px] text-slate-500 uppercase tracking-wider">
                  <div className="flex-1">Grade</div>
                  <div className="text-right shrink-0">Price Range</div>
                  <div className="text-right shrink-0 w-20">Source</div>
                </div>
                {prod.data.map((item, j) => (
                  <PriceRow key={j} item={item} color={color} />
                ))}
              </div>
            ) : (
              <div className="p-4 text-xs text-slate-400">
                {prod.error ? (
                  <div className="flex items-center gap-2">
                    <span className="text-red-500">⚠</span>
                    <span className="text-red-400">{prod.error}</span>
                    {prod.error.includes('429') && (
                      <span className="text-[10px] text-slate-500 ml-2">(Rate limited — try again in a few minutes)</span>
                    )}
                  </div>
                ) : prod.raw ? (
                  <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {prod.raw.slice(0, 2000)}
                  </div>
                ) : (
                  'No data available'
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
