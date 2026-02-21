'use client';
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getWsUrl } from '@/lib/constants';
import { useMarketStore } from '@/store/useMarketStore';

interface MarketDataContextType {
    isConnected: boolean;
    subscribe: (symbol: string) => void;
    unsubscribe: (symbol: string) => void;
    lastMessage: any;
}

const MarketDataContext = createContext<MarketDataContextType | undefined>(undefined);

/**
 * MarketDataProvider
 * Centralizes WebSocket connection and manages symbol subscriptions.
 * Prevents multiple connections and redundant data processing.
 */
export function MarketDataProvider({ children }: { children: React.ReactNode }) {
    const { isConnected, lastMessage, sendMessage } = useWebSocket(
        getWsUrl(),
        useCallback((data: any) => {
            if (data.type === 'agg_update') {
                useMarketStore.getState().updateFromAggregator(data.data);
            }
        }, [])
    );

    // Reference counting for subscriptions to avoid unsubscribing while a component stills needs it
    const subscriptions = useRef<Record<string, number>>({});

    const subscribe = useCallback((symbol: string) => {
        const s = symbol.toUpperCase();
        if (!subscriptions.current[s]) {
            subscriptions.current[s] = 0;
            if (isConnected) {
                sendMessage({ type: 'subscribe', coin: s });
            }
        }
        subscriptions.current[s]++;
    }, [isConnected, sendMessage]);

    const unsubscribe = useCallback((symbol: string) => {
        const s = symbol.toUpperCase();
        if (subscriptions.current[s]) {
            subscriptions.current[s]--;
            if (subscriptions.current[s] === 0) {
                if (isConnected) {
                    sendMessage({ type: 'unsubscribe', coin: s });
                }
                delete subscriptions.current[s];
            }
        }
    }, [isConnected, sendMessage]);

    // Resubscribe all active symbols on reconnection
    useEffect(() => {
        if (isConnected) {
            Object.keys(subscriptions.current).forEach(symbol => {
                sendMessage({ type: 'subscribe', coin: symbol });
            });
        }
    }, [isConnected, sendMessage]);

    return (
        <MarketDataContext.Provider value={{ isConnected, subscribe, unsubscribe, lastMessage }}>
            {children}
        </MarketDataContext.Provider>
    );
}

export function useMarketData() {
    const context = useContext(MarketDataContext);
    if (!context) {
        throw new Error('useMarketData must be used within a MarketDataProvider');
    }
    return context;
}
