'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import Sidebar from '@/components/Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import {
    Fish, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
    RefreshCw, DollarSign, Users, Target, Activity,
    ChevronDown, ChevronUp, BarChart3, Zap, Shield, Eye, Timer,
    ArrowRightLeft, Menu, Filter, Search, ExternalLink, Copy, Check,
    Trophy, Crown, Award, Flame, Globe
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// === Formatters ===
const fmt = (n: number, decimals = 2) => {
    if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(decimals)}B`;
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(decimals)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(decimals)}K`;
    return `$${n.toFixed(decimals)}`;
};

const fmtPnl = (n: number) => {
    const sign = n >= 0 ? '+' : '';
    if (Math.abs(n) >= 1_000_000_000) return `${sign}$${(n / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(n) >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${sign}$${(n / 1_000).toFixed(1)}K`;
    return `${sign}$${n.toFixed(0)}`;
};

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
};

// === Types ===
interface WhaleAlert {
    id: string; address: string; addressShort: string; label: string;
    event: string; coin: string; side: string; size: number;
    notionalUsd: number; entryPrice: number; leverage: number;
    oldSize: number; pnl: number; timestamp: number; timeStr: string;
    significance: string;
}

interface WhalePosition {
    address: string; addressShort: string; label: string; rank: number;
    coin: string; side: string; size: number; notionalUsd: number;
    entryPrice: number; unrealizedPnl: number; leverage: number;
    liquidationPrice: number; totalPnl: number; accountValue: number;
}

interface WhaleSummary {
    longNotional: number; shortNotional: number; longCount: number;
    shortCount: number; totalNotional: number; bias: number; biasLabel: string;
}

interface WhaleLeaderEntry {
    address: string; addressShort: string; label: string; rank: number;
    totalPnl: number; accountValue: number; monthPnl: number;
    weekPnl: number; dayPnl: number; roi: number; volume: number;
    positionCount: number; totalNotional: number; unrealizedPnl: number;
    coins: string[];
}

interface WhaleStats {
    total_alerts: number; last_scan_time: number; scan_count: number;
    tracked_wallets: number; is_running: boolean; initialized: boolean;
    whale_count: number; alert_count: number; poll_interval: number;
    min_notional: number;
}

// === Skeleton Loader ===
function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`skeleton rounded ${className}`} />;
}

function StatCardSkeleton() {
    return (
        <div className="rounded-2xl bg-gray-900/60 border border-gray-800/50 p-4">
            <Skeleton className="h-3 w-24 mb-3" />
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-2.5 w-32" />
        </div>
    );
}

// === Event Badge ===
function EventBadge({ event, significance }: { event: string; significance: string }) {
    const config: Record<string, { icon: any; label: string; color: string; bg: string }> = {
        open: { icon: ArrowUpRight, label: 'OPENED', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' },
        close: { icon: ArrowDownRight, label: 'CLOSED', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
        increase: { icon: TrendingUp, label: 'INCREASED', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30' },
        decrease: { icon: TrendingDown, label: 'DECREASED', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30' },
        flip: { icon: ArrowRightLeft, label: 'FLIPPED', color: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/30' },
    };
    const c = config[event] || config.open;
    const Icon = c.icon;
    const isLegendary = significance === 'legendary' || significance === 'massive';

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-wider ${c.bg} ${c.color} ${isLegendary ? 'neon-glow' : ''}`}>
            <Icon className="w-3 h-3" />
            {c.label}
        </span>
    );
}

// === Significance Dot ===
function SignificanceDot({ level }: { level: string }) {
    const colors: Record<string, string> = {
        legendary: 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]',
        massive: 'bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.5)]',
        large: 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.4)]',
        notable: 'bg-blue-400',
        standard: 'bg-gray-500',
    };
    return (
        <span className={`inline-block w-2 h-2 rounded-full ${colors[level] || colors.standard} animate-pulse`}
            title={level.charAt(0).toUpperCase() + level.slice(1)} />
    );
}

// === Bias Gauge ===
function BiasGauge({ bias, longNotional, shortNotional, biasLabel }: {
    bias: number; longNotional: number; shortNotional: number; biasLabel: string;
}) {
    const longPct = longNotional + shortNotional > 0 ? (longNotional / (longNotional + shortNotional)) * 100 : 50;
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
                <span className="text-emerald-400 font-bold">LONGS {fmt(longNotional, 1)}</span>
                <span className={`font-black text-sm ${bias > 10 ? 'text-emerald-400' : bias < -10 ? 'text-red-400' : 'text-gray-300'}`}>
                    {biasLabel}
                </span>
                <span className="text-red-400 font-bold">SHORTS {fmt(shortNotional, 1)}</span>
            </div>
            <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-l-full transition-all duration-700"
                    style={{ width: `${longPct}%` }} />
                <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-red-600 to-red-400 rounded-r-full transition-all duration-700"
                    style={{ width: `${100 - longPct}%` }} />
                <div className="absolute inset-y-0 left-1/2 w-0.5 bg-white/30 -translate-x-1/2" />
            </div>
        </div>
    );
}

// === PnL Sparkline ===
function PnlIndicator({ value, label }: { value: number; label: string }) {
    return (
        <div className="text-center">
            <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{label}</p>
            <p className={`text-xs font-black ${value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                {fmtPnl(value)}
            </p>
        </div>
    );
}

// === Main Page ===
export default function WhaleTrackerPage() {
    const { isCollapsed } = useSidebar();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
    const [positions, setPositions] = useState<WhalePosition[]>([]);
    const [summary, setSummary] = useState<WhaleSummary | null>(null);
    const [leaderboard, setLeaderboard] = useState<WhaleLeaderEntry[]>([]);
    const [stats, setStats] = useState<WhaleStats | null>(null);
    const [loading, setLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<'feed' | 'positions' | 'leaderboard'>('feed');
    const [coinFilter, setCoinFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [sortBy, setSortBy] = useState<'notional' | 'pnl' | 'leverage'>('notional');
    const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
    const [leaderSort, setLeaderSort] = useState<'allTime' | 'month' | 'week' | 'day'>('allTime');

    const previousAlertCount = useRef(0);

    const fetchData = useCallback(async () => {
        try {
            const [alertsRes, positionsRes, summaryRes, statsRes, leaderRes] = await Promise.all([
                axios.get(`${API_URL}/trading/whales/alerts`, { params: { limit: 100, ...(coinFilter ? { coin: coinFilter } : {}) } }),
                axios.get(`${API_URL}/trading/whales/positions`, { params: coinFilter ? { coin: coinFilter } : {} }),
                axios.get(`${API_URL}/trading/whales/summary`, { params: coinFilter ? { coin: coinFilter } : {} }),
                axios.get(`${API_URL}/trading/whales/stats`),
                axios.get(`${API_URL}/trading/whales/leaderboard`),
            ]);
            setAlerts(alertsRes.data.alerts || []);
            setPositions(positionsRes.data.positions || []);
            setSummary(summaryRes.data);
            setStats(statsRes.data);
            setLeaderboard(leaderRes.data.leaderboard || []);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch whale data:', err);
            setLoading(false);
        }
    }, [coinFilter]);

    useEffect(() => {
        const runFetch = () => {
            void fetchData();
        };
        const initial = setTimeout(runFetch, 0);
        const interval = setInterval(runFetch, 10_000);
        return () => {
            clearTimeout(initial);
            clearInterval(interval);
        };
    }, [fetchData]);

    useEffect(() => {
        if (alerts.length > previousAlertCount.current && previousAlertCount.current > 0) {
            document.getElementById('alert-flash')?.classList.add('animate-pulse');
            setTimeout(() => document.getElementById('alert-flash')?.classList.remove('animate-pulse'), 2000);
        }
        previousAlertCount.current = alerts.length;
    }, [alerts.length]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        await fetchData();
        setTimeout(() => setIsRefreshing(false), 500);
    };

    const copyAddress = (address: string) => {
        navigator.clipboard.writeText(address);
        setCopiedAddress(address);
        setTimeout(() => setCopiedAddress(null), 2000);
    };

    const availableCoins = useMemo(() => {
        const coins = new Set<string>();
        positions.forEach(p => coins.add(p.coin));
        return Array.from(coins).sort();
    }, [positions]);

    const filteredPositions = useMemo(() => {
        let filtered = [...positions];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                p.coin.toLowerCase().includes(q) ||
                p.label.toLowerCase().includes(q) ||
                p.address.toLowerCase().includes(q)
            );
        }
        filtered.sort((a, b) => {
            const m = sortDir === 'desc' ? -1 : 1;
            switch (sortBy) {
                case 'notional': return m * (a.notionalUsd - b.notionalUsd);
                case 'pnl': return m * (a.unrealizedPnl - b.unrealizedPnl);
                case 'leverage': return m * (a.leverage - b.leverage);
                default: return 0;
            }
        });
        return filtered;
    }, [positions, searchQuery, sortBy, sortDir]);

    const sortedLeaderboard = useMemo(() => {
        const sorted = [...leaderboard];
        sorted.sort((a, b) => {
            switch (leaderSort) {
                case 'month': return b.monthPnl - a.monthPnl;
                case 'week': return b.weekPnl - a.weekPnl;
                case 'day': return b.dayPnl - a.dayPnl;
                default: return b.totalPnl - a.totalPnl;
            }
        });
        return sorted;
    }, [leaderboard, leaderSort]);

    const rankIcon = (i: number) => {
        if (i === 0) return <Crown className="w-4 h-4 text-yellow-400" />;
        if (i === 1) return <Trophy className="w-4 h-4 text-gray-300" />;
        if (i === 2) return <Award className="w-4 h-4 text-amber-600" />;
        return null;
    };

    const rankBg = (i: number) => {
        if (i === 0) return 'bg-gradient-to-r from-yellow-500/10 via-yellow-500/5 to-transparent border-yellow-500/20';
        if (i === 1) return 'bg-gradient-to-r from-gray-400/10 via-gray-400/5 to-transparent border-gray-400/20';
        if (i === 2) return 'bg-gradient-to-r from-amber-700/10 via-amber-700/5 to-transparent border-amber-700/20';
        return 'bg-gray-900/60 border-gray-800/50';
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 text-white font-sans flex">
            <Sidebar isMobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />

            <main className={`flex-1 overflow-y-auto transition-all duration-300 ${isCollapsed ? 'lg:ml-20' : 'lg:ml-64'} ml-0`}>
                {/* HEADER */}
                <header className="sticky top-0 z-30 backdrop-blur-xl bg-black/80 border-b border-[var(--glass-border)]">
                    <div className="px-4 lg:px-8 py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden p-2 hover:bg-gray-800 rounded-lg text-gray-400">
                                    <Menu className="w-6 h-6" />
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                                            <Fish className="w-5 h-5 text-white" />
                                        </div>
                                        {stats?.is_running && (
                                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-black animate-pulse" />
                                        )}
                                    </div>
                                    <div>
                                        <h1 className="text-xl lg:text-2xl font-black tracking-tight">
                                            Whale <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Tracker</span>
                                        </h1>
                                        <p className="text-[11px] text-gray-500 font-medium">
                                            Monitoring {stats?.whale_count || 0} top Hyperliquid wallets
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="relative hidden sm:block">
                                    <select value={coinFilter} onChange={(e) => setCoinFilter(e.target.value)}
                                        className="appearance-none bg-gray-900/80 border border-gray-700/50 text-xs text-gray-300 rounded-lg pl-3 pr-8 py-2 focus:border-cyan-500/50 outline-none cursor-pointer hover:border-gray-600 transition">
                                        <option value="">All Coins</option>
                                        {availableCoins.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <Filter className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                                </div>
                                <button onClick={handleRefresh} className="p-2 rounded-lg bg-gray-900/80 border border-gray-700/50 hover:border-cyan-500/30 transition">
                                    <RefreshCw className={`w-4 h-4 text-gray-400 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
                                </button>
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${stats?.is_running
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
                                    <span className={`w-2 h-2 rounded-full animate-pulse ${stats?.is_running ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                    {stats?.is_running ? 'LIVE' : 'Initializing'}
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {/* STATS STRIP */}
                <div className="px-4 lg:px-8 py-4">
                    {loading ? (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {[...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {[
                                { icon: Users, label: 'Tracked Whales', value: stats?.whale_count || 0, sub: `${stats?.scan_count || 0} scans completed`, accent: 'cyan' },
                                { icon: Zap, label: 'Total Alerts', value: stats?.total_alerts || 0, sub: `${alerts.length} displayed`, accent: 'amber' },
                                { icon: Target, label: 'Open Positions', value: positions.length, sub: `${fmt(summary?.totalNotional || 0, 1)} total notional`, accent: 'emerald' },
                                { icon: Timer, label: 'Scan Speed', value: `${(stats?.last_scan_time || 0).toFixed(1)}s`, sub: `Every ${stats?.poll_interval || 15}s interval`, accent: 'purple' },
                            ].map((card, i) => (
                                <div key={i} className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-800/50 p-4 hover:border-${card.accent}-500/30 transition-all duration-300`}>
                                    <div className={`absolute inset-0 bg-gradient-to-br from-${card.accent}-500/5 to-transparent opacity-0 group-hover:opacity-100 transition`} />
                                    <div className="relative">
                                        <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                                            <card.icon className="w-3 h-3" /> {card.label}
                                        </p>
                                        <p className="text-2xl font-black mt-1 text-white">{card.value}</p>
                                        <p className="text-gray-600 text-[10px] mt-0.5">{card.sub}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* BIAS GAUGE */}
                {summary && (
                    <div className="px-4 lg:px-8 pb-4">
                        <div className="rounded-2xl bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-800/50 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold flex items-center gap-2">
                                    <BarChart3 className="w-4 h-4 text-cyan-400" />
                                    Whale Positioning {coinFilter ? `— ${coinFilter}` : '— All Assets'}
                                </h3>
                                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> {summary.longCount} longs</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> {summary.shortCount} shorts</span>
                                </div>
                            </div>
                            <BiasGauge bias={summary.bias} longNotional={summary.longNotional} shortNotional={summary.shortNotional} biasLabel={summary.biasLabel} />
                        </div>
                    </div>
                )}

                {/* TAB BAR */}
                <div className="px-4 lg:px-8">
                    <div className="flex items-center gap-1 bg-gray-900/60 rounded-xl p-1 border border-gray-800/50 w-fit">
                        {(['feed', 'positions', 'leaderboard'] as const).map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)}
                                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${activeTab === tab
                                    ? 'bg-cyan-500/20 text-cyan-400 shadow-[inset_0_0_15px_rgba(6,182,212,0.1)]'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}>
                                {tab === 'feed' && <Zap className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
                                {tab === 'positions' && <Eye className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
                                {tab === 'leaderboard' && <Trophy className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
                                {tab === 'feed' ? 'Live Feed' : tab === 'positions' ? 'Positions' : 'Leaderboard'}
                                {tab === 'feed' && alerts.length > 0 && (
                                    <span className="ml-1.5 px-1.5 py-0.5 text-[9px] bg-cyan-500/20 text-cyan-400 rounded-full">{alerts.length}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* CONTENT */}
                <div className="px-4 lg:px-8 py-4 pb-20">

                    {/* LIVE FEED */}
                    {activeTab === 'feed' && (
                        <div id="alert-flash" className="space-y-2 transition-all">
                            {alerts.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                                    <div className="relative mb-4">
                                        <Fish className="w-16 h-16 opacity-20" />
                                        {stats?.initialized && <div className="absolute inset-0 animate-scanline rounded-full" />}
                                    </div>
                                    <p className="text-lg font-bold">
                                        {stats?.initialized ? 'Monitoring whale wallets...' : 'Initializing whale positions...'}
                                    </p>
                                    <p className="text-sm text-gray-600 mt-1">
                                        {stats?.initialized ? `No significant moves detected yet. Min threshold: ${fmt(stats.min_notional)}` : `Loading ${stats?.whale_count || 0} whale profiles...`}
                                    </p>
                                </div>
                            ) : (
                                alerts.map((alert, i) => (
                                    <div key={alert.id}
                                        className={`group relative overflow-hidden rounded-xl border transition-all duration-300 hover:border-gray-600
                                            ${i === 0 ? 'animate-slide-up' : ''}
                                            ${alert.significance === 'legendary'
                                                ? 'bg-gradient-to-r from-yellow-950/30 via-gray-900/80 to-gray-900/80 border-yellow-500/30'
                                                : alert.significance === 'massive'
                                                    ? 'bg-gradient-to-r from-purple-950/20 via-gray-900/80 to-gray-900/80 border-purple-500/20'
                                                    : 'bg-gray-900/60 border-gray-800/50'}`}>
                                        <div className={`absolute left-0 inset-y-0 w-1 ${alert.event === 'open' ? 'bg-emerald-500' :
                                            alert.event === 'close' ? 'bg-red-500' :
                                                alert.event === 'increase' ? 'bg-blue-500' :
                                                    alert.event === 'decrease' ? 'bg-amber-500' : 'bg-purple-500'}`} />
                                        <div className="pl-5 pr-4 py-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-start gap-3 min-w-0">
                                                    <SignificanceDot level={alert.significance} />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-white font-bold text-sm truncate max-w-[200px]">{alert.label}</span>
                                                            <button onClick={() => copyAddress(alert.address)}
                                                                className="text-gray-600 hover:text-cyan-400 text-[10px] font-mono flex items-center gap-1 transition">
                                                                {alert.addressShort}
                                                                {copiedAddress === alert.address ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                            </button>
                                                            <EventBadge event={alert.event} significance={alert.significance} />
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-1.5 text-xs">
                                                            <span className="font-black text-white text-sm">{alert.coin}</span>
                                                            <span className={`font-bold ${alert.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {alert.side.toUpperCase()}
                                                            </span>
                                                            <span className="text-gray-400">{fmt(alert.notionalUsd)}</span>
                                                            {alert.leverage > 0 && <span className="text-yellow-400/70 font-mono text-[10px]">{alert.leverage.toFixed(0)}x</span>}
                                                            {alert.entryPrice > 0 && <span className="text-gray-500 font-mono text-[10px]">@ ${alert.entryPrice.toLocaleString()}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-[10px] text-gray-500 font-medium">{timeAgo(alert.timestamp)}</p>
                                                    {alert.pnl !== 0 && (
                                                        <p className={`text-xs font-bold mt-0.5 ${alert.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {fmtPnl(alert.pnl)}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* POSITIONS */}
                    {activeTab === 'positions' && (
                        <div>
                            <div className="mb-4 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by coin, label, or address..."
                                    className="w-full bg-gray-900/80 border border-gray-700/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-cyan-500/50 outline-none transition" />
                            </div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-[10px] text-gray-500 font-bold uppercase">Sort by:</span>
                                {(['notional', 'pnl', 'leverage'] as const).map(s => (
                                    <button key={s} onClick={() => { if (sortBy === s) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy(s); setSortDir('desc'); } }}
                                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border transition ${sortBy === s
                                            ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
                                            : 'border-gray-800 text-gray-500 hover:text-gray-300'}`}>
                                        {s} {sortBy === s && (sortDir === 'desc' ? '↓' : '↑')}
                                    </button>
                                ))}
                                <span className="ml-auto text-[10px] text-gray-600">{filteredPositions.length} positions</span>
                            </div>
                            <div className="rounded-2xl bg-gray-900/40 border border-gray-800/50 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full data-table">
                                        <thead>
                                            <tr className="bg-gray-900/80">
                                                <th className="p-3 text-left">Whale</th>
                                                <th className="p-3 text-left">Coin</th>
                                                <th className="p-3 text-left">Side</th>
                                                <th className="p-3 text-right">Notional</th>
                                                <th className="p-3 text-right">Entry</th>
                                                <th className="p-3 text-right">Lev</th>
                                                <th className="p-3 text-right">uPnL</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800/30">
                                            {filteredPositions.map((pos) => (
                                                <tr key={`${pos.address}-${pos.coin}`} className="group hover:bg-white/[0.02] transition">
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-gray-600 font-mono w-5">{pos.rank}</span>
                                                            <div>
                                                                <p className="text-xs font-bold text-white truncate max-w-[150px]">{pos.label}</p>
                                                                <button onClick={() => copyAddress(pos.address)}
                                                                    className="text-[10px] font-mono text-gray-600 hover:text-cyan-400 flex items-center gap-1 transition">
                                                                    {pos.addressShort}
                                                                    {copiedAddress === pos.address ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100" />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-3"><span className="text-xs font-black text-white">{pos.coin}</span></td>
                                                    <td className="p-3">
                                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${pos.side === 'long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                                            {pos.side}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-right"><span className="text-xs font-bold text-white">{fmt(pos.notionalUsd)}</span></td>
                                                    <td className="p-3 text-right"><span className="text-xs text-gray-400 font-mono">${pos.entryPrice.toLocaleString()}</span></td>
                                                    <td className="p-3 text-right"><span className="text-xs text-yellow-400/70 font-mono">{pos.leverage.toFixed(1)}x</span></td>
                                                    <td className="p-3 text-right">
                                                        <span className={`text-xs font-bold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {fmtPnl(pos.unrealizedPnl)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {filteredPositions.length === 0 && (
                                                <tr>
                                                    <td colSpan={7} className="p-12 text-center text-gray-500">
                                                        <Fish className="w-10 h-10 mx-auto opacity-20 mb-2" />
                                                        <p className="font-bold">No positions found</p>
                                                        <p className="text-sm text-gray-600">{searchQuery ? 'Try adjusting your search' : 'Waiting for whale position data...'}</p>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* LEADERBOARD */}
                    {activeTab === 'leaderboard' && (
                        <div className="space-y-3">
                            {/* Sort controls */}
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] text-gray-500 font-bold uppercase">Rank by PnL:</span>
                                {([
                                    { key: 'allTime', label: 'All Time' },
                                    { key: 'month', label: '30D' },
                                    { key: 'week', label: '7D' },
                                    { key: 'day', label: '24H' },
                                ] as const).map(s => (
                                    <button key={s.key} onClick={() => setLeaderSort(s.key)}
                                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border transition ${leaderSort === s.key
                                            ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
                                            : 'border-gray-800 text-gray-500 hover:text-gray-300'}`}>
                                        {s.label}
                                    </button>
                                ))}
                                <span className="ml-auto text-[10px] text-gray-600">{sortedLeaderboard.length} whales</span>
                            </div>

                            {sortedLeaderboard.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                                    <Users className="w-16 h-16 opacity-20 mb-4" />
                                    <p className="text-lg font-bold">Loading whale profiles...</p>
                                    <p className="text-sm text-gray-600 mt-1">Position data will appear once the tracker initializes</p>
                                </div>
                            ) : (
                                sortedLeaderboard.map((whale, i) => (
                                    <div key={whale.address}
                                        className={`group rounded-xl border p-4 transition-all duration-300 hover:scale-[1.005] hover:shadow-lg ${rankBg(i)}`}>
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {/* Rank */}
                                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${i < 3 ? '' : 'bg-gray-800/50 text-gray-500 border border-gray-700/30'}`}>
                                                    {rankIcon(i) || <span>{i + 1}</span>}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-bold text-white truncate max-w-[180px]">{whale.label}</p>
                                                        {whale.positionCount > 0 && (
                                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                                                                {whale.positionCount} active
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <button onClick={() => copyAddress(whale.address)}
                                                            className="text-[10px] font-mono text-gray-600 hover:text-cyan-400 flex items-center gap-1 transition">
                                                            {whale.addressShort}
                                                            {copiedAddress === whale.address ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100" />}
                                                        </button>
                                                        {whale.roi > 0 && <span className="text-[9px] text-cyan-400/60">ROI: {fmtPct(whale.roi)}</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4 shrink-0">
                                                {/* Coins */}
                                                <div className="hidden xl:flex items-center gap-1">
                                                    {whale.coins.slice(0, 4).map(c => (
                                                        <span key={c} className="text-[9px] font-bold bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">{c}</span>
                                                    ))}
                                                    {whale.coins.length > 4 && <span className="text-[9px] text-gray-600">+{whale.coins.length - 4}</span>}
                                                </div>

                                                {/* PnL columns */}
                                                <div className="hidden lg:flex items-center gap-3">
                                                    <PnlIndicator value={whale.dayPnl} label="24h" />
                                                    <PnlIndicator value={whale.weekPnl} label="7d" />
                                                    <PnlIndicator value={whale.monthPnl} label="30d" />
                                                </div>

                                                {/* Account value */}
                                                <div className="text-right hidden sm:block">
                                                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Account</p>
                                                    <p className="text-sm font-bold text-white">{fmt(whale.accountValue, 1)}</p>
                                                </div>

                                                {/* Total PnL */}
                                                <div className="text-right min-w-[80px]">
                                                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">
                                                        {leaderSort === 'allTime' ? 'Total PnL' : leaderSort === 'month' ? '30D PnL' : leaderSort === 'week' ? '7D PnL' : '24H PnL'}
                                                    </p>
                                                    <p className={`text-sm font-black ${(leaderSort === 'allTime' ? whale.totalPnl :
                                                            leaderSort === 'month' ? whale.monthPnl :
                                                                leaderSort === 'week' ? whale.weekPnl : whale.dayPnl) >= 0
                                                            ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {fmtPnl(leaderSort === 'allTime' ? whale.totalPnl :
                                                            leaderSort === 'month' ? whale.monthPnl :
                                                                leaderSort === 'week' ? whale.weekPnl : whale.dayPnl)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
