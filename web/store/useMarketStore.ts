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
    price_ts?: number;
    book: [OrderBookLevel[], OrderBookLevel[]];
    book_ts?: number;
    updated_at?: number;
    orderbook_imbalance?: number;
    trades: Trade[];
    walls: LiquidityWall[];
    cvd: number;
    oi?: number;
    external_spot?: {
        cvd_spot_binance_1m?: number;
        cvd_spot_binance_5m?: number;
        cvd_spot_coinbase_1m?: number;
        cvd_spot_coinbase_5m?: number;
        cvd_spot_okx_1m?: number;
        cvd_spot_okx_5m?: number;
        cvd_spot_composite_1m?: number;
        cvd_spot_composite_5m?: number;
        cvd_source?: string;
    };
    external_oi?: {
        open_interest?: number;
        open_interest_hl?: number;
        open_interest_hl_contracts?: number;
        open_interest_binance_perp?: number;
        open_interest_ref_price?: number;
        open_interest_source?: string;
    };
}

interface MarketStore {
    // Map of symbol -> data
    marketData: Record<string, TokenData>;

    // Actions
    updateFromAggregator: (data: Record<string, unknown>) => void;
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
                const key = symbol.toUpperCase();
                const existing = newMarketData[key] || INITIAL_TOKEN_DATA;
                const updateObj = (update && typeof update === 'object') ? (update as Partial<TokenData>) : {};

                const hasValidBook = Array.isArray(updateObj.book)
                    && updateObj.book.length === 2
                    && Array.isArray(updateObj.book[0])
                    && Array.isArray(updateObj.book[1]);
                const safeBook = hasValidBook ? (updateObj.book as [OrderBookLevel[], OrderBookLevel[]]) : null;
                const hasBookLevels = !!safeBook && (safeBook[0].length > 0 || safeBook[1].length > 0);
                const hasTrades = Array.isArray(updateObj.trades) && updateObj.trades.length > 0;
                const hasWalls = Array.isArray(updateObj.walls) && updateObj.walls.length > 0;
                const safeTrades = hasTrades ? (updateObj.trades as Trade[]) : null;
                const safeWalls = hasWalls ? (updateObj.walls as LiquidityWall[]) : null;

                // Sticky logic: don't replace useful state with empty payloads.
                const updatedBook = hasBookLevels && safeBook ? safeBook : existing.book;
                const updatedTrades = safeTrades ?? existing.trades;
                const updatedWalls = safeWalls ?? existing.walls;

                newMarketData[key] = {
                    ...existing,
                    ...updateObj,
                    book: updatedBook,
                    trades: updatedTrades,
                    walls: updatedWalls,
                    // Auto-stamp timestamps when book updates arrive
                    ...(hasBookLevels ? {
                        book_ts: Date.now(),
                        updated_at: Date.now(),
                    } : {}),
                };
            }

            return { marketData: newMarketData };
        });
    },

    getTokenData: (symbol) => {
        return get().marketData[symbol.toUpperCase()] || null;
    }
}));
