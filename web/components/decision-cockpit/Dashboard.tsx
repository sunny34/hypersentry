"use client";

import { useAlphaStream } from '../../hooks/useAlphaStream';
import { useAlphaAutonomousExecution } from '../../hooks/useAlphaAutonomousExecution';
import GlobalStatusBar from './GlobalStatusBar';
import ManualLayout from './layouts/ManualLayout';
import AssistedLayout from './layouts/AssistedLayout';
import AutonomousLayout from './layouts/AutonomousLayout';
import { useModeStore } from '../../store/useModeStore';

const Dashboard = () => {
    // Start WebSocket Stream
    useAlphaStream();
    useAlphaAutonomousExecution();

    const { mode } = useModeStore();

    const renderLayout = () => {
        switch (mode) {
            case 'manual':
                return <ManualLayout />;
            case 'assisted':
                return <AssistedLayout />;
            case 'autonomous':
                return <AutonomousLayout />;
            default:
                return <ManualLayout />;
        }
    };

    return (
        <div className="w-full h-[100dvh] min-h-[100dvh] bg-black text-white font-mono overflow-hidden flex flex-col">
            {/* 1. Global Status Bar (Top) */}
            <GlobalStatusBar />

            {/* 2. Main Workspace (Mode-Aware Layout) */}
            <div className="flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_top_right,rgba(15,23,42,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(10,15,26,0.18),transparent_55%)]">
                {renderLayout()}
            </div>
        </div>
    );
};

export default Dashboard;
