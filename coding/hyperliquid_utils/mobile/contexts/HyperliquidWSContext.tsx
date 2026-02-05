import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

type WSStatus = 'connecting' | 'connected' | 'disconnected';

interface HyperliquidWSContextType {
    status: WSStatus;
    subscribe: (msg: any) => void;
    addListener: (channel: string, callback: (data: any) => void) => () => void;
}

const HyperliquidWSContext = createContext<HyperliquidWSContextType | null>(null);

const WS_URL = 'wss://api.hyperliquid.xyz/ws';

export function HyperliquidWSProvider({ children }: { children: React.ReactNode }) {
    const ws = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<WSStatus>('disconnected');
    const listeners = useRef<Map<string, Set<(data: any) => void>>>(new Map());
    const pendingSubscriptions = useRef<Set<string>>(new Set());
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const connect = useCallback(() => {
        if (ws.current?.readyState === 0 || ws.current?.readyState === 1) return;

        console.log('🔌 Mobile HL WS: Connecting...');
        setStatus('connecting');

        try {
            const socket = new WebSocket(WS_URL);
            ws.current = socket;

            socket.onopen = () => {
                console.log('✅ Mobile HL WS: Connected');
                setStatus('connected');
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

                pendingSubscriptions.current.forEach(subStr => {
                    try { socket.send(subStr); } catch (e) { }
                });
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    const channel = message.channel;

                    if (channel && listeners.current.has(channel)) {
                        listeners.current.get(channel)?.forEach(cb => cb(message.data));
                    }
                } catch (e) { }
            };

            socket.onclose = () => {
                console.warn('❌ Mobile HL WS: Disconnected');
                setStatus('disconnected');
                ws.current = null;
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                reconnectTimer.current = setTimeout(connect, 5000);
            };

            socket.onerror = (err) => {
                console.error('⚠️ Mobile HL WS Error', err);
            };
        } catch (e) {
            console.error('❌ Mobile HL WS Setup Error', e);
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
        const subStr = JSON.stringify({ method: 'subscribe', subscription: sub });
        pendingSubscriptions.current.add(subStr);
        if (ws.current?.readyState === 1) {
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
