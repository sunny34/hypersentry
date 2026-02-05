import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useWebSocket Hook
 * 
 * Manages institutional-grade WebSocket connections with automatic normalization
 * and robust reconnection logic.
 */
export const useWebSocket = (url: string) => {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<any>(null);
    const ws = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<NodeJS.Timeout | null>(null);

    const connect = useCallback(() => {
        // Normalize URL
        let targetUrl = url;
        if (typeof window !== 'undefined') {
            // Avoid mixed localhost/127.0.0.1 which can cause State 3 failures in some browsers
            if (targetUrl.includes('localhost') && window.location.hostname !== 'localhost') {
                targetUrl = targetUrl.replace('localhost', window.location.hostname);
            } else if (targetUrl.includes('127.0.0.1') && window.location.hostname === 'localhost') {
                targetUrl = targetUrl.replace('127.0.0.1', 'localhost');
            }
        }

        console.log('🔌 WebSocket: Initializing connection to', targetUrl);

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
                console.log('✅ WebSocket: Connection established to', targetUrl);
                setIsConnected(true);
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            };

            socket.onclose = (event) => {
                console.warn(`❌ WebSocket: Connection closed (Code: ${event.code}, Reason: ${event.reason || 'none'})`);
                setIsConnected(false);
                ws.current = null;

                // Exponential backoff or static retry
                if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                reconnectTimer.current = setTimeout(connect, 5000);
            };

            socket.onerror = (err) => {
                console.error(`⚠️ WebSocket Error: State ${socket.readyState} | URL: ${targetUrl}`);
                // Non-verbose error, handled by onclose
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    setLastMessage(data);
                } catch (e) {
                    setLastMessage(event.data);
                }
            };
        } catch (e) {
            console.error('❌ WebSocket Setup Fatal Error:', e);
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
