import { useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { askClaude } from '../services/api';
import { saveSpecSnapshot, getLatestSpecSnapshot } from '../services/db';
import { parseJSON } from '../utils/formatters';

const SPEC_QUERIES = [
  {
    product: 'Hydroxyapatite (HAp)',
    query: `HAp grades: Industrial (>95%), Food/Cosmetic (>98%), Toothpaste nano, Medical (>99.5%). Each: purity, particle size, Ca/P, heavy metals, standards, applications. JSON: [{"grade":"...","purity":"...","particleSize":"...","caP_ratio":"...","heavyMetals":{"Pb":"..."},"standards":["..."],"applications":["..."]}]`,
  },
  {
    product: 'Ground CaCO3 (GCC)',
    query: `GCC: Filler, Paper coating, Food (E170), Pharma. CaCO3%, whiteness, D50/D97, moisture, heavy metals, BIS/FSSAI. JSON: [{"grade":"...","purity":"...","whiteness":"...","particleSize":"...","heavyMetals":{"Pb":"..."},"standards":["..."],"applications":["..."]}]`,
  },
  {
    product: 'Calcium Oxide (CaO)',
    query: `CaO: Industrial, Water treatment, Food (E529). CaO%, impurities, reactivity, IS 712. JSON: [{"grade":"...","CaO_pct":"...","impurities":{"MgO":"..."},"reactivity":"...","standards":["..."],"applications":["..."]}]`,
  },
  {
    product: 'Frozen Clam Meat (Export)',
    query: `Frozen clam export: IQF shell-on, IQF shucked, block, blanched. Villorita/Corbicula/Meretrix. Moisture, protein, glaze%, bacteria, heavy metals, GACC/FSSAI. JSON: [{"grade":"...","moisture":"...","protein":"...","bacterialLimits":{"TPC":"...","Salmonella":"..."},"heavyMetals":{"Pb":"..."},"standards":["..."],"applications":["..."]}]`,
  },
  {
    product: 'Dried Clam Meat (Export)',
    query: `Dried clam export: sun-dried, oven-dried, smoked, salted. Moisture<15%, Aw, protein, salt, bacteria, China GB 10136, FSSAI. JSON: [{"grade":"...","moisture":"...","waterActivity":"...","salt":"...","bacterialLimits":{"TPC":"..."},"standards":["..."],"applications":["..."]}]`,
  },
];

// Keys to skip when rendering spec properties
const SKIP_KEYS = new Set(['grade']);

export default function Specs() {
  const { specData, setSpecData, loading, setLoading, addLog } = useApp();

  useEffect(() => {
    if (!specData) {
      getLatestSpecSnapshot().then((cached) => {
        if (cached) { setSpecData(cached); addLog('Loaded cached spec data', 'info'); }
      });
    }
  }, []); // eslint-disable-line

  const fetchSpecs = useCallback(async () => {
    setLoading((p) => ({ ...p, spec: true }));
    addLog('Starting specification research...', 'info');

    const results = [];
    for (const sq of SPEC_QUERIES) {
      addLog(`🔬 ${sq.product}...`);
      try {
        const { content, parsed } = await askClaude(sq.query);
        const data = parsed || parseJSON(content) || [];
        results.push({
          product: sq.product,
          data: Array.isArray(data) ? data : [],
          raw: parsed ? null : content,
        });
        addLog(
          `  → ${Array.isArray(data) && data.length ? data.length + ' grades' : 'text response'}`,
          data?.length ? 'success' : 'warn'
        );
      } catch (err) {
        addLog(`  ✗ ${err.message}`, 'error');
        results.push({ product: sq.product, data: [], error: err.message });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    setSpecData(results);
    await saveSpecSnapshot(results);
    setLoading((p) => ({ ...p, spec: false }));
    addLog('Specification research complete!', 'success');
  }, [addLog, setLoading, setSpecData]);

  const renderValue = (key, value) => {
    if (value == null) return null;

    // Object (e.g. heavyMetals, impurities, bacterialLimits)
    if (typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div key={key}>
          <span className="text-slate-500">{key}:</span>{' '}
          {Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')}
        </div>
      );
    }

    // Array (e.g. standards, applications)
    if (Array.isArray(value)) {
      return (
        <div key={key}>
          <span className="text-slate-500">{key}:</span>{' '}
          {value.map((x, i) => (
            <span
              key={i}
              className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 mr-1"
            >
              {x}
            </span>
          ))}
        </div>
      );
    }

    // Scalar
    return (
      <div key={key}>
        <span className="text-slate-500">{key}:</span> {String(value)}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold">Product Grade Specifications</h2>
          <p className="text-xs text-slate-400 mt-1">
            Source: Claude AI · USP · ISO · BIS · FSSAI · China GB · EU SCCS
          </p>
        </div>
        <button onClick={fetchSpecs} disabled={loading.spec} className="btn-red">
          {loading.spec ? '⏳ AI Researching...' : '🔬 Research Specs'}
        </button>
      </div>

      {!specData && !loading.spec && (
        <div className="empty-state">
          <p className="text-4xl mb-3">🔬</p>
          <p className="text-slate-400 text-sm">
            5 products: HAp, GCC, CaO, Frozen Clam, Dried Clam
          </p>
          <p className="text-slate-500 text-xs mt-2">
            Purity, particle size, heavy metals, standards, quality tests
          </p>
        </div>
      )}

      {loading.spec && !specData && (
        <div className="empty-state">
          <p className="text-4xl mb-3 animate-pulse">🔬</p>
          <p className="text-slate-400 text-sm">Researching specifications...</p>
        </div>
      )}

      {specData?.map((prod, pi) => (
        <div key={pi} className="card mb-5">
          <div className="card-header bg-red-500/5 text-[13px] font-bold">
            {prod.product}
          </div>
          {prod.data.length > 0 ? (
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {prod.data.map((s, si) => (
                <div key={si} className="bg-surface-bg rounded-lg p-3.5 border border-slate-700">
                  <div className="text-[12px] font-bold text-amber-500 mb-2 uppercase">
                    {s.grade}
                  </div>
                  <div className="text-[10px] leading-[1.7] text-slate-300">
                    {Object.entries(s)
                      .filter(([k]) => !SKIP_KEYS.has(k))
                      .map(([k, v]) => renderValue(k, v))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-xs text-slate-400">
              {prod.raw ? (
                <pre className="whitespace-pre-wrap font-mono text-[10px]">
                  {prod.raw.slice(0, 1500)}
                </pre>
              ) : prod.error ? (
                <span className="text-red-500">Error: {prod.error}</span>
              ) : (
                'No data'
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
