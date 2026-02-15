'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { Activity, Shield, Zap, Trash2, Plus, Upload, X, Eye, AlertTriangle, Sparkles, Menu } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import BridgeAlerts from '@/components/BridgeAlerts';
import { useAuth } from '@/contexts/AuthContext';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useSidebar } from '@/contexts/SidebarContext';
import AddWalletModal from '@/components/modals/AddWalletModal';
import ImportModal from '@/components/modals/ImportModal';

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
  const { isCollapsed } = useSidebar();
  const [stats, setStats] = useState<Stats>({ active_wallets: 0, status: 'unknown' });
  const [wallets, setWallets] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      } else {
        // Clear user-specific data when not authenticated
        setWallets([]);
      }
    } catch (e) {
      setStats(prev => ({ ...prev, status: 'offline' }));
    }
  }, [isAuthenticated, token, getAuthConfig]);

  useEffect(() => {
    if (authLoading) return;

    const runFetch = () => {
      void fetchStats();
    };

    const initial = setTimeout(runFetch, 0);
    const interval = setInterval(runFetch, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [authLoading, fetchStats]);

  const deleteWallet = async (addr: string) => {
    try {
      if (!isAuthenticated) return login('wallet');
      await axios.delete(`${API_URL}/wallets/${addr}`, getAuthConfig());
      fetchStats();
    } catch (error: any) {
      if (error.response?.status === 401) return login('wallet');
      console.error('Failed to delete wallet:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 text-white font-sans selection:bg-emerald-500 selection:text-black flex">
      <Sidebar
        view={view}
        setView={setView}
        onImport={() => setShowImport(true)}
        onAdd={() => setShowAdd(true)}
        isMobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className={`flex-1 p-4 lg:p-8 overflow-y-auto transition-all duration-300 ${isCollapsed ? 'lg:ml-20' : 'lg:ml-64'} ml-0`}>
        {/* Top Bar */}
        <header className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 hover:bg-gray-800 rounded-lg text-gray-400"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-2xl lg:text-3xl font-black tracking-tight bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                {view === 'dashboard' ? 'Command Center' : 'Settings'}
              </h1>
              <p className="text-gray-500 text-xs lg:text-sm mt-1">Real-time Hyperliquid intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Login/User Button */}
            <div className="flex items-center gap-4">
              <ConnectButton />

              {!isAuthenticated && (
                <button
                  onClick={() => login('wallet')}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full font-bold text-sm hover:bg-gray-200 transition"
                >
                  <Zap className="w-4 h-4 text-emerald-600 fill-current" />
                  Sign in
                </button>
              )}
            </div>

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

        {/* Global Modals */}
        <AddWalletModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={fetchStats} />
        <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onSuccess={fetchStats} />

      </main>
    </div>
  );
}
