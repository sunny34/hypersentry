"use client";

import * as React from 'react';
import {
    RainbowKitProvider,
    getDefaultConfig,
    darkTheme,
} from '@rainbow-me/rainbowkit';
import {
    rabbyWallet,
    metaMaskWallet,
    coinbaseWallet,
    rainbowWallet,
    walletConnectWallet,
    injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import {
    arbitrum,
    base,
    mainnet,
} from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { ThemeProvider } from '../contexts/ThemeContext';
import { TerminalSettingsProvider } from '../contexts/TerminalSettingsContext';
import '@rainbow-me/rainbowkit/styles.css';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;
if (!walletConnectProjectId) {
    console.warn('⚠️ NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID not set in .env.local — wallet connections will fail.');
}

const config = getDefaultConfig({
    appName: 'HyperliquidSentry',
    projectId: walletConnectProjectId || 'placeholder',
    wallets: [
        {
            groupName: 'Recommended',
            wallets: [
                injectedWallet,
                rabbyWallet,
                rainbowWallet,
                metaMaskWallet,
                coinbaseWallet,
                walletConnectWallet,
            ],
        },
    ],
    chains: [
        arbitrum,
        mainnet,
        base
    ],
    ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider theme={darkTheme()} coolMode>
                    <ThemeProvider>
                        <TerminalSettingsProvider>
                            {mounted ? children : null}
                        </TerminalSettingsProvider>
                    </ThemeProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
