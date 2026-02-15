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

    return (
        <div className={`flex flex-col items-end group/pnl transition-all duration-300 rounded ${flashClass}`}>
            <span className={`text-sm font-black tracking-tight flex items-center gap-1 ${pnl >= 0 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'text-red-400'}`}>
                {pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                ${Math.abs(pnl).toFixed(2)}
            </span>
            <span className={`text-[9px] font-bold ${pnl >= 0 ? 'text-emerald-600' : 'text-red-800'}`}>
                {pnl >= 0 ? '+' : ''}{roe.toFixed(2)}%
            </span>
        </div>
    );
};

export default function PositionsTable({ positions, isLoading, onSelectToken, onClose, onAnalyze, onAdjust }: PositionsTableProps) {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-48 text-gray-500 gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading positions...</span>
            </div>
        );
    }

    if (positions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                <p className="font-medium mb-1">No open positions</p>
                <p className="text-xs opacity-60">Trades will appear here once executed</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-sm text-left border-separate border-spacing-0">
                <thead className="text-[9px] text-gray-500 uppercase bg-black/40 sticky top-0 z-10">
                    <tr>
                        <th className="px-2 py-2 font-black tracking-widest border-b border-white/5 pl-4">Market Info</th>
                        <th className="px-2 py-2 font-black tracking-widest border-b border-white/5 text-right">Size / Value</th>
                        <th className="px-2 py-2 font-black tracking-widest border-b border-white/5 text-right">Entry / Mark</th>
                        <th className="px-2 py-2 font-black tracking-widest border-b border-white/5 text-right">Liq. Zone</th>
                        <th className="px-2 py-2 font-black tracking-widest border-b border-white/5 text-right">Performance</th>
                        <th className="px-2 py-2 font-black tracking-widest border-b border-white/5 text-right pr-4">Tactical</th>
                    </tr>
                </thead>
                <tbody className="bg-transparent">
                    {positions.map((pos) => (
                        <tr key={pos.coin} className="hover:bg-white/[0.02] transition-colors group border-b border-white/5">
                            <td className="px-2 py-2 pl-4">
                                <button
                                    onClick={() => onSelectToken && onSelectToken(pos.coin)}
                                    className="flex flex-col gap-0.5 items-start group/btn"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${pos.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {pos.side}
                                        </span>
                                        <span className="font-bold text-white group-hover/btn:text-orange-400 transition-colors uppercase text-xs">{pos.coin}</span>
                                    </div>
                                    <span className="text-[8px] text-gray-600 font-mono tracking-tighter">HyperLiquid Perp</span>
                                </button>
                            </td>
                            <td className="px-2 py-2 text-right">
                                <div className="flex flex-col font-mono">
                                    <span className="text-xs text-gray-200 font-bold">{pos.size.toLocaleString()}</span>
                                    <span className="text-[9px] text-gray-500">${pos.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                            </td>
                            <td className="px-2 py-2 text-right font-mono">
                                <div className="flex flex-col">
                                    <span className="text-xs text-gray-300 font-bold underline decoration-white/10 decoration-dotted underline-offset-4">${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    <span className="text-[9px] text-gray-600">${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            </td>
                            <td className="px-2 py-2 text-right font-mono">
                                <div className="flex flex-col items-end">
                                    <span className={`text-xs font-bold ${pos.liquidationPrice ? 'text-orange-500' : 'text-gray-700'}`}>
                                        {pos.liquidationPrice ? `$${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'UNLIMITED'}
                                    </span>
                                    <span className="text-[8px] text-gray-700 uppercase font-black">Safety Zone</span>
                                </div>
                            </td>
                            <td className="px-2 py-2 text-right">
                                <PnLCell pnl={pos.pnl} roe={pos.roe} />
                            </td>
                            <td className="px-2 py-2 text-right pr-4">
                                <div className="flex items-center justify-end gap-1.5">
                                    <button
                                        onClick={() => onAnalyze && onAnalyze(pos)}
                                        className="h-6 px-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-[9px] font-black uppercase tracking-tighter transition-all"
                                    >
                                        Intel
                                    </button>
                                    <button
                                        onClick={() => onAdjust && onAdjust(pos)}
                                        className="h-6 px-2 bg-white/5 hover:bg-white/10 text-gray-400 border border-white/10 rounded text-[9px] font-black uppercase tracking-tighter transition-all"
                                    >
                                        Adjust
                                    </button>
                                    <button
                                        onClick={() => onClose && onClose(pos)}
                                        className="h-6 px-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded text-[9px] font-black uppercase tracking-tighter transition-all hover:scale-[1.05] active:scale-[0.95]"
                                    >
                                        Close
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
