'use client';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Globe, RefreshCw } from 'lucide-react';
import ArbScanner from '@/components/trading/ArbScanner';
import AddWalletModal from '@/components/modals/AddWalletModal';
import ImportModal from '@/components/modals/ImportModal';

export default function ArbPage() {
    const { isCollapsed } = useSidebar();
    const [showAdd, setShowAdd] = useState(false);
    const [showImport, setShowImport] = useState(false);

    return (
        <div className="h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white flex overflow-hidden">
            <Sidebar
                currentView="arb"
                onViewChange={() => { }}
                onImport={() => setShowImport(true)}
                onAdd={() => setShowAdd(true)}
            />

            <main className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'ml-20' : 'ml-64'} h-full`}>
                {/* Header */}
                <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            <Globe className="w-6 h-6 text-emerald-500" />
                            Arb Scanner
                        </h1>
                        <p className="text-gray-500 text-sm mt-1">Cross-venue funding rate arbitrage monitor.</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="px-3 py-1 rounded-full bg-gray-800 text-xs text-gray-400 border border-gray-700 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Hyperliquid Connected
                        </div>
                        <ConnectButton showBalance={false} accountStatus="avatar" />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 overflow-hidden">
                    <ArbScanner />
                </div>
            </main>

            <AddWalletModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => { }} />
            <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onSuccess={() => { }} />
        </div>
    );
}
