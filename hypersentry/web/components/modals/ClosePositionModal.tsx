'use client';
import { useState, useEffect } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

interface Position {
    coin: string;
    size: number;
    value: number;
    entryPrice: number;
    markPrice: number;
    pnl: number;
    roe: number;
    side: 'LONG' | 'SHORT';
    coinIndex?: number;
}

interface ClosePositionModalProps {
    position: Position;
    onClose: () => void;
    onConfirm: (price: number | 'market', size: number) => Promise<void>;
}

export default function ClosePositionModal({ position, onClose, onConfirm }: ClosePositionModalProps) {
    const [closeType, setCloseType] = useState<'market' | 'limit'>('limit');
    const [price, setPrice] = useState<string>(position.markPrice.toString());
    const [size, setSize] = useState<string>(Math.abs(position.size).toString());
    const [percent, setPercent] = useState<number>(100);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Update size based on percentage
    useEffect(() => {
        const fullSize = Math.abs(position.size);
        const newSize = (fullSize * (percent / 100));
        // Round to valid HL precision (usually 1 or 3 depending on asset)
        const rounded = parseFloat(newSize.toFixed(4));
        setSize(rounded.toString());
    }, [percent, position.size]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        try {
            const finalPrice = closeType === 'market' ? 'market' : parseFloat(price);
            const finalSize = parseFloat(size);

            if (isNaN(finalSize) || finalSize <= 0) {
                throw new Error("Invalid size");
            }
            if (closeType === 'limit' && (isNaN(finalPrice as number) || (finalPrice as number) <= 0)) {
                throw new Error("Invalid price");
            }

            await onConfirm(finalPrice, finalSize);
            onClose();
        } catch (e: any) {
            setError(e.message);
            setTimeout(() => setError(null), 10000);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                    <div className="flex items-center gap-2">
                        <div className={`text-xs font-black px-1.5 py-0.5 rounded ${position.side === 'LONG' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                            {position.side}
                        </div>
                        <h3 className="text-lg font-bold text-white">Close {position.coin}</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg transition-colors text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Tabs */}
                    <div className="flex bg-white/5 p-1 rounded-xl">
                        {(['limit', 'market'] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setCloseType(t)}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all capitalize ${closeType === t ? 'bg-white/10 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'
                                    }`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-4">
                        {/* Price Input */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest px-1">Close Price</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="any"
                                    disabled={closeType === 'market'}
                                    value={closeType === 'market' ? '' : price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    placeholder={closeType === 'market' ? 'MARKET' : 'Price'}
                                    className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-[var(--color-primary)] transition-colors ${closeType === 'market' ? 'text-gray-600' : 'text-white'
                                        }`}
                                />
                                {closeType === 'limit' && (
                                    <button
                                        type="button"
                                        onClick={() => setPrice(position.markPrice.toString())}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-primary)] font-bold hover:underline"
                                    >
                                        MARK
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Size Input */}
                        <div className="space-y-1.5">
                            <div className="flex justify-between items-end px-1">
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Size to Close</label>
                                <span className="text-[10px] text-gray-400 font-mono">Max: {Math.abs(position.size)} {position.coin}</span>
                            </div>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="any"
                                    value={size}
                                    onChange={(e) => setSize(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-white focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">{position.coin}</span>
                            </div>
                        </div>

                        {/* Percent Buttons */}
                        <div className="grid grid-cols-4 gap-2">
                            {[25, 50, 75, 100].map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPercent(p)}
                                    className={`py-1.5 text-[10px] font-black rounded-lg border transition-all ${percent === p
                                        ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/30 text-[var(--color-primary)]'
                                        : 'bg-white/5 border-white/5 text-gray-500 hover:text-gray-300'
                                        }`}
                                >
                                    {p}%
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-white/5 rounded-xl p-4 space-y-2 border border-white/5">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Est. PnL</span>
                            <span className={`font-bold font-mono ${position.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {position.pnl >= 0 ? '+' : ''}${((position.pnl / Math.abs(position.size)) * parseFloat(size || '0')).toFixed(2)}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Remaining Size</span>
                            <span className="text-gray-300 font-mono">{(Math.abs(position.size) - parseFloat(size || '0')).toFixed(4)} {position.coin}</span>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-[11px] font-bold animate-in slide-in-from-top-2 duration-300">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Action Button */}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`w-full py-4 rounded-xl font-black uppercase tracking-widest text-sm transition-all shadow-xl flex items-center justify-center gap-2 ${position.side === 'LONG'
                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20'
                            }`}
                    >
                        {isSubmitting ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            `Confirm ${closeType} Close`
                        )}
                    </button>
                    泛
                    <div className="flex items-start gap-2 text-[10px] text-gray-500 bg-white/5 p-3 rounded-lg border border-white/5 leading-relaxed">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <span>Closing this position will cancel any active Safety Guards (TP/SL) for {position.coin} if fully closed.</span>
                    </div>
                </form>
            </div>
        </div>
    );
}
