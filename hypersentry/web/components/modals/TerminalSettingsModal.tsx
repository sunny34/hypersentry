'use client';
import React from 'react';
import { X, Settings, Layout, Eye, EyeOff, RotateCcw, Monitor, Laptop, Smartphone } from 'lucide-react';
import { useTerminalSettings } from '@/contexts/TerminalSettingsContext';
import { motion, AnimatePresence } from 'framer-motion';

interface TerminalSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function TerminalSettingsModal({ isOpen, onClose }: TerminalSettingsModalProps) {
    const { settings, updateTabVisibility, updatePanelVisibility, resetSettings } = useTerminalSettings();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <Settings className="w-5 h-5 text-purple-400" />
                        <h2 className="text-sm font-black uppercase tracking-widest text-white">Terminal Config</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto scrollbar-hide">
                    {/* Console Hub Tabs */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Layout className="w-4 h-4 text-blue-400" />
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400">Intelligence Hub Tabs</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                            {settings.tabs.map(tab => (
                                <div
                                    key={tab.id}
                                    onClick={() => updateTabVisibility(tab.id, !tab.enabled)}
                                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${tab.enabled
                                            ? 'bg-white/[0.05] border-white/20'
                                            : 'bg-white/[0.01] border-white/5 opacity-50'
                                        }`}
                                >
                                    <span className="text-xs font-bold text-white uppercase tracking-tight">{tab.label}</span>
                                    {tab.enabled ? (
                                        <Eye className="w-4 h-4 text-blue-400" />
                                    ) : (
                                        <EyeOff className="w-4 h-4 text-gray-600" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Modules Visibility */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Monitor className="w-4 h-4 text-orange-400" />
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-gray-400">Terminal Modules</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                            {settings.panels.map(panel => (
                                <div
                                    key={panel.id}
                                    onClick={() => updatePanelVisibility(panel.id, !panel.enabled)}
                                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${panel.enabled
                                            ? 'bg-white/[0.05] border-white/20'
                                            : 'bg-white/[0.01] border-white/5 opacity-50'
                                        }`}
                                >
                                    <span className="text-xs font-bold text-white uppercase tracking-tight">{panel.label}</span>
                                    {panel.enabled ? (
                                        <Eye className="w-4 h-4 text-orange-400" />
                                    ) : (
                                        <EyeOff className="w-4 h-4 text-gray-600" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                    <button
                        onClick={resetSettings}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset All
                    </button>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all shadow-lg active:scale-95"
                    >
                        Save & Exit
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
