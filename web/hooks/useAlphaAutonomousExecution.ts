"use client";
import { useEffect, useRef, useCallback } from 'react';
import { useAlphaStore } from '@/store/useAlphaStore';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

/**
 * Autonomous Execution Hook
 * 
 * When enabled, monitors conviction scores from the alpha store.
 * If a symbol's conviction score >= 65 with a sustained bias streak,
 * it triggers the backend auto-trade pipeline.
 * 
 * Safety gates:
 * - Requires explicit user opt-in (stored in alpha store)
 * - Conviction must be >= 65 score (not just directional)
 * - Bias must be sustained (streak >= 5 readings)
 * - Cooldown: won't re-trigger the same symbol within 60s
 * - Max 3 concurrent active trades
 */

const AUTO_TRADE_MIN_SCORE = 65;
const AUTO_TRADE_MIN_STREAK = 5;
const AUTO_TRADE_COOLDOWN_MS = 60_000;
const AUTO_TRADE_MAX_CONCURRENT = 3;

export const useAlphaAutonomousExecution = () => {
    const autonomousMode = useAlphaStore((s) => s.autonomousMode);
    const cooldownRef = useRef<Record<string, number>>({});
    const activeTradesRef = useRef<Set<string>>(new Set());
    const isTrading = useRef(false);

    const executeTrade = useCallback(async (symbol: string, direction: 'BUY' | 'SELL', score: number) => {
        if (isTrading.current) return;
        isTrading.current = true;

        try {
            useAlphaStore.getState().addLog({
                type: 'EXEC',
                message: `[AUTONOMOUS] Triggering ${direction} for ${symbol} (conviction: ${score}/100)`
            });

            // The backend handles the actual trade execution in _check_and_execute_auto_trade
            // This endpoint triggers a fresh pipeline run which will auto-execute if conditions met
            await axios.post(`${API_URL}/alpha/autonomous/trigger`, {
                symbol,
                direction,
                conviction_score: score,
            }, { timeout: 10_000 });

            cooldownRef.current[symbol] = Date.now();
            activeTradesRef.current.add(symbol);

            useAlphaStore.getState().addLog({
                type: 'EXEC',
                message: `[AUTONOMOUS] ${direction} ${symbol} sent to execution pipeline`
            });
        } catch (e: any) {
            useAlphaStore.getState().addLog({
                type: 'SYSTEM',
                message: `[AUTONOMOUS] Execution failed for ${symbol}: ${e.message || 'Unknown error'}`
            });
        } finally {
            isTrading.current = false;
        }
    }, []);

    // Monitor conviction scores for auto-trade triggers
    useEffect(() => {
        if (!autonomousMode) return;

        const interval = setInterval(() => {
            const { convictions } = useAlphaStore.getState();
            const now = Date.now();

            // Clean up expired cooldowns
            for (const [sym, ts] of Object.entries(cooldownRef.current)) {
                if (now - ts > AUTO_TRADE_COOLDOWN_MS) {
                    delete cooldownRef.current[sym];
                    activeTradesRef.current.delete(sym);
                }
            }

            // Check each tracked symbol
            for (const [symbol, conv] of Object.entries(convictions)) {
                // Skip if on cooldown
                if (cooldownRef.current[symbol]) continue;

                // Skip if too many concurrent trades
                if (activeTradesRef.current.size >= AUTO_TRADE_MAX_CONCURRENT) break;

                // Must have strong conviction
                if (conv.score < AUTO_TRADE_MIN_SCORE) continue;

                // Must have sustained directional bias
                if ((conv.bias_streak ?? 0) < AUTO_TRADE_MIN_STREAK) continue;

                // Must not be neutral
                if (conv.bias === 'NEUTRAL') continue;

                const direction = conv.bias === 'LONG' ? 'BUY' : 'SELL';

                console.log(`[AUTONOMOUS] ${symbol} qualifies: ${direction} score=${conv.score} streak=${conv.bias_streak}`);
                void executeTrade(symbol, direction as 'BUY' | 'SELL', conv.score);
            }
        }, 5_000); // Check every 5 seconds

        return () => clearInterval(interval);
    }, [autonomousMode, executeTrade]);

    return {
        isEnabled: autonomousMode,
        isTrading: isTrading.current,
        lastTrade: null,
        activeTrades: Array.from(activeTradesRef.current),
        enable: () => useAlphaStore.setState({ autonomousMode: true }),
        disable: () => {
            useAlphaStore.setState({ autonomousMode: false });
            activeTradesRef.current.clear();
            cooldownRef.current = {};
        },
    };
};
