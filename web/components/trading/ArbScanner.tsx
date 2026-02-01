'use client';

import { useState, useEffect } from 'react';
import { ArrowRight, ExternalLink, RefreshCw, TrendingUp, AlertTriangle, DollarSign, Zap } from 'lucide-react';
import axios from 'axios';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface ArbOpportunity {
    symbol: string;
    hlFunding: number; // % per hour
    binanceFunding: number; // % per hour
    spread: number; // Annualized % diff
    direction: 'Long HL / Short CEX' | 'Short HL / Long CEX';
    confidence: number;
}

export default function ArbScanner() {
    const { token, isAuthenticated } = useAuth();
    const router = useRouter();
    const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([]);
    const [loading, setLoading] = useState(true);
    const [executing, setExecuting] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchArbData = async () => {
        setLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const res = await axios.get(`${apiUrl}/trading/arb`);

            if (res.data.opportunities) {
                const ops: ArbOpportunity[] = res.data.opportunities.map((o: any) => ({
                    symbol: o.symbol,
                    hlFunding: o.hlFunding,
                    binanceFunding: o.binanceFunding,
                    spread: o.spread,
                    direction: o.direction,
                    // Confidence is high because data is real
                    confidence: 100
                }));
                setOpportunities(ops);
                setLastUpdated(new Date());
            }

        } catch (e) {
            console.error("Failed to fetch arb data", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchArbData();
        const interval = setInterval(fetchArbData, 30000); // 30s refresh
        return () => clearInterval(interval);
    }, []);

    const executeArb = async (opp: ArbOpportunity) => {
        if (!isAuthenticated) {
            alert("Please login to execute trades.");
            return;
        }

        setExecuting(opp.symbol);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            await axios.post(`${apiUrl}/trading/execute_arb`, {
                symbol: opp.symbol,
                size_usd: 10, // Hardcoded $10 for safety test
                direction: opp.direction
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            alert(`Execution triggered for ${opp.symbol}! Check Active Trades.`);
        } catch (e: any) {
            if (e.response?.data?.error?.includes("Missing keys")) {
                if (confirm("Setup API Keys first! Go to Settings?")) {
                    router.push('/settings');
                }
            } else {
                alert(`Failed to execute: ${e.response?.data?.error || e.message}`);
            }
        } finally {
            setExecuting(null);
        }
    };

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Header / Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl backdrop-blur-sm">
                    <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Top APR</div>
                    <div className="text-2xl font-mono font-bold text-emerald-400">
                        {opportunities.length > 0 ? `+${opportunities[0].spread.toFixed(1)}%` : '--'}
                    </div>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl backdrop-blur-sm">
                    <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Active Opps</div>
                    <div className="text-2xl font-mono font-bold text-blue-400">
                        {opportunities.length}
                    </div>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl backdrop-blur-sm flex items-center justify-between">
                    <div>
                        <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Status</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '--'}
                        </div>
                    </div>
                    <button
                        onClick={fetchArbData}
                        disabled={loading}
                        className={`p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition ${loading ? 'animate-spin' : ''}`}>
                        <RefreshCw className="w-4 h-4 text-gray-300" />
                    </button>
                </div>
            </div>

            {/* Main Table */}
            <div className="flex-1 bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden backdrop-blur-sm flex flex-col">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/40">
                    <h3 className="font-bold flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-emerald-500" />
                        Cross-Venue Opportunities
                    </h3>
                    <div className="text-xs text-gray-500 bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded border border-emerald-500/20 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        Live Binance v/s Hyperliquid Data
                    </div>
                </div>

                <div className="overflow-auto flex-1 scanner-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-900/80 sticky top-0 z-10 text-xs uppercase text-gray-500 font-bold">
                            <tr>
                                <th className="p-4">Asset</th>
                                <th className="p-4 text-right">HL Funding (1h)</th>
                                <th className="p-4 text-right">Binance (1h)</th>
                                <th className="p-4 text-right">Est. APR Spread</th>
                                <th className="p-4">Strategy</th>
                                <th className="p-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/50 text-sm">
                            {loading && opportunities.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-500">
                                        <div className="flex justify-center items-center gap-2">
                                            <RefreshCw className="w-4 h-4 animate-spin" /> Scanning venues...
                                        </div>
                                    </td>
                                </tr>
                            ) : opportunities.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-500">No high-yield opportunities found right now.</td>
                                </tr>
                            ) : (
                                opportunities.map((opp) => (
                                    <tr key={opp.symbol} className="hover:bg-gray-800/30 transition group">
                                        <td className="p-4 font-bold text-white flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-400">
                                                {opp.symbol.substring(0, 2)}
                                            </div>
                                            {opp.symbol}
                                        </td>
                                        <td className={`p-4 text-right font-mono ${opp.hlFunding > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {(opp.hlFunding * 100).toFixed(4)}%
                                        </td>
                                        <td className={`p-4 text-right font-mono ${opp.binanceFunding > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {(opp.binanceFunding * 100).toFixed(4)}%
                                        </td>
                                        <td className="p-4 text-right font-mono font-bold text-emerald-300">
                                            {opp.spread.toFixed(2)}%
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className={`px-2 py-1 rounded border ${opp.direction.includes('Short HL')
                                                    ? 'bg-red-500/10 border-red-500/30 text-red-300'
                                                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                                    }`}>
                                                    {opp.direction}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => executeArb(opp)}
                                                disabled={!!executing}
                                                className={`px-3 py-1.5 rounded transition flex items-center gap-2 mx-auto ${executing === opp.symbol ? 'bg-orange-500/20 text-orange-400 cursor-wait' : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white'
                                                    }`}
                                                title={executing ? "Executing..." : "Execute API Trade"}
                                            >
                                                {executing === opp.symbol ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                                                {executing === opp.symbol ? 'Sending...' : 'Execute'}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
