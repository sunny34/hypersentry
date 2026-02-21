'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Zap, Target, Activity, Clock, Trash2, X } from 'lucide-react';

export interface AuditEntry {
    id: string;
    timestamp: number;
    type: 'order' | 'signal' | 'system' | 'navigation';
    title: string;
    message: string;
    status: 'success' | 'warning' | 'error' | 'info';
}

interface AuditLogProps {
    entries: AuditEntry[];
    onClear?: () => void;
    onClose?: () => void;
    className?: string;
}

export default function AuditLog({ entries, onClear, onClose, className }: AuditLogProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new entries
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [entries]);

    const getIcon = (type: AuditEntry['type']) => {
        switch (type) {
            case 'order': return <Target className="w-3.5 h-3.5" />;
            case 'signal': return <Zap className="w-3.5 h-3.5 text-amber-500" />;
            case 'system': return <Shield className="w-3.5 h-3.5 text-blue-500" />;
            case 'navigation': return <Activity className="w-3.5 h-3.5 text-gray-500" />;
            default: return <Clock className="w-3.5 h-3.5" />;
        }
    };

    const getStatusColor = (status: AuditEntry['status']) => {
        switch (status) {
            case 'success': return 'text-emerald-400';
            case 'warning': return 'text-amber-400';
            case 'error': return 'text-red-400';
            case 'info': return 'text-blue-400';
            default: return 'text-gray-400';
        }
    };

    return (
        <div className={`flex flex-col h-full bg-[#050505] border border-white/5 rounded-xl overflow-hidden shadow-2xl ${className}`}>
            {/* Header */}
            <div className="px-4 py-3 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-gray-500" />
                    <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Terminal Audit Log</span>
                </div>
                <div className="flex items-center gap-2">
                    {onClear && (
                        <button
                            onClick={onClear}
                            className="p-1.5 hover:bg-white/5 rounded-lg text-gray-600 hover:text-red-400 transition-all"
                            title="Clear Logs"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-white/5 rounded-lg text-gray-600 hover:text-white transition-all"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Log List */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar"
            >
                {entries.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 py-12">
                        <Shield className="w-12 h-12 mb-4" />
                        <span className="text-xs font-black uppercase tracking-widest">No terminal events</span>
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {entries.map((entry) => (
                            <motion.div
                                key={entry.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.2 }}
                                className="group/entry flex gap-4 p-3 bg-white/[0.02] border border-white/5 rounded-lg hover:bg-white/[0.04] hover:border-white/10 transition-all"
                            >
                                <div className={`mt-0.5 p-2 rounded-lg bg-black border border-white/5 ${getStatusColor(entry.status)} shadow-inner`}>
                                    {getIcon(entry.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className={`text-xs font-black uppercase tracking-tight ${getStatusColor(entry.status)} group-hover/entry:translate-x-0.5 transition-transform`}>
                                            {entry.title}
                                        </h4>
                                        <span className="text-[9px] font-mono text-gray-600">
                                            {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-gray-500 leading-relaxed font-medium">
                                        {entry.message}
                                    </p>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-white/[0.01] border-t border-white/5 text-center">
                <span className="text-[8px] text-gray-700 font-black uppercase tracking-[0.3em]">Institutional Grade Action Tracking</span>
            </div>
        </div>
    );
}
