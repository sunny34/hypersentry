import { create } from 'zustand';

/**
 * Institutional Market Data Store
 * Built for high-frequency updates from the backend aggregator.
 */

export interface OrderBookLevel {
    px: string;
    sz: string;
    n?: number;
}

export interface Trade {
    px: string;
    sz: string;
    side: 'B' | 'A';
    time: number;
    coin: string;
}

export interface LiquidityWall {
    px: string;
    sz: string;
    side: 'bid' | 'ask';
    strength: 'major' | 'massive';
}

interface TokenData {
    price: number;
    book: [OrderBookLevel[], OrderBookLevel[]];
    trades: Trade[];
    walls: LiquidityWall[];
    cvd: number;
}

interface MarketStore {
    // Map of symbol -> data
    marketData: Record<string, TokenData>;

    // Actions
    updateFromAggregator: (data: Record<string, any>) => void;
    getTokenData: (symbol: string) => TokenData | null;
}

const INITIAL_TOKEN_DATA: TokenData = {
    price: 0,
    book: [[], []],
    trades: [],
    walls: [],
    cvd: 0
};

export const useMarketStore = create<MarketStore>((set, get) => ({
    marketData: {},

    updateFromAggregator: (data) => {
        set((state) => {
            const newMarketData = { ...state.marketData };

            for (const [symbol, update] of Object.entries(data)) {
                const existing = newMarketData[symbol] || INITIAL_TOKEN_DATA;

                // Sticky Logic: Don't overwrite non-empty data with empty data
                const updatedBook = (update.book && update.book[0].length > 0) ? update.book : existing.book;
                const updatedTrades = (update.trades && update.trades.length > 0) ? update.trades : existing.trades;
                const updatedWalls = (update.walls && update.walls.length > 0) ? update.walls : existing.walls;

                newMarketData[symbol] = {
                    ...existing,
                    ...update,
                    book: updatedBook,
                    trades: updatedTrades,
                    walls: updatedWalls
                };
            }

            return { marketData: newMarketData };
        });
    },

    getTokenData: (symbol) => {
        return get().marketData[symbol] || null;
    }
}));
