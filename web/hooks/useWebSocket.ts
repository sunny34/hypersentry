import { useEffect, useRef, useState, useCallback } from 'react';

export const useWebSocket = (url: string) => {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<any>(null);
    const ws = useRef<WebSocket | null>(null);

    useEffect(() => {
        // Use 127.0.0.1 to match HTTP behavior and avoid localhost ipv6 issues
        const targetUrl = url;
        console.log('🔌 Connecting to WS:', targetUrl);

        let isUnmounted = false;

        const connect = () => {
            if (isUnmounted) return;

            // Close existing if any (shouldn't happen due to cleanup but safe check)
            if (ws.current) {
                ws.current.close();
            }

            try {
                const socket = new WebSocket(targetUrl);
                ws.current = socket;

                socket.onopen = () => {
                    if (isUnmounted) {
                        socket.close();
                        return;
                    }
                    console.log('✅ WS Connected');
                    setIsConnected(true);
                };

                socket.onclose = (event) => {
                    if (isUnmounted) return;
                    console.log(`❌ WS Disconnected (Code: ${event.code}, Reason: ${event.reason})`);
                    setIsConnected(false);
                    ws.current = null;

                    // Reconnect after 3s
                    setTimeout(() => {
                        if (!isUnmounted) connect();
                    }, 3000);
                };

                socket.onerror = (err) => {
                    console.error('⚠️ WS Error Status:', socket.readyState);
                    setLastMessage({ type: 'error', message: 'WebSocket connection failed' });
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
                console.error("WS Setup Error:", e);
                // Retry if setup fails
                setTimeout(() => {
                    if (!isUnmounted) connect();
                }, 5000);
            }
        };

        connect();

        return () => {
            isUnmounted = true;
            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }
        };
    }, [url]);

    const sendMessage = useCallback((msg: any) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(msg));
        }
    }, []);

    return { isConnected, lastMessage, sendMessage };
};
