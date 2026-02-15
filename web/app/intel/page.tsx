'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import Sidebar from '@/components/Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import {
    Fish,
    Binary,
    Globe,
    ShieldAlert,
    ChevronRight,
    Activity,
    LineChart,
    Zap,
    BrainCircuit
} from 'lucide-react';
import { useState } from 'react';

export default function IntelHub() {
    const { isCollapsed } = useSidebar();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const modules = [
        {
            title: "Whale Tracker",
            description: "Real-time surveillance of top 50 profitable traders. Detect accumulation, dumps, and flips instantly.",
            icon: Fish,
            href: "/whales",
            color: "cyan",
            stat: "LIVE FEED"
        },
        {
            title: "Market Microstructure",
            description: "Institutional grade analysis of order flow, CVD divergence, and passive liquidity walls.",
            icon: Binary,
            href: "/intel/microstructure",
            color: "emerald",
            stat: "DEEP DATA"
        },
        {
            title: "Arbitrage Scanner",
            description: "Cross-venue funding rate arbitrage monitor. Spot opportunities between Hyperliquid and CEXs.",
            icon: Globe,
            href: "/arb",
            color: "amber",
            stat: "OPPORTUNITY"
        },
        {
            title: "Risk Simulator",
            description: "Monte Carlo simulation for portfolio stress testing and liquidation risk analysis.",
            icon: ShieldAlert,
            href: "/risk",
            color: "rose",
            stat: "BETA"
        }
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 text-white font-sans flex">
            <Sidebar
                currentView="intel"
                onViewChange={() => { }}
                isMobileOpen={mobileMenuOpen}
                onMobileClose={() => setMobileMenuOpen(false)}
            />

            <main className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'lg:ml-20' : 'lg:ml-64'} ml-0`}>

                {/* Header */}
                <header className="p-8 pb-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
                            <BrainCircuit className="w-6 h-6 text-purple-400" />
                        </div>
                        <h1 className="text-3xl font-black tracking-tight">Intelligence <span className="text-gray-600">Hub</span></h1>
                    </div>
                    <p className="text-gray-500 max-w-2xl text-sm">
                        Central command for alpha generation. Select a module to begin analysis.
                    </p>
                </header>

                {/* Grid */}
                <div className="flex-1 p-8 pt-4 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl">
                        {modules.map((mod, i) => (
                            <Link href={mod.href} key={mod.title}>
                                <motion.div
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className={`group relative h-full bg-gray-900/40 border border-gray-800/50 hover:border-${mod.color}-500/30 rounded-3xl p-6 transition-all duration-300 overflow-hidden`}
                                >
                                    {/* Gradient Background */}
                                    <div className={`absolute inset-0 bg-gradient-to-br from-${mod.color}-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                                    <div className="relative z-10 flex flex-col h-full justify-between gap-6">
                                        <div className="flex justify-between items-start">
                                            <div className={`p-3 rounded-2xl bg-${mod.color}-500/10 border border-${mod.color}-500/20 group-hover:shadow-[0_0_20px_rgba(0,0,0,0.3)] transition-all`}>
                                                <mod.icon className={`w-6 h-6 text-${mod.color}-400`} />
                                            </div>
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded bg-${mod.color}-500/10 text-${mod.color}-400 border border-${mod.color}-500/20`}>
                                                {mod.stat}
                                            </span>
                                        </div>

                                        <div>
                                            <h3 className="text-xl font-bold mb-2 group-hover:text-white transition-colors">{mod.title}</h3>
                                            <p className="text-sm text-gray-500 font-medium leading-relaxed">
                                                {mod.description}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2 text-xs font-bold text-gray-600 group-hover:text-white transition-colors uppercase tracking-widest">
                                            Launch Module <ChevronRight className="w-4 h-4" />
                                        </div>
                                    </div>
                                </motion.div>
                            </Link>
                        ))}
                    </div>

                    {/* Quick Stats Strip */}
                    <div className="mt-12 p-6 rounded-3xl bg-white/[0.02] border border-white/5 max-w-5xl">
                        <div className="flex items-center gap-2 mb-6">
                            <Activity className="w-5 h-5 text-gray-500" />
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">System Status</h3>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                                { label: "Data Pipeline", status: "Operational", color: "text-emerald-500" },
                                { label: "Execution Engine", status: "Standby", color: "text-amber-500" },
                                { label: "Whale Nodes", status: "Connected (50/50)", color: "text-cyan-500" },
                                { label: "Sentiment AI", status: "Processing", color: "text-purple-500" }
                            ].map((s, i) => (
                                <div key={i} className="flex flex-col">
                                    <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">{s.label}</span>
                                    <span className={`text-sm font-black ${s.color} mt-0.5`}>{s.status}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
