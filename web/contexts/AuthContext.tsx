'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '@/lib/constants';
import { useAccount, useWalletClient } from 'wagmi';

const AUTH_TOKEN_KEY = 'auth_token';

interface User {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
    telegram_chat_id?: string;
    provider: string;
    role: 'user' | 'pro';
    is_admin?: boolean;
    trial_credits?: number;
    created_at: string;
    wallets?: { address: string }[];
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (provider?: 'google' | 'wallet') => Promise<void>;
    logout: () => void;
    handleCallback: (code: string, redirectUri: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const isValidToken = (value: string | null): value is string => {
    if (!value) return false;
    return value !== 'undefined' && value !== 'null' && value.trim().length > 0;
};

const persistToken = (value: string) => {
    sessionStorage.setItem(AUTH_TOKEN_KEY, value);
    localStorage.setItem(AUTH_TOKEN_KEY, value);
};

const clearTokenStorage = () => {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
};

export function AuthProvider({ children }: { children: ReactNode }) {
    const { address, isConnected, chainId } = useAccount();
    const { data: walletClient } = useWalletClient();
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Check for existing token on mount
    useEffect(() => {
        const sessionToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
        const localToken = localStorage.getItem(AUTH_TOKEN_KEY);
        const storedToken = isValidToken(sessionToken) ? sessionToken : (isValidToken(localToken) ? localToken : null);

        if (storedToken) {
            // Keep session + local in sync so /terminal and /alpha share auth seamlessly.
            persistToken(storedToken);
            setToken(storedToken);
            fetchUser(storedToken);
        } else {
            setIsLoading(false);
            clearTokenStorage();
        }
    }, []);

    // Cross-tab auth sync: logging in one tab should unlock the other immediately.
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== AUTH_TOKEN_KEY) return;
            const nextToken = isValidToken(event.newValue) ? event.newValue : null;
            if (!nextToken) {
                setToken(null);
                setUser(null);
                return;
            }
            setToken(nextToken);
            void fetchUser(nextToken);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    // Fetch current user with token
    const fetchUser = async (authToken: string) => {
        try {
            const response = await axios.get(`${API_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${authToken}` }
            });
            setUser(response.data);
            
            // Set alpha context for existing session
            try {
                await axios.post(`${API_URL}/auth/alpha-context`, {}, {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                console.log('Alpha context set for user');
            } catch (ctxError) {
                console.warn('Failed to set alpha context:', ctxError);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    // Expired/invalid token: clear local auth state quietly.
                    clearTokenStorage();
                    setToken(null);
                    setUser(null);
                    return;
                }
                if (error.code === 'ERR_NETWORK') {
                    // Keep token so auth can recover once backend is reachable again.
                    setUser(null);
                    return;
                }
            }

            console.warn('Failed to fetch user profile');
            clearTokenStorage();
            setToken(null);
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    };

    const walletLogin = useCallback(async () => {
        if (!isConnected || !address || !walletClient) {
            console.warn('Wallet login requested but no wallet is connected.');
            return;
        }

        setIsLoading(true);
        try {
            const effectiveChainId = chainId || await walletClient.getChainId();
            const challenge = await axios.post(`${API_URL}/auth/wallet/challenge`, {
                address,
                chain_id: Number(effectiveChainId || 42161),
            });
            const payload = challenge.data || {};

            if (!payload.message || !payload.nonce) {
                throw new Error('Invalid wallet challenge response.');
            }

            const signature = await walletClient.signMessage({
                account: address as `0x${string}`,
                message: payload.message,
            });

            const verify = await axios.post(`${API_URL}/auth/wallet/verify`, {
                address,
                nonce: payload.nonce,
                signature,
            });
            const { token: newToken, user: newUser } = verify.data;
            persistToken(newToken);
            setToken(newToken);
            setUser(newUser);

            // Set alpha engine user context after successful login
            try {
                await axios.post(`${API_URL}/auth/alpha-context`, {}, {
                    headers: { Authorization: `Bearer ${newToken}` }
                });
                console.log('Alpha context set for user');
            } catch (ctxError) {
                console.warn('Failed to set alpha context:', ctxError);
            }
        } catch (error) {
            console.error('Wallet login failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [address, chainId, isConnected, walletClient]);

    // Initiate login
    const login = useCallback(async (provider: 'google' | 'wallet' = 'wallet') => {
        if (provider === 'wallet') {
            await walletLogin();
            return;
        }
        try {
            const redirectUri = `${window.location.origin}/auth/callback`;
            const response = await axios.get(`${API_URL}/auth/google`, {
                params: { redirect_uri: redirectUri }
            });

            if (response.data.auth_url) {
                // Redirect to OAuth provider
                window.location.href = response.data.auth_url;
            }
        } catch (error) {
            console.error('OAuth login failed:', error);
        }
    }, [walletLogin]);

    // Handle OAuth callback
    const handleCallback = useCallback(async (code: string, redirectUri: string) => {
        try {
            setIsLoading(true);
            const response = await axios.get(`${API_URL}/auth/google/callback`, {
                params: { code, redirect_uri: redirectUri }
            });

            const { token: newToken, user: newUser } = response.data;

            // Store token
            persistToken(newToken);
            setToken(newToken);
            setUser(newUser);

            // Set alpha engine user context after successful OAuth login
            try {
                await axios.post(`${API_URL}/auth/alpha-context`, {}, {
                    headers: { Authorization: `Bearer ${newToken}` }
                });
                console.log('Alpha context set for user');
            } catch (ctxError) {
                console.warn('Failed to set alpha context:', ctxError);
            }
        } catch (error) {
            console.error('Callback failed:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Logout
    const logout = useCallback(async () => {
        try {
            if (token) {
                await axios.post(`${API_URL}/auth/logout`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            clearTokenStorage();
            setToken(null);
            setUser(null);
        }
    }, [token]);

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                isLoading,
                isAuthenticated: !!user,
                login,
                logout,
                handleCallback
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
