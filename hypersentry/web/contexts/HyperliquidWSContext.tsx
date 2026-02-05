'use client';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

type WSStatus = 'connecting' | 'connected' | 'disconnected';

interface HyperliquidWSContextType {
    status: WSStatus;
    subscribe: (msg: any) => void;
    addListener: (channel: string, callback: (data: any) => void) => () => void;
    liquidations: any[];
}

const HyperliquidWSContext = createContext<HyperliquidWSContextType | null>(null);

const WS_URL = 'wss://api.hyperliquid.xyz/ws';

export function HyperliquidWSProvider({ children }: { children: React.ReactNode }) {
    const ws = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<WSStatus>('disconnected');
    const [liquidations, setLiquidations] = useState<any[]>([]);
    const listeners = useRef<Map<string, Set<(data: any) => void>>>(new Map());
    const pendingSubscriptions = useRef<Set<string>>(new Set([
        JSON.stringify({ method: 'subscribe', subscription: { type: 'liquidations' } })
    ]));
    const reconnectTimer = useRef<NodeJS.Timeout | null>(null);

    const connect = useCallback(() => {
        if (ws.current?.readyState === WebSocket.CONNECTING || ws.current?.readyState === WebSocket.OPEN) return;

        console.log('🔌 HL Global WS: Connecting...');
        setStatus('connecting');

        try {
            const socket = new WebSocket(WS_URL);
            ws.current = socket;

            socket.onopen = () => {
                console.log('✅ HL Global WS: Connected');
                setStatus('connected');
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

                // Small delay for initial global subs
                setTimeout(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        pendingSubscriptions.current.forEach(subStr => {
                            try { socket.send(subStr); } catch (e) { }
                        });
                    }
                }, 1000);
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    const channel = message.channel;

                    if (channel === 'liquidations') {
                        const data = message.data;
                        const updates = Array.isArray(data) ? data : (data?.liquidations || [data]);
                        const newLiqs: any[] = [];

                        updates.forEach((item: any) => {
                            const liq = item.liq || item;
                            if (liq && liq.coin) {
                                newLiqs.push({
                                    coin: liq.coin,
                                    side: liq.side,
                                    sz: liq.sz,
                                    px: liq.px,
                                    time: liq.time || Date.now(),
                                    id: `${liq.coin}-${liq.time}-${Math.random()}`
                                });
                            }
                        });

                        if (newLiqs.length > 0) {
                            setLiquidations(prev => {
                                const combined = [...newLiqs, ...prev];
                                const unique = Array.from(new Map(combined.map(l => [l.id, l])).values());
                                return unique.slice(0, 100);
                            });
                        }
                    }

                    if (channel && listeners.current.has(channel)) {
                        listeners.current.get(channel)?.forEach(cb => cb(message.data));
                    }
                } catch (e) { }
            };

            socket.onclose = (event) => {
                console.warn(`❌ HL Global WS: Disconnected (Code: ${event.code}) - Region blocking likely if status 1006`);
                setStatus('disconnected');
                ws.current = null;
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                reconnectTimer.current = setTimeout(connect, 10000); // 10s retry for global
            };

            socket.onerror = (err) => {
                console.error('⚠️ HL Global WS: Socket Error. VPN/Region check required.');
                // handled by onclose
            };
        } catch (e) {
            console.error('❌ HL Global WS: Fatal Setup Error', e);
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            reconnectTimer.current = setTimeout(connect, 10000);
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
        const subStr = JSON.stringify({ method: 'subscribe', subscription: sub });
        pendingSubscriptions.current.add(subStr);
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(subStr);
        }
    }, []);

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
