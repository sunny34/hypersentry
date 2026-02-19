"use client";
import React from 'react';
import PortfolioRiskPanel from '../widgets/PortfolioRiskPanel';
import ExecutionMonitor from '../widgets/ExecutionMonitor';
import ModelHealthWidget from '../widgets/ModelHealthWidget';
import KillSwitch from '../widgets/KillSwitch';
import AuthControlPanel from '../widgets/AuthControlPanel';
import SimpleSignalPanel from '../widgets/SimpleSignalPanel';
import { useAlphaStore } from '../../../store/useAlphaStore';

const AutonomousLayout = () => {
    const convictions = useAlphaStore((s) => s.convictions);
    const executionLogs = useAlphaStore((s) => s.executionLogs);
    const executionPlans = useAlphaStore((s) => s.executionPlans);

    const convictionList = Object.values(convictions);
    const avgConviction = convictionList.length
        ? convictionList.reduce((sum, item) => sum + item.score, 0) / convictionList.length
        : 50;
    const longSignals = convictionList.filter((item) => item.bias === 'LONG').length;
    const shortSignals = convictionList.filter((item) => item.bias === 'SHORT').length;
    const activePlans = Object.keys(executionPlans).length;
    const topSignals = Object.entries(convictions)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 8);
    const traceLogs = executionLogs.slice(0, 6);

    return (
        <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-0 overflow-y-auto lg:overflow-hidden">
            {/* Left: System Governance + Signals */}
            <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col bg-gray-950/20 min-h-[320px]">
                <div className="h-10 bg-gray-950 px-4 flex items-center border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Governance :: Health
                </div>
                <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                    <ModelHealthWidget />

                    <div className="pt-6 border-t border-gray-900 border-dashed">
                        <KillSwitch />
                    </div>

                    <AuthControlPanel />

                    <div className="p-4 bg-blue-950/10 border border-blue-500/20 rounded flex flex-col space-y-2">
                        <span className="text-blue-400 text-[10px] font-bold uppercase tracking-widest">Autonomous Strategy</span>
                        <span className="text-white text-xs font-mono">DYNAMIC_EXECUTION_LOOP</span>
                        <p className="text-[9px] text-gray-500 leading-relaxed">
                            Continuous venue-aware signal ingestion with automated risk gating and execution slicing.
                        </p>
                    </div>
                </div>
                <div className="flex-1 bg-black/40 p-4 font-mono text-[9px] text-gray-700 overflow-hidden min-h-[120px]">
                    <div className="uppercase mb-2 text-gray-500 font-bold border-b border-gray-800 pb-1">Inference Trace</div>
                    {traceLogs.length === 0 ? (
                        <div className="text-gray-700 italic">Waiting for live trace logs...</div>
                    ) : (
                        <div className="space-y-1">
                            {traceLogs.map((log) => (
                                <div key={log.id}>
                                    [TRACE] {new Date(log.timestamp).toLocaleTimeString('en-GB', { hour12: false })} :: {log.message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Center: Portfolio & Signals */}
            <div className="lg:col-span-9 flex flex-col bg-black min-h-[420px]">
                <div className="flex-1 p-4 sm:p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
                    {/* Simplified Signal Panel - NEW */}
                    <div className="xl:col-span-1 border border-gray-800 bg-gray-900/10 p-2 overflow-hidden">
                        <SimpleSignalPanel />
                    </div>
                    
                    {/* Portfolio Risk */}
                    <div className="xl:col-span-1 border border-gray-800 bg-gray-900/10 p-2 overflow-hidden">
                        <PortfolioRiskPanel />
                    </div>
                    
                    {/* Stats Column */}
                    <div className="xl:col-span-1 flex flex-col space-y-6">
                        {/* High level performance / risk metrics for autonomous */}
                        <div className="grid grid-cols-2 gap-4 h-32">
                            <div className="bg-gray-950 border border-gray-800 rounded flex flex-col items-center justify-center">
                                <span className="text-white text-3xl font-black tracking-tighter">{avgConviction.toFixed(1)}</span>
                                <span className="text-[10px] text-gray-500 uppercase">Avg Conviction</span>
                            </div>
                            <div className="bg-gray-950 border border-gray-800 rounded flex flex-col items-center justify-center">
                                <span className="text-green-500 text-3xl font-black tracking-tighter">{activePlans}</span>
                                <span className="text-[10px] text-gray-500 uppercase">Active Plans</span>
                            </div>
                        </div>

                        <div className="flex-1 border border-gray-800 bg-black p-4 text-[10px] font-mono uppercase border-dashed overflow-y-auto">
                            <div className="text-gray-500 mb-3">Live Signal Heatmap</div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-gray-400">
                                    <span>Long Signals</span>
                                    <span>{longSignals}</span>
                                </div>
                                <div className="flex justify-between text-gray-400 border-b border-gray-900 pb-2">
                                    <span>Short Signals</span>
                                    <span>{shortSignals}</span>
                                </div>
                                {topSignals.map(([symbol, signal]) => (
                                    <div key={symbol} className="flex justify-between">
                                        <span className="text-gray-500">{symbol}</span>
                                        <span className={signal.score >= 60 ? 'text-green-500' : signal.score <= 40 ? 'text-red-500' : 'text-gray-400'}>
                                            {signal.score}
                                        </span>
                                    </div>
                                ))}
                                {topSignals.length === 0 && <div className="text-gray-700">No live signals yet.</div>}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Expanded Execution Monitor */}
                <div className="h-48 lg:h-64 border-t border-gray-800">
                    <ExecutionMonitor />
                </div>
            </div>
        </div>
    );
};

export default AutonomousLayout;
