'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Activity, RefreshCw } from 'lucide-react';
import TwapChart from '@/components/TwapChart';
import TwapUsers from '@/components/TwapUsers';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface TokenSummary {
    token: string;
    active_count: number;
    buy_total: number;
    sell_total: number;
    net_delta: number;
    has_history: boolean;
}

export default function WhalePage() {
    const params = useParams();
    const router = useRouter();
    const { token: authToken, isAuthenticated } = useAuth();
    const token = (params.token as string)?.toUpperCase() || '';

    const [summary, setSummary] = useState<TokenSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

    useEffect(() => {
        if (!isAuthenticated || !authToken || !token) return;

        const fetchSummary = async () => {
            try {
                const response = await fetch(`${API_URL}/twap/summary`, {
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const tokenData = data.tokens?.find(
                        (t: TokenSummary) => t.token.toUpperCase() === token
                    );
                    setSummary(tokenData || null);
                }
            } catch (err) {
                console.error('Error fetching summary:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchSummary();
        const interval = setInterval(() => {
            fetchSummary();
            setLastRefresh(new Date());
        }, 30000);

        return () => clearInterval(interval);
    }, [token, authToken, isAuthenticated]);

    const formatDollar = (value: number) => {
        if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
        if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
        return `$${value.toFixed(0)}`;
    };

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-white mb-4">Sign in Required</h2>
                    <p className="text-gray-400 mb-6">Please sign in to view whale monitor data</p>
                    <button
                        onClick={() => router.push('/')}
                        className="px-6 py-3 bg-emerald-500 text-black rounded-lg font-bold"
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 text-white">
            {/* Header */}
            <header className="border-b border-gray-800 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.push('/')}
                                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5 text-gray-400" />
                            </button>
                            <div>
                                <h1 className="text-2xl font-black flex items-center gap-2">
                                    <Activity className="w-6 h-6 text-cyan-400" />
                                    <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                                        {token}
                                    </span>
                                    <span className="text-gray-400 font-normal">Whale Monitor</span>
                                </h1>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 text-gray-500 text-sm">
                                <RefreshCw className="w-4 h-4" />
                                <span>Updated {lastRefresh.toLocaleTimeString()}</span>
                            </div>

                            {summary && (
                                <div className={`px-4 py-2 rounded-full font-semibold text-sm ${summary.net_delta >= 0
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    }`}>
                                    {summary.net_delta >= 0 ? '↑' : '↓'} {formatDollar(summary.net_delta)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400"></div>
                    </div>
                ) : (
                    <>
                        {/* Summary Cards */}
                        {summary && (
                            <div className="grid grid-cols-4 gap-4">
                                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                                    <p className="text-gray-500 text-sm">Active Orders</p>
                                    <p className="text-2xl font-bold text-white">{summary.active_count}</p>
                                </div>
                                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                                    <p className="text-gray-500 text-sm">Buy Volume</p>
                                    <p className="text-2xl font-bold text-emerald-400">{formatDollar(summary.buy_total)}</p>
                                </div>
                                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                                    <p className="text-gray-500 text-sm">Sell Volume</p>
                                    <p className="text-2xl font-bold text-red-400">{formatDollar(summary.sell_total)}</p>
                                </div>
                                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                                    <p className="text-gray-500 text-sm">Net Delta</p>
                                    <p className={`text-2xl font-bold ${summary.net_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {summary.net_delta >= 0 ? '+' : ''}{formatDollar(summary.net_delta)}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* TWAP Delta Chart */}
                        <TwapChart
                            token={token}
                            apiUrl={API_URL}
                            authToken={authToken}
                        />

                        {/* Active TWAP Users */}
                        <TwapUsers
                            token={token}
                            apiUrl={API_URL}
                            authToken={authToken}
                        />
                    </>
                )}
            </main>
        </div>
    );
}
