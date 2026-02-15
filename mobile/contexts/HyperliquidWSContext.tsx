import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

type WSStatus = 'connecting' | 'connected' | 'disconnected';

interface HyperliquidWSContextType {
    status: WSStatus;
    subscribe: (msg: any) => void;
    addListener: (channel: string, callback: (data: any) => void) => () => void;
}

const HyperliquidWSContext = createContext<HyperliquidWSContextType | null>(null);

const WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:8000/ws';
const MAX_SEEN_KEYS = 2500;

type SeenState = {
    set: Set<string>;
    order: string[];
};

const normalizeCoin = (value: unknown): string | null => {
    const coin = String(value || '').trim().toUpperCase();
    return /^[A-Z0-9]{1,20}$/.test(coin) ? coin : null;
};

const buildKey = (coin: string, item: any) =>
    `${coin}|${String(item?.time ?? '')}|${String(item?.px ?? '')}|${String(item?.sz ?? '')}|${String(item?.side ?? '')}|${String(item?.id ?? '')}`;

const getSeenState = (map: Map<string, SeenState>, coin: string): SeenState => {
    const current = map.get(coin);
    if (current) return current;
    const created = { set: new Set<string>(), order: [] };
    map.set(coin, created);
    return created;
};

const collectNewByKey = (
    map: Map<string, SeenState>,
    coin: string,
    rows: any[],
): any[] => {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const state = getSeenState(map, coin);
    const out: any[] = [];
    for (const row of rows) {
        const key = buildKey(coin, row);
        if (state.set.has(key)) continue;
        state.set.add(key);
        state.order.push(key);
        out.push(row);
    }
    if (state.order.length > MAX_SEEN_KEYS) {
        const overflow = state.order.length - MAX_SEEN_KEYS;
        for (let i = 0; i < overflow; i += 1) {
            const stale = state.order.shift();
            if (stale) state.set.delete(stale);
        }
    }
    return out;
};

export function HyperliquidWSProvider({ children }: { children: React.ReactNode }) {
    const ws = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<WSStatus>('disconnected');
    const listeners = useRef<Map<string, Set<(data: any) => void>>>(new Map());
    const subscribedSymbols = useRef<Set<string>>(new Set());
    const genericDemand = useRef(false);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seenTradesRef = useRef<Map<string, SeenState>>(new Map());
    const seenLiqRef = useRef<Map<string, SeenState>>(new Map());

    const emit = useCallback((channel: string, payload: unknown) => {
        if (!channel) return;
        listeners.current.get(channel)?.forEach((cb) => cb(payload));
    }, []);

    const connect = useCallback(() => {
        if (!genericDemand.current && subscribedSymbols.current.size === 0 && listeners.current.size === 0) return;
        if (ws.current?.readyState === 0 || ws.current?.readyState === 1) return;

        console.log('🔌 Mobile App WS: Connecting...');
        setStatus('connecting');

        try {
            const socket = new WebSocket(WS_URL);
            ws.current = socket;

            socket.onopen = () => {
                console.log('✅ Mobile App WS: Connected');
                setStatus('connected');
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

                subscribedSymbols.current.forEach((coin) => {
                    try { socket.send(JSON.stringify({ type: 'subscribe', coin })); } catch (e) { }
                });
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data) as { type?: string; data?: unknown };
                    if (!message?.type) return;

                    if (message.type === 'agg_update' && message.data && typeof message.data === 'object') {
                        const updates = message.data as Record<string, any>;
                        Object.entries(updates).forEach(([rawCoin, snapshot]) => {
                            const coin = normalizeCoin(rawCoin);
                            if (!coin || !snapshot || typeof snapshot !== 'object') return;

                            const book = snapshot.book;
                            if (Array.isArray(book) && book.length >= 2) {
                                emit('l2Book', { coin, levels: book });
                            }

                            const trades = collectNewByKey(seenTradesRef.current, coin, snapshot.trades || []);
                            if (trades.length > 0) {
                                emit('trades', trades);
                            }

                            const liqs = collectNewByKey(seenLiqRef.current, coin, snapshot.liquidations || []);
                            if (liqs.length > 0) {
                                emit('liquidations', liqs);
                            }
                        });
                        return;
                    }

                    emit(message.type, message.data);
                } catch (e) { }
            };

            socket.onclose = () => {
                console.warn('❌ Mobile App WS: Disconnected');
                setStatus('disconnected');
                ws.current = null;
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                reconnectTimer.current = setTimeout(connect, 5000);
            };

            socket.onerror = (err) => {
                console.error('⚠️ Mobile App WS Error', err);
            };
        } catch (e) {
            console.error('❌ Mobile App WS Setup Error', e);
            reconnectTimer.current = setTimeout(connect, 5000);
        }
    }, []);

    useEffect(() => {
        connect();
        return () => {
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }
        };
    }, [connect]);

    const subscribe = useCallback((sub: any) => {
        const coin = normalizeCoin(sub?.coin);
        if (coin) {
            subscribedSymbols.current.add(coin);
        } else {
            genericDemand.current = true;
        }
        connect();
        if (ws.current?.readyState === 1) {
            if (coin) {
                ws.current.send(JSON.stringify({ type: 'subscribe', coin }));
            }
        }
    }, [connect]);

    const addListener = useCallback((channel: string, callback: (data: any) => void) => {
        if (!listeners.current.has(channel)) {
            listeners.current.set(channel, new Set());
        }
        listeners.current.get(channel)!.add(callback);

        return () => {
            const channelListeners = listeners.current.get(channel);
            if (channelListeners) {
                channelListeners.delete(callback);
                if (channelListeners.size === 0) listeners.current.delete(channel);
            }
        };
    }, []);

    return (
        <HyperliquidWSContext.Provider value={{ status, subscribe, addListener }}>
            {children}
        </HyperliquidWSContext.Provider>
    );
}

export function useHyperliquidWS() {
    const context = useContext(HyperliquidWSContext);
    if (!context) throw new Error('useHyperliquidWS must be used within a HyperliquidWSProvider');
    return context;
}
