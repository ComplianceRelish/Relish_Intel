import { useApp } from '../context/AppContext';
import { SOURCES, SOURCE_CATEGORIES } from '../config/sources';
import Badge from '../components/Badge';

export default function DataSources() {
  const { sourceStatus } = useApp();

  const configured = sourceStatus?.configuredSources || [];

  const getStatus = (src) => {
    if (src.active) return 'active';
    if (src.needKey && configured.includes(src.id)) return 'configured';
    if (!src.needKey && !src.active) return 'free';
    return 'provision';
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Data Source Configuration</h2>
      <p className="text-xs text-slate-400 mb-5">
        {SOURCES.filter((s) => s.active).length} active ·{' '}
        {configured.length} keys configured ·{' '}
        {SOURCES.length} total sources
      </p>

      {Object.entries(SOURCE_CATEGORIES).map(([catKey, catMeta]) => (
        <div key={catKey} className="mb-6">
          <h3 className="text-[12px] font-bold text-indigo-400 uppercase tracking-widest mb-3">
            {catMeta.icon} {catMeta.label}
          </h3>

          {SOURCES.filter((s) => s.cat === catKey).map((src) => {
            const status = getStatus(src);
            return (
              <div
                key={src.id}
                className={`bg-slate-800 rounded-xl mb-2 p-4 border ${
                  status === 'active'
                    ? 'border-emerald-500/30'
                    : status === 'configured'
                    ? 'border-blue-500/30'
                    : 'border-slate-700'
                }`}
              >
                {/* Title row */}
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{src.icon}</span>
                    <div>
                      <div className="text-[13px] font-semibold">{src.name}</div>
                      <div className="text-[10px] text-slate-500">{src.cost}</div>
                    </div>
                  </div>
                  <Badge status={status} />
                </div>

                {/* Description */}
                <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">{src.desc}</p>

                {/* Data type tags */}
                <div className="flex flex-wrap gap-1 mb-2.5">
                  {src.types.map((t) => (
                    <span
                      key={t}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-surface-bg text-slate-500 border border-slate-700"
                    >
                      {t.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>

                {/* Action links + key input hint */}
                <div className="flex gap-2 items-center flex-wrap">
                  {src.needKey && (
                    <div className="flex-1 min-w-[180px]">
                      <input
                        type="password"
                        placeholder={`Configure ${src.envKey || src.id} in .env`}
                        disabled
                        className="w-full px-2.5 py-1.5 rounded bg-surface-bg border border-slate-700 text-slate-500 text-[11px] font-mono cursor-not-allowed"
                      />
                    </div>
                  )}
                  {src.docs && (
                    <a
                      href={src.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] px-2.5 py-1.5 rounded border border-slate-700 text-indigo-400 hover:text-indigo-300 hover:border-indigo-500/50 transition-colors"
                    >
                      📄 Docs
                    </a>
                  )}
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] px-2.5 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-600 transition-colors"
                  >
                    🔗 Site
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Recommended Setup Order */}
      <div className="bg-gradient-to-br from-indigo-950 to-slate-900 rounded-xl p-5 border border-indigo-500/20 mt-4">
        <h3 className="text-[13px] font-bold text-indigo-400 mb-3">🎯 Recommended Setup Order</h3>
        <div className="text-[11px] text-slate-400 space-y-1.5">
          <div><span className="text-emerald-500 font-bold">1.</span> <strong className="text-white">Comtrade Premium</strong> — Free signup → 200x more data</div>
          <div><span className="text-emerald-500 font-bold">2.</span> <strong className="text-white">Volza</strong> — $1,500/yr → actual buyer names + transaction prices</div>
          <div><span className="text-emerald-500 font-bold">3.</span> <strong className="text-white">Zauba/Seair</strong> — Rs.5-15K/mo → Indian competitor data</div>
          <div><span className="text-amber-500 font-bold">4.</span> <strong className="text-white">ChemAnalyst</strong> — Free tier → weekly CaCO3 + H3PO4 pricing</div>
          <div><span className="text-amber-500 font-bold">5.</span> <strong className="text-white">ECHEMI</strong> — Subscription → daily China chemical prices</div>
          <div><span className="text-slate-500 font-bold">6.</span> <strong className="text-white">Alibaba Open Platform</strong> — Free → supplier API + RFQ</div>
        </div>
        <div className="text-[10px] text-slate-500 mt-4 px-3 py-2 bg-surface-bg rounded-md">
          💡 Sources 1-4 combined: under ₹50,000/mo. More intelligence than any consultant report.
        </div>
        <div className="text-[10px] text-slate-500 mt-2 px-3 py-2 bg-surface-bg rounded-md">
          🔐 API keys are configured in <code className="text-indigo-400">.env</code> on the server — never exposed to the browser.
          Once Supabase is connected, keys can be managed per-user.
        </div>
      </div>
    </div>
  );
}
