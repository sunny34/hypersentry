'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Newspaper, Flame, ExternalLink } from 'lucide-react';

interface NewsTickerProps extends React.HTMLAttributes<HTMLDivElement> {
    symbol: string;
}

interface NewsItem {
    title: string;
    url: string;
    source: string;
    time: string;
}

export default function NewsTicker({ symbol, className, ...props }: NewsTickerProps) {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchNews = async () => {
            try {
                // Fetch news for the specific symbol + general blockchain news
                const res = await axios.get(
                    `https://min-api.cryptocompare.com/data/v2/news/?categories=${symbol},Blockchain&excludeCategories=Sponsored`
                );

                const items = (res.data?.Data || []).slice(0, 10).map((item: any) => ({
                    title: item.title,
                    url: item.url,
                    source: item.source_info?.name || item.source,
                    time: new Date(item.published_on * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }));

                setNews(items);
                setLoading(false);
            } catch (e) {
                console.error("News fetch error", e);
                setLoading(false);
                // Fallback demo news if API fails
                setNews([
                    { title: `${symbol} breaks key resistance level amid high volume`, url: '#', source: 'MarketWatch', time: '10:00 AM' },
                    { title: 'Global crypto adoption reaches new milestone', url: '#', source: 'CoinDesk', time: '09:45 AM' },
                    { title: `Institutional interest in ${symbol} growing rapidly`, url: '#', source: 'Bloomberg', time: '09:30 AM' },
                ]);
            }
        };

        fetchNews();
        const interval = setInterval(fetchNews, 300000); // 5 min refresh
        return () => clearInterval(interval);
    }, [symbol]);

    return (
        <div className={`w-full bg-gradient-to-r from-blue-900/20 via-black/40 to-blue-900/20 border-y border-white/5 backdrop-blur-md h-10 flex items-center overflow-hidden relative ${className}`} {...props}>
            {/* Label */}
            <div className="bg-blue-600/20 h-full px-4 flex items-center gap-2 z-10 border-r border-blue-500/30 backdrop-blur-xl">
                <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
                <span className="text-xs font-bold text-blue-200 tracking-wider uppercase">Live News</span>
            </div>

            {/* Ticker Content */}
            <div className="flex-1 overflow-hidden relative flex items-center">
                <div className="animate-ticker flex items-center whitespace-nowrap absolute">
                    {/* Duplicate set for seamless loop intent (simplified CSS animation usually requires this or JS measurements) */}
                    {[...news, ...news].map((item, i) => (
                        <div key={i} className="inline-flex items-center mx-8 group">
                            <span className="text-gray-400 text-xs font-mono mr-2">[{item.time}]</span>
                            <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-gray-200 hover:text-cyan-400 transition flex items-center gap-1"
                            >
                                {item.title}
                                <span className="text-xs text-gray-500 bg-gray-800 px-1.5 rounded ml-2 group-hover:bg-gray-700 transition">
                                    {item.source}
                                </span>
                            </a>
                            <span className="mx-6 text-blue-500/30 text-xs">●</span>
                        </div>
                    ))}

                    {loading && <span className="text-gray-500 text-sm ml-4">Loading market intelligence...</span>}
                </div>
            </div>

            {/* Gradient Fade Masks */}
            <div className="absolute left-[110px] top-0 bottom-0 w-8 bg-gradient-to-r from-black/80 to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-black/80 to-transparent z-10 pointer-events-none" />

            <style jsx>{`
                @keyframes ticker {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
                .animate-ticker {
                    animation: ticker 60s linear infinite;
                }
                .animate-ticker:hover {
                    animation-play-state: paused;
                }
            `}</style>
        </div>
    );
}
