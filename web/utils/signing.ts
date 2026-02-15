
import { encode } from '@msgpack/msgpack';
import { ethers } from 'ethers';

// Hyperliquid Mainnet ID (Arbitrum One) for L1, but for signing it might use a custom ID?
// Actually for 'HyperliquidSignTransaction' it uses 42161 (Arbitrum) usually?
// Docs: "chainId: 1337" for testnet/devnet. Mainnet is 42161.
const IS_MAINNET = true; // Todo: config

const DOMAIN = {
    name: "Exchange",
    version: "1",
    chainId: 1337, // Hyperliquid L1 Internal ID (Mainnet & Testnet)
    verifyingContract: "0x0000000000000000000000000000000000000000"
};

const SOURCE = "a"; // 'a' = mainnet, 'b' = testnet

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
    const actionPacked = encode(action);

    // 2. Append 8-byte nonce + 1-byte vault indicator to the packed action
    // Hyperliquid L1 verification schema: MsgPack(action) + Nonce(8b BE) + VaultByte(0x00 or 0x01+Address)
    const combined = new Uint8Array(actionPacked.length + 8 + 1);
    combined.set(actionPacked);
    const view = new DataView(combined.buffer);
    view.setBigUint64(actionPacked.length, BigInt(nonce), false); // Big Endian

    // Vault Byte: 0x00 for no vault
    combined[actionPacked.length + 8] = 0;

    const connectionId = ethers.keccak256(combined);

    // 3. Sign the Agent Typed Data
    const signature = await agentUser.signTypedData(
        DOMAIN,
        AGENT_TYPES,
        {
            source: SOURCE,
            connectionId: connectionId
        }
    );

    // 3. Split signature for the API
    const sig = ethers.Signature.from(signature);

    // 4. Construct the exchange payload
    // For agent orders, Hyperliquid identifies the agent by the signature type (Agent EIP-712)
    // NOT by a separate "type" or "agentAddress" field
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

/**
 * Hyperliquid helper to convert float to wire string format.
 */
export function floatToWire(x: number): string {
    // HL L1 expects string representation of float with limited precision
    const rounded = x.toFixed(8);
    if (rounded.indexOf('.') === -1) return rounded;
    return rounded.replace(/\.?0+$/, "");
}

/**
 * Standard rounding for Hyperliquid prices (5 significant figures)
 */
export function roundPrice(px: number): number {
    if (px === 0) return 0;
    // HL requires 5 significant figures.
    // We also clamp decimals based on price magnitude to honor most tick sizes.
    const val = parseFloat(px.toPrecision(5));
    if (val > 1000) return parseFloat(val.toFixed(2));
    if (val > 10) return parseFloat(val.toFixed(3));
    return parseFloat(val.toFixed(4));
}
