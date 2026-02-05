
import { encode } from '@msgpack/msgpack';
import { ethers } from 'ethers';

// Hyperliquid Mainnet ID (Arbitrum One) for L1, but for signing it might use a custom ID?
// Actually for 'HyperliquidSignTransaction' it uses 42161 (Arbitrum) usually?
// Docs: "chainId: 1337" for testnet/devnet. Mainnet is 42161.
const IS_MAINNET = true; // Todo: config

const DOMAIN = {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 42161, // Arbitrum
    verifyingContract: "0x0000000000000000000000000000000000000000"
};

const AGENT_TYPES = {
    Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
    ],
};

export async function signAgentAction(
    agentUser: ethers.Wallet,
    action: any,
    nonce: number,
    vaultAddress: string | null = null
) {
    // 1. Encode the inner action with MsgPack
    // Note: Hyperliquid expects the raw MsgPack bytes to be hashed
    const actionPacked = encode(action);
    const actionHash = ethers.keccak256(new Uint8Array(actionPacked));

    // 2. Sign the Agent Typed Data
    // For L1 actions, Hyperliquid uses the hash of the action as the connectionId
    const signature = await agentUser.signTypedData(
        DOMAIN,
        AGENT_TYPES,
        {
            source: "b", // 'b' for backend/agent
            connectionId: actionHash
        }
    );

    // 3. Split signature for the API
    const sig = ethers.Signature.from(signature);

    // 4. Construct the full payload expected by /exchange
    const payload: any = {
        action,
        nonce,
        signature: {
            r: sig.r,
            s: sig.s,
            v: sig.v
        }
    };

    if (vaultAddress) {
        payload.vaultAddress = vaultAddress;
    }

    return payload;
}

export function getTimestampMs() {
    return Date.now();
}
