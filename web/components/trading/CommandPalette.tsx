'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, TrendingUp, Star, Clock, X, Command, Zap } from 'lucide-react';

interface Token {
    symbol: string;
    name?: string;
    price?: number;
    change24h?: number;
}

interface CommandItem {
    id: string;
    title: string;
    description: string;
    shortcut: string;
}

interface CommandPaletteProps {
    tokens: Token[];
    onSelectToken: (symbol: string) => void;
    onExecuteCommand?: (commandId: string) => void;
    isOpen: boolean;
    onClose: () => void;
}

export default function CommandPalette({ tokens, onSelectToken, onExecuteCommand, isOpen, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [recentSearches, setRecentSearches] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const saved = localStorage.getItem('recentAssetSearches');
            if (!saved) return [];
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed.slice(0, 5).map((s) => String(s)) : [];
        } catch {
            return [];
        }
    });
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const COMMANDS: CommandItem[] = [
        { id: 'close_all', title: 'Close All Positions', description: 'Liquidate all active risk immediately', shortcut: '/close' },
        { id: 'des', title: 'DES (Description)', description: 'Institutional Asset Description', shortcut: '/des' },
        { id: 'arb', title: 'ARB (Arbitrage)', description: 'Cross-Venue Arbitrage Scanner', shortcut: '/arb' },
        { id: 'risk', title: 'RISK (Simulator)', description: 'Monte Carlo Portfolio Simulator', shortcut: '/risk' },
        { id: 'debate', title: 'DEBATE (AI Intelligence)', description: 'Bull vs Bear Intelligence Debate', shortcut: '/debate' },
        { id: 'twap', title: 'TWAP Execution', description: 'Algorithmic Execution Hub', shortcut: '/twap' },
        { id: 'zen', title: 'ZEN (Focus Mode)', description: 'Toggle Focus Mode (Zen Mode)', shortcut: '/zen' },
    ];

    const isCommandMode = query.startsWith('/');

    // Priority Scoring for Search
    const getPriority = (token: Token) => {
        if (token.symbol.toLowerCase() === query.toLowerCase()) return 100;
        if (token.symbol.toLowerCase().startsWith(query.toLowerCase())) return 50;
        return 0;
    };

    const filteredCommands = COMMANDS.filter(c =>
        c.shortcut.includes(query.toLowerCase()) ||
        c.title.toLowerCase().includes(query.slice(1).toLowerCase())
    );

    const filteredTokens = tokens.filter(t =>
        t.symbol.toLowerCase().includes(query.toLowerCase()) ||
        (t.name && t.name.toLowerCase().includes(query.toLowerCase()))
    )
        .sort((a, b) => getPriority(b) - getPriority(a))
        .slice(0, 12);

    // Top movers (sorted by 24h change)
    const topMovers = [...tokens]
        .filter(t => t.change24h !== undefined)
        .sort((a, b) => Math.abs(b.change24h || 0) - Math.abs(a.change24h || 0))
        .slice(0, 5);

    type PaletteItem = Token | CommandItem;

    const displayList = (isCommandMode ? filteredCommands : (query.length > 0 ? filteredTokens : [
        ...recentSearches.map(s => tokens.find(t => t.symbol === s)).filter(Boolean) as Token[],
        ...topMovers.filter(t => !recentSearches.includes(t.symbol))
    ].slice(0, 8))) as PaletteItem[];

    const handleSelect = useCallback((item: PaletteItem) => {
        if ('shortcut' in item) {
            // It's a command
            if (onExecuteCommand) onExecuteCommand(item.id);
            onClose();
        } else {
            // It's a token
            const symbol = item.symbol;
            const updated = [symbol, ...recentSearches.filter(s => s !== symbol)].slice(0, 5);
            setRecentSearches(updated);
            localStorage.setItem('recentAssetSearches', JSON.stringify(updated));
            onSelectToken(symbol);
            onClose();
        }
    }, [onSelectToken, onExecuteCommand, onClose, recentSearches]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(i => Math.min(i + 1, displayList.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(i => Math.max(i - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (displayList[selectedIndex]) {
                        handleSelect(displayList[selectedIndex]);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, displayList, selectedIndex, handleSelect, onClose]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
            if (selectedEl) {
                selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/90 backdrop-blur-md animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Command Panel */}
            <div className="relative w-full max-w-2xl mx-4 bg-[#050505] border border-white/5 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-300">
                {/* Search Input */}
                <div className="flex items-center gap-4 px-6 py-5 border-b border-white/5 bg-white/[0.02]">
                    <Search className="w-6 h-6 text-blue-500/50" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        placeholder="Search assets (e.g. BTC) or type '/' for terminal intents..."
                        className="flex-1 bg-transparent text-white text-xl font-bold placeholder:text-gray-700 focus:outline-none tracking-tight"
                    />
                    <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] font-black text-gray-500 uppercase tracking-widest shadow-inner">ESC</kbd>
                    </div>
                </div>

                {/* Results List */}
                <div ref={listRef} className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* Section Header */}
                    {query.length === 0 && (
                        <div className="px-6 py-3 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] bg-white/[0.01]">
                            {recentSearches.length > 0 ? 'History & Active Volatility' : 'High Volatility Assets'}
                        </div>
                    )}

                    {displayList.map((item, index) => {
                        const isCmd = 'shortcut' in item;
                        const token = !isCmd ? item as Token : null;
                        const cmd = isCmd ? item as CommandItem : null;

                        return (
                            <button
                                key={isCmd ? cmd?.id : token?.symbol}
                                onClick={() => handleSelect(item)}
                                className={`w-full flex items-center justify-between px-6 py-4 transition-all border-l-2 ${index === selectedIndex
                                    ? 'bg-blue-500/5 border-blue-500'
                                    : 'hover:bg-white/[0.02] border-transparent'
                                    }`}
                            >
                                <div className="flex items-center gap-4">
                                    {isCmd ? (
                                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20 shadow-inner">
                                            <Zap className="w-5 h-5" />
                                        </div>
                                    ) : (
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-inner ${token?.change24h && token.change24h > 0
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                            }`}>
                                            <span className="text-xs font-black tracking-tighter uppercase">{token?.symbol.slice(0, 3)}</span>
                                        </div>
                                    )}

                                    <div className="text-left leading-tight">
                                        <div className="flex items-center gap-2">
                                            <span className="text-base font-black text-white tracking-tight">{isCmd ? cmd?.title : token?.symbol}</span>
                                            {!isCmd && token?.symbol && recentSearches.includes(token.symbol) && (
                                                <Clock className="w-3 h-3 text-gray-700" />
                                            )}
                                            {isCmd && (
                                                <span className="text-[9px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-black uppercase tracking-widest border border-blue-500/20">Intent</span>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{isCmd ? cmd?.description : token?.name}</span>
                                    </div>
                                </div>

                                <div className="text-right">
                                    {!isCmd && token?.price && (
                                        <div className="text-base font-mono font-black text-white tracking-tighter">
                                            ${token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: token.price < 1 ? 6 : 2 })}
                                        </div>
                                    )}
                                    {!isCmd && token?.change24h !== undefined && (
                                        <div className={`text-xs font-mono font-bold ${token.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(2)}%
                                        </div>
                                    )}
                                    {isCmd && (
                                        <span className="text-[10px] font-mono font-black text-gray-700 uppercase tracking-[0.2em]">{cmd?.shortcut}</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}

                    {displayList.length === 0 && query.length > 0 && (
                        <div className="px-6 py-12 text-center">
                            <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
                                <Search className="w-6 h-6 text-gray-700" />
                            </div>
                            <span className="text-gray-500 text-sm font-bold uppercase tracking-widest">No matching assets or terminal intents</span>
                            <p className="text-xs text-gray-700 mt-2">Try searching for symbols or using / for commands</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between bg-white/[0.01]">
                    <div className="flex items-center gap-6 text-[10px] text-gray-600 font-black uppercase tracking-widest">
                        <span className="flex items-center gap-2">
                            <kbd className="px-2 py-1 bg-white/5 rounded-md border border-white/10 font-mono shadow-inner">↑↓</kbd>
                            Navigate
                        </span>
                        <span className="flex items-center gap-2">
                            <kbd className="px-2 py-1 bg-white/5 rounded-md border border-white/10 font-mono shadow-inner">↵</kbd>
                            Execute
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 font-black uppercase tracking-[0.3em]">
                        <Zap className="w-3.5 h-3.5 text-blue-500 fill-blue-500/20" />
                        <span>Sentry Command Mode</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
