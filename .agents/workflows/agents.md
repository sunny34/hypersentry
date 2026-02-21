---
description: agents
---

# Hyperliquid Agent Session Management

## Overview
Production-grade implementation of 1-Click Trading using Hyperliquid's agent authorization system. This enables users to execute trades without signing each transaction individually.

## Architecture

### Core Components

1. **useHyperliquidSession Hook** (`hooks/useHyperliquidSession.ts`)
   - Manages agent wallet lifecycle
   - Handles EIP-712 approval signatures
   - Persistent state via localStorage
   - Automatic verification and recovery

2. **Agent Signing Utility** (`utils/signing.ts`)
   - EIP-712 typed data signing for orders
   - Payload construction for Hyperliquid API
   - MsgPack serialization

3. **OrderForm Integration** (`components/trading/OrderForm.tsx`)
   - Direct execution via agent
   - Fallback to manual signing
   - User feedback and error handling

## Session Flow

```
┌─────────────────┐
│ User clicks     │
│ Enable Trading  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 1. Generate ephemeral wallet    │
│    (random private key)          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 2. Request EIP-712 signature    │
│    from user's main wallet      │
│    Type: ApproveAgent            │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 3. Submit to Hyperliquid API    │
│    POST /exchange                │
│    with retry logic              │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 4. Verify registration          │
│    Query clearinghouseState     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 5. Persist to localStorage      │
│    Set isAgentActive = true     │
└─────────────────────────────────┘
```

## Security Features

### Agent Wallet Scope
- **User-specific**: Each agent is tied to the approving wallet address
- **Ephemeral**: Generated fresh for each session
- **Revocable**: User can clear session at any time

### Storage Security
```typescript
{
  address: "0x...",        // Agent wallet address
  privateKey: "0x...",     // Encrypted in production
  created: 1234567890,     // Timestamp
  userAddress: "0x..."     // Owner wallet (validation)
}
```

### Validation Layers
1. **Signature Verification**: EIP-712 ensures only the user can approve
2. **User Matching**: Agent verified against current wallet
3. **API Verification**: Cross-check with Hyperliquid registry
4. **Expiry Check**: Auto-clear stale sessions (future)

## Error Handling

### Retry Strategy
- **Max Retries**: 3 attempts
- **Backoff**: Exponential (1s, 2s, 3s)
- **Timeout**: 10s per request

### Response Validation
```typescript
isSuccessfulResponse():
  - status === 'ok'
  - status === 'success'
  - response.type === 'default'
  - response.type === 'approveAgent'
  - no explicit error field
```

### Error Messages
- User-friendly messages in UI
- Detailed logs in console
- Actionable suggestions

## API Integration

### Approval Endpoint
```
POST https://api.hyperliquid.xyz/exchange
```

**Payload:**
```json
{
  "action": {
    "type": "approveAgent",
    "agent": {
      "source": "https://hyperliquid.xyz",
      "connectionId": "0x..." // agent address padded
    },
    "nonce": 1234567890
  },
  "nonce": 1234567890,
  "signature": {
    "r": "0x...",
    "s": "0x...",
    "v": 28
  }
}
```

**Response (Success):**
```json
{
  "status": "ok",
  "response": {
    "type": "default"
  }
}
```

### Order Execution Endpoint
```
POST https://api.hyperliquid.xyz/exchange
```

**Payload:**
```json
{
  "type": "agent",
  "action": {
    "type": "order",
    "orders": [...],
    "grouping": "na",
    "nonce": 1234567890
  },
  "nonce": 1234567890,
  "signature": { ... },
  "agentAddress": "0x..."
}
```

## State Management

### Hook States
```typescript
{
  agent: AgentWallet | null,
  isAgentActive: boolean,
  isLoading: boolean,
  error: string | null
}
```

### Lifecycle Methods
- `enableSession()`: Create and approve new agent
- `clearSession()`: Revoke and remove agent
- `refreshSession()`: Re-verify existing agent

## Testing Checklist

### Manual Testing
- [ ] First-time agent approval
- [ ] Signature rejection handling
- [ ] Network timeout handling
- [ ] Page refresh persistence
- [ ] Multi-wallet switching
- [ ] Agent re-verification
- [ ] Order execution flow

### Edge Cases
- [ ] Rapid enable/disable clicks
- [ ] Wallet disconnect during approval
- [ ] Invalid response formats
- [ ] Expired agent sessions
- [ ] Conflicting localStorage data

## Production Deployment

### Environment Variables
```env
NEXT_PUBLIC_HYPERLIQUID_API=https://api.hyperliquid.xyz
```

### Security Hardening
1. **Encrypt private keys** in localStorage (future)
2. **Add session expiry** (24h recommended)
3. **Implement rate limiting** for enableSession
4. **Add CSRF protection** for sensitive operations
5. **Monitor for suspicious patterns**

### Performance
- Lazy-load agent verification
- Cache API responses
- Debounce rapid clicks
- Optimize re-renders

## Monitoring

### Key Metrics
- Agent approval success rate
- Average approval time
- Retry rate
- Verification failures
- Order execution latency

### Logging
```typescript
[Agent] Generating new agent wallet...
[Agent] Requesting approval signature...
[Agent] Signature received, registering...
[Agent] Registration response: {...}
[Agent] Verifying registration...
[Agent] ✅ 1-Click Trading enabled
```

## Troubleshooting

### "Agent registration rejected"
- Check wallet has sufficient balance
- Verify correct chainId (42161)
- Ensure user signed the correct message
- Try clearing cache and re-enabling

### "Signature Rejected"
- User cancelled MetaMask popup
- Wrong wallet connected
- Hardware wallet compatibility

### Session not persisting
- Check localStorage permissions
- Verify userAddress matching
- Clear site data and retry

## Future Enhancements

1. **Session Expiry**: Auto-revoke after 24h
2. **Multi-Agent Support**: Different agents for different risk levels
3. **Key Encryption**: Encrypt private keys at rest
4. **Biometric Auth**: Additional security layer
5. **Agent Analytics**: Track performance by agent
6. **Backup Recovery**: Export/import agent keys

## References

- [Hyperliquid API Docs](https://hyperliquid.gitbook.io/)
- [EIP-712 Specification](https://eips.ethereum.org/EIPS/eip-712)
- [Agent Trading Guide](https://hyperliquid.xyz/docs/agents)
