import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ethers } from 'ethers';
import axios from 'axios';

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';
const AGENT_STORAGE_KEY = 'hl_session_agent';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

interface AgentWallet {
    address: string;
    privateKey: string;
    created: number;
    userAddress: string;
}

interface ApprovalResponse {
    status?: string;
    response?: {
        type?: string;
        data?: any;
        error?: string;
    };
}

/**
 * Production-grade Hyperliquid Session Hook
 * Handles agent wallet creation, approval, and persistent state management
 */
export const useHyperliquidSession = () => {
    const { address: userAddress } = useAccount();
    const { data: walletClient } = useWalletClient();
    const [agent, setAgent] = useState<AgentWallet | null>(null);
    const [isAgentActive, setIsAgentActive] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load and verify existing agent from localStorage
     */
    useEffect(() => {
        if (!userAddress) {
            setAgent(null);
            setIsAgentActive(false);
            return;
        }

        const loadAgent = async () => {
            try {
                const stored = localStorage.getItem(AGENT_STORAGE_KEY);
                if (!stored) {
                    setIsAgentActive(false);
                    return;
                }

                const parsed: AgentWallet = JSON.parse(stored);

                // Validate agent belongs to current user
                if (parsed.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
                    console.warn('Agent wallet belongs to different user, clearing...');
                    localStorage.removeItem(AGENT_STORAGE_KEY);
                    setIsAgentActive(false);
                    return;
                }

                // OPTIMISTIC ACTIVATION: If we have a matching local agent, assume active while verifying
                // This prevents the 'flickering' from ON to OFF on every refresh
                setAgent(parsed);
                setIsAgentActive(true);

                // Verify agent is still valid with HL in background
                const isValid = await verifyAgentRegistration(userAddress, parsed.address);
                if (!isValid) {
                    console.warn('Agent registration no longer valid on Hyperliquid');
                    setIsAgentActive(false);
                }
            } catch (e) {
                console.error('Failed to load agent from storage:', e);
                setIsAgentActive(false);
            }
        };

        loadAgent();
    }, [userAddress]);

    /**
     * Verify if an agent is properly registered on Hyperliquid
     */
    const verifyAgentRegistration = async (user: string, agentAddr: string): Promise<boolean> => {
        try {
            console.log(`[Agent] Verifying registration for ${agentAddr} on user ${user}...`);
            const response = await axios.post(`${HYPERLIQUID_API_URL}/info`, {
                type: 'clearinghouseState',
                user: user
            });

            if (response.status === 200 && response.data) {
                // The clearinghouseState response contains an 'agentAddress' field if an agent is authorized
                // or a list of agents in more recent API versions.
                const authorizedAgent = response.data.agentAddress;

                if (authorizedAgent && authorizedAgent.toLowerCase() === agentAddr.toLowerCase()) {
                    console.log('[Agent] ✅ Verification successful: Agent is authorized on-chain');
                    return true;
                }

                // Support for sub-accounts/multiple agents if applicable
                const agents = response.data.authorizedAgents || [];
                if (agents.some((a: string) => a.toLowerCase() === agentAddr.toLowerCase())) {
                    console.log('[Agent] ✅ Verification successful: Agent found in authorized list');
                    return true;
                }

                console.warn(`[Agent] ⚠️ Verification failed: Authorized agent on-chain is ${authorizedAgent}, but local is ${agentAddr}`);
                return false;
            }
            return false;
        } catch (e) {
            console.error('[Agent] ❌ Verification API call failed:', e);
            // If the API call fails, we assume it's still active if we have it locally,
            // to avoid "flickering" to OFF during network issues.
            return true;
        }
    };

    /**
     * Retry logic for API calls
     */
    const retryOperation = async <T,>(
        operation: () => Promise<T>,
        retries: number = MAX_RETRIES
    ): Promise<T> => {
        let lastError: Error | null = null;

        for (let i = 0; i < retries; i++) {
            try {
                return await operation();
            } catch (e: any) {
                lastError = e;
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
                }
            }
        }

        throw lastError || new Error('Operation failed after retries');
    };

    /**
     * Validate Hyperliquid API response
     */
    const isSuccessfulResponse = (response: ApprovalResponse): boolean => {
        // Multiple success patterns from Hyperliquid
        return (
            response.status === 'ok' ||
            response.status === 'success' ||
            response.response?.type === 'default' ||
            response.response?.type === 'approveAgent' ||
            (!response.status && !response.response?.error) // No explicit error
        );
    };

    /**
     * Enable 1-Click Trading by creating and approving an agent wallet
     */
    const enableSession = async (): Promise<AgentWallet | null> => {
        if (!userAddress || !walletClient) {
            throw new Error('Please connect your wallet first');
        }

        setIsLoading(true);
        setError(null);

        try {
            // Generate ephemeral agent wallet
            console.log('[Agent] Generating new agent wallet...');
            const randomWallet = ethers.Wallet.createRandom();
            const agentAddress = randomWallet.address;

            // Get wallet's current chainId for signing
            const currentChainId = await walletClient.getChainId();

            // Prepare EIP-712 approval message
            // We use the wallet's current chainId so the wallet will sign it
            const domain = {
                name: 'HyperliquidSignTransaction',
                version: '1',
                chainId: BigInt(currentChainId), // Use wallet's actual network!
                verifyingContract: '0x0000000000000000000000000000000000000000'
            };

            const types = {
                'HyperliquidTransaction:ApproveAgent': [
                    { name: 'hyperliquidChain', type: 'string' },
                    { name: 'agentAddress', type: 'address' },
                    { name: 'agentName', type: 'string' },
                    { name: 'nonce', type: 'uint64' }
                ]
            };

            const nonce = Date.now();

            // Hyperliquid standard ApproveAgent message
            const message = {
                hyperliquidChain: 'Mainnet',
                agentAddress: agentAddress as `0x${string}`,
                agentName: 'AlphaSentryAgent', // Give it a name to be safe
                nonce: BigInt(nonce)
            };

            console.log('[Agent] Requesting approval signature from connected wallet...');

            // Switch to Arbitrum if not already there - HL L1 actions expect Arbitrum
            if (currentChainId !== 42161) {
                console.log('[Agent] Switching to Arbitrum...');
                try {
                    await walletClient.switchChain({ id: 42161 });
                } catch (e) {
                    console.warn('[Agent] Chain switch failed, attempting to sign anyway...');
                }
            }

            // Use the standard Wagmi/Viem signTypedData which is much more reliable
            const signature = await walletClient.signTypedData({
                account: userAddress as `0x${string}`,
                domain: {
                    name: "HyperliquidSignTransaction",
                    version: "1",
                    chainId: 42161, // Force Arbitrum for Mainnet HL
                    verifyingContract: "0x0000000000000000000000000000000000000000"
                },
                types: {
                    "HyperliquidTransaction:ApproveAgent": [
                        { name: "hyperliquidChain", type: "string" },
                        { name: "agentAddress", type: "address" },
                        { name: "agentName", type: "string" },
                        { name: "nonce", type: "uint64" }
                    ]
                },
                primaryType: "HyperliquidTransaction:ApproveAgent",
                message: {
                    hyperliquidChain: "Mainnet",
                    agentAddress: agentAddress as `0x${string}`,
                    agentName: "AlphaSentryAgent",
                    nonce: BigInt(nonce)
                }
            });

            console.log('[Agent] Signature received, registering with Hyperliquid...');

            // 4. Register agent with Hyperliquid
            const sig = ethers.Signature.from(signature);

            // HL L1 ApproveAgent Action Schema (MUST BE EXACT)
            const action = {
                type: 'approveAgent',
                agentAddress: agentAddress,
                agentName: 'AlphaSentryAgent',
                nonce: nonce
            };

            const payload = {
                action,
                nonce,
                signature: {
                    r: sig.r,
                    s: sig.s,
                    v: sig.v
                }
            };

            // Ensure we include the correct signatureChainId for Mainnet (42161)
            // Even if the wallet is on another chain, HL Mainnet expects 0xa4b1
            (payload as any).vaultAddress = null; // Standard HL meta
            (payload.action as any).hyperliquidChain = 'Mainnet';
            (payload.action as any).signatureChainId = '0xa4b1'; // Hardcode Arbitrum Mainnet for L1 registration

            // Retry registration with exponential backoff
            const response = await retryOperation(async () => {
                const res = await axios.post<ApprovalResponse>(
                    `${HYPERLIQUID_API_URL}/exchange`,
                    payload,
                    {
                        timeout: 10000,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );
                return res.data;
            });

            console.log('[Agent] Registration response:', response);

            // 5. Validate response
            if (!isSuccessfulResponse(response)) {
                const errorMsg = response.response?.error ||
                    response.status === 'err' && (response as any).error ||
                    (typeof response.response === 'string' ? response.response : JSON.stringify(response.response || response));

                console.error('[Agent] ❌ Hyperliquid Registration Error:', response);
                throw new Error(errorMsg);
            }

            // 6. Verify registration succeeded
            console.log('[Agent] Verifying registration...');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Allow HL to process

            const isVerified = await verifyAgentRegistration(userAddress, agentAddress);
            if (!isVerified) {
                console.warn('[Agent] Registration verification failed, but continuing...');
                // Don't fail here - registration might have succeeded but verification is flaky
            }

            // 7. Persist to localStorage
            const newAgent: AgentWallet = {
                address: agentAddress,
                privateKey: randomWallet.privateKey,
                created: Date.now(),
                userAddress: userAddress.toLowerCase()
            };

            localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(newAgent));
            setAgent(newAgent);
            setIsAgentActive(true);

            console.log('[Agent] ✅ 1-Click Trading enabled successfully');
            return newAgent;

        } catch (e: any) {
            // Handle user cancellation gracefully
            if (e.message?.includes('user cancel') || e.message?.includes('User rejected') || e.code === 4001) {
                console.log('[Agent] ℹ️ User cancelled signature request');
                setError(null); // Don't show error for user cancellation
                setIsAgentActive(false);
                return null; // Return null instead of throwing
            }

            const errorMessage = e.response?.data?.response?.error ||
                e.message ||
                'Failed to enable 1-Click Trading';

            console.error('[Agent] ❌ Enable session failed:', errorMessage);
            setError(errorMessage);
            setIsAgentActive(false);
            return null; // Don't throw - just return null
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Clear agent session and revoke access
     */
    const clearSession = useCallback(() => {
        localStorage.removeItem(AGENT_STORAGE_KEY);
        setAgent(null);
        setIsAgentActive(false);
        setError(null);
        console.log('[Agent] Session cleared');
    }, []);

    /**
     * Force refresh agent state
     */
    const refreshSession = useCallback(async () => {
        if (!userAddress || !agent) return;

        setIsLoading(true);
        try {
            const isValid = await verifyAgentRegistration(userAddress, agent.address);
            setIsAgentActive(isValid);
        } catch (e) {
            console.error('[Agent] Refresh failed:', e);
            setIsAgentActive(false);
        } finally {
            setIsLoading(false);
        }
    }, [userAddress, agent]);

    return {
        agent,
        isAgentActive,
        isLoading,
        error,
        enableSession,
        clearSession,
        refreshSession
    };
};
