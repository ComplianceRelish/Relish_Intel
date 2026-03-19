import { useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { askClaude } from '../services/api';
import { saveBuyerSnapshot, getLatestBuyerSnapshot } from '../services/db';
import { parseJSON } from '../utils/formatters';

const SEGMENTS = [
  {
    segment: 'China HAp/Ca-Phosphate buyers',
    query: 'Find major Chinese companies importing hydroxyapatite or calcium phosphate for oral care, cosmetics, medical, supplements. JSON array: [{"company":"...","city":"...","segment":"...","volume":"...","source":"..."}]',
  },
  {
    segment: 'China CaCO3 industrial buyers',
    query: 'Find major Chinese CaCO3 importers for plastics, paper, paint in Guangdong, Zhejiang, Shandong. JSON array: [{"company":"...","city":"...","segment":"...","volume":"...","source":"..."}]',
  },
  {
    segment: 'China frozen clam importers',
    query: 'Find Chinese companies importing frozen clam meat, Corbicula, yellow clam for hotpot, processing. Dalian, Qingdao, Guangzhou, Fujian. JSON array: [{"company":"...","city":"...","segment":"...","volume":"...","source":"..."}]',
  },
  {
    segment: 'China dried clam/shellfish buyers',
    query: 'Find Chinese dried clam meat traders. Premium in Guangdong/Fujian. Guangzhou Yide Road, HK Sheung Wan, Fujian processors. JSON array: [{"company":"...","city":"...","segment":"...","volume":"...","source":"..."}]',
  },
  {
    segment: 'India domestic CaCO3/HAp buyers',
    query: 'Find major Indian buyers of GCC or HAp for plastics, paints, toothpaste in Gujarat, Maharashtra, Tamil Nadu. JSON array: [{"company":"...","city":"...","segment":"...","volume":"...","source":"..."}]',
  },
  {
    segment: 'China general shellfish importers',
    query: 'Find Chinese companies importing clams, shellfish, bivalves. Dalian, Qingdao, Guangzhou, Shanghai. JSON array: [{"company":"...","city":"...","segment":"...","volume":"...","source":"..."}]',
  },
];

export default function Buyers() {
  const { buyerData, setBuyerData, loading, setLoading, addLog } = useApp();

  useEffect(() => {
    if (!buyerData) {
      getLatestBuyerSnapshot().then((cached) => {
        if (cached) { setBuyerData(cached); addLog('Loaded cached buyer data', 'info'); }
      });
    }
  }, []); // eslint-disable-line

  const fetchBuyers = useCallback(async () => {
    setLoading((p) => ({ ...p, buyer: true }));
    addLog('Starting buyer identification research...', 'info');

    const results = [];
    for (const seg of SEGMENTS) {
      addLog(`🏭 ${seg.segment}...`);
      try {
        const { content, parsed } = await askClaude(seg.query);
        const data = parsed || parseJSON(content) || [];
        results.push({
          segment: seg.segment,
          data: Array.isArray(data) ? data : [],
          raw: parsed ? null : content,
        });
        addLog(
          `  → ${Array.isArray(data) && data.length ? data.length + ' companies' : 'text response'}`,
          data?.length ? 'success' : 'warn'
        );
      } catch (err) {
        addLog(`  ✗ ${err.message}`, 'error');
        results.push({ segment: seg.segment, data: [], error: err.message });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    setBuyerData(results);
    await saveBuyerSnapshot(results);
    setLoading((p) => ({ ...p, buyer: false }));
    addLog('Buyer identification complete!', 'success');
  }, [addLog, setLoading, setBuyerData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold">Buyer Identification</h2>
          <p className="text-xs text-slate-400 mt-1">
            Source: Claude AI · 6 market segments · Trade directories
          </p>
        </div>
        <button onClick={fetchBuyers} disabled={loading.buyer} className="btn-emerald">
          {loading.buyer ? '⏳ AI Researching...' : '🏭 Find Buyers'}
        </button>
      </div>

      {!buyerData && !loading.buyer && (
        <div className="empty-state">
          <p className="text-4xl mb-3">🏭</p>
          <p className="text-slate-400 text-sm">
            Claude AI will search for buyers: China HAp, CaCO3, frozen clam, dried clam, India domestic, shellfish
          </p>
          <p className="text-slate-500 text-xs mt-2">
            💡 Add Volza in Data Sources for verified buyer contacts with phone/email
          </p>
        </div>
      )}

      {loading.buyer && !buyerData && (
        <div className="empty-state">
          <p className="text-4xl mb-3 animate-pulse">🏭</p>
          <p className="text-slate-400 text-sm">Identifying buyers across 6 segments...</p>
        </div>
      )}

      {buyerData?.map((seg, si) => (
        <div key={si} className="card mb-3.5">
          <div className="card-header bg-emerald-500/5">
            {seg.segment}
            {seg.data.length > 0 && (
              <span className="text-emerald-500 ml-2">({seg.data.length} companies)</span>
            )}
          </div>
          {seg.data.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 p-3">
              {seg.data.map((b, bi) => (
                <div
                  key={bi}
                  className="bg-surface-bg rounded-lg p-3 border border-slate-700"
                >
                  <div className="text-[12px] font-semibold text-white">{b.company}</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {b.city && <span>📍 {b.city} · </span>}
                    {b.segment && <span className="text-indigo-400">{b.segment}</span>}
                  </div>
                  {b.volume && (
                    <div className="text-[9px] text-slate-500 mt-1">Vol: {b.volume}</div>
                  )}
                  {b.source && (
                    <div className="text-[9px] text-slate-600 mt-0.5">Source: {b.source}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-xs text-slate-400">
              {seg.raw ? (
                <pre className="whitespace-pre-wrap font-mono text-[10px]">{seg.raw.slice(0, 1200)}</pre>
              ) : seg.error ? (
                <span className="text-red-500">Error: {seg.error}</span>
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
