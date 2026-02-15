import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PortfolioScreen() {
    return (
        <SafeAreaView className="flex-1 bg-black items-center justify-center">
            <Text className="text-white text-lg">Portfolio & Positions</Text>
            <Text className="text-gray-500 mt-2">Coming soon...</Text>
        </SafeAreaView>
    );
}
