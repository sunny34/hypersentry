'use client';
import { useState, useEffect } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

interface TwapDataPoint {
    timestamp: number;
    buy_total: number;
    sell_total: number;
    net_delta: number;
    active_count: number;
}

interface TwapChartProps {
    token: string;
    apiUrl: string;
    authToken?: string | null;
}

type TimeRange = '1h' | '4h' | '24h' | 'all';

export default function TwapChart({ token, apiUrl, authToken }: TwapChartProps) {
    const [data, setData] = useState<TwapDataPoint[]>([]);
    const [timeRange, setTimeRange] = useState<TimeRange>('1h');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!authToken) return;

        const fetchHistory = async () => {
            setLoading(true);
            try {
                const response = await fetch(
                    `${apiUrl}/twap/history/${token}?time_range=${timeRange}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${authToken}`
                        }
                    }
                );

                if (!response.ok) throw new Error('Failed to fetch history');

                const result = await response.json();
                setData(result.data || []);
                setError(null);
            } catch (err) {
                console.error('Error fetching TWAP history:', err);
                setError('Failed to load chart data');
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();

        // Refresh every 30 seconds
        const interval = setInterval(fetchHistory, 30000);
        return () => clearInterval(interval);
    }, [token, timeRange, apiUrl, authToken]);

    // Format timestamp for display
    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    // Format dollar values
    const formatDollar = (value: number) => {
        if (Math.abs(value) >= 1_000_000) {
            return `$${(value / 1_000_000).toFixed(1)}M`;
        }
        if (Math.abs(value) >= 1_000) {
            return `$${(value / 1_000).toFixed(0)}K`;
        }
        return `$${value.toFixed(0)}`;
    };

    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const point = payload[0].payload;
            return (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-lg">
                    <p className="text-gray-400 text-xs mb-2">{formatTime(point.timestamp)}</p>
                    <div className="space-y-1">
                        <p className="text-emerald-400 text-sm">
                            🟢 Buy: {formatDollar(point.buy_total)}
                        </p>
                        <p className="text-red-400 text-sm">
                            🔴 Sell: {formatDollar(point.sell_total)}
                        </p>
                        <p className={`font-bold ${point.net_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            Δ {point.net_delta >= 0 ? '+' : ''}{formatDollar(point.net_delta)}
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    // Determine chart color based on latest net delta
    const latestDelta = data.length > 0 ? data[data.length - 1].net_delta : 0;
    const chartColor = latestDelta >= 0 ? '#10b981' : '#ef4444'; // emerald or red
    const chartColorFaded = latestDelta >= 0 ? '#10b98133' : '#ef444433';

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-white">{token} TWAP Delta</h3>
                    {data.length > 0 && (
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${latestDelta >= 0
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}>
                            {latestDelta >= 0 ? '↑ Bullish' : '↓ Bearish'}
                        </span>
                    )}
                </div>

                {/* Time Range Toggle */}
                <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                    {(['1h', '4h', '24h', 'all'] as TimeRange[]).map((range) => (
                        <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${timeRange === range
                                    ? 'bg-gray-700 text-white'
                                    : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            {range === 'all' ? 'All' : range.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart */}
            {loading && data.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-500">
                    Loading chart data...
                </div>
            ) : error ? (
                <div className="h-64 flex items-center justify-center text-red-400">
                    {error}
                </div>
            ) : data.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <p>No data yet</p>
                        <p className="text-sm text-gray-600">
                            Data will appear as TWAPs are detected
                        </p>
                    </div>
                </div>
            ) : (
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id={`gradient-${token}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="timestamp"
                                tickFormatter={formatTime}
                                stroke="#4b5563"
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                axisLine={{ stroke: '#374151' }}
                            />
                            <YAxis
                                tickFormatter={formatDollar}
                                stroke="#4b5563"
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                axisLine={{ stroke: '#374151' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 3" />
                            <Area
                                type="monotone"
                                dataKey="net_delta"
                                stroke={chartColor}
                                strokeWidth={2}
                                fill={`url(#gradient-${token})`}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Summary Stats */}
            {data.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Total Buy Volume</p>
                        <p className="text-emerald-400 font-bold">
                            {formatDollar(data[data.length - 1].buy_total)}
                        </p>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Total Sell Volume</p>
                        <p className="text-red-400 font-bold">
                            {formatDollar(data[data.length - 1].sell_total)}
                        </p>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Net Delta</p>
                        <p className={`font-bold ${latestDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {latestDelta >= 0 ? '+' : ''}{formatDollar(latestDelta)}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
