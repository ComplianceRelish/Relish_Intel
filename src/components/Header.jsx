import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { HS_CODES } from '../config/hsCodes';
import { SOURCES } from '../config/sources';

export default function Header() {
  const { user, signOut } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border-b border-indigo-500/30 px-6 py-5">
      <div className="flex items-center gap-4 mb-2">
        {/* Logo */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-black text-white shrink-0">
          R
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Relish Market Intelligence
          </h1>
          <p className="text-[11px] text-slate-400">
            {SOURCES.length} data sources · {Object.keys(HS_CODES).length} HS codes · CalciWorks + ClamFlow
          </p>
        </div>

        {/* User menu */}
        {user && (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 hover:border-indigo-500/50 transition-colors text-xs"
            >
              <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-[10px] font-bold">
                {(user.user_metadata?.display_name || user.email)?.[0]?.toUpperCase() || '?'}
              </div>
              <span className="text-slate-300 hidden sm:inline">
                {user.user_metadata?.display_name || user.email?.split('@')[0]}
              </span>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[160px]">
                <div className="px-3 py-2 border-b border-slate-700">
                  <p className="text-[11px] text-white font-medium">{user.email}</p>
                  <p className="text-[9px] text-slate-500">Relish Group</p>
                </div>
                <button
                  onClick={() => { signOut(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors rounded-b-lg"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* HS Code Badges */}
      <div className="flex flex-wrap gap-1 mt-3">
        {Object.entries(HS_CODES).map(([code, hs]) => (
          <span
            key={code}
            className="text-[9px] px-1.5 py-0.5 rounded font-mono border"
            style={{
              backgroundColor: hs.color + '22',
              color: hs.color,
              borderColor: hs.color + '44',
            }}
          >
            {code} {hs.shortName}
          </span>
        ))}
      </div>
    </header>
  );
}
