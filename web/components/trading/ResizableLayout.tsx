'use client';
import { ReactNode, CSSProperties } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

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
 * Uses react-resizable-panels for smooth, performant resizing and stability.
 */
export default function ResizableLayout({
    chartPanel,
    orderBookPanel,
    orderFormPanel,
    consolePanel,
    isMobile = false,
    visiblePanels = { chart: true, orderBook: true, orderForm: true, console: true }
}: ResizableLayoutProps & { visiblePanels?: Record<string, boolean> }) {
    // On mobile, just stack panels without resizing logic
    if (isMobile) {
        return (
            <div className="flex flex-col h-full w-full gap-1.5 overflow-y-auto">
                {visiblePanels.chart && <div className="h-[400px] shrink-0">{chartPanel}</div>}
                {(visiblePanels.orderBook || visiblePanels.orderForm) && (
                    <div className="flex gap-1.5 h-[350px] shrink-0">
                        {visiblePanels.orderBook && <div className="flex-1 bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">{orderBookPanel}</div>}
                        {visiblePanels.orderForm && <div className="flex-1 bg-[#0a0a0a] border border-white/5 rounded-xl p-3 overflow-y-auto">{orderFormPanel}</div>}
                    </div>
                )}
                {visiblePanels.console && <div className="h-40 shrink-0">{consolePanel}</div>}
            </div>
        );
    }

    const showRightSide = visiblePanels.orderBook || visiblePanels.orderForm;
    const showTopSection = visiblePanels.chart || showRightSide;

    return (
        <div className="h-full w-full">
            <Group orientation="vertical" style={groupStyle} id="main-group">
                {/* Top Section: Chart & Order Panels */}
                {showTopSection && (
                    <>
                        <Panel id="top" defaultSize="70%" minSize="30%" maxSize="90%" className="flex">
                            <Group orientation="horizontal" style={groupStyle} id="top-group">
                                {/* Left: Chart Panel */}
                                {visiblePanels.chart && (
                                    <>
                                        <Panel id="chart" defaultSize="60%" minSize="20%" className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden relative">
                                            {/* Container to ensure chart fits */}
                                            <div className="absolute inset-0">
                                                {chartPanel}
                                            </div>
                                        </Panel>
                                        {showRightSide && (
                                            <Separator
                                                className="flex items-center justify-center bg-transparent group transition-colors duration-300 z-50 w-3 -mx-1.5 cursor-col-resize hover:bg-blue-500/10 active:bg-blue-500/20"
                                                id="h-handle-chart"
                                            >
                                                <div className="rounded-full transition-all bg-white/10 group-hover:bg-blue-500 group-active:bg-blue-400 w-1 h-8" />
                                            </Separator>
                                        )}
                                    </>
                                )}

                                {/* Right side: Order Book + Order Form */}
                                {showRightSide && (
                                    <Panel id="right" defaultSize="40%" minSize="20%">
                                        <Group orientation="horizontal" style={groupStyle} id="right-group">
                                            {visiblePanels.orderBook && (
                                                <>
                                                    <Panel id="orderbook" defaultSize="50%" minSize="20%" className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden">
                                                        {orderBookPanel}
                                                    </Panel>
                                                    {visiblePanels.orderForm && (
                                                        <Separator
                                                            className="flex items-center justify-center bg-transparent group transition-colors duration-300 z-50 w-3 -mx-1.5 cursor-col-resize hover:bg-blue-500/10 active:bg-blue-500/20"
                                                            id="h-handle-ob"
                                                        >
                                                            <div className="rounded-full transition-all bg-white/10 group-hover:bg-blue-500 group-active:bg-blue-400 w-1 h-8" />
                                                        </Separator>
                                                    )}
                                                </>
                                            )}

                                            {visiblePanels.orderForm && (
                                                <Panel id="orderform" defaultSize="50%" minSize="20%" className="bg-[#0a0a0a] border border-white/5 rounded-xl p-3 overflow-y-auto">
                                                    {orderFormPanel}
                                                </Panel>
                                            )}
                                        </Group>
                                    </Panel>
                                )}
                            </Group>
                        </Panel>
                        {visiblePanels.console && (
                            <Separator
                                className="flex items-center justify-center bg-transparent group transition-colors duration-300 z-50 h-3 -my-1.5 cursor-row-resize hover:bg-blue-500/10 active:bg-blue-500/20"
                                id="v-handle-console"
                            >
                                <div className="rounded-full transition-all bg-white/10 group-hover:bg-blue-500 group-active:bg-blue-400 h-1 w-12" />
                            </Separator>
                        )}
                    </>
                )}

                {/* Bottom: Console Panel */}
                {visiblePanels.console && (
                    <Panel id="console" defaultSize="30%" minSize="10%" className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden relative">
                        <div className="absolute inset-0">
                            {consolePanel}
                        </div>
                    </Panel>
                )}
            </Group>
        </div>
    );
}

/**
 * Resizable version using react-resizable-panels
 * Deprecated: merged into default export
 */
export function ResizableLayoutWithPanels(props: ResizableLayoutProps) {
    return <ResizableLayout {...props} />;
}
