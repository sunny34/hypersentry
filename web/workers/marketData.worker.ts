// Web Worker for handling Market Data & Alpha Engine WebSockets
// This moves JSON parsing and heavy state aggregation OFF the React main thread.

// We need a simple way to track connections and subscriptions
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let lagTimer: number | null = null;
let lastMessageAt: number | null = null;
let isConnected = false;
let reconnectCount = 0;

// To avoid overwhelming the main thread, we batch updates
// and send them every ~50-100ms via requestAnimationFrame timing (or simple interval)
let batchedUpdates: any = {
    type: 'batch_update',
    agg_updates: [],
    alpha_convictions: [],
    gov_updates: [],
    risk_updates: [],
    exec_plans: [],
    logs: []
};

let batchInterval: number | null = null;

const flushBatch = () => {
    // Only send if we have data
    if (
        batchedUpdates.agg_updates.length > 0 ||
        batchedUpdates.alpha_convictions.length > 0 ||
        batchedUpdates.gov_updates.length > 0 ||
        batchedUpdates.risk_updates.length > 0 ||
        batchedUpdates.exec_plans.length > 0 ||
        batchedUpdates.logs.length > 0
    ) {
        postMessage(batchedUpdates);

        // Reset batch
        batchedUpdates = {
            type: 'batch_update',
            agg_updates: [],
            alpha_convictions: [],
            gov_updates: [],
            risk_updates: [],
            exec_plans: [],
            logs: []
        };
    }
};

const startBatching = () => {
    if (!batchInterval) {
        // 100ms = 10 messages per second. Buttery smooth for React without freezing.
        batchInterval = setInterval(flushBatch, 100) as any;
    }
};

const connect = (url: string, symbols: string[]) => {
    if (ws) {
        ws.close();
    }

    postMessage({ type: 'stream_status', status: 'connecting', connected: false });

    ws = new WebSocket(url);

    ws.onopen = () => {
        isConnected = true;
        reconnectCount = 0;
        lastMessageAt = Date.now();

        postMessage({
            type: 'stream_status',
            status: 'live',
            connected: true,
            lastConnectedAt: Date.now()
        });

        // Subscribe to requested symbols
        symbols.forEach(coin => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'subscribe', coin }));
            }
        });

        batchedUpdates.logs.push({ type: 'SYSTEM', message: 'Intelligence Stream Connected [Worker]' });

        // Start lag monitor
        if (lagTimer) clearInterval(lagTimer);
        lagTimer = setInterval(() => {
            if (!isConnected || !lastMessageAt) return;
            const lag = Date.now() - lastMessageAt;
            if (lag > 10000) {
                postMessage({ type: 'stream_status', status: 'stale' });
            } else if (lag > 4000) {
                postMessage({ type: 'stream_status', status: 'degraded' });
            } else {
                postMessage({ type: 'stream_status', status: 'live' });
            }
        }, 1000) as any;

        startBatching();
    };

    ws.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
            // This JSON.parse happens purely on the background thread!
            const msg = JSON.parse(event.data);

            switch (msg.type) {
                case 'agg_update':
                    batchedUpdates.agg_updates.push(msg.data);
                    break;
                case 'alpha_conviction':
                    batchedUpdates.alpha_convictions.push(msg.data);
                    break;
                case 'gov_update':
                    batchedUpdates.gov_updates.push(msg.data);
                    break;
                case 'risk_update':
                    batchedUpdates.risk_updates.push(msg.data);
                    break;
                case 'exec_plan':
                    batchedUpdates.exec_plans.push(msg.data);
                    break;
                case 'log':
                    batchedUpdates.logs.push({ type: msg.data.type, message: msg.data.message });
                    break;
            }
        } catch (err) {
            console.error('Worker: WS parse error', err);
            postMessage({ type: 'stream_status', status: 'degraded', error: 'parse_error' });
        }
    };

    ws.onclose = () => {
        isConnected = false;
        if (lagTimer) clearInterval(lagTimer);
        if (batchInterval) clearInterval(batchInterval);
        batchInterval = null;

        reconnectCount++;
        postMessage({
            type: 'stream_status',
            status: 'disconnected',
            connected: false,
            reconnectCount
        });

        postMessage({ type: 'system_log', message: 'Stream Disconnected. Reconnecting...' });

        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connect(url, symbols), 3000) as any;
    };

    ws.onerror = (err) => {
        // socket will close after error and trigger onclose
        postMessage({
            type: 'stream_status',
            status: 'degraded',
            connected: false,
            error: 'socket_error'
        });
    };
};

// Listen for messages from the main React thread
self.onmessage = (e) => {
    const { action, payload } = e.data;

    switch (action) {
        case 'CONNECT':
            connect(payload.url, payload.symbols);
            break;
        case 'DISCONNECT':
            if (ws) ws.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (lagTimer) clearInterval(lagTimer);
            if (batchInterval) clearInterval(batchInterval);
            break;
        case 'SUBSCRIBE':
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'subscribe', coin: payload.symbol }));
            }
            break;
    }
};

export { };
