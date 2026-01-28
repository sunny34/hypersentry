'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface User {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
    provider: string;
    created_at: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (provider: 'google') => void;
    logout: () => void;
    handleCallback: (code: string, redirectUri: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Check for existing token on mount
    useEffect(() => {
        const storedToken = localStorage.getItem('auth_token');
        if (storedToken) {
            setToken(storedToken);
            fetchUser(storedToken);
        } else {
            setIsLoading(false);
        }
    }, []);

    // Fetch current user with token
    const fetchUser = async (authToken: string) => {
        try {
            const response = await axios.get(`${API_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${authToken}` }
            });
            setUser(response.data);
        } catch (error) {
            console.error('Failed to fetch user:', error);
            // Token might be invalid, clear it
            localStorage.removeItem('auth_token');
            setToken(null);
        } finally {
            setIsLoading(false);
        }
    };

    // Initiate OAuth login
    const login = async (provider: 'google') => {
        try {
            const redirectUri = `${window.location.origin}/auth/callback`;
            const response = await axios.get(`${API_URL}/auth/${provider}`, {
                params: { redirect_uri: redirectUri }
            });

            if (response.data.auth_url) {
                // Redirect to OAuth provider
                window.location.href = response.data.auth_url;
            }
        } catch (error) {
            console.error('Login failed:', error);
        }
    };

    // Handle OAuth callback
    const handleCallback = async (code: string, redirectUri: string) => {
        try {
            setIsLoading(true);
            const response = await axios.get(`${API_URL}/auth/google/callback`, {
                params: { code, redirect_uri: redirectUri }
            });

            const { token: newToken, user: newUser } = response.data;

            // Store token
            localStorage.setItem('auth_token', newToken);
            setToken(newToken);
            setUser(newUser);
        } catch (error) {
            console.error('Callback failed:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    // Logout
    const logout = async () => {
        try {
            if (token) {
                await axios.post(`${API_URL}/auth/logout`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            localStorage.removeItem('auth_token');
            setToken(null);
            setUser(null);
        }
    };

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
