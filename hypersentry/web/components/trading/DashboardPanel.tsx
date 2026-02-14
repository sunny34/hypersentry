'use client';
import { useState } from 'react';
import PositionsTable from './PositionsTable';

interface DashboardPanelProps {
    isAuthenticated: boolean;
    positions: any[];
    openOrders: any[];
    tokens?: any[];
    onSelectToken?: (symbol: string) => void;
    onClosePosition: (pos: any) => void;
    onCancelOrder: (order: any) => void;
    onAnalyze?: (pos: any) => void;
    onAdjustPosition?: (pos: any) => void;
    activeTabOverride?: 'positions' | 'orders' | 'history' | 'balances';
}

export default function DashboardPanel({
    isAuthenticated,
    positions = [],
    openOrders = [],
    tokens = [],
    onSelectToken,
    onClosePosition,
    onCancelOrder,
    onAnalyze,
    onAdjustPosition,
    activeTabOverride
}: DashboardPanelProps) {
    const [localTab, setLocalTab] = useState<'positions' | 'orders' | 'history' | 'balances'>('positions');
    const activeTab = activeTabOverride || localTab;
    const setActiveTab = activeTabOverride ? () => { } : setLocalTab;

    // Transform positions to Table format with safety checks
    const tablePositions = positions
        .map((p: any) => {
            // Handle both raw HL positions (which have a .position property) 
            // and pre-transformed or fallback objects
            const raw = p.position || p;

            if (!raw) return null;

            const size = parseFloat(raw.szi || raw.size || 0);
            const entryPrice = parseFloat(raw.entryPx || raw.entryPrice || 0);
            const coin = raw.coin || 'Unknown';

            // Find current price in tokens array
            const tokenData = tokens.find(t => t.symbol === coin);
            const markPrice = tokenData ? tokenData.price : 0;
            const pnl = parseFloat(raw.unrealizedPnl || 0);
            const roe = parseFloat(raw.returnOnEquity || raw.roe || 0) * (raw.returnOnEquity ? 100 : 1);

            return {
                coin: coin,
                size: size,
                value: size * (markPrice || entryPrice),
                entryPrice: entryPrice,
                markPrice: markPrice,
                pnl: pnl,
                roe: roe,
                side: (size > 0 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
                liquidationPrice: parseFloat(raw.liquidationPx || raw.liquidationPrice || 0),
                raw: p
            };
        })
        .filter(p => p !== null);

    return (
        <div className="flex flex-col h-full bg-gray-900/40 border border-gray-800/50 rounded-2xl overflow-hidden backdrop-blur-sm">
            {/* Tabs Header - Only show if not controlled externally */}
            {!activeTabOverride && (
                <div className="flex items-center border-b border-gray-800/50 px-2 bg-black/20">
                    {[
                        { id: 'positions', label: `Positions (${positions.length})` },
                        { id: 'orders', label: `Open Orders (${openOrders.length})` },
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
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-auto bg-black/20">
                {!isAuthenticated ? (
                    <div className="flex flex-col h-full">
                        <div className="p-4 border-b border-gray-800/50 flex items-center justify-between">
                            <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Market Intelligence</h3>
                            <div className="px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-400">
                                LIVE PREVIEW
                            </div>
                        </div>
                        <div className="flex-1 p-6 flex flex-col items-center justify-center gap-6">
                            <div className="text-center space-y-2">
                                <h4 className="text-xl font-bold text-white">Connect to View Your Positions</h4>
                                <p className="text-sm text-gray-400 max-w-xs mx-auto">
                                    Access your portfolio, active orders, and trade history securely via your wallet.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                                <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-2">
                                    <span className="text-[10px] uppercase font-black text-gray-500">Top Gainer (24h)</span>
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold text-white">BTC</span>
                                        <span className="text-emerald-400 font-mono font-bold">+4.2%</span>
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-2">
                                    <span className="text-[10px] uppercase font-black text-gray-500">Whale Activity</span>
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold text-white">High</span>
                                        <span className="text-blue-400 font-mono font-bold">12 Alerts</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {activeTab === 'positions' && (
                            <div className="flex flex-col h-full uppercase">
                                {/* Pro Summary Bar */}
                                <div className="p-3 border-b border-gray-800/50 bg-gray-900/40 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-6">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-gray-500 font-black tracking-widest">Total Unrealized PnL</span>
                                            <span className={`text-lg font-black font-mono ${tablePositions.reduce((acc, p) => acc + p.pnl, 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {tablePositions.reduce((acc, p) => acc + p.pnl, 0) >= 0 ? '+' : ''}
                                                ${tablePositions.reduce((acc, p) => acc + p.pnl, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="w-px h-8 bg-gray-800" />
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-gray-500 font-black tracking-widest">Net Exposure</span>
                                            <span className="text-lg font-black font-mono text-gray-200">
                                                ${tablePositions.reduce((acc, p) => acc + Math.abs(p.value), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </span>
                                        </div>
                                        <div className="w-px h-8 bg-gray-800" />
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-gray-500 font-black tracking-widest">Avg ROE</span>
                                            <span className={`text-lg font-black font-mono ${tablePositions.length > 0 && tablePositions.reduce((acc, p) => acc + p.roe, 0) / tablePositions.length >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {tablePositions.length > 0 ? (tablePositions.reduce((acc, p) => acc + p.roe, 0) / tablePositions.length).toFixed(2) : '0.00'}%
                                            </span>
                                        </div>
                                    </div>

                                    {positions.length > 0 && (
                                        <button
                                            onClick={() => {
                                                if (confirm("Are you sure you want to close ALL open positions?")) {
                                                    positions.forEach(p => onClosePosition(p));
                                                }
                                            }}
                                            className="px-4 py-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/30 rounded-xl text-[10px] font-black tracking-widest transition-all active:scale-95 shadow-[0_0_20px_rgba(239,68,68,0.1)] hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                                        >
                                            CLOSE ALL POSITIONS
                                        </button>
                                    )}
                                </div>

                                <PositionsTable
                                    positions={tablePositions}
                                    isLoading={false}
                                    onSelectToken={onSelectToken}
                                    onClose={(pos) => onClosePosition(pos.raw)}
                                    onAnalyze={(pos) => onAnalyze && onAnalyze(pos.raw)}
                                    onAdjust={(pos) => onAdjustPosition && onAdjustPosition(pos.raw)}
                                />
                            </div>
                        )}
                        {activeTab === 'orders' && (
                            <div className="w-full">
                                {openOrders.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                                        <p className="font-medium">No open orders</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-gray-500 uppercase bg-gray-900/50">
                                            <tr>
                                                <th className="px-4 py-3">Symbol</th>
                                                <th className="px-4 py-3">Side</th>
                                                <th className="px-4 py-3 text-right">Size</th>
                                                <th className="px-4 py-3 text-right">Price</th>
                                                <th className="px-4 py-3 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800/50">
                                            {openOrders.map((order, i) => (
                                                <tr key={i} className="hover:bg-gray-800/30">
                                                    <td className="px-4 py-3 font-bold">{order.coin}</td>
                                                    <td className={`px-4 py-3 font-bold ${order.side === 'B' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {order.side === 'B' ? 'BUY' : 'SELL'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">{order.sz}</td>
                                                    <td className="px-4 py-3 text-right">${parseFloat(order.limitPx).toLocaleString()}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button
                                                            onClick={() => onCancelOrder(order)}
                                                            className="text-xs bg-red-500/20 hover:bg-red-500/40 text-red-500 px-2 py-1 rounded"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
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
                                    <span className="text-2xl font-bold text-white">View in Order Form</span>
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
