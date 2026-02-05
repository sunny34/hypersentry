import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ethers } from 'ethers';
import axios from 'axios';

// Constants
const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';

interface AgentWallet {
    address: string;
    privateKey: string;
    created: number;
}

export const useHyperliquidSession = () => {
    const { address: userAddress } = useAccount();
    const { data: walletClient } = useWalletClient();
    const [agent, setAgent] = useState<AgentWallet | null>(null);
    const [isAgentActive, setIsAgentActive] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Load from local storage on mount
    useEffect(() => {
        if (!userAddress) return;
        const stored = localStorage.getItem(`hl_agent_${userAddress}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setAgent(parsed);
                // Validate if still active/authorized could be done here via API
                checkAgentStatus(userAddress, parsed.address);
            } catch (e) {
                console.error("Failed to parse agent wallet", e);
            }
        }
    }, [userAddress]);

    const checkAgentStatus = async (user: string, agentAddr: string) => {
        try {
            const res = await axios.post(`${HYPERLIQUID_API_URL}/info`, {
                type: "meta"
            });
            // Ideally we check specific agent registry, but HL doesn't expose a direct "is agent X active" easily without deep info
            // For now we assume if it exists locally, we try to use it.
            setIsAgentActive(true);
        } catch (e) {
            console.error("Agent status check failed", e);
        }
    };

    /**
     * Create a new Agent Wallet and Authorize it on Hyperliquid
     */
    /**
     * Create a new Agent Wallet and Authorize it on Hyperliquid
     */
    const enableSession = async () => {
        if (!userAddress || !walletClient) {
            throw new Error("Wallet not connected");
        }

        setIsLoading(true);
        try {
            // 1. Generate new random wallet (ephemeral agent)
            const randomWallet = ethers.Wallet.createRandom();
            const agentAddress = randomWallet.address;
            const privateKey = randomWallet.privateKey;

            console.log("Generating Agent Authorization for:", agentAddress);

            // 2. Define Hyperliquid EIP-712 Domain and Types for "Approve Agent"
            const domain = {
                name: "Exchange",
                version: "1",
                chainId: 42161, // Hyperliquid Mainnet (Arbitrum Domain)
                verifyingContract: "0x0000000000000000000000000000000000000000"
            } as const;

            const types = {
                Agent: [
                    { name: "source", type: "string" },
                    { name: "connectionId", type: "bytes32" },
                ],
                ApproveAgent: [
                    { name: "agent", type: "Agent" },
                    { name: "nonce", type: "uint64" },
                ],
            } as const;

            const nonce = Date.now();

            // connectionId for ApproveAgent is the agent address zero-padded
            const connectionId = ethers.zeroPadValue(agentAddress, 32) as `0x${string}`;

            const message = {
                agent: {
                    source: "https://hyperliquid.xyz",
                    connectionId: connectionId,
                },
                nonce: BigInt(nonce),
            };

            // 3. Request Signature from User's Main Wallet
            const signature = await walletClient.signTypedData({
                account: userAddress as `0x${string}`,
                domain,
                types,
                primaryType: 'ApproveAgent',
                message,
            });

            console.log("Agent Approved with signature:", signature);

            // 4. Register Agent with Hyperliquid API
            const sig = ethers.Signature.from(signature);
            const action = {
                type: "approveAgent",
                agent: {
                    source: "https://hyperliquid.xyz",
                    connectionId: connectionId,
                },
                nonce: nonce,
            };

            const registrationPayload = {
                action,
                nonce,
                signature: {
                    r: sig.r,
                    s: sig.s,
                    v: sig.v
                }
            };

            const response = await axios.post(`${HYPERLIQUID_API_URL}/exchange`, registrationPayload);

            if (response.data.status !== 'ok') {
                throw new Error(response.data.response?.error || response.data.response || "Failed to register agent on Hyperliquid");
            }

            // 5. Save locally only after successful API registration
            const newAgent = {
                address: agentAddress,
                privateKey: privateKey,
                created: Date.now()
            };

            setAgent(newAgent);
            localStorage.setItem(`hl_agent_${userAddress}`, JSON.stringify(newAgent));
            setIsAgentActive(true);

            return newAgent;

        } catch (e: any) {
            console.error("Failed to enable session:", e);
            throw e;
        } finally {
            setIsLoading(false);
        }
    };

    const clearSession = () => {
        if (userAddress) {
            localStorage.removeItem(`hl_agent_${userAddress}`);
        }
        setAgent(null);
        setIsAgentActive(false);
    };

    return {
        agent,
        isAgentActive,
        enableSession,
        clearSession,
        isLoading
    };
};
