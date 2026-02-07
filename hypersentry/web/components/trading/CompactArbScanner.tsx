'use client';
import React, { useState, useEffect } from 'react';
import { Zap, RefreshCw, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import axios from 'axios';

interface ArbOpportunity {
    symbol: string;
    hlFunding: number;
    binanceFunding: number;
    spread: number;
    direction: string;
}

export default function CompactArbScanner() {
    const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const res = await axios.get(`${apiUrl}/trading/arb`);
            if (res.data.opportunities) {
                setOpportunities(res.data.opportunities.slice(0, 5));
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="h-full flex flex-col font-mono select-none overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/5 bg-black/40">
                <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-blue-400" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Cross-Venue Arb</h3>
                </div>
                <button onClick={fetchData} className={`transition-all ${loading ? 'animate-spin' : ''}`}>
                    <RefreshCw className="w-3 h-3 text-gray-500 hover:text-white" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide">
                <table className="w-full text-left">
                    <thead className="text-[8px] text-gray-600 uppercase font-black bg-white/[0.02] sticky top-0">
                        <tr>
                            <th className="px-3 py-2">Asset</th>
                            <th className="px-3 py-2 text-right">Spread</th>
                            <th className="px-3 py-2 text-right">Direction</th>
                        </tr>
                    </thead>
                    <tbody className="text-[10px] divide-y divide-white/5">
                        {opportunities.map((opp) => (
                            <tr key={opp.symbol} className="hover:bg-white/[0.03] transition-colors group">
                                <td className="px-3 py-2.5 font-bold text-gray-300 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                    {opp.symbol}
                                </td>
                                <td className="px-3 py-2.5 text-right font-black text-emerald-400">
                                    {opp.spread.toFixed(2)}%
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <span className={`text-[8px] px-1.5 py-0.5 rounded font-black border ${opp.direction.includes('Short HL')
                                            ? 'border-red-500/30 text-red-500 bg-red-500/5'
                                            : 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5'
                                        }`}>
                                        {opp.direction.includes('Short HL') ? 'SHORT HL' : 'LONG HL'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {opportunities.length === 0 && !loading && (
                    <div className="p-4 text-center text-[10px] text-gray-600 italic">No convergence targets found</div>
                )}
            </div>

            <div className="p-2 border-t border-white/5 bg-blue-500/5 flex justify-between items-center">
                <span className="text-[8px] text-blue-400/80 font-black uppercase tracking-tighter">Live Arbitrage Engine</span>
                <span className="text-[7px] text-gray-600 font-bold">5ms Latency Check</span>
            </div>
        </div>
    );
}
