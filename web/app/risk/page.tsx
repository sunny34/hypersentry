'use client';

import Sidebar from '@/components/Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import AddWalletModal from '@/components/modals/AddWalletModal';
import ImportModal from '@/components/modals/ImportModal';
import { useState } from 'react';
import RiskSimulator from '@/components/trading/RiskSimulator';

export default function RiskPage() {
    const { isCollapsed } = useSidebar();
    const [showAdd, setShowAdd] = useState(false);
    const [showImport, setShowImport] = useState(false);

    // Dummy functions for sidebar actions since this page is for simulation
    const handleAdd = () => setShowAdd(true);
    const handleImport = () => setShowImport(true);
    const handleSuccess = () => { };

    return (
        <div className="flex min-h-screen bg-[#050505] text-white font-sans selection:bg-indigo-500/30">
            <Sidebar
                onAdd={handleAdd}
                onImport={handleImport}
            />

            <main
                className={`flex-1 flex flex-col transition-all duration-300 ${isCollapsed ? 'ml-[80px]' : 'ml-[280px]'
                    }`}
            >
                {/* Header */}
                <header className="h-[73px] border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                            Monte Carlo Risk Simulator
                        </h1>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="bg-gray-800/50 rounded-full px-4 py-2 text-sm text-gray-400 border border-gray-700/50">
                            Offline Mode (Client-Side)
                        </div>
                        <ConnectButton />
                    </div>
                </header>

                <div className="flex-1 overflow-hidden">
                    <RiskSimulator />
                </div>
            </main>

            <AddWalletModal
                isOpen={showAdd}
                onClose={() => setShowAdd(false)}
                onSuccess={handleSuccess}
            />
            <ImportModal
                isOpen={showImport}
                onClose={() => setShowImport(false)}
                onSuccess={handleSuccess}
            />
        </div>
    );
}
