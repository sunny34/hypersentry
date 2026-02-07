import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { styled } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
    const router = useRouter();

    const handleLogin = () => {
        // Simulation for demo - usually AuthSession with Google
        router.replace('/(tabs)/home');
    };

    return (
        <SafeAreaView className="flex-1 bg-black items-center justify-center p-6">
            <View className="items-center mb-12">
                <View className="w-20 h-20 bg-emerald-500/20 rounded-full items-center justify-center mb-6 border border-emerald-500/50">
                    <Text className="text-4xl">⚡</Text>
                </View>
                <Text className="text-4xl font-bold text-white tracking-tighter">
                    Hyperliquid<Text className="text-emerald-400">Sentry</Text>
                </Text>
                <Text className="text-gray-500 mt-2 font-medium">Professional Mobile Terminal</Text>
            </View>

            <TouchableOpacity
                onPress={handleLogin}
                className="w-full bg-white rounded-xl py-4 flex-row items-center justify-center space-x-3 active:bg-gray-200"
            >
                <Text className="text-xl font-bold text-black">Sign in with Google</Text>
            </TouchableOpacity>

            <Text className="text-gray-600 text-xs mt-8">
                By continuing, you agree to our Terms of Service
            </Text>
        </SafeAreaView>
    );
}
