"use client";
import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';

const ModelHealthWidget = () => {
    const { activeSymbol, governance, convictions } = useAlphaStore();
    const gov = activeSymbol ? governance[activeSymbol] : null;
    const health = gov?.calibration_status || 'OPTIMAL';
    const modelId = gov?.active_model_id || 'model_unassigned';
    const conviction = activeSymbol ? convictions[activeSymbol] : null;
    const calibrationPct = conviction
        ? Math.max(50, Math.min(99, 100 - (conviction.realized_vol * 100)))
        : 92.0;

    return (
        <div className="p-4 border border-gray-800 bg-gray-950/50 rounded flex flex-col space-y-3">
            <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">Model Intelligence</span>
                <span className={`text-[10px] font-bold ${health === 'OPTIMAL' ? 'text-emerald-500' : 'text-yellow-500'}`}>{health}</span>
            </div>

            <div className="flex flex-col">
                <span className="text-white text-xs font-mono">{modelId}</span>
                <div className="w-full h-1 bg-gray-800 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${calibrationPct}%` }}></div>
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-gray-600">Calibration Accuracy</span>
                    <span className="text-[9px] text-gray-400">{calibrationPct.toFixed(1)}%</span>
                </div>
            </div>
        </div>
    );
};

export default ModelHealthWidget;
