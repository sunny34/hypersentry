'use client';
import React, { useState, useEffect } from 'react';
import { Info, Users, Zap, Disc, Activity, BarChart3, Fingerprint, ShieldAlert, Globe } from 'lucide-react';

interface TokenDes {
    symbol: string;
    description: string;
    marketCap: string;
    fdv: string;
    circulatingSupply: string;
    totalSupply: string;
    holdingsConc: number; // Percentage
    contract: string;
    ecosystem: string[];
}

export default function InstitutionalDescription({ symbol }: { symbol: string }) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<TokenDes | null>(null);

    useEffect(() => {
        // In a real app, this would fetch from a CoinGecko/DefiLlama bridge
        // Mocking for Institutional Feel
        setLoading(true);
        setTimeout(() => {
            setData({
                symbol: symbol,
                description: `${symbol} is a core utility asset within the Hyperliquid ecosystem, facilitating decentralized perpetual trading and chain security. Built for high-throughput institutional liquidity.`,
                marketCap: '$1.42B',
                fdv: '$4.8B',
                circulatingSupply: '24.5M',
                totalSupply: '100.0M',
                holdingsConc: 12.4,
                contract: '0x...native',
                ecosystem: ['Hyperliquid', 'Arbitrum', 'L1']
            });
            setLoading(false);
        }, 800);
    }, [symbol]);

    if (loading) return (
        <div className="h-full flex flex-col items-center justify-center gap-3 bg-black/40 animate-pulse">
            <Fingerprint className="w-8 h-8 text-blue-500/50" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">Indexing Institutional Data...</span>
        </div>
    );

    return (
        <div className="h-full flex flex-col p-4 font-mono select-none overflow-y-auto scrollbar-hide">
            {/* Header: Token Identity */}
            <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center justify-center">
                    <Disc className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                    <h2 className="text-sm font-black text-white flex items-center gap-1.5 uppercase">
                        {symbol} <span className="bg-blue-500 text-black text-[9px] px-1 rounded-sm">INST</span>
                    </h2>
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Terminal Asset Profile (DES)</p>
                </div>
            </div>

            {/* Description Block */}
            <div className="mb-6">
                <p className="text-[11px] text-gray-400 leading-relaxed italic border-l-2 border-blue-500/50 pl-3">
                    "{data?.description}"
                </p>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                        <BarChart3 className="w-3 h-3 text-blue-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Market Cap</span>
                    </div>
                    <span className="text-xs text-white font-bold">{data?.marketCap}</span>
                </div>
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                        <Activity className="w-3 h-3 text-emerald-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">FDV</span>
                    </div>
                    <span className="text-xs text-white font-bold">{data?.fdv}</span>
                </div>
            </div>

            {/* Supply Analytics */}
            <div className="space-y-4 mb-6">
                <div className="flex flex-col">
                    <div className="flex justify-between items-end mb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Circulating Supply</span>
                        <span className="text-[10px] text-blue-400 font-bold">{data?.circulatingSupply} {symbol}</span>
                    </div>
                    <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: '24.5%' }} />
                    </div>
                </div>

                <div className="flex flex-col">
                    <div className="flex justify-between items-end mb-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Holder Concentration</span>
                        <div className="flex items-center gap-1">
                            <ShieldAlert className="w-2.5 h-2.5 text-amber-500" />
                            <span className="text-[10px] text-amber-500 font-bold">{data?.holdingsConc}% Top 10</span>
                        </div>
                    </div>
                    <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: '12.4%' }} />
                    </div>
                </div>
            </div>

            {/* Technical Context (New) */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-6">
                <h3 className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-blue-400" />
                    Market Signal Suite
                </h3>
                <div className="space-y-2.5">
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">RSI (14) Health</span>
                        <span className="text-emerald-400 font-black">42.5 (NORMAL)</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">Volatility (VIX)</span>
                        <span className="text-amber-400 font-black">HIGH (64%)</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">Whale Status</span>
                        <span className="text-blue-400 font-black tracking-widest animate-pulse font-mono">ACCUMULATING</span>
                    </div>
                </div>
            </div>

            {/* Tags & Ecosystem */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-white/5">
                {data?.ecosystem.map((tag) => (
                    <div key={tag} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-white/5 border border-white/10 px-2 py-1 rounded text-gray-400">
                        <Globe className="w-2.5 h-2.5" />
                        {tag}
                    </div>
                ))}
            </div>
        </div>
    );
}
