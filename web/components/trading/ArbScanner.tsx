'use client';

import { useState, useEffect, useCallback } from 'react';
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
    const [activeTrades, setActiveTrades] = useState<any[]>([]);
    const [binanceStatus, setBinanceStatus] = useState<string | null>(null);
    const [hlStatus, setHlStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchArbData = useCallback(async () => {
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
                    confidence: 100
                })).filter((o: any) => Math.abs(o.spread) < 5000); // Filter out bad data (e.g. >5000% APR)
                setOpportunities(ops);
                setLastUpdated(new Date());
                setBinanceStatus(res.data.binance_status);
                setHlStatus(res.data.hl_status);
            }

        } catch (e) {
            console.error("Failed to fetch arb data", e);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchActiveTrades = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const res = await axios.get(`${apiUrl}/trading/active`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setActiveTrades(res.data.trades);
        } catch (e) {
            console.error("Failed to fetch active trades", e);
        }
    }, [isAuthenticated, token]);

    useEffect(() => {
        void fetchArbData();
        const interval = setInterval(fetchArbData, 30000); // 30s refresh
        return () => clearInterval(interval);
    }, [fetchArbData]);

    useEffect(() => {
        void fetchActiveTrades();
        const interval = setInterval(fetchActiveTrades, 10000); // 10s polling
        return () => clearInterval(interval);
    }, [fetchActiveTrades]);

    const executeArb = async (opp: ArbOpportunity) => {
        if (!isAuthenticated) {
            setError("Please login to execute trades.");
            return;
        }

        setError(null);

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

            // Refresh Active Trades immediately
            fetchActiveTrades();
        } catch (e: any) {
            if (e.response?.data?.error?.includes("Missing keys")) {
                setError("Setup API Keys first in Settings.");
            } else {
                setError(`Failed to execute: ${e.response?.data?.error || e.message}`);
            }
        } finally {
            setExecuting(null);
        }
    };

    return (
        <div className="flex flex-col h-full space-y-4">
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-center justify-between text-red-400 mb-2">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm font-bold">{error}</span>
                    </div>
                    <button onClick={() => setError(null)} className="text-xs hover:underline uppercase font-black">Dismiss</button>
                </div>
            )}
            {/* Header / Stats */}
            {binanceStatus && (
                <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-center gap-3 text-red-400 mb-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <div className="text-sm">
                        <span className="font-bold block">Data Feed Error</span>
                        {binanceStatus}. {binanceStatus.includes("403") && "This is likely due to Binance blocking the server region (e.g. US)."}
                    </div>
                </div>
            )}
            {hlStatus && hlStatus !== 'ok' && (
                <div className="bg-orange-500/10 border border-orange-500/30 p-4 rounded-xl flex items-center gap-3 text-orange-400 mb-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <div className="text-sm">
                        <span className="font-bold block">Hyperliquid Data Error</span>
                        Could not fetch market data from Hyperliquid.
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[var(--background)]/50 border border-[var(--glass-border)] p-4 rounded-xl backdrop-blur-sm">
                    <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Top APR</div>
                    <div className="text-2xl font-mono font-bold text-[var(--color-bullish)]">
                        {opportunities.length > 0 ? `+${opportunities[0].spread.toFixed(1)}%` : '--'}
                    </div>
                </div>
                <div className="bg-[var(--background)]/50 border border-[var(--glass-border)] p-4 rounded-xl backdrop-blur-sm">
                    <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Active Opps</div>
                    <div className="text-2xl font-mono font-bold text-[var(--color-primary)]">
                        {opportunities.length}
                    </div>
                </div>
                <div className="bg-[var(--background)]/50 border border-[var(--glass-border)] p-4 rounded-xl backdrop-blur-sm flex items-center justify-between">
                    <div>
                        <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Status</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '--'}
                        </div>
                    </div>
                    <button
                        onClick={fetchArbData}
                        disabled={loading}
                        className={`p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--glass-border)] transition ${loading ? 'animate-spin' : ''}`}>
                        <RefreshCw className="w-4 h-4 text-gray-300" />
                    </button>
                </div>
            </div>

            {/* Active Trades Section (New) */}
            {
                activeTrades.length > 0 && (
                    <div className="bg-[var(--background)]/40 border border-[var(--glass-border)] rounded-2xl overflow-hidden backdrop-blur-sm">
                        <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center bg-[var(--color-primary)]/10">
                            <h3 className="font-bold flex items-center gap-2 text-[var(--color-primary)]">
                                <Zap className="w-5 h-5" />
                                Active Arbitrage Positions
                            </h3>
                        </div>
                        <div className="overflow-auto max-h-48 scanner-scrollbar">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[var(--background)]/80 sticky top-0 text-xs uppercase text-gray-500 font-bold">
                                    <tr>
                                        <th className="p-3">Time</th>
                                        <th className="p-3">Symbol</th>
                                        <th className="p-3">Direction</th>
                                        <th className="p-3 text-right">Size (USD)</th>
                                        <th className="p-3 text-right">Entry (HL/Bin)</th>
                                        <th className="p-3 text-right">Current (HL/Bin)</th>
                                        <th className="p-3 text-right">PnL</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--glass-border)]/50 text-xs">
                                    {activeTrades.map(trade => (
                                        <tr key={trade.id} className="hover:bg-gray-800/30">
                                            <td className="p-3 text-gray-400">{new Date(trade.entry_time).toLocaleTimeString()}</td>
                                            <td className="p-3 font-bold text-white">{trade.symbol}</td>
                                            <td className="p-3">
                                                <span className={`px-2 py-0.5 rounded border ${trade.direction.includes('Short HL')
                                                    ? 'bg-[var(--color-bearish)]/10 border-[var(--color-bearish)]/30 text-[var(--color-bearish)]'
                                                    : 'bg-[var(--color-bullish)]/10 border-[var(--color-bullish)]/30 text-[var(--color-bullish)]'
                                                    }`}>
                                                    {trade.direction}
                                                </span>
                                            </td>
                                            <td className="p-3 text-right font-mono">${trade.size_usd}</td>
                                            <td className="p-3 text-right font-mono text-gray-400">
                                                <div>{trade.entry_price_hl ? trade.entry_price_hl.toFixed(4) : 'MOCK'}</div>
                                                <div className="text-[10px] text-gray-600">{trade.entry_price_bin ? trade.entry_price_bin.toFixed(4) : 'MOCK'}</div>
                                            </td>
                                            <td className="p-3 text-right font-mono text-gray-300">
                                                <div>{trade.current_price_hl ? trade.current_price_hl.toFixed(4) : '--'}</div>
                                                <div className="text-[10px] text-gray-500">{trade.current_price_bin ? trade.current_price_bin.toFixed(4) : '--'}</div>
                                            </td>
                                            <td className={`p-3 text-right font-mono font-bold ${(trade.pnl || 0) >= 0 ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
                                                {trade.pnl !== undefined ? (
                                                    <>
                                                        <div>{trade.pnl > 0 ? '+' : ''}{trade.pnl} USD</div>
                                                        <div className="text-[10px] opacity-70">{trade.pnl_percent > 0 ? '+' : ''}{trade.pnl_percent}%</div>
                                                    </>
                                                ) : '--'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {/* Main Table */}
            <div className="flex-1 bg-[var(--background)]/40 border border-[var(--glass-border)] rounded-2xl overflow-hidden backdrop-blur-sm flex flex-col">
                <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center bg-[var(--background)]/40">
                    <h3 className="font-bold flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-[var(--color-bullish)]" />
                        Cross-Venue Opportunities
                    </h3>
                    <div className="text-xs text-gray-500 bg-[var(--color-bullish)]/10 text-[var(--color-bullish)] px-2 py-1 rounded border border-[var(--color-bullish)]/20 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        Live Binance v/s Hyperliquid Data
                    </div>
                </div>

                <div className="overflow-auto flex-1 scanner-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-[var(--background)]/80 sticky top-0 z-10 text-xs uppercase text-gray-500 font-bold">
                            <tr>
                                <th className="p-4">Asset</th>
                                <th className="p-4 text-right">HL Funding (1h)</th>
                                <th className="p-4 text-right">Binance (1h)</th>
                                <th className="p-4 text-right">Est. APR Spread</th>
                                <th className="p-4">Strategy</th>
                                <th className="p-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]/50 text-sm">
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
                                        <td className="p-4 font-bold text-[var(--foreground)] flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-white/5 border border-[var(--glass-border)] flex items-center justify-center text-[10px] text-gray-400">
                                                {opp.symbol.substring(0, 2)}
                                            </div>
                                            {opp.symbol}
                                        </td>
                                        <td className={`p-4 text-right font-mono ${opp.hlFunding > 0 ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
                                            {(opp.hlFunding * 100).toFixed(4)}%
                                        </td>
                                        <td className={`p-4 text-right font-mono ${opp.binanceFunding > 0 ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
                                            {(opp.binanceFunding * 100).toFixed(4)}%
                                        </td>
                                        <td className="p-4 text-right font-mono font-bold text-[var(--color-bullish)]">
                                            {opp.spread.toFixed(2)}%
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className={`px-2 py-1 rounded border ${opp.direction.includes('Short HL')
                                                    ? 'bg-[var(--color-bearish)]/10 border-[var(--color-bearish)]/30 text-[var(--color-bearish)]'
                                                    : 'bg-[var(--color-bullish)]/10 border-[var(--color-bullish)]/30 text-[var(--color-bullish)]'
                                                    }`}>
                                                    {opp.direction}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => executeArb(opp)}
                                                disabled={!!executing}
                                                className={`px-3 py-1.5 rounded transition flex items-center gap-2 mx-auto ${executing === opp.symbol ? 'bg-[var(--color-accent-orange)]/20 text-[var(--color-accent-orange)] cursor-wait' : 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white'
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
        </div >
    );
}
