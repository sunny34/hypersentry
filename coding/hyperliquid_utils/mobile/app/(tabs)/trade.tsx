import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useHyperliquidWS } from '../../contexts/HyperliquidWSContext';
import OrderBook from '../../components/trading/OrderBook';

export default function TradeScreen() {
    const [side, setSide] = useState('buy');
    const { status } = useHyperliquidWS();
    const [selectedToken, setSelectedToken] = useState('BTC');

    return (
        <SafeAreaView className="flex-1 bg-black">
            {/* Header: Token Selector */}
            <View className="px-4 py-3 border-b border-gray-800 flex-row justify-between items-center">
                <View className="flex-row items-center space-x-2">
                    <View className="w-8 h-8 bg-emerald-500/20 rounded-full items-center justify-center">
                        <Text className="text-emerald-500 text-xs font-bold">₿</Text>
                    </View>
                    <View>
                        <Text className="text-xl font-bold text-white">{selectedToken}-USD</Text>
                        <View className="flex-row items-center space-x-1">
                            <View className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            <Text className="text-xs text-gray-500 uppercase font-bold">{status}</Text>
                        </View>
                    </View>
                </View>
                <View className="bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700">
                    <Text className="text-gray-300 font-bold text-xs">50x Cross</Text>
                </View>
            </View>

            {/* Trading Area - Split Layout */}
            <View className="flex-1 flex-row">
                {/* Left: Order Book (60% width) */}
                <View className="flex-[1.5] border-r border-gray-800">
                    <OrderBook coin={selectedToken} onSelectPrice={(px) => { }} />
                </View>

                {/* Right: Order Form (Rest) */}
                <View className="flex-1 p-3 space-y-4">
                    <View className="flex-row bg-gray-900 rounded-xl p-1">
                        <TouchableOpacity
                            onPress={() => setSide('buy')}
                            className={`flex-1 py-2.5 rounded-lg items-center ${side === 'buy' ? 'bg-emerald-600 shadow-lg' : 'bg-transparent'}`}
                        >
                            <Text className={`font-black text-[10px] uppercase ${side === 'buy' ? 'text-white' : 'text-gray-500'}`}>Buy</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => setSide('sell')}
                            className={`flex-1 py-2.5 rounded-lg items-center ${side === 'sell' ? 'bg-red-600 shadow-lg' : 'bg-transparent'}`}
                        >
                            <Text className={`font-black text-[10px] uppercase ${side === 'sell' ? 'text-white' : 'text-gray-500'}`}>Sell</Text>
                        </TouchableOpacity>
                    </View>

                    <View>
                        <Text className="text-gray-600 text-[9px] font-black uppercase mb-1.5 tracking-widest pl-1">Size (USD)</Text>
                        <View className="bg-gray-900/50 rounded-xl p-3 border border-gray-800 focus:border-blue-500">
                            <TextInput
                                placeholder="0.00"
                                placeholderTextColor="#3f3f46"
                                keyboardType="numeric"
                                className="text-white text-lg font-mono font-bold"
                            />
                        </View>
                    </View>

                    <View className="pt-2">
                        <TouchableOpacity className={`w-full py-3.5 rounded-xl items-center ${side === 'buy' ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]'}`}>
                            <Text className="text-black font-black uppercase tracking-widest text-xs">
                                {side === 'buy' ? 'Open Long' : 'Open Short'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View className="mt-auto space-y-2 pb-4">
                        <View className="flex-row justify-between items-center">
                            <Text className="text-[9px] text-gray-500 font-bold uppercase">Liq. Price</Text>
                            <Text className="text-[10px] text-gray-300 font-mono">-</Text>
                        </View>
                        <View className="flex-row justify-between items-center">
                            <Text className="text-[9px] text-gray-500 font-bold uppercase">Margin</Text>
                            <Text className="text-[10px] text-gray-300 font-mono">$0.00</Text>
                        </View>
                    </View>
                </View>
            </View>
        </SafeAreaView>
    );
}
