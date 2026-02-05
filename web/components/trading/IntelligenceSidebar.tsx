'use client';
import { useState } from 'react';
import { Activity, Users, Newspaper, ChevronRight, ChevronLeft, Brain, Zap, TrendingUp, TrendingDown, AlertTriangle, ExternalLink } from 'lucide-react';
import dynamic from 'next/dynamic';

// Lazy load components
const TwapIntelligence = dynamic(() => import('./TwapIntelligence'), { ssr: false });
const CohortSentiment = dynamic(() => import('./CohortSentiment'), { ssr: false });
const NewsFeed = dynamic(() => import('./NewsFeed'), { ssr: false });

interface IntelligenceSidebarProps {
    symbol: string;
    isOpen: boolean;
    onToggle: () => void;
    aiBias?: 'bullish' | 'bearish' | 'neutral';
}

type TabType = 'twap' | 'social' | 'news';

export default function IntelligenceSidebar({ symbol, isOpen, onToggle, aiBias = 'neutral' }: IntelligenceSidebarProps) {
    const [activeTab, setActiveTab] = useState<TabType>('twap');

    const tabs = [
        { id: 'twap' as TabType, label: 'TWAP', icon: Activity, color: 'purple' },
        { id: 'social' as TabType, label: 'Social', icon: Users, color: 'teal' },
        { id: 'news' as TabType, label: 'News', icon: Newspaper, color: 'blue' },
    ];

    if (!isOpen) {
        // Collapsed state - show toggle button
        return (
            <div className="fixed right-0 top-1/2 -translate-y-1/2 z-40">
                <button
                    onClick={onToggle}
                    className="bg-purple-600/90 hover:bg-purple-500 text-white px-2 py-4 rounded-l-xl shadow-lg transition-all flex flex-col items-center gap-2"
                >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="text-[9px] font-bold writing-mode-vertical rotate-180" style={{ writingMode: 'vertical-rl' }}>
                        INTEL
                    </span>
                    <Brain className="w-4 h-4" />
                </button>
            </div>
        );
    }

    return (
        <div className="w-[380px] h-full bg-[#0a0a0a] border-l border-white/10 flex flex-col shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-500/10 to-transparent border-b border-purple-500/20">
                <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-white">Intelligence Hub</h3>
                        <span className="text-[9px] text-gray-500">{symbol} • Real-time Analysis</span>
                    </div>
                </div>
                <button
                    onClick={onToggle}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                >
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
            </div>

            {/* Tab Selector */}
            <div className="flex border-b border-white/5 bg-black/30">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-2.5 flex flex-col items-center gap-1 transition-all ${activeTab === tab.id
                                ? `bg-${tab.color}-500/10 border-b-2 border-${tab.color}-500`
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                            }`}
                    >
                        <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? `text-${tab.color}-400` : ''}`} />
                        <span className={`text-[9px] font-black uppercase ${activeTab === tab.id ? `text-${tab.color}-400` : ''}`}>
                            {tab.label}
                        </span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'twap' && (
                    <TwapIntelligence symbol={symbol} />
                )}
                {activeTab === 'social' && (
                    <CohortSentiment symbol={symbol} />
                )}
                {activeTab === 'news' && (
                    <NewsFeed symbol={symbol} aiBias={aiBias} />
                )}
            </div>
        </div>
    );
}
