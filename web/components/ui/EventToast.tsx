'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, TrendingUp, TrendingDown, X } from 'lucide-react';

export interface EventToastProps {
    title: string;
    message: string;
    type: 'bullish' | 'bearish' | 'neutral';
    isVisible: boolean;
    onClose: () => void;
}

export default function EventToast({ title, message, type, isVisible, onClose }: EventToastProps) {
    useEffect(() => {
        if (isVisible) {
            const timer = setTimeout(onClose, 8000); // Auto close after 8s
            return () => clearTimeout(timer);
        }
    }, [isVisible, onClose]);

    const getColors = () => {
        switch (type) {
            case 'bullish': return 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400';
            case 'bearish': return 'bg-red-500/10 border-red-500/50 text-red-400';
            default: return 'bg-blue-500/10 border-blue-500/50 text-blue-400';
        }
    };

    const getIcon = () => {
        switch (type) {
            case 'bullish': return <TrendingUp className="w-6 h-6" />;
            case 'bearish': return <TrendingDown className="w-6 h-6" />;
            default: return <AlertTriangle className="w-6 h-6" />;
        }
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, y: -50, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.9 }}
                    className="fixed top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                // Use pointer-events-auto on the content to allow clicking the close button
                >
                    <div className={`pointer-events-auto backdrop-blur-md border rounded-2xl p-4 shadow-2xl flex items-start gap-4 max-w-md w-full ${getColors()}`}>
                        <div className={`p-2 rounded-xl bg-white/5`}>
                            {getIcon()}
                        </div>
                        <div className="flex-1 pt-0.5">
                            <h3 className="font-bold text-lg leading-tight mb-1">
                                {title}
                            </h3>
                            <p className="text-sm opacity-90 leading-snug">
                                {message}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-white/10 rounded-lg transition"
                        >
                            <X className="w-4 h-4 opacity-60" />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
