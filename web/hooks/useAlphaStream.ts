import { useEffect, useRef } from 'react';
import { useAlphaStore } from '../store/useAlphaStore';
import { useMarketStore } from '../store/useMarketStore';
import { getApiUrl, getWsUrl } from '@/lib/constants';

const FALLBACK_SYMBOLS = ['BTC', 'ETH', 'SOL'];

const fetchDefaultSymbols = async (): Promise<string[]> => {
    try {
        const base = getApiUrl();
        const res = await fetch(`${base}/aggregator/symbols?mode=default&limit=25`);
        if (!res.ok) {
            return FALLBACK_SYMBOLS;
        }
        const data = await res.json();
        const symbols = Array.isArray(data?.symbols)
            ? data.symbols
                .map((s: unknown) => String(s || '').toUpperCase())
                .filter((s: string) => /^[A-Z0-9]{1,20}$/.test(s))
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
    const setConviction = useAlphaStore((s) => s.setConviction);
    const setRisk = useAlphaStore((s) => s.setRisk);
    const setGovernance = useAlphaStore((s) => s.setGovernance);
    const setExecutionPlan = useAlphaStore((s) => s.setExecutionPlan);
    const addLog = useAlphaStore((s) => s.addLog);
    const setStreamState = useAlphaStore((s) => s.setStreamState);
    const { updateFromAggregator } = useMarketStore();

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
                const { stream } = useAlphaStore.getState();
                if (!stream.connected || stream.lastMessageAt === null) return;

                const lag = Date.now() - stream.lastMessageAt;
                if (lag > 10_000) {
                    if (stream.status !== 'stale') setStreamState({ status: 'stale' });
                    return;
                }
                if (lag > 4_000) {
                    if (stream.status !== 'degraded') setStreamState({ status: 'degraded' });
                    return;
                }
                if (stream.status !== 'live') {
                    setStreamState({ status: 'live' });
                }
            }, 1000);
        };

        const connect = () => {
            if (cancelled) return;
            const url = getWsUrl();
            const ws = new WebSocket(url);
            wsRef.current = ws;
            setStreamState({
                connected: false,
                status: reconnectCountRef.current > 0 ? 'degraded' : 'connecting',
                error: null
            });

            ws.onopen = () => {
                reconnectCountRef.current = 0;
                setStreamState({
                    connected: true,
                    status: 'live',
                    lastConnectedAt: Date.now(),
                    lastMessageAt: null,
                    reconnectCount: 0,
                    error: null
                });
                startLagTimer();
                addLog({ type: 'SYSTEM', message: 'Intelligence Stream Connected' });

                subscribeTimerRef.current = setTimeout(async () => {
                    if (cancelled) return;
                    const subscribe = (coin: string) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'subscribe', coin }));
                            addLog({ type: 'SYSTEM', message: `Subscribed to ${coin}` });
                        }
                    };

                    const symbols = await fetchDefaultSymbols();
                    symbols.forEach(subscribe);
                }, 500);
            };

            ws.onmessage = (event) => {
                setStreamState({ lastMessageAt: Date.now(), status: 'live', connected: true });
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'agg_update') {
                        updateFromAggregator(msg.data);
                    }

                    if (msg.type === 'alpha_conviction') {
                        setConviction(msg.data.symbol, msg.data);

                        if (msg.data.bias !== 'NEUTRAL' && Math.abs(msg.data.conviction_score) > 0.7) {
                            addLog({
                                type: 'INTEL',
                                message: `High Conviction ${msg.data.bias} on ${msg.data.symbol} (${Math.round(msg.data.conviction_score * 100)})`
                            });
                        }
                    }

                    if (msg.type === 'gov_update') {
                        setGovernance(msg.data.symbol, msg.data);
                    }

                    if (msg.type === 'risk_update') {
                        setRisk(msg.data.symbol, msg.data);
                    }

                    if (msg.type === 'exec_plan') {
                        setExecutionPlan(msg.data.symbol, msg.data);
                        const symbol = String(msg.data.symbol || '').toUpperCase();
                        const fingerprint = [
                            msg.data.direction || 'NA',
                            msg.data.strategy || 'NA',
                            Math.round(Number(msg.data.total_size_usd || 0)),
                            Math.round(Number(msg.data.urgency_score || 0) * 100),
                        ].join(':');
                        if (symbol && planLogRef.current[symbol] !== fingerprint) {
                            planLogRef.current[symbol] = fingerprint;
                            addLog({
                                type: 'PLAN',
                                message: `New plan for ${symbol}: ${msg.data.strategy} sizing $${Math.round(msg.data.total_size_usd)}`
                            });
                        }
                    }

                    if (msg.type === 'log') {
                        addLog({ type: msg.data.type, message: msg.data.message });
                    }

                } catch (e) {
                    console.error('Stream Parse Error:', e);
                    setStreamState({ status: 'degraded', error: 'parse_error' });
                }
            };

            ws.onclose = () => {
                if (cancelled) return;
                clearLagTimer();
                reconnectCountRef.current += 1;
                setStreamState({
                    connected: false,
                    status: 'disconnected',
                    reconnectCount: reconnectCountRef.current
                });
                addLog({ type: 'SYSTEM', message: 'Stream Disconnected. Reconnecting...' });
                reconnectTimerRef.current = setTimeout(connect, 3000);
            };

            ws.onerror = () => {
                clearLagTimer();
                setStreamState({
                    connected: false,
                    status: 'degraded',
                    error: 'socket_error'
                });
                addLog({ type: 'SYSTEM', message: 'Stream transport issue. Reconnecting...' });
                ws.close();
            };
        };

        connect();
        return () => {
            cancelled = true;
            clearLagTimer();
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (subscribeTimerRef.current) clearTimeout(subscribeTimerRef.current);
            setStreamState({ connected: false, status: 'disconnected' });
            wsRef.current?.close();
        };
    }, [addLog, setConviction, setRisk, setExecutionPlan, setGovernance, setStreamState, updateFromAggregator]);
};
