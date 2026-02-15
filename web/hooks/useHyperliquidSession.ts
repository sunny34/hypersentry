import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ethers } from 'ethers';
import axios from 'axios';

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';
const AGENT_STORAGE_KEY = 'hl_session_agent';
const AGENT_SECRET_SESSION_KEY = 'hl_session_agent_secret';
const AGENT_SECRET_PERSIST_KEY = 'hl_session_agent_secret_persist';
const AGENT_SESSION_EVENT = 'hl_session_updated';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

interface StoredAgentWallet {
    address: string;
    created: number;
    userAddress: string;
    // Canonical persisted 1-click signing key (single storage source).
    privateKey?: string;
}

export interface AgentWallet extends StoredAgentWallet {}

interface AgentSecret {
    address: string;
    privateKey: string;
}

interface ApprovalResponse {
    status?: string;
    error?: string;
    response?: {
        type?: string;
        data?: unknown;
        error?: string;
    } | string;
}

interface ClearinghouseStateResponse {
    agentAddress?: string;
    authorizedAgents?: string[];
}

interface ApproveAgentAction {
    type: 'approveAgent';
    agentAddress: string;
    agentName: string;
    nonce: number;
    hyperliquidChain: 'Mainnet';
    signatureChainId: '0xa4b1';
}

interface ApproveAgentPayload {
    action: ApproveAgentAction;
    nonce: number;
    vaultAddress: null;
    signature: {
        r: string;
        s: string;
        v: number;
    };
}

const readStoredAgent = (): StoredAgentWallet | null => {
    try {
        const raw = localStorage.getItem(AGENT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredAgentWallet>;
        if (!parsed?.address || !parsed?.userAddress || !parsed?.created) {
            return null;
        }
        return {
            address: parsed.address,
            userAddress: parsed.userAddress,
            created: parsed.created,
            privateKey: parsed.privateKey,
        };
    } catch {
        return null;
    }
};

const readSessionSecret = (expectedAddress?: string): AgentSecret | null => {
    const parseSecret = (raw: string | null): AgentSecret | null => {
        try {
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Partial<AgentSecret>;
            if (!parsed?.address || !parsed?.privateKey) {
                return null;
            }
            return {
                address: parsed.address,
                privateKey: parsed.privateKey,
            };
        } catch {
            return null;
        }
    };

    try {
        const sessionSecret = parseSecret(sessionStorage.getItem(AGENT_SECRET_SESSION_KEY));
        const persistedSecret = parseSecret(localStorage.getItem(AGENT_SECRET_PERSIST_KEY));

        const expected = expectedAddress?.toLowerCase();
        if (expected) {
            if (sessionSecret && sessionSecret.address.toLowerCase() === expected) {
                // Backfill persistent cache for older sessions that only had sessionStorage.
                if (!persistedSecret || persistedSecret.address.toLowerCase() !== expected) {
                    localStorage.setItem(AGENT_SECRET_PERSIST_KEY, JSON.stringify(sessionSecret));
                }
                return sessionSecret;
            }
            if (persistedSecret && persistedSecret.address.toLowerCase() === expected) {
                // Rehydrate current tab session cache from persistent secret.
                sessionStorage.setItem(AGENT_SECRET_SESSION_KEY, JSON.stringify(persistedSecret));
                return persistedSecret;
            }
            return null;
        }

        if (sessionSecret) {
            if (!persistedSecret || persistedSecret.address.toLowerCase() !== sessionSecret.address.toLowerCase()) {
                localStorage.setItem(AGENT_SECRET_PERSIST_KEY, JSON.stringify(sessionSecret));
            }
            return sessionSecret;
        }
        if (persistedSecret) {
            sessionStorage.setItem(AGENT_SECRET_SESSION_KEY, JSON.stringify(persistedSecret));
            return persistedSecret;
        }
        return null;
    } catch {
        return null;
    }
};

const clearStoredSession = () => {
    localStorage.removeItem(AGENT_STORAGE_KEY);
    localStorage.removeItem(AGENT_SECRET_PERSIST_KEY);
    sessionStorage.removeItem(AGENT_SECRET_SESSION_KEY);
};

const notifySessionUpdated = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(AGENT_SESSION_EVENT));
};

/**
 * Production-grade Hyperliquid Session Hook
 * Uses persistent public metadata + persisted signing key for sticky UX.
 */
export const useHyperliquidSession = () => {
    const { address: userAddress } = useAccount();
    const { data: walletClient } = useWalletClient();
    const [agent, setAgent] = useState<AgentWallet | null>(null);
    const [isAgentActive, setIsAgentActive] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const verifyAgentRegistration = useCallback(async (user: string, agentAddr: string): Promise<boolean> => {
        try {
            const response = await axios.post<ClearinghouseStateResponse>(`${HYPERLIQUID_API_URL}/info`, {
                type: 'clearinghouseState',
                user,
            });

            const data = response.data;
            const authorizedAgent = typeof data.agentAddress === 'string' ? data.agentAddress : null;
            if (authorizedAgent && authorizedAgent.toLowerCase() === agentAddr.toLowerCase()) {
                return true;
            }

            const agents = Array.isArray(data.authorizedAgents) ? data.authorizedAgents : [];
            return agents.some((a) => a.toLowerCase() === agentAddr.toLowerCase());
        } catch (e) {
            console.error('[Agent] Verification API call failed:', e);
            // Do not hard-fail on transient network errors.
            return true;
        }
    }, []);

    const hydrateFromStorage = useCallback(() => {
        const stored = readStoredAgent();
        if (!stored) {
            setAgent(null);
            setIsAgentActive(false);
            setError(null);
            return () => {};
        }

        // Validate ownership only when an active wallet address is present.
        if (userAddress && stored.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
            console.warn('[Agent] Stored agent belongs to a different wallet. Clearing session.');
            clearStoredSession();
            setAgent(null);
            setIsAgentActive(false);
            setError(null);
            return () => {};
        }

        const embeddedSecret: AgentSecret | null = stored.privateKey
            ? { address: stored.address, privateKey: stored.privateKey }
            : null;
        const secret = embeddedSecret || readSessionSecret(stored.address);
        const hasSecret = !!secret && secret.address.toLowerCase() === stored.address.toLowerCase();
        const hydratedAgent: AgentWallet = {
            ...stored,
            privateKey: hasSecret ? secret.privateKey : undefined,
        };
        if (!stored.privateKey && hasSecret) {
            // Backfill canonical record from legacy secret keys.
            localStorage.setItem(
                AGENT_STORAGE_KEY,
                JSON.stringify({
                    ...stored,
                    privateKey: secret.privateKey,
                } satisfies StoredAgentWallet),
            );
        }

        setAgent(hydratedAgent);

        // Require session key for active trading.
        if (!hydratedAgent.privateKey) {
            setIsAgentActive(false);
            return () => {};
        }

        // Local signing key present: treat as active immediately.
        setIsAgentActive(true);

        const ownerAddress = (userAddress || stored.userAddress || '').toLowerCase();
        if (!ownerAddress) {
            return () => {};
        }

        let cancelled = false;
        void (async () => {
            const isValid = await verifyAgentRegistration(ownerAddress, hydratedAgent.address);
            if (!cancelled && !isValid) {
                // Verification can lag or intermittently fail; keep local session active.
                console.warn('[Agent] Verification returned false. Keeping local agent session active.');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [userAddress, verifyAgentRegistration]);

    useEffect(() => {
        const cleanup = hydrateFromStorage();
        return cleanup;
    }, [hydrateFromStorage]);

    useEffect(() => {
        const onSessionUpdated = () => {
            hydrateFromStorage();
        };
        const onStorage = (event: StorageEvent) => {
            if (
                event.key === AGENT_STORAGE_KEY
                || event.key === AGENT_SECRET_SESSION_KEY
                || event.key === AGENT_SECRET_PERSIST_KEY
            ) {
                hydrateFromStorage();
            }
        };

        window.addEventListener(AGENT_SESSION_EVENT, onSessionUpdated);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(AGENT_SESSION_EVENT, onSessionUpdated);
            window.removeEventListener('storage', onStorage);
        };
    }, [hydrateFromStorage]);

    const retryOperation = useCallback(async <T,>(
        operation: () => Promise<T>,
        retries: number = MAX_RETRIES,
    ): Promise<T> => {
        let lastError: Error | null = null;

        for (let i = 0; i < retries; i++) {
            try {
                return await operation();
            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                if (i < retries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (i + 1)));
                }
            }
        }

        throw lastError || new Error('Operation failed after retries');
    }, []);

    const isSuccessfulResponse = useCallback((response: ApprovalResponse): boolean => {
        if (response.status === 'err') return false;

        const responseType =
            typeof response.response === 'object' && response.response !== null
                ? response.response.type
                : undefined;

        return (
            response.status === 'ok' ||
            response.status === 'success' ||
            responseType === 'default' ||
            responseType === 'approveAgent' ||
            (!response.status && !(typeof response.response === 'object' && response.response?.error))
        );
    }, []);

    const enableSession = useCallback(async (): Promise<AgentWallet | null> => {
        if (!userAddress || !walletClient) {
            throw new Error('Please connect your wallet first');
        }

        setIsLoading(true);
        setError(null);

        try {
            const randomWallet = ethers.Wallet.createRandom();
            const agentAddress = randomWallet.address;

            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== 42161) {
                try {
                    await walletClient.switchChain({ id: 42161 });
                } catch {
                    console.warn('[Agent] Failed to switch chain, continuing with signature request.');
                }
            }

            const nonce = Date.now();
            const signature = await walletClient.signTypedData({
                account: userAddress as `0x${string}`,
                domain: {
                    name: 'HyperliquidSignTransaction',
                    version: '1',
                    chainId: 42161,
                    verifyingContract: '0x0000000000000000000000000000000000000000',
                },
                types: {
                    'HyperliquidTransaction:ApproveAgent': [
                        { name: 'hyperliquidChain', type: 'string' },
                        { name: 'agentAddress', type: 'address' },
                        { name: 'agentName', type: 'string' },
                        { name: 'nonce', type: 'uint64' },
                    ],
                },
                primaryType: 'HyperliquidTransaction:ApproveAgent',
                message: {
                    hyperliquidChain: 'Mainnet',
                    agentAddress: agentAddress as `0x${string}`,
                    agentName: 'AlphaSentryAgent',
                    nonce: BigInt(nonce),
                },
            });

            const sig = ethers.Signature.from(signature);
            const payload: ApproveAgentPayload = {
                action: {
                    type: 'approveAgent',
                    agentAddress,
                    agentName: 'AlphaSentryAgent',
                    nonce,
                    hyperliquidChain: 'Mainnet',
                    signatureChainId: '0xa4b1',
                },
                nonce,
                vaultAddress: null,
                signature: {
                    r: sig.r,
                    s: sig.s,
                    v: sig.v,
                },
            };

            const response = await retryOperation(async () => {
                const res = await axios.post<ApprovalResponse>(
                    `${HYPERLIQUID_API_URL}/exchange`,
                    payload,
                    {
                        timeout: 10000,
                        headers: { 'Content-Type': 'application/json' },
                    },
                );
                return res.data;
            });

            if (!isSuccessfulResponse(response)) {
                const errFromNested =
                    typeof response.response === 'object' && response.response !== null
                        ? response.response.error
                        : undefined;
                const errFromRoot = typeof response.error === 'string' ? response.error : undefined;
                const errFromResponseString = typeof response.response === 'string' ? response.response : undefined;
                const errorMsg = errFromNested || errFromRoot || errFromResponseString || 'Hyperliquid agent approval failed';
                throw new Error(errorMsg);
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            const isVerified = await verifyAgentRegistration(userAddress, agentAddress);
            if (!isVerified) {
                console.warn('[Agent] Registration verification returned false. Continuing with session setup.');
            }

            const publicAgent: StoredAgentWallet = {
                address: agentAddress,
                created: Date.now(),
                userAddress: userAddress.toLowerCase(),
                privateKey: randomWallet.privateKey,
            };

            // Canonical single-source session record.
            localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(publicAgent));
            // Legacy compatibility keys (to be removed later).
            sessionStorage.setItem(
                AGENT_SECRET_SESSION_KEY,
                JSON.stringify({
                    address: agentAddress,
                    privateKey: randomWallet.privateKey,
                } satisfies AgentSecret),
            );
            localStorage.setItem(
                AGENT_SECRET_PERSIST_KEY,
                JSON.stringify({
                    address: agentAddress,
                    privateKey: randomWallet.privateKey,
                } satisfies AgentSecret),
            );

            const newAgent: AgentWallet = {
                ...publicAgent,
                privateKey: randomWallet.privateKey,
            };

            setAgent(newAgent);
            setIsAgentActive(true);
            notifySessionUpdated();
            return newAgent;
        } catch (e) {
            const err = e as { message?: string; code?: number; response?: { data?: { response?: { error?: string } } } };

            if (err.message?.includes('user cancel') || err.message?.includes('User rejected') || err.code === 4001) {
                setError(null);
                setIsAgentActive(false);
                return null;
            }

            const errorMessage =
                err.response?.data?.response?.error ||
                err.message ||
                'Failed to enable 1-Click Trading';

            console.error('[Agent] Enable session failed:', errorMessage);
            setError(errorMessage);
            setIsAgentActive(false);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [isSuccessfulResponse, retryOperation, userAddress, verifyAgentRegistration, walletClient]);

    const clearSession = useCallback(() => {
        clearStoredSession();
        setAgent(null);
        setIsAgentActive(false);
        setError(null);
        notifySessionUpdated();
    }, []);

    const refreshSession = useCallback(async () => {
        if (!agent?.address || !agent.privateKey) {
            setIsAgentActive(false);
            return;
        }

        const ownerAddress = (userAddress || agent.userAddress || '').toLowerCase();
        if (!ownerAddress) {
            setIsAgentActive(true);
            return;
        }

        setIsLoading(true);
        setIsAgentActive(true);
        try {
            const isValid = await verifyAgentRegistration(ownerAddress, agent.address);
            if (!isValid) {
                console.warn('[Agent] Refresh verification returned false. Keeping local agent session active.');
            }
        } catch (e) {
            console.error('[Agent] Refresh failed:', e);
        } finally {
            setIsLoading(false);
        }
    }, [agent?.address, agent?.privateKey, agent?.userAddress, userAddress, verifyAgentRegistration]);

    return {
        agent,
        isAgentActive,
        isLoading,
        error,
        enableSession,
        clearSession,
        refreshSession,
    };
};
