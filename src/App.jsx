import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Header from './components/Header';
import ActivityLog from './components/ActivityLog';
import LoginPage from './pages/LoginPage';
import TradeFlows from './pages/TradeFlows';
import Pricing from './pages/Pricing';
import Buyers from './pages/Buyers';
import Specs from './pages/Specs';
import DataSources from './pages/DataSources';
import ScraperOutput from './pages/ScraperOutput';

const TABS = [
  { path: '/trade', label: 'Trade Flows', icon: '⛴' },
  { path: '/pricing', label: 'Pricing', icon: '💰' },
  { path: '/buyers', label: 'Buyers', icon: '🏭' },
  { path: '/specs', label: 'Specs', icon: '🔬' },
  { path: '/sources', label: 'Data Sources', icon: '⚙️' },
  { path: '/scraper', label: 'Scraper Output', icon: '🗂️' },
];

export default function App() {
  const { user, loading: authLoading } = useAuth();

  // Auth loading spinner
  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-black text-white mx-auto mb-3 animate-pulse">
            R
          </div>
          <p className="text-slate-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → show login page
  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-surface-bg text-slate-200 font-sans">
      <Header />

      {/* Tab Navigation */}
      <nav className="flex gap-0.5 px-6 pt-2.5 border-b border-slate-800 bg-slate-900 overflow-x-auto">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `tab-btn ${isActive ? 'active' : ''}`
            }
          >
            <span className="text-sm">{tab.icon}</span>
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Main layout: content + log sidebar */}
      <div className="flex min-h-[calc(100vh-160px)]">
        <main className="flex-1 p-6 overflow-y-auto max-h-[calc(100vh-160px)]">
          <Routes>
            <Route path="/" element={<Navigate to="/trade" replace />} />
            <Route path="/trade" element={<TradeFlows />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/buyers" element={<Buyers />} />
            <Route path="/specs" element={<Specs />} />
            <Route path="/sources" element={<DataSources />} />
            <Route path="/scraper" element={<ScraperOutput />} />
          </Routes>
        </main>
        <ActivityLog />
      </div>
    </div>
  );
}
