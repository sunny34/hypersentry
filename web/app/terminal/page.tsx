'use client';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, BarChart3, Newspaper } from 'lucide-react';
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
    const [tokens, setTokens] = useState<Token[]>([]);
    const [selectedToken, setSelectedToken] = useState<string>('BTC');
    const [selectedInterval, setSelectedInterval] = useState('60');
    const [activeTab, setActiveTab] = useState<'analysis' | 'news'>('analysis');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
    const [isLoadingTokens, setIsLoadingTokens] = useState(true);
    const [topHeight, setTopHeight] = useState(50); // Percent height of top section
    const [showHeatmap, setShowHeatmap] = useState(false); // Default hidden per user request
    const [notification, setNotification] = useState<{ title: string; message: string; type: 'bullish' | 'bearish' | 'neutral' } | null>(null);

    const getAuthConfig = useCallback(() => {
        return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    }, [token]);

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
                const res = await axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' });
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
            <Sidebar currentView="terminal" onViewChange={() => { }} />

            <main className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'ml-20' : 'ml-64'} h-full`}>

                <div className="p-4 flex-1 flex flex-col h-full overflow-hidden gap-4">
                    <div className="flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-4">
                            {/* New Token Selector */}
                            <TokenSelector
                                selectedToken={selectedToken}
                                tokens={tokens}
                                onSelect={(token) => {
                                    setSelectedToken(token);
                                    const t = tokens.find(tk => tk.symbol === token);
                                    if (t) {
                                        setCurrentPrice(t.price);
                                        setPriceChangePercent(t.change24h);
                                    }
                                }}
                            />

                            {/* New Timeframe Selector */}
                            <TimeframeSelector
                                selected={selectedInterval}
                                onSelect={setSelectedInterval}
                            />

                            <div className="w-px h-8 bg-gray-800 mx-2"></div>

                            {/* Current Price and Stats */}
                            <div className="flex items-center gap-6 text-sm">
                                {/* Current Price */}
                                <div className="flex flex-col">
                                    <span className={`text-xl font-bold font-mono ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {formatPrice(currentPrice)}
                                    </span>
                                    {/* 24h Change */}
                                    <span className={`text-xs font-medium ${priceChangePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                                    </span>
                                </div>

                                {/* 24h Volume */}
                                <div className="hidden lg:block">
                                    <p className="text-gray-500 text-[10px] font-medium uppercase tracking-wider mb-0.5">24h Vol</p>
                                    <p className="font-bold text-gray-300 font-mono text-xs">
                                        {tokens.find(t => t.symbol === selectedToken)?.volume24h
                                            ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.volume24h || 0)
                                            : '-'}
                                    </p>
                                </div>

                                {/* Open Interest */}
                                <div className="hidden lg:block">
                                    <p className="text-gray-500 text-[10px] font-medium uppercase tracking-wider mb-0.5">Open Interest</p>
                                    <p className="font-bold text-gray-300 font-mono text-xs">
                                        {tokens.find(t => t.symbol === selectedToken)?.openInterest
                                            ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.openInterest || 0)
                                            : '-'}
                                    </p>
                                </div>

                                {/* Funding Rate */}
                                <div className="hidden lg:block">
                                    <p className="text-gray-500 text-[10px] font-medium uppercase tracking-wider mb-0.5">Funding</p>
                                    <p className="font-bold text-amber-400 font-mono text-xs">
                                        {tokens.find(t => t.symbol === selectedToken)?.funding
                                            ? `${((tokens.find(t => t.symbol === selectedToken)?.funding || 0) * 100).toFixed(4)}%`
                                            : '0.0000%'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <ConnectButton showBalance={false} accountStatus="avatar" />
                            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900/50 px-2 py-1 rounded border border-gray-800">
                                <Zap className="w-3 h-3 text-yellow-500" />
                                <span>L1</span>
                            </div>
                        </div>
                    </div>

                    {/* Main Content - Pro Layout (3 Columns) */}
                    <div className="flex flex-col flex-1 min-h-0 relative">
                        {/* Upper Section: Chart & Order Book & Order Form */}
                        <div style={{ height: `${topHeight}%` }} className="flex gap-4 min-h-0 pb-2">
                            {/* Left Panel - Chart (Flex 3) */}
                            <div className="flex-[3] bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm min-w-0">
                                <div className="flex-1 w-full h-full">
                                    <ChartWidget symbol={selectedToken} interval={selectedInterval} />
                                </div>
                            </div>

                            {/* Middle Panel - Order Book & Heatmap */}
                            <div className="flex-[1.5] bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm min-w-0 flex hidden xl:flex relative">
                                <div className="flex-1 flex flex-col min-w-0 border-r border-gray-800/50 transition-all">
                                    <div className="p-2 space-y-2 border-b border-gray-800 relative group">
                                        {/* Toggle Heatmap Button */}
                                        <button
                                            onClick={() => setShowHeatmap(!showHeatmap)}
                                            className={`absolute top-2 right-2 p-1.5 rounded-lg border transition-all z-20 ${showHeatmap
                                                ? 'bg-orange-500/20 border-orange-500/50 text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.2)]'
                                                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'}`}
                                            title="Toggle Liquidation Heatmap"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <Zap className={`w-3.5 h-3.5 ${showHeatmap ? 'fill-current' : ''}`} />
                                                <span className="text-[10px] font-bold uppercase hidden group-hover:block">Heatmap</span>
                                            </div>
                                        </button>

                                        <div className="font-bold text-emerald-400 text-lg tracking-tight">
                                            {formatPrice(currentPrice)}
                                        </div>
                                        {/* Compact Stats Grid */}
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-gray-500">
                                            <div className="flex justify-between">
                                                <span>24h Vol</span>
                                                <span className="text-gray-300">
                                                    {tokens.find(t => t.symbol === selectedToken)?.volume24h
                                                        ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.volume24h || 0)
                                                        : '-'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Index</span>
                                                <span className="text-gray-300">{formatPrice(currentPrice * 1.0001)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Funding</span>
                                                <span className="text-orange-400">
                                                    {tokens.find(t => t.symbol === selectedToken)?.funding
                                                        ? `${((tokens.find(t => t.symbol === selectedToken)?.funding || 0) * 100).toFixed(4)}%`
                                                        : '0.0000%'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>OI</span>
                                                <span className="text-gray-300">
                                                    {tokens.find(t => t.symbol === selectedToken)?.openInterest
                                                        ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.openInterest || 0)
                                                        : '-'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <OrderBook coin={selectedToken} />
                                </div>

                                {/* Collapsible Heatmap Panel */}
                                <div className={`transition-all duration-300 ease-in-out border-l border-gray-800/50 overflow-hidden ${showHeatmap ? 'w-64 opacity-100' : 'w-0 opacity-0'}`}>
                                    <div className="w-64 h-full">
                                        <LiquidationHeatmap
                                            currentPrice={currentPrice}
                                            symbol={selectedToken}
                                            openInterest={tokens.find(t => t.symbol === selectedToken)?.openInterest || 5000000} // Fallback to 5M if n/a
                                            fundingRate={tokens.find(t => t.symbol === selectedToken)?.funding || 0}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Right Panel - Order Form Only (Flex 1) */}
                            <div className="flex-1 flex flex-col gap-4 min-w-0">
                                <div className="flex-1 bg-gray-900/40 border border-gray-800/50 rounded-2xl p-4 backdrop-blur-sm overflow-y-auto">
                                    <OrderForm
                                        symbol={selectedToken}
                                        currentPrice={currentPrice}
                                        isAuthenticated={isAuthenticated}
                                        onLogin={() => login('google')}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Resize Handle */}
                        <div
                            className="h-1 bg-gray-800 hover:bg-emerald-500 cursor-row-resize transition-colors w-full z-50 flex items-center justify-center opacity-50 hover:opacity-100"
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
                        <div style={{ height: `${100 - topHeight}%` }} className="flex gap-4 min-h-0 pt-2">
                            {/* Dashboard Panel (Positions/Orders) - 75% width */}
                            <div className="w-[75%] min-w-0">
                                <DashboardPanel isAuthenticated={isAuthenticated} />
                            </div>

                            {/* Intel Hub (AI & News) - 25% width */}
                            <div className="w-[25%] bg-gray-900/40 border border-gray-800/50 rounded-2xl p-4 backdrop-blur-sm flex flex-col min-w-0">
                                <div className="flex items-center gap-2 mb-4 border-b border-gray-700/50 pb-2">
                                    <button
                                        onClick={() => setActiveTab('analysis')}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-2 ${activeTab === 'analysis'
                                            ? 'bg-blue-500/20 text-blue-400'
                                            : 'text-gray-500 hover:text-gray-300'
                                            }`}
                                    >
                                        <TrendingUp className="w-4 h-4" />
                                        AI Analysis
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('news')}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-2 ${activeTab === 'news'
                                            ? 'bg-purple-500/20 text-purple-400'
                                            : 'text-gray-500 hover:text-gray-300'
                                            }`}
                                    >
                                        <Newspaper className="w-4 h-4" />
                                        Intel & News
                                    </button>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto">
                                    {activeTab === 'analysis' ? (
                                        <AIAnalysis symbol={selectedToken} interval={selectedInterval} />
                                    ) : (
                                        <NewsFeed symbol={selectedToken} />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
