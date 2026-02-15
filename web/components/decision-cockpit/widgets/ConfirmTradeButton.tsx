"use client";
import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';

const ConfirmTradeButton = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol || 'BTC');
    const plan = useAlphaStore((s) => s.executionPlans[activeSymbol]);
    const disabled = !plan;

    return (
        <div className="w-full p-4 border-t border-gray-800 bg-gray-950 flex justify-end">
            <button
                type="button"
                disabled={disabled}
                className={`px-4 sm:px-6 py-2 font-mono text-xs sm:text-sm uppercase rounded transition-colors ${
                    disabled ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-blue-800/40 text-blue-300 hover:bg-blue-700/40'
                }`}
            >
                {disabled ? 'Awaiting Signal...' : `Review ${activeSymbol} Plan`}
            </button>
        </div>
    );
};

export default ConfirmTradeButton;
