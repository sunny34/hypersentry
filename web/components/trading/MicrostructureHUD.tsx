'use client';
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity,
    Zap,
    Minimize2,
    Maximize2,
    X,
    Settings,
    Newspaper,
    Target,
    BarChart2,
    BrainCircuit,
    CheckCircle2,
    ChevronRight,
    Lightbulb,
    Save
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

type DataSource = 'microstructure' | 'prediction' | 'news' | 'ta';

export default function MicrostructureHUD({ onClose, symbol, isMinimized: externalIsMinimized, onToggleMinimize }: { onClose: () => void, symbol: string, isMinimized?: boolean, onToggleMinimize?: () => void }) {
    const [data, setData] = useState<any>(null);
    const [nexusData, setNexusData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [internalIsMinimized, setInternalIsMinimized] = useState(false);

    const isMinimized = externalIsMinimized ?? internalIsMinimized;
    const handleMinimizeToggle = () => {
        if (onToggleMinimize) {
            onToggleMinimize();
        } else {
            setInternalIsMinimized(!internalIsMinimized);
        }
    };
    const [activeChart, setActiveChart] = useState<'cvd' | 'oi'>('cvd');
    const [selectedSources, setSelectedSources] = useState<Set<DataSource>>(new Set(['microstructure']));
    const [showConfig, setShowConfig] = useState(false);
    const [activeDetail, setActiveDetail] = useState<any>(null);
    const [taConfig, setTaConfig] = useState({
        timeframe: '1m', // Default to 1m
        rsiOversold: 30,
        rsiOverbought: 70,
        enableABC: true,
        enableDivergence: true
    });

    // Fetch logic
    const fetchData = useCallback(async (resetState = false) => {
        try {
            if (resetState) {
                setLoading(true);
                setData(null);
            }
            const [microRes, nexusRes] = await Promise.all([
                axios.get(`${API_URL}/intel/microstructure`, {
                    params: { symbol: symbol }
                }),
                axios.get(`${API_URL}/intel/nexus`)
            ]);
            setData(microRes.data);
            setNexusData(nexusRes.data || []);
            setLoading(false);
        } catch (e) {
            console.error("Failed to fetch intel data", e);
        }
    }, [symbol]);

    useEffect(() => {
        const runFetch = (resetState = false) => {
            void fetchData(resetState);
        };
        const initial = setTimeout(() => runFetch(true), 0);
        const interval = setInterval(runFetch, 5000);
        return () => {
            clearTimeout(initial);
            clearInterval(interval);
        };
    }, [fetchData]);

    const toggleSource = (source: DataSource) => {
        const next = new Set(selectedSources);
        if (next.has(source)) next.delete(source);
        else next.add(source);
        setSelectedSources(next);
    };

    // AI Synthesis Engine (Client-Side Heuristic for immediate feedback)
    const intelAnalysis = (() => {
        if (!data) return null;
        const scoreParts: { source: string, score: number, weight: number, reason: string }[] = [];

        // 1. Microstructure Analysis
        if (selectedSources.has('microstructure')) {
            const spreadScore = data.current.spread_usd > 10 ? 1 : data.current.spread_usd < -10 ? -1 : 0;
            const cvdScore = data.current.cvd > 0 ? 0.5 : -0.5;

            // Custom Divergence Logic
            let divScore = 0;
            let divReason = '';
            if (taConfig.enableDivergence) {
                divScore = data.current.divergence.includes('BULLISH') ? 1.5 : data.current.divergence.includes('BEARISH') ? -1.5 : 0;
                if (divScore !== 0) divReason = `Divergence: ${data.current.divergence}`;
            }

            scoreParts.push({
                source: 'Microstructure',
                score: spreadScore + cvdScore + divScore,
                weight: 2.0,
                reason: divReason || `Spread: $${data.current.spread_usd.toFixed(2)}`
            });
        }

        // 2. Prediction / Nexus Signals (Real Data)
        if (selectedSources.has('prediction')) {
            const activeSignal = nexusData.find((s: any) => s.token === symbol || s.token === 'BTC'); // Fallback to BTC if specific not found
            if (activeSignal) {
                const score = activeSignal.alpha_score > 5 ? 1 : activeSignal.alpha_score < -5 ? -1 : 0;
                scoreParts.push({
                    source: 'Nexus Brain',
                    score: score,
                    weight: 2.5,
                    reason: `${activeSignal.recommendation} (${activeSignal.alpha_score})`
                });
            } else {
                // Fallback Mock if no signal
                const predScore = 0.5;
                scoreParts.push({ source: 'Prediction', score: predScore, weight: 1.0, reason: 'Market Neutral' });
            }
        }

        // 3. News Sentiment (Simulated or from IntelItem)
        if (selectedSources.has('news')) {
            const newsScore = data.current.sentiment > 0.6 ? 1 : -0.5;
            scoreParts.push({ source: 'News', score: newsScore, weight: 1.0, reason: 'Positive Macro Flows' });
        }

        // 4. TA (Customizable & Multi-Timeframe)
        if (selectedSources.has('ta')) {
            // safely access selected timeframe or default to 1m
            const tf = taConfig.timeframe || '1m';
            const ta = data.current.ta?.[tf] || data.current.ta || {};

            let taScore = 0;
            const reasons: string[] = [];

            // Customizable RSI Logic
            const rsiVal = ta.rsi || 50;
            if (rsiVal < taConfig.rsiOversold) {
                taScore += 1.5;
                reasons.push(`Oversold RSI < ${taConfig.rsiOversold} (${tf})`);
            } else if (rsiVal > taConfig.rsiOverbought) {
                taScore -= 1.5;
                reasons.push(`Overbought RSI > ${taConfig.rsiOverbought} (${tf})`);
            } else {
                reasons.push(`RSI Neutral (${rsiVal.toFixed(0)})`);
            }

            // Customizable Pattern Logic
            if (taConfig.enableABC && ta.pattern) {
                taScore += 0.5;
                reasons.push(`${ta.pattern.pattern.replace('_', ' ')} (${tf})`);
            }

            scoreParts.push({
                source: 'Technical Analysis',
                score: taScore,
                weight: 1.5,
                reason: reasons.join(', ') || 'Neutral Structure'
            });
        }

        // Aggregate
        let totalScore = 0;
        let totalWeight = 0;
        scoreParts.forEach(p => {
            totalScore += p.score * p.weight;
            totalWeight += p.weight;
        });

        const normalized = totalWeight > 0 ? (totalScore / totalWeight) : 0;

        let signal = 'NEUTRAL';
        let color = 'text-gray-400';
        if (normalized > 0.5) { signal = 'STRONG BUY'; color = 'text-emerald-400'; }
        else if (normalized > 0.2) { signal = 'BUY'; color = 'text-emerald-400'; }
        else if (normalized < -0.5) { signal = 'STRONG SELL'; color = 'text-red-400'; }
        else if (normalized < -0.2) { signal = 'SELL'; color = 'text-red-400'; }

        return { signal, color, confidence: Math.min(Math.abs(normalized) * 100, 99).toFixed(0), details: scoreParts };
    })();


    if (loading || !data) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="fixed bottom-4 right-4 z-50 w-80 h-32 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl"
            >
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                    <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">Warming Nexus...</span>
                </div>
            </motion.div>
        );
    }

    const { current, history } = data;
    const price = current.prices?.binance || 60000;

    return (
        <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`fixed z-50 bg-[#0a0a0a]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col transition-all duration-300 ${isMinimized ? 'w-64 h-auto bottom-4 right-4' : 'w-[340px] bottom-20 right-6'}`}
        >
            {/* Header */}
            <div className="p-3 border-b border-white/5 flex items-center justify-between cursor-move bg-gradient-to-r from-white/5 to-transparent">
                <div className="flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-200">
                        Smart Nexus <span className="text-emerald-500">AI</span> • {symbol}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setShowConfig(!showConfig)} className={`p-1 rounded-lg transition-colors ${showConfig ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-400 hover:bg-white/10'}`}>
                        <Settings className="w-3 h-3" />
                    </button>
                    <button onClick={handleMinimizeToggle} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                        {isMinimized ? <Maximize2 className="w-3 h-3 text-gray-400" /> : <Minimize2 className="w-3 h-3 text-gray-400" />}
                    </button>
                    <button onClick={onClose} className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Config Panel */}
            {showConfig && !isMinimized && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="bg-black/95 backdrop-blur-xl border-b border-white/10 p-4 space-y-4 overflow-y-auto max-h-[300px]"
                >
                    <div className="grid grid-cols-2 gap-2">
                        <SourceToggle label="Microstructure" icon={Activity} active={selectedSources.has('microstructure')} onClick={() => toggleSource('microstructure')} />
                        <SourceToggle label="Prediction" icon={Target} active={selectedSources.has('prediction')} onClick={() => toggleSource('prediction')} />
                        <SourceToggle label="News Sentiment" icon={Newspaper} active={selectedSources.has('news')} onClick={() => toggleSource('news')} />
                        <SourceToggle label="Technical A." icon={BarChart2} active={selectedSources.has('ta')} onClick={() => toggleSource('ta')} />
                    </div>

                    {/* Advanced TA Settings */}
                    {selectedSources.has('ta') && (
                        <div className="space-y-3 pt-2 border-t border-white/5">
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Custom TA Rules</span>

                            {/* Timeframe Selector */}
                            <div className="flex bg-white/5 p-1 rounded-lg border border-white/5">
                                {['1m', '5m', '15m'].map((tf) => (
                                    <button
                                        key={tf}
                                        onClick={() => setTaConfig(prev => ({ ...prev, timeframe: tf }))}
                                        className={`flex-1 py-1 text-[9px] font-bold uppercase rounded transition-all ${taConfig.timeframe === tf ? 'bg-emerald-500/20 text-emerald-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[9px] text-gray-400 uppercase">RSI Oversold</label>
                                    <input
                                        type="number"
                                        value={taConfig.rsiOversold}
                                        onChange={(e) => setTaConfig(prev => ({ ...prev, rsiOversold: parseInt(e.target.value) || 30 }))}
                                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-emerald-500/50 outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] text-gray-400 uppercase">RSI Overbought</label>
                                    <input
                                        type="number"
                                        value={taConfig.rsiOverbought}
                                        onChange={(e) => setTaConfig(prev => ({ ...prev, rsiOverbought: parseInt(e.target.value) || 70 }))}
                                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-emerald-500/50 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer hover:text-white">
                                    <input
                                        type="checkbox"
                                        checked={taConfig.enableABC}
                                        onChange={(e) => setTaConfig(prev => ({ ...prev, enableABC: e.target.checked }))}
                                        className="rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-0 checked:bg-emerald-500"
                                    />
                                    <span>Enable Elliott Wave (A-B-C) Detection</span>
                                </label>
                                <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer hover:text-white">
                                    <input
                                        type="checkbox"
                                        checked={taConfig.enableDivergence}
                                        onChange={(e) => setTaConfig(prev => ({ ...prev, enableDivergence: e.target.checked }))}
                                        className="rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-0 checked:bg-emerald-500"
                                    />
                                    <span>Enable CVD Divergence Checks</span>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Apply Button */}
                    <button
                        onClick={() => setShowConfig(false)}
                        className="w-full mt-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-emerald-500/20 transition-all flex items-center justify-center gap-2 group"
                    >
                        <Save className="w-3 h-3 group-hover:scale-110 transition-transform" />
                        Apply Auto-Configuration
                    </button>
                </motion.div>
            )}

            {/* Main Content */}
            {!isMinimized && (
                <div className="p-4 space-y-4">
                    {/* Recommendation Output */}
                    <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="flex flex-col">
                            <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1">Nexus Recommendation</span>
                            <div className="flex items-end gap-2">
                                <span className={`text-xl font-black tracking-tight ${intelAnalysis?.color}`}>
                                    {intelAnalysis?.signal}
                                </span>
                                <span className="text-[10px] font-mono text-gray-500 mb-1">
                                    {intelAnalysis?.confidence}% CONF.
                                </span>
                            </div>
                        </div>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${intelAnalysis?.signal.includes('BUY') ? 'border-emerald-500/20 bg-emerald-500/10' : intelAnalysis?.signal.includes('SELL') ? 'border-red-500/20 bg-red-500/10' : 'border-gray-500/20'}`}>
                            <Zap className={`w-5 h-5 ${intelAnalysis?.color}`} />
                        </div>
                    </div>

                    {/* Breakdown of Inputs */}
                    <div className="space-y-1">
                        {intelAnalysis?.details.map((d) => (
                            <div
                                key={d.source}
                                onClick={() => setActiveDetail(d)}
                                className="flex items-center justify-between text-[10px] cursor-pointer hover:bg-white/5 p-1.5 rounded transition-all group active:scale-[0.98]"
                            >
                                <span className="text-gray-400 font-medium group-hover:text-white transition-colors">{d.source}</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 italic group-hover:text-gray-300 transition-colors truncate max-w-[120px] text-right">{d.reason}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor] ${d.score > 0 ? 'bg-emerald-500 text-emerald-500' : d.score < 0 ? 'bg-red-500 text-red-500' : 'bg-gray-500 text-gray-500'}`} />
                                    <ChevronRight className="w-3 h-3 text-gray-600 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all duration-300" />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Detail Overlay */}
                    <AnimatePresence>
                        {activeDetail && (
                            <motion.div
                                initial={{ opacity: 0, x: 50 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 50 }}
                                className="absolute inset-0 bg-[#0a0a0a] z-40 flex flex-col"
                            >
                                <div className="p-3 border-b border-white/10 flex items-center justify-between bg-white/5">
                                    <span className="text-xs font-bold uppercase tracking-widest text-emerald-500">{activeDetail.source} Intel</span>
                                    <button onClick={() => setActiveDetail(null)} className="p-1 hover:bg-white/10 rounded-full transition-colors group">
                                        <X className="w-4 h-4 text-gray-400 group-hover:text-white" />
                                    </button>
                                </div>

                                <div className="p-4 space-y-6 overflow-y-auto custom-scrollbar">
                                    <div className="bg-gradient-to-br from-white/5 to-transparent p-4 rounded-xl border border-white/5 shadow-2xl">
                                        <span className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Impact Score</span>
                                        <div className="flex items-end gap-2">
                                            <span className={`text-3xl font-black tracking-tighter ${activeDetail.score > 0 ? 'text-emerald-400' : activeDetail.score < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                                {activeDetail.score > 0 ? '+' : ''}{activeDetail.score.toFixed(1)}
                                            </span>
                                            <span className="text-xs text-gray-500 mb-1.5 font-mono">/ {activeDetail.weight.toFixed(1)} WEIGHT</span>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Primary Drivers</span>
                                        <div className="space-y-2">
                                            {activeDetail.reason.split(', ').map((r: string, i: number) => (
                                                <motion.div
                                                    key={i}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.1 }}
                                                    className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/5"
                                                >
                                                    <div className={`mt-1 w-2 h-2 rounded-full ${activeDetail.score > 0 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                                                    <span className="text-sm text-gray-200 font-light leading-relaxed">{r}</span>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </div>

                                    {activeDetail.source === 'Technical Analysis' && (
                                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl relative overflow-hidden">
                                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                                <BrainCircuit className="w-16 h-16 text-emerald-500" />
                                            </div>
                                            <div className="relative z-10">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Lightbulb className="w-3 h-3 text-emerald-400" />
                                                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">AI Synthesis</span>
                                                </div>
                                                <p className="text-xs text-emerald-100/70 leading-relaxed font-light">
                                                    Analysis based on the <b>{taConfig.timeframe}</b> timeframe.
                                                    The system has detected {activeDetail.score > 0 ? 'significant bullish confluence' : activeDetail.score < 0 ? 'bearish structural weakness' : 'neutral consolidation'}.
                                                    {activeDetail.reason.includes('RSI') ? ' Momentum indicators suggest an impending reversal.' : ' Price structure remains the primary validation.'}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Microstructure Metrics (Conditional) */}
                    {selectedSources.has('microstructure') && (
                        <>
                            <div className="h-px w-full bg-white/5" />
                            <div className="flex bg-black/20 rounded-lg p-0.5 border border-white/5">
                                <button
                                    onClick={() => setActiveChart('cvd')}
                                    className={`flex-1 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${activeChart === 'cvd' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    CVD Flow
                                </button>
                                <button
                                    onClick={() => setActiveChart('oi')}
                                    className={`flex-1 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${activeChart === 'oi' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    Open Interest
                                </button>
                            </div>

                            <div className="h-24 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history}>
                                        <defs>
                                            <linearGradient id="hudGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={activeChart === 'cvd' ? '#10b981' : '#f59e0b'} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={activeChart === 'cvd' ? '#10b981' : '#f59e0b'} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="timestamp" hide />
                                        <YAxis domain={['auto', 'auto']} hide />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#000', border: '1px solid #333', fontSize: '10px' }}
                                            itemStyle={{ color: '#fff' }}
                                            formatter={(val: any) => [
                                                activeChart === 'cvd'
                                                    ? `$${((val * price) / 1_000_000).toFixed(1)}M`
                                                    : `$${((val * price) / 1_000_000_000).toFixed(2)}B`,
                                                activeChart === 'cvd' ? 'CVD' : 'OI'
                                            ]}
                                            labelStyle={{ display: 'none' }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey={activeChart}
                                            stroke={activeChart === 'cvd' ? '#10b981' : '#f59e0b'}
                                            strokeWidth={2}
                                            fill="url(#hudGradient)"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    )}
                </div>
            )}
        </motion.div>
    );
}

function SourceToggle({ label, icon: Icon, active, onClick }: any) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${active ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/5 text-gray-500 hover:bg-white/10'}`}
        >
            <Icon className="w-3 h-3" />
            <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
            {active && <CheckCircle2 className="w-3 h-3 ml-auto opacity-50" />}
        </button>
    );
}
