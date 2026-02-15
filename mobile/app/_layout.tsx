import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HyperliquidWSProvider } from '../contexts/HyperliquidWSContext';

export default function Layout() {
    return (
        <SafeAreaProvider>
            <HyperliquidWSProvider>
                <StatusBar style="light" />
                <Stack screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: '#000000' }
                }} />
            </HyperliquidWSProvider>
        </SafeAreaProvider>
    );
}
