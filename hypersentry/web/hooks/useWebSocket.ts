import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useWebSocket Hook
 * 
 * Manages institutional-grade WebSocket connections with automatic normalization
 * and robust reconnection logic.
 */
export const useWebSocket = (url: string, onMessage?: (data: any) => void) => {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<any>(null);
    const ws = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
    const onMessageRef = useRef(onMessage);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    const connect = useCallback(() => {
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
            } catch (e) { }
            ws.current = null;
        }

        try {
            const socket = new WebSocket(targetUrl);
            ws.current = socket;

            socket.onopen = () => {
                setIsConnected(true);
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            };

            socket.onclose = (event) => {
                setIsConnected(false);
                ws.current = null;
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                reconnectTimer.current = setTimeout(connect, 5000);
            };

            socket.onerror = () => {
                // handled by onclose
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (onMessageRef.current) onMessageRef.current(data);
                    setLastMessage(data);
                } catch (e) {
                    if (onMessageRef.current) onMessageRef.current(event.data);
                    setLastMessage(event.data);
                }
            };
        } catch {
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            reconnectTimer.current = setTimeout(connect, 5000);
        }
    }, [url]);

    useEffect(() => {
        connect();
        return () => {
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

    const sendMessage = useCallback((msg: any) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } else {
            console.warn('⚠️ WebSocket: Cannot send message, socket not open');
        }
    }, []);

    return { isConnected, lastMessage, sendMessage };
};
