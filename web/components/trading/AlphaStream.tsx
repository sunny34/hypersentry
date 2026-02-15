'use client';
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ArrowRight, Activity } from 'lucide-react';
import axios from 'axios';
import { getApiUrl } from '@/lib/constants';

const API_URL = getApiUrl();

interface AlphaItem {
    id: string;
    title: string;
    content: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    sentiment_score: number;
    timestamp: string;
    source: string;
    is_high_impact: boolean;
    metadata?: { symbol?: string; [key: string]: unknown };
}

export default function AlphaStream({ onSelectToken }: { onSelectToken: (symbol: string) => void }) {
    const [items, setItems] = useState<AlphaItem[]>([]);
    const [filter, setFilter] = useState<'all' | 'high' | 'sentiment'>('all');
    const scrollRef = useRef<HTMLDivElement>(null);
    const fetchErrorLoggedRef = useRef(false);

    // Initial Fetch
    useEffect(() => {
        const fetchIntel = async () => {
            try {
                const res = await axios.get(`${API_URL}/intel/latest`);
                if (Array.isArray(res.data)) {
                    setItems(res.data);
                }
                fetchErrorLoggedRef.current = false;
            } catch {
                if (!fetchErrorLoggedRef.current) {
                    fetchErrorLoggedRef.current = true;
                    console.warn('Alpha stream temporarily unavailable');
                }
            }
        };

        fetchIntel();
        const interval = setInterval(fetchIntel, 5000); // Poll every 5s (or use WS if available in parent)
        return () => clearInterval(interval);
    }, []);

    const filteredItems = items.filter(item => {
        if (filter === 'high') return item.is_high_impact || Math.abs(item.sentiment_score) > 5;
        if (filter === 'sentiment') return item.sentiment !== 'neutral';
        return true;
    });

    const handleItemClick = (item: AlphaItem) => {
        // Extract symbol from title or metadata
        const symbol = item.metadata?.symbol || extractSymbol(item.title);
        if (symbol) {
            onSelectToken(symbol);
        }
    };

    const extractSymbol = (text: string) => {
        const match = text.match(/\$([A-Z]{2,6})\b/) || text.match(/\b([A-Z]{2,6})\b/); // Simple heuristic
        if (match && !['BTC', 'ETH', 'SOL'].includes(match[1])) return match[1]; // Prefer metadata
        return match ? match[1] : null;
    };

    return (
        <div className="flex flex-col h-full bg-[#050505] border-l border-white/5 w-80">
            {/* Header */}
            <div className="p-3 border-b border-white/5 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-widest text-gray-200">Alpha Stream</span>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-2 py-1 text-[9px] font-bold uppercase rounded hover:bg-white/10 ${filter === 'all' ? 'text-white bg-white/10' : 'text-gray-500'}`}
                    >
                        All
                    </button>
                    <button
                        onClick={() => setFilter('high')}
                        className={`px-2 py-1 text-[9px] font-bold uppercase rounded hover:bg-white/10 ${filter === 'high' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500'}`}
                    >
                        High
                    </button>
                </div>
            </div>

            {/* Stream */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 p-2 space-y-2" ref={scrollRef}>
                <AnimatePresence initial={false}>
                    {filteredItems.map((item) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, height: 0 }}
                            layout
                            className={`group relative p-3 rounded-lg border cursor-pointer transition-all hover:bg-white/5 active:scale-[0.98] ${item.sentiment === 'bullish' ? 'bg-emerald-500/5 border-emerald-500/10 hover:border-emerald-500/30' :
                                    item.sentiment === 'bearish' ? 'bg-red-500/5 border-red-500/10 hover:border-red-500/30' :
                                        'bg-gray-800/20 border-white/5 hover:border-white/10'
                                }`}
                            onClick={() => handleItemClick(item)}
                        >
                            {/* Sentiment Bar */}
                            <div className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-r ${item.sentiment === 'bullish' ? 'bg-emerald-500' :
                                    item.sentiment === 'bearish' ? 'bg-red-500' :
                                        'bg-gray-600'
                                }`} />

                            <div className="flex items-start justify-between gap-2 mb-1 pl-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wide ${item.source === 'microstructure' ? 'text-blue-400' :
                                        item.source === 'twitter' ? 'text-sky-400' :
                                            'text-gray-400'
                                    }`}>
                                    {item.source}
                                </span>
                                <span className="text-[9px] font-mono text-gray-600 flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" />
                                    {formatTime(item.timestamp)}
                                </span>
                            </div>

                            <h4 className="text-xs font-bold text-gray-200 mb-1 pl-2 leading-snug group-hover:text-white transition-colors">
                                {item.title}
                            </h4>

                            <p className="text-[10px] text-gray-500 pl-2 line-clamp-2 leading-relaxed">
                                {item.content}
                            </p>

                            {item.metadata?.symbol && (
                                <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-1 rounded bg-white/10 hover:bg-white/20 text-white">
                                        <ArrowRight className="w-3 h-3" />
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>

                {filteredItems.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600">
                        <Activity className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-xs font-mono">No signals detected</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;

    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
