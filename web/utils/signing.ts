
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
    vaultAddress: string | null = null,
    nonce: number
) {
    // 1. Construct the payload matching Hyperliquid's expectation
    // Hyperliquid action wrapper including nonce (if standard signing?)
    // Actually the hash is over the action body provided to the endpoint.
    // The endpoint expects { action: ..., nonce: ..., signature: ... }

    // The "msgpack payload" is: action + nonce + vaultAddress (if any)
    const payload = {
        ...action,
        nonce,
    };
    if (vaultAddress) {
        // @ts-ignore
        payload['vaultAddress'] = vaultAddress;
    }

    // 2. Encode with MsgPack
    // Note: Keys must be sorted? MsgPack doesn't mandate sort but HL might? 
    // Usually HL Python SDK just packs the dictionary.
    const packed = encode(action);
    // WAIT. Python SDK packs ONLY the `action` object (inner).
    // NOT the nonce.
    // Let's verify.
    // Python SDK `sign_l1_action`: `hash = keccak(pack(action))`

    const actionPacked = encode(action);
    const actionHash = ethers.keccak256(new Uint8Array(actionPacked));

    // 3. Sign "Agent" typed data
    // connectionId = actionHash
    const signature = await agentUser.signTypedData(
        DOMAIN,
        AGENT_TYPES,
        {
            source: "b", // 'b' stands for Agent/Backend?
            connectionId: actionHash
        }
    );

    // 4. Return formatted result
    // Signature needs to be split into r, s, v
    const sig = ethers.Signature.from(signature);

    return {
        method: "post", // "post" or "get"?
        payload: {
            action,
            nonce,
            signature: {
                r: sig.r,
                s: sig.s,
                v: sig.v
            },
            vaultAddress
        }
    };
}

export function getTimestampMs() {
    return Date.now();
}
