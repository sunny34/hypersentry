"use client";
import React, { useState } from 'react';
import { useModeStore, SystemMode } from '../../store/useModeStore';

const ModeSwitcher = () => {
    const { mode, setMode } = useModeStore();
    const [isConfirming, setIsConfirming] = useState(false);

    const modes: { id: SystemMode; label: string; color: string }[] = [
        { id: 'manual', label: 'Manual', color: 'bg-blue-500' },
        { id: 'assisted', label: 'Assisted', color: 'bg-emerald-500' },
        { id: 'autonomous', label: 'Autonomous', color: 'bg-red-600' },
    ];

    const handleModeChange = (newMode: SystemMode) => {
        if (newMode === 'autonomous' && mode !== 'autonomous') {
            setIsConfirming(true);
        } else {
            setMode(newMode);
        }
    };

    return (
        <div className="flex items-center">
            <div className="bg-gray-900 p-1 rounded-md flex items-center gap-1 border border-gray-800 overflow-x-auto max-w-full">
                {modes.map((m) => {
                    const isActive = mode === m.id;
                    return (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => handleModeChange(m.id)}
                            aria-pressed={isActive}
                            className={`
                                px-2.5 sm:px-3 py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider sm:tracking-widest rounded transition-all duration-300 whitespace-nowrap
                                ${isActive ? `${m.color} text-white shadow-[0_0_15px_-5px_currentColor]` : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'}
                            `}
                        >
                            {m.label}
                        </button>
                    );
                })}
            </div>

            {/* Confirmation Modal */}
            {isConfirming && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-6 whitespace-normal">
                    <div className="max-w-md w-full bg-[linear-gradient(180deg,#060a18_0%,#05080f_100%)] border border-red-900/80 shadow-[0_20px_80px_rgba(0,0,0,0.75)] p-8 rounded-lg flex flex-col space-y-6 normal-case whitespace-normal tracking-normal">
                        <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center border border-red-600 animate-pulse">
                                <span className="text-red-500 text-2xl font-black">!</span>
                            </div>
                            <h2 className="text-xl font-black text-white uppercase tracking-tighter">Enable Autonomous Mode?</h2>
                        </div>

                        <div className="space-y-4 text-sm text-gray-400 font-mono leading-relaxed whitespace-normal break-words">
                            <p className="whitespace-normal break-words">WARNING: Enabling autonomous mode allows the engine to execute trades automatically based on current risk parameters.</p>
                            <p className="whitespace-normal break-words">Ensure your max drawdown limits and slippage tolerances are correctly calibrated before proceeding.</p>
                        </div>

                        <div className="flex space-x-4">
                            <button
                                type="button"
                                onClick={() => setIsConfirming(false)}
                                className="flex-1 px-6 py-3 border border-gray-800 text-gray-400 hover:bg-gray-900 transition-colors uppercase font-bold text-xs tracking-widest"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMode('autonomous');
                                    setIsConfirming(false);
                                }}
                                className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-500 text-white transition-colors uppercase font-bold text-xs tracking-widest shadow-lg shadow-red-900/20"
                            >
                                Confirm Enable
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ModeSwitcher;
