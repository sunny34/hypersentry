'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, BarChart3, Newspaper, Menu, Sparkles, Skull, Command, Users, Activity } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from '@/components/Sidebar';
import ChartTabs from '@/components/trading/ChartTabs';
import OrderForm from '@/components/trading/OrderForm';
import AIAnalysis from '@/components/trading/AIAnalysis';
import NewsFeed from '@/components/trading/NewsFeed';
import PremiumOrderBook from '@/components/trading/PremiumOrderBook';
import { ConnectButton } from '@rainbow-me/rainbowkit';
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
import LiquidationFirehose from '@/components/trading/LiquidationFirehose';
import CommandPalette from '@/components/trading/CommandPalette';
import CohortSentiment from '@/components/trading/CohortSentiment';
import StatusBar from '@/components/trading/StatusBar';
import TwapIntelligence from '@/components/trading/TwapIntelligence';
import TerminalLiquidityWall from '@/components/trading/TerminalLiquidityWall';
import TwapCompact from '@/components/trading/TwapCompact';

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

export default function TradingTerminal() {
    const { user, token, isAuthenticated, isLoading: authLoading, login } = useAuth();
    const { isCollapsed } = useSidebar();

    // WS Hook
    const { isConnected: isWsConnected, lastMessage } = useWebSocket(`${API_URL}/ws`.replace('http', 'ws'));

    // Session Hook
    const { agent, isAgentActive, enableSession, isLoading: isSessionLoading } = useHyperliquidSession();

    // User State
    const { address: walletAddress } = useAccount();
    const [walletBalance, setWalletBalance] = useState<number>(0);

    // State
    const [tokens, setTokens] = useState<Token[]>([]);
    const [selectedToken, setSelectedToken] = useState<string>('BTC');
    const [selectedInterval, setSelectedInterval] = useState('60');
    const [activeTab, setActiveTab] = useState<'analysis' | 'news' | 'liquidations' | 'positions' | 'orders' | 'cohorts' | 'twap'>('positions');
    const [aiBias, setAiBias] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
    const [isLoadingTokens, setIsLoadingTokens] = useState(true);
    const [notification, setNotification] = useState<{ title: string; message: string; type: 'bullish' | 'bearish' | 'neutral' } | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [showDeposit, setShowDeposit] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [mobileTab, setMobileTab] = useState<'chart' | 'book' | 'order' | 'intel'>('chart');
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [showIntelSidebar, setShowIntelSidebar] = useState(false);

    // Trading Data
    const [positions, setPositions] = useState<any[]>([]);
    const [openOrders, setOpenOrders] = useState<any[]>([]);
    const [aiPositionContext, setAiPositionContext] = useState<any>(null);
    const [bookPrice, setBookPrice] = useState<string | undefined>();
    const [bookSize, setBookSize] = useState<string | undefined>();

    // Indicators Logic
    const indicatorMenuRef = useRef<HTMLDivElement>(null);
    const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set(['EMA 50', 'EMA 200', 'Supertrend']));
    const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);

    const toggleIndicator = (name: string) => {
        const next = new Set(activeIndicators);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setActiveIndicators(next);
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd+K or Ctrl+K for command palette
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setShowCommandPalette(prev => !prev);
            }
            // Number keys for chart tabs (when not in input)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === '1') setActiveTab('positions');
            if (e.key === '2') setActiveTab('orders');
            if (e.key === '3') setActiveTab('analysis');
            if (e.key === '4') setActiveTab('cohorts');
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Close indicators menu on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(event.target as Node)) {
                setShowIndicatorMenu(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const getAuthConfig = useCallback(() => {
        return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    }, [token]);

    // Fetch User Data (Balance, Positions, Orders)
    useEffect(() => {
        const fetchData = async () => {
            const targetAddress = walletAddress || (user?.wallets?.[0]?.address);
            if (!targetAddress) return;

            try {
                const resAcc = await axios.get(`${API_URL}/trading/account?user=${targetAddress}`);
                if (resAcc.data && resAcc.data.marginSummary) {
                    const equity = parseFloat(resAcc.data.marginSummary.accountValue) || 0;
                    setWalletBalance(equity);
                    setPositions(resAcc.data.assetPositions || []);
                }

                const resOrders = await axios.get(`${API_URL}/trading/orders/open?user=${targetAddress}`);
                if (resOrders.data && resOrders.data.orders) {
                    setOpenOrders(resOrders.data.orders);
                }
            } catch (e) {
                console.error("Failed to fetch user data", e);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 5000);
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

            const wallet = new ethers.Wallet(agent.privateKey);
            const nonce = Date.now();

            const size = parseFloat(position.position.szi);
            const isBuy = size < 0;

            const orderRequest = {
                a: position.position.coinIndex,
                b: isBuy,
                p: isBuy ? "1000000" : "0.001",
                s: Math.abs(size).toString(),
                r: true,
                t: { limit: { tif: "Gtc" } }
            };

            const action = {
                type: "order",
                orders: [orderRequest],
                grouping: "na"
            };

            const signedPayload = await signAgentAction(wallet, action, nonce, null);
            await axios.post(`${API_URL}/trading/order`, signedPayload);
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
                    a: order.coinIndex || 0,
                    o: order.oid
                }]
            };

            const token = tokens.find(t => t.symbol === order.coin);
            if (token && order.a === undefined) {
                // Fallback logic
            }

            const signedPayload = await signAgentAction(wallet, action, nonce, null);
            await axios.post(`${API_URL}/trading/cancel`, signedPayload);
        } catch (e) {
            console.error(e);
            alert("Failed to cancel order: " + (e as Error).message);
        }
    };

    const handleAnalyzePosition = (position: any) => {
        const rawPos = position.position;
        if (rawPos && rawPos.coin) {
            setSelectedToken(rawPos.coin);
            setAiPositionContext(rawPos);
            setActiveTab('analysis');
        }
    };

    // Fetch available tokens
    useEffect(() => {
        let active = true;
        const fetchTokens = async () => {
            try {
                const res = await axios.get(`${API_URL}/trading/tokens`);
                if (active) {
                    const tokenList = res.data.tokens || [];
                    setTokens(tokenList);

                    const map: Record<string, number> = {};
                    tokenList.forEach((t: any) => {
                        if (t.symbol && t.index !== undefined) {
                            map[t.symbol] = t.index;
                        }
                    });
                    (window as any)._assetMap = map;
                }
            } catch (e) {
                console.error("Failed to fetch tokens", e);
            } finally {
                if (active) setIsLoadingTokens(false);
            }
        };
        fetchTokens();
        const interval = setInterval(fetchTokens, 10000);
        return () => { active = false; clearInterval(interval); };
    }, []);

    // Validate Selection & Initial Price
    useEffect(() => {
        if (tokens.length === 0) return;

        const exists = tokens.find(t => t.symbol === selectedToken);
        if (!exists) {
            setSelectedToken(tokens[0].symbol);
        } else if (currentPrice === 0) {
            setCurrentPrice(exists.price);
            setPriceChangePercent(exists.change24h);
        }
    }, [tokens, selectedToken, currentPrice]);

    // Fetch current price
    useEffect(() => {
        const fetchPrice = async () => {
            try {
                const res = await axios.get(`${API_URL}/trading/prices`);
                const price = parseFloat(res.data[selectedToken] || 0);

                if (price > 0) {
                    setCurrentPrice(price);
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

        if (tokens.length > 0) fetchPrice();
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
        <div className="h-screen bg-[#050505] text-white flex overflow-hidden">
            <Sidebar
                currentView="terminal"
                onViewChange={() => { }}
                onImport={() => setShowImport(true)}
                onAdd={() => setShowAdd(true)}
                isMobileOpen={mobileMenuOpen}
                onMobileClose={() => setMobileMenuOpen(false)}
            />

            <main className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'lg:ml-20' : 'lg:ml-64'} ml-0 h-full relative w-full`}>
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
                            <button onClick={() => setNotification(null)} className="text-gray-400 hover:text-white transition-colors">
                                <Minus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Top Header Bar - Minimalist like Hyperdash */}
                <div className="h-10 bg-black/80 border-b border-white/5 flex items-center px-4 gap-4 flex-shrink-0">
                    {/* Token Selector & Stats */}
                    <div className="flex items-center gap-3">
                        <TokenSelector
                            selectedToken={selectedToken}
                            tokens={tokens}
                            onSelect={(token) => {
                                setSelectedToken(token);
                                setAiPositionContext(null);
                            }}
                        />

                        {/* Current Price */}
                        <div className="flex items-center gap-2 pl-3 border-l border-white/10">
                            <span className={`text-sm font-mono font-black ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {formatPrice(currentPrice)}
                            </span>
                            <span className={`text-[10px] font-mono font-bold ${priceChangePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {priceChangePercent >= 0 ? '▲' : '▼'} {Math.abs(priceChangePercent).toFixed(2)}%
                            </span>
                        </div>
                    </div>

                    {/* Center Stats */}
                    <div className="hidden md:flex items-center gap-6 ml-4">
                        <div className="flex flex-col leading-tight">
                            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest">24h Vol</span>
                            <span className="text-[10px] font-mono font-bold text-gray-300">
                                {formatCompact(tokens.find(t => t.symbol === selectedToken)?.volume24h || 0)}
                            </span>
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest">OI</span>
                            <span className="text-[10px] font-mono font-bold text-gray-300">
                                {formatCompact(tokens.find(t => t.symbol === selectedToken)?.openInterest || 0)}
                            </span>
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest">Funding</span>
                            <span className={`text-[10px] font-mono font-bold ${(tokens.find(t => t.symbol === selectedToken)?.funding || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {((tokens.find(t => t.symbol === selectedToken)?.funding || 0) * 100).toFixed(4)}%
                            </span>
                        </div>
                    </div>

                    {/* TWAP Quick View - At-a-glance whale activity */}
                    <div className="hidden lg:block ml-4">
                        <TwapCompact
                            symbol={selectedToken}
                            onExpand={() => setActiveTab('twap')}
                        />
                    </div>

                    {/* Right Controls */}
                    <div className="ml-auto flex items-center gap-3">
                        {/* Timeframe */}
                        <div className="hidden sm:block">
                            <TimeframeSelector selected={selectedInterval} onSelect={setSelectedInterval} />
                        </div>

                        {/* Indicators Menu */}
                        <div className="relative" ref={indicatorMenuRef}>
                            <button
                                onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-wider ${showIndicatorMenu ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:border-white/20'}`}
                            >
                                <BarChart3 className="w-3 h-3" />
                                <span className="hidden sm:inline">Indicators</span>
                            </button>

                            {showIndicatorMenu && (
                                <div className="absolute top-full right-0 mt-1 w-48 bg-[#0b0b0b] border border-gray-800 rounded-xl shadow-2xl py-1.5 flex flex-col z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    {['EMA 50', 'EMA 200', 'Supertrend', 'Elliot Wave', 'Bollinger Bands', 'VWAP', 'Parabolic SAR'].map(ind => (
                                        <button
                                            key={ind}
                                            onClick={() => toggleIndicator(ind)}
                                            className={`px-3 py-2 text-left text-xs font-mono hover:bg-white/5 flex items-center justify-between transition-colors ${activeIndicators.has(ind) ? 'text-blue-400 bg-blue-500/5' : 'text-gray-500'}`}
                                        >
                                            <span>{ind}</span>
                                            {activeIndicators.has(ind) && (
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_6px_#3b82f6]" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Command Palette Trigger */}
                        <button
                            onClick={() => setShowCommandPalette(true)}
                            className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all"
                        >
                            <Command className="w-3 h-3 text-gray-400" />
                            <span className="text-[10px] font-bold text-gray-500">K</span>
                        </button>

                        <ConnectButton showBalance={false} accountStatus="avatar" />
                    </div>
                </div>

                <div className="p-1.5 flex-1 flex flex-col h-full overflow-hidden gap-1.5 w-full">
                    <div className="flex flex-col flex-1 min-h-0 relative lg:overflow-hidden w-full">
                        {/* Upper Section: Chart & Integrated Sidebar */}
                        <div className="flex flex-col lg:flex-row gap-1.5 min-h-0 pb-1.5 shrink-0 h-[60%] w-full">
                            {/* Left Panel - Primary Charting Workspace (reduced width) */}
                            <div className={`lg:w-[55%] min-w-0 bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden h-full flex flex-col relative ${mobileTab === 'chart' ? 'flex' : 'hidden lg:flex'}`}>
                                <ChartTabs
                                    symbol={selectedToken}
                                    interval={selectedInterval}
                                    positions={positions}
                                    openOrders={openOrders}
                                    bias={aiBias}
                                    onPriceSelect={(px: string) => setBookPrice(px)}
                                    currentPrice={currentPrice}
                                    openInterest={tokens.find(t => t.symbol === selectedToken)?.openInterest || 0}
                                    fundingRate={tokens.find(t => t.symbol === selectedToken)?.funding || 0}
                                    activeIndicators={activeIndicators}
                                />
                            </div>

                            {/* Right Panel - OrderBook & OrderForm Side by Side */}
                            <div className={`lg:flex-1 shrink-0 flex flex-row gap-1.5 min-h-0 ${mobileTab === 'order' || mobileTab === 'book' ? 'flex' : 'hidden lg:flex'}`}>
                                {/* Premium Order Book Pane (LEFT) */}
                                <div className="w-1/2 bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden relative">
                                    <PremiumOrderBook
                                        coin={selectedToken}
                                        currentPrice={currentPrice}
                                        onSelectPrice={(px) => setBookPrice(px)}
                                        onSelectSize={(sz) => setBookSize(sz)}
                                    />
                                </div>
                                {/* Order Entry Pane (RIGHT) */}
                                <div className="w-1/2 bg-[#0a0a0a] border border-white/5 rounded-xl p-3 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 flex flex-col">
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

                        {/* Mobile Tab Bar */}
                        <div className="lg:hidden flex bg-gray-950 border-t border-white/10 p-1 shrink-0 h-12">
                            <button
                                onClick={() => setMobileTab('chart')}
                                className={`flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${mobileTab === 'chart' ? 'text-blue-500 bg-blue-500/10' : 'text-gray-500'}`}
                            >
                                <BarChart3 className="w-4 h-4" />
                                <span className="text-[8px] font-black uppercase">Chart</span>
                            </button>
                            <button
                                onClick={() => setMobileTab('book')}
                                className={`flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${mobileTab === 'book' ? 'text-purple-500 bg-purple-500/10' : 'text-gray-500'}`}
                            >
                                <RefreshCw className="w-4 h-4" />
                                <span className="text-[8px] font-black uppercase">Book</span>
                            </button>
                            <button
                                onClick={() => setMobileTab('order')}
                                className={`flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${mobileTab === 'order' ? 'text-emerald-500 bg-emerald-500/10' : 'text-gray-500'}`}
                            >
                                <Zap className="w-4 h-4" />
                                <span className="text-[8px] font-black uppercase">Trade</span>
                            </button>
                            <button
                                onClick={() => setMobileTab('intel')}
                                className={`flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${mobileTab === 'intel' ? 'text-amber-500 bg-amber-500/10' : 'text-gray-500'}`}
                            >
                                <Sparkles className="w-4 h-4" />
                                <span className="text-[8px] font-black uppercase">Intel</span>
                            </button>
                        </div>

                        {/* Consolidated Lower Section: The Terminal Console */}
                        <div className={`flex flex-col flex-1 min-h-0 lg:h-[40%] w-full bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden ${mobileTab === 'intel' ? 'flex lg:flex' : 'hidden lg:flex'}`}>
                            {/* Terminal Tabs Navigation */}
                            <div className="flex bg-black/60 border-b border-white/5 px-2 pt-1.5 gap-0.5">
                                {[
                                    { id: 'positions', label: 'Positions', icon: Zap, color: 'text-blue-400' },
                                    { id: 'orders', label: 'Orders', icon: Minus, color: 'text-orange-400' },
                                    { id: 'analysis', label: 'AI Intel', icon: Sparkles, color: 'text-purple-400' },
                                    { id: 'twap', label: 'TWAP Intel', icon: Activity, color: 'text-purple-500' },
                                    { id: 'cohorts', label: 'Social', icon: Users, color: 'text-teal-400' },
                                    { id: 'news', label: 'News', icon: Newspaper, color: 'text-blue-300' },
                                    { id: 'liquidations', label: 'Firehose', icon: Skull, color: 'text-red-400' },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as any)}
                                        className={`px-3 py-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider transition-all rounded-t-lg ${activeTab === tab.id
                                            ? 'bg-white/5 text-white border-t border-l border-r border-white/10'
                                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]'
                                            }`}
                                    >
                                        <tab.icon className={`w-3 h-3 ${activeTab === tab.id ? tab.color : ''}`} />
                                        {tab.label}
                                        {tab.id === 'positions' && positions.length > 0 && (
                                            <span className="bg-blue-500 text-black px-1.5 rounded-full text-[7px] ml-0.5">{positions.length}</span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content Area */}
                            <div className="flex-1 overflow-hidden relative">
                                {['positions', 'orders', 'analysis'].includes(activeTab) ? (
                                    <div className="flex h-full">
                                        {/* Dashboard Portion */}
                                        <div className="flex-1 border-r border-white/5 overflow-hidden">
                                            <DashboardPanel
                                                isAuthenticated={isAuthenticated || !!walletAddress}
                                                positions={positions}
                                                openOrders={openOrders}
                                                tokens={tokens}
                                                onSelectToken={setSelectedToken}
                                                onClosePosition={handleClosePosition}
                                                onCancelOrder={handleCancelOrder}
                                                onAnalyze={handleAnalyzePosition}
                                                activeTabOverride={activeTab === 'analysis' ? 'positions' : activeTab as any}
                                            />
                                        </div>
                                        {/* Analysis Portion */}
                                        <div className="w-[380px] shrink-0 bg-black/30">
                                            <AIAnalysis
                                                symbol={selectedToken}
                                                interval={selectedInterval}
                                                positionContext={aiPositionContext}
                                                onClosePosition={handleClosePosition}
                                                onAnalysisUpdate={(analysis) => {
                                                    const bias = analysis.direction === 'long' ? 'bullish' :
                                                        analysis.direction === 'short' ? 'bearish' : 'neutral';
                                                    setAiBias(bias);
                                                }}
                                            />
                                        </div>
                                    </div>
                                ) : activeTab === 'twap' ? (
                                    <div className="flex h-full gap-1.5 p-1.5 overflow-hidden">
                                        <div className="flex-1 min-w-0">
                                            <TwapIntelligence symbol={selectedToken} />
                                        </div>
                                        <div className="w-[320px] shrink-0">
                                            <TerminalLiquidityWall
                                                coin={selectedToken}
                                                currentPrice={currentPrice}
                                                onPriceClick={(px) => setBookPrice(px.toString())}
                                            />
                                        </div>
                                    </div>
                                ) : activeTab === 'cohorts' ? (
                                    <CohortSentiment symbol={selectedToken} />
                                ) : activeTab === 'news' ? (
                                    <NewsFeed symbol={selectedToken} aiBias={aiBias} />
                                ) : (
                                    <LiquidationFirehose />
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <InsiderIntelligence coin={selectedToken} />

                {/* Footer Status Bar */}
                <StatusBar
                    isWsConnected={isWsConnected}
                    tokens={tokens}
                    onOpenCommandPalette={() => setShowCommandPalette(true)}
                />
            </main>

            {/* Command Palette Modal */}
            <CommandPalette
                tokens={tokens}
                onSelectToken={(symbol) => {
                    setSelectedToken(symbol);
                    setAiPositionContext(null);
                }}
                isOpen={showCommandPalette}
                onClose={() => setShowCommandPalette(false)}
            />

            <AddWalletModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => { }} />
            <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onSuccess={() => { }} />
            <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} />
        </div>
    );
}
