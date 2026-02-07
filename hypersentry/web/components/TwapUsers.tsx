'use client';
import { useState, useEffect } from 'react';
import { ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';

interface TwapUser {
    address: string;
    size: number;
    duration: number;
    hash: string;
    started: number;
}

interface TwapUsersProps {
    token: string;
    apiUrl: string;
    authToken?: string | null;
}

export default function TwapUsers({ token, apiUrl, authToken }: TwapUsersProps) {
    const [buyers, setBuyers] = useState<TwapUser[]>([]);
    const [sellers, setSellers] = useState<TwapUser[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!authToken) return;

        const fetchUsers = async () => {
            try {
                const response = await fetch(
                    `${apiUrl}/twap/users/${token}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${authToken}`
                        }
                    }
                );

                if (!response.ok) throw new Error('Failed to fetch users');

                const result = await response.json();
                setBuyers(result.buyers || []);
                setSellers(result.sellers || []);
            } catch {
                // Silently handle errors - backend may be offline
            } finally {
                setLoading(false);
            }
        };

        fetchUsers();

        // Refresh every 30 seconds
        const interval = setInterval(fetchUsers, 30000);
        return () => clearInterval(interval);
    }, [token, apiUrl, authToken]);

    const formatDollar = (value: number) => {
        if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
        if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
        return `$${value.toFixed(0)}`;
    };

    const formatAddress = (address: string) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const formatTimeAgo = (timestamp: number) => {
        if (!timestamp) return 'Unknown';
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
        return `${minutes}m ago`;
    };

    const totalBuyers = buyers.length;
    const totalSellers = sellers.length;
    const buyVolume = buyers.reduce((sum, b) => sum + b.size, 0);
    const sellVolume = sellers.reduce((sum, s) => sum + s.size, 0);

    if (loading) {
        return (
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-800 rounded w-48 mb-4"></div>
                    <div className="space-y-3">
                        <div className="h-12 bg-gray-800 rounded"></div>
                        <div className="h-12 bg-gray-800 rounded"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (buyers.length === 0 && sellers.length === 0) {
        return (
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-4">👤 Active TWAP Orders</h3>
                <div className="text-center py-8 text-gray-500">
                    <p>No active large TWAPs for {token}</p>
                    <p className="text-sm text-gray-600 mt-1">
                        Orders will appear when detected
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">👤 Active TWAP Orders</h3>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">{totalBuyers} Buyers</span>
                    </div>
                    <p className="text-emerald-300 text-lg font-bold mt-1">
                        {formatDollar(buyVolume)}
                    </p>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                        <TrendingDown className="w-4 h-4 text-red-400" />
                        <span className="text-red-400 font-semibold">{totalSellers} Sellers</span>
                    </div>
                    <p className="text-red-300 text-lg font-bold mt-1">
                        {formatDollar(sellVolume)}
                    </p>
                </div>
            </div>

            {/* Users Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                            <th className="text-left py-2 font-medium">Wallet</th>
                            <th className="text-left py-2 font-medium">Side</th>
                            <th className="text-right py-2 font-medium">Size</th>
                            <th className="text-right py-2 font-medium">Duration</th>
                            <th className="text-right py-2 font-medium">Started</th>
                            <th className="text-right py-2 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Buyers */}
                        {buyers.map((user) => (
                            <tr key={user.hash} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-3">
                                    <code className="text-gray-300 text-sm bg-gray-800 px-2 py-1 rounded">
                                        {formatAddress(user.address)}
                                    </code>
                                </td>
                                <td className="py-3">
                                    <span className="flex items-center gap-1 text-emerald-400 text-sm font-semibold">
                                        <TrendingUp className="w-3 h-3" />
                                        BUY
                                    </span>
                                </td>
                                <td className="py-3 text-right text-white font-medium">
                                    {formatDollar(user.size)}
                                </td>
                                <td className="py-3 text-right text-gray-400">
                                    {user.duration} mins
                                </td>
                                <td className="py-3 text-right text-gray-500 text-sm">
                                    {formatTimeAgo(user.started)}
                                </td>
                                <td className="py-3 text-right">
                                    <a
                                        href={`https://hypurrscan.io/tx/${user.hash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 p-1"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </td>
                            </tr>
                        ))}

                        {/* Sellers */}
                        {sellers.map((user) => (
                            <tr key={user.hash} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-3">
                                    <code className="text-gray-300 text-sm bg-gray-800 px-2 py-1 rounded">
                                        {formatAddress(user.address)}
                                    </code>
                                </td>
                                <td className="py-3">
                                    <span className="flex items-center gap-1 text-red-400 text-sm font-semibold">
                                        <TrendingDown className="w-3 h-3" />
                                        SELL
                                    </span>
                                </td>
                                <td className="py-3 text-right text-white font-medium">
                                    {formatDollar(user.size)}
                                </td>
                                <td className="py-3 text-right text-gray-400">
                                    {user.duration} mins
                                </td>
                                <td className="py-3 text-right text-gray-500 text-sm">
                                    {formatTimeAgo(user.started)}
                                </td>
                                <td className="py-3 text-right">
                                    <a
                                        href={`https://hypurrscan.io/tx/${user.hash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 p-1"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
