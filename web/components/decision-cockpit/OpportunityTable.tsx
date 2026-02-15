"use client";
import React, { useMemo, useState } from 'react';
import { useAlphaStore } from '../../store/useAlphaStore';

type SortField = 'symbol' | 'edge' | 'conviction' | 'expected_move';
type SortDirection = 'asc' | 'desc';
type ColumnKey = 'symbol' | 'edge' | 'conviction' | 'expected_move' | 'quality';
type OpportunityRow = {
    sym: string;
    score: number;
    expected_move: number;
    realized_vol: number;
    edgeScore: number;
    regime: string;
    timestamp: number;
};

const DEFAULT_COL_WIDTHS: Record<ColumnKey, number> = {
    symbol: 220,
    edge: 110,
    conviction: 120,
    expected_move: 120,
    quality: 110,
};

const MIN_COL_WIDTHS: Record<ColumnKey, number> = {
    symbol: 140,
    edge: 80,
    conviction: 90,
    expected_move: 100,
    quality: 90,
};

const OpportunityTable = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol);
    const setActiveSymbol = useAlphaStore((s) => s.setActiveSymbol);
    const convictions = useAlphaStore((s) => s.convictions);
    const stream = useAlphaStore((s) => s.stream);
    const [sortBy, setSortBy] = useState<SortField>('conviction');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(DEFAULT_COL_WIDTHS);

    const toggleSort = (field: SortField) => {
        if (sortBy === field) {
            setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
            return;
        }
        setSortBy(field);
        setSortDirection(field === 'symbol' ? 'asc' : 'desc');
    };

    const getSortArrow = (field: SortField) => {
        if (sortBy !== field) return '';
        return sortDirection === 'desc' ? '↓' : '↑';
    };

    const totalTableWidth = useMemo(
        () => Object.values(colWidths).reduce((acc, width) => acc + width, 0),
        [colWidths]
    );

    const beginColumnResize = (column: ColumnKey, event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startWidth = colWidths[column];
        const minWidth = MIN_COL_WIDTHS[column];

        const onMouseMove = (moveEvent: MouseEvent) => {
            const proposed = startWidth + (moveEvent.clientX - startX);
            const width = Math.max(minWidth, Math.round(proposed));
            setColWidths((prev) => {
                if (prev[column] === width) return prev;
                return { ...prev, [column]: width };
            });
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
    };

    const sortLabel = useMemo(() => {
        if (sortBy === 'conviction') return `Conviction ${getSortArrow('conviction')}`;
        if (sortBy === 'edge') return `Edge ${getSortArrow('edge')}`;
        if (sortBy === 'expected_move') return `Exp Move ${getSortArrow('expected_move')}`;
        return `Symbol ${getSortArrow('symbol')}`;
    }, [sortBy, sortDirection]);

    const symbols = useMemo<OpportunityRow[]>(() => {
        const deduped = new Map<string, OpportunityRow>();
        Object.values(convictions).forEach((value) => {
            const sym = typeof value?.symbol === 'string'
                ? value.symbol.trim().toUpperCase()
                : '';
            if (!/^[A-Z0-9]{1,20}$/.test(sym)) return;

            const c = value;
            const score = Number(c?.score);
            const expectedMove = Number(c?.expected_move);
            const realizedVol = Number(c?.realized_vol);
            if (!Number.isFinite(score) || !Number.isFinite(expectedMove)) return;

            const safeVol = Number.isFinite(realizedVol) && realizedVol > 0 ? realizedVol : 0;
            const edgeScore = safeVol > 0 ? (expectedMove / safeVol) : 0;
            const row: OpportunityRow = {
                sym,
                score,
                expected_move: expectedMove,
                realized_vol: safeVol,
                edgeScore,
                regime: typeof c?.regime === 'string' ? c.regime : 'NORMAL_MARKET',
                timestamp: Number.isFinite(Number(c?.timestamp)) ? Number(c?.timestamp) : 0,
            };

            const existing = deduped.get(sym);
            if (!existing || row.timestamp >= existing.timestamp) {
                deduped.set(sym, row);
            }
        });

        const rows = Array.from(deduped.values());
        const dir = sortDirection === 'asc' ? 1 : -1;

        rows.sort((a, b) => {
            if (sortBy === 'symbol') {
                return a.sym.localeCompare(b.sym) * dir;
            }
            if (sortBy === 'edge') {
                return ((Number(a.edgeScore) || 0) - (Number(b.edgeScore) || 0)) * dir;
            }
            if (sortBy === 'expected_move') {
                return ((Number(a.expected_move) || 0) - (Number(b.expected_move) || 0)) * dir;
            }
            const convictionDelta = ((Number(a.score) || 0) - (Number(b.score) || 0)) * dir;
            if (convictionDelta !== 0) return convictionDelta;
            return a.sym.localeCompare(b.sym);
        });
        return rows;
    }, [convictions, sortBy, sortDirection]);

    const streamLabel = stream.status === 'live'
        ? 'LIVE'
        : stream.status === 'degraded'
            ? 'DEGRADED'
            : stream.status === 'stale'
                ? 'STALE'
                : stream.connected
                    ? 'CONNECTING'
                    : 'OFFLINE';

    const streamColor = stream.status === 'live'
        ? 'text-green-400'
        : stream.status === 'degraded'
            ? 'text-yellow-400'
            : stream.status === 'stale'
                ? 'text-red-500'
                : 'text-gray-500';

    if (symbols.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-12 text-gray-800 font-mono text-center">
                <div className="text-lg sm:text-2xl mb-2">NO HIGH-CONVICTION SETUPS</div>
                <div className="text-xs uppercase tracking-widest opacity-50">
                    {stream.connected ? 'System scanning for asymmetry...' : 'Waiting for live market stream...'}
                </div>
            </div>
        );
    }

    const getQualityBadge = (score: number) => {
        if (score > 1.5) return <span className="px-1.5 py-0.5 rounded-sm bg-green-500/20 text-green-500 text-[8px] font-bold border border-green-500/30">HIGH EDGE</span>;
        if (score > 0.5) return <span className="px-1.5 py-0.5 rounded-sm bg-blue-500/20 text-blue-500 text-[8px] font-bold border border-blue-500/30">LOW QUALITY</span>;
        return <span className="px-1.5 py-0.5 rounded-sm bg-gray-800 text-gray-500 text-[8px] font-bold border border-gray-700">NEUTRAL</span>;
    };

    return (
        <div className="w-full h-full border-t border-gray-800 bg-black flex flex-col min-h-0">
            <div className="shrink-0 bg-gray-950/90 backdrop-blur border-b border-gray-800 px-3 sm:px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">Live Opportunities</span>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => toggleSort('conviction')}
                        className="text-[10px] uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-colors"
                        title="Sort by conviction"
                    >
                        Sort: {sortLabel}
                    </button>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${streamColor}`}>{streamLabel}</span>
                </div>
            </div>

            <div className="sm:hidden min-h-0 flex-1 overflow-auto divide-y divide-gray-900">
                {symbols.map((item) => {
                    const isActive = item.sym === activeSymbol;
                    return (
                        <button
                            key={item.sym}
                            type="button"
                            onClick={() => setActiveSymbol(item.sym)}
                            className={`w-full text-left px-3 py-3 transition-colors ${isActive ? 'bg-gray-900/80' : 'bg-black hover:bg-gray-900/70'}`}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-bold text-white tracking-wide">{item.sym}</div>
                                    <div className="text-[9px] text-gray-600 uppercase">{item.regime}</div>
                                </div>
                                {getQualityBadge(item.edgeScore)}
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                                <div>
                                    <div className="text-gray-600 uppercase">Edge</div>
                                    <div className={item.edgeScore > 1 ? 'text-green-400' : 'text-gray-400'}>{item.edgeScore.toFixed(2)}</div>
                                </div>
                                <div>
                                    <div className="text-gray-600 uppercase">Conviction</div>
                                    <div className={item.score > 60 ? 'text-green-500' : item.score < 40 ? 'text-red-500' : 'text-gray-400'}>{item.score}</div>
                                </div>
                                <div>
                                    <div className="text-gray-600 uppercase">Exp Move</div>
                                    <div className="text-gray-300">{item.expected_move.toFixed(2)}%</div>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="hidden sm:block min-h-0 flex-1 overflow-auto">
                <table
                    className="w-full table-fixed text-left text-xs font-mono data-table"
                    style={{ minWidth: `${Math.max(620, totalTableWidth)}px` }}
                >
                    <colgroup>
                        <col style={{ width: `${colWidths.symbol}px` }} />
                        <col style={{ width: `${colWidths.edge}px` }} />
                        <col style={{ width: `${colWidths.conviction}px` }} />
                        <col style={{ width: `${colWidths.expected_move}px` }} />
                        <col style={{ width: `${colWidths.quality}px` }} />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800">
                        <tr>
                            <th className="relative px-3 sm:px-4 py-2 text-gray-500 font-normal uppercase text-[10px]">
                                <button
                                    type="button"
                                    onClick={() => toggleSort('symbol')}
                                    className="hover:text-blue-400 transition-colors"
                                >
                                    Symbol {getSortArrow('symbol')}
                                </button>
                                <div
                                    role="separator"
                                    aria-label="Resize symbol column"
                                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30"
                                    onMouseDown={(event) => beginColumnResize('symbol', event)}
                                />
                            </th>
                            <th className="relative px-3 sm:px-4 py-2 text-gray-500 font-normal uppercase text-[10px] text-right">
                                <button
                                    type="button"
                                    onClick={() => toggleSort('edge')}
                                    className="hover:text-blue-400 transition-colors"
                                >
                                    Edge Score {getSortArrow('edge')}
                                </button>
                                <div
                                    role="separator"
                                    aria-label="Resize edge score column"
                                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30"
                                    onMouseDown={(event) => beginColumnResize('edge', event)}
                                />
                            </th>
                            <th className="relative px-3 sm:px-4 py-2 text-gray-500 font-normal uppercase text-[10px] text-right">
                                <button
                                    type="button"
                                    onClick={() => toggleSort('conviction')}
                                    className="hover:text-blue-400 transition-colors"
                                >
                                    Conviction {getSortArrow('conviction')}
                                </button>
                                <div
                                    role="separator"
                                    aria-label="Resize conviction column"
                                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30"
                                    onMouseDown={(event) => beginColumnResize('conviction', event)}
                                />
                            </th>
                            <th className="relative px-3 sm:px-4 py-2 text-gray-500 font-normal uppercase text-[10px] text-right">
                                <button
                                    type="button"
                                    onClick={() => toggleSort('expected_move')}
                                    className="hover:text-blue-400 transition-colors"
                                >
                                    Exp Move {getSortArrow('expected_move')}
                                </button>
                                <div
                                    role="separator"
                                    aria-label="Resize expected move column"
                                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30"
                                    onMouseDown={(event) => beginColumnResize('expected_move', event)}
                                />
                            </th>
                            <th className="relative px-3 sm:px-4 py-2 text-gray-500 font-normal uppercase text-[10px] text-center">
                                Quality
                                <div
                                    role="separator"
                                    aria-label="Resize quality column"
                                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30"
                                    onMouseDown={(event) => beginColumnResize('quality', event)}
                                />
                            </th>
                        </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-900 align-top">
                        {symbols.map((item) => {
                            const isActive = item.sym === activeSymbol;
                            return (
                                <tr
                                    key={item.sym}
                                    onClick={() => setActiveSymbol(item.sym)}
                                    className={`
                                        cursor-pointer hover:bg-gray-900/80 transition-all
                                        ${isActive ? 'bg-gray-900/50 border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent'}
                                    `}
                                >
                                    <td className="px-3 sm:px-4 py-3">
                                        <div className="font-bold text-white tracking-wide">{item.sym}</div>
                                        <div className="text-[9px] text-gray-600 uppercase truncate">{item.regime}</div>
                                    </td>

                                    <td className="px-3 sm:px-4 py-3 text-right">
                                        <span className={item.edgeScore > 1 ? 'text-green-400' : 'text-gray-400'}>
                                            {item.edgeScore.toFixed(2)}
                                        </span>
                                    </td>

                                    <td className={`px-3 sm:px-4 py-3 text-right font-bold ${item.score > 60 ? 'text-green-500' : item.score < 40 ? 'text-red-500' : 'text-gray-500'}`}>
                                        {item.score}
                                    </td>

                                    <td className="px-3 sm:px-4 py-3 text-right text-gray-400">
                                        {item.expected_move.toFixed(2)}%
                                    </td>

                                    <td className="px-3 sm:px-4 py-3 text-center">
                                        {getQualityBadge(item.edgeScore)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {symbols.every((s) => s.score >= 45 && s.score <= 55) && (
                <div className="p-5 sm:p-7 text-center bg-gray-950/50 border-y border-gray-900">
                    <div className="text-gray-500 text-[10px] uppercase tracking-widest mb-1">Market State: Normal</div>
                    <div className="text-gray-700 text-xs italic">No high-conviction setup detected. Waiting for asymmetry.</div>
                </div>
            )}
        </div>
    );
};

export default OpportunityTable;
