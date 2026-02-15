'use client';
import { useState, useRef, useEffect } from 'react';
import { useAccount } from 'wagmi';
import axios from 'axios';
import { TrendingUp, TrendingDown, Loader2, AlertCircle, ChevronDown, Settings, Info, Zap } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Types
type OrderType = 'market' | 'limit' | 'twap' | 'stop_market' | 'stop_limit' | 'take_market' | 'take_limit';

interface OrderFormProps {
    symbol: string;
    currentPrice: number;
    isAuthenticated: boolean;
    token?: string | null;
    walletBalance?: number;
    agent?: any;
    isAgentActive?: boolean;
    onEnableAgent?: () => Promise<any | null>;
    onLogin: () => void;
    onDeposit?: () => void;
    selectedPrice?: string;
    selectedSize?: string;
    maxLeverage?: number;
}

interface OrderOverrideParams {
    side?: 'buy' | 'sell';
    size?: string | number;
    price?: number | null;
    orderType?: OrderType;
}

export default function OrderForm({
    symbol,
    currentPrice,
    isAuthenticated,
    token,
    walletBalance = 0,
    agent,
    isAgentActive,
    onEnableAgent,
    onLogin,
    onDeposit,
    selectedPrice,
    selectedSize,
    error: sessionError,
    maxLeverage = 50
}: OrderFormProps & { error?: string | null }) {

    // State
    const { isConnected } = useAccount();
    const isAuth = isAuthenticated || isConnected;

    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [price, setPrice] = useState('');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [size, setSize] = useState('');
    const [leverage, setLeverage] = useState(20);
    const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');
    const [orderType, setOrderType] = useState<OrderType>('market');
    const [reduceOnly, setReduceOnly] = useState(false);
    const [tpSlEnabled, setTpSlEnabled] = useState(false);
    const [takeProfit, setTakeProfit] = useState('');
    const [stopLoss, setStopLoss] = useState('');

    // TWAP Specifics
    const [twapRuntime, setTwapRuntime] = useState('30');
    const [twapRandomize, setTwapRandomize] = useState(false);

    // UI State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showProMenu, setShowProMenu] = useState(false);
    const proMenuRef = useRef<HTMLDivElement>(null);
    const [showLevSlider, setShowLevSlider] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [lastExternalPrice, setLastExternalPrice] = useState<string | undefined>();
    const [lastExternalSize, setLastExternalSize] = useState<string | undefined>();

    // --- SESSION PERSISTENCE ---
    useEffect(() => {
        const savedLeverage = localStorage.getItem(`hl_leverage_${symbol}`);
        if (savedLeverage) setLeverage(parseInt(savedLeverage));

        const savedMargin = localStorage.getItem('hl_margin_mode');
        if (savedMargin) setMarginMode(savedMargin as 'cross' | 'isolated');

        const savedOrderType = localStorage.getItem('hl_order_type');
        if (savedOrderType) setOrderType(savedOrderType as OrderType);
    }, [symbol]);

    useEffect(() => {
        localStorage.setItem(`hl_leverage_${symbol}`, leverage.toString());
    }, [leverage, symbol]);

    useEffect(() => {
        localStorage.setItem('hl_margin_mode', marginMode);
    }, [marginMode]);

    useEffect(() => {
        localStorage.setItem('hl_order_type', orderType);
    }, [orderType]);

    // Safety: Cap leverage if it exceeds max allowed for the asset
    useEffect(() => {
        if (leverage > maxLeverage) {
            setLeverage(maxLeverage);
        }
    }, [maxLeverage, leverage]);

    // --- END PERSISTENCE ---

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
        // Check if user can trade
        if (!isAuth) {
            setResult({
                success: false,
                message: '⚠️ Connect your wallet to trade'
            });
            return;
        }

        // If wallet connected but no agent active, they need to enable 1-Click Terminal
        // This is required because we need the Agent key to sign Hyperliquid orders
        if (isConnected && !isAgentActive) {
            setResult({
                success: false,
                message: '🔐 Enable 1-Click Terminal above to start trading'
            });
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
            const finalOrderType = overrideParams?.orderType || orderType;
            const isBuy = (overrideParams?.side || side) === 'buy';
            const config: any = { headers: {} };
            if (token) config.headers.Authorization = `Bearer ${token}`;

            // 1-Click Trading: Uses Agent key for low-latency signing
            if (isAgentActive && agent?.privateKey) {
                const { ethers } = await import('ethers');
                const { signAgentAction, floatToWire, roundPrice } = await import('../../utils/signing');

                const wallet = new ethers.Wallet(agent.privateKey);

                // Construct Hyperliquid L1 Action
                const assetMap = (window as any)._assetMap || {};
                const assetId = assetMap[symbol];

                if (assetId === undefined) {
                    setResult({ success: false, message: `❌ Terminal Sync Error: Asset ${symbol} mapping missing. Try refreshing.` });
                    return;
                }

                const rawPrice = parseFloat(price) || currentPrice;
                // Use aggressive 10% slippage for market orders to guarantee fill
                const marketPrice = isBuy ? (rawPrice * 1.10) : (rawPrice * 0.90);
                const finalPrice = finalOrderType === 'market' ? marketPrice : rawPrice;

                const primaryOrder: any = {
                    a: parseInt(assetId.toString()),
                    b: isBuy,
                    p: floatToWire(roundPrice(finalPrice)),
                    s: floatToWire(parseFloat(finalSize.toString())),
                    r: reduceOnly,
                    t: finalOrderType === 'market'
                        ? { limit: { tif: 'Ioc' } }
                        : { limit: { tif: 'Gtc' } }
                };

                const orders: any[] = [primaryOrder];

                // Bundle Safety Guards (TP/SL) if enabled
                if (tpSlEnabled) {
                    if (takeProfit && !isNaN(parseFloat(takeProfit))) {
                        const tpPrice = parseFloat(takeProfit);
                        orders.push({
                            a: parseInt(assetId.toString()),
                            b: !isBuy,
                            // TP limit price should be aggressive (Lower for Sell/Long)
                            p: floatToWire(roundPrice(isBuy ? tpPrice * 0.9 : tpPrice * 1.1)),
                            s: floatToWire(parseFloat(finalSize.toString())),
                            r: true,
                            t: { trigger: { isMarket: true, triggerPx: floatToWire(roundPrice(tpPrice)), tpsl: 'tp' } }
                        });
                    }
                    if (stopLoss && !isNaN(parseFloat(stopLoss))) {
                        const slPrice = parseFloat(stopLoss);
                        orders.push({
                            a: parseInt(assetId.toString()),
                            b: !isBuy,
                            // SL limit price should be aggressive (Lower for Sell/Long)
                            p: floatToWire(roundPrice(isBuy ? slPrice * 0.9 : slPrice * 1.1)),
                            s: floatToWire(parseFloat(finalSize.toString())),
                            r: true,
                            t: { trigger: { isMarket: true, triggerPx: floatToWire(roundPrice(slPrice)), tpsl: 'sl' } }
                        });
                    }
                }

                let action: any;
                if (finalOrderType === 'twap') {
                    action = {
                        type: "twap",
                        a: parseInt(assetId.toString()),
                        b: isBuy,
                        s: floatToWire(parseFloat(finalSize.toString())),
                        r: reduceOnly,
                        m: parseInt(twapRuntime || '30'),
                        t: twapRandomize
                    };
                } else {
                    action = {
                        type: "order",
                        orders: orders,
                        grouping: "na"
                    };
                }

                // Ensure leverage is synced on HL before placing order (if changed)
                let lastNonce = Date.now();

                if (leverage > 1) {
                    try {
                        const syncNonce = lastNonce;
                        const levAction = {
                            type: "updateLeverage",
                            asset: parseInt(assetId.toString()),
                            isCross: marginMode === 'cross',
                            leverage: leverage
                        };
                        const levPayload = await signAgentAction(wallet, levAction, syncNonce);
                        await axios.post(`${API_URL}/trading/order`, levPayload, config);

                        // Increment nonce for the next call
                        lastNonce = Math.max(Date.now(), syncNonce + 1);
                        await new Promise(r => setTimeout(r, 50));
                    } catch (e) {
                        console.error("Leverage sync failed", e);
                    }
                }

                const orderNonce = lastNonce;
                const signedPayload = await signAgentAction(wallet, action, orderNonce);

                const res = await axios.post(`${API_URL}/trading/order`, signedPayload, config);

                // Deep response inspection
                const responseData = res.data.response;
                const error = responseData?.data?.statuses?.[0]?.error;

                if ((res.data.status === 'ok' || res.data.status === 'filled') && !error) {
                    setResult({
                        success: true,
                        message: `⚡ 1-Click: ${isBuy ? 'LONG' : 'SHORT'} ${finalSize} ${symbol}`
                    });
                } else {
                    let errorMsg = error || res.data.error || res.data.message || 'Execution Error';
                    if (typeof responseData === 'string' && responseData.toLowerCase().includes('error')) errorMsg = responseData;

                    setResult({ success: false, message: `❌ ${errorMsg}` });
                }

            } else {
                if (isAgentActive && !agent?.privateKey) {
                    setResult({
                        success: false,
                        message: 'Session key expired. Re-enable 1-Click Terminal before trading.'
                    });
                    return;
                }
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
                    tp_sl: tpSlEnabled ? { tp: parseFloat(takeProfit), sl: parseFloat(stopLoss) } : null,
                    twap: finalOrderType === 'twap' ? { minutes: parseInt(twapRuntime), randomize: twapRandomize } : null
                };

                const res = await axios.post(`${API_URL}/trading/order`, orderPayload, config);
                if (res.data.status === 'err') {
                    setResult({ success: false, message: res.data.error || 'Execution Failed' });
                } else {
                    setResult({ success: true, message: `✅ Order Placed: ${orderPayload.side.toUpperCase()} ${finalSize} ${symbol}` });
                }
            }

        } catch (e: any) {
            // Enhanced error parsing for FastAPI/Pydantic (422) and standard errors
            let errorMsg = 'Execution Failed';

            if (e.response?.data) {
                const data = e.response.data;
                // Handle Pydantic validation errors (422)
                if (data.detail && Array.isArray(data.detail)) {
                    errorMsg = `Validation Error: ${data.detail[0].msg} (${data.detail[0].loc.join('.')})`;
                } else {
                    errorMsg = data.error || data.message || (typeof data === 'string' ? data : e.message);
                }
            } else {
                errorMsg = e.message;
            }

            setResult({ success: false, message: errorMsg });
        } finally {
            setIsSubmitting(false);
        }
    };

    const executeOrderRef = useRef(executeOrder);
    useEffect(() => {
        executeOrderRef.current = executeOrder;
    });

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
                setTimeout(() => {
                    void executeOrderRef.current({
                        side: smartSide,
                        size: calcSize,
                        orderType: 'market'
                    });
                }, 500);
            }
        };

        window.addEventListener('smart-trade-execute', handleSmartTrade);
        return () => window.removeEventListener('smart-trade-execute', handleSmartTrade);
    }, [currentPrice, walletBalance, isAgentActive, agent]);

    useEffect(() => {
        if (selectedSize && selectedSize !== lastExternalSize) {
            setSize(selectedSize);
            setLastExternalSize(selectedSize);
        }
    }, [selectedSize, lastExternalSize]);

    // Financial Computations
    const orderValue = parseFloat(size || '0') * (parseFloat(price) || currentPrice);
    const marginRequired = orderValue / leverage;

    // Improved risk calculation for low/zero balance
    const portfolioAllocation = walletBalance > 0 ? (marginRequired / walletBalance) * 100 : (marginRequired > 0 ? 1000 : 0);
    const isHighRisk = walletBalance <= 0 || portfolioAllocation > 20 || leverage > 20;

    const entryPriceNum = parseFloat(price) || currentPrice;

    // Safety guard for liquidation and Stop Loss calculations
    // For 1x leverage, liquidation is effectively impossible for longs (0)
    const liqPrice = leverage <= 1.05 ? (side === 'buy' ? 0 : entryPriceNum * 2) : (entryPriceNum > 0 ? (side === 'buy'
        ? entryPriceNum * (1 - (1 / leverage) + 0.005)
        : entryPriceNum * (1 + (1 / leverage) - 0.005)) : 0);

    const suggestedSL = entryPriceNum > 0 ? (side === 'buy'
        ? (entryPriceNum * 0.99).toFixed(2) // 1% gap for suggestion
        : (entryPriceNum * 1.01).toFixed(2)) : '0.00';

    const networkFeeRate = 0.00025; // HL Taker Fee
    const serviceFeeRate = 0.00010; // Protocol Markup
    const estNetworkFees = orderValue * networkFeeRate;
    const estServiceFee = orderValue * serviceFeeRate;

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full gap-3 text-sm select-none overflow-y-auto px-1 custom-scrollbar">
            {/* Strategy Selectors (PRO Level) */}
            <div className="flex bg-white/[0.03] border border-white/5 rounded-xl p-1 gap-1">
                {['Market', 'Limit', 'TWAP'].map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setOrderType(t.toLowerCase() as OrderType)}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${orderType === t.toLowerCase() && !['stop_market', 'stop_limit', 'take_market', 'take_limit'].includes(orderType)
                            ? 'bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                            }`}
                    >
                        {t}
                    </button>
                ))}
                <div className="relative" ref={proMenuRef}>
                    <button
                        type="button"
                        onClick={() => setShowProMenu(!showProMenu)}
                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 min-w-[60px] ${['stop_market', 'stop_limit', 'take_market', 'take_limit'].includes(orderType)
                            ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                            : 'text-emerald-500/60 hover:text-emerald-400 hover:bg-emerald-500/5'
                            }`}
                    >
                        {orderType.startsWith('stop') ? 'STOP' : orderType.startsWith('take') ? 'TAKE' : 'ADVANCED'}
                        <ChevronDown className="w-3 h-3" />
                    </button>
                    {showProMenu && (
                        <div className="absolute top-full right-0 mt-2 w-36 bg-[#0c0c0c] border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-[100] py-1 animate-in fade-in zoom-in-95 duration-200">
                            {['Stop Market', 'Stop Limit', 'Take Market', 'Take Limit'].map((pt) => {
                                const ptLower = pt.toLowerCase().replace(' ', '_') as OrderType;
                                return (
                                    <button
                                        key={pt}
                                        type="button"
                                        onClick={() => {
                                            setOrderType(ptLower);
                                            setShowProMenu(false);
                                        }}
                                        className={`block w-full text-left px-4 py-2 text-[10px] uppercase font-black tracking-widest hover:bg-white/5 ${orderType === ptLower ? 'text-emerald-400' : 'text-gray-500 hover:text-white'}`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <span>{pt}</span>
                                            {Number(size) > 0 && (
                                                <div className="text-right">
                                                    <div className="font-mono text-gray-300 font-bold">
                                                        {`$${(currentPrice * (side === 'buy' ? 0.98 : 1.02)).toFixed(2)}`}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500">
                                                        {side === 'buy' ? '-2%' : '+2%'}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Control Strip */}
            <div className="grid grid-cols-3 gap-2">
                <button
                    type="button"
                    title="Switch Margin Mode"
                    onClick={() => setMarginMode(m => m === 'cross' ? 'isolated' : 'cross')}
                    className="col-span-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg h-9 font-bold text-gray-300 transition text-[10px] uppercase tracking-wider flex items-center justify-center hover:border-white/20"
                >
                    {marginMode === 'cross' ? 'Cross' : 'Isolated'}
                </button>

                <div className="col-span-1 relative">
                    <button
                        type="button"
                        onClick={() => setShowLevSlider(!showLevSlider)}
                        className={`w-full flex flex-col items-center justify-center bg-white/5 border rounded-lg h-9 px-2 relative group transition-colors ${showLevSlider ? 'border-white/40 bg-white/10' : 'border-white/10 hover:border-white/20'}`}
                        title="Adjust Leverage"
                    >
                        <span className="absolute text-[8px] top-1 left-1.5 text-gray-500 font-bold uppercase tracking-wider">Lev</span>
                        <span className="text-white text-xs font-black font-mono mt-2">{leverage}x</span>
                    </button>

                </div>

                {/* Leverage Adjustment Modal */}
                {showLevSlider && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-[#151517] border border-white/10 rounded-xl w-[400px] shadow-2xl p-6 relative animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                            {/* Close Button */}
                            <button
                                onClick={() => setShowLevSlider(false)}
                                className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>

                            <h2 className="text-xl font-medium text-white text-center mb-6">Adjust Leverage</h2>

                            <div className="text-center space-y-1 mb-8">
                                <p className="text-gray-400 text-sm">
                                    Control the leverage used for <span className="font-bold text-gray-300">{symbol}</span> positions. The maximum leverage is {maxLeverage}x.
                                </p>
                                <p className="text-gray-500 text-xs">
                                    Max position size decreases the higher your leverage.
                                </p>
                            </div>

                            {/* Slider Section */}
                            <div className="flex items-center gap-4 mb-8">
                                <div className="relative flex-1 h-6 flex items-center">
                                    {/* Track */}
                                    <div className="absolute w-full h-1.5 bg-[#2a2a2e] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[var(--color-primary)] transition-all duration-75"
                                            style={{ width: `${(leverage / maxLeverage) * 100}%` }}
                                        />
                                    </div>
                                    {/* Native Slider (Invisible but functional) */}
                                    <input
                                        type="range"
                                        min="1"
                                        max={maxLeverage}
                                        step="1"
                                        value={leverage}
                                        onChange={(e) => setLeverage(parseInt(e.target.value))}
                                        className="absolute w-full h-full opacity-0 cursor-pointer z-10"
                                    />
                                    {/* Thumb visualization could go here if needed, but native opacity-0 slider works for interaction */}
                                    <div
                                        className="absolute w-4 h-4 bg-[var(--color-primary)] border-2 border-[#151517] rounded-full pointer-events-none transition-all duration-75 shadow-[0_0_10px_rgba(45,212,191,0.5)]"
                                        style={{ left: `calc(${(leverage / maxLeverage) * 100}% - 8px)` }}
                                    />
                                </div>

                                <div className="bg-[#2a2a2e] border border-white/5 rounded px-3 py-1.5 min-w-[60px] flex items-center justify-between">
                                    <input
                                        type="number"
                                        value={leverage}
                                        onChange={(e) => {
                                            const val = Math.min(Math.max(1, parseInt(e.target.value) || 1), maxLeverage);
                                            setLeverage(val);
                                        }}
                                        className="bg-transparent text-white font-mono font-bold text-sm w-full focus:outline-none text-center"
                                    />
                                    <span className="text-gray-500 text-xs ml-1">x</span>
                                </div>
                            </div>

                            {/* Confirm Button */}
                            <button
                                type="button"
                                onClick={() => setShowLevSlider(false)}
                                className="w-full py-3 bg-[var(--color-primary)] hover:opacity-90 text-black font-bold rounded-lg transition-all mb-4 text-sm"
                            >
                                Confirm
                            </button>

                            {/* Risk Warning */}
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                                <p className="text-red-400/80 text-xs">
                                    Note that setting a higher leverage increases the risk of liquidation.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Tactical Master Switch */}
                <button
                    type="button"
                    onClick={async () => {
                        if (isAgentActive) return;
                        try {
                            if (onEnableAgent) await onEnableAgent();
                        } catch (e: any) {
                            setResult({ success: false, message: e.message || 'Failed to engage master engine' });
                        }
                    }}
                    title={isAgentActive ? "Master Trade Engine Online" : "Click to Engage Master Engine"}
                    className={`col-span-1 h-9 rounded-lg border transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden relative ${isAgentActive
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : isConnected
                            ? 'bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40 hover:bg-amber-500/10'
                            : 'bg-white/5 border-white/10 opacity-40 cursor-not-allowed'
                        }`}
                >
                    <div className={`w-2 h-2 rounded-full ${isAgentActive ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-gray-600'}`} />
                    <span className={`text-[9px] font-black tracking-widest uppercase ${isAgentActive ? 'text-emerald-400' : 'text-gray-400'}`}>
                        {isAgentActive ? 'ON' : '1-Click'}
                    </span>
                </button>
            </div>

            {/* Hook Error Display */}
            {sessionError && !isAgentActive && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-[10px] text-red-400 font-bold animate-in fade-in slide-in-from-top-1">
                    ⚠️ {sessionError}
                </div>
            )}


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
                        className="text-[9px] bg-[var(--color-primary)]/20 hover:bg-[var(--color-primary)]/40 text-[var(--color-primary)] px-2 py-0.5 rounded transition-all uppercase font-black tracking-tighter border border-[var(--color-primary)]/30"
                    >
                        Deposit
                    </button>
                </div>
            </div>

            {/* Position Side */}
            <div className="grid grid-cols-2 gap-2 bg-[var(--background)]/50 p-1 rounded-lg">
                <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${side === 'buy'
                        ? 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)] border border-[var(--color-bullish)]/50 shadow-[0_0_10px_var(--color-bullish-alpha)]'
                        : 'text-gray-600 hover:text-gray-500'
                        }`}
                >
                    Long
                </button>
                <button
                    type="button"
                    onClick={() => setSide('sell')}
                    className={`py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${side === 'sell'
                        ? 'bg-[var(--color-bearish)]/20 text-[var(--color-bearish)] border border-[var(--color-bearish)]/50 shadow-[0_0_10px_var(--color-bearish-alpha)]'
                        : 'text-gray-600 hover:text-gray-500'
                        }`}
                >
                    Short
                </button>
            </div>

            {/* Numeric Controls */}
            <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                    {(orderType === 'limit' || orderType === 'stop_limit' || orderType === 'take_limit') && (
                        <div className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 flex flex-col justify-center transition-colors hover:border-white/20">
                            <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider mb-0.5">Price (USD)</span>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder={currentPrice.toFixed(2)}
                                className="bg-transparent font-mono text-sm font-bold text-white focus:outline-none w-full placeholder:text-gray-700"
                            />
                        </div>
                    )}

                    <div className={`bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 flex flex-col justify-center transition-colors hover:border-white/20 ${(orderType === 'limit' || orderType === 'stop_limit' || orderType === 'take_limit') ? '' : 'col-span-2'}`}>
                        <div className="flex justify-between items-center mb-0.5">
                            <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider">Size ({symbol})</span>
                            {/* Quick fill buttons could go here */}
                        </div>
                        <input
                            id="size-input"
                            type="number"
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            placeholder="0.00"
                            className="bg-transparent font-mono text-sm font-bold text-white focus:outline-none w-full placeholder:text-gray-700 transition-all duration-300 rounded"
                        />
                    </div>
                </div>

                {/* Slider - Slimmer */}
                <div className="px-1 group py-1">
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--color-primary)] hover:accent-white transition-all"
                        onChange={(e) => {
                            const percent = parseInt(e.target.value);
                            const maxUsd = (walletBalance > 0 ? walletBalance : 1000) * leverage;
                            const calcSize = (maxUsd * (percent / 100)) / (parseFloat(price) || currentPrice);
                            setSize(calcSize.toFixed(4));
                        }}
                    />
                    <div className="flex justify-between text-[8px] text-white/20 mt-1 font-black uppercase tracking-tighter group-hover:text-white/40 transition-colors">
                        <span>0%</span>
                        <span>25%</span>
                        <span>50%</span>
                        <span>75%</span>
                        <span>100%</span>
                    </div>
                </div>
            </div>

            {/* TWAP Configuration (Dynamic) */}
            {orderType === 'twap' && (
                <div className="space-y-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded-xl animate-in slide-in-from-top-1">
                    <div className="flex items-center justify-between">
                        <span className="text-purple-400 text-[9px] font-black uppercase tracking-widest">TWAP Run Time</span>
                        <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded border border-white/5">
                            <input
                                type="number"
                                value={twapRuntime}
                                onChange={(e) => setTwapRuntime(e.target.value)}
                                className="bg-transparent text-right font-mono text-[11px] focus:outline-none w-10 text-white"
                                placeholder="30"
                            />
                            <span className="text-gray-600 text-[8px] font-bold">MIN</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-gray-400 text-[9px] font-black uppercase tracking-tighter">Randomize Slices</span>
                            <span className="text-[8px] text-gray-600">Obfuscates bot footprint</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setTwapRandomize(!twapRandomize)}
                            className={`w-8 h-4 rounded-full p-0.5 transition-colors ${twapRandomize ? 'bg-purple-500' : 'bg-gray-800'}`}
                        >
                            <div className={`w-3 h-3 bg-white rounded-full transition-transform ${twapRandomize ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className="pt-1.5 border-t border-purple-500/10 flex items-center gap-2">
                        <Zap className="w-2.5 h-2.5 text-purple-400 animate-pulse" />
                        <span className="text-[8px] text-purple-400/80 font-bold leading-tight">
                            Total {size || '0'} {symbol} will be spread over {twapRuntime}m via adaptive smart liquidity.
                        </span>
                    </div>
                </div>
            )}

            {/* Predictive Risk Hub */}
            {
                size && (
                    <div className={`rounded-lg p-2.5 text-[11px] border leading-relaxed transition-all ${walletBalance <= 0
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : isHighRisk
                            ? 'bg-[var(--color-bearish)]/10 border-[var(--color-bearish)]/30 text-[var(--color-bearish)]/80'
                            : 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/30 text-[var(--color-primary)]'
                        }`}>
                        <div className="flex items-center gap-1.5 mb-1 font-black uppercase tracking-tighter">
                            <Info className="w-3 h-3" />
                            {walletBalance <= 0
                                ? '⚠️ No Funds Detected'
                                : isHighRisk
                                    ? 'Critical Risk Advisory'
                                    : 'Terminal Intelligence'
                            }
                        </div>
                        <p className="opacity-75 mb-2">
                            {walletBalance <= 0
                                ? 'Deposit funds to your Hyperliquid account to start trading. Click DEPOSIT above.'
                                : isHighRisk
                                    ? `Danger: Capital allocation is ${portfolioAllocation.toFixed(1)}%. High risk of liquidation.`
                                    : `Position uses ${portfolioAllocation.toFixed(1)}% of $${walletBalance.toFixed(2)} balance.`
                            }
                        </p>

                        {walletBalance > 0 && !tpSlEnabled && (
                            <button
                                type="button"
                                onClick={() => {
                                    setTpSlEnabled(true);
                                    setStopLoss(suggestedSL);
                                }}
                                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-[var(--glass-border)] rounded px-2 py-1 transition-colors text-[10px] font-bold text-[var(--color-primary)]"
                            >
                                <span>Suggest SL: {suggestedSL}</span>
                            </button>
                        )}
                    </div>
                )
            }

            {/* Guard Rails (TP/SL) */}
            <div>
                <label className="flex items-center gap-2 cursor-pointer mb-2 group">
                    <input
                        type="checkbox"
                        checked={tpSlEnabled}
                        onChange={(e) => setTpSlEnabled(e.target.checked)}
                        className="rounded border-[var(--glass-border)] bg-[var(--background)] text-[var(--color-primary)] focus:ring-0 w-3.5 h-3.5"
                    />
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest group-hover:text-gray-300 transition-colors">Safety Guards</span>
                </label>

                {tpSlEnabled && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="bg-[var(--background)]/30 border border-[var(--glass-border)] rounded px-2 py-1.5 flex flex-col">
                            <span className="text-[9px] font-black uppercase text-gray-600 tracking-tighter">Take Profit</span>
                            <input
                                type="number"
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(e.target.value)}
                                className="bg-transparent text-xs font-mono focus:outline-none text-[var(--color-bullish)] font-bold"
                                placeholder="Target"
                            />
                        </div>
                        <div className="bg-[var(--background)]/30 border border-[var(--glass-border)] rounded px-2 py-1.5 flex flex-col relative">
                            <span className="text-[9px] font-black uppercase text-gray-600 tracking-tighter">Stop Loss</span>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(e.target.value)}
                                className="bg-transparent text-xs font-mono focus:outline-none text-[var(--color-bearish)] font-bold"
                                placeholder={suggestedSL}
                            />
                            <div className="absolute -top-1 right-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const entry = (orderType === 'limit' && parseFloat(price) > 0) ? parseFloat(price) : currentPrice;
                                        if (entry > 0) {
                                            // SL at 2% for safer default "Auto"
                                            const slPercent = 0.02;
                                            const slPrice = side === 'buy' ? entry * (1 - slPercent) : entry * (1 + slPercent);

                                            // Precision rounding
                                            const dp = entry > 1000 ? 1 : entry > 10 ? 2 : 4;
                                            setStopLoss(slPrice.toFixed(dp));
                                            setTpSlEnabled(true);

                                            // Risk 10% of equity on this 2% move
                                            // Loss = Size * |Entry - SL|
                                            // Size = 0.10 * Balance / |Entry - SL|
                                            const riskPercent = 0.10;
                                            const bal = (walletBalance > 0 ? walletBalance : 100);
                                            const riskAmt = bal * riskPercent;
                                            const diff = Math.abs(entry - slPrice);

                                            if (diff > 0) {
                                                const calculatedSize = riskAmt / diff;
                                                // Format size normally
                                                setSize(calculatedSize.toFixed(symbol === 'BTC' || symbol === 'ETH' ? 3 : 1));
                                            }
                                        }
                                    }}
                                    className="bg-[var(--color-primary)] hover:opacity-80 text-black text-[8px] font-black px-1.5 py-0.5 rounded shadow-lg transition-all"
                                >
                                    AUTO 10%
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail Summary */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--glass-border)] opacity-80">
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
                    <span className="text-[var(--color-accent-orange)] font-mono font-bold">
                        {(size && parseFloat(size) > 0) ? `$${liqPrice.toFixed(2)}` : '--'}
                    </span>
                </div>
                <div className="flex justify-between text-[10px]">
                    <span className="text-gray-600 uppercase font-bold tracking-tighter">Network Fee</span>
                    <span className="text-gray-400 font-mono">${estNetworkFees.toFixed(3)} USDC</span>
                </div>
                <div className="flex justify-between text-[10px]">
                    <span className="text-purple-500/60 uppercase font-black tracking-tighter">Sentry Service</span>
                    <span className="text-purple-400 font-mono font-bold">${estServiceFee.toFixed(3)} USDC</span>
                </div>
            </div>

            {/* Primary Action */}
            <button
                type="submit"
                disabled={isSubmitting || !size}
                className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all mt-auto shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${side === 'buy'
                    ? 'bg-[var(--color-bullish)] hover:opacity-90 text-black shadow-[var(--color-bullish-alpha)]'
                    : 'bg-[var(--color-bearish)] hover:opacity-90 text-black shadow-[var(--color-bearish-alpha)]'
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
            {
                result && (
                    <div className={`flex items-center gap-2 p-2.5 rounded-xl text-[10px] font-bold mt-1 border animate-in slide-in-from-bottom-2 duration-300 ${result.success ? 'bg-[var(--color-bullish)]/10 text-[var(--color-bullish)] border-[var(--color-bullish)]/20' : 'bg-[var(--color-bearish)]/10 text-[var(--color-bearish)] border-[var(--color-bearish)]/20'
                        }`}>
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        {result.message}
                    </div>
                )
            }
        </form >
    );
}
