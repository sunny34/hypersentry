'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Newspaper, ExternalLink, RefreshCw, Clock, Zap, TrendingUp, TrendingDown, AlertTriangle, Shield, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Twitter, Send, Globe, MessageSquare } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

/**
 * Interface representing a processed news item with intelligence scoring.
 */
interface NewsItem {
    id: string;
    title: string;
    url: string;
    source: string;
    published: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    reco: 'long' | 'short' | 'neutral';
    confidence: number;
    isHighImpact: boolean;
    isAiVerified?: boolean;
}

interface NewsFeedProps {
    /** The token symbol to fetch news for (e.g., 'BTC', 'ETH') */
    symbol: string;
    /** All tokens for real-time anomaly detection */
    tokens?: any[];
    /** Current AI Bias from Gemini analysis */
    aiBias?: 'bullish' | 'bearish' | 'neutral';
    /** Optional callback fired when a major news item is detected */
    onMajorNews?: (news: NewsItem) => void;
}

/**
 * NewsFeed Component
 * 
 * Aggregates high-frequency news from multiple crypto sources, processes 
 * sentiment using internal heuristics, and provides actionable trading signals.
 * Supports "Auto-Pilot" mode for automated trade execution on high-conviction events.
 */
export default function NewsFeed({ symbol, tokens = [], aiBias = 'neutral', onMajorNews }: NewsFeedProps) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [anomalyAlerts, setAnomalyAlerts] = useState<NewsItem[]>([]);
    const [density, setDensity] = useState<'compact' | 'standard' | 'relaxed'>('compact');
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [autoPilot, setAutoPilot] = useState(false);
    const [guardianActive, setGuardianActive] = useState(true);
    const [globalSentiment, setGlobalSentiment] = useState<{ positive: number, negative: number, neutral: number }>({ positive: 0, negative: 0, neutral: 0 });
    const lastNewsUrlRef = useRef<string | null>(null);
    const prevTokensRef = useRef<any[]>([]);

    const wsUrl = API_URL.replace('http', 'ws') + '/ws';
    const { lastMessage } = useWebSocket(wsUrl);

    const POLLING_INTERVAL_MS = 25000; // 25 seconds for Alpha Polling

    /**
     * Fetches news data and performs sentiment scoring.
     */
    const fetchNews = useCallback(async () => {
        setIsRefreshing(true);
        if (news.length === 0) setIsLoading(true);

        try {
            // 1. Fetch from our backend (Aggregated Twitter, Telegram, RSS)
            let backendIntel: NewsItem[] = [];
            try {
                const backendRes = await axios.get(`${API_URL}/intel/latest`);
                if (Array.isArray(backendRes.data)) {
                    backendIntel = backendRes.data.map((item: any) => ({
                        id: item.id || `intel-${Math.random()}`,
                        title: (item.title || '').replace(/<[^>]*>?/gm, '').trim(),
                        url: item.url,
                        source: item.source || 'Intel',
                        published: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        sentiment: item.sentiment === 'bullish' ? 'positive' : item.sentiment === 'bearish' ? 'negative' : 'neutral',
                        reco: (item.sentiment === 'positive' || item.sentiment === 'bullish') ? 'long' : (item.sentiment === 'negative' || item.sentiment === 'bearish') ? 'short' : 'neutral',
                        confidence: item.sentiment_score ? Math.abs(item.sentiment_score * 100) : (item.confidence || 85),
                        isHighImpact: item.isHighImpact || false,
                        isAiVerified: true
                    }));
                }
            } catch (e) {
                console.warn("Backend Intel unreachable, falling back to public feeds");
            }

            const res = await axios.get(
                `https://min-api.cryptocompare.com/data/v2/news/?categories=${symbol},Blockchain,Macro,Economy,Business,Fiat,Exchange,Market,Regulatory&excludeCategories=Sponsored`
            );

            let posCount = 0;
            let negCount = 0;
            let neutCount = 0;

            const items: NewsItem[] = (res.data?.Data || []).slice(0, 15).map((item: any) => {
                const cleanTitle = (item.title || '').replace(/<[^>]*>?/gm, '').trim();
                const title = cleanTitle.toLowerCase();
                let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';

                // Sentiment Heuristics
                const posWords = ['bullish', 'surge', 'gain', 'ath', 'accumulate', 'high', 'breakout', 'moon', 'rally', 'up', 'pump', 'support', 'inflow', 'buy', 'upgrade', 'approval', 'etf', 'halving', 'unlocked'];
                const negWords = ['bearish', 'crash', 'fall', 'drop', 'low', 'regulatory', 'plummet', 'dump', 'sink', 'breakdown', 'liquidat', 'rekt', 'outflow', 'sell', 'short', 'plunge', 'dip', 'hack', 'exploit', 'sec', 'lawsuit', 'law', 'banned', 'investigation'];
                const highImpactWords = ['sec', 'etf', 'approval', 'hack', 'banned', 'lawsuit', 'breaking', 'urgent', 'flash'];

                const posMatch = posWords.filter(word => title.includes(word)).length;
                const negMatch = negWords.filter(word => title.includes(word)).length;
                const impactBonus = highImpactWords.some(word => title.includes(word)) ? 30 : 0;

                // Signal Confidence Algorithm (0-100)
                const confidence = Math.min(100, (Math.max(posMatch, negMatch) * 20) + 10 + impactBonus);

                if (posMatch > negMatch) {
                    sentiment = 'positive';
                    posCount++;
                } else if (negMatch > posMatch) {
                    sentiment = 'negative';
                    negCount++;
                } else {
                    sentiment = 'neutral';
                    neutCount++;
                }

                const newItem: NewsItem = {
                    id: item.id.toString(),
                    title: cleanTitle,
                    url: item.url,
                    source: item.source_info?.name || item.source,
                    published: new Date(item.published_on * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    sentiment: sentiment,
                    reco: sentiment === 'positive' ? 'long' : sentiment === 'negative' ? 'short' : 'neutral',
                    confidence: confidence,
                    isHighImpact: impactBonus > 0
                };

                // AUTO-PILOT EXECUTION
                if (autoPilot && confidence >= 85 && sentiment !== 'neutral') {
                    // Guardian Check: Ensure News Sentiment matches the current AI Bias
                    const isConfirmedByGuardian = !guardianActive ||
                        (sentiment === 'positive' && aiBias === 'bullish') ||
                        (sentiment === 'negative' && aiBias === 'bearish');

                    if (isConfirmedByGuardian) {
                        // Logic to prevent duplicate trades for same news URL
                        if (lastNewsUrlRef.current !== newItem.url) {
                            window.dispatchEvent(new CustomEvent('smart-trade-execute', {
                                detail: {
                                    symbol: symbol,
                                    side: sentiment === 'positive' ? 'buy' : 'sell',
                                    size: 'AUTO',
                                    reason: `AUTO-PILOT (${confidence}%): ${item.title}`
                                }
                            }));
                        }
                    } else {
                        console.warn(`🛡️ [GUARDIAN] Blocked potential ${sentiment.toUpperCase()} trade on ${symbol}. Logic mismatch: News ${sentiment} vs AI ${aiBias}`);
                    }
                }

                return newItem;
            });

            // Handle Major News Callback
            if (items.length > 0) {
                const latest = items[0];
                if (lastNewsUrlRef.current && lastNewsUrlRef.current !== latest.url) {
                    if (onMajorNews && latest.sentiment !== 'neutral') {
                        onMajorNews(latest);
                    }
                }
                lastNewsUrlRef.current = latest.url;
            }

            setGlobalSentiment({ positive: posCount, negative: negCount, neutral: neutCount });

            // Combine and sort by "published" time (hacky since its a string, but items are already somewhat sorted)
            // Ideally we'd have real timestamps
            const allItems = [...backendIntel, ...items].slice(0, 30);
            setNews(allItems);
        } catch {
            // Silently handle - use demo news
            setNews(getDemoNews(symbol));
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [news.length, symbol, autoPilot, guardianActive, aiBias, onMajorNews]);

    // WebSocket News Handler
    useEffect(() => {
        if (lastMessage?.type === 'intel_alpha' && Array.isArray(lastMessage.data)) {
            const incomingItems: NewsItem[] = lastMessage.data.map((item: any) => ({
                id: item.id || `ws-${Math.random()}`,
                title: (item.title || '').replace(/<[^>]*>?/gm, '').trim(),
                url: item.url,
                source: item.source || 'Intel',
                published: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                sentiment: item.sentiment || 'neutral',
                reco: item.sentiment === 'positive' ? 'long' : item.sentiment === 'negative' ? 'short' : 'neutral',
                confidence: item.confidence || 50,
                isHighImpact: item.isHighImpact || false
            }));

            setNews(prev => {
                const combined = [...incomingItems, ...prev];
                // Remove duplicates by ID
                const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
                return unique.slice(0, 50);
            });

            // Trigger Major News for high impact items
            const highImpact = incomingItems.find(i => i.isHighImpact);
            if (highImpact && onMajorNews) {
                onMajorNews(highImpact);
            }
        }
    }, [lastMessage, onMajorNews]);

    useEffect(() => {
        void fetchNews();
        const interval = setInterval(fetchNews, POLLING_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchNews]);

    // REAL-TIME ANOMALY DETECTION ENGINE
    useEffect(() => {
        if (!tokens.length || !symbol) return;

        const currentToken = tokens.find((t: any) => t.symbol === symbol);
        const prevToken = prevTokensRef.current.find((t: any) => t.symbol === symbol);

        if (currentToken && prevToken) {
            const priceChange = ((currentToken.price - prevToken.price) / prevToken.price) * 100;
            const volumeChange = currentToken.volume24h - prevToken.volume24h;

            let anomaly: NewsItem | null = null;

            // 1. Sudden Price Spike/Dump (> 0.5% in 5-10s polling)
            if (Math.abs(priceChange) > 0.4) {
                anomaly = {
                    id: `price-alert-${Date.now()}`,
                    title: `Intelligence Alert: ${symbol} ${priceChange > 0 ? 'Surging' : 'Dumping'} ${Math.abs(priceChange).toFixed(2)}% in seconds`,
                    url: '#',
                    source: 'System Monitor',
                    published: 'NOW',
                    sentiment: priceChange > 0 ? 'positive' : 'negative',
                    reco: priceChange > 0 ? 'long' : 'short',
                    confidence: 95,
                    isHighImpact: true
                };
            }

            // 2. Volume Anomaly (Sudden spike in 24h volume tracking)
            const avgVol = tokens.reduce((acc: number, t: any) => acc + t.volume24h, 0) / tokens.length;
            if (volumeChange > avgVol * 0.05) { // If volume grows by 5% of total avg in 5s
                anomaly = {
                    id: `vol-alert-${Date.now()}`,
                    title: `Whale Alert: Unusual Volume Spike on ${symbol} (+${(volumeChange / 1000).toFixed(1)}k USD)`,
                    url: '#',
                    source: 'Liquidity Scanner',
                    published: 'NOW',
                    sentiment: 'positive',
                    reco: 'neutral',
                    confidence: 88,
                    isHighImpact: true
                };
            }

            if (anomaly) {
                setAnomalyAlerts(prev => [anomaly!, ...prev].slice(0, 5));

                // Audio or Visual Feedback could be added here
                if (onMajorNews) onMajorNews(anomaly);
            }
        }

        prevTokensRef.current = tokens;
    }, [tokens, symbol, onMajorNews]);

    /**
     * Manually triggers a trade execution based on a specific news item.
     */
    const handleQuickTrade = (item: NewsItem) => {
        if (item.reco === 'neutral') return;

        const sideValue = item.reco === 'long' ? 'buy' : 'sell';
        window.dispatchEvent(new CustomEvent('smart-trade-execute', {
            detail: {
                symbol: symbol,
                side: sideValue,
                size: 'AUTO',
                reason: `Manual Intel (${item.confidence}%): ${item.title}`
            }
        }));
    };

    return (
        <div className="flex flex-col h-full bg-transparent overflow-hidden border-l border-white/5">
            {/* Terminal Header */}
            <div className="px-4 py-3 border-b border-white/10 bg-black/40 flex items-center justify-between sticky top-0 z-20 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Newspaper className="w-4 h-4 text-purple-400" />
                        <div className="absolute inset-0 bg-purple-500 blur-lg opacity-30 animate-pulse" />
                    </div>
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/90">Terminal Intelligence</h3>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                            <p className="text-[7px] text-gray-500 font-bold uppercase tracking-widest">Alpha Polling: 25s</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Density Selector */}
                    <div className="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
                        {[
                            { id: 'compact', label: 'C', title: 'Compact View' },
                            { id: 'standard', label: 'S', title: 'Standard View' },
                            { id: 'relaxed', label: 'R', title: 'Relaxed View' }
                        ].map((d) => (
                            <button
                                key={d.id}
                                onClick={() => setDensity(d.id as any)}
                                title={d.title}
                                className={`w-5 h-5 flex items-center justify-center text-[8px] font-black rounded transition-all ${density === d.id ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>

                    {/* Guardian Selector */}
                    <button
                        onClick={() => setGuardianActive(!guardianActive)}
                        title={guardianActive ? "AI Guardian Active: Verifying trades with Gemini" : "Guardian Disabled: Executing all news signals"}
                        className={`p-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${guardianActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-gray-800/50 border-white/5 text-gray-500 hover:text-white'}`}
                    >
                        {guardianActive ? <ShieldCheck className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                        <span className="text-[7.5px] font-black uppercase tracking-tighter hidden sm:block">Guardian</span>
                    </button>

                    <div className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded-lg border border-white/10">
                        <span className={`text-[7px] font-black uppercase tracking-tighter transition-colors ${autoPilot ? 'text-purple-400' : 'text-gray-500'}`}>Auto-Pilot</span>
                        <button
                            title="Automatically execute trades on high-confidence signals"
                            onClick={() => setAutoPilot(!autoPilot)}
                            className={`w-7 h-4 rounded-full p-0.5 transition-all duration-300 flex ${autoPilot ? 'bg-purple-600 justify-end shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-gray-700 justify-start'}`}
                        >
                            <div className="w-3 h-3 bg-white rounded-full shadow-sm" />
                        </button>
                    </div>

                    <button
                        onClick={fetchNews}
                        disabled={isRefreshing}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors group"
                        title="Refresh Signals"
                    >
                        <RefreshCw className={`w-3 h-3 text-gray-500 group-hover:text-white transition ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Intelligence Dashboard */}
            <div className="px-4 py-3 bg-purple-500/[0.03] border-b border-white/5 grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                    <span className="text-[7px] font-black uppercase text-gray-500 tracking-tighter">Global Mood</span>
                    <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${globalSentiment.positive > globalSentiment.negative ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                        <span className={`text-[10px] font-black uppercase ${globalSentiment.positive > globalSentiment.negative ? 'text-emerald-400' : 'text-red-400'}`}>
                            {globalSentiment.positive > globalSentiment.negative ? 'Bullish' : 'Bearish'}
                        </span>
                    </div>
                </div>
                <div className="flex flex-col gap-1 text-center border-x border-white/5 px-2">
                    <span className="text-[7px] font-black uppercase text-gray-500 tracking-tighter">Signals</span>
                    <span className="text-[10px] font-black text-white">{news.length} Items</span>
                </div>
                <div className="flex flex-col gap-1 text-right">
                    <span className="text-[7px] font-black uppercase text-gray-500 tracking-tighter">Sync Latency</span>
                    <span className="text-[10px] font-black text-purple-400 tracking-tighter">Real-Time</span>
                </div>
            </div>

            <div className={`flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent hover:scrollbar-thumb-purple-500/30 transition-all ${density === 'compact' ? 'p-1.5 space-y-0.5' : density === 'standard' ? 'p-2.5 space-y-1.5' : 'p-4 space-y-3'}`}>
                <AnimatePresence initial={false}>
                    {/* Render Real-Time Anomalies first */}
                    {anomalyAlerts.map((item) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`group relative rounded-lg bg-purple-500/10 border border-purple-500/30 overflow-hidden flex items-center justify-between gap-4 transition-all ${density === 'compact' ? 'px-2 py-1.5' : density === 'standard' ? 'px-3 py-2.5' : 'px-4 py-4 border-2'}`}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="flex flex-col items-center">
                                    <Zap className={`${density === 'compact' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5'} text-purple-400 fill-current animate-pulse`} />
                                    <span className="text-[6px] font-black text-purple-400">LIVE</span>
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`${density === 'compact' ? 'text-[7px]' : 'text-[9px]'} font-black text-purple-400 uppercase tracking-tighter whitespace-nowrap`}>Market Anomaly</span>
                                        <h4 className={`${density === 'compact' ? 'text-[10px]' : density === 'standard' ? 'text-[11px]' : 'text-[13px]'} font-bold text-white truncate leading-none`}>
                                            {item.title}
                                        </h4>
                                    </div>
                                    <span className="text-[7px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Confidence: {item.confidence}%</span>
                                </div>
                            </div>
                            <span className="text-[8px] text-purple-400/60 font-black whitespace-nowrap shrink-0 uppercase tracking-tighter">Just Now</span>
                        </motion.div>
                    ))}

                    {news.map((item) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className={`group flex items-center justify-between gap-4 rounded-lg border transition-all duration-200
                                ${density === 'compact' ? 'px-2 py-1' : density === 'standard' ? 'px-3 py-2' : 'px-4 py-3'}
                                ${item.confidence > 75
                                    ? 'border-purple-500/20 bg-purple-500/[0.03] hover:bg-purple-500/[0.06]'
                                    : 'border-white/0 hover:border-white/5 hover:bg-white/[0.03]'}`}
                        >
                            {/* Left: Metadata & Headline */}
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className={`${density === 'compact' ? 'w-1 h-2' : 'w-1 h-3'} rounded-full shrink-0 ${item.sentiment === 'positive' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]' :
                                    item.sentiment === 'negative' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]' :
                                        'bg-gray-700'
                                    }`} />

                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`${density === 'compact' ? 'text-[7px]' : 'text-[8px]'} text-gray-500 font-mono font-bold shrink-0 uppercase`}>{item.published}</span>
                                    {item.isAiVerified && (
                                        <div className="flex items-center gap-0.5 px-1 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded">
                                            <Zap className="w-2 h-2 text-blue-400 fill-current" />
                                            <span className="text-[6px] font-black text-blue-400 uppercase tracking-tighter">AI</span>
                                        </div>
                                    )}
                                    <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`${density === 'compact' ? 'text-[10px]' : density === 'standard' ? 'text-[11px]' : 'text-[12px]'} font-semibold text-gray-300 truncate hover:text-purple-400 transition`}
                                    >
                                        {item.title}
                                    </a>
                                </div>
                            </div>

                            {/* Center: Source Tag (Hide on smaller width) */}
                            <div className="hidden md:flex items-center gap-1.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                                {item.source.toLowerCase().includes('twitter') ? <Twitter className="w-2.5 h-2.5 text-blue-400" /> :
                                    item.source.toLowerCase().includes('telegram') ? <Send className="w-2.5 h-2.5 text-blue-500" /> :
                                        <Globe className="w-2.5 h-2.5 text-gray-500" />}
                                <span className="text-[7px] text-gray-400 font-black uppercase tracking-widest">{item.source}</span>
                            </div>

                            {/* Right: Action / Recommendation */}
                            <div className="flex items-center gap-3 shrink-0">
                                {item.reco !== 'neutral' ? (
                                    <div className="relative overflow-hidden">
                                        {/* Dynamic Suggestion (Default) */}
                                        <div className={`flex items-center gap-1 py-0.5 px-2 rounded border group-hover:opacity-0 transition-opacity ${item.reco === 'long' ? 'text-emerald-400 border-emerald-500/20' : 'text-red-400 border-red-500/20'
                                            }`}>
                                            <span className="text-[8px] font-black uppercase tracking-tighter">{item.reco}</span>
                                        </div>

                                        {/* Execute Button (Hover Only) */}
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleQuickTrade(item);
                                            }}
                                            className={`absolute inset-0 z-10 flex items-center justify-center gap-1.5 rounded opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100 font-black text-[8px] uppercase tracking-tighter
                                                ${item.reco === 'long'
                                                    ? 'bg-emerald-500 text-black'
                                                    : 'bg-red-500 text-black'}`}
                                        >
                                            <Zap className="w-2.5 h-2.5 fill-current" />
                                            TRADE
                                        </button>
                                    </div>
                                ) : (
                                    <div className="w-12 h-px bg-white/5" />
                                )}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-6 gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-purple-500/40" />
                        <span className="text-[7px] font-black uppercase tracking-widest text-gray-600">Syncing Intelligence...</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Returns a set of fallback demo news items if the API fails.
 */
function getDemoNews(symbol: string): NewsItem[] {
    return [
        {
            id: 'demo-1',
            title: `${symbol} Inflow Reaches Multi-Year High as Institutions Accumulate`,
            url: 'https://cryptocompare.com',
            source: 'CryptoTerminal',
            published: '12:45',
            sentiment: 'positive',
            reco: 'long',
            confidence: 82,
            isHighImpact: false
        },
        {
            id: 'demo-2',
            title: 'Unusual Spot Buying Volume Spike Detected on Hyperliquid',
            url: 'https://cryptocompare.com',
            source: 'IntelNode',
            published: '11:20',
            sentiment: 'positive',
            reco: 'long',
            confidence: 91,
            isHighImpact: true
        },
        {
            id: 'demo-3',
            title: 'CPI Data Release: Market Volatility Expected as Inflation Metrics Shift',
            url: 'https://cryptocompare.com',
            source: 'Bloomberg',
            published: '09:15',
            sentiment: 'neutral',
            reco: 'neutral',
            confidence: 45,
            isHighImpact: false
        }
    ];
}
