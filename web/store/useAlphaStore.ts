import { create } from 'zustand';

const SCORE_ALPHA = 0.25;
const SCORE_DEADBAND = 1.0;
const SCORE_FORCE_REFRESH_MS = 3000;
const CONVICTION_DEADBAND = 0.03;
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
}

export interface RiskData {
    symbol: string;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    size_usd: number;
    leverage: number;
    risk_percent_equity: number;
    equity_used?: number;
    max_position_cap_usd?: number;
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
}

export interface StreamState {
    connected: boolean;
    status: 'connecting' | 'live' | 'degraded' | 'stale' | 'disconnected';
    lastConnectedAt: number | null;
    lastMessageAt: number | null;
    reconnectCount: number;
    error: string | null;
}

interface AlphaStore {
    // Map of symbol -> data
    convictions: Record<string, ConvictionData>;
    risks: Record<string, RiskData>;
    executionPlans: Record<string, ExecutionPlan>;
    governance: Record<string, GovernanceReport>;
    executionLogs: ExecutionLog[];
    stream: StreamState;

    // Global State
    activeSymbol: string | null;
    autonomousMode: boolean;

    // Actions
    setConviction: (symbol: string, data: ConvictionData) => void;
    setRisk: (symbol: string, data: RiskData) => void;
    setExecutionPlan: (symbol: string, plan: ExecutionPlan) => void;
    pruneStaleExecutionPlans: () => void;
    setGovernance: (symbol: string, report: GovernanceReport) => void;
    setStreamState: (patch: Partial<StreamState>) => void;
    addLog: (log: Omit<ExecutionLog, 'id' | 'timestamp'>) => void;
    setActiveSymbol: (symbol: string) => void;
    toggleAutonomous: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toFinite = (value: unknown, fallback: number) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

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
            ui_updated_at: now
        };
    }

    const prevUiTs = prev.ui_updated_at ?? prev.timestamp ?? 0;
    const forceRefresh = now - prevUiTs >= SCORE_FORCE_REFRESH_MS;

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

    return {
        ...incoming,
        score: clamp(nextScore, 0, 100),
        conviction_score: clamp(nextConviction, -1, 1),
        raw_score: rawScore,
        raw_conviction_score: rawConvictionScore,
        ui_updated_at: now
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

    setExecutionPlan: (symbol, plan) => set((state) => {
        const key = symbol.toUpperCase();
        const now = Date.now();
        const normalized = {
            ...plan,
            symbol: key,
            timestamp: toFinite(plan.timestamp, now)
        };
        const nextPlans: Record<string, ExecutionPlan> = {
            ...state.executionPlans,
            [key]: normalized
        };
        for (const [sym, candidate] of Object.entries(nextPlans)) {
            const ts = toFinite(candidate.timestamp, 0);
            if (ts > 0 && (now - ts) > PLAN_STALE_TTL_MS) {
                delete nextPlans[sym];
            }
        }
        return {
            executionPlans: nextPlans
        };
    }),

    pruneStaleExecutionPlans: () => set((state) => {
        const now = Date.now();
        let changed = false;
        const nextPlans: Record<string, ExecutionPlan> = { ...state.executionPlans };
        for (const [sym, candidate] of Object.entries(nextPlans)) {
            const ts = toFinite(candidate.timestamp, 0);
            if (ts > 0 && (now - ts) > PLAN_STALE_TTL_MS) {
                delete nextPlans[sym];
                changed = true;
            }
        }
        if (!changed) return state;
        return { executionPlans: nextPlans };
    }),

    setGovernance: (symbol, report) => set((state) => {
        const key = symbol.toUpperCase();
        return {
            governance: { ...state.governance, [key]: { ...report, symbol: key } }
        };
    }),

    setStreamState: (patch) => set((state) => ({
        stream: { ...state.stream, ...patch }
    })),

    addLog: (log) => set((state) => {
        const newLog: ExecutionLog = {
            ...log,
            id: Math.random().toString(36).substring(7),
            timestamp: Date.now()
        };
        return {
            executionLogs: [newLog, ...state.executionLogs].slice(0, 50)
        };
    }),

    setActiveSymbol: (symbol) => set({ activeSymbol: symbol.toUpperCase() }),

    toggleAutonomous: () => set((state) => ({ autonomousMode: !state.autonomousMode }))
}));
