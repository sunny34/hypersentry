"use client";
import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';
import { useMarketStore } from '../../../store/useMarketStore';
import { useTradingSettings } from '@/hooks/useTradingSettings';

const PortfolioRiskPanel = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol || 'BTC');
    const conviction = useAlphaStore((s) => s.convictions[activeSymbol]);
    const plan = useAlphaStore((s) => s.executionPlans[activeSymbol]);
    const risk = useAlphaStore((s) => s.risks[activeSymbol]);
    const stream = useAlphaStore((s) => s.stream);
    const market = useMarketStore((s) => s.marketData[activeSymbol]);
    
    // User's trading settings
    const { settings } = useTradingSettings();
    const userEquity = settings?.equity_usd || 100000;
    const userMaxPosition = settings?.max_position_usd || 1000;

    const riskPctRaw = Number(risk?.risk_percent_equity);
    const estRiskPct = Number.isFinite(riskPctRaw)
        ? (riskPctRaw <= 1 ? riskPctRaw * 100 : riskPctRaw)
        : 0;
    const expectedImpact = plan?.slippage_metrics?.expected_impact_bps ?? 0;
    const exposureUsd = risk?.size_usd ?? plan?.total_size_usd ?? 0;
    const equityUsed = Number(risk?.equity_used || 0);
    const capUsd = Number(risk?.max_position_cap_usd || 0);
    const oi = market?.external_oi?.open_interest ?? market?.oi ?? 0;
    const stopLoss = Number(risk?.stop_loss_price || 0);
    const takeProfit = Number(risk?.take_profit_price || 0);
    const currentPrice = market?.price || 0;

    return (
        <div className="h-full flex flex-col bg-gray-950/30">
            <div className="h-10 bg-gray-950 px-4 flex items-center border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-widest">
                Risk :: Exposure Monitor
            </div>
            <div className="p-4 text-xs font-mono space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="border border-gray-800 bg-black/40 p-3 rounded">
                        <div className="text-[10px] uppercase text-gray-500">Symbol</div>
                        <div className="text-white font-bold">{activeSymbol}</div>
                    </div>
                    <div className="border border-gray-800 bg-black/40 p-3 rounded">
                        <div className="text-[10px] uppercase text-gray-500">Bias</div>
                        <div className={`font-bold ${conviction?.bias === 'LONG' ? 'text-green-500' : conviction?.bias === 'SHORT' ? 'text-red-500' : 'text-gray-400'}`}>
                            {conviction?.bias || 'NEUTRAL'}
                        </div>
                    </div>
                    <div className="border border-gray-800 bg-black/40 p-3 rounded">
                        <div className="text-[10px] uppercase text-gray-500">Planned Exposure</div>
                        <div className="text-blue-400 font-bold">${exposureUsd.toFixed(0)}</div>
                        <div className="text-[9px] text-gray-600 mt-1">
                            eq ${userEquity.toFixed(0)} · cap ${userMaxPosition.toFixed(0)}
                        </div>
                    </div>
                    <div className="border border-gray-800 bg-black/40 p-3 rounded">
                        <div className="text-[10px] uppercase text-gray-500">Planned Risk</div>
                        <div className="text-yellow-400 font-bold">{estRiskPct.toFixed(2)}%</div>
                    </div>
                </div>
                {(stopLoss > 0 || takeProfit > 0) && (
                <div className="grid grid-cols-3 gap-2">
                    <div className="border border-gray-800 bg-black/40 p-2 rounded text-center">
                        <div className="text-[9px] uppercase text-gray-500">Entry (est)</div>
                        <div className="text-white text-xs font-bold">${currentPrice.toFixed(2)}</div>
                    </div>
                    <div className="border border-red-900/50 bg-red-950/20 p-2 rounded text-center">
                        <div className="text-[9px] uppercase text-gray-500">Stop Loss</div>
                        <div className="text-red-400 text-xs font-bold">${stopLoss.toFixed(2)}</div>
                    </div>
                    <div className="border border-green-900/50 bg-green-950/20 p-2 rounded text-center">
                        <div className="text-[9px] uppercase text-gray-500">Take Profit</div>
                        <div className="text-green-400 text-xs font-bold">${takeProfit.toFixed(2)}</div>
                    </div>
                </div>
                )}
                <div className="border border-gray-800 bg-black/40 p-3 rounded">
                    <div className="flex justify-between text-[10px] uppercase text-gray-500 mb-1">
                        <span>Expected Impact</span>
                        <span>{expectedImpact.toFixed(2)} bps</span>
                    </div>
                    <div className="w-full h-1 bg-gray-800 rounded overflow-hidden">
                        <div
                            className={`h-full ${expectedImpact > 8 ? 'bg-red-500' : expectedImpact > 4 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(100, expectedImpact * 5)}%` }}
                        />
                    </div>
                </div>
                <div className="border border-gray-800 bg-black/40 p-3 rounded">
                    <div className="text-[10px] uppercase text-gray-500">Open Interest (Composite)</div>
                    <div className="text-gray-300 font-bold">{oi.toFixed(0)}</div>
                </div>
                {!conviction && (
                    <div className="border border-dashed border-gray-800 bg-black/30 p-3 rounded text-[10px] uppercase text-gray-600">
                        {stream.connected ? 'No active conviction for selected symbol' : 'Waiting for stream to restore risk context'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PortfolioRiskPanel;
