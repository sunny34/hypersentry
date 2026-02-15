import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Star, X } from 'lucide-react';

interface Token {
    symbol: string;
    pair: string;
    name: string;
    type: 'perp' | 'spot';
    price: number;
    change24h: number;
    volume24h: number;
    openInterest: number;
}

interface TokenSelectorProps {
    selectedToken: string;
    tokens: Token[];
    onSelect: (token: string) => void;
}

type Tab = 'All' | 'Favorites' | 'Crypto' | 'Equities' | 'Forex' | 'Spot';
type SortKey = 'symbol' | 'price' | 'change24h' | 'volume24h';
type SortDirection = 'asc' | 'desc';

const getSortArrow = (currentKey: SortKey, sortKey: SortKey, sortDirection: SortDirection) => {
    if (sortKey !== currentKey) return null;
    return sortDirection === 'asc'
        ? <span className="text-blue-400 ml-1">↑</span>
        : <span className="text-blue-400 ml-1">↓</span>;
};

export default function TokenSelector({ selectedToken, tokens, onSelect }: TokenSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<Tab>('Crypto');
    const [sortKey, setSortKey] = useState<SortKey>('volume24h');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus input on open
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('desc');
        }
    };

    const filteredTokens = useMemo(() => {
        let list = [...tokens];

        if (activeTab === 'Equities') {
            list = [
                { symbol: 'US500', pair: 'US500', name: 'S&P 500', type: 'perp', price: 690.49, change24h: 0.16, volume24h: 15500000, openInterest: 8200000 },
                { symbol: 'TSLA', pair: 'TSLA/USD', name: 'Tesla', type: 'perp', price: 428.20, change24h: 1.00, volume24h: 1100000, openInterest: 1200000 },
                { symbol: 'AAPL', pair: 'AAPL/USD', name: 'Apple', type: 'perp', price: 259.14, change24h: 0.98, volume24h: 777000, openInterest: 477700 },
                { symbol: 'NVDA', pair: 'NVDA/USD', name: 'Nvidia', type: 'perp', price: 145.20, change24h: -1.2, volume24h: 5500000, openInterest: 3000000 },
            ] as Token[];
        }

        if (activeTab === 'Forex') {
            list = [
                { symbol: 'EURUSD', pair: 'EUR/USD', name: 'Euro', type: 'perp', price: 1.0845, change24h: -0.05, volume24h: 90000000, openInterest: 0 },
                { symbol: 'USDJPY', pair: 'USD/JPY', name: 'Yen', type: 'perp', price: 152.3, change24h: 0.2, volume24h: 45000000, openInterest: 0 },
            ] as Token[];
        }

        // Search Filter
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(t =>
                t.symbol.toLowerCase().includes(q) ||
                t.pair.toLowerCase().includes(q) ||
                t.name.toLowerCase().includes(q)
            );
        }

        // Sorting Logic
        list.sort((a, b) => {
            let valA: any = a[sortKey];
            let valB: any = b[sortKey];

            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return list;
    }, [tokens, activeTab, search, sortKey, sortDirection]);

    const formatCompact = (num: number) => {
        return new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 1,
            style: 'currency',
            currency: 'USD'
        }).format(num);
    };

    return (
        <div className="relative" ref={containerRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 bg-gray-900/80 border border-gray-700/50 hover:border-gray-600 rounded-lg px-3 py-1.5 text-sm font-bold transition-all text-white min-w-[140px] justify-between group"
            >
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">
                        {selectedToken.substring(0, 1)}
                    </div>
                    <span>{selectedToken}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform group-hover:text-gray-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-[500px] bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-[100] backdrop-blur-xl flex flex-col max-h-[600px]">
                    {/* Search Header */}
                    <div className="p-3 border-b border-gray-800">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="Search assets, addresses, or type / for commands"
                                className="w-full bg-gray-950/50 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 placeholder:text-gray-600"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800 overflow-x-auto scrollbar-none">
                        {(['All', 'Crypto', 'Equities', 'Forex', 'Spot'] as Tab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${activeTab === tab
                                    ? 'bg-gray-800 text-white'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Column Headers */}
                    <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-800/50">
                        <div
                            className="col-span-5 flex items-center gap-1 cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => handleSort('symbol')}
                        >
                            Asset {getSortArrow('symbol', sortKey, sortDirection)}
                        </div>
                        <div
                            className="col-span-3 text-right cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => handleSort('price')}
                        >
                            Price {getSortArrow('price', sortKey, sortDirection)}
                        </div>
                        <div
                            className="col-span-2 text-right cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => handleSort('change24h')}
                        >
                            24h {getSortArrow('change24h', sortKey, sortDirection)}
                        </div>
                        <div
                            className="col-span-2 text-right cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => handleSort('volume24h')}
                        >
                            Vol {getSortArrow('volume24h', sortKey, sortDirection)}
                        </div>
                    </div>

                    {/* Asset List */}
                    <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800">
                        {filteredTokens.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 text-sm">
                                No assets found for &quot;{search}&quot;
                            </div>
                        ) : (
                            filteredTokens.map((t) => (
                                <button
                                    key={t.symbol}
                                    onClick={() => {
                                        onSelect(t.symbol);
                                        setIsOpen(false);
                                        setSearch('');
                                    }}
                                    className={`w-full grid grid-cols-12 gap-2 px-4 py-2 text-sm hover:bg-gray-800/50 transition-colors items-center group ${selectedToken === t.symbol ? 'bg-blue-500/10' : ''}`}
                                >
                                    {/* Asset Name */}
                                    <div className="col-span-5 flex items-center gap-3 text-left">
                                        <Star className="w-3 h-3 text-gray-600 hover:text-yellow-500 transition-colors opacity-0 group-hover:opacity-100" />
                                        <div className="flex items-center gap-2">
                                            <div className="w-5 h-5 rounded-full bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-400">
                                                {t.symbol[0]}
                                            </div>
                                            <div className="flex flex-col items-start leading-none">
                                                <span className="font-bold text-gray-200 group-hover:text-white">{t.symbol}</span>
                                                <span className="text-[10px] text-gray-500">{t.name || 'Perp'}</span>
                                            </div>
                                            {activeTab === 'Equities' && (
                                                <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1 rounded">25X</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Price */}
                                    <div className="col-span-3 text-right font-mono text-gray-300">
                                        ${t.price < 1 ? t.price.toFixed(6) : t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>

                                    {/* Change */}
                                    <div className={`col-span-2 text-right font-medium text-xs ${t.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {t.change24h > 0 ? '+' : ''}{t.change24h.toFixed(2)}%
                                    </div>

                                    {/* Volume */}
                                    <div className="col-span-2 text-right text-xs text-gray-500 font-mono">
                                        {formatCompact(t.volume24h)}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
