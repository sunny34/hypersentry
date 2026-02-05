'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Key, Trash2, Plus, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
    const [keys, setKeys] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form State
    const [newKey, setNewKey] = useState({ exchange: 'binance', api_key: '', api_secret: '', label: '' });

    const { token, isAuthenticated } = useAuth();

    const fetchKeys = async () => {
        if (!token) return;
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            const res = await axios.get(`${apiUrl}/settings/keys`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.data.keys) setKeys(res.data.keys);
        } catch (e: any) {
            console.error("Failed to load keys:", e.message, e.response?.data, e.toJSON ? e.toJSON() : e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) fetchKeys();
    }, [isAuthenticated, token]);

    const handleAddKey = async () => {
        if (!newKey.api_key || !newKey.api_secret) {
            alert("Please enter both API Key and Secret.");
            return;
        }

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            await axios.post(`${apiUrl}/settings/keys`, newKey, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setShowAddModal(false);
            fetchKeys(); // refresh
            setNewKey({ exchange: 'binance', api_key: '', api_secret: '', label: '' }); // reset
        } catch (e: any) {
            alert(`Failed to add key: ${e.response?.data?.detail || e.message}`);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this key?")) return;
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            await axios.delete(`${apiUrl}/settings/keys/${id}`);
            fetchKeys();
        } catch (e) {
            console.error(e);
        }
    };

    const router = useRouter();

    return (
        <div className="p-6 max-w-4xl mx-auto text-gray-200">
            <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition"
            >
                <ArrowLeft size={20} /> Back to Dashboard
            </button>

            <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
                <Shield className="text-emerald-400" /> Security & Keys
            </h1>

            {!isAuthenticated ? (
                <div className="flex flex-col items-center justify-center p-12 bg-gray-900/50 border border-gray-800 rounded-2xl">
                    <Shield className="w-16 h-16 text-gray-600 mb-4" />
                    <h2 className="text-xl font-bold mb-2">Login Required</h2>
                    <p className="text-gray-400 mb-6 text-center max-w-md">
                        Please sign in to securely manage your API keys and enable automated trading.
                    </p>
                    <a href="/" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition">
                        Wait, I need to Login first
                    </a>
                </div>
            ) : (
                <>
                    {/* Keys List */}
                    <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Key className="text-blue-400" /> Connected Exchanges
                            </h2>
                            <button
                                onClick={() => setShowAddModal(true)}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 font-bold transition"
                            >
                                <Plus size={18} /> Connect New
                            </button>
                        </div>

                        <div className="space-y-4">
                            {keys.length === 0 && !isLoading && (
                                <div className="text-gray-500 text-center py-8">
                                    No API keys connected. Add your exchange keys to enable automated execution.
                                </div>
                            )}

                            {keys.map(k => (
                                <div key={k.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${k.exchange === 'binance' ? 'bg-[#FCD535] text-black' : 'bg-[#00ff9d] text-black'}`}>
                                            {k.exchange[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="font-bold capitalize">{k.exchange}</div>
                                            <div className="font-mono text-sm text-gray-400">{k.api_key_masked}</div>
                                            {k.label && <div className="text-xs text-gray-500">{k.label}</div>}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(k.id)}
                                        className="p-2 text-gray-500 hover:text-red-400 transition"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Add Modal */}
                    {showAddModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                            <div className="bg-gray-900 border border-gray-700 p-8 rounded-2xl w-full max-w-md">
                                <h3 className="text-2xl font-bold mb-6">Connect Exchange</h3>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Exchange</label>
                                        <select
                                            value={newKey.exchange}
                                            onChange={(e) => setNewKey({ ...newKey, exchange: e.target.value })}
                                            className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-white outline-none focus:border-blue-500"
                                        >
                                            <option value="binance">Binance Futures</option>
                                            <option value="hyperliquid">Hyperliquid</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">API Key / Public Address</label>
                                        <input
                                            type="text"
                                            value={newKey.api_key}
                                            onChange={(e) => setNewKey({ ...newKey, api_key: e.target.value })}
                                            className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-white outline-none focus:border-blue-500 font-mono"
                                            placeholder={newKey.exchange === 'hyperliquid' ? "0x..." : "API Key"}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">API Secret / Private Key</label>
                                        <input
                                            type="password"
                                            value={newKey.api_secret}
                                            onChange={(e) => setNewKey({ ...newKey, api_secret: e.target.value })}
                                            className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-white outline-none focus:border-blue-500 font-mono"
                                            placeholder="Stored encrypted (never shared)"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Label (Optional)</label>
                                        <input
                                            type="text"
                                            value={newKey.label}
                                            onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                                            className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-white outline-none focus:border-blue-500"
                                            placeholder="e.g. Main Account"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-4 mt-8">
                                    <button
                                        onClick={() => setShowAddModal(false)}
                                        className="flex-1 py-3 text-gray-400 hover:text-white font-bold"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleAddKey}
                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold text-white shadow-lg shadow-blue-500/20"
                                    >
                                        Securely Save
                                    </button>
                                </div>

                                <p className="mt-4 text-center text-xs text-gray-600 flex items-center justify-center gap-2">
                                    <Shield size={12} />
                                    Keys are encrypted with AES-256 before storage.
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
