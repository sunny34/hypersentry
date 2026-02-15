"use client";
import React from 'react';

const KillSwitch = () => {
    return (
        <div className="w-full p-6 bg-red-950/20 border border-red-500/50 rounded flex items-center justify-between">
            <div className="flex flex-col">
                <span className="text-red-500 font-black text-lg tracking-tighter uppercase">KILL SWITCH</span>
                <span className="text-[10px] text-red-400 font-mono">Immediate liquidation of all positions</span>
                <span className="text-[9px] text-red-500/80 font-mono mt-1 uppercase">Requires server-side approval channel</span>
            </div>
            <button
                type="button"
                disabled
                className="bg-red-900/40 text-red-200/70 font-bold py-2 px-6 rounded uppercase text-sm tracking-widest cursor-not-allowed border border-red-500/40"
            >
                ACTIVATE
            </button>
        </div>
    );
};

export default KillSwitch;
