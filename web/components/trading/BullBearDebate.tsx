'use client';
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Gavel, Sparkles, MessageSquare, AlertCircle, Quote } from 'lucide-react';

interface DebateMessage {
    id: string;
    agent: 'bull' | 'bear';
    text: string;
    evidence?: string;
    timestamp: number;
}

export default function BullBearDebate({ symbol }: { symbol: string }) {
    const [messages, setMessages] = useState<DebateMessage[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const debatePoints = {
        bull: [
            "L1 volume is surging, indicating sustained retail interest.",
            "Historical support at current levels has held 4 times this month.",
            "Sentiment indices are reset, prime for a short squeeze.",
            "Funding rates are turning negative, suggesting the market is too short."
        ],
        bear: [
            "Macro liquidity is tightening; high-beta assets like this will lead the drop.",
            "Massive whale distribution spotted on-chain over the last 72 hours.",
            "OBV is diverging bearishly while price attempts a nominal recovery.",
            "OI is bloated at current levels, open to a long liquidation cascade."
        ]
    };

    useEffect(() => {
        const fetchDebate = async () => {
            setMessages([]);
            setIsThinking(true);
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
                const res = await axios.get(`${apiUrl}/intel/debate/${symbol}`);
                if (res.data.messages) {
                    // Stagger the messages for effect
                    for (const msg of res.data.messages) {
                        setIsThinking(true);
                        await new Promise(r => setTimeout(r, 1200));
                        setMessages(prev => [...prev, {
                            id: Math.random().toString(),
                            ...msg,
                            timestamp: Date.now()
                        }]);
                    }
                }
            } catch (e) {
                console.error("Debate fetch failed", e);
            } finally {
                setIsThinking(false);
            }
        };

        fetchDebate();
    }, [symbol]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <div className="h-full flex flex-col bg-black/20 font-mono select-none overflow-hidden">
            {/* Header: Debate Status */}
            <div className="flex items-center justify-between p-3 border-b border-white/5 bg-black/40">
                <div className="flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-amber-500" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white">AI Intel Debate</h3>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex -space-x-1">
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
                            <TrendingUp className="w-3 h-3 text-emerald-400" />
                        </div>
                        <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center">
                            <TrendingDown className="w-3 h-3 text-red-400" />
                        </div>
                    </div>
                    <span className="text-[8px] bg-white/5 px-1.5 py-0.5 rounded text-gray-500 font-bold uppercase tracking-tighter">Live Session</span>
                </div>
            </div>

            {/* Message Feed */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.agent === 'bull' ? 'items-start' : 'items-end'}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className={`text-[9px] font-black uppercase tracking-widest ${msg.agent === 'bull' ? 'text-emerald-500' : 'text-red-500'}`}>
                                {msg.agent === 'bull' ? 'Bullish Strategist' : 'Bearish Analyst'}
                            </span>
                            <span className="text-[8px] text-gray-600 font-bold">16:10</span>
                        </div>
                        <div className={`max-w-[85%] p-3 rounded-xl border ${msg.agent === 'bull'
                            ? 'bg-emerald-500/5 border-emerald-500/20 rounded-tl-none'
                            : 'bg-red-500/5 border-red-500/20 rounded-tr-none'
                            }`}>
                            <p className="text-[11px] leading-relaxed text-gray-300">
                                {msg.text}
                            </p>
                            {msg.evidence && (
                                <div className={`mt-2 pt-2 border-t text-[9px] font-bold flex items-center gap-1.5 ${msg.agent === 'bull' ? 'border-emerald-500/10 text-emerald-400' : 'border-red-500/10 text-red-400'
                                    }`}>
                                    <Sparkles className="w-2.5 h-2.5" />
                                    DATA: {msg.evidence}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex items-center gap-2 text-[9px] text-gray-600 font-black uppercase tracking-widest animate-pulse">
                        <MessageSquare className="w-3 h-3" />
                        Counter-Agent Generating Response...
                    </div>
                )}
            </div>

            {/* Footer: Final Jury Verdict (Placeholder) */}
            <div className="p-3 bg-amber-500/5 border-t border-amber-500/10">
                <div className="flex items-center gap-2 mb-1">
                    <Quote className="w-3 h-3 text-amber-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-400 italic">Executive Summary</span>
                </div>
                <p className="text-[10px] text-gray-400 leading-tight">
                    The debate reveals high levels of bearish technical divergence, offset by strong L1-native accumulation. Caution is advised at current resistance.
                </p>
            </div>
        </div>
    );
}
