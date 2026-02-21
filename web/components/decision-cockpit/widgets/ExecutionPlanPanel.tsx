"use client";
import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';

const ExecutionPlanPanel = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol || 'BTC');
    const plan = useAlphaStore((s) => s.executionPlans[activeSymbol]);
    const stream = useAlphaStore((s) => s.stream);
    const streamHint = stream.connected ? 'No tradeable edge yet' : 'Waiting for market stream';

    return (
        <div className="flex-1 border-t border-gray-800 bg-gray-900/20 p-4 sm:p-6 flex flex-col">
            <h3 className="text-xs sm:text-sm text-blue-400 font-bold uppercase tracking-widest mb-4">Proposed Execution Plan :: {activeSymbol}</h3>
            {!plan ? (
                <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-lg">
                    <div className="text-center px-4">
                        <div className="text-gray-600 font-mono text-xs uppercase tracking-widest">No Active Plan</div>
                        <div className="text-[10px] text-gray-700 font-mono mt-1 uppercase">{streamHint}</div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 border border-gray-800 rounded-lg p-3 sm:p-4 font-mono text-xs bg-black/30 overflow-y-auto">
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                        <div>
                            <div className="text-gray-500 uppercase text-[10px]">Strategy</div>
                            <div className="text-white font-bold">{plan.strategy}</div>
                        </div>
                        <div>
                            <div className="text-gray-500 uppercase text-[10px]">Size</div>
                            <div className="text-blue-400 font-bold">${plan.total_size_usd.toFixed(0)}</div>
                        </div>
                        <div>
                            <div className="text-gray-500 uppercase text-[10px]">Urgency</div>
                            <div className="text-yellow-400 font-bold">{(plan.urgency_score * 100).toFixed(0)}%</div>
                        </div>
                        {plan.direction && (
                            <div>
                                <div className="text-gray-500 uppercase text-[10px]">Direction</div>
                                <div className={`font-bold ${plan.direction === 'BUY' ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {plan.direction}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="mb-3 text-[10px] uppercase text-gray-500">Slices</div>
                    <div className="space-y-2">
                        {plan.slices.map((slice) => (
                            <div key={slice.slice_id} className="grid grid-cols-2 lg:grid-cols-5 gap-2 border-b border-gray-900 pb-1 text-[11px]">
                                <span className="text-gray-500">#{slice.slice_id}</span>
                                <span className="text-gray-300">{slice.order_type || slice.type || 'LIMIT'}</span>
                                <span className="text-gray-300">{slice.direction || 'N/A'}</span>
                                <span className="text-gray-300">${(slice.amount_usd ?? slice.size ?? 0).toFixed(0)}</span>
                                <span className="text-gray-500">{slice.delay_ms}ms</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExecutionPlanPanel;
