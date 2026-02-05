'use client';
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
}

export default function PositionsTable({ positions, isLoading, onSelectToken, onClose, onAnalyze }: PositionsTableProps) {
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
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-900/50 sticky top-0">
                    <tr>
                        <th className="px-4 py-3 font-medium">Symbol</th>
                        <th className="px-4 py-3 font-medium text-right">Size</th>
                        <th className="px-4 py-3 font-medium text-right">Value</th>
                        <th className="px-4 py-3 font-medium text-right">Entry Price</th>
                        <th className="px-4 py-3 font-medium text-right">Mark Price</th>
                        <th className="px-4 py-3 font-medium text-right">Liq. Price</th>
                        <th className="px-4 py-3 font-medium text-right">PnL (ROE%)</th>
                        <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                    {positions.map((pos) => (
                        <tr key={pos.coin} className="hover:bg-gray-800/30 transition group">
                            <td className="px-4 py-3">
                                <button
                                    onClick={() => onSelectToken && onSelectToken(pos.coin)}
                                    className="flex items-center gap-2 hover:bg-white/5 px-2 py-1 -ml-2 rounded-lg transition-colors group/btn"
                                >
                                    <span className={`font-black tracking-tighter ${pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {pos.side}
                                    </span>
                                    <span className="font-bold text-white group-hover/btn:underline">{pos.coin}</span>
                                </button>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-300">
                                {pos.size.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-300">
                                ${pos.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-400">
                                ${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-400">
                                ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-right text-orange-400">
                                {pos.liquidationPrice ? `$${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                            </td>
                            <td className={`px-4 py-3 text-right font-bold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                <div className="flex flex-col items-end">
                                    <span>{pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}</span>
                                    <span className="text-xs opacity-70">
                                        ({pos.pnl >= 0 ? '+' : ''}{pos.roe.toFixed(2)}%)
                                    </span>
                                </div>
                            </td>
                            <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                                <button
                                    onClick={() => onAnalyze && onAnalyze(pos)}
                                    className="text-xs bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 px-2 py-1 rounded font-bold"
                                    title="AI Analysis"
                                >
                                    AI
                                </button>
                                <button
                                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
                                    onClick={() => alert("TP/SL Settings coming soon")}
                                >
                                    TP/SL
                                </button>
                                <button
                                    onClick={() => onClose && onClose(pos)}
                                    className="text-xs bg-red-500/20 hover:bg-red-500/40 text-red-500 px-2 py-1 rounded font-bold"
                                >
                                    Close
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
