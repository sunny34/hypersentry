'use client';
import { useState } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Loader2, AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface OrderFormProps {
    symbol: string;
    currentPrice: number;
    isAuthenticated: boolean;
    onLogin: () => void;
}

export default function OrderForm({ symbol, currentPrice, isAuthenticated, onLogin }: OrderFormProps) {
    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market');
    const [size, setSize] = useState<string>('');
    const [price, setPrice] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

    const totalValue = parseFloat(size || '0') * (orderType === 'limit' ? parseFloat(price || '0') : currentPrice);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isAuthenticated) {
            onLogin();
            return;
        }

        if (!size || parseFloat(size) <= 0) {
            setResult({ success: false, message: 'Enter a valid size' });
            return;
        }

        setIsSubmitting(true);
        setResult(null);

        try {
            const res = await axios.post(`${API_URL}/trading/order`, {
                token: symbol,
                side,
                size: parseFloat(size),
                price: orderType === 'limit' ? parseFloat(price) : null,
                order_type: orderType,
            });

            if (res.data.simulated) {
                setResult({ success: true, message: `⚠️ Simulation: ${side.toUpperCase()} ${size} ${symbol}` });
            } else {
                setResult({ success: true, message: `✅ Order placed: ${side.toUpperCase()} ${size} ${symbol}` });
            }
        } catch (e: any) {
            setResult({ success: false, message: e.response?.data?.detail || 'Order failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Side Toggle */}
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`py-3 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${side === 'buy'
                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                        : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
                        }`}
                >
                    <TrendingUp className="w-5 h-5" />
                    Buy / Long
                </button>
                <button
                    type="button"
                    onClick={() => setSide('sell')}
                    className={`py-3 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${side === 'sell'
                        ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-500/25'
                        : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
                        }`}
                >
                    <TrendingDown className="w-5 h-5" />
                    Sell / Short
                </button>
            </div>

            {/* Order Type */}
            <div className="flex gap-1 bg-gray-800/30 p-1 rounded-xl overflow-hidden">
                {['market', 'limit', 'stop'].map((type) => (
                    <button
                        key={type}
                        type="button"
                        onClick={() => setOrderType(type as any)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition ${orderType === type
                            ? 'bg-gray-700 text-white shadow-lg'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                            }`}
                    >
                        {type}
                    </button>
                ))}
            </div>

            {/* Size Input */}
            <div>
                <label className="block text-xs text-gray-500 mb-1">Size ({symbol})</label>
                <input
                    type="number"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder="0.00"
                    step="any"
                    className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:border-indigo-500/50 transition"
                />
            </div>

            {/* Price Input (for Limit) */}
            {orderType === 'limit' && (
                <div>
                    <label className="block text-xs text-gray-500 mb-1">Price (USD)</label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder={currentPrice.toFixed(2)}
                        step="any"
                        className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:border-indigo-500/50 transition"
                    />
                </div>
            )}

            {/* Options Row */}
            <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                        <input type="checkbox" className="peer sr-only" />
                        <div className="w-9 h-5 bg-gray-700 rounded-full peer-checked:bg-indigo-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                    </div>
                    <span className="text-xs text-gray-500 group-hover:text-gray-300 transition">Reduce Only</span>
                </label>
            </div>

            {/* Total Value */}
            <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-800/50">
                <span className="text-gray-500">Total Value</span>
                <span className="font-bold text-gray-300">
                    ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
            </div>

            {/* Submit Button */}
            <button
                type="submit"
                disabled={isSubmitting || !size}
                className={`w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${side === 'buy'
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-500/25'
                    : 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/25'
                    }`}
            >
                {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : !isAuthenticated ? (
                    'Sign in to Trade'
                ) : (
                    `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`
                )}
            </button>

            {/* Result Message */}
            {result && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${result.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {result.message}
                </div>
            )}
        </form>
    );
}
