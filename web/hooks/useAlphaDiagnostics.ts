"use client";

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/constants';

export interface AlphaDiagnostics {
    symbol: string;
    timestamp: number;
    collective_score: number;
    collective_raw: number;
    collective_bias: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidence: number;
    reasoning: string[];
    components: Record<string, {
        label: string;
        score: number;
        weight: number;
        contribution: number;
        reason: string;
    }>;
    metrics: {
        price?: number;
        spread_bps?: number;
        funding_rate?: number;
        open_interest_source?: string;
        cvd_spot_composite_1m?: number;
        cvd_spot_binance_1m?: number;
        cvd_spot_coinbase_1m?: number;
        cvd_spot_okx_1m?: number;
        orderbook_imbalance_signed?: number;
        orderbook_imbalance_ratio?: number;
        wall_count?: number;
        top_wall?: { side?: string; px?: string; score?: number } | null;
    };
}

interface AlphaDiagnosticsState {
    data: AlphaDiagnostics | null;
    loading: boolean;
    error: string | null;
}

export const useAlphaDiagnostics = (symbol: string, pollMs: number = 2500): AlphaDiagnosticsState => {
    const [data, setData] = useState<AlphaDiagnostics | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const target = String(symbol || '').toUpperCase();
        if (!target) {
            setData(null);
            setLoading(false);
            setError('missing_symbol');
            return () => { };
        }

        const fetchDiag = async () => {
            try {
                const resp = await fetch(`${API_URL}/alpha/diag/${target}`, { cache: 'no-store' });
                if (!resp.ok) {
                    throw new Error(`diag_${resp.status}`);
                }
                const payload = await resp.json();
                if (!cancelled) {
                    setData(payload as AlphaDiagnostics);
                    setError(null);
                    setLoading(false);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(String(err));
                    setLoading(false);
                }
            }
        };

        setLoading(true);
        fetchDiag();
        timer = setInterval(fetchDiag, Math.max(1000, pollMs));

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
        };
    }, [symbol, pollMs]);

    return { data, loading, error };
};

