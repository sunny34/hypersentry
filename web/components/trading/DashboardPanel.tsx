'use client';
import { useState } from 'react';
import PositionsTable from './PositionsTable';

interface DashboardPanelProps {
    isAuthenticated: boolean;
}

export default function DashboardPanel({ isAuthenticated }: DashboardPanelProps) {
    const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'history' | 'balances'>('positions');

    // Demo data for now
    const positions: any[] = [
        {
            coin: 'BTC',
            size: 0.15,
            value: 12500,
            entryPrice: 83200,
            markPrice: 83700,
            pnl: 75.00,
            roe: 12.5,
            side: 'LONG',
            liquidationPrice: 71000
        }
    ];

    return (
        <div className="flex flex-col h-full bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm">
            {/* Tabs Header */}
            <div className="flex items-center border-b border-gray-800/50 px-2 bg-black/20">
                {[
                    { id: 'positions', label: 'Positions' },
                    { id: 'orders', label: 'Open Orders (0)' },
                    { id: 'history', label: 'Trade History' },
                    { id: 'balances', label: 'Balances' }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-4 py-3 text-sm font-bold border-b-2 transition ${activeTab === tab.id
                            ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                            : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto bg-black/20">
                {false ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <p className="font-medium">Connect wallet to view {activeTab}</p>
                    </div>
                ) : (
                    <>
                        {activeTab === 'positions' && (
                            <PositionsTable positions={positions} isLoading={false} />
                        )}
                        {activeTab === 'orders' && (
                            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                                <p className="font-medium">No open orders</p>
                            </div>
                        )}
                        {activeTab === 'history' && (
                            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                                <p className="font-medium">No recent trades</p>
                            </div>
                        )}
                        {activeTab === 'balances' && (
                            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                                <p className="font-medium flex items-center gap-2">
                                    <span className="text-2xl font-bold text-white">$0.00</span>
                                    <span className="text-gray-500">USDC</span>
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
