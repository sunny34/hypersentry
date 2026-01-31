'use client';
import { useState, useRef, useEffect } from 'react';
import { useAccount } from 'wagmi';
import axios from 'axios';
import { TrendingUp, TrendingDown, Loader2, AlertCircle, ChevronDown, Settings, Info } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface OrderFormProps {
    symbol: string;
    currentPrice: number;
    isAuthenticated: boolean;
    onLogin: () => void;
}

type OrderType = 'market' | 'limit';
type ProOrderType = 'none' | 'scale' | 'twap' | 'stop_limit' | 'stop_market';
type MarginMode = 'cross' | 'isolated';

export default function OrderForm({ symbol, currentPrice, isAuthenticated, onLogin }: OrderFormProps) {
    // Order State
    const { isConnected } = useAccount();
    const isAuth = isAuthenticated || isConnected;

    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [orderType, setOrderType] = useState<OrderType>('market');
    const [proType, setProType] = useState<ProOrderType>('none');
    const [size, setSize] = useState<string>('');
    const [price, setPrice] = useState<string>('');
    const [leverage, setLeverage] = useState<number>(20);
    const [marginMode, setMarginMode] = useState<MarginMode>('cross');

    // Advanced Options
    const [reduceOnly, setReduceOnly] = useState(false);
    const [tpSlEnabled, setTpSlEnabled] = useState(false);
    const [takeProfit, setTakeProfit] = useState('');
    const [stopLoss, setStopLoss] = useState('');

    // UI State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showProMenu, setShowProMenu] = useState(false);
    const proMenuRef = useRef<HTMLDivElement>(null);

    // Close pro menu on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (proMenuRef.current && !proMenuRef.current.contains(event.target as Node)) {
                setShowProMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // AI / Risk Analysis
    const walletBalance = 12450.00; // Mock balance for now (replace with hook later)
    const orderValue = parseFloat(size || '0') * (parseFloat(price) || currentPrice);
    const marginRequired = orderValue / leverage;

    const portfolioAllocation = (marginRequired / walletBalance) * 100;
    const isHighRisk = portfolioAllocation > 20 || leverage > 20;

    // Liquidation Price Approximation
    // Est Liq = Entry * (1 - 1/Lev) for Long
    const entryPriceNum = parseFloat(price) || currentPrice;
    const liqPrice = side === 'buy'
        ? entryPriceNum * (1 - (1 / leverage) + 0.005)
        : entryPriceNum * (1 + (1 / leverage) - 0.005);

    // AI Suggestions
    const suggestedSL = side === 'buy'
        ? (entryPriceNum * 0.95).toFixed(2) // -5%
        : (entryPriceNum * 1.05).toFixed(2); // +5%

    const feeRate = 0.00025;
    const estFees = orderValue * feeRate;

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
            const finalOrderType = proType !== 'none' ? proType : orderType;

            const payload = {
                token: symbol,
                side,
                size: parseFloat(size),
                price: parseFloat(price) || null, // Auto-use market price if null/market
                order_type: finalOrderType.replace('_', ''), // map stop_limit -> stoplimit etc per backend?
                leverage,
                margin_mode: marginMode,
                reduce_only: reduceOnly,
                tp_sl: tpSlEnabled ? { tp: parseFloat(takeProfit), sl: parseFloat(stopLoss) } : null
            };

            const res = await axios.post(`${API_URL}/trading/order`, payload);

            if (res.data.simulated) {
                setResult({ success: true, message: `⚠️ Simulation: ${side.toUpperCase()} ${size} ${symbol}` });
            } else {
                setResult({ success: true, message: `✅ Order placed: ${side.toUpperCase()} ${size} ${symbol}` });
            }
        } catch (e: any) {
            // Handle generic or specific errors
            console.error(e);
            setResult({ success: false, message: e.response?.data?.detail || 'Order failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full gap-4 text-sm select-none">
            {/* Top Row: Margin Mode & Leverage */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setMarginMode(m => m === 'cross' ? 'isolated' : 'cross')}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg py-1.5 font-bold text-gray-300 transition text-xs uppercase"
                >
                    {marginMode}
                </button>
                <div className="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-lg px-2">
                    <span className="text-gray-400 text-xs mr-2">Lev</span>
                    <input
                        type="number"
                        value={leverage}
                        onChange={(e) => setLeverage(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="bg-transparent w-full text-right font-bold text-gray-200 focus:outline-none text-xs"
                    />
                    <span className="text-gray-500 text-xs ml-0.5">x</span>
                </div>
            </div>

            {/* Tabs: Market / Limit / Pro */}
            <div className="flex border-b border-gray-800">
                {['Market', 'Limit'].map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => { setOrderType(t.toLowerCase() as OrderType); setProType('none'); }}
                        className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${orderType === t.toLowerCase() && proType === 'none'
                            ? 'border-blue-500 text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        {t}
                    </button>
                ))}

                {/* Pro Dropdown */}
                <div className="relative" ref={proMenuRef}>
                    <button
                        type="button"
                        onClick={() => setShowProMenu(!showProMenu)}
                        className={`px-4 py-2 text-xs font-bold border-b-2 flex items-center gap-1 transition-colors ${proType !== 'none'
                            ? 'border-blue-500 text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        {proType === 'none' ? 'Pro' : proType.replace('_', ' ')}
                        <ChevronDown className="w-3 h-3" />
                    </button>

                    {showProMenu && (
                        <div className="absolute top-full left-0 mt-1 w-32 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-20 py-1">
                            {['Scale', 'TWAP', 'Stop Limit', 'Stop Market'].map((pt) => (
                                <button
                                    key={pt}
                                    type="button"
                                    onClick={() => {
                                        setProType(pt.toLowerCase().replace(' ', '_') as ProOrderType);
                                        setShowProMenu(false);
                                    }}
                                    className="block w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
                                >
                                    {pt}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Info Row */}
            <div className="flex justify-between text-[11px] text-gray-500 px-1">
                <span>Available to Trade</span>
                <span className="text-gray-300 font-mono">$12,450.00</span>
            </div>

            {/* Side Toggle (Green/Red) */}
            <div className="grid grid-cols-2 gap-2 bg-gray-900/50 p-1 rounded-lg">
                <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`py-2 rounded-md text-sm font-bold transition-all ${side === 'buy'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                        : 'text-gray-500 hover:text-gray-400'
                        }`}
                >
                    Buy / Long
                </button>
                <button
                    type="button"
                    onClick={() => setSide('sell')}
                    className={`py-2 rounded-md text-sm font-bold transition-all ${side === 'sell'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                        : 'text-gray-500 hover:text-gray-400'
                        }`}
                >
                    Sell / Short
                </button>
            </div>

            {/* Inputs */}
            <div className="space-y-3">
                {/* Price Input (if not Market) */}
                {(orderType === 'limit' || proType !== 'none') && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-gray-500 text-xs">Price</span>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder={currentPrice.toFixed(2)}
                                className="bg-transparent text-right font-mono text-sm focus:outline-none w-24 text-white"
                            />
                            <span className="text-gray-500 text-xs">USD</span>
                        </div>
                    </div>
                )}

                {/* Size Input */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-gray-500 text-xs">Size</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            placeholder="0.00"
                            className="bg-transparent text-right font-mono text-sm focus:outline-none w-24 text-white"
                        />
                        <span className="text-gray-500 text-xs">{symbol}</span>
                    </div>
                </div>

                {/* Percentage Slider */}
                <div className="px-1">
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        onChange={(e) => {
                            // Mock calculation: assume $1000 balance for demo
                            const percent = parseInt(e.target.value);
                            const maxUsd = 1000 * leverage;
                            const calcSize = (maxUsd * (percent / 100)) / (parseFloat(price) || currentPrice);
                            setSize(calcSize.toFixed(4));
                        }}
                    />
                    <div className="flex justify-between text-[10px] text-gray-600 mt-1 font-mono">
                        <span>0%</span>
                        <span>25%</span>
                        <span>50%</span>
                        <span>75%</span>
                        <span>100%</span>
                    </div>
                </div>
            </div>

            {/* AI Risk & Suggestions Area */}
            {size && (
                <div className={`rounded-lg p-2 text-xs border ${isHighRisk ? 'bg-red-500/10 border-red-500/30' : 'bg-blue-500/10 border-blue-500/30'}`}>
                    <div className="flex items-center gap-1.5 mb-1 font-bold">
                        <Info className="w-3 h-3" />
                        {isHighRisk ? 'High Risk Warning' : 'AI Trading Assistant'}
                    </div>
                    <p className="text-gray-400 mb-2">
                        {isHighRisk
                            ? `Caution: This trade uses ${portfolioAllocation.toFixed(1)}% of your wallet with ${leverage}x leverage.`
                            : 'Trade looks healthy. Consider setting a stop loss.'}
                    </p>

                    {/* Smart Suggestion Chips */}
                    {!tpSlEnabled && (
                        <button
                            type="button"
                            onClick={() => {
                                setTpSlEnabled(true);
                                setStopLoss(suggestedSL);
                            }}
                            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-2 py-1 transition-colors text-xs text-blue-300"
                        >
                            <span>💡 Suggest SL: {suggestedSL}</span>
                        </button>
                    )}
                </div>
            )}

            {/* TP/SL Checkbox */}
            <div>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                        type="checkbox"
                        checked={tpSlEnabled}
                        onChange={(e) => setTpSlEnabled(e.target.checked)}
                        className="rounded border-gray-700 bg-gray-800 text-blue-500 focus:ring-0 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-gray-400">Take Profit / Stop Loss</span>
                </label>

                {tpSlEnabled && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded px-2 py-1.5 flex flex-col">
                            <span className="text-[10px] text-gray-500">Take Profit</span>
                            <input
                                type="number"
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(e.target.value)}
                                className="bg-transparent text-xs font-mono focus:outline-none text-emerald-400"
                                placeholder="Target"
                            />
                        </div>
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded px-2 py-1.5 flex flex-col">
                            <span className="text-[10px] text-gray-500">Stop Loss</span>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(e.target.value)}
                                className="bg-transparent text-xs font-mono focus:outline-none text-red-400"
                                placeholder={suggestedSL}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Order Details Summary */}
            <div className="space-y-1.5 pt-2 border-t border-gray-800/50">
                <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Order Value</span>
                    <span className="text-gray-300 font-mono">${orderValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Margin Required</span>
                    <span className="text-gray-300 font-mono">${marginRequired.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Est. Liquidation</span>
                    <span className="text-orange-400 font-mono">${liqPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Est. Fees</span>
                    <span className="text-gray-400 font-mono">${estFees.toFixed(3)}</span>
                </div>
            </div>

            {/* Submit Button */}
            <button
                type="submit"
                disabled={isSubmitting || !size}
                className={`w-full py-3 rounded-lg font-bold text-sm transition-all mt-auto shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${side === 'buy'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20'
                    : 'bg-red-500 hover:bg-red-400 text-white shadow-red-500/20'
                    }`}
            >
                {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : !isAuth ? (
                    'Connect Wallet'
                ) : (
                    `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`
                )}
            </button>

            {/* Result Message */}
            {result && (
                <div className={`flex items-center gap-2 p-2 rounded-lg text-xs mt-2 ${result.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {result.message}
                </div>
            )}
        </form>
    );
}
