import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = 'wss://api.hyperliquid.xyz/ws';

export type WsMessage = {
    channel: string;
    data: any;
};

export function useHyperliquidWS() {
    const ws = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const subscribers = useRef<Map<string, (data: any) => void>>(new Map());

    useEffect(() => {
        let reconnectTimeout: NodeJS.Timeout;

        const connect = () => {
            setStatus('connecting');
            const socket = new WebSocket(WS_URL);

            socket.onopen = () => {
                setStatus('connected');
                // Resubscribe to existing channels if any (logic could be added here)
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    const channel = message.channel;

                    // Notify subscribers for this channel
                    if (channel) {
                        // Find subscribers that match or are generic
                        subscribers.current.forEach((callback, key) => {
                            if (key === channel || key === 'all') {
                                callback(message.data);
                            }
                        });
                    }
                } catch (e) {
                    console.error('WS Parse Error:', e);
                }
            };

            socket.onclose = () => {
                setStatus('disconnected');
                reconnectTimeout = setTimeout(connect, 3000); // Auto reconnect
            };

            socket.onerror = (err) => {
                // Squelch errors during connection phase to avoid console spam
                if (socket.readyState !== WebSocket.OPEN) return;
                console.error('WS Error:', err);
                socket.close();
            };

            ws.current = socket;
        };

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            ws.current?.close();
        };
    }, []);

    const subscribe = useCallback((message: any) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
                method: 'subscribe',
                subscription: message
            }));
        } else {
            // Retry mechanism could go here, for now just simple log
            console.warn('WS not open, cannot subscribe', message);
        }
    }, []);

    const addListener = useCallback((channel: string, callback: (data: any) => void) => {
        subscribers.current.set(channel, callback);
        return () => {
            subscribers.current.delete(channel);
        };
    }, []);

    return { status, subscribe, addListener };
}
