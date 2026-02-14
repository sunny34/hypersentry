# HyperSentry Pro: Improvement Plan & Architecture

This document outlines the systematic plan to upgrade HyperSentry into a high-performance, professional-grade crypto trading terminal.

## 1. High-Level Architecture

The goal is to decouple data ingestion from the UI presentation and ensure the frontend remains responsive under heavy load (high-volatility markets).

```mermaid
graph TD
    subgraph "External Data Sources"
        HL_WS[Hyperliquid WebSocket]
        HL_API[Hyperliquid REST API]
        Data_Providers[Twitter/News/RSS]
    end

    subgraph "Backend (FastAPI)"
        WS_Manager[WebSocket Manager & Aggregator]
        Cache[In-Memory Cache / Redis]
        Risk_Engine[Risk & Calc Engine]
        Intel_Engine[Intelligence Engine]
        
        API_Gateway[FastAPI Router]
    end

    subgraph "Frontend (React)"
        Zustand_Store[Global State (Zustand)]
        WS_Hook[Optimized WS Hook]
        
        Layout_Engine[Grid Layout Engine]
        
        Widgets[Widgets: Chart, OrderBook, Positions, etc.]
    end

    HL_WS --> WS_Manager
    HL_API --> Cache
    Data_Providers --> Intel_Engine
    
    WS_Manager --"Throttled Updates (50-100ms)"--> API_Gateway
    API_Gateway --"WebSocket Stream"--> WS_Hook
    
    WS_Hook --> Zustand_Store
    Zustand_Store --"Selective Re-renders"--> Widgets
```

### Key Architectural Principles:
1.  **Backend Aggregation**: The frontend should NOT connect directly to multiple external WebSockets. The backend aggregates these into a single, normalized stream.
2.  **Throttling**: The backend buffers high-frequency updates (e.g., orderbook top-of-book) and pushes them at a max rate (e.g., 100ms) to prevent frontend overload.
3.  **State Isolation**: Use **Zustand** for high-frequency data (price, depth) to update specific components without re-rendering the entire app. Use **React Query** for request/response data (user positions, account info).

---

## 2. Recommended Folder Structure

### Frontend (`web/src`)
Organize by **Features** rather than generic types.

```
src/
├── assets/
├── components/
│   ├── ui/               # Generic UI atoms (Button, Card, Modal)
│   ├── layout/           # App shell, GridSystem, Header
│   └── shared/           # Shared logic components
├── features/
│   ├── terminal/         # Main Trading Terminal
│   │   ├── components/   # Terminal-specific components (OrderBook, DepthChart)
│   │   ├── hooks/        # Terminal hooks (useOrderBook, useTicker)
│   │   └── stores/       # Terminal state (useTerminalStore)
│   ├── portfolio/        # Portfolio management
│   ├── analytics/        # Analytics & Charts
│   └── settings/         # User preferences
├── hooks/                # Global hooks (useWebSocket, useAuth)
├── services/             # API clients, WS connection logic
├── utils/                # Helpers, formatters, math
└── App.tsx
```

### Backend (`backend/src`)
Service-oriented structure.

```
src/
├── api/
│   ├── v1/
│   │   ├── endpoints/    # REST Routes (trading.py, intel.py)
│   │   └── websockets/   # WS Handlers (stream.py)
├── core/                 # Config, Logging, Security
├── services/
│   ├── exchange/         # Hyperliquid interaction logic
│   ├── aggregator/       # Data aggregation & buffering
│   └── risk/             # Risk calculations
├── models/               # Pydantic models & DB schemas
├── utils/                # Helper functions
└── main.py
```

---

## 3. Implementation Priorities & Skeletions

### Phase 1: React Performance & Real-time Optimizations

**Goal**: Eliminate lag and reduce re-renders.

#### A. Optimized WebSocket Hook (Frontend)
Use a ref-based subscription model to avoid re-rendering hooks on every message.

```typescript
// web/src/hooks/useOptimizedWebSocket.ts
import { useEffect, useRef, useCallback } from 'react';
import { useTerminalStore } from '../features/terminal/stores/useTerminalStore';

export const useOptimizedWebSocket = (url: string) => {
    const ws = useRef<WebSocket | null>(null);
    const { updateOrderBook, updateTicker, updateTrades } = useTerminalStore();
    
    // Throttle Update Logic (e.g., using lodash.throttle or custom buffer)
    const processMessage = useCallback((data: any) => {
        switch (data.type) {
            case 'l2Book':
                updateOrderBook(data.payload);
                break;
            case 'trade':
                updateTrades(data.payload);
                break;
            // ... other types
        }
    }, []);

    useEffect(() => {
        ws.current = new WebSocket(url);
        ws.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            processMessage(data); // In production, batch these updates!
        };
        return () => ws.current?.close();
    }, [url, processMessage]);
};
```

#### B. Virtualized Order Book (UI)
Use `react-window` to render only visible rows of the order book.

```tsx
// web/src/features/terminal/components/OrderBook/OrderBookList.tsx
import { FixedSizeList as List } from 'react-window';

const Row = ({ index, style, data }: any) => {
    const level = data[index];
    return (
        <div style={style} className="flex justify-between text-xs hover:bg-white/5">
            <span className="text-red-500">{level.price}</span>
            <span className="text-gray-300">{level.size}</span>
            <span className="text-gray-500">{level.total}</span>
        </div>
    );
};

export const OrderBookList = ({ levels }: { levels: any[] }) => (
    <List
        height={400}
        itemCount={levels.length}
        itemSize={20}
        width={'100%'}
        itemData={levels}
    >
        {Row}
    </List>
);
```

### Phase 2: UI Decluttering & Modularity

**Goal**: Create a customizable, "Pro" workspace.

#### A. Draggable Grid Layout
Use `react-grid-layout` to manage widgets.

```tsx
// web/src/features/terminal/TerminalLayout.tsx
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const layout: Layout[] = [
    { i: 'chart', x: 0, y: 0, w: 8, h: 4 },
    { i: 'orderbook', x: 8, y: 0, w: 2, h: 4 },
    { i: 'positions', x: 0, y: 4, w: 12, h: 2 },
];

export const TerminalLayout = () => {
    return (
        <GridLayout className="layout" layout={layout} cols={12} rowHeight={100} width={1200} draggableHandle=".drag-handle">
            <div key="chart" className="bg-gray-900 border border-gray-800">
                <div className="drag-handle p-1 bg-gray-800 cursor-move">Chart</div>
                {/* Chart Component */}
            </div>
            <div key="orderbook" className="bg-gray-900 border border-gray-800">
                <div className="drag-handle p-1 bg-gray-800 cursor-move">Order Book</div>
                {/* OrderBook Component */}
            </div>
             {/* ... */}
        </GridLayout>
    );
};
```

### Phase 3: Backend Enhancements

**Goal**: Robust data delivery and security.

#### A. Aggregated WebSocket Endpoint (Backend)
Streamlines multiple data sources into one client connection.

```python
# backend/src/api/v1/websockets/stream.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from src.services.aggregator import DataAggregator

router = APIRouter()
aggregator = DataAggregator()

@router.websocket("/ws/stream/{client_id}")
async def websocket_stream(websocket: WebSocket, client_id: str):
    await websocket.accept()
    try:
        # Subscribe client to aggregated feed
        async for data in aggregator.subscribe(client_id):
            # Data is already throttled/batched by the aggregator service
            await websocket.send_json(data)
    except WebSocketDisconnect:
        aggregator.unsubscribe(client_id)
```

## 4. Prioritized TODO List

1.  **[Frontend] Install & Configure Zustand + React Query**: Replace ad-hoc state with a proper store. (Effort: Medium)
2.  **[Frontend] Implement Virtualized Order Book**: Immediate performance gain for the busiest component. (Effort: Low)
3.  **[Frontend] Integrate React Grid Layout**: Build the shell for the modular dashboard. (Effort: High)
4.  **[Backend] Refactor WebSocket Logic**: Create the `DataAggregator` service to centralize logic. (Effort: High)
5.  **[Feature] "Focus Mode"**: Simple state toggle to hide sidebar/news, expanding the grid area. (Effort: Low)
6.  **[Feature] Position Risk Calculator**: Add a modal/widget for "What-If" analysis. (Effort: Medium)
