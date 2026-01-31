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
import { useSidebar } from '@/contexts/SidebarContext';
import DashboardPanel from '@/components/trading/DashboardPanel';

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
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white flex">
            <Sidebar currentView="terminal" onViewChange={() => { }} />

            <main className={`flex-1 overflow-hidden flex flex-col transition-all duration-300 ${isCollapsed ? 'ml-20' : 'ml-64'}`}>

                <div className="p-4 flex-1 flex flex-col h-full overflow-hidden">
                    <div className="flex items-center justify-between mb-4 flex-shrink-0">
                        <div className="flex items-center gap-4">
                            {/* Token Selector */}
                            <select
                                value={selectedToken}
                                onChange={(e) => {
                                    const newToken = e.target.value;
                                    setSelectedToken(newToken);
                                    // Update price/stats immediately from cache if available
                                    const t = tokens.find(tk => tk.symbol === newToken);
                                    if (t) {
                                        setCurrentPrice(t.price);
                                        setPriceChangePercent(t.change24h);
                                    }
                                }}
                                className="bg-gray-900/80 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-emerald-500/50 hover:bg-gray-800/80 transition cursor-pointer"
                            >
                                {tokens.map((t) => (
                                    <option key={t.symbol} value={t.symbol}>
                                        {t.pair}
                                    </option>
                                ))}
                            </select>

                            {/* Global Timeframe Selector */}
                            <select
                                value={selectedInterval}
                                onChange={(e) => setSelectedInterval(e.target.value)}
                                className="bg-gray-900/80 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-emerald-500/50 hover:bg-gray-800/80 transition cursor-pointer h-[46px]"
                            >
                                {[
                                    { label: '1m', value: '1' },
                                    { label: '5m', value: '5' },
                                    { label: '15m', value: '15' },
                                    { label: '30m', value: '30' },
                                    { label: '1h', value: '60' },
                                    { label: '4h', value: '240' },
                                    { label: '1d', value: 'D' },
                                    { label: '1w', value: 'W' }
                                ].map((tf) => (
                                    <option key={tf.value} value={tf.value}>
                                        {tf.label}
                                    </option>
                                ))}
                            </select>

                            {/* Current Price and Stats */}
                            <div className="flex items-center gap-8 text-sm">
                                {/* Current Price */}
                                <div className="flex items-center gap-3">
                                    <span className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                        {formatPrice(currentPrice)}
                                    </span>
                                </div>

                                {/* 24h Change */}
                                <div>
                                    <p className="text-gray-500 font-medium mb-0.5">24h Change</p>
                                    <p className={`font-bold flex items-center gap-1 ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {priceChangePercent >= 0 ? '+' : ''}{formatPrice(currentPrice - (currentPrice / (1 + priceChangePercent / 100)))} / {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                                    </p>
                                </div>

                                {/* 24h Volume */}
                                <div>
                                    <p className="text-gray-500 font-medium mb-0.5">24h Volume</p>
                                    <p className="font-bold text-white">
                                        {tokens.find(t => t.symbol === selectedToken)?.volume24h
                                            ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.volume24h || 0)
                                            : '-'}
                                    </p>
                                </div>

                                {/* Open Interest */}
                                <div>
                                    <p className="text-gray-500 font-medium mb-0.5">Open Interest</p>
                                    <p className="font-bold text-white">
                                        {tokens.find(t => t.symbol === selectedToken)?.openInterest
                                            ? formatCompact(tokens.find(t => t.symbol === selectedToken)?.openInterest || 0)
                                            : '-'}
                                    </p>
                                </div>

                                {/* Funding Rate */}
                                <div>
                                    <p className="text-gray-500 font-medium mb-0.5">Funding / Countdown</p>
                                    <p className="font-bold text-amber-400 flex items-center gap-2">
                                        {tokens.find(t => t.symbol === selectedToken)?.funding
                                            ? `${((tokens.find(t => t.symbol === selectedToken)?.funding || 0) * 100).toFixed(4)}%`
                                            : '0.0000%'}
                                        <span className="text-white font-mono text-xs">00:57:22</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <ConnectButton showBalance={false} accountStatus="avatar" />
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Zap className="w-4 h-4 text-yellow-500" />
                                <span>Hyperliquid L1</span>
                            </div>
                        </div>
                    </div>

                    {/* Main Content - Pro Layout (3 Columns) */}
                    <div className="flex flex-col gap-4 flex-1 min-h-0">
                        {/* Upper Section: Chart & Order Book & Analysis */}
                        <div className="flex h-[60%] gap-4 min-h-0">
                            {/* Left Panel - Chart (Flex 3) */}
                            <div className="flex-[3] bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm min-w-0">
                                <div className="flex-1 w-full h-full">
                                    <ChartWidget symbol={selectedToken} interval={selectedInterval} />
                                </div>
                            </div>

                            {/* Middle Panel - Order Book (Flex 1) */}
                            <div className="flex-1 bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm min-w-0 flex flex-col hidden xl:flex">
                                <OrderBook coin={selectedToken} />
                            </div>

                            {/* Right Panel - Trading & Analysis (Flex 1.5) */}
                            <div className="flex-[1.5] flex flex-col gap-4 min-w-0 overflow-y-auto">
                                {/* Order Form */}
                                <div className="bg-gray-900/40 border border-gray-800/50 rounded-2xl p-4 backdrop-blur-sm flex-shrink-0">
                                    <OrderForm
                                        symbol={selectedToken}
                                        currentPrice={currentPrice}
                                        isAuthenticated={isAuthenticated}
                                        onLogin={() => login('google')}
                                    />
                                </div>

                                {/* Intel Hub (Tabs: AI & News) */}
                                <div className="flex-1 bg-gray-900/40 border border-gray-800/50 rounded-2xl p-4 backdrop-blur-sm min-h-[200px] flex flex-col">
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

                                    <div className="flex-1 min-h-0 overflow-hidden">
                                        {activeTab === 'analysis' ? (
                                            <AIAnalysis symbol={selectedToken} interval={selectedInterval} />
                                        ) : (
                                            <NewsFeed symbol={selectedToken} />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Lower Section: Dashboard Panel (Positions/Orders) */}
                        <div className="flex-1 min-h-0">
                            <DashboardPanel isAuthenticated={isAuthenticated} />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
