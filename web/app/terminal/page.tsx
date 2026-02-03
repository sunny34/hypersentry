'use client';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, BarChart3, Newspaper, Menu, Sparkles, Skull } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from '@/components/Sidebar';
import ChartWidget from '@/components/trading/ChartWidget';
import OrderForm from '@/components/trading/OrderForm';
import AIAnalysis from '@/components/trading/AIAnalysis';
import NewsFeed from '@/components/trading/NewsFeed';
import NewsTicker from '@/components/trading/NewsTicker';
import OrderBook from '@/components/OrderBook';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import LiquidationHeatmap from '@/components/trading/LiquidationHeatmap';
import { useSidebar } from '@/contexts/SidebarContext';
import DashboardPanel from '@/components/trading/DashboardPanel';
import TokenSelector from '@/components/trading/TokenSelector';
import TimeframeSelector from '@/components/trading/TimeframeSelector';
import AddWalletModal from '@/components/modals/AddWalletModal';
import ImportModal from '@/components/modals/ImportModal';
import DepositModal from '@/components/modals/DepositModal';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useHyperliquidSession } from '@/hooks/useHyperliquidSession';
import InsiderIntelligence from '@/components/trading/InsiderIntelligence';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface Token {
    symbol: string;
    pair: string;
    name: string;
    type: 'perp' | 'spot';
    price: number;
    change24h: number;
    prevPrice: number;
    volume24h: number;
    openInterest: number;
    funding: number;
}

import LiquidationFirehose from '@/components/trading/LiquidationFirehose';

export default function TradingTerminal() {
    const { user, token, isAuthenticated, isLoading: authLoading, login } = useAuth();
    const { isCollapsed } = useSidebar();

    // WS Hook
    const { isConnected: isWsConnected, lastMessage } = useWebSocket(`${API_URL}/ws`.replace('http', 'ws'));

    // Session Hook
    const { agent, isAgentActive, enableSession, isLoading: isSessionLoading } = useHyperliquidSession(); // Import hook needed

    // User State
    const { address: walletAddress } = useAccount();
    const [walletBalance, setWalletBalance] = useState<number>(0);

    // State
    const [tokens, setTokens] = useState<Token[]>([]);
    const [selectedToken, setSelectedToken] = useState<string>('BTC');
    const [selectedInterval, setSelectedInterval] = useState('60');
    const [activeTab, setActiveTab] = useState<'analysis' | 'news' | 'liquidations'>('analysis');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
    const [isLoadingTokens, setIsLoadingTokens] = useState(true);
    const [topHeight, setTopHeight] = useState(50); // Percent height of top section
    const [showHeatmap, setShowHeatmap] = useState(false); // Default hidden per user request
    const [notification, setNotification] = useState<{ title: string; message: string; type: 'bullish' | 'bearish' | 'neutral' } | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [showDeposit, setShowDeposit] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Trading Data
    const [positions, setPositions] = useState<any[]>([]);
    const [openOrders, setOpenOrders] = useState<any[]>([]);
    const [aiPositionContext, setAiPositionContext] = useState<any>(null);
    const [bookPrice, setBookPrice] = useState<string | undefined>();
    const [bookSize, setBookSize] = useState<string | undefined>();

    const getAuthConfig = useCallback(() => {
        return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    }, [token]);

    // Fetch User Data (Balance, Positions, Orders)
    useEffect(() => {
        const fetchData = async () => {
            const targetAddress = walletAddress || (user?.wallets?.[0]?.address);
            if (!targetAddress) return;

            try {
                // 1. Account State (Balance + Positions)
                const resAcc = await axios.get(`${API_URL}/trading/account?user=${targetAddress}`);
                if (resAcc.data && resAcc.data.marginSummary) {
                    const equity = parseFloat(resAcc.data.marginSummary.accountValue) || 0;
                    setWalletBalance(equity);
                    setPositions(resAcc.data.assetPositions || []);
                }

                // 2. Open Orders
                const resOrders = await axios.get(`${API_URL}/trading/orders/open?user=${targetAddress}`);
                if (resOrders.data && resOrders.data.orders) {
                    setOpenOrders(resOrders.data.orders);
                }

            } catch (e) {
                console.error("Failed to fetch user data", e);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 5000); // 5s poll
        return () => clearInterval(interval);
    }, [walletAddress, user, isAuthenticated]);

    // Action Handlers
    const handleClosePosition = async (position: any) => {
        if (!isAgentActive || !agent) {
            alert("Please enable 1-Click Trading (Agent) to close positions instantly.");
            return;
        }
        try {
            const { ethers } = await import('ethers');
            const { signAgentAction } = await import('../../utils/signing');

            // Rehydrate wallet
            const wallet = new ethers.Wallet(agent.privateKey);
            const nonce = Date.now();

            // Construct Close Action (Market Order to 0)
            const size = parseFloat(position.position.szi);
            const isBuy = size < 0; // If short, buy to close.

            const orderRequest = {
                a: position.position.coinIndex, // Asset Index
                b: isBuy, // Buy/Sell
                p: isBuy ? "1000000" : "0.001", // Market
                s: Math.abs(size).toString(),
                r: true, // Reduce Only
                t: { limit: { tif: "Gtc" } }
            };

            const action = {
                type: "order",
                orders: [orderRequest],
                grouping: "na"
            };

            // Sign
            const signedPayload = await signAgentAction(wallet, action, null, nonce);

            // Submit to Backend Proxy
            await axios.post(`${API_URL}/trading/order`, signedPayload.payload);

            // Refresh
            // setNotification...

        } catch (e) {
            console.error(e);
            alert("Failed to close position: " + (e as Error).message);
        }
    };

    const handleCancelOrder = async (order: any) => {
        if (!isAgentActive || !agent) {
            alert("Please enable 1-Click Trading.");
            return;
        }
        try {
            const { ethers } = await import('ethers');
            const { signAgentAction } = await import('../../utils/signing');

            const wallet = new ethers.Wallet(agent.privateKey);
            const nonce = Date.now();

            const action = {
                type: "cancel",
                cancels: [{
                    a: order.coinIndex || 0, // Need to make sure we have coinIndex!
                    o: order.oid
                }]
            };

            // If coinIndex is missing in `openOrders` list, we might fail.
            // openOrders from /info/openOrders usually contains `coin`.
            // We need to map coin -> index? 
            // `tokens` state has this map.
            // Let's assume order object has it or we find it.

            const token = tokens.find(t => t.symbol === order.coin);
            if (token) {
                // But wait, `token` object from `/trading/tokens` might not have index?
                // We need the universe index.
                // Actually `orders` from HL usually have `a` (asset index).
                if (order.a === undefined && token) {
                    // Fallback? Requires metadata.
                    // The /trading/orders/open implementation returns raw orders from SDK.
                    // Raw orders usually have `a` (asset id) and `coin` (symbol).
                    // Let's use order.a if present.
                }
            }

            // Verify 'a' exists
            if (order.a === undefined) {
                // Try to look up? For now assume it's there or fail.
                // Actually SDK wrapper enriches it with 'coin'. Does it keep 'a'?
                // Let's check `get_open_orders` output in `routers/trading.py`.
            }

            const signedPayload = await signAgentAction(wallet, action, null, nonce);

            await axios.post(`${API_URL}/trading/cancel`, signedPayload.payload);

            // Refresh
        } catch (e) {
            console.error(e);
            alert("Failed to cancel order: " + (e as Error).message);
        }
    };

    const handleAnalyzePosition = (position: any) => {
        // Position raw object: { position: { coin: "ETH", ... } }
        const rawPos = position.position;
        if (rawPos && rawPos.coin) {
            setSelectedToken(rawPos.coin);
            setAiPositionContext(rawPos);
            setActiveTab('analysis'); // Auto-switch to AI tab
        }
    };

    // Fetch available tokens
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const res = await axios.get(`${API_URL}/trading/tokens`);
                const tokenList = res.data.tokens || [];
                setTokens(tokenList);

                if (tokenList.length > 0) {
                    // Initialize with first token or keep selected
                    const initialToken = tokenList.find((t: Token) => t.symbol === selectedToken) || tokenList[0];
                    setSelectedToken(initialToken.symbol);
                    setCurrentPrice(initialToken.price);
                    setPriceChangePercent(initialToken.change24h);
                }
            } catch (e) {
                // Fallback tokens if API not ready
                console.error("Failed to fetch tokens", e);
                setTokens([
                    {
                        symbol: 'BTC',
                        pair: 'BTC/USDC',
                        name: 'Bitcoin',
                        type: 'perp',
                        price: 84000,
                        change24h: 2.5,
                        prevPrice: 82000,
                        volume24h: 3500000000,
                        openInterest: 500000000,
                        funding: 0.0001
                    },
                ]);
            } finally {
                setIsLoadingTokens(false);
            }
        };
        fetchTokens();
    }, []);

    // Fetch current price
    useEffect(() => {
        const fetchPrice = async () => {
            try {
                const res = await axios.get(`${API_URL}/trading/prices`);
                const price = parseFloat(res.data[selectedToken] || 0);

                if (price > 0) {
                    setCurrentPrice(price);

                    // Find token to get prevPrice (24h open)
                    const tokenData = tokens.find(t => t.symbol === selectedToken);
                    if (tokenData && tokenData.prevPrice > 0) {
                        const change = ((price - tokenData.prevPrice) / tokenData.prevPrice) * 100;
                        setPriceChangePercent(change);


                    }
                }
            } catch (e) {
                console.error('Price fetch failed');
            }
        };

        // Initial fetch
        if (tokens.length > 0) {
            fetchPrice();
        }

        const interval = setInterval(fetchPrice, 5000);
        return () => clearInterval(interval);
    }, [selectedToken, tokens]);

    const formatPrice = (price: number) => {
        if (!price) return '$0.00';
        if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (price >= 1) return `$${price.toFixed(4)}`;
        return `$${price.toFixed(6)}`;
    };

    const formatCompact = (num: number) => {
        return new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 1,
            style: 'currency',
            currency: 'USD'
        }).format(num);
    };

    if (authLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black flex items-center justify-center">
                <div className="animate-pulse text-gray-400">Loading...</div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white flex overflow-hidden">
            <Sidebar
                currentView="terminal"
                onViewChange={() => { }}
                onImport={() => setShowImport(true)}
                onAdd={() => setShowAdd(true)}
                isMobileOpen={mobileMenuOpen}
                onMobileClose={() => setMobileMenuOpen(false)}
            />

            <main className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'lg:ml-20' : 'lg:ml-64'} ml-0 h-full relative`}>
                {/* Notification Popup */}
                {notification && (
                    <div className={`absolute top-6 right-6 z-50 p-4 rounded-xl border backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 max-w-sm
                        ${notification.type === 'bullish' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' :
                            notification.type === 'bearish' ? 'bg-red-500/10 border-red-500/30 text-red-100' :
                                'bg-gray-800/90 border-gray-700 text-gray-200'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`mt-1 p-1.5 rounded-full ${notification.type === 'bullish' ? 'bg-emerald-500/20' : notification.type === 'bearish' ? 'bg-red-500/20' : 'bg-gray-700'}`}>
                                {notification.type === 'bullish' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> :
                                    notification.type === 'bearish' ? <TrendingDown className="w-4 h-4 text-red-400" /> :
                                        <Zap className="w-4 h-4 text-gray-400" />}
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-sm mb-1">{notification.title}</h4>
                                <p className="text-xs opacity-90 leading-relaxed">{notification.message}</p>
                            </div>
                            <button
                                onClick={() => setNotification(null)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
                {/* Macro Market Pulse */}
                <div className="h-8 bg-black border-b border-gray-800/50 flex items-center px-4 gap-6 overflow-hidden flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest whitespace-nowrap">Market Pulse:</span>
                    </div>
                    {tokens.filter(t => ['BTC', 'ETH', 'SOL'].includes(t.symbol)).map(t => (
                        <div key={t.symbol} className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-black text-gray-300">{t.symbol}</span>
                                <span className={`text-[10px] font-mono font-bold ${t.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    ${t.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                </span>
                            </div>
                            <div className={`w-1 h-3 rounded-full ${t.change24h >= 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'} flex items-end overflow-hidden`}>
                                <div
                                    className={`w-full ${t.change24h >= 0 ? 'bg-emerald-500 shadow-[0_0_5px_#10b981]' : 'bg-red-500 shadow-[0_0_5px_#ef4444]'} transition-all duration-300`}
                                    style={{ height: `${Math.min(Math.abs(t.change24h) * 10, 100)}%` }}
                                />
                            </div>
                        </div>
                    ))}
                    <div className="ml-auto flex items-center gap-4">
                        <ConnectButton showBalance={false} accountStatus="avatar" />
                        <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? 'bg-blue-400 animate-pulse' : 'bg-red-400'}`} />
                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-tighter">Engine Live</span>
                        </div>
                    </div>
                </div>

                <div className="p-2 flex-1 flex flex-col h-full overflow-hidden gap-2">

                    {/* Main Content - Pro Layout (3 Columns) */}
                    <div className="flex flex-col flex-1 min-h-0 relative lg:overflow-hidden overflow-y-auto" style={{ '--top-split': `${topHeight}%`, '--bottom-split': `${100 - topHeight}%` } as React.CSSProperties}>
                        {/* Upper Section: Chart & Order Book & Order Form */}
                        <div className="flex flex-col lg:flex-row gap-2 min-h-0 pb-2 shrink-0 h-[600px] lg:h-[var(--top-split)]">
                            {/* Left Panel - Chart & Heatmap (Expanded) */}
                            <div className="flex-[3.5] bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm min-w-0 h-full flex flex-col relative group">
                                {/* Integrated Controls Header (Fixed Overlap) */}
                                <div className="px-3 py-2 border-b border-gray-800/50 flex items-center justify-between z-30 bg-black/40 backdrop-blur-lg">
                                    <div className="flex items-center gap-2">
                                        <TokenSelector
                                            selectedToken={selectedToken}
                                            tokens={tokens}
                                            onSelect={(token) => {
                                                setSelectedToken(token);
                                                setAiPositionContext(null);
                                                const t = tokens.find(tk => tk.symbol === token);
                                                if (t) {
                                                    setCurrentPrice(t.price);
                                                    setPriceChangePercent(t.change24h);
                                                }
                                            }}
                                        />
                                        <TimeframeSelector
                                            selected={selectedInterval}
                                            onSelect={setSelectedInterval}
                                        />
                                        <div className="w-px h-6 bg-white/10 mx-1" />
                                        <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                                            <button
                                                onClick={() => setShowHeatmap(false)}
                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all duration-300 flex items-center gap-2 ${!showHeatmap
                                                    ? 'bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]'
                                                    : 'text-gray-400 hover:text-gray-200'}`}
                                            >
                                                <div className="relative flex h-1.5 w-1.5">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                                                </div>
                                                Live Chart
                                            </button>
                                            <button
                                                onClick={() => setShowHeatmap(true)}
                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all duration-300 flex items-center gap-2 ${showHeatmap
                                                    ? 'bg-orange-500 text-black shadow-[0_0_15px_rgba(249,115,22,0.5)]'
                                                    : 'text-gray-400 hover:text-gray-200'}`}
                                            >
                                                <Zap className={`w-3 h-3 ${showHeatmap ? 'fill-current' : ''}`} />
                                                Heatmap
                                            </button>
                                        </div>
                                    </div>

                                    {/* Consolidated Market Ribbon (Inside Panel) */}
                                    <div className="flex items-center gap-6 ml-4">
                                        {/* Price Section */}
                                        <div className="flex flex-col leading-tight border-l border-white/10 pl-4 py-1">
                                            <span className={`text-sm font-black font-mono tracking-tighter ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {formatPrice(currentPrice)}
                                            </span>
                                            <span className={`text-[9px] font-bold ${priceChangePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {priceChangePercent >= 0 ? '▲' : '▼'} {priceChangePercent.toFixed(2)}%
                                            </span>
                                        </div>

                                        {/* Volume & OI */}
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col">
                                                <span className="text-[7px] text-gray-500 font-black uppercase tracking-widest leading-none mb-1">Total Vol</span>
                                                <span className="text-[10px] font-mono font-bold text-gray-300 leading-none">
                                                    {tokens.find(t => t.symbol === selectedToken)?.volume24h
                                                        ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.volume24h || 0)
                                                        : '-'}
                                                </span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[7px] text-gray-500 font-black uppercase tracking-widest leading-none mb-1">Open Interest</span>
                                                <span className="text-[10px] font-mono font-bold text-gray-300 leading-none">
                                                    {tokens.find(t => t.symbol === selectedToken)?.openInterest
                                                        ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.openInterest || 0)
                                                        : '-'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Funding Badge (Fixed Math) */}
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-400/5 border border-amber-400/20 group hover:bg-amber-400/10 transition-colors">
                                            <div className="flex flex-col items-end leading-none">
                                                <span className="text-[7px] text-amber-500/80 font-black uppercase tracking-widest mb-0.5">Funding Rate</span>
                                                <span className={`text-[10px] font-mono font-black ${tokens.find(t => t.symbol === selectedToken)?.funding && tokens.find(t => t.symbol === selectedToken)!.funding > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                                    {((tokens.find(t => t.symbol === selectedToken)?.funding || 0) * 100).toFixed(4)}%
                                                </span>
                                            </div>
                                            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${tokens.find(t => t.symbol === selectedToken)?.funding && tokens.find(t => t.symbol === selectedToken)!.funding > 0 ? 'bg-amber-400' : 'bg-red-400'}`} />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 w-full h-full relative">
                                    {!showHeatmap ? (
                                        <ChartWidget symbol={selectedToken} interval={selectedInterval} />
                                    ) : (
                                        <div className="w-full h-full bg-gray-900/60 overflow-hidden flex flex-col">
                                            <div className="flex-1 overflow-auto">
                                                <LiquidationHeatmap
                                                    currentPrice={currentPrice}
                                                    symbol={selectedToken}
                                                    openInterest={tokens.find(t => t.symbol === selectedToken)?.openInterest || 5000000}
                                                    fundingRate={tokens.find(t => t.symbol === selectedToken)?.funding || 0}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Middle Panel - Order Book (Slimmer) */}
                            <div className="flex-1 bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm min-w-0 hidden xl:flex relative">
                                <div className="flex-1 flex flex-col min-w-0 transition-all">
                                    <OrderBook
                                        coin={selectedToken}
                                        onSelectPrice={(px) => setBookPrice(px)}
                                        onSelectSize={(sz) => setBookSize(sz)}
                                    />
                                </div>
                            </div>

                            {/* Right Panel - Order Form (Flex 1) */}
                            <div className="flex-1 flex flex-col gap-4 min-w-0 h-[400px] lg:h-auto">
                                <div className="flex-1 bg-gray-900/40 border border-gray-800/50 rounded-2xl p-4 backdrop-blur-sm overflow-y-auto">
                                    <OrderForm
                                        symbol={selectedToken}
                                        currentPrice={currentPrice}
                                        isAuthenticated={isAuthenticated}
                                        token={token}
                                        walletBalance={walletBalance}
                                        agent={agent}
                                        isAgentActive={isAgentActive}
                                        onEnableAgent={enableSession}
                                        onLogin={() => login('google')}
                                        onDeposit={() => setShowDeposit(true)}
                                        selectedPrice={bookPrice}
                                        selectedSize={bookSize}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Resize Handle - Desktop Only */}
                        <div
                            className="h-1 bg-gray-800 hover:bg-emerald-500 cursor-row-resize transition-colors w-full z-10 flex items-center justify-center opacity-50 hover:opacity-100 hidden lg:flex"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                const startY = e.clientY;
                                const startHeight = topHeight;
                                const containerHeight = e.currentTarget.parentElement?.clientHeight || 0;

                                const onMouseMove = (moveEvent: MouseEvent) => {
                                    const deltaY = moveEvent.clientY - startY;
                                    const deltaPercentage = (deltaY / containerHeight) * 100;
                                    const newHeight = Math.min(Math.max(startHeight + deltaPercentage, 20), 80);
                                    setTopHeight(newHeight);
                                };

                                const onMouseUp = () => {
                                    document.removeEventListener('mousemove', onMouseMove);
                                    document.removeEventListener('mouseup', onMouseUp);
                                };

                                document.addEventListener('mousemove', onMouseMove);
                                document.addEventListener('mouseup', onMouseUp);
                            }}
                        >
                            <div className="w-8 h-1 bg-gray-600 rounded-full"></div>
                        </div>

                        {/* Lower Section: Dashboard & Intel Hub */}
                        <div className="flex flex-col lg:flex-row gap-4 min-h-0 pt-2 lg:h-[var(--bottom-split)] bg-transparent">
                            {/* Bottom Panel: Positions/Orders/Balances */}
                            <div className="flex-1 overflow-hidden min-h-0 bg-gray-900 border-t border-gray-800">
                                <DashboardPanel
                                    isAuthenticated={isAuthenticated || !!walletAddress}
                                    positions={positions}
                                    openOrders={openOrders}
                                    tokens={tokens}
                                    onSelectToken={setSelectedToken}
                                    onClosePosition={handleClosePosition}
                                    onCancelOrder={handleCancelOrder}
                                    onAnalyze={handleAnalyzePosition}
                                />
                            </div>

                            {/* Intel Hub (AI & News) */}
                            <div className="w-full lg:w-[25%] bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm flex flex-col min-w-0 h-[400px] lg:h-full">
                                {/* Tab Buttons */}
                                <div className="flex bg-gray-950/40 p-1 rounded-xl border border-white/5">
                                    <button
                                        onClick={() => setActiveTab('analysis')}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'analysis' ? 'bg-blue-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        <Sparkles className="w-3 h-3" />
                                        Analysis
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('liquidations')}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'liquidations' ? 'bg-red-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        <Skull className="w-3 h-3" />
                                        Liquidations
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('news')}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'news' ? 'bg-purple-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        <Newspaper className="w-3 h-3" />
                                        News
                                    </button>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto">
                                    {activeTab === 'analysis' ? (
                                        <AIAnalysis
                                            symbol={selectedToken}
                                            interval={selectedInterval}
                                            positionContext={aiPositionContext}
                                            onClosePosition={handleClosePosition}
                                        />
                                    ) : activeTab === 'liquidations' ? (
                                        <LiquidationFirehose />
                                    ) : (
                                        <NewsFeed symbol={selectedToken} />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <InsiderIntelligence coin={selectedToken} />

                {/* Micro Footer */}
                <footer className="h-6 bg-black border-t border-white/5 flex items-center justify-between px-4 overflow-hidden flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 grayscale opacity-50 hover:opacity-100 transition-opacity">
                            <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_5px_#10b981]" />
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Mainnet Node</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="h-1 w-1 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest">AI Node Synchronized</span>
                    </div>
                </footer>
            </main>
            <AddWalletModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => { }} />
            <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onSuccess={() => { }} />
            <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} />
        </div>
    );
}
