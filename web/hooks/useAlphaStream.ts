import { useEffect, useRef } from 'react';
import { useAlphaStore } from '../store/useAlphaStore';
import { useMarketStore } from '../store/useMarketStore';
import { getWsUrl } from '@/lib/constants';

const FALLBACK_SYMBOLS = ['BTC', 'ETH', 'SOL'];

const fetchDefaultSymbols = async (): Promise<string[]> => {
    try {
        const res = await fetch('/aggregator/symbols?mode=default&limit=25');
        if (!res.ok) return FALLBACK_SYMBOLS;
        const data = await res.json();
        const symbols = Array.isArray(data?.symbols)
            ? data.symbols.map((s: unknown) => String(s || '').toUpperCase()).filter((s: string) => /^[A-Z0-9]{1,20}$/.test(s))
            : [];
        return symbols.length > 0 ? Array.from(new Set(symbols)) : FALLBACK_SYMBOLS;
    } catch {
        return FALLBACK_SYMBOLS;
    }
};

export const useAlphaStream = () => {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const subscribeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lagTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const planLogRef = useRef<Record<string, string>>({});
    const reconnectCountRef = useRef(0);

    // Get the actual store state, not the getter function
    const alphaStore = useAlphaStore();
    const marketStore = useMarketStore();

    useEffect(() => {
        let cancelled = false;

        const clearLagTimer = () => {
            if (lagTimerRef.current) {
                clearInterval(lagTimerRef.current);
                lagTimerRef.current = null;
            }
        };

        const startLagTimer = () => {
            clearLagTimer();
            lagTimerRef.current = setInterval(() => {
                const stream = useAlphaStore.getState().stream;
                if (!stream.connected || stream.lastMessageAt === null) return;

                const lag = Date.now() - stream.lastMessageAt;
                if (lag > 10_000) {
                    if (stream.status !== 'stale') useAlphaStore.getState().setStreamState({ status: 'stale' });
                    return;
                }
                if (lag > 4_000) {
                    if (stream.status !== 'degraded') useAlphaStore.getState().setStreamState({ status: 'degraded' });
                    return;
                }
                if (stream.status !== 'live') {
                    useAlphaStore.getState().setStreamState({ status: 'live' });
                }
            }, 1000);
        };

        const connect = () => {
            if (cancelled) return;
            
            const s = useAlphaStore.getState();
            const ms = useMarketStore.getState();
            
            const url = getWsUrl();
            const ws = new WebSocket(url);
            wsRef.current = ws;
            
            s.setStreamState({
                connected: false,
                status: reconnectCountRef.current > 0 ? 'degraded' : 'connecting',
                error: null
            });

            ws.onopen = () => {
                reconnectCountRef.current = 0;
                s.setStreamState({
                    connected: true,
                    status: 'live',
                    lastConnectedAt: Date.now(),
                    lastMessageAt: null,
                    reconnectCount: 0,
                    error: null
                });
                startLagTimer();
                s.addLog({ type: 'SYSTEM', message: 'Intelligence Stream Connected' });

                subscribeTimerRef.current = setTimeout(async () => {
                    if (cancelled) return;
                    const subscribe = (coin: string) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'subscribe', coin }));
                            s.addLog({ type: 'SYSTEM', message: `Subscribed to ${coin}` });
                        }
                    };
                    const symbols = await fetchDefaultSymbols();
                    symbols.forEach(subscribe);
                }, 500);
            };

            ws.onmessage = (event) => {
                s.setStreamState({ lastMessageAt: Date.now(), status: 'live', connected: true });
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'agg_update') {
                        ms.updateFromAggregator(msg.data);
                    }
                    if (msg.type === 'alpha_conviction') {
                        s.setConviction(msg.data.symbol, msg.data);
                    }
                    if (msg.type === 'gov_update') {
                        s.setGovernance(msg.data.symbol, msg.data);
                    }
                    if (msg.type === 'risk_update') {
                        s.setRisk(msg.data.symbol, msg.data);
                    }
                    if (msg.type === 'exec_plan') {
                        s.setExecutionPlan(msg.data.symbol, msg.data);
                        const symbol = String(msg.data.symbol || '').toUpperCase();
                        const fingerprint = [
                            msg.data.direction || 'NA',
                            msg.data.strategy || 'NA',
                            Math.round(Number(msg.data.total_size_usd || 0)),
                            Math.round(Number(msg.data.urgency_score || 0) * 100),
                        ].join(':');
                        if (symbol && planLogRef.current[symbol] !== fingerprint) {
                            planLogRef.current[symbol] = fingerprint;
                            s.addLog({
                                type: 'PLAN',
                                message: `New plan for ${symbol}: ${msg.data.strategy} sizing $${Math.round(msg.data.total_size_usd)}`
                            });
                        }
                    }
                    if (msg.type === 'log') {
                        s.addLog({ type: msg.data.type, message: msg.data.message });
                    }
                } catch (err) {
                    console.error('WS message parse error:', err);
                    useAlphaStore.getState().setStreamState({ status: 'degraded', error: 'parse_error' });
                }
            };

            ws.onclose = () => {
                if (cancelled) return;
                clearLagTimer();
                if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = setTimeout(connect, 3000);
                s.setStreamState({
                    connected: false,
                    status: 'disconnected',
                    reconnectCount: reconnectCountRef.current
                });
                s.addLog({ type: 'SYSTEM', message: 'Stream Disconnected. Reconnecting...' });
            };

            ws.onerror = () => {
                clearLagTimer();
                s.setStreamState({
                    connected: false,
                    status: 'degraded',
                    error: 'socket_error'
                });
                s.addLog({ type: 'SYSTEM', message: 'Stream transport issue. Reconnecting...' });
                ws.close();
            };
        };

        connect();
        
        return () => {
            cancelled = true;
            clearLagTimer();
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (subscribeTimerRef.current) clearTimeout(subscribeTimerRef.current);
            useAlphaStore.getState().setStreamState({ connected: false, status: 'disconnected' });
            wsRef.current?.close();
        };
    }, []);
};
