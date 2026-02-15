import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styled } from 'nativewind';

export default function HomeScreen() {
    return (
        <SafeAreaView className="flex-1 bg-black p-4">
            <View className="flex-row justify-between items-center mb-6">
                <Text className="text-2xl font-bold text-white">Dashboard</Text>
                <View className="bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                    <Text className="text-emerald-400 font-bold text-xs">System Online</Text>
                </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
                {/* Stats Grid */}
                <View className="flex-row flex-wrap gap-4 mb-6">
                    <View className="w-[47%] bg-gray-900 rounded-2xl p-4 border border-gray-800">
                        <Text className="text-gray-400 text-xs font-bold uppercase mb-2">Watchers</Text>
                        <Text className="text-3xl font-bold text-white">12</Text>
                    </View>
                    <View className="w-[47%] bg-gray-900 rounded-2xl p-4 border border-gray-800">
                        <Text className="text-gray-400 text-xs font-bold uppercase mb-2">Alerts (24h)</Text>
                        <Text className="text-3xl font-bold text-amber-500">342</Text>
                    </View>
                </View>

                {/* Live Activity */}
                <Text className="text-lg font-bold text-white mb-4">Live Activity</Text>
                <View className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                    {[1, 2, 3].map((i) => (
                        <View key={i} className="flex-row justify-between items-center p-4 border-b border-gray-800">
                            <View>
                                <Text className="text-white font-bold">Wallet 0x...{i}2f</Text>
                                <Text className="text-gray-500 text-xs">Opened Long BTC</Text>
                            </View>
                            <Text className="text-emerald-400 font-bold">+$2,400</Text>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}
