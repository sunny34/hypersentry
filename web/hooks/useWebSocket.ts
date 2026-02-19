import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useWebSocket Hook
 * 
 * Manages institutional-grade WebSocket connections with automatic normalization
 * and robust reconnection logic.
 */
interface WSMessage {
    type?: string;
    data?: unknown;
    [key: string]: unknown;
}

export const useWebSocket = (url: string, onMessage?: (data: unknown) => void) => {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
    const ws = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hiddenRef = useRef(false);
    const onMessageRef = useRef(onMessage);
    const connectRef = useRef<() => void>(() => {});

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    const scheduleReconnect = useCallback(() => {
        if (hiddenRef.current) return;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => {
            connectRef.current();
        }, 5000);
    }, []);

    const connect = useCallback(() => {
        if (typeof document !== 'undefined') {
            hiddenRef.current = document.visibilityState !== 'visible';
        }
        if (hiddenRef.current) {
            return;
        }

        // Normalize URL
        let targetUrl = url;
        if (typeof window !== 'undefined') {
            const host = window.location.hostname;
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

            // If it's a relative URL like "/ws", prepend host/protocol
            if (targetUrl.startsWith('/')) {
                const port = window.location.port ? `:${window.location.port}` : '';
                targetUrl = `${protocol}//${host}${port}${targetUrl}`;
            } else if (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
                targetUrl = targetUrl.replace('localhost', host).replace('127.0.0.1', host);
                // Ensure protocol matches current security context if not specified
                if (!targetUrl.startsWith('ws')) {
                    targetUrl = `${protocol}//${targetUrl}`;
                }
            }
        }

        if (ws.current) {
            try {
                ws.current.onopen = null;
                ws.current.onclose = null;
                ws.current.onerror = null;
                ws.current.onmessage = null;
                ws.current.close();
            } catch {
                // Ignore close errors during reconnect.
            }
            ws.current = null;
        }

        try {
            const socket = new WebSocket(targetUrl);
            ws.current = socket;

            socket.onopen = () => {
                setIsConnected(true);
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                // If URL has token param, send auth + subscribe_private
                if (targetUrl.includes('token=')) {
                    const token = new URL(targetUrl).searchParams.get('token');
                    if (token) {
                        socket.send(JSON.stringify({ type: 'auth', token }));
                    }
                }
            };

            socket.onclose = (event) => {
                void event;
                setIsConnected(false);
                ws.current = null;
                if (!hiddenRef.current) {
                    scheduleReconnect();
                }
            };

            socket.onerror = () => {
                // handled by onclose
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data) as WSMessage;
                    if (onMessageRef.current) onMessageRef.current(data);
                    setLastMessage(data);
                } catch {
                    if (onMessageRef.current) onMessageRef.current(event.data);
                    setLastMessage({ data: event.data });
                }
            };
        } catch {
            scheduleReconnect();
        }
    }, [url, scheduleReconnect]);

    useEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    useEffect(() => {
        if (typeof document !== 'undefined') {
            hiddenRef.current = document.visibilityState !== 'visible';
        }
        if (!hiddenRef.current) {
            connect();
        }

        const onVisibility = () => {
            const hidden = document.visibilityState !== 'visible';
            hiddenRef.current = hidden;
            if (hidden) {
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                if (ws.current) {
                    ws.current.onopen = null;
                    ws.current.onclose = null;
                    ws.current.onerror = null;
                    ws.current.onmessage = null;
                    ws.current.close();
                    ws.current = null;
                }
                setIsConnected(false);
                return;
            }
            connectRef.current();
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (ws.current) {
                ws.current.onopen = null;
                ws.current.onclose = null;
                ws.current.onerror = null;
                ws.current.onmessage = null;
                ws.current.close();
                ws.current = null;
            }
        };
    }, [connect]);

    const sendMessage = useCallback((msg: unknown) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } else {
            console.warn('⚠️ WebSocket: Cannot send message, socket not open');
        }
    }, []);

    return { isConnected, lastMessage, sendMessage };
};
