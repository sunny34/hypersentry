'use client';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity,
    Shield,
    Zap,
    TrendingUp,
    TrendingDown,
    Info,
    ChevronLeft,
    Binary,
    BarChart3,
    ArrowUpRight,
    ArrowDownRight,
    Globe
} from 'lucide-react';
import Link from 'next/link';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function MicrostructureDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const res = await axios.get(`${API_URL}/intel/microstructure`);
            setData(res.data);
            setLoading(false);
        } catch (e) {
            console.error("Failed to fetch micro-data", e);
        }
    };

    useEffect(() => {
        const runFetch = () => {
            void fetchData();
        };
        const initial = setTimeout(runFetch, 0);
        const interval = setInterval(runFetch, 5000);
        return () => {
            clearTimeout(initial);
            clearInterval(interval);
        };
    }, []);

    if (loading || !data) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="w-12 h-12 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full"
                    />
                    <span className="text-gray-500 font-mono text-sm tracking-widest uppercase animate-pulse">
                        Synchronizing Micro-Alpha...
                    </span>
                </div>
            </div>
        );
    }

    const { current, history, ticker } = data;
    const divergence = current.divergence || "NONE";

    const walls = current.depth_walls || { bid: [], ask: [] };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans selection:bg-emerald-500/30">
            {/* Header */}
            <header className="max-w-7xl mx-auto flex items-center justify-between mb-12">
                <div className="flex items-center gap-6">
                    <Link href="/terminal" className="p-2 hover:bg-white/5 rounded-full transition-colors group">
                        <ChevronLeft className="w-6 h-6 text-gray-400 group-hover:text-white" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-black bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded tracking-tighter uppercase">
                                Institutional Grade
                            </span>
                            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                                Live Nexus Feed
                            </span>
                        </div>
                        <h1 className="text-3xl font-black tracking-tight">
                            Market Microstructure <span className="text-gray-500">Terminal</span>
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Selected Pair</span>
                        <span className="text-sm font-black">{ticker}</span>
                    </div>
                    <div className="w-px h-8 bg-white/10 mx-2" />
                    <div className="flex flex-col items-start">
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Sentry Node</span>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-sm font-mono text-emerald-500">Operational</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Real-time Metric Cards */}
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <MetricCard
                        title="Coinbase Premium"
                        value={`-$${Math.abs(current.spread_usd).toFixed(2)}`}
                        sub={`${current.premium.toFixed(2)} bps (Binance)`}
                        icon={<Globe className="w-5 h-5" />}
                        trend={current.spread_usd > 0 ? 'up' : 'down'}
                        color={current.spread_usd > 0 ? 'emerald' : 'rose'}
                    />
                    <MetricCard
                        title="Cumulative Vol Delta"
                        value={`$${((current.cvd * (current.prices?.binance || 60000)) / 1000000).toFixed(1)}M`}
                        sub={`BNB: $${((current.cvd_binance * (current.prices?.binance || 60000)) / 1000000).toFixed(1)}M | CB: $${((current.cvd_coinbase * (current.prices?.cb || 60000)) / 1000000).toFixed(1)}M`}
                        icon={<Activity className="w-5 h-5" />}
                        trend={current.cvd > history[history.length - 2]?.cvd ? 'up' : 'down'}
                        color="blue"
                    />
                    <MetricCard
                        title="Open Interest"
                        value={`$${((current.open_interest * (current.prices?.binance || 60000)) / 1000000000).toFixed(3)}B`}
                        sub="Binance Futures Agg."
                        icon={<TrendingUp className="w-5 h-5" />}
                        trend={current.open_interest > history[history.length - 5]?.oi ? 'up' : 'down'}
                        color="amber"
                    />

                    {/* Regime Banner */}
                    <div className="md:col-span-3 bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl ${divergence.includes('BULLISH') ? 'bg-emerald-500/20 text-emerald-500' : divergence.includes('BEARISH') ? 'bg-red-500/20 text-red-500' : 'bg-gray-500/20 text-gray-400'}`}>
                                <Zap className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-widest text-gray-300">Market Regime</h3>
                                <span className={`text-lg font-black ${divergence.includes('BULLISH') ? 'text-emerald-400' : divergence.includes('BEARISH') ? 'text-red-400' : 'text-gray-500'}`}>
                                    {divergence === 'NONE' ? 'Equilibrium' : divergence.replace('_', ' ')}
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] text-gray-500 font-bold uppercase block">Passive Supply Walls</span>
                            <span className="text-sm font-mono font-bold text-red-400">
                                {walls.ask[0] ? `$${walls.ask[0].toLocaleString()}` : 'None'}
                            </span>
                        </div>
                    </div>

                    {/* Charts Section */}
                    <div className="md:col-span-3 bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl space-y-6">
                        {/* Price & Walls Chart */}
                        <div className="h-[250px] w-full relative">
                            <h3 className="absolute top-0 left-0 text-[10px] font-bold text-gray-500 uppercase tracking-widest z-10">Price (USD) & Passive Walls</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={history}>
                                    <defs>
                                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="timestamp" hide />
                                    <YAxis domain={['auto', 'auto']} stroke="rgba(255,255,255,0.3)" fontSize={10} tickFormatter={(val) => `$${val}`} />
                                    <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                    <Area type="monotone" dataKey="price" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorPrice)" />
                                    {/* Passive Walls (Reference Lines) */}
                                    {/* Note: In Recharts, creating dynamic ReferenceLines inside map can sometimes be tricky or cause hydration mismatch if data changes too fast. 
                                        But for this dashboard it should be fine. */}
                                </AreaChart>
                            </ResponsiveContainer>
                            {/* Overlay Manual Lines for Walls just to be safe & visual - actually simpler to just list them or use Recharts ReferenceLine if supported dynamically */}
                        </div>

                        {/* CVD Chart */}
                        <div className="h-[150px] w-full relative border-t border-white/5 pt-4">
                            <h3 className="absolute top-4 left-0 text-[10px] font-bold text-gray-500 uppercase tracking-widest z-10">Net CVD (Spot Agg.)</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={history}>
                                    <defs>
                                        <linearGradient id="colorCvd2" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="timestamp" hide />
                                    <YAxis
                                        domain={['auto', 'auto']}
                                        stroke="rgba(255,255,255,0.3)"
                                        fontSize={10}
                                        tickFormatter={(val) => `$${((val * (current.prices?.binance || 60000)) / 1000000).toFixed(0)}M`}
                                    />
                                    <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)' }} />
                                    <Area type="step" dataKey="cvd" stroke="#10b981" strokeWidth={2} fill="url(#colorCvd2)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Open Interest Chart */}
                        <div className="h-[150px] w-full relative border-t border-white/5 pt-4">
                            <h3 className="absolute top-4 left-0 text-[10px] font-bold text-gray-500 uppercase tracking-widest z-10">Open Interest (USD Notional)</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={history}>
                                    <defs>
                                        <linearGradient id="colorOi" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="timestamp" hide />
                                    <YAxis
                                        domain={['auto', 'auto']}
                                        stroke="rgba(255,255,255,0.3)"
                                        fontSize={10}
                                        tickFormatter={(val) => `$${((val * (current.prices?.binance || 60000)) / 1000000000).toFixed(1)}B`}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)' }}
                                        formatter={(val: any) => [`$${((Number(val) * (current.prices?.binance || 60000)) / 1000000000).toFixed(2)}B`, 'Open Interest']}
                                    />
                                    <Area type="monotone" dataKey="oi" stroke="#f59e0b" strokeWidth={2} fill="url(#colorOi)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Sidebar Intelligence */}
                <div className="flex flex-col gap-6">
                    {/* Bias Indicator */}
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6">Institutional Bias</h3>
                        <div className="flex flex-col items-center gap-4">
                            <div className="relative w-40 h-40 flex items-center justify-center">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle
                                        cx="80"
                                        cy="80"
                                        r="70"
                                        fill="none"
                                        stroke="rgba(255,255,255,0.05)"
                                        strokeWidth="8"
                                    />
                                    <motion.circle
                                        cx="80"
                                        cy="80"
                                        r="70"
                                        fill="none"
                                        stroke={current.spread_usd > 0 ? '#10b981' : '#f43f5e'}
                                        strokeWidth="8"
                                        strokeDasharray={440}
                                        initial={{ strokeDashoffset: 440 }}
                                        animate={{ strokeDashoffset: 440 - (Math.max(10, Math.min(100, Math.abs(current.spread_usd))) / 100) * 440 }}
                                        transition={{ duration: 1 }}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-2xl font-black">{current.bias === 'institutional_bid' ? 'BULLISH' : current.bias === 'institutional_sell' ? 'BEARISH' : 'NEUTRAL'}</span>
                                    <span className="text-[10px] text-gray-500 font-bold uppercase italic">Delta Prob.</span>
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                                {current.bias === 'institutional_bid'
                                    ? "Whale absorption detected on Coinbase Spot. Aggressive bidding likely to push perp price higher."
                                    : current.bias === 'institutional_sell'
                                        ? "Institutional supply overhang. Market participants exiting spot positions faster than takers can buy."
                                        : "Market microstructure in equilibrium. No significant lead-lag advantage detected."}
                            </p>
                        </div>
                    </div>

                    {/* Interpretation Panel */}
                    <div className="flex-1 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Zap className="w-16 h-16 text-emerald-500" />
                        </div>
                        <h3 className="text-sm font-bold text-emerald-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Smart Alpha Interpretation
                        </h3>
                        <div className="space-y-4">
                            <InterpretationBlock
                                title="Lead-Lag (Binance)"
                                value={current.divergence !== 'NONE' ? current.divergence : (current.spread_usd > 30 ? "Strongly Bullish" : "None Detected")}
                                text={`Divergence signal is primary. Spread is $${current.spread_usd.toFixed(2)}.`}
                            />
                            <InterpretationBlock
                                title="Absorption Status"
                                value={current.cvd > 0 ? "Bulls Absorbing" : "Bears Absorbing"}
                                text={`Real-time spot flow: Binance ($${(current.cvd_binance / 1000).toFixed(1)}k) vs Coinbase ($${(current.cvd_coinbase / 1000).toFixed(1)}k).`}
                            />
                            <InterpretationBlock
                                title="Liquidity Trap Risk"
                                value={walls.ask[0] ? "High Resistance" : "Clear"}
                                text={`Nearest Passive Ask Wall: ${walls.ask[0] ? `$${walls.ask[0]}` : 'None within 5%'}.`}
                            />
                        </div>
                    </div>
                </div>

                {/* CVD History - Left Column */}
                <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-lg font-bold">Cumulative Volume Delta (CVD)</h2>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Aggregated Spot Flow</span>
                        </div>
                    </div>
                    <div className="h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history}>
                                <defs>
                                    <linearGradient id="colorCvd" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis
                                    stroke="rgba(255,255,255,0.3)"
                                    fontSize={10}
                                    tickFormatter={(val) => `$${((val * (current.prices?.binance || 60000)) / 1000000).toFixed(0)}M`}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area type="step" dataKey="cvd" stroke="#10b981" strokeWidth={2} fill="url(#colorCvd)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Side-by-Side Price Benchmarks - Right Column */}
                <div className="lg:col-span-1 bg-white/5 border border-white/10 rounded-2xl p-6 overflow-hidden">
                    <div className="flex items-center gap-2 mb-6">
                        <BarChart3 className="w-4 h-4 text-gray-400" />
                        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Institutional Benchmarks</h2>
                    </div>

                    <div className="space-y-4">
                        <PriceRow
                            label="Coinbase Spot"
                            price={current.prices?.cb}
                            isReference
                        />
                        <div className="h-px w-full bg-white/5" />
                        <PriceRow
                            label="Binance Spot"
                            price={current.prices?.binance}
                            diff={current.prices?.cb - current.prices?.binance}
                        />
                        <PriceRow
                            label="Hyperliquid Mark"
                            price={current.prices?.hl}
                            diff={current.prices?.cb - current.prices?.hl}
                        />
                        <PriceRow
                            label="Binance Index"
                            price={current.prices?.binance_index}
                            diff={current.prices?.cb - current.prices?.binance_index}
                        />
                    </div>

                    <div className="mt-8 p-3 bg-white/[0.03] border border-white/5 rounded-xl">
                        <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                            <Info className="w-3 h-3 inline mr-1 mb-0.5" />
                            Velo comparison typically uses <span className="text-gray-300">CB Spot vs Binance Spot</span>.
                        </p>
                    </div>
                </div>

            </main>
        </div>
    );
}

function PriceRow({ label, price, diff, isReference }: any) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex flex-col">
                <span className={`text-[11px] font-bold ${isReference ? 'text-emerald-500' : 'text-gray-400'}`}>
                    {label}
                    {isReference && <span className="ml-1 text-[9px] bg-emerald-500/10 px-1 rounded uppercase tracking-tighter">Ref</span>}
                </span>
                <span className="text-sm font-mono font-black tracking-tight">
                    ${price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
            </div>
            {!isReference && (
                <div className="flex flex-col items-end">
                    <span className="text-[9px] text-gray-500 font-black uppercase tracking-tighter mb-0.5">Spread</span>
                    <span className={`text-xs font-mono font-bold ${diff > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {diff > 0 ? '+' : ''}{diff?.toFixed(2)}
                    </span>
                </div>
            )}
        </div>
    );
}

function MetricCard({ title, value, sub, icon, trend, color }: any) {
    const colorClasses: any = {
        emerald: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
        rose: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
        blue: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
        amber: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    };

    return (
        <motion.div
            whileHover={{ y: -5 }}
            className="bg-white/5 border border-white/10 rounded-2xl p-6 transition-all hover:bg-white/[0.07]"
        >
            <div className="flex items-center justify-between mb-4">
                <div className={`p-2 rounded-xl border ${colorClasses[color]}`}>
                    {icon}
                </div>
                {trend !== 'neutral' && (
                    <div className={`flex items-center gap-1 ${trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        <span className="text-[10px] font-black uppercase">Live</span>
                    </div>
                )}
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">{title}</span>
                <span className="text-2xl font-black tracking-tight">{value}</span>
                <span className="text-[11px] text-gray-400 font-medium mt-1">{sub}</span>
            </div>
        </motion.div>
    );
}

function InterpretationBlock({ title, value, text }: any) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-gray-400">{title}</span>
                <span className="text-[10px] font-black uppercase text-emerald-500">{value}</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed font-medium">
                {text}
            </p>
            <div className="h-px w-full bg-white/5 mt-2" />
        </div>
    );
}
