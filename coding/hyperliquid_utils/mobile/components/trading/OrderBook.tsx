import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useHyperliquidWS } from '../../contexts/HyperliquidWSContext';

interface OrderBookLevel {
    px: string;
    sz: string;
}

interface OrderBookProps {
    coin: string;
    onSelectPrice?: (px: string) => void;
}

export default function OrderBook({ coin, onSelectPrice }: OrderBookProps) {
    const { status, subscribe, addListener } = useHyperliquidWS();
    const [bids, setBids] = useState<OrderBookLevel[]>([]);
    const [asks, setAsks] = useState<OrderBookLevel[]>([]);

    useEffect(() => {
        if (status === 'connected') {
            subscribe({ type: 'l2Book', coin: coin });
        }
    }, [status, coin]);

    useEffect(() => {
        const removeListener = addListener('l2Book', (data: any) => {
            if (data.coin === coin && data.levels?.length === 2) {
                setBids(data.levels[0].slice(0, 20));
                setAsks(data.levels[1].slice(0, 20));
            }
        });
        return () => removeListener();
    }, [addListener, coin]);

    const maxSize = useMemo(() => {
        const bMax = Math.max(...bids.map(b => parseFloat(b.sz)), 0);
        const aMax = Math.max(...asks.map(a => parseFloat(a.sz)), 0);
        return Math.max(bMax, aMax);
    }, [bids, asks]);

    const midPrice = asks.length > 0 ? parseFloat(asks[0].px).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-';

    return (
        <View className="flex-1 bg-black">
            {/* Header */}
            <View className="flex-row px-4 py-2 border-b border-gray-800 bg-gray-900/40">
                <Text className="flex-[0.55] text-gray-500 text-[10px] font-black uppercase tracking-widest">Price</Text>
                <Text className="flex-[0.45] text-gray-500 text-[10px] font-black uppercase tracking-widest text-right">Size</Text>
            </View>

            <ScrollView className="flex-1">
                {/* Asks */}
                {[...asks].reverse().map((ask, i) => {
                    const size = parseFloat(ask.sz);
                    const percentage = (size / maxSize) * 100;
                    return (
                        <TouchableOpacity
                            key={`ask-${i}`}
                            onPress={() => onSelectPrice?.(ask.px)}
                            className="flex-row px-4 h-7 items-center relative"
                        >
                            <View
                                className="absolute right-0 h-full bg-red-500/10"
                                style={{ width: `${percentage}%` }}
                            />
                            <Text className="flex-[0.55] text-red-500 font-bold font-mono text-xs">{parseFloat(ask.px).toFixed(2)}</Text>
                            <Text className="flex-[0.45] text-gray-400 font-mono text-xs text-right">{size.toFixed(2)}</Text>
                        </TouchableOpacity>
                    );
                })}

                {/* Mid Price */}
                <View className="py-2.5 bg-gray-900/60 items-center border-y border-white/5 shadow-inner">
                    <Text className="text-white font-black text-lg font-mono tracking-tighter">{midPrice}</Text>
                    <Text className="text-[8px] text-gray-600 font-black uppercase tracking-[0.2em]">Mark Price</Text>
                </View>

                {/* Bids */}
                {bids.map((bid, i) => {
                    const size = parseFloat(bid.sz);
                    const percentage = (size / maxSize) * 100;
                    return (
                        <TouchableOpacity
                            key={`bid-${i}`}
                            onPress={() => onSelectPrice?.(bid.px)}
                            className="flex-row px-4 h-7 items-center relative"
                        >
                            <View
                                className="absolute right-0 h-full bg-emerald-500/10"
                                style={{ width: `${percentage}%` }}
                            />
                            <Text className="flex-[0.55] text-emerald-500 font-bold font-mono text-xs">{parseFloat(bid.px).toFixed(2)}</Text>
                            <Text className="flex-[0.45] text-gray-400 font-mono text-xs text-right">{size.toFixed(2)}</Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
}
