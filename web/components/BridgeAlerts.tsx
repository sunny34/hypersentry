'use client';
import { useState, useEffect } from 'react';
import { Warehouse, ExternalLink, DollarSign, Clock } from 'lucide-react';

interface BridgeDeposit {
    hash: string;
    user: string;
    amount: number;
    type: string;
    timestamp: number;
    time_str: string;
}

interface BridgeStats {
    threshold: number;
    total_seen: number;
    last_24h_count: number;
    last_24h_volume: number;
    is_running: boolean;
}

interface BridgeAlertsProps {
    apiUrl: string;
}

export default function BridgeAlerts({ apiUrl }: BridgeAlertsProps) {
    const [bridges, setBridges] = useState<BridgeDeposit[]>([]);
    const [stats, setStats] = useState<BridgeStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [isOffline, setIsOffline] = useState(false);

    useEffect(() => {
        const fetchBridges = async () => {
            try {
                // Use AbortController for timeout handling
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const [bridgesRes, statsRes] = await Promise.all([
                    fetch(`${apiUrl}/bridges/recent?limit=10`, { signal: controller.signal }),
                    fetch(`${apiUrl}/bridges/stats`, { signal: controller.signal })
                ]);

                clearTimeout(timeoutId);
                setIsOffline(false);

                if (bridgesRes.ok) {
                    const data = await bridgesRes.json();
                    setBridges(data.bridges || []);
                }

                if (statsRes.ok) {
                    const data = await statsRes.json();
                    setStats(data);
                }
            } catch {
                // Silently handle network errors - backend may be offline
                setIsOffline(true);
            } finally {
                setLoading(false);
            }
        };

        fetchBridges();
        const interval = setInterval(fetchBridges, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, [apiUrl]);

    const formatDollar = (value: number) => {
        if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
        if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
        return `$${value.toFixed(0)}`;
    };

    const formatAddress = (address: string) => {
        if (!address || address.length < 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const formatTimeAgo = (timestamp: number) => {
        if (!timestamp) return 'Unknown';
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);

        if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
        if (hours > 0) return `${hours}h ago`;
        return `${minutes}m ago`;
    };

    if (loading) {
        return (
            <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-800 rounded w-48 mb-4"></div>
                    <div className="h-20 bg-gray-800 rounded"></div>
                </div>
            </div>
        );
    }

    if (isOffline) {
        return (
            <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-700/50 rounded-lg">
                            <Warehouse className="w-5 h-5 text-gray-500" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-400">Large Bridge Deposits</h3>
                            <p className="text-gray-600 text-sm">Backend unavailable</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-500" />
                        <span className="text-gray-600 text-xs">Offline</span>
                    </div>
                </div>
                <div className="text-center py-8 text-gray-600">
                    <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Unable to connect to backend</p>
                    <p className="text-sm text-gray-700 mt-1">Bridge monitoring will resume when connection is restored</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg">
                        <Warehouse className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Large Bridge Deposits</h3>
                        <p className="text-gray-500 text-sm">
                            Deposits ≥ {stats ? formatDollar(stats.threshold) : '$100K'}
                        </p>
                    </div>
                </div>

                {stats && (
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-gray-500 text-xs">Last 24h</p>
                            <p className="text-white font-bold">
                                {stats.last_24h_count} deposits
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-gray-500 text-xs">Volume</p>
                            <p className="text-purple-400 font-bold">
                                {formatDollar(stats.last_24h_volume)}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Bridge List */}
            {bridges.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No large bridges detected yet</p>
                    <p className="text-sm text-gray-600 mt-1">
                        Monitoring for high-value deposits
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {bridges.slice(0, 5).map((bridge) => (
                        <div
                            key={bridge.hash}
                            className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-500/20 rounded-lg">
                                    <DollarSign className="w-4 h-4 text-purple-400" />
                                </div>
                                <div>
                                    <p className="text-white font-semibold">
                                        {formatDollar(bridge.amount)} USDC
                                    </p>
                                    <p className="text-gray-500 text-sm">
                                        from {formatAddress(bridge.user)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 text-gray-500 text-sm">
                                    <Clock className="w-3 h-3" />
                                    {formatTimeAgo(bridge.timestamp)}
                                </div>
                                <a
                                    href={`https://hypurrscan.io/tx/${bridge.hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 text-cyan-400 hover:text-cyan-300 hover:bg-gray-700 rounded-lg transition-colors"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Status Indicator */}
            {stats && (
                <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${stats.is_running ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                            }`} />
                        <span className="text-gray-500 text-sm">
                            {stats.is_running ? 'Monitoring active' : 'Monitoring paused'}
                        </span>
                    </div>
                    <span className="text-gray-600 text-xs">
                        {stats.total_seen} total bridges tracked
                    </span>
                </div>
            )}
        </div>
    );
}
