import { useState } from 'react';
import axios from 'axios';
import { X, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface AddWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    apiUrl?: string;
}

export default function AddWalletModal({ isOpen, onClose, onSuccess, apiUrl }: AddWalletModalProps) {
    const { token, isAuthenticated, login } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const API_URL = apiUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

    if (!isOpen) return null;

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (!isAuthenticated) {
                login('wallet');
                return;
            }

            const addr = e.target.addr.value;
            const label = e.target.label.value;
            const isTrading = e.target.mode.checked;

            await axios.post(
                `${API_URL}/wallets/add`,
                { address: addr, label: label, active_trading: isTrading },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (onSuccess) onSuccess();
            onClose();
        } catch (err: any) {
            console.error('Failed to add wallet:', err);
            if (err.response?.status === 401) {
                login('wallet');
            } else {
                setError(err.response?.data?.detail || 'Failed to add wallet. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
            <div
                className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-3xl p-8 w-full max-w-lg relative animate-in zoom-in-95 duration-300"
                onClick={e => e.stopPropagation()}
            >
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition">
                    <X className="w-5 h-5" />
                </button>

                <h3 className="text-2xl font-bold mb-6 flex items-center gap-3 text-white">
                    <div className="p-2 rounded-xl bg-emerald-500/10">
                        <Plus className="w-5 h-5 text-emerald-400" />
                    </div>
                    Add New Wallet
                </h3>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
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
                        <span className="text-sm font-medium text-gray-300">Enable Active Copy Trading</span>
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-black font-bold rounded-xl transition shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Adding...' : 'Start Watching'}
                    </button>
                </form>
            </div>
        </div>
    );
}
