import React, { useState } from 'react';
import { Layers, Activity, Maximize2, X, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MicrostructureAI from './MicrostructureAI';
import OrderflowDominance from './OrderflowDominance';

interface MicrostructureHUDProps {
    symbol: string;
    onClose: () => void;
    isMinimized?: boolean;
    onToggleMinimize?: () => void;
}

export const MicrostructureHUD: React.FC<MicrostructureHUDProps> = ({
    symbol,
    onClose,
    isMinimized = false,
    onToggleMinimize
}) => {
    // Top-level drag logic omitted for simplicity; typically rely on Framer Motion drag 
    // or a fixed overlay approach

    if (isMinimized) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-4 right-4 z-50 bg-gray-900 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)] rounded-full px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-800 transition-colors"
                onClick={onToggleMinimize}
            >
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-white tracking-widest">{symbol} HUD</span>
                <Maximize2 className="w-3.5 h-3.5 text-gray-400" />
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            drag
            dragMomentum={false}
            dragConstraints={{ top: 0, bottom: window.innerHeight - 400, left: 0, right: window.innerWidth - 600 }}
            className="fixed top-24 right-24 z-50 w-[700px] h-[450px] bg-[#050505]/95 backdrop-blur-3xl border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.15)] rounded-2xl flex flex-col overflow-hidden"
        >
            {/* Header Handle */}
            <div className="flex-none p-4 w-full border-b border-white/5 flex justify-between items-center cursor-move bg-gray-950/50">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <Layers className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">{symbol} Microstructure</h3>
                        <p className="text-[10px] text-emerald-400/70 font-mono flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                            Live Tick Aggregation
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onToggleMinimize}
                        className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors cursor-pointer"
                    >
                        <Minimize2 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-red-500/20 rounded-lg text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 grid grid-cols-2 overflow-hidden bg-[#050505]">
                <div className="h-full overflow-hidden border-r border-white/5">
                    <OrderflowDominance symbol={symbol} />
                </div>
                <div className="h-full overflow-hidden">
                    <MicrostructureAI symbol={symbol} />
                </div>
            </div>

            <div className="h-8 bg-black flex items-center px-4 justify-between border-t border-emerald-500/20">
                <div className="text-[9px] font-mono text-emerald-500/70">HUD: Actionable Metrics Overlay</div>
                <div className="text-[9px] font-mono text-emerald-500 flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    LIVE DATA
                </div>
            </div>
        </motion.div>
    );
};

export default MicrostructureHUD;
