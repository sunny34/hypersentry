import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

export default function TradeScreen() {
    const [side, setSide] = useState('buy');

    return (
        <SafeAreaView className="flex-1 bg-black">
            {/* Header: Token Selector */}
            <View className="px-4 py-3 border-b border-gray-800 flex-row justify-between items-center">
                <View>
                    <Text className="text-xl font-bold text-white">BTC-USD</Text>
                    <Text className="text-green-400 font-bold">$84,230.50 <Text className="text-xs text-gray-500">+2.4%</Text></Text>
                </View>
                <View className="bg-gray-800 px-3 py-1.5 rounded-lg">
                    <Text className="text-gray-300 font-bold text-xs">50x</Text>
                </View>
            </View>

            {/* Chart Area */}
            <View className="h-64 bg-gray-900 items-center justify-center border-b border-gray-800">
                <Text className="text-gray-500">Chart Component (WebView)</Text>
            </View>

            {/* Order Book / Trades Tabs would go here */}

            {/* Trading Form */}
            <View className="flex-1 p-4">
                <View className="flex-row bg-gray-900 rounded-xl p-1 mb-4">
                    <TouchableOpacity
                        onPress={() => setSide('buy')}
                        className={`flex-1 py-3 rounded-lg items-center ${side === 'buy' ? 'bg-green-600' : 'bg-transparent'}`}
                    >
                        <Text className={`font-bold ${side === 'buy' ? 'text-white' : 'text-gray-400'}`}>Buy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setSide('sell')}
                        className={`flex-1 py-3 rounded-lg items-center ${side === 'sell' ? 'bg-red-600' : 'bg-transparent'}`}
                    >
                        <Text className={`font-bold ${side === 'sell' ? 'text-white' : 'text-gray-400'}`}>Sell</Text>
                    </TouchableOpacity>
                </View>

                <View className="space-y-4">
                    <View>
                        <Text className="text-gray-500 text-xs mb-1">Size (USD)</Text>
                        <View className="bg-gray-900 rounded-xl p-4 border border-gray-700">
                            <TextInput
                                placeholder="0.00"
                                placeholderTextColor="#52525b"
                                keyboardType="numeric"
                                className="text-white text-xl font-bold"
                            />
                        </View>
                    </View>

                    <TouchableOpacity className={`w-full py-4 rounded-xl items-center mt-4 ${side === 'buy' ? 'bg-green-500' : 'bg-red-500'}`}>
                        <Text className="text-black font-bold text-lg">
                            {side === 'buy' ? 'Buy / Long' : 'Sell / Short'} BTC
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    );
}
