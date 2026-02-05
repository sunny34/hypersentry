'use client';
import { useState, memo } from 'react';
import { BarChart3, Flame, ShieldAlert, Activity } from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamically import chart components to prevent SSR issues
const AdvancedChart = dynamic(() => import('./AdvancedChart'), { ssr: false });
const LiquidationHeatmap = dynamic(() => import('./LiquidationHeatmap'), { ssr: false });

interface ChartTabsProps {
    symbol: string;
    interval: string;
    positions?: any[];
    openOrders?: any[];
    bias?: 'bullish' | 'bearish' | 'neutral';
    onPriceSelect?: (price: string) => void;
    currentPrice?: number;
    openInterest?: number;
    fundingRate?: number;
    activeIndicators?: Set<string>;
}

type ChartView = 'chart' | 'liquidations' | 'stops';

/**
 * ChartTabs Component
 * 
 * Inspired by Hyperdash's unified charting workspace.
 * Provides tabbed access to Chart, Liquidations, and Stop clusters.
 */
function ChartTabs({
    symbol,
    interval,
    positions,
    openOrders,
    bias = 'neutral',
    onPriceSelect,
    currentPrice = 0,
    openInterest = 0,
    fundingRate = 0,
    activeIndicators = new Set(['EMA 50', 'EMA 200', 'Supertrend'])
}: ChartTabsProps) {
    const [activeView, setActiveView] = useState<ChartView>('chart');

    const tabs = [
        { id: 'chart', label: 'Chart', icon: BarChart3, shortcut: '1' },
        { id: 'liquidations', label: 'Liquidations', icon: Flame, shortcut: '2' },
        { id: 'stops', label: 'Stops', icon: ShieldAlert, shortcut: '3' },
    ];

    return (
        <div className="flex flex-col h-full">
            {/* Tab Bar - Centered like Hyperdash */}
            <div className="flex items-center justify-center gap-1 py-1.5 bg-black/20 border-b border-white/5">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeView === tab.id;

                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveView(tab.id as ChartView)}
                            className={`
                                flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide
                                transition-all duration-200 relative group
                                ${isActive
                                    ? 'text-white bg-white/10'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                }
                            `}
                        >
                            <Icon className={`w-3.5 h-3.5 ${isActive
                                ? tab.id === 'liquidations' ? 'text-[var(--color-accent-orange)]' :
                                    tab.id === 'stops' ? 'text-[var(--color-accent-blue)]' : 'text-[var(--color-bullish)]'
                                : ''
                                }`} />
                            <span>{tab.label}</span>

                            {/* Keyboard shortcut hint */}
                            <span className={`
                                text-[9px] font-mono px-1 rounded
                                ${isActive ? 'bg-white/10 text-white/40' : 'bg-white/5 text-gray-600'}
                            `}>
                                {tab.shortcut}
                            </span>

                            {/* Active indicator line */}
                            {isActive && (
                                <div className={`
                                    absolute bottom-0 left-2 right-2 h-0.5 rounded-full
                                    ${tab.id === 'liquidations' ? 'bg-[var(--color-accent-orange)]' :
                                        tab.id === 'stops' ? 'bg-[var(--color-accent-blue)]' : 'bg-[var(--color-bullish)]'}
                                `} />
                            )}
                        </button>
                    );
                })}

                {/* Live indicator */}
                <div className="ml-4 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--color-bullish)]/10 border border-[var(--color-bullish)]/20">
                    <Activity className="w-3 h-3 text-[var(--color-bullish)] animate-pulse" />
                    <span className="text-[10px] font-bold text-[var(--color-bullish)] uppercase tracking-wider">Live</span>
                </div>
            </div>

            {/* Chart Content Area */}
            <div className="flex-1 relative overflow-hidden">
                {activeView === 'chart' && (
                    <AdvancedChart
                        symbol={symbol}
                        interval={interval}
                        positions={positions}
                        openOrders={openOrders}
                        bias={bias}
                        onPriceSelect={onPriceSelect}
                        showHeatmap={false}
                        currentPrice={currentPrice}
                        openInterest={openInterest}
                        fundingRate={fundingRate}
                        activeIndicators={activeIndicators}
                    />
                )}

                {activeView === 'liquidations' && (
                    <div className="w-full h-full">
                        <LiquidationHeatmap
                            currentPrice={currentPrice}
                            symbol={symbol}
                            openInterest={openInterest}
                            fundingRate={fundingRate}
                        />
                    </div>
                )}

                {activeView === 'stops' && (
                    <div className="w-full h-full flex items-center justify-center bg-black/40">
                        <div className="text-center">
                            <ShieldAlert className="w-12 h-12 text-blue-400/50 mx-auto mb-4" />
                            <h3 className="text-white font-bold mb-2">Stop Order Clusters</h3>
                            <p className="text-gray-500 text-sm max-w-sm">
                                Visualizes clusters of stop-loss and stop-limit orders based on on-chain data.
                                <br />
                                <span className="text-blue-400 text-xs mt-2 block">Coming Soon</span>
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(ChartTabs);
