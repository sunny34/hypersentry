"use client";
import React, { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useAuth } from '../../../contexts/AuthContext';
import { useHyperliquidSession } from '../../../hooks/useHyperliquidSession';
import { useAlphaStore } from '../../../store/useAlphaStore';

const AuthControlPanel = () => {
    const { isConnected } = useAccount();
    const { isAuthenticated, login, isLoading: authLoading } = useAuth();
    const {
        isAgentActive,
        enableSession,
        isLoading: agentLoading,
        error: agentError,
    } = useHyperliquidSession();
    const addLog = useAlphaStore((s) => s.addLog);
    const [error, setError] = useState<string | null>(null);

    const handleAuthenticate = async () => {
        setError(null);
        try {
            await login('wallet');
            addLog({ type: 'SYSTEM', message: 'Auth session updated from /alpha.' });
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Authentication failed';
            setError(msg);
        }
    };

    const handleEnableAgent = async () => {
        setError(null);
        try {
            const session = await enableSession();
            if (session) {
                addLog({ type: 'SYSTEM', message: '1-Click agent enabled from /alpha.' });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Agent enable failed';
            setError(msg);
        }
    };

    return (
        <div className="p-4 border border-cyan-500/20 bg-cyan-950/10 rounded flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="text-cyan-400 text-[10px] font-bold uppercase tracking-widest">Execution Auth</span>
                <span className={`text-[10px] font-bold uppercase ${isAuthenticated ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {isAuthenticated ? 'Session OK' : 'Session Needed'}
                </span>
            </div>

            <div className="text-[9px] text-gray-500 leading-relaxed">
                Autonomous relay needs both a signed session token and an active 1-Click agent key. Session auth is now shared across terminal and /alpha tabs.
            </div>

            <div className="text-[9px] text-gray-500 flex items-center justify-between">
                <span>Wallet: <span className={isConnected ? 'text-emerald-400' : 'text-gray-400'}>{isConnected ? 'Connected' : 'Disconnected'}</span></span>
                <span>Agent: <span className={isAgentActive ? 'text-emerald-400' : 'text-yellow-400'}>{isAgentActive ? 'Active' : 'Inactive'}</span></span>
            </div>

            <div className="flex flex-col gap-2">
                <div className="w-full">
                    <ConnectButton showBalance={false} accountStatus="avatar" />
                </div>

                <button
                    type="button"
                    onClick={handleAuthenticate}
                    disabled={!isConnected || authLoading}
                    className={`h-8 px-3 border rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        !isConnected || authLoading
                            ? 'border-gray-800 text-gray-600 bg-gray-900/30 cursor-not-allowed'
                            : isAuthenticated
                                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                                : 'border-blue-500/30 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                    }`}
                >
                    {authLoading ? 'Authenticating...' : isAuthenticated ? 'Re-Authenticate Session' : 'Authenticate Session'}
                </button>

                <button
                    type="button"
                    onClick={handleEnableAgent}
                    disabled={!isAuthenticated || agentLoading}
                    className={`h-8 px-3 border rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        !isAuthenticated || agentLoading
                            ? 'border-gray-800 text-gray-600 bg-gray-900/30 cursor-not-allowed'
                            : isAgentActive
                                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                                : 'border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20'
                    }`}
                >
                    {agentLoading ? 'Enabling Agent...' : isAgentActive ? 'Agent Active' : 'Enable 1-Click Agent'}
                </button>
            </div>

            {(error || agentError) && (
                <div className="text-[9px] text-red-400 border border-red-500/30 bg-red-500/10 px-2 py-1 rounded">
                    {error || agentError}
                </div>
            )}
        </div>
    );
};

export default AuthControlPanel;
