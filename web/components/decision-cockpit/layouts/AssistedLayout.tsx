"use client";
import React from 'react';
import OpportunityTable from '../OpportunityTable';
import ConvictionPanel from '../ConvictionPanel';
import ExecutionPlanPanel from '../widgets/ExecutionPlanPanel';
import ConfirmTradeButton from '../widgets/ConfirmTradeButton';
import PortfolioRiskPanel from '../widgets/PortfolioRiskPanel';
import { useAlphaStore } from '../../../store/useAlphaStore';

const AssistedLayout = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol);

    return (
        <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 gap-0 overflow-y-auto lg:overflow-y-auto">
            {/* Left: Opportunities (Smaller focus) */}
            <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col min-h-[200px] max-h-[34vh] lg:max-h-none">
                <div className="h-10 bg-gray-950 px-4 flex items-center border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Signals
                </div>
                <div className="flex-1 overflow-auto">
                    <OpportunityTable />
                </div>
            </div>

            {/* Center: Conviction & Proposed Plan */}
            <div className="lg:col-span-7 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col bg-black">
                <div className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col">
                    <div className="flex-1 flex items-center justify-center mb-6 lg:mb-8">
                        <div className="w-full max-w-xl">
                            <ConvictionPanel symbol={activeSymbol || 'BTC'} />
                        </div>
                    </div>
                    {/* Execution Plan is Prominent here */}
                    <div className="h-[18rem] lg:h-64 flex flex-col">
                        <ExecutionPlanPanel />
                        <ConfirmTradeButton />
                    </div>
                </div>
            </div>

            {/* Right: Risk Management */}
            <div className="lg:col-span-3 flex flex-col min-h-[280px] lg:min-h-0 lg:overflow-y-auto">
                <div className="h-[320px] lg:h-2/3">
                    <PortfolioRiskPanel />
                </div>
                <div className="flex-1 border-t border-gray-800 bg-gray-950 p-4 sm:p-6 text-gray-700 text-[10px] font-mono uppercase">
                    <div className="text-gray-500 mb-2 tracking-widest">Operator Checklist</div>
                    <div className="space-y-1 text-left">
                        <div>Confirm spread impact is within tolerance</div>
                        <div>Verify urgency does not exceed liquidity profile</div>
                        <div>Approve only when edge remains above cost</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AssistedLayout;
