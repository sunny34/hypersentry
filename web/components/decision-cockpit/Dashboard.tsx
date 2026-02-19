"use client";
import { lazy, Suspense, memo } from 'react';
import { Loader2 } from 'lucide-react';
import { useAlphaStream } from '../../hooks/useAlphaStream';
import { useAlphaAutonomousExecution } from '../../hooks/useAlphaAutonomousExecution';
import GlobalStatusBar from './GlobalStatusBar';
import { useModeStore } from '../../store/useModeStore';

// Lazy load layout components — they pull in many heavy widgets
const ManualLayout = lazy(() => import('./layouts/ManualLayout'));
const AssistedLayout = lazy(() => import('./layouts/AssistedLayout'));
const AutonomousLayout = lazy(() => import('./layouts/AutonomousLayout'));

const LayoutLoader = memo(() => (
    <div className="flex-1 flex items-center justify-center bg-black/20">
        <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-gray-600" />
            <span className="text-[10px] font-mono uppercase text-gray-600 tracking-widest">Initializing Systems...</span>
        </div>
    </div>
));
LayoutLoader.displayName = 'LayoutLoader';

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
                <Suspense fallback={<LayoutLoader />}>
                    {renderLayout()}
                </Suspense>
            </div>
        </div>
    );
};

export default Dashboard;
