import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ── Data state ───────────────────────────────────────────
  const [tradeData, setTradeData] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [buyerData, setBuyerData] = useState(null);
  const [specData, setSpecData] = useState(null);
  const [loading, setLoading] = useState({});

  // ── Activity log ─────────────────────────────────────────
  const [logs, setLogs] = useState([]);

  const addLog = useCallback((msg, type = 'info') => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    setLogs((prev) => [...prev.slice(-150), { ts, msg, type }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // ── Source status (fetched from server) ──────────────────
  const [sourceStatus, setSourceStatus] = useState(null);

  const refreshSourceStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setSourceStatus(data);
      }
    } catch {
      // Server not reachable
    }
  }, []);

  // Fetch status on mount
  useEffect(() => {
    refreshSourceStatus();
  }, [refreshSourceStatus]);

  // ── Context value ────────────────────────────────────────
  const value = {
    tradeData, setTradeData,
    priceData, setPriceData,
    buyerData, setBuyerData,
    specData, setSpecData,
    loading, setLoading,
    logs, addLog, clearLogs,
    sourceStatus, refreshSourceStatus,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be within AppProvider');
  return ctx;
}
