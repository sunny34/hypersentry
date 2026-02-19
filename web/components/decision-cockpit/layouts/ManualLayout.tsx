"use client";
import React from 'react';
import OpportunityTable from '../OpportunityTable';
import ConvictionPanel from '../ConvictionPanel';
import SignalBreakdown from '../widgets/SignalBreakdown';
import ExecutionMonitor from '../widgets/ExecutionMonitor';
import SimpleSignalPanel from '../widgets/SimpleSignalPanel';
import { useAlphaStore } from '../../../store/useAlphaStore';

const ManualLayout = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol);
    const convictions = useAlphaStore((s) => s.convictions);
    const stream = useAlphaStore((s) => s.stream);
    const logs = useAlphaStore((s) => s.executionLogs);
    const trackedSymbols = Object.keys(convictions).length;

    return (
        <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-0 overflow-y-auto lg:overflow-hidden">
            {/* Left: Scanner */}
            <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col min-h-[220px] max-h-[38vh] lg:max-h-none">
                <div className="h-10 bg-gray-950 px-4 flex items-center border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Scan :: Opportunities
                </div>
                <div className="flex-1 overflow-auto">
                    <OpportunityTable />
                </div>
            </div>

            {/* Center: Radar */}
            <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col bg-gradient-to-br from-black to-gray-900">
                <div className="flex-1 p-4 sm:p-8 lg:p-12 flex items-center justify-center">
                    <div className="w-full max-w-2xl lg:transform lg:scale-110">
                        <ConvictionPanel symbol={activeSymbol || 'BTC'} />
                    </div>
                </div>
                {/* Minimal Execution Monitor */}
                <div className="h-28 lg:h-24">
                    <ExecutionMonitor />
                </div>
            </div>

            {/* Right: Analytics + Simplified Signals */}
            <div className="lg:col-span-3 flex flex-col min-h-[280px]">
                {/* Simplified Signal Panel */}
                <div className="h-[300px] border-b border-gray-800">
                    <SimpleSignalPanel />
                </div>
                
                {/* Signal Breakdown */}
                <div className="min-h-[180px] lg:min-h-0">
                    <SignalBreakdown />
                </div>
                <div className="flex-1 bg-gray-950/20 p-4 sm:p-6 flex flex-col justify-center text-gray-700 text-[10px] font-mono uppercase">
                    <div className="text-gray-500 mb-2 tracking-widest">Telemetry</div>
                    <div className="space-y-1">
                        <div>Stream: <span className={stream.status === 'live' ? 'text-green-500' : stream.status === 'degraded' ? 'text-yellow-500' : 'text-red-500'}>{stream.status}</span></div>
                        <div>Tracked symbols: <span className="text-gray-400">{trackedSymbols}</span></div>
                        <div>Execution events: <span className="text-gray-400">{logs.length}</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManualLayout;
