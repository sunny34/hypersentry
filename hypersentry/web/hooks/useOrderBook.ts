import { useRef, useEffect, useCallback, useState } from 'react';
import { debounce } from 'lodash';

// Basic structure for order book levels
interface OrderBookLevel {
    px: string; // Price
    sz: string; // Size
    n: number;  // Number of orders
    // Optional: Total value, cumulative, etc.
}

interface OrderBookState {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

export const useOrderBook = (symbol: string) => {
    // We keep the "raw" state in a ref to avoid re-renders on every single update
    const rawBook = useRef<OrderBookState>({ bids: [], asks: [] });
    // This state is what the UI actually consumes
    const [book, setBook] = useState<OrderBookState>({ bids: [], asks: [] });

    // Web Worker ref (for offloading heavy parsing/sorting)
    const workerRef = useRef<Worker | null>(null);

    // Throttle the UI update to 100ms (10fps is plenty for reading numbers)
    // Using a ref-based throttle implementation manually or via a hook wrapper
    const [throttledUpdate, setThrottledUpdate] = useState<number>(0);

    // Update function that merges snapshot/delta
    const handleUpdate = useCallback((data: any) => {
        if (!data) return;

        // If snapshot (usually type 'l2Book' in HL terminology for initial)
        if (data.type === 'l2Book') {
            const { levels } = data;
            // Hyperliquid sends [bids, asks]
            if (levels && levels.length === 2) {
                rawBook.current = {
                    bids: levels[0],
                    asks: levels[1]
                };
                // Trigger UI update
                setThrottledUpdate(prev => prev + 1);
            }
        }
        // If delta (type 'l2BookDelta'?? HL usually sends full snapshots for L2, 
        // but for L3/diffs we'd handle it here)
        // Note: Hyperliquid's standard 'l2Book' channel sends full snapshots. 
        // Optimization: Only update state if meaningful change or strictly throttled.
    }, []);

    // Effect to actually update the React state based on the throttle
    useEffect(() => {
        const timeout = setTimeout(() => {
            setBook({ ...rawBook.current });
        }, 100); // 100ms throttle

        return () => clearTimeout(timeout);
    }, [throttledUpdate]);

    return { book, handleUpdate };
};
