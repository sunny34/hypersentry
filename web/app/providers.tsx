'use client';

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
    console.warn('⚠️ NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID not set in .env.local — wallet connections will fail. Get one at https://cloud.walletconnect.com');
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
        arbitrum, // Default for Hyperliquid
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

        // Suppress WalletConnect origin allowlist error in development
        // This error occurs when localhost isn't added to the WalletConnect project allowlist
        if (process.env.NODE_ENV === 'development') {
            const originalConsoleError = console.error;
            console.error = (...args: unknown[]) => {
                const message = args[0];
                if (
                    typeof message === 'string' &&
                    message.includes('Origin') &&
                    message.includes('not found on Allowlist')
                ) {
                    // Suppress this specific WalletConnect error in dev
                    return;
                }
                originalConsoleError.apply(console, args);
            };
        }
    }, []);

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider theme={darkTheme()} coolMode>
                    <ThemeProvider>
                        <TerminalSettingsProvider>
                            {mounted && children}
                        </TerminalSettingsProvider>
                    </ThemeProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
