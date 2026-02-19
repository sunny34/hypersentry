import { create } from 'zustand';

const SCORE_ALPHA = 0.08; // Much slower smoothing (8% of new value)
const SCORE_DEADBAND = 3.0; // Require 3% change before updating UI
const SCORE_FORCE_REFRESH_MS = 10000; // Only force refresh after 10 seconds
const CONVICTION_DEADBAND = 0.1; // Require bigger conviction change
const PLAN_STALE_TTL_MS = 60_000;

// Types derived from backend Pydantic models
export interface ConvictionData {
    symbol: string;
    bias: 'LONG' | 'SHORT' | 'NEUTRAL';
    score: number; // 0-100
    conviction_score: number; // Raw -1 to 1
    raw_score?: number;
    raw_conviction_score?: number;
    ui_updated_at?: number;
    regime: string;
    expected_move: number;
    prob_up_1pct: number;
    prob_down_1pct: number;
    realized_vol: number;
    timestamp: number;
    explanation?: string[];
    // Stability tracking
    bias_streak?: number; // How many consecutive readings on same side
    last_bias_change?: number; // Timestamp of last bias change
}

export interface RiskData {
    symbol: string;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    size_usd: number;
    leverage: number;
    risk_percent_equity: number;
    equity_used?: number;
    max_position_cap_usd?: number;
    stop_loss_price?: number;
    take_profit_price?: number;
    breakdown: {
        edge_component: number;
        kelly_fraction: number;
        vol_adjustment: number;
        regime_multiplier: number;
        drawdown_multiplier: number;
        correlation_penalty: number;
    };
}

export interface ExecutionPlan {
    symbol: string;
    direction?: 'BUY' | 'SELL';
    strategy: 'PASSIVE' | 'HYBRID' | 'AGGRESSIVE';
    total_size_usd: number;
    urgency_score: number;
    timestamp?: number;
    adverse_selection_checks?: Record<string, boolean>;
    slippage_metrics: {
        expected_impact_bps: number;
        expected_impact_usd: number;
    };
    slices: Array<{
        slice_id: number;
        size?: number;
        amount_usd?: number;
        type?: string;
        order_type?: string;
        direction?: string;
        urgency: string;
        delay_ms: number;
    }>;
}

export interface ExecutionLog {
    id: string;
    timestamp: number;
    type: 'EXEC' | 'PLAN' | 'INTEL' | 'SYSTEM';
    message: string;
}

export interface GovernanceReport {
    symbol: string;
    active_regime: string;
    active_model_id: string;
    calibration_status: 'OPTIMAL' | 'DEGRADED' | 'STALE';
    feature_drift: Record<string, unknown>;
    last_retrain_timestamp?: number;
    regime_stability?: number;
}

export interface AlphaStore {
    convictions: Record<string, ConvictionData>;
    risks: Record<string, RiskData>;
    executionPlans: Record<string, ExecutionPlan>;
    governance: Record<string, GovernanceReport>;
    executionLogs: ExecutionLog[];
    stream: {
        connected: boolean;
        status: 'connecting' | 'live' | 'degraded' | 'stale' | 'disconnected';
        lastConnectedAt: number | null;
        lastMessageAt: number | null;
        reconnectCount: number;
        error: string | null;
    };
    activeSymbol: string;
    autonomousMode: boolean;
    setConviction: (symbol: string, data: ConvictionData) => void;
    setRisk: (symbol: string, data: RiskData) => void;
    setGovernance: (symbol: string, data: GovernanceReport) => void;
    setExecutionPlan: (symbol: string, plan: ExecutionPlan) => void;
    pruneStaleExecutionPlans: () => void;
    setActiveSymbol: (symbol: string) => void;
    setStreamState: (state: Partial<AlphaStore['stream']>) => void;
    addLog: (log: Omit<ExecutionLog, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;
}

const toFinite = (val: unknown, fallback: number): number => {
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
};

const clamp = (val: number, min: number, max: number): number => Math.max(min, Math.min(max, val));

// Enhanced smoothing with stability check
const smoothConviction = (prev: ConvictionData | undefined, incoming: ConvictionData): ConvictionData => {
    const now = Date.now();
    const rawScore = clamp(toFinite(incoming.score, prev?.score ?? 50), 0, 100);
    const rawConvictionScore = clamp(toFinite(incoming.conviction_score, prev?.conviction_score ?? 0), -1, 1);

    if (!prev) {
        return {
            ...incoming,
            score: Math.round(rawScore),
            conviction_score: Number(rawConvictionScore.toFixed(3)),
            raw_score: rawScore,
            raw_conviction_score: rawConvictionScore,
            ui_updated_at: now,
            bias_streak: 0,
            last_bias_change: now,
        };
    }

    const prevUiTs = prev.ui_updated_at ?? prev.timestamp ?? 0;
    const forceRefresh = now - prevUiTs >= SCORE_FORCE_REFRESH_MS;

    // EMA smoothing
    const emaScore = prev.score + ((rawScore - prev.score) * SCORE_ALPHA);
    const scoreDelta = Math.abs(emaScore - prev.score);
    const nextScore = (scoreDelta >= SCORE_DEADBAND || forceRefresh)
        ? Math.round(emaScore)
        : prev.score;

    const emaConviction = prev.conviction_score + ((rawConvictionScore - prev.conviction_score) * SCORE_ALPHA);
    const convictionDelta = Math.abs(emaConviction - prev.conviction_score);
    const nextConviction = (convictionDelta >= CONVICTION_DEADBAND || forceRefresh)
        ? Number(emaConviction.toFixed(3))
        : prev.conviction_score;

    // Determine bias with streak tracking
    let nextBias: 'LONG' | 'SHORT' | 'NEUTRAL' = prev.bias;
    let biasStreak = prev.bias_streak ?? 0;
    const lastBiasChange = prev.last_bias_change ?? now;

    // Calculate raw bias from score
    const rawBias: 'LONG' | 'SHORT' | 'NEUTRAL' =
        nextScore >= 55 ? 'LONG' :
            nextScore <= 45 ? 'SHORT' : 'NEUTRAL';

    // Only change bias if we have a sustained streak
    if (rawBias === prev.bias) {
        biasStreak += 1;
    } else {
        biasStreak = 1; // Reset streak
    }

    // Require at least 5 consecutive readings to change bias
    if (biasStreak >= 5) {
        nextBias = rawBias;
        if (rawBias !== prev.bias) {
            // Bias changed - log it
            console.log(`[BIAS CHANGE] ${incoming.symbol}: ${prev.bias} -> ${nextBias} (streak: ${biasStreak})`);
        }
    } else {
        // Not enough streak - keep previous bias
        nextBias = prev.bias;
    }

    return {
        ...incoming,
        score: clamp(nextScore, 0, 100),
        conviction_score: clamp(nextConviction, -1, 1),
        raw_score: rawScore,
        raw_conviction_score: rawConvictionScore,
        ui_updated_at: now,
        bias: nextBias,
        bias_streak: biasStreak,
        last_bias_change: nextBias !== prev.bias ? now : lastBiasChange,
    };
};

export const useAlphaStore = create<AlphaStore>((set) => ({
    convictions: {},
    risks: {},
    executionPlans: {},
    governance: {},
    executionLogs: [],
    stream: {
        connected: false,
        status: 'connecting',
        lastConnectedAt: null,
        lastMessageAt: null,
        reconnectCount: 0,
        error: null
    },
    activeSymbol: 'BTC',
    autonomousMode: false,

    setConviction: (symbol, data) => set((state) => {
        const key = symbol.toUpperCase();
        const prev = state.convictions[key];
        const normalized: ConvictionData = {
            ...data,
            symbol: key,
            timestamp: toFinite(data.timestamp, Date.now())
        };
        const next = smoothConviction(prev, normalized);
        return {
            convictions: { ...state.convictions, [key]: next }
        };
    }),

    setRisk: (symbol, data) => set((state) => {
        const key = symbol.toUpperCase();
        return {
            risks: { ...state.risks, [key]: { ...data, symbol: key } }
        };
    }),

    setGovernance: (symbol, data) => set((state) => {
        const key = symbol.toUpperCase();
        return {
            governance: { ...state.governance, [key]: { ...data, symbol: key } }
        };
    }),

    setExecutionPlan: (symbol, plan) => set((state) => {
        const key = symbol.toUpperCase();
        const now = Date.now();
        const normalized = {
            ...plan,
            symbol: key,
            timestamp: toFinite(plan.timestamp, now)
        };
        const prevPlan = state.executionPlans[key];
        const stale = prevPlan && (now - (prevPlan.timestamp ?? 0)) > PLAN_STALE_TTL_MS;
        return {
            executionPlans: stale
                ? state.executionPlans
                : { ...state.executionPlans, [key]: normalized }
        };
    }),

    pruneStaleExecutionPlans: () => set((state) => {
        const now = Date.now();
        const pruned = Object.fromEntries(
            Object.entries(state.executionPlans).filter(
                ([_, plan]) => (now - ((plan).timestamp ?? 0)) <= PLAN_STALE_TTL_MS
            )
        );
        return { executionPlans: pruned };
    }),

    setActiveSymbol: (symbol) => set({ activeSymbol: symbol.toUpperCase() }),

    setStreamState: (streamUpdate) => set((state) => ({
        stream: { ...state.stream, ...streamUpdate }
    })),

    addLog: (log) => set((state) => {
        const newLog: ExecutionLog = {
            ...log,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        const logs = [newLog, ...state.executionLogs].slice(0, 500);
        return { executionLogs: logs };
    }),

    clearLogs: () => set({ executionLogs: [] })
}));
