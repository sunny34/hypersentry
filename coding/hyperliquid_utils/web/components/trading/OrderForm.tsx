'use client';
import { useState, useRef, useEffect } from 'react';
import { useAccount } from 'wagmi';
import axios from 'axios';
import { TrendingUp, TrendingDown, Loader2, AlertCircle, ChevronDown, Settings, Info, Zap } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Types
type OrderType = 'market' | 'limit';
type ProOrderType = 'none' | 'scale' | 'twap' | 'stop_limit' | 'stop_market';

interface OrderFormProps {
    symbol: string;
    currentPrice: number;
    isAuthenticated: boolean;
    token?: string | null;
    walletBalance?: number;
    agent?: any; // Pass agent object
    isAgentActive?: boolean;
    onEnableAgent?: () => void;
    onLogin: () => void;
    onDeposit?: () => void;
    selectedPrice?: string;
    selectedSize?: string;
}

interface OrderOverrideParams {
    side?: 'buy' | 'sell';
    size?: string | number;
    price?: number | null;
    orderType?: OrderType;
}

/**
 * OrderForm Component
 * 
 * The core trading interface for the Alpha Terminal.
 * Supports Market/Limit orders, advanced "Pro" order types (TWAP, Scale),
 * and "1-Click Trading" via an authorized Agent.
 * Listens for 'smart-trade-execute' events from news/intelligence systems.
 */
export default function OrderForm({
    symbol,
    currentPrice,
    isAuthenticated,
    token,
    walletBalance = 12450.00,
    agent,
    isAgentActive,
    onEnableAgent,
    onLogin,
    onDeposit,
    selectedPrice,
    selectedSize
}: OrderFormProps) {

    // State
    const { isConnected } = useAccount();
    const isAuth = isAuthenticated || isConnected;

    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [price, setPrice] = useState('');
    const [size, setSize] = useState('');
    const [leverage, setLeverage] = useState(1);
    const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');
    const [orderType, setOrderType] = useState<OrderType>('market');
    const [proType, setProType] = useState<ProOrderType>('none');
    const [reduceOnly, setReduceOnly] = useState(false);
    const [tpSlEnabled, setTpSlEnabled] = useState(false);
    const [takeProfit, setTakeProfit] = useState('');
    const [stopLoss, setStopLoss] = useState('');

    // UI State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showProMenu, setShowProMenu] = useState(false);
    const proMenuRef = useRef<HTMLDivElement>(null);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [lastExternalPrice, setLastExternalPrice] = useState<string | undefined>();
    const [lastExternalSize, setLastExternalSize] = useState<string | undefined>();

    /**
     * Updates local state when a price is selected from the orderbook or chart.
     */
    useEffect(() => {
        if (selectedPrice && selectedPrice !== lastExternalPrice) {
            setPrice(selectedPrice);
            setOrderType('limit');
            setLastExternalPrice(selectedPrice);
        }
    }, [selectedPrice, lastExternalPrice]);

    /**
     * Core order execution logic.
     * Supports both manual submission and automated 'override' submission.
     */
    const executeOrder = async (overrideParams?: OrderOverrideParams) => {
        if (!isAuthenticated) {
            onLogin();
            return;
        }

        const finalSize = overrideParams?.size || size;
        if (!finalSize || parseFloat(finalSize.toString()) <= 0) {
            setResult({ success: false, message: 'Invalid order size' });
            return;
        }

        setIsSubmitting(true);
        setResult(null);

        try {
            const finalOrderType = overrideParams?.orderType || (proType !== 'none' ? proType : orderType);
            const isBuy = (overrideParams?.side || side) === 'buy';
            let config: any = { headers: {} };
            if (token) config.headers.Authorization = `Bearer ${token}`;

            // 1-Click Trading: Uses Agent key for low-latency signing
            if (isAgentActive && agent) {
                const { ethers } = await import('ethers');
                const { signAgentAction } = await import('../../utils/signing');

                const wallet = new ethers.Wallet(agent.privateKey);
                const nonce = Date.now();

                // Construct Hyperliquid L1 Action
                const assetId = (window as any)._assetMap?.[symbol] ?? 0;

                const orders: any[] = [
                    {
                        a: assetId,
                        b: isBuy,
                        p: (parseFloat(price) || currentPrice).toString(),
                        s: parseFloat(finalSize.toString()).toString(),
                        r: reduceOnly,
                        t: finalOrderType === 'market'
                            ? { limit: { tif: 'Ioc' } }
                            : { limit: { tif: 'Gtc' } }
                    }
                ];

                // Bundle Safety Guards (TP/SL) if enabled
                if (tpSlEnabled) {
                    if (takeProfit) {
                        orders.push({
                            a: assetId,
                            b: !isBuy,
                            p: takeProfit.toString(),
                            s: parseFloat(finalSize.toString()).toString(),
                            r: true,
                            t: { trigger: { isMarket: true, triggerPx: takeProfit.toString(), tpsl: 'tp' } }
                        });
                    }
                    if (stopLoss) {
                        orders.push({
                            a: assetId,
                            b: !isBuy,
                            p: stopLoss.toString(),
                            s: parseFloat(finalSize.toString()).toString(),
                            r: true,
                            t: { trigger: { isMarket: true, triggerPx: stopLoss.toString(), tpsl: 'sl' } }
                        });
                    }
                }

                const action = {
                    type: "order",
                    orders: orders,
                    grouping: "na"
                };

                const signedPayload = await signAgentAction(wallet, action, nonce);

                const res = await axios.post(`${API_URL}/trading/order`, signedPayload, config);

                if (res.data.status === 'ok' || res.data.status === 'filled') {
                    setResult({
                        success: true,
                        message: `⚡ 1-Click: ${isBuy ? 'LONG' : 'SHORT'} ${finalSize} ${symbol}${tpSlEnabled ? ' + Guards' : ''}`
                    });
                } else if (res.data.status === 'err') {
                    setResult({ success: false, message: res.data.error || res.data.message || 'Execution Error' });
                } else {
                    setResult({ success: true, message: 'Order Dispatched' });
                }

            } else {
                // Managed path (automated TP/SL) still uses backend
                const orderPayload = {
                    token: symbol,
                    side: isBuy ? 'buy' : 'sell',
                    size: parseFloat(finalSize.toString()),
                    price: overrideParams?.price || (parseFloat(price) || null),
                    order_type: finalOrderType.replace('_', ''),
                    leverage,
                    margin_mode: marginMode,
                    reduce_only: reduceOnly,
                    tp_sl: tpSlEnabled ? { tp: parseFloat(takeProfit), sl: parseFloat(stopLoss) } : null
                };

                const res = await axios.post(`${API_URL}/trading/order`, orderPayload, config);
                if (res.data.status === 'err') {
                    setResult({ success: false, message: res.data.error || 'Execution Failed' });
                } else {
                    setResult({ success: true, message: `✅ Order Placed: ${orderPayload.side.toUpperCase()} ${finalSize} ${symbol}` });
                }
            }

        } catch (e: any) {
            console.error('Terminal Order Error:', e);
            setResult({ success: false, message: e.response?.data?.error || e.message || 'Execution Failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await executeOrder();
    };

    /**
     * Intelligent Trade Listener
     * Handles external events from News Hub or AI agents for semi-autonomous trading.
     */
    useEffect(() => {
        const handleSmartTrade = async (e: any) => {
            const { side: smartSide, reason } = e.detail;
            console.log(`🧠 [OrderForm Alpha] Intel Action: ${smartSide.toUpperCase()} | Reason: ${reason}`);

            setSide(smartSide as 'buy' | 'sell');
            setOrderType('market');

            console.info(`🧠 [Production] Intel Sync Triggered | Side: ${smartSide.toUpperCase()} | Reason: ${reason}`);

            const effectiveBalance = walletBalance > 100 ? walletBalance : 10000;
            const riskValue = effectiveBalance * 0.05; // 5% Risk on Alpha Intelligence
            const calcSize = (riskValue / currentPrice).toFixed(4);
            setSize(calcSize);

            // Dynamic Risk Guardians: Automated TP/SL calculation for Intel-driven trades
            const entry = currentPrice;
            const isBuy = smartSide === 'buy';

            console.info(`🛡️ [Production] Calculating Risk Guards | Entry: ${entry} | Side: ${smartSide}`);

            // Institutional Grade Defaults: SL at -1.5%, TP at +3% (2:1 RR)
            const autoSL = isBuy ? (entry * 0.985).toFixed(2) : (entry * 1.015).toFixed(2);
            const autoTP = isBuy ? (entry * 1.03).toFixed(2) : (entry * 0.97).toFixed(2);

            setStopLoss(autoSL);
            setTakeProfit(autoTP);
            setTpSlEnabled(true);

            setResult({ success: true, message: `🧠 News Hub: Syncing ${smartSide.toUpperCase()} (+Auto TP/SL)...` });

            // Visual feedback loop
            const sizeInput = document.getElementById('size-input');
            if (sizeInput) {
                sizeInput.classList.add('ring-4', 'ring-purple-500', 'bg-purple-500/20', 'scale-110');
                setTimeout(() => sizeInput.classList.remove('ring-4', 'ring-purple-500', 'bg-purple-500/20', 'scale-110'), 1500);
            }

            // Automated Execution if 1-Click is enabled
            if (isAgentActive && agent) {
                console.log("⚡️ Terminal Agent: Auto-Executing Smart Intel Order with Risk Guards...");
                setTimeout(() => {
                    executeOrder({
                        side: smartSide,
                        size: calcSize,
                        orderType: 'market'
                    });
                }, 500);
            }
        };

        window.addEventListener('smart-trade-execute', handleSmartTrade);
        return () => window.removeEventListener('smart-trade-execute', handleSmartTrade);
    }, [currentPrice, walletBalance, isAgentActive, agent, symbol]);

    useEffect(() => {
        if (selectedSize && selectedSize !== lastExternalSize) {
            setSize(selectedSize);
            setLastExternalSize(selectedSize);
        }
    }, [selectedSize, lastExternalSize]);

    // Financial Computations
    const orderValue = parseFloat(size || '0') * (parseFloat(price) || currentPrice);
    const marginRequired = orderValue / leverage;
    const portfolioAllocation = walletBalance > 0 ? (marginRequired / walletBalance) * 100 : 0;
    const isHighRisk = portfolioAllocation > 20 || leverage > 20;

    const entryPriceNum = parseFloat(price) || currentPrice;

    // Safety guard for liquidation and Stop Loss calculations
    const liqPrice = entryPriceNum > 0 ? (side === 'buy'
        ? entryPriceNum * (1 - (1 / leverage) + 0.005)
        : entryPriceNum * (1 + (1 / leverage) - 0.005)) : 0;

    const suggestedSL = entryPriceNum > 0 ? (side === 'buy'
        ? (entryPriceNum * 0.95).toFixed(2)
        : (entryPriceNum * 1.05).toFixed(2)) : '0.00';

    const feeRate = 0.00025;
    const estFees = orderValue * feeRate;

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full gap-4 text-sm select-none">
            {/* Control Strip */}
            <div className="flex gap-2">
                <button
                    type="button"
                    title="Switch Margin Mode"
                    onClick={() => setMarginMode(m => m === 'cross' ? 'isolated' : 'cross')}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg py-1.5 font-bold text-gray-300 transition text-xs uppercase"
                >
                    {marginMode}
                </button>
                <div className="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-lg px-2" title="Adjust Leverage">
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

            <div
                onClick={isAgentActive ? undefined : onEnableAgent}
                title={isAgentActive ? "Agent active - orders sign automatically" : "Enable low-latency 1-click trading"}
                className={`
                        flex items-center justify-between px-3 py-2 rounded-lg border transition-all cursor-pointer group
                        ${isAgentActive
                        ? 'bg-[#00ff9d]/5 border-[#00ff9d]/30 text-[#00ff9d] shadow-[0_0_20px_rgba(0,255,157,0.1)]'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30'}
                    `}
            >
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${isAgentActive ? 'bg-[#00ff9d] animate-pulse' : 'bg-gray-500'}`} />
                    <span className="text-[10px] font-black uppercase tracking-wider">1-Click Terminal</span>
                </div>
                <div className={`text-[10px] uppercase font-black transition-opacity ${isAgentActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`}>
                    {isAgentActive ? 'Active' : 'Enable'}
                </div>
            </div>

            {/* Strategy Tabs */}
            <div className="flex border-b border-gray-800">
                {['Market', 'Limit'].map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => { setOrderType(t.toLowerCase() as OrderType); setProType('none'); }}
                        className={`px-4 py-1.5 text-xs font-bold border-b-2 transition-colors ${orderType === t.toLowerCase() && proType === 'none'
                            ? 'border-blue-500 text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        {t}
                    </button>
                ))}

                <div className="relative" ref={proMenuRef}>
                    <button
                        type="button"
                        onClick={() => setShowProMenu(!showProMenu)}
                        className={`px-4 py-1.5 text-xs font-bold border-b-2 flex items-center gap-1 transition-colors ${proType !== 'none'
                            ? 'border-blue-500 text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        {proType === 'none' ? 'Strategy' : proType.replace('_', ' ')}
                        <ChevronDown className="w-3 h-3" />
                    </button>

                    {showProMenu && (
                        <div className="absolute top-full left-0 mt-1 w-32 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-20 py-1">
                            {['Scale', 'TWAP', 'Stop Limit', 'Stop Market'].map((pt) => (
                                <button
                                    key={pt}
                                    type="button"
                                    onClick={() => {
                                        setProType(pt.toLowerCase().replace(' ', '_') as ProOrderType);
                                        setShowProMenu(false);
                                    }}
                                    className="block w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-700 hover:text-white"
                                >
                                    {pt}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Wallet Integration */}
            <div className="flex justify-between items-center text-[10px] text-gray-500 px-1">
                <span className="uppercase font-black tracking-widest text-[8px] opacity-40">Available Term</span>
                <div className="flex items-center gap-2">
                    <span className="text-gray-200 font-mono font-bold">
                        <span className="opacity-40 font-normal">$</span>
                        {Math.floor(walletBalance || 0).toLocaleString()}
                        <span className="opacity-30 text-[9px]">.{(walletBalance % 1).toFixed(3).substring(2)}</span>
                    </span>
                    <button
                        type="button"
                        onClick={onDeposit}
                        className="text-[9px] bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 px-2 py-0.5 rounded transition-all uppercase font-black tracking-tighter border border-blue-500/30"
                    >
                        Deposit
                    </button>
                </div>
            </div>

            {/* Position Side */}
            <div className="grid grid-cols-2 gap-2 bg-gray-900/50 p-1 rounded-lg">
                <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${side === 'buy'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                        : 'text-gray-600 hover:text-gray-500'
                        }`}
                >
                    Long
                </button>
                <button
                    type="button"
                    onClick={() => setSide('sell')}
                    className={`py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${side === 'sell'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                        : 'text-gray-600 hover:text-gray-500'
                        }`}
                >
                    Short
                </button>
            </div>

            {/* Numeric Controls */}
            <div className="space-y-3">
                {(orderType === 'limit' || proType !== 'none') && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-gray-500 text-[10px] font-bold uppercase">Price</span>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder={currentPrice.toFixed(2)}
                                className="bg-transparent text-right font-mono text-xs focus:outline-none w-24 text-white"
                            />
                            <span className="text-gray-500 text-[9px] font-bold">USD</span>
                        </div>
                    </div>
                )}

                <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-gray-500 text-[10px] font-bold uppercase">Size</span>
                    <div className="flex items-center gap-2">
                        <input
                            id="size-input"
                            type="number"
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            placeholder="0.00"
                            className="bg-transparent text-right font-mono text-xs focus:outline-none w-24 text-white transition-all duration-300 rounded"
                        />
                        <span className="text-gray-500 text-[9px] font-bold">{symbol}</span>
                    </div>
                </div>

                <div className="px-1 group">
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#00ff9d] hover:accent-white transition-all"
                        onChange={(e) => {
                            const percent = parseInt(e.target.value);
                            const maxUsd = (walletBalance > 0 ? walletBalance : 1000) * leverage;
                            const calcSize = (maxUsd * (percent / 100)) / (parseFloat(price) || currentPrice);
                            setSize(calcSize.toFixed(4));
                        }}
                    />
                    <div className="flex justify-between text-[8px] text-white/20 mt-2 font-black uppercase tracking-tighter group-hover:text-white/40 transition-colors">
                        <span>0%</span>
                        <span>25%</span>
                        <span>50%</span>
                        <span>75%</span>
                        <span>100%</span>
                    </div>
                </div>
            </div>

            {/* Predictive Risk Hub */}
            {size && (
                <div className={`rounded-lg p-2.5 text-[11px] border leading-relaxed transition-all ${isHighRisk ? 'bg-red-500/10 border-red-500/30 text-red-200' : 'bg-blue-500/10 border-blue-500/30 text-blue-100'}`}>
                    <div className="flex items-center gap-1.5 mb-1 font-black uppercase tracking-tighter">
                        <Info className="w-3 h-3" />
                        {isHighRisk ? 'Critical Risk Advisory' : 'Terminal Intelligence'}
                    </div>
                    <p className="opacity-75 mb-2">
                        {isHighRisk
                            ? `Danger: Capital allocation is ${portfolioAllocation.toFixed(1)}%. High risk of liquidation.`
                            : 'Optimal position metrics. Execution profile categorized as institutional-grade.'}
                    </p>

                    {!tpSlEnabled && (
                        <button
                            type="button"
                            onClick={() => {
                                setTpSlEnabled(true);
                                setStopLoss(suggestedSL);
                            }}
                            className="flex items-center gap-1.5 bg-gray-800/80 hover:bg-gray-700 border border-gray-600/50 rounded px-2 py-1 transition-colors text-[10px] font-bold text-blue-400"
                        >
                            <span>Suggest SL: {suggestedSL}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Guard Rails (TP/SL) */}
            <div>
                <label className="flex items-center gap-2 cursor-pointer mb-2 group">
                    <input
                        type="checkbox"
                        checked={tpSlEnabled}
                        onChange={(e) => setTpSlEnabled(e.target.checked)}
                        className="rounded border-gray-700 bg-gray-800 text-blue-500 focus:ring-0 w-3.5 h-3.5"
                    />
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest group-hover:text-gray-300 transition-colors">Safety Guards</span>
                </label>

                {tpSlEnabled && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded px-2 py-1.5 flex flex-col">
                            <span className="text-[9px] font-black uppercase text-gray-600 tracking-tighter">Take Profit</span>
                            <input
                                type="number"
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(e.target.value)}
                                className="bg-transparent text-xs font-mono focus:outline-none text-emerald-400 font-bold"
                                placeholder="Target"
                            />
                        </div>
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded px-2 py-1.5 flex flex-col relative">
                            <span className="text-[9px] font-black uppercase text-gray-600 tracking-tighter">Stop Loss</span>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(e.target.value)}
                                className="bg-transparent text-xs font-mono focus:outline-none text-red-400 font-bold"
                                placeholder={suggestedSL}
                            />
                            <div className="absolute -top-1 right-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const entry = (orderType === 'limit' && parseFloat(price) > 0) ? parseFloat(price) : currentPrice;
                                        if (entry > 0) {
                                            const slPrice = side === 'buy' ? entry * 0.99 : entry * 1.01;
                                            setStopLoss(slPrice.toFixed(entry > 1000 ? 1 : 4));
                                            setTpSlEnabled(true);
                                            const riskAmt = (walletBalance > 0 ? walletBalance : 10000) * 0.01;
                                            const diff = Math.abs(entry - slPrice);
                                            if (diff > 0) setSize((riskAmt / diff).toFixed(5));
                                        }
                                    }}
                                    className="bg-blue-600 hover:bg-blue-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-lg transition-all"
                                >
                                    AUTO 1%
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail Summary */}
            <div className="space-y-1.5 pt-2 border-t border-gray-800/50 opacity-80">
                <div className="flex justify-between text-[10px]">
                    <span className="text-gray-600 uppercase font-bold tracking-tighter">Value</span>
                    <span className="text-gray-300 font-mono font-bold">${orderValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                    <span className="text-gray-600 uppercase font-bold tracking-tighter">Margin</span>
                    <span className="text-gray-300 font-mono font-bold">${marginRequired.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                    <span className="text-gray-600 uppercase font-bold tracking-tighter">Est. Liq</span>
                    <span className="text-orange-400 font-mono font-bold">${liqPrice.toFixed(2)}</span>
                </div>
            </div>

            {/* Primary Action */}
            <button
                type="submit"
                disabled={isSubmitting || !size}
                className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all mt-auto shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${side === 'buy'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20'
                    : 'bg-red-500 hover:bg-red-400 text-black shadow-red-500/20'
                    }`}
            >
                {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : !isAuth ? (
                    'Connect Neural Link'
                ) : (
                    `${side === 'buy' ? 'Initiate Long' : 'Initiate Short'} ${symbol}`
                )}
            </button>

            {/* Response Channel */}
            {result && (
                <div className={`flex items-center gap-2 p-2.5 rounded-xl text-[10px] font-bold mt-1 border animate-in slide-in-from-bottom-2 duration-300 ${result.success ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {result.message}
                </div>
            )}
        </form>
    );
}
