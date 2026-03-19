import { useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function ActivityLog() {
  const { logs, tradeData, priceData, buyerData, specData, loading, sourceStatus } = useApp();
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const statusItems = [
    { label: 'Comtrade', data: tradeData, ld: loading.trade },
    { label: 'Pricing', data: priceData, ld: loading.price },
    { label: 'Buyers', data: buyerData, ld: loading.buyer },
    { label: 'Specs', data: specData, ld: loading.spec },
  ];

  const configuredKeys = sourceStatus?.configuredSources?.length || 0;

  return (
    <aside className="w-64 bg-slate-900 border-l border-slate-800 lg:flex flex-col shrink-0 hidden">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-800 text-[11px] font-semibold text-slate-500">
        📋 ACTIVITY LOG
      </div>

      {/* Log entries */}
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto px-2.5 py-1.5 font-mono text-[9px] leading-relaxed"
      >
        {logs.length === 0 && (
          <div className="text-slate-700 p-3 text-center">Waiting for commands...</div>
        )}
        {logs.map((l, i) => (
          <div
            key={i}
            className={`py-0.5 ${
              l.type === 'error'
                ? 'text-red-500'
                : l.type === 'success'
                ? 'text-emerald-500'
                : l.type === 'warn'
                ? 'text-amber-500'
                : 'text-slate-500'
            }`}
          >
            <span className="text-slate-700">[{l.ts}]</span> {l.msg}
          </div>
        ))}
      </div>

      {/* Status panel */}
      <div className="px-2.5 py-2 border-t border-slate-800 text-[9px]">
        {statusItems.map(({ label, data, ld }) => (
          <div key={label} className="flex justify-between mb-0.5">
            <span className="text-slate-500">{label}</span>
            <span
              className={
                data ? 'text-emerald-500' : ld ? 'text-amber-500' : 'text-slate-500'
              }
            >
              {data ? '✓' : ld ? '⏳' : '○'}
            </span>
          </div>
        ))}
        <div className="border-t border-slate-800 mt-1 pt-1 flex justify-between">
          <span className="text-slate-500">API Sources</span>
          <span className={configuredKeys > 0 ? 'text-blue-500' : 'text-slate-500'}>
            {configuredKeys > 0 ? `${configuredKeys} active` : 'checking...'}
          </span>
        </div>
      </div>
    </aside>
  );
}
