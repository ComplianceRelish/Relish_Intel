/**
 * Status badge for data sources
 * @param {'active'|'configured'|'free'|'provision'} status
 */
export default function Badge({ status }) {
  const config = {
    active:     { label: 'ACTIVE',    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
    configured: { label: 'KEY SET',   color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
    free:       { label: 'FREE',      color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    provision:  { label: 'CONFIGURE', color: 'text-slate-500 bg-slate-500/10 border-slate-500/30' },
  };

  const { label, color } = config[status] || config.provision;

  return (
    <span className={`text-[9px] px-2 py-0.5 rounded font-bold border ${color}`}>
      {label}
    </span>
  );
}
