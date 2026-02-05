import { Tabs } from 'expo-router';
import { View } from 'react-native';
// You might need to install lucide-react-native or use @expo/vector-icons
// For now using simple text or standard icons if available
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function TabLayout() {
    return (
        <Tabs screenOptions={{
            headerShown: false,
            tabBarStyle: {
                backgroundColor: '#09090b', // Zinc-950
                borderTopColor: '#27272a', // Zinc-800
                height: 60,
                paddingBottom: 8,
                paddingTop: 8,
            },
            tabBarActiveTintColor: '#10b981', // Emerald-500
            tabBarInactiveTintColor: '#71717a', // Zinc-500
        }}>
            <Tabs.Screen
                name="home"
                options={{
                    title: 'Home',
                    tabBarIcon: ({ color }) => <FontAwesome name="home" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="trade"
                options={{
                    title: 'Trade',
                    tabBarIcon: ({ color }) => <FontAwesome name="line-chart" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="portfolio"
                options={{
                    title: 'Portfolio',
                    tabBarIcon: ({ color }) => <FontAwesome name="pie-chart" size={24} color={color} />,
                }}
            />
        </Tabs>
    );
}
