'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Shield, Key, Trash2, Plus, ArrowLeft, Palette, Check, Zap, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHyperliquidSession } from '@/hooks/useHyperliquidSession';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ApiKey {
    id: string;
    label?: string;
    exchange?: string;
    api_key_masked?: string;
}

export default function SettingsPage() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newKey, setNewKey] = useState({ exchange: 'binance', api_key: '', api_secret: '', label: '' });
    const [notification, setNotification] = useState<{ title: string; message: string; type: 'success' | 'error' | 'neutral' } | null>(null);

    const { token, isAuthenticated } = useAuth();
    const { theme, setTheme } = useTheme();
    const { isAgentActive, agent, clearSession, isLoading: sessionLoading, error: sessionError } = useHyperliquidSession();
    const router = useRouter();

    const themes = [
        { id: 'neon', name: 'HyperSentry Neon', desc: 'Original high-contrast look', colors: ['#050505', '#10b981', '#ef4444'] },
        { id: 'midnight', name: 'Midnight Blue', desc: 'Deep blue professional tones', colors: ['#020617', '#38bdf8', '#ef4444'] },
        { id: 'stealth', name: 'Stealth Grey', desc: 'Low-profile muted colors', colors: ['#0a0a0a', '#a0a0a0', '#4fd1c5'] },
        { id: 'matrix', name: 'Digital Matrix', desc: 'Retro hacker aesthetic', colors: ['#000000', '#00ff41', '#008f11'] },
    ] as const;

    const fetchKeys = useCallback(async () => {
        if (!token) return;
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            const res = await axios.get(`${apiUrl}/settings/keys`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (Array.isArray(res.data.keys)) {
                setKeys(res.data.keys as ApiKey[]);
            } else {
                setKeys([]);
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error('Failed to load keys:', message);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (isAuthenticated) {
            void fetchKeys();
        }
    }, [isAuthenticated, fetchKeys]);

    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const handleAddKey = async () => {
        if (!newKey.api_key || !newKey.api_secret) {
            setNotification({
                title: "Validation Error",
                message: "Please enter both API Key and Secret to proceed.",
                type: 'error'
            });
            return;
        }

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            await axios.post(`${apiUrl}/settings/keys`, newKey, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setShowAddModal(false);
            fetchKeys();
            setNewKey({ exchange: 'binance', api_key: '', api_secret: '', label: '' });
            setNotification({
                title: "Success",
                message: "API Key connected and encrypted successfully.",
                type: 'success'
            });
        } catch (e) {
            const message =
                (typeof e === 'object' &&
                    e !== null &&
                    'response' in e &&
                    typeof (e as { response?: { data?: { detail?: string } } }).response?.data?.detail === 'string'
                    ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
                    : null) ||
                (e instanceof Error ? e.message : 'Failed to connect exchange key');
            setNotification({
                title: "Connection Failed",
                message,
                type: 'error'
            });
        }
    };

    const handleDelete = async (id: string, label?: string) => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            await axios.delete(`${apiUrl}/settings/keys/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setNotification({
                title: "Key Removed",
                message: `Connection to ${label || 'exchange'} has been terminated.`,
                type: 'neutral'
            });
            fetchKeys();
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto text-gray-200">
            <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition"
            >
                <ArrowLeft size={20} /> Back to Dashboard
            </button>

            <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
                <Shield className="text-[var(--color-primary)]" /> Settings & Configuration
            </h1>

            {/* Appearance Section */}
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 backdrop-blur-sm mb-8">
                <h2 className="text-xl font-bold flex items-center gap-2 mb-6 text-white">
                    <Palette className="text-[var(--color-primary)]" /> Interface Appearance
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {themes.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setTheme(t.id)}
                            className={`flex flex-col gap-3 p-4 rounded-xl border text-left transition-all relative overflow-hidden group ${theme === t.id
                                ? 'bg-white/5 border-[var(--color-primary)]/50 ring-1 ring-[var(--color-primary)]/20'
                                : 'bg-transparent border-[var(--glass-border)] hover:border-white/20 hover:bg-white/[0.02]'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className={`font-bold transition-colors ${theme === t.id ? 'text-[var(--color-primary)]' : 'text-white'}`}>
                                        {t.name}
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                        {t.desc}
                                    </span>
                                </div>
                                {theme === t.id && (
                                    <div className="w-5 h-5 bg-[var(--color-primary)] rounded-full flex items-center justify-center">
                                        <Check className="w-3 h-3 text-black stroke-[3]" />
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-1.5 mt-auto">
                                {t.colors.map((c, i) => (
                                    <div key={i} className="w-6 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                                ))}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {!isAuthenticated ? (
                <div className="flex flex-col items-center justify-center p-12 bg-gray-900/50 border border-gray-800 rounded-2xl">
                    <Shield className="w-16 h-16 text-gray-600 mb-4" />
                    <h2 className="text-xl font-bold mb-2 text-white">Login Required for Keys</h2>
                    <p className="text-gray-400 mb-6 text-center max-w-md text-sm">
                        Please sign in to securely manage your API keys and enable automated trading execution.
                    </p>
                    <Link href="/" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition">
                        Wait, I need to Login first
                    </Link>
                </div>
            ) : (
                <>
                    {/* Hyperliquid Agent Session Hub */}
                    <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 backdrop-blur-sm mb-8 relative overflow-hidden">
                        {isAgentActive && (
                            <div className="absolute top-0 right-0 p-4">
                                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-black uppercase tracking-tighter shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Active Session
                                </span>
                            </div>
                        )}

                        <h2 className="text-xl font-bold flex items-center gap-2 mb-2 text-white">
                            <Zap className="text-[var(--color-primary)]" /> 1-Click Terminal Agent
                        </h2>
                        <p className="text-gray-500 text-xs mb-6 max-w-xl">
                            Self-custodial agent wallet generated in your browser. This allows your terminal to trade without asking for a signature on every order.
                            <span className="text-[var(--color-primary)]/80 ml-1 font-medium">Your master private key never leaves your wallet extension.</span>
                        </p>

                        {!isAgentActive ? (
                            <div className="flex flex-col items-center justify-center p-8 bg-black/20 rounded-xl border border-dashed border-gray-800">
                                <Zap className="w-10 h-10 text-gray-700 mb-3" />
                                <p className="text-gray-400 text-sm mb-4">No active trading agent found in this browser session.</p>
                                <button
                                    onClick={() => router.push('/')}
                                    className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold transition-all"
                                >
                                    Enable in Terminal
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-emerald-500/20">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                            <Shield className="w-6 h-6 text-emerald-400" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-0.5">Active Agent Address</div>
                                            <div className="font-mono text-sm text-gray-200">{agent?.address}</div>
                                            <div className="text-[9px] text-emerald-500/60 mt-1 font-medium">Authorized for trading on Hyperliquid L1</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (confirm("Revoke agent session? You'll need to re-approve a new agent to use 1-Click trading.")) {
                                                clearSession();
                                            }
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl transition-all font-bold text-xs"
                                    >
                                        <LogOut size={14} /> Revoke Local Session
                                    </button>
                                </div>
                                <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                                    <p className="text-[10px] text-blue-400/80 leading-relaxed italic">
                                        Note: Revoking here clears the local session. To fully revoke on-chain authority, you must sign a new ApproveAgent action or use the Hyperliquid official interface.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Keys List */}
                    <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 backdrop-blur-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                                <Key className="text-[var(--color-accent-blue)]" /> Connected Exchanges
                            </h2>
                            <button
                                onClick={() => setShowAddModal(true)}
                                className="px-4 py-2 bg-[var(--color-primary)] hover:opacity-90 rounded-lg flex items-center gap-2 font-bold transition text-sm text-black"
                            >
                                <Plus size={18} /> Connect New
                            </button>
                        </div>

                        <div className="space-y-4">
                            {keys.length === 0 && !isLoading && (
                                <div className="text-gray-500 text-center py-8 text-sm italic">
                                    No API keys connected. Add your exchange keys to enable automated execution.
                                </div>
                            )}

                            {keys.map(k => {
                                const exchange = k.exchange || 'exchange';
                                return (
                                <div key={k.id} className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-gray-800/50 hover:border-gray-700 transition group">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${exchange === 'binance' ? 'bg-[#FCD535] text-black shadow-[0_0_15px_rgba(252,213,53,0.2)]' : 'bg-[#00ff9d] text-black shadow-[0_0_15px_rgba(0,255,157,0.2)]'}`}>
                                            {exchange[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="font-bold capitalize text-white">{exchange}</div>
                                            <div className="font-mono text-sm text-gray-400">{k.api_key_masked || 'hidden'}</div>
                                            {k.label && <div className="text-xs text-gray-500">{k.label}</div>}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(k.id)}
                                        className="p-2 text-gray-700 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            )})}
                        </div>
                    </div>

                    {/* Add Modal */}
                    {showAddModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
                            <div className="bg-gray-950 border border-gray-800 p-8 rounded-3xl w-full max-w-md shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
                                <h3 className="text-2xl font-bold mb-6 text-white">Connect Exchange</h3>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Exchange Network</label>
                                        <select
                                            value={newKey.exchange}
                                            onChange={(e) => setNewKey({ ...newKey, exchange: e.target.value })}
                                            className="w-full bg-black/40 border border-gray-800 rounded-xl p-3.5 text-white outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                                        >
                                            <option value="binance">Binance Futures</option>
                                            <option value="hyperliquid">Hyperliquid (EVM)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">API Key / Public Address</label>
                                        <input
                                            type="text"
                                            value={newKey.api_key}
                                            onChange={(e) => setNewKey({ ...newKey, api_key: e.target.value })}
                                            className="w-full bg-black/40 border border-gray-800 rounded-xl p-3.5 text-white outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all font-mono text-sm"
                                            placeholder={newKey.exchange === 'hyperliquid' ? "0x..." : "API Key"}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">API Secret / Private Key</label>
                                        <input
                                            type="password"
                                            value={newKey.api_secret}
                                            onChange={(e) => setNewKey({ ...newKey, api_secret: e.target.value })}
                                            className="w-full bg-black/40 border border-gray-800 rounded-xl p-3.5 text-white outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all font-mono text-sm"
                                            placeholder="Stored encrypted (never shared)"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Label (Optional)</label>
                                        <input
                                            type="text"
                                            value={newKey.label}
                                            onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                                            className="w-full bg-black/40 border border-gray-800 rounded-xl p-3.5 text-white outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all text-sm"
                                            placeholder="e.g. Main Account"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-4 mt-8">
                                    <button
                                        onClick={() => setShowAddModal(false)}
                                        className="flex-1 py-3 text-gray-500 hover:text-white font-bold transition-colors text-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleAddKey}
                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-white shadow-lg shadow-blue-500/20 transition-all active:scale-95 text-sm"
                                    >
                                        Securely Save
                                    </button>
                                </div>

                                <p className="mt-6 text-center text-[10px] text-gray-600 flex items-center justify-center gap-2 uppercase font-black tracking-tighter">
                                    <Shield size={10} />
                                    AES-256 BANK-GRADE ENCRYPTION ACTIVE
                                </p>
                            </div>
                        </div>
                    )}
                    {/* Notifications */}
                    {notification && (
                        <div className={`fixed top-6 right-6 z-[100] p-4 rounded-xl border backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 max-w-sm
                            ${notification.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' :
                                notification.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-100' :
                                    'bg-gray-800/90 border-gray-700 text-gray-200'}`}>
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${notification.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                                        notification.type === 'error' ? 'bg-red-500/20 text-red-400' :
                                            'bg-gray-700 text-gray-400'
                                    }`}>
                                    {notification.type === 'success' ? <Check size={18} /> :
                                        notification.type === 'error' ? <Shield size={18} /> :
                                            <Zap size={18} />}
                                </div>
                                <div>
                                    <div className="text-xs font-black uppercase tracking-widest leading-none mb-1">{notification.title}</div>
                                    <div className="text-[11px] opacity-70 leading-snug">{notification.message}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
