'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { Activity, Shield, Zap, Trash2, Plus, Upload, X, TrendingUp, Eye, AlertTriangle, Sparkles, BarChart3, ExternalLink } from 'lucide-react';
import CSVUpload from '@/components/CSVUpload';
import Sidebar from '@/components/Sidebar';
import BridgeAlerts from '@/components/BridgeAlerts';
import { useAuth } from '@/contexts/AuthContext';

// API Base URL - configured via environment variable for production
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Stats {
  active_wallets: number;
  status: string;
  loading_progress?: string;
  total_alerts?: number;
}

export default function Home() {
  const router = useRouter();
  const { user, token, isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [stats, setStats] = useState<Stats>({ active_wallets: 0, status: 'unknown' });
  const [wallets, setWallets] = useState([]);
  const [twaps, setTwaps] = useState([]);
  const [activeTwaps, setActiveTwaps] = useState([]);
  const [minSize, setMinSize] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState('dashboard');

  // Create axios config with auth header
  const getAuthConfig = useCallback(() => {
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  }, [token]);

  const fetchStats = useCallback(async () => {
    try {
      // Always fetch status (unauthenticated)
      const res = await axios.get(`${API_URL}/`, getAuthConfig());
      setStats(res.data);

      // Only fetch user-specific data when authenticated
      if (isAuthenticated && token) {
        const config = getAuthConfig();
        const res2 = await axios.get(`${API_URL}/wallets`, config);
        setWallets(res2.data.wallets || []);
        const res3 = await axios.get(`${API_URL}/twap`, config);
        setTwaps(res3.data.tokens || []);
        const res4 = await axios.get(`${API_URL}/twap/active`, config);
        setActiveTwaps(res4.data.twaps || []);
        setMinSize(res4.data.min_size || 10000);
      } else {
        // Clear user-specific data when not authenticated
        setWallets([]);
        setTwaps([]);
        setActiveTwaps([]);
      }
    } catch (e) {
      setStats(prev => ({ ...prev, status: 'offline' }));
    }
  }, [isAuthenticated, token, getAuthConfig]);

  useEffect(() => {
    if (!authLoading) {
      fetchStats();
      const interval = setInterval(fetchStats, 5000);
      return () => clearInterval(interval);
    }
  }, [authLoading, fetchStats]);

  const deleteWallet = async (addr: string) => {
    try {
      if (!isAuthenticated) return login('google');
      await axios.delete(`${API_URL}/wallets/${addr}`, getAuthConfig());
      fetchStats();
    } catch (error: any) {
      if (error.response?.status === 401) return login('google');
      console.error('Failed to delete wallet:', error);
    }
  };

  const addWallet = async (e: any) => {
    e.preventDefault();
    try {
      if (!isAuthenticated) return login('google');
      const addr = e.target.addr.value;
      const label = e.target.label.value;
      const isTrading = e.target.mode.checked;
      await axios.post(`${API_URL}/wallets/add`, { address: addr, label: label, active_trading: isTrading }, getAuthConfig());
      setShowAdd(false);
      fetchStats();
    } catch (error: any) {
      if (error.response?.status === 401) return login('google');
      console.error('Failed to add wallet:', error);
    }
  };

  const addTwap = async (e: any) => {
    e.preventDefault();
    try {
      if (!isAuthenticated) return login('google');
      const tokenValue = e.target.token.value;
      await axios.post(`${API_URL}/twap/add`, { token: tokenValue }, getAuthConfig());
      e.target.reset();
      fetchStats();
    } catch (error: any) {
      if (error.response?.status === 401) return login('google');
      console.error('Failed to add TWAP:', error);
    }
  };

  const removeTwap = async (tokenToRemove: string) => {
    try {
      if (!isAuthenticated) return login('google');
      await axios.delete(`${API_URL}/twap/${tokenToRemove}`, getAuthConfig());
      fetchStats();
    } catch (error: any) {
      if (error.response?.status === 401) return login('google');
      console.error('Failed to remove TWAP:', error);
    }
  };

  const updateMinSize = async (e: any) => {
    e.preventDefault();
    try {
      if (!isAuthenticated) return login('google');
      const size = parseFloat(e.target.size.value);
      await axios.post(`${API_URL}/twap/config`, { min_size: size }, getAuthConfig());
      fetchStats();
    } catch (error: any) {
      if (error.response?.status === 401) return login('google');
      console.error('Failed to update min size:', error);
    }
  };

  // Show login prompt if not authenticated - removed to allow public view
  // Authentication is now handled in the header

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 text-white font-sans selection:bg-emerald-500 selection:text-black flex">
      <Sidebar
        view={view}
        setView={setView}
        onImport={() => setShowImport(true)}
        onAdd={() => setShowAdd(true)}
      />

      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        {/* Top Bar */}
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              {view === 'dashboard' ? 'Command Center' : view === 'twap' ? 'Whale Monitor' : 'Settings'}
            </h1>
            <p className="text-gray-500 text-sm mt-1">Real-time Hyperliquid intelligence</p>
          </div>

          <div className="flex items-center gap-4">
            {/* Login/User Button */}
            {!isAuthenticated ? (
              <button
                onClick={() => login('google')}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full font-bold text-sm hover:bg-gray-200 transition"
              >
                <Zap className="w-4 h-4 text-emerald-600 fill-current" />
                Sign in
              </button>
            ) : user && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full border border-gray-700">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">
                  {user.name ? user.name[0].toUpperCase() : 'U'}
                </div>
                <span className="text-sm text-gray-300 font-medium">{user.name}</span>
              </div>
            )}

            {/* Status Indicator */}
            <div className={`flex items-center gap-3 text-sm font-semibold px-5 py-2.5 rounded-full border backdrop-blur-xl shadow-lg transition-all duration-300 ${stats.status === 'loading'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : stats.status === 'running'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-emerald-500/20'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
              <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${stats.status === 'loading' ? 'bg-amber-400' : stats.status === 'running' ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
              {stats.status === 'loading' ? `Loading (${stats.loading_progress})` : stats.status === 'running' ? 'System Online' : 'Offline'}
            </div>
          </div>
        </header>

        {/* Dashboard View */}
        {view === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Active Watchers */}
              <div className="group relative overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-800/50 hover:border-emerald-500/50 transition-all duration-500 backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative flex justify-between items-start">
                  <div>
                    <p className="text-gray-400 text-sm font-medium flex items-center gap-2">
                      <Eye className="w-4 h-4" /> Active Watchers
                    </p>
                    <h2 className="text-5xl font-black mt-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent group-hover:from-emerald-400 group-hover:to-cyan-400 transition-all duration-500">
                      {stats.active_wallets}
                    </h2>
                    <p className="text-gray-600 text-xs mt-2">Addresses being monitored</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                    <Activity className="w-6 h-6 text-emerald-400" />
                  </div>
                </div>
              </div>

              {/* Total Alerts */}
              <div className="group relative overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-800/50 hover:border-amber-500/50 transition-all duration-500 backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative flex justify-between items-start">
                  <div>
                    <p className="text-gray-400 text-sm font-medium flex items-center gap-2">
                      <Zap className="w-4 h-4" /> Total Alerts
                    </p>
                    <h2 className="text-5xl font-black mt-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent group-hover:from-amber-400 group-hover:to-orange-400 transition-all duration-500">
                      {(stats.total_alerts || 0).toLocaleString()}
                    </h2>
                    <p className="text-gray-600 text-xs mt-2">Signals detected (24h)</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-6 h-6 text-amber-400" />
                  </div>
                </div>
              </div>

              {/* System Status */}
              <div className="group relative overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-800/50 hover:border-cyan-500/50 transition-all duration-500 backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative flex justify-between items-start">
                  <div>
                    <p className="text-gray-400 text-sm font-medium flex items-center gap-2">
                      <Shield className="w-4 h-4" /> System Status
                    </p>
                    <h2 className="text-5xl font-black mt-3 text-emerald-400">
                      ✓
                    </h2>
                    <p className="text-gray-600 text-xs mt-2">All systems operational</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
                    <Sparkles className="w-6 h-6 text-cyan-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Bridge Alerts */}
            <BridgeAlerts apiUrl={API_URL} />

            {/* Wallets Table */}
            <div className="rounded-3xl bg-gradient-to-br from-gray-900/60 to-gray-900/30 border border-gray-800/50 backdrop-blur-xl overflow-hidden">
              <div className="p-6 border-b border-gray-800/50 flex justify-between items-center">
                <h3 className="text-xl font-bold flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10">
                    <Activity className="w-5 h-5 text-emerald-400" />
                  </div>
                  Active Listeners
                </h3>
                <span className="text-sm text-gray-500">{wallets.length} wallets</span>
              </div>
              <div className="max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                <table className="w-full">
                  <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase tracking-wider sticky top-0 backdrop-blur-xl">
                    <tr>
                      <th className="p-4 text-left font-semibold">Wallet</th>
                      <th className="p-4 text-left font-semibold">Status</th>
                      <th className="p-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/30">
                    {wallets.map((w: any) => (
                      <tr key={w.address} className="group hover:bg-gray-800/20 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-white group-hover:text-emerald-400 transition">{w.label || 'Unnamed Wallet'}</span>
                            <span className="font-mono text-xs text-gray-500 mt-0.5">{w.address}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2 animate-pulse" />
                            Active
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => deleteWallet(w.address)}
                            className="p-2 rounded-xl text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {wallets.length === 0 && (
                      <tr>
                        <td colSpan={3} className="p-12 text-center">
                          <div className="flex flex-col items-center gap-3 text-gray-500">
                            <Activity className="w-12 h-12 opacity-20" />
                            <p>No active watchers. Use the sidebar to import!</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TWAP / Whale Monitor View */}
        {view === 'twap' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-700">
            {/* Config Card */}
            <div className="rounded-3xl bg-gradient-to-br from-gray-900/60 to-gray-900/30 border border-gray-800/50 backdrop-blur-xl p-6">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20">
                    <BarChart3 className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">TWAP Whale Tracker</h3>
                    <p className="text-gray-500 text-sm">Monitor large orders across tokens</p>
                  </div>
                </div>
                <form onSubmit={updateMinSize} className="flex items-center gap-3">
                  <span className="text-gray-400 text-sm">Min Size:</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      name="size"
                      type="number"
                      defaultValue={minSize}
                      className="bg-black/50 border border-gray-700 rounded-xl pl-7 pr-4 py-2 text-white w-32 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition"
                    />
                  </div>
                  <button type="submit" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl font-bold text-sm transition">
                    Save
                  </button>
                </form>
              </div>

              {/* Add Token Form */}
              <div className="mt-6 pt-6 border-t border-gray-800/50">
                <form onSubmit={addTwap} className="flex gap-3">
                  <input
                    name="token"
                    placeholder="Add tokens (e.g. BTC, ETH, SOL)"
                    className="flex-1 bg-black/50 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none uppercase transition"
                    required
                  />
                  <button type="submit" className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white rounded-xl font-bold transition shadow-lg shadow-blue-500/25">
                    <Plus className="w-5 h-5" />
                  </button>
                </form>

                {/* Token Pills */}
                <div className="flex flex-wrap gap-2 mt-4">
                  {twaps.map((t: any) => (
                    <div key={t} className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 font-mono text-sm group">
                      <button
                        onClick={() => router.push(`/whale/${t}`)}
                        className="flex items-center gap-2 hover:text-white transition"
                      >
                        {t}
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                      </button>
                      <button onClick={() => removeTwap(t)} className="hover:text-red-400 transition ml-2">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {twaps.length === 0 && (
                    <span className="text-gray-600 text-sm italic py-2">No tokens tracked. Add one above to detect whales.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Live Whales Table */}
            {activeTwaps.length > 0 && (
              <div className="rounded-3xl bg-gradient-to-br from-gray-900/60 to-gray-900/30 border border-gray-800/50 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="p-6 border-b border-gray-800/50 flex justify-between items-center">
                  <h3 className="text-xl font-bold flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10">
                      <TrendingUp className="w-5 h-5 text-amber-400" />
                    </div>
                    Live Whale Activity
                    <span className="ml-2 px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">{activeTwaps.length} active</span>
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="p-4 font-semibold">Token</th>
                        <th className="p-4 font-semibold">Side</th>
                        <th className="p-4 font-semibold">Size (USD)</th>
                        <th className="p-4 font-semibold">Duration</th>
                        <th className="p-4 font-semibold">User</th>
                        <th className="p-4 text-right font-semibold">Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/30">
                      {activeTwaps.map((t: any) => (
                        <tr key={t.hash} className="hover:bg-gray-800/20 transition">
                          <td className="p-4 font-bold text-white">{t.token}</td>
                          <td className="p-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${t.side === 'BUY'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                              }`}>
                              {t.side}
                            </span>
                          </td>
                          <td className="p-4 text-white font-mono font-bold">${t.size.toLocaleString()}</td>
                          <td className="p-4 text-gray-400">{t.minutes}m</td>
                          <td className="p-4 font-mono text-xs text-gray-500">{t.user.substring(0, 6)}...{t.user.slice(-4)}</td>
                          <td className="p-4 text-right">
                            <a
                              href={`https://hypurrscan.io/tx/${t.hash}`}
                              target="_blank"
                              className="text-blue-400 hover:text-blue-300 hover:underline text-sm font-medium"
                            >
                              View →
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modals */}
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={() => setShowImport(false)}>
            <div className="w-full max-w-md animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
              <CSVUpload onUploadComplete={() => {
                fetchStats();
                setShowImport(false);
              }} />
            </div>
          </div>
        )}

        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={() => setShowAdd(false)}>
            <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-3xl p-8 w-full max-w-lg relative animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowAdd(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10">
                  <Plus className="w-5 h-5 text-emerald-400" />
                </div>
                Add New Wallet
              </h3>
              <form onSubmit={addWallet} className="space-y-5">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Wallet Address</label>
                  <input
                    name="addr"
                    placeholder="0x..."
                    className="w-full bg-black/50 border border-gray-700 rounded-xl p-4 text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Label (Optional)</label>
                  <input
                    name="label"
                    placeholder="e.g. Alpha Trader"
                    className="w-full bg-black/50 border border-gray-700 rounded-xl p-4 text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition"
                  />
                </div>
                <div className="flex items-center gap-3 p-4 bg-black/30 rounded-xl border border-gray-800">
                  <input type="checkbox" name="mode" className="w-5 h-5 accent-emerald-500 rounded" />
                  <span className="text-sm font-medium">Enable Active Copy Trading</span>
                </div>
                <button type="submit" className="w-full py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-black font-bold rounded-xl transition shadow-lg shadow-emerald-500/25">
                  Start Watching
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
