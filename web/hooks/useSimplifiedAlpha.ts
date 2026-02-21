"use client";
import { useMemo } from 'react';
export interface SimplifiedSignalData {
    symbol: string;
    signal: 'BUY' | 'SELL' | 'WAIT';
    entry_price: number;
    stop_loss: number;
    target_price: number;
    risk_reward_ratio: number;
    confidence: number;
    timeframe: 'intraday' | 'swing' | 'position';
    reasoning: string;
    source: 'technical' | 'conviction' | 'hybrid';
    timestamp: number;
}
import { useAlphaStore } from '@/store/useAlphaStore';

export const useSimplifiedAlpha = (symbol: string) => {
    // Derive signal directly from store - no local state, no useEffect
    const conviction = useAlphaStore((s) => s.convictions[symbol?.toUpperCase()]);

    const signal = useMemo(() => {
        if (!symbol || !conviction) {
            return {
                symbol: symbol || 'BTC',
                signal: 'WAIT' as const,
                entry_price: 0,
                stop_loss: 0,
                target_price: 0,
                risk_reward_ratio: 0,
                confidence: 0,
                timeframe: 'intraday' as const,
                reasoning: 'No signal available',
                source: 'conviction' as const,
                timestamp: 0,
            };
        }

        return {
            symbol: conviction.symbol || symbol,
            signal: conviction.bias === 'LONG' ? 'BUY' as const : conviction.bias === 'SHORT' ? 'SELL' as const : 'WAIT' as const,
            entry_price: conviction.score || 0,
            stop_loss: 0,
            target_price: 0,
            risk_reward_ratio: 0,
            confidence: Math.round((conviction.score || 50) * 0.5 + 30),
            timeframe: 'intraday' as const,
            reasoning: conviction.explanation?.join('. ') || 'No reasoning available',
            source: 'conviction' as const,
            // eslint-disable-next-line react-hooks/purity
            timestamp: conviction.timestamp || Date.now(),
        };
    }, [symbol, conviction]);

    return {
        signal,
        loading: false,
        error: null,
        mode: 'conviction' as const,
        setMode: () => { },
        refresh: () => { },
    };
};

export const useBatchSimplifiedAlpha = (symbols: string[], _mode: 'simplified' | 'conviction' = 'conviction') => {
    const convictions = useAlphaStore((s) => s.convictions);

    const signals = useMemo(() => {
        const result: Record<string, SimplifiedSignalData> = {};
        if (!symbols?.length) return result;

        symbols.forEach(sym => {
            const conv = convictions[sym?.toUpperCase()];
            if (conv) {
                result[sym.toUpperCase()] = {
                    symbol: conv.symbol || sym,
                    signal: conv.bias === 'LONG' ? 'BUY' as const : conv.bias === 'SHORT' ? 'SELL' as const : 'WAIT' as const,
                    entry_price: conv.score || 50,
                    stop_loss: 0,
                    target_price: 0,
                    risk_reward_ratio: 0,
                    confidence: Math.round((conv.score || 50) * 0.5 + 30),
                    timeframe: 'intraday' as const,
                    reasoning: conv.explanation?.join('. ') || 'No reasoning',
                    source: 'conviction' as const,
                    // eslint-disable-next-line react-hooks/purity
                    timestamp: conv.timestamp || Date.now(),
                };
            }
        });

        return result;
    }, [symbols, convictions]);

    return {
        signals,
        loading: false,
        error: null,
        refresh: () => { }
    };
};
