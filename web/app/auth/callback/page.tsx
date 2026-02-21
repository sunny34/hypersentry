'use client';

import { Suspense, useRef } from 'react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

function AuthCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { handleCallback } = useAuth();
    const [runtimeError, setRuntimeError] = useState<string | null>(null);
    const processedRef = useRef(false);
    const oauthError = searchParams.get('error');

    useEffect(() => {
        const code = searchParams.get('code');
        if (oauthError) {
            return;
        }

        if (code) {
            // Prevent double-execution in React Strict Mode (Development)
            if (processedRef.current) return;
            processedRef.current = true;

            const redirectUri = `${window.location.origin}/auth/callback`;
            handleCallback(code, redirectUri)
                .then(() => {
                    router.push('/');
                })
                .catch((err) => {
                    console.error('Auth callback error:', err);
                    setRuntimeError('Failed to complete authentication');
                });
        }
    }, [searchParams, oauthError, handleCallback, router]);

    const error = runtimeError || (oauthError ? 'Authentication was cancelled or failed' : null);

    if (error) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="bg-gray-900 p-8 rounded-2xl border border-red-500/20 text-center">
                    <h2 className="text-xl font-bold text-red-400 mb-4">Authentication Error</h2>
                    <p className="text-gray-400 mb-6">{error}</p>
                    <button
                        onClick={() => router.push('/')}
                        className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl text-white font-bold transition"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black flex items-center justify-center">
            <div className="text-center">
                <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-gray-400">Completing authentication...</p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading...</p>
                </div>
            </div>
        }>
            <AuthCallbackContent />
        </Suspense>
    );
}
