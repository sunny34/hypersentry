'use client';
import { ReactNode, CSSProperties } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';

interface ResizableLayoutProps {
    // Main chart area (left)
    chartPanel: ReactNode;
    // Order book + order form (right top panels)
    orderBookPanel: ReactNode;
    orderFormPanel: ReactNode;
    // Bottom console area
    consolePanel: ReactNode;
    // Optional: show mobile layout
    isMobile?: boolean;
}

// Custom styles needed for react-resizable-panels
const groupStyle: CSSProperties = {
    display: 'flex',
    height: '100%',
    width: '100%',
};

/**
 * ResizableLayout Component
 * 
 * Provides drag-to-resize functionality for the trading terminal panels.
 * Uses react-resizable-panels for smooth, performant resizing.
 */
export default function ResizableLayout({
    chartPanel,
    orderBookPanel,
    orderFormPanel,
    consolePanel,
    isMobile = false,
    visiblePanels = { chart: true, orderBook: true, orderForm: true, console: true }
}: ResizableLayoutProps & { visiblePanels?: Record<string, boolean> }) {
    // On mobile, just stack panels
    if (isMobile) {
        return (
            <div className="flex flex-col h-full w-full gap-1.5">
                {visiblePanels.chart && <div className="flex-1">{chartPanel}</div>}
                {visiblePanels.console && <div className="h-40">{consolePanel}</div>}
            </div>
        );
    }

    const showRightSide = visiblePanels.orderBook || visiblePanels.orderForm;
    const showTopSection = visiblePanels.chart || showRightSide;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '4px' }}>
            {/* Top Section: Chart & Order Panels */}
            {showTopSection && (
                <div style={{ flex: visiblePanels.console ? '1 1 60%' : '1 1 100%', minHeight: 0, display: 'flex', gap: '4px' }}>
                    {/* Left: Chart Panel */}
                    {visiblePanels.chart && (
                        <div style={{ flex: showRightSide ? '1 1 55%' : '1 1 100%', minWidth: 0 }} className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                            {chartPanel}
                        </div>
                    )}

                    {/* Right side: Order Book + Order Form */}
                    {showRightSide && (
                        <div style={{ flex: visiblePanels.chart ? '1 1 45%' : '1 1 100%', minWidth: 0, display: 'flex', gap: '4px' }}>
                            {/* Order Book */}
                            {visiblePanels.orderBook && (
                                <div style={{ flex: visiblePanels.orderForm ? '1 1 50%' : '1 1 100%', minWidth: 0 }} className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                                    {orderBookPanel}
                                </div>
                            )}

                            {/* Order Form */}
                            {visiblePanels.orderForm && (
                                <div style={{ flex: visiblePanels.orderBook ? '1 1 50%' : '1 1 100%', minWidth: 0 }} className="bg-[#0a0a0a] border border-white/5 rounded-xl p-3 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                                    {orderFormPanel}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Bottom: Console Panel */}
            {visiblePanels.console && (
                <div style={{ flex: showTopSection ? '0 0 40%' : '1 1 100%', minHeight: 0 }} className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                    {consolePanel}
                </div>
            )}
        </div>
    );
}

/**
 * Resizable version using react-resizable-panels
 * Can be toggled on when the basic layout is confirmed working
 */
export function ResizableLayoutWithPanels({
    chartPanel,
    orderBookPanel,
    orderFormPanel,
    consolePanel,
}: ResizableLayoutProps) {
    return (
        <Group orientation="vertical" style={groupStyle}>
            {/* Top Section */}
            <Panel id="top" defaultSize={60} minSize={30} maxSize={80}>
                <Group orientation="horizontal" style={groupStyle}>
                    {/* Chart Panel */}
                    <Panel id="chart" defaultSize={55} minSize={30} maxSize={75}>
                        <div className="h-full w-full bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                            {chartPanel}
                        </div>
                    </Panel>

                    <Separator className="w-1 mx-0.5 bg-white/10 hover:bg-[var(--color-primary)]/50 cursor-col-resize transition-colors" />

                    {/* Right side */}
                    <Panel id="right" defaultSize={45} minSize={25}>
                        <Group orientation="horizontal" style={groupStyle}>
                            <Panel id="orderbook" defaultSize={50} minSize={30}>
                                <div className="h-full w-full bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                                    {orderBookPanel}
                                </div>
                            </Panel>

                            <Separator className="w-1 mx-0.5 bg-white/10 hover:bg-[var(--color-primary)]/50 cursor-col-resize transition-colors" />

                            <Panel id="orderform" defaultSize={50} minSize={25}>
                                <div className="h-full w-full bg-[#0a0a0a] border border-white/5 rounded-xl p-3 overflow-y-auto">
                                    {orderFormPanel}
                                </div>
                            </Panel>
                        </Group>
                    </Panel>
                </Group>
            </Panel>

            <Separator className="h-1 my-0.5 bg-white/10 hover:bg-[var(--color-primary)]/50 cursor-row-resize transition-colors" />

            {/* Console Panel */}
            <Panel id="console" defaultSize={40} minSize={15} maxSize={60}>
                <div className="h-full w-full bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                    {consolePanel}
                </div>
            </Panel>
        </Group>
    );
}
