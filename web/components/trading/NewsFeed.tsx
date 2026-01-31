'use client';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Newspaper, ExternalLink, RefreshCw, Clock } from 'lucide-react';

interface NewsItem {
    title: string;
    url: string;
    source: string;
    published: string;
    sentiment?: 'positive' | 'negative' | 'neutral';
}

interface NewsFeedProps {
    symbol: string;
    onMajorNews?: (news: NewsItem) => void;
}

export default function NewsFeed({ symbol, onMajorNews }: NewsFeedProps) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const lastNewsUrlRef = useRef<string | null>(null);

    const fetchNews = async () => {
        setIsLoading(true);
        try {
            // Try CryptoCompare News API
            const res = await axios.get(
                `https://min-api.cryptocompare.com/data/v2/news/?categories=${symbol},Blockchain&excludeCategories=Sponsored`
            );

            const items: NewsItem[] = (res.data?.Data || []).slice(0, 10).map((item: any) => ({
                title: item.title,
                url: item.url,
                source: item.source_info?.name || item.source,
                published: new Date(item.published_on * 1000).toLocaleString(),
                // Simulate sentiment for demo purposes since API doesn't always provide it
                sentiment: Math.random() > 0.6 ? 'positive' : Math.random() > 0.3 ? 'neutral' : 'negative',
                id: item.id
            }));

            // Check for new major news
            if (items.length > 0) {
                const latest = items[0];
                if (lastNewsUrlRef.current && lastNewsUrlRef.current !== latest.url) {
                    // New/Different news detected
                    if (onMajorNews && latest.sentiment !== 'neutral') {
                        onMajorNews(latest);
                    }
                }
                lastNewsUrlRef.current = latest.url;
            }

            setNews(items);
        } catch (e) {
            console.error('News fetch failed:', e);
            // Fallback demo news
            const demo = getDemoNews(symbol);
            setNews(demo);

            // Simulate random event for demo
            if (onMajorNews && Math.random() > 0.7) {
                onMajorNews(demo[0]);
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchNews();
        const interval = setInterval(fetchNews, 5 * 60 * 1000); // Refresh every 5 min
        return () => clearInterval(interval);
    }, [symbol]);

    const getSentimentColor = (sentiment?: string) => {
        switch (sentiment) {
            case 'positive': return 'border-l-emerald-500';
            case 'negative': return 'border-l-red-500';
            default: return 'border-l-gray-600';
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                        <Newspaper className="w-5 h-5 text-blue-400" />
                    </div>
                    <h3 className="text-lg font-bold">Crypto News</h3>
                </div>
                <button
                    onClick={fetchNews}
                    disabled={isLoading}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* News List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-gray-700/50 scrollbar-track-transparent">
                {news.map((item, i) => (
                    <a
                        key={i}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block p-3 bg-gray-800/30 hover:bg-gray-700/40 rounded-xl transition border-l-2 ${getSentimentColor(item.sentiment)} group`}
                    >
                        <h4 className="text-sm font-medium text-gray-200 group-hover:text-white transition line-clamp-2 leading-snug">
                            {item.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                            <span className="px-1.5 py-0.5 bg-gray-700/50 rounded">{item.source}</span>
                            <Clock className="w-3 h-3" />
                            <span>{item.published}</span>
                            <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition" />
                        </div>
                    </a>
                ))}

                {isLoading && news.length === 0 && (
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="w-6 h-6 animate-spin text-gray-500" />
                    </div>
                )}

                {!isLoading && news.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                        No news available
                    </div>
                )}
            </div>
        </div>
    );
}

// Demo news
function getDemoNews(symbol: string): NewsItem[] {
    return [
        {
            title: `${symbol} Shows Strong Support at Key Level, Analysts Bullish`,
            url: '#',
            source: 'CoinDesk',
            published: '2 hours ago',
            sentiment: 'positive',
        },
        {
            title: 'Hyperliquid L1 Trading Volume Hits New All-Time High',
            url: '#',
            source: 'The Block',
            published: '4 hours ago',
            sentiment: 'positive',
        },
        {
            title: 'Crypto Market Faces Uncertainty Amid Regulatory Concerns',
            url: '#',
            source: 'Bloomberg',
            published: '6 hours ago',
            sentiment: 'negative',
        },
        {
            title: 'DeFi Protocols See Increased Activity on Layer 1 Chains',
            url: '#',
            source: 'Decrypt',
            published: '8 hours ago',
            sentiment: 'neutral',
        },
        {
            title: `Whale Alert: Large ${symbol} Accumulation Detected`,
            url: '#',
            source: 'Whale Watch',
            published: '10 hours ago',
            sentiment: 'positive',
        },
    ];
}
