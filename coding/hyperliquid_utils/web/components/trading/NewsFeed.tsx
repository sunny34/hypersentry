'use client';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Newspaper, ExternalLink, RefreshCw, Clock, Zap, TrendingUp, TrendingDown, AlertTriangle, Shield, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
}

interface NewsFeedProps {
    /** The token symbol to fetch news for (e.g., 'BTC', 'ETH') */
    symbol: string;
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
export default function NewsFeed({ symbol, aiBias = 'neutral', onMajorNews }: NewsFeedProps) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [autoPilot, setAutoPilot] = useState(false);
    const [guardianActive, setGuardianActive] = useState(true);
    const [globalSentiment, setGlobalSentiment] = useState<{ positive: number, negative: number, neutral: number }>({ positive: 0, negative: 0, neutral: 0 });
    const lastNewsUrlRef = useRef<string | null>(null);

    const POLLING_INTERVAL_MS = 25000; // 25 seconds for Alpha Polling

    /**
     * Fetches news data and performs sentiment scoring.
     */
    const fetchNews = async () => {
        setIsRefreshing(true);
        if (news.length === 0) setIsLoading(true);

        try {
            const res = await axios.get(
                `https://min-api.cryptocompare.com/data/v2/news/?categories=${symbol},Blockchain,Exchange,Market,Regulatory&excludeCategories=Sponsored`
            );

            let posCount = 0;
            let negCount = 0;
            let neutCount = 0;

            const items: NewsItem[] = (res.data?.Data || []).slice(0, 15).map((item: any) => {
                const title = item.title.toLowerCase();
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
                    title: item.title,
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
                            console.log(`🤖 [AUTO-PILOT] Confirmed by Guardian. Executing ${sentiment.toUpperCase()} on ${newItem.title}`);
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
            setNews(items);
        } catch (e) {
            console.error('Terminal: News fetch failed:', e);
            setNews(getDemoNews(symbol));
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchNews();
        const interval = setInterval(fetchNews, POLLING_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [symbol, autoPilot]);

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

            <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide p-3 space-y-3">
                <AnimatePresence initial={false}>
                    {news.map((item) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`group relative p-3.5 rounded-2xl bg-white/[0.02] border transition-all duration-300
                                ${item.confidence > 70 ? 'border-purple-500/30 bg-purple-500/[0.03] shadow-[0_0_20px_rgba(168,85,247,0.05)]' : 'border-white/5 hover:bg-white/[0.04]'}`}
                        >
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest border shadow-sm
                                            ${item.sentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                                                item.sentiment === 'negative' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                                                    'bg-gray-800/50 text-gray-500 border-white/5'}`}>
                                            {item.sentiment}
                                        </div>
                                        {item.confidence > 70 && (
                                            <div className="flex items-center gap-1 animate-pulse" title={`Confidence score based on keyword impact: ${item.confidence}%`}>
                                                <Zap className="w-2.5 h-2.5 text-purple-400" />
                                                <span className="text-[7px] font-black text-purple-400 uppercase tracking-widest">High Conviction</span>
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-[8px] text-gray-600 font-bold uppercase">{item.published}</span>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[12px] font-bold text-gray-200 leading-snug hover:text-purple-400 hover:underline transition line-clamp-2 decoration-purple-500/50 underline-offset-4"
                                    >
                                        {item.title}
                                    </a>
                                    <span className="text-[7px] text-gray-400 font-bold uppercase tracking-widest opacity-60">Source: {item.source}</span>
                                </div>

                                <div className="flex items-center justify-between pt-1">
                                    <div className="flex items-center gap-2">
                                        {item.sentiment === 'neutral' ? (
                                            <div className="flex items-center gap-1.5 text-[8px] text-gray-500 font-bold uppercase italic">
                                                <AlertTriangle className="w-2.5 h-2.5" />
                                                Mixed Signals
                                            </div>
                                        ) : (
                                            <div className={`flex items-center gap-1.5 text-[8px] font-black uppercase tracking-tighter
                                                 ${item.reco === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {item.reco === 'long' ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                                Suggestion: {item.reco}
                                            </div>
                                        )}
                                    </div>

                                    {item.reco !== 'neutral' && (
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleQuickTrade(item);
                                            }}
                                            className={`relative z-30 flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-tighter transition-all hover:scale-[1.05] active:scale-95 shadow-lg active:shadow-inner
                                                ${item.reco === 'long'
                                                    ? 'bg-emerald-500 text-black shadow-emerald-500/20 hover:bg-emerald-400'
                                                    : 'bg-red-500 text-black shadow-red-500/20 hover:bg-red-400'}`}
                                        >
                                            <Zap className="w-2.5 h-2.5 fill-current" />
                                            Execute {item.reco}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {isLoading && (
                    <div className="h-full flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="relative">
                            <RefreshCw className="w-8 h-8 animate-spin text-purple-500/40" />
                            <div className="absolute inset-0 bg-purple-500 blur-2xl opacity-10 animate-pulse" />
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Syncing Intelligence...</span>
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
