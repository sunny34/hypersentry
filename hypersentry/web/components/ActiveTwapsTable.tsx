'use client';
import { useState, useMemo } from 'react';
import { ExternalLink, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Layers, Zap, Hexagon } from 'lucide-react';

interface ActiveTwap {
    token: string;
    side: 'BUY' | 'SELL';
    size: number;
    minutes: number;
    user: string;
    hash: string;
    time?: number;
    is_perp?: boolean;
    reduce_only?: boolean;
}

interface ActiveTwapsTableProps {
    twaps: ActiveTwap[];
}

export default function ActiveTwapsTable({ twaps }: ActiveTwapsTableProps) {
    const [tab, setTab] = useState<'all' | 'spot' | 'perp'>('all');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Filter Data
    const filteredData = useMemo(() => {
        return twaps.filter(t => {
            if (tab === 'all') return true;
            // Use is_perp from API, fallback to token name heuristic
            const isPerp = t.is_perp ?? (t.token.includes('-PERP') || t.token.includes('PERP'));
            return tab === 'perp' ? isPerp : !isPerp;
        });
    }, [twaps, tab]);

    // Pagination
    const totalPages = Math.ceil(filteredData.length / pageSize);
    const paginatedData = filteredData.slice((page - 1) * pageSize, page * pageSize);

    // Reset page on tab change
    useMemo(() => setPage(1), [tab]);

    const formatDollar = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="space-y-6">
            {/* Controls Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-900/40 p-1 rounded-2xl border border-gray-800/50 backdrop-blur-sm">

                {/* Tabs */}
                <div className="flex gap-1 bg-black/20 p-1 rounded-xl">
                    <button
                        onClick={() => setTab('all')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${tab === 'all' ? 'bg-gray-800 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <Layers className="w-4 h-4" /> All
                    </button>
                    <button
                        onClick={() => setTab('spot')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${tab === 'spot' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg' : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <Hexagon className="w-4 h-4" /> Spot
                    </button>
                    <button
                        onClick={() => setTab('perp')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${tab === 'perp' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-lg' : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <Zap className="w-4 h-4" /> Perp
                    </button>
                </div>

                {/* Page Size & Count */}
                <div className="flex items-center gap-4 px-4">
                    <select
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        className="bg-black/20 border border-gray-700/50 rounded-lg px-2 py-1 text-xs text-gray-400 focus:outline-none focus:border-gray-600 hover:bg-black/40 transition"
                    >
                        <option value={10}>10 / page</option>
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                    </select>
                    <span className="text-gray-500 text-sm font-medium">
                        {filteredData.length} active orders
                    </span>
                </div>
            </div>

            {/* Table */}
            <div className="rounded-3xl bg-gradient-to-br from-gray-900/60 to-gray-900/30 border border-gray-800/50 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="p-4 font-semibold">Token</th>
                                <th className="p-4 font-semibold">Type</th>
                                <th className="p-4 font-semibold">Side</th>
                                <th className="p-4 font-semibold">Size (USD)</th>
                                <th className="p-4 font-semibold">Duration</th>
                                <th className="p-4 font-semibold">User</th>
                                <th className="p-4 text-right font-semibold">Link</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/30">
                            {paginatedData.map((t) => {
                                const isPerp = t.token.includes('-PERP');
                                return (
                                    <tr key={t.hash} className="hover:bg-gray-800/20 transition group">
                                        <td className="p-4 font-bold text-white flex items-center gap-2">
                                            {t.token}
                                            {isPerp && <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">PERP</span>}
                                        </td>
                                        <td className="p-4">
                                            <span className={`text-xs font-medium px-2 py-1 rounded ${isPerp ? 'text-purple-400 bg-purple-500/10' : 'text-emerald-400 bg-emerald-500/10'}`}>
                                                {isPerp ? 'PERP' : 'SPOT'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold flex w-fit items-center gap-1 ${t.side === 'BUY'
                                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                                }`}>
                                                {t.side === 'BUY' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                                {t.side}
                                            </span>
                                        </td>
                                        <td className="p-4 text-white font-mono font-bold">{formatDollar(t.size)}</td>
                                        <td className="p-4 text-gray-400">{t.minutes}m</td>
                                        <td className="p-4 font-mono text-xs text-gray-500 group-hover:text-gray-300 transition">
                                            {t.user.substring(0, 6)}...{t.user.slice(-4)}
                                        </td>
                                        <td className="p-4 text-right">
                                            <a
                                                href={`https://hypurrscan.io/address/${t.user}`}
                                                target="_blank"
                                                className="text-blue-400 hover:text-blue-300 hover:underline text-sm font-medium inline-flex items-center gap-1"
                                            >
                                                Inspect <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </td>
                                    </tr>
                                );
                            })}

                            {paginatedData.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-500 italic">
                                        No active {tab !== 'all' ? tab : ''} TWAPs found strategies in this view.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer */}
                {totalPages > 1 && (
                    <div className="p-4 border-t border-gray-800/50 flex justify-between items-center bg-gray-900/30">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-2 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-transparent transition"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-400" />
                        </button>
                        <div className="text-sm text-gray-400 font-medium">
                            Page <span className="text-white">{page}</span> of {totalPages}
                        </div>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-2 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-transparent transition"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
