import { useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useAlphaStore, ExecutionPlan } from '@/store/useAlphaStore';
import { useModeStore } from '@/store/useModeStore';
import { useAuth } from '@/contexts/AuthContext';
import { useHyperliquidSession } from '@/hooks/useHyperliquidSession';
import { useMarketStore } from '@/store/useMarketStore';
import { signAgentAction, floatToWire, roundPrice } from '@/utils/signing';
import { API_URL } from '@/lib/constants';

type AssetMap = Record<string, number>;

const MIN_ORDER_USD = Math.max(10, Number(process.env.NEXT_PUBLIC_ALPHA_AUTO_MIN_ORDER_USD || 25));
const MAX_ORDER_USD = Math.max(MIN_ORDER_USD, Number(process.env.NEXT_PUBLIC_ALPHA_AUTO_MAX_ORDER_USD || 1000));
const ORDER_COOLDOWN_MS = Math.max(1000, Number(process.env.NEXT_PUBLIC_ALPHA_AUTO_COOLDOWN_MS || 12000));
const STALE_PLAN_MS = Math.max(2000, Number(process.env.NEXT_PUBLIC_ALPHA_AUTO_PLAN_STALE_MS || 30000));
const SYSTEM_LOG_THROTTLE_MS = 30000;

const isSuccessResponse = (payload: any): boolean => {
    if (!payload) return false;
    if (payload.status === 'ok' || payload.status === 'success') return true;
    const responseType = payload.response?.type;
    return responseType === 'default' || responseType === 'order';
};

const parseOrderError = (error: unknown): string => {
    if (!error) return 'unknown_error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    const maybeAxios = error as any;
    const detail = maybeAxios?.response?.data?.error
        || maybeAxios?.response?.data?.detail
        || maybeAxios?.response?.data?.response?.error
        || maybeAxios?.message;
    return String(detail || 'unknown_error');
};

const normalizeDirection = (plan: ExecutionPlan, convictionBias?: string): 'BUY' | 'SELL' | null => {
    if (plan.direction === 'BUY' || plan.direction === 'SELL') return plan.direction;
    if (convictionBias === 'LONG') return 'BUY';
    if (convictionBias === 'SHORT') return 'SELL';
    return null;
};

const getSliceUsd = (plan: ExecutionPlan): number => {
    const firstSlice = Array.isArray(plan.slices) ? plan.slices[0] : null;
    const fromSlice = Number(firstSlice?.amount_usd ?? firstSlice?.size ?? 0);
    if (Number.isFinite(fromSlice) && fromSlice > 0) return fromSlice;
    const total = Number(plan.total_size_usd || 0);
    return Number.isFinite(total) ? total : 0;
};

export const useAlphaAutonomousExecution = () => {
    const { mode } = useModeStore();
    const { token, isAuthenticated, isLoading: authLoading } = useAuth();
    const { agent, isAgentActive } = useHyperliquidSession();
    const addLog = useAlphaStore((s) => s.addLog);
    const plans = useAlphaStore((s) => s.executionPlans);
    const pruneStaleExecutionPlans = useAlphaStore((s) => s.pruneStaleExecutionPlans);
    const convictions = useAlphaStore((s) => s.convictions);
    const marketData = useMarketStore((s) => s.marketData);

    const assetMapRef = useRef<AssetMap>({});
    const inFlightRef = useRef<Set<string>>(new Set());
    const lastExecRef = useRef<Map<string, number>>(new Map());
    const lastFingerprintRef = useRef<Map<string, string>>(new Map());
    const lastSystemLogRef = useRef<Map<string, number>>(new Map());
    const lastNonceRef = useRef(0);
    const announcedAutoModeRef = useRef(false);
    const readyAnnouncedRef = useRef(false);

    const logSystemThrottled = useCallback((key: string, message: string) => {
        const now = Date.now();
        const last = lastSystemLogRef.current.get(key) || 0;
        if (now - last < SYSTEM_LOG_THROTTLE_MS) return;
        lastSystemLogRef.current.set(key, now);
        addLog({ type: 'SYSTEM', message });
    }, [addLog]);

    const refreshAssetMap = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/trading/tokens`, { timeout: 10000 });
            const tokens = Array.isArray(res.data?.tokens) ? res.data.tokens : [];
            const nextMap: AssetMap = {};
            for (const t of tokens) {
                const symbol = String(t?.symbol || '').toUpperCase();
                const idx = Number(t?.index);
                if (!symbol || !Number.isInteger(idx) || idx < 0) continue;
                nextMap[symbol] = idx;
            }
            if (Object.keys(nextMap).length > 0) {
                assetMapRef.current = nextMap;
            }
        } catch {
            // keep existing map and retry later
        }
    }, []);

    useEffect(() => {
        void refreshAssetMap();
        const timer = setInterval(() => {
            void refreshAssetMap();
        }, 60000);
        return () => clearInterval(timer);
    }, [refreshAssetMap]);

    useEffect(() => {
        const timer = setInterval(() => {
            pruneStaleExecutionPlans();
        }, 3000);
        return () => clearInterval(timer);
    }, [pruneStaleExecutionPlans]);

    const nextNonce = useCallback(() => {
        const now = Date.now();
        const candidate = Math.max(now, lastNonceRef.current + 1);
        lastNonceRef.current = candidate;
        return candidate;
    }, []);

    const executePlan = useCallback(async (symbol: string, plan: ExecutionPlan) => {
        const upperSymbol = symbol.toUpperCase();
        if (inFlightRef.current.has(upperSymbol)) return;
        const signingKey = agent?.privateKey;
        const hasSigningKey = !!signingKey;

        if (authLoading) {
            logSystemThrottled('auto_auth_loading', 'Autonomous execution waiting for auth session hydration...');
            return;
        }

        if (!isAuthenticated || !token) {
            logSystemThrottled(
                'auto_no_auth',
                'Autonomous execution paused: session auth required. Use Execution Auth panel on /alpha.'
            );
            return;
        }

        if (!hasSigningKey) {
            logSystemThrottled(
                'auto_no_agent',
                'Autonomous execution paused: enable 1-Click Terminal session key.'
            );
            return;
        }
        if (!isAgentActive) {
            logSystemThrottled(
                'auto_agent_verify_pending',
                'Agent verification pending, signing key detected. Attempting relay.'
            );
        }

        const direction = normalizeDirection(plan, convictions[upperSymbol]?.bias);
        if (!direction) {
            logSystemThrottled(`auto_no_direction_${upperSymbol}`, `Skipped ${upperSymbol}: missing plan direction.`);
            return;
        }

        const assetId = assetMapRef.current[upperSymbol];
        if (!Number.isInteger(assetId)) {
            logSystemThrottled(`auto_no_asset_${upperSymbol}`, `Skipped ${upperSymbol}: asset mapping unavailable.`);
            return;
        }

        const price = Number(marketData[upperSymbol]?.price || 0);
        if (!Number.isFinite(price) || price <= 0) {
            logSystemThrottled(`auto_no_price_${upperSymbol}`, `Skipped ${upperSymbol}: live price unavailable.`);
            return;
        }

        const planTs = Number(plan.timestamp || 0);
        if (planTs > 0 && (Date.now() - planTs) > STALE_PLAN_MS) {
            logSystemThrottled(`auto_stale_${upperSymbol}`, `Skipped ${upperSymbol}: plan became stale.`);
            return;
        }

        const rawUsd = getSliceUsd(plan);
        if (!Number.isFinite(rawUsd) || rawUsd < MIN_ORDER_USD) {
            logSystemThrottled(
                `auto_too_small_${upperSymbol}`,
                `Skipped ${upperSymbol}: slice below minimum ($${MIN_ORDER_USD}).`
            );
            return;
        }

        const clippedUsd = Math.min(rawUsd, MAX_ORDER_USD);
        if (clippedUsd < rawUsd) {
            logSystemThrottled(
                `auto_clip_${upperSymbol}`,
                `Capped ${upperSymbol} plan from $${Math.round(rawUsd)} to $${Math.round(clippedUsd)} (auto max).`
            );
        }
        const now = Date.now();
        const lastExecAt = lastExecRef.current.get(upperSymbol) || 0;
        if (now - lastExecAt < ORDER_COOLDOWN_MS) {
            return;
        }

        const fingerprint = [
            upperSymbol,
            direction,
            plan.strategy,
            Math.round(clippedUsd),
            Math.round((plan.urgency_score || 0) * 100),
        ].join(':');

        if (lastFingerprintRef.current.get(upperSymbol) === fingerprint && now - lastExecAt < (ORDER_COOLDOWN_MS * 2)) {
            return;
        }

        const sizeBase = clippedUsd / price;
        if (!Number.isFinite(sizeBase) || sizeBase <= 0) {
            return;
        }

        inFlightRef.current.add(upperSymbol);
        try {
            addLog({
                type: 'EXEC',
                message: `Submitting ${direction} ${upperSymbol} $${Math.round(clippedUsd)} (${plan.strategy})`,
            });

            const isBuy = direction === 'BUY';
            const limitPx = isBuy ? price * 1.01 : price * 0.99;
            const orderAction = {
                type: 'order',
                orders: [{
                    a: assetId,
                    b: isBuy,
                    p: floatToWire(roundPrice(limitPx)),
                    s: floatToWire(sizeBase),
                    r: false,
                    t: { limit: { tif: 'Ioc' } },
                }],
                grouping: 'na',
            };

            const wallet = new ethers.Wallet(signingKey);
            const signedPayload = await signAgentAction(wallet, orderAction, nextNonce());
            const response = await axios.post(
                `${API_URL}/trading/order`,
                signedPayload,
                { timeout: 10000, headers: { Authorization: `Bearer ${token}` } },
            );

            if (!isSuccessResponse(response.data)) {
                throw new Error(
                    response.data?.error
                    || response.data?.response?.error
                    || 'order_rejected'
                );
            }

            lastExecRef.current.set(upperSymbol, Date.now());
            lastFingerprintRef.current.set(upperSymbol, fingerprint);
            addLog({
                type: 'EXEC',
                message: `Executed ${direction} ${upperSymbol} (notional $${Math.round(clippedUsd)})`,
            });
        } catch (error) {
            const errText = parseOrderError(error).slice(0, 160);
            addLog({
                type: 'EXEC',
                message: `Execution failed ${upperSymbol}: ${errText}`,
            });
        } finally {
            inFlightRef.current.delete(upperSymbol);
        }
    }, [addLog, agent?.privateKey, authLoading, convictions, isAgentActive, isAuthenticated, logSystemThrottled, marketData, nextNonce, token]);

    useEffect(() => {
        if (mode !== 'autonomous') {
            announcedAutoModeRef.current = false;
            readyAnnouncedRef.current = false;
            return;
        }

        if (!announcedAutoModeRef.current) {
            announcedAutoModeRef.current = true;
            addLog({
                type: 'SYSTEM',
                message: 'Autonomous mode armed. Plans will execute when auth and agent signing are available.',
            });
        }

        const hasSigningKey = !!agent?.privateKey;
        if (!readyAnnouncedRef.current && isAuthenticated && !!token && hasSigningKey) {
            readyAnnouncedRef.current = true;
            addLog({
                type: 'SYSTEM',
                message: 'Autonomous execution ready: auth + signing key verified.',
            });
        }

        const orderedPlans = Object.entries(plans)
            .sort((a, b) => (b[1]?.urgency_score || 0) - (a[1]?.urgency_score || 0))
            .slice(0, 8);

        logSystemThrottled(
            'auto_status',
            `Auto status: plans=${orderedPlans.length} auth=${isAuthenticated && !!token ? 'ok' : authLoading ? 'loading' : 'missing'} agent_key=${hasSigningKey ? 'present' : 'missing'} agent_state=${isAgentActive ? 'active' : 'inactive'} assets=${Object.keys(assetMapRef.current).length}`
        );

        if (orderedPlans.length === 0) {
            logSystemThrottled('auto_no_plans', 'Autonomous execution waiting: no active execution plans.');
        }

        for (const [symbol, plan] of orderedPlans) {
            void executePlan(symbol, plan);
        }
    }, [addLog, agent?.privateKey, authLoading, executePlan, isAgentActive, isAuthenticated, logSystemThrottled, mode, plans, token]);
};
