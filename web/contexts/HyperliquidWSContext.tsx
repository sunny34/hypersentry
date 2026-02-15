'use client';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getWsUrl } from '@/lib/constants';

type WSStatus = 'connecting' | 'connected' | 'disconnected';
type WSListener = (data: unknown) => void;

interface LiquidationEvent {
    coin: string;
    side: 'B' | 'S';
    sz: string;
    px: string;
    time: number;
    id: string;
}

interface HyperliquidWSContextType {
    status: WSStatus;
    subscribe: (msg: unknown) => void;
    addListener: (channel: string, callback: WSListener) => () => void;
    liquidations: LiquidationEvent[];
}

const HyperliquidWSContext = createContext<HyperliquidWSContextType | null>(null);

const MAX_SEEN_KEYS = 4000;
const MAX_LIQUIDATIONS = 200;

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
    const [liquidations, setLiquidations] = useState<LiquidationEvent[]>([]);
    const listeners = useRef<Map<string, Set<WSListener>>>(new Map());
    const subscribedSymbols = useRef<Set<string>>(new Set());
    const genericDemand = useRef(false);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connectRef = useRef<() => void>(() => {});
    const hiddenRef = useRef(false);
    const seenTradesRef = useRef<Map<string, SeenState>>(new Map());
    const seenLiqRef = useRef<Map<string, SeenState>>(new Map());

    const emit = useCallback((channel: string, payload: unknown) => {
        if (!channel) return;
        listeners.current.get(channel)?.forEach((cb) => cb(payload));
    }, []);

    const hasDemand = useCallback(() => {
        if (subscribedSymbols.current.size > 0) return true;
        if (genericDemand.current) return true;
        for (const callbacks of listeners.current.values()) {
            if (callbacks.size > 0) return true;
        }
        return false;
    }, []);

    const disconnect = useCallback(() => {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        if (ws.current) {
            ws.current.onopen = null;
            ws.current.onclose = null;
            ws.current.onerror = null;
            ws.current.onmessage = null;
            ws.current.close();
            ws.current = null;
        }
        setStatus('disconnected');
    }, []);

    const scheduleReconnect = useCallback(() => {
        if (hiddenRef.current || !hasDemand()) return;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => {
            connectRef.current();
        }, 10_000);
    }, [hasDemand]);

    const connect = useCallback(() => {
        if (typeof document !== 'undefined') {
            hiddenRef.current = document.visibilityState !== 'visible';
        }
        if (hiddenRef.current || !hasDemand()) {
            return;
        }
        if (ws.current?.readyState === WebSocket.CONNECTING || ws.current?.readyState === WebSocket.OPEN) return;

        console.log('🔌 App WS: Connecting...');
        setStatus('connecting');

        try {
            const socket = new WebSocket(getWsUrl());
            ws.current = socket;

            socket.onopen = () => {
                console.log('✅ App WS: Connected');
                setStatus('connected');
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

                subscribedSymbols.current.forEach((coin) => {
                    try {
                        socket.send(JSON.stringify({ type: 'subscribe', coin }));
                    } catch {
                        // Ignore transient send errors.
                    }
                });
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data) as { type?: string; data?: unknown };
                    if (!message?.type) return;

                    if (message.type === 'agg_update' && message.data && typeof message.data === 'object') {
                        const updates = message.data as Record<string, any>;
                        const newLiquidations: LiquidationEvent[] = [];

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
                                liqs.forEach((liq) => {
                                    const ts = typeof liq?.time === 'number' ? liq.time : Date.now();
                                    const px = String(liq?.px ?? '');
                                    const sz = String(liq?.sz ?? '');
                                    const rawSide = String(liq?.side ?? '').toUpperCase();
                                    const side: 'B' | 'S' = (rawSide === 'S' || rawSide === 'SHORT') ? 'S' : 'B';
                                    newLiquidations.push({
                                        coin,
                                        side,
                                        sz,
                                        px,
                                        time: ts,
                                        id: `${coin}-${ts}-${px}-${sz}-${side}`,
                                    });
                                });
                            }
                        });

                        if (newLiquidations.length > 0) {
                            setLiquidations((prev) => {
                                const merged = [...newLiquidations, ...prev];
                                const unique = Array.from(new Map(merged.map((l) => [l.id, l])).values());
                                return unique.slice(0, MAX_LIQUIDATIONS);
                            });
                        }
                        return;
                    }

                    emit(message.type, message.data);
                } catch {
                    // Ignore malformed websocket frames.
                }
            };

            socket.onclose = ({ code }) => {
                console.warn(`❌ App WS: Disconnected (Code: ${code})`);
                setStatus('disconnected');
                ws.current = null;
                if (!hiddenRef.current && hasDemand()) {
                    scheduleReconnect();
                }
            };

            socket.onerror = () => {
                console.warn('⚠️ App WS: Socket transport issue.');
                // handled by onclose
            };
        } catch (e) {
            console.error('❌ App WS: Fatal Setup Error', e);
            scheduleReconnect();
        }
    }, [emit, hasDemand, scheduleReconnect]);

    useEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    useEffect(() => {
        if (typeof document !== 'undefined') {
            hiddenRef.current = document.visibilityState !== 'visible';
        }
        const onVisibility = () => {
            hiddenRef.current = document.visibilityState !== 'visible';
            if (hiddenRef.current) {
                disconnect();
                return;
            }
            if (hasDemand()) {
                connectRef.current();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            disconnect();
        };
    }, [disconnect, hasDemand]);

    const subscribe = useCallback((sub: unknown) => {
        const coin = normalizeCoin((sub as { coin?: unknown })?.coin);
        if (!coin) {
            genericDemand.current = true;
            connectRef.current();
            return;
        }
        subscribedSymbols.current.add(coin);
        connectRef.current();
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ type: 'subscribe', coin }));
        }
    }, []);

    const addListener = useCallback((channel: string, callback: WSListener) => {
        if (!listeners.current.has(channel)) {
            listeners.current.set(channel, new Set());
        }
        listeners.current.get(channel)!.add(callback);
        connectRef.current();

        return () => {
            const channelListeners = listeners.current.get(channel);
            if (channelListeners) {
                channelListeners.delete(callback);
                if (channelListeners.size === 0) listeners.current.delete(channel);
            }
            if (!hasDemand()) {
                disconnect();
            }
        };
    }, [disconnect, hasDemand]);

    return (
        <HyperliquidWSContext.Provider value={{ status, subscribe, addListener, liquidations }}>
            {children}
        </HyperliquidWSContext.Provider>
    );
}

export function useHyperliquidWS() {
    const context = useContext(HyperliquidWSContext);
    if (!context) throw new Error('useHyperliquidWS must be used within a HyperliquidWSProvider');
    return context;
}
