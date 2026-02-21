"use client";
import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';

const ExecutionMonitor = () => {
    const logs = useAlphaStore((s) => s.executionLogs);
    const stream = useAlphaStore((s) => s.stream);

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'EXEC': return 'text-emerald-500';
            case 'PLAN': return 'text-blue-500';
            case 'INTEL': return 'text-cyan-400';
            case 'SYSTEM': return 'text-yellow-500';
            default: return 'text-gray-500';
        }
    };

    const formatTime = (ts: number) => {
        const normalized = ts < 1_000_000_000_000 ? ts * 1000 : ts;
        return new Date(normalized).toLocaleTimeString('en-GB', { hour12: false });
    };

    const streamClass = stream.status === 'live'
        ? 'text-emerald-500'
        : stream.status === 'degraded'
            ? 'text-yellow-500'
            : 'text-red-500';

    return (
        <div className="h-full border-t border-gray-800 bg-black p-3 sm:p-4 text-[10px] font-mono overflow-y-auto">
            <div className="text-gray-400 mb-2 font-bold uppercase tracking-wider flex justify-between items-center gap-3">
                <span>&gt; Execution Log [LIVE]</span>
                <div className="flex items-center gap-3">
                    <span className={`text-[9px] ${streamClass}`}>{stream.status.toUpperCase()}</span>
                    {logs.length === 0 && <span className="text-[9px] animate-pulse text-gray-700 italic">Listening for events...</span>}
                </div>
            </div>

            <div className="space-y-1">
                {logs.map((log) => (
                    <div key={log.id} className="flex space-x-2 animate-in fade-in slide-in-from-left-1 duration-300">
                        <span className="text-gray-600 shrink-0">{formatTime(log.timestamp)}</span>
                        <span className={`${getTypeColor(log.type)} shrink-0 w-12`}>[{log.type}]</span>
                        <span className="text-gray-400">{log.message}</span>
                    </div>
                ))}

                {logs.length === 0 && (
                    <div className="text-gray-800 py-4 italic">
                        {stream.connected ? 'No execution events recorded in this session.' : 'Stream offline. No execution events yet.'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ExecutionMonitor;
