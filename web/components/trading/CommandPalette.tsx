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
        { id: 'des', title: 'DES', description: 'Institutional Asset Description', shortcut: '/des' },
        { id: 'arb', title: 'ARB', description: 'Cross-Venue Arbitrage Scanner', shortcut: '/arb' },
        { id: 'risk', title: 'RISK', description: 'Monte Carlo Portfolio Simulator', shortcut: '/risk' },
        { id: 'debate', title: 'DEBATE', description: 'Bull vs Bear Intelligence Debate', shortcut: '/debate' },
        { id: 'twap', title: 'TWAP', description: 'Algorithmic Execution Hub', shortcut: '/twap' },
        { id: 'zen', title: 'ZEN', description: 'Toggle Focus Mode (Zen Mode)', shortcut: '/zen' },
    ];

    const isCommandMode = query.startsWith('/');
    const filteredCommands = COMMANDS.filter(c =>
        c.shortcut.includes(query.toLowerCase()) ||
        c.title.toLowerCase().includes(query.slice(1).toLowerCase())
    );

    const filteredTokens = tokens.filter(t =>
        t.symbol.toLowerCase().includes(query.toLowerCase()) ||
        (t.name && t.name.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 12);

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
                className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Command Panel */}
            <div className="relative w-full max-w-xl mx-4 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-200">
                {/* Search Input */}
                <div className="flex items-center gap-3 px-4 py-4 border-b border-white/5">
                    <Search className="w-5 h-5 text-gray-500" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        placeholder="Search assets or type '/' for commands..."
                        className="flex-1 bg-transparent text-white text-lg font-medium placeholder:text-gray-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                        <kbd className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] font-mono text-gray-500">ESC</kbd>
                    </div>
                </div>

                {/* Results List */}
                <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                    {/* Section Header */}
                    {query.length === 0 && (
                        <div className="px-4 py-2 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                            {recentSearches.length > 0 ? 'Recent & Top Movers' : 'Top Movers'}
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
                                className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${index === selectedIndex
                                    ? 'bg-white/5'
                                    : 'hover:bg-white/[0.02]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    {isCmd ? (
                                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                                            <Command className="w-4 h-4" />
                                        </div>
                                    ) : (
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${token?.change24h && token.change24h > 0
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                            }`}>
                                            <span className="text-xs font-black">{token?.symbol.slice(0, 2)}</span>
                                        </div>
                                    )}

                                    <div className="text-left">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-white">{isCmd ? cmd?.title : token?.symbol}</span>
                                            {!isCmd && token?.symbol && recentSearches.includes(token.symbol) && (
                                                <Clock className="w-3 h-3 text-gray-600" />
                                            )}
                                            {isCmd && (
                                                <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded font-black uppercase tracking-tighter">CMD</span>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500">{isCmd ? cmd?.description : token?.name}</span>
                                    </div>
                                </div>

                                <div className="text-right">
                                    {!isCmd && token?.price && (
                                        <div className="text-sm font-mono font-bold text-white">
                                            ${token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: token.price < 1 ? 6 : 2 })}
                                        </div>
                                    )}
                                    {!isCmd && token?.change24h !== undefined && (
                                        <div className={`text-xs font-mono font-bold ${token.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(2)}%
                                        </div>
                                    )}
                                    {isCmd && (
                                        <span className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-widest">{cmd?.shortcut}</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}

                    {displayList.length === 0 && query.length > 0 && (
                        <div className="px-4 py-8 text-center">
                            <span className="text-gray-500 text-sm">No assets or commands found for &quot;{query}&quot;</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-[10px] text-gray-600">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-[9px] font-mono">↑↓</kbd>
                            Navigate
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-[9px] font-mono">↵</kbd>
                            Select
                        </span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                        <Zap className="w-3 text-blue-500" />
                        <span>SENTRY COMMAND MODE</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
