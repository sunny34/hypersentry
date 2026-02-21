'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface Position {
    coin: string;
    size: number;
    value: number;
    entryPrice: number;
    markPrice: number;
    pnl: number;
    roe: number;
    liquidationPrice?: number;
    side: 'LONG' | 'SHORT';
    raw?: any;
}

interface PositionsTableProps {
    positions: Position[];
    isLoading: boolean;
    onSelectToken?: (symbol: string) => void;
    onClose?: (position: Position) => void;
    onAnalyze?: (position: Position) => void;
    onAdjust?: (position: Position) => void;
}

const PnLCell = ({ pnl, roe }: { pnl: number, roe: number }) => {
    const [flash, setFlash] = useState<'up' | 'down' | null>(null);
    const prevPnl = useRef(pnl);

    useEffect(() => {
        const nextFlash = pnl > prevPnl.current ? 'up' : pnl < prevPnl.current ? 'down' : null;
        if (!nextFlash) {
            prevPnl.current = pnl;
            return;
        }

        const showTimer = window.setTimeout(() => setFlash(nextFlash), 0);
        const hideTimer = window.setTimeout(() => setFlash(null), 500);
        prevPnl.current = pnl;

        return () => {
            window.clearTimeout(showTimer);
            window.clearTimeout(hideTimer);
        };
    }, [pnl]);

    const flashClass = flash === 'up' ? 'bg-emerald-500/20' : flash === 'down' ? 'bg-red-500/20' : '';

    // PnL Intensity (0 to 100)
    const intensity = Math.min(100, Math.abs(roe) * 2);

    return (
        <div className={`flex flex-col items-end group/pnl transition-all duration-300 rounded p-1 ${flashClass}`}>
            <div className="flex items-center gap-2">
                {/* Heatmap Bar */}
                <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-1000 ${roe >= 0 ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`}
                        style={{ width: `${intensity}%` }}
                    />
                </div>
                <span className={`text-sm font-black tracking-tight flex items-center gap-1 ${pnl >= 0 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'text-red-400'}`}>
                    {pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    ${Math.abs(pnl).toFixed(2)}
                </span>
            </div>
            <span className={`text-[9px] font-bold ${pnl >= 0 ? 'text-emerald-500/60' : 'text-red-500/60'}`}>
                {pnl >= 0 ? '+' : ''}{roe.toFixed(2)}%
            </span>
        </div>
    );
};

export default function PositionsTable({ positions, isLoading, onSelectToken, onClose, onAnalyze, onAdjust }: PositionsTableProps) {
    // Removing early returns for loading and empty states to preserve table structure


    return (
        <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-sm text-left border-separate border-spacing-0">
                <thead className="text-[9px] text-gray-500 uppercase bg-[#050505] sticky top-0 z-10">
                    <tr>
                        <th className="px-2 py-3 font-black tracking-widest border-b border-white/5 pl-4">Position Source</th>
                        <th className="px-2 py-3 font-black tracking-widest border-b border-white/5 text-right">Size / Value</th>
                        <th className="px-2 py-3 font-black tracking-widest border-b border-white/5 text-right">Entry / Mark</th>
                        <th className="px-2 py-3 font-black tracking-widest border-b border-white/5 text-right">Risk DNA (Liq)</th>
                        <th className="px-2 py-3 font-black tracking-widest border-b border-white/5 text-right">Delta / ROI</th>
                        <th className="px-2 py-3 font-black tracking-widest border-b border-white/5 text-right pr-4">Tactical</th>
                    </tr>
                </thead>
                <tbody className="bg-transparent">
                    {isLoading ? (
                        <tr>
                            <td colSpan={6} className="px-4 py-8 text-center border-b border-white/5">
                                <div className="flex items-center justify-center text-gray-500 gap-2 text-[10px] font-black uppercase tracking-widest">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Syncing Alpha Intel...</span>
                                </div>
                            </td>
                        </tr>
                    ) : positions.length === 0 ? (
                        <tr>
                            <td colSpan={6} className="px-4 py-8 text-center border-b border-white/5">
                                <span className="text-gray-600 text-[10px] font-black uppercase tracking-widest opacity-60">
                                    No Active Deployments
                                </span>
                            </td>
                        </tr>
                    ) : (
                        positions.map((pos) => {
                            // Safety Distance Calculation
                            const liqDist = pos.liquidationPrice ? Math.abs((pos.markPrice - pos.liquidationPrice) / pos.markPrice) * 100 : 100;
                            const safetyScore = Math.min(100, liqDist * 4); // Scale to 100
                            const safetyColor = liqDist < 5 ? 'bg-red-500' : liqDist < 15 ? 'bg-orange-500' : 'bg-emerald-500';

                            return (
                                <tr key={pos.coin} className="hover:bg-white/[0.02] transition-colors group border-b border-white/5">
                                    <td className="px-2 py-3 pl-4">
                                        <button
                                            onClick={() => onSelectToken && onSelectToken(pos.coin)}
                                            className="flex flex-col gap-0.5 items-start group/btn"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm ${pos.side === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                                    {pos.side}
                                                </span>
                                                <span className="font-bold text-white group-hover/btn:text-blue-400 transition-colors uppercase text-sm tracking-tight">{pos.coin}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="text-[8px] text-gray-600 font-black uppercase tracking-widest">HL-PERP</span>
                                                <div className="w-1 h-1 rounded-full bg-blue-500/40" />
                                                <span className="text-[8px] text-gray-500 font-mono">X{(pos.raw?.leverage?.value || 20)} ISO</span>
                                            </div>
                                        </button>
                                    </td>
                                    <td className="px-2 py-3 text-right">
                                        <div className="flex flex-col font-mono">
                                            <span className="text-sm text-white font-bold tracking-tighter">{pos.size.toLocaleString()}</span>
                                            <span className="text-[10px] text-gray-500">${pos.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-3 text-right font-mono">
                                        <div className="flex flex-col leading-tight" title={`Exact Entry: $${pos.entryPrice}`}>
                                            <span className="text-xs text-gray-300 font-bold underline decoration-white/10 decoration-dotted underline-offset-2">${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                            <span className="text-[10px] text-gray-600">${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-3 text-right font-mono">
                                        <div className="flex flex-col items-end gap-1" title={pos.liquidationPrice ? `Liq. Price: $${pos.liquidationPrice}` : 'Unleveraged or Spot Position'}>
                                            <span className={`text-sm font-black ${pos.liquidationPrice ? 'text-white' : 'text-gray-700'}`}>
                                                {pos.liquidationPrice ? `$${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'UNLIMITED'}
                                            </span>
                                            {/* Margin Safety Bar */}
                                            <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                                <div
                                                    className={`h-full transition-all duration-1000 ${safetyColor} shadow-[0_0_8px_currentColor]`}
                                                    style={{ width: `${Math.max(5, safetyScore)}%` }}
                                                />
                                            </div>
                                            <span className="text-[8px] text-gray-500 uppercase font-black tracking-widest opacity-50">
                                                {pos.liquidationPrice ? `${liqDist.toFixed(1)}% Distance` : 'ALPHA SAFETY'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-3 text-right" title={`Raw PnL: $${pos.pnl} | ROE: ${pos.roe}%`}>
                                        <PnLCell pnl={pos.pnl} roe={pos.roe} />
                                    </td>
                                    <td className="px-2 py-3 text-right pr-4">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <button
                                                onClick={() => onAnalyze && onAnalyze(pos)}
                                                className="h-7 px-3 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                                            >
                                                Intel
                                            </button>
                                            <button
                                                onClick={() => onAdjust && onAdjust(pos)}
                                                className="h-7 px-2 bg-white/5 hover:bg-white/10 text-gray-400 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                                            >
                                                Adj
                                            </button>
                                            <button
                                                onClick={() => onClose && onClose(pos)}
                                                className="h-7 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.05] active:scale-[0.95]"
                                            >
                                                Exit
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}
