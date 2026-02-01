'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from '@/components/Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { Activity, Play, Settings, TrendingUp, BarChart2 } from 'lucide-react';
import StrategySimulator from '@/components/trading/StrategySimulator';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import AddWalletModal from '@/components/modals/AddWalletModal';
import ImportModal from '@/components/modals/ImportModal';

// Mock tokens for selector if needed, or reuse context
const TOKENS = ['BTC', 'ETH', 'SOL', 'HYPE'];

export default function StrategiesPage() {
    const { isCollapsed } = useSidebar();
    const [selectedToken, setSelectedToken] = useState('BTC');
    const [currentPrice, setCurrentPrice] = useState(0);
    const [fundingRate, setFundingRate] = useState(0);
    const [tokens, setTokens] = useState<any[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [showImport, setShowImport] = useState(false);

    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const res = await axios.get(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/trading/tokens`);
                const tokenList = res.data.tokens || [];
                setTokens(tokenList);
            } catch (e) {
                console.error("Failed to fetch tokens", e);
            }
        };
        fetchTokens();
    }, []);

    useEffect(() => {
        // Find token data from list or fetch specific
        const tokenData = tokens.find(t => t.symbol === selectedToken);
        if (tokenData) {
            setCurrentPrice(tokenData.price);
            setFundingRate(tokenData.funding);
        } else {
            // Reset to 0 to prevent stale data (e.g. showing BTC price for HYPE)
            setCurrentPrice(0);

            // Fallback fetch if list not ready
            const fetchPrice = async () => {
                try {
                    const res = await axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' });
                    const price = parseFloat(res.data[selectedToken] || 0);
                    if (price > 0) setCurrentPrice(price);
                } catch (e) { console.error(e); }
            };
            fetchPrice();
        }
    }, [selectedToken, tokens]);

    return (
        <div className="h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white flex overflow-hidden">
            <Sidebar
                currentView="strategies"
                onViewChange={() => { }}
                onImport={() => setShowImport(true)}
                onAdd={() => setShowAdd(true)}
            />

            <main className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'ml-20' : 'ml-64'} h-full`}>
                {/* Header */}
                <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            <Activity className="w-6 h-6 text-blue-500" />
                            Strategy Simulator
                        </h1>
                        <p className="text-gray-500 text-sm mt-1">Backtest and deploy algorithmic strategies.</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <select
                            value={selectedToken}
                            onChange={(e) => setSelectedToken(e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                        >
                            <option value="BTC">BTC / USD</option>
                            <option value="ETH">ETH / USD</option>
                            <option value="SOL">SOL / USD</option>
                            <option value="HYPE">HYPE / USD</option>
                            {/* Add more from tokens list dynamically if desired, but keep simple for now */}
                        </select>
                        <ConnectButton showBalance={false} accountStatus="avatar" />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                        {/* Left: Configuration / List */}
                        <div className="lg:col-span-1 space-y-6">
                            <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-gray-400" />
                                    Active Strategies
                                </h3>

                                <div className="space-y-3">
                                    <div className="p-4 bg-gray-800/50 rounded-xl border border-blue-500/30 relative overflow-hidden group hover:border-blue-500/60 transition cursor-pointer">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="font-bold">Funding Rate Arb</div>
                                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Active</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mb-3">Captures yield from positive funding rates on perp markets.</p>
                                        <div className="flex gap-4 text-xs">
                                            <div>
                                                <div className="text-gray-500">24h PnL</div>
                                                <div className="font-mono text-emerald-400">+1.24%</div>
                                            </div>
                                            <div>
                                                <div className="text-gray-500">Win Rate</div>
                                                <div className="font-mono text-gray-300">68%</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-gray-800/30 rounded-xl border border-gray-700 hover:border-gray-600 transition cursor-pointer opacity-75 hover:opacity-100">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="font-bold">RSI Reversal</div>
                                            <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Idle</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mb-3">Counter-trend strategy at extreme RSI levels (30/70).</p>
                                        <div className="flex gap-4 text-xs">
                                            <div>
                                                <div className="text-gray-500">24h PnL</div>
                                                <div className="font-mono text-gray-500">0.00%</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={() => alert("Custom Strategy Editor coming in v0.3!")}
                                    className="w-full mt-4 py-3 rounded-xl border-2 border-dashed border-gray-700 text-gray-500 font-bold hover:border-gray-600 hover:text-gray-300 transition flex items-center justify-center gap-2">
                                    <PlusIcon className="w-4 h-4" />
                                    New Strategy
                                </button>
                            </div>
                        </div>

                        {/* Right: Simulator (Reusing the component) */}
                        <div className="lg:col-span-2 bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden backdrop-blur-sm h-[600px]">
                            <StrategySimulator
                                symbol={selectedToken}
                                currentPrice={currentPrice || 0}
                                fundingRate={fundingRate}
                                onCopyTrade={(side, price, type) => {
                                    alert(`Copy Trade Signal: ${side} ${selectedToken} @ ${price}`);
                                }}
                            />
                        </div>
                    </div>
                </div>
            </main>

            <AddWalletModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => { }} />
            <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onSuccess={() => { }} />
        </div>
    );
}

function PlusIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
    )
}
