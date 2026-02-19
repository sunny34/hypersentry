"use client";
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { useModeStore, SystemMode } from '@/store/useModeStore';
import { API_URL } from '@/lib/constants';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getWsUrl } from '@/lib/constants';

export interface TradingSettings {
    equity_usd: number;
    max_position_usd: number;
    max_risk_pct: number;
    max_leverage: number;
    target_profit_pct: number;
    stop_loss_pct: number;
    auto_mode_enabled: boolean;
    max_daily_trades: number;
    max_daily_loss_pct: number;
    // Account info
    account_balance?: number;
    available_balance?: number;
}

const DEFAULT_SETTINGS: TradingSettings = {
    equity_usd: 100000,
    max_position_usd: 1000,
    max_risk_pct: 0.02,
    max_leverage: 3,
    target_profit_pct: 0.03,
    stop_loss_pct: 0.01,
    auto_mode_enabled: false,
    max_daily_trades: 5,
    max_daily_loss_pct: 0.05,
};

export const useTradingSettings = () => {
    const { token, isAuthenticated } = useAuth();
    const { mode, setMode } = useModeStore();
    const [settings, setSettings] = useState<TradingSettings>(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [realtime, setRealtime] = useState(false);

    // WebSocket for real-time balance updates
    const { isConnected: wsConnected } = useWebSocket(
        getWsUrl() + (token ? `?token=${token}` : ''),
        (msg: any) => {
            if (msg?.type === 'balance_update' && msg?.data) {
                // Update balance in real-time
                setSettings(prev => ({
                    ...prev,
                    equity_usd: msg.data.total_equity,
                    account_balance: msg.data.total_equity,
                    available_balance: msg.data.available_balance,
                }));
                setRealtime(true);
            }
        }
    );

    const fetchSettings = useCallback(async () => {
        if (!isAuthenticated || !token) {
            setSettings(DEFAULT_SETTINGS);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_URL}/settings/trading`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            
            // Try to fetch account balance from Hyperliquid
            let accountBalance = res.data.equity_usd || DEFAULT_SETTINGS.equity_usd;
            try {
                const balanceRes = await axios.get(`${API_URL}/trading/balance`, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 5000,
                });
                if (balanceRes.data?.total_equity) {
                    accountBalance = balanceRes.data.total_equity;
                }
            } catch (e) {
                // Use fallback equity from settings
                console.log('Could not fetch live balance, using settings equity');
            }
            
            setSettings({
                ...res.data,
                equity_usd: accountBalance,
                account_balance: accountBalance,
                available_balance: accountBalance, // Simplified for now
            });
        } catch (err: any) {
            console.error('Failed to fetch trading settings:', err);
            setError(err.message || 'Failed to fetch settings');
            setSettings(DEFAULT_SETTINGS);
        } finally {
            setLoading(false);
        }
    }, [token, isAuthenticated]);

    const updateSettings = useCallback(async (updates: Partial<TradingSettings>) => {
        if (!isAuthenticated || !token) return null;

        setLoading(true);
        setError(null);
        try {
            const res = await axios.post(`${API_URL}/settings/trading`, updates, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setSettings(prev => ({ ...prev, ...res.data }));
            return res.data;
        } catch (err: any) {
            console.error('Failed to update trading settings:', err);
            setError(err.message || 'Failed to update settings');
            return null;
        } finally {
            setLoading(false);
        }
    }, [token, isAuthenticated]);

    const enableAutonomous = useCallback(async () => {
        // First save the settings, then switch mode
        if (isAuthenticated && token) {
            await updateSettings({ auto_mode_enabled: true });
        }
        // Switch to autonomous mode in the store
        setMode('autonomous');
    }, [isAuthenticated, token, updateSettings, setMode]);

    const disableAutonomous = useCallback(async () => {
        // Switch back to manual mode
        setMode('manual');
        // Update settings
        if (isAuthenticated && token) {
            await updateSettings({ auto_mode_enabled: false });
        }
    }, [isAuthenticated, token, updateSettings, setMode]);

    // Calculate intelligent position sizing
    const calculatePositionSize = useCallback((confidence: number, riskPercent?: number) => {
        const riskPct = riskPercent ?? settings.max_risk_pct;
        const equity = settings.equity_usd || 100000;
        
        // Risk amount in USD
        const riskAmount = equity * riskPct;
        
        // Adjust by confidence (only trade full size on high confidence)
        const confidenceMultiplier = Math.min(1, confidence / 80); // Scale 80%+ to 1x
        const adjustedRiskAmount = riskAmount * confidenceMultiplier;
        
        // Cap at max position
        return Math.min(adjustedRiskAmount * 50, settings.max_position_usd); // Assume 2% stop = 50x
    }, [settings]);

    // Get allocation for multiple trades
    const getTradeAllocation = useCallback((numTrades: number) => {
        const equity = settings.equity_usd || 100000;
        const maxPerTrade = settings.max_position_usd;
        
        // Intelligent allocation: don't risk more than 6% total at once
        const maxTotalRisk = equity * 0.06;
        const riskPerTrade = maxTotalRisk / Math.max(1, numTrades);
        
        // Convert to position size (assuming 2% stop)
        const positionSize = Math.min(riskPerTrade * 50, maxPerTrade);
        
        return {
            perTrade: positionSize,
            totalExposure: positionSize * numTrades,
            riskPerTrade: riskPerTrade,
        };
    }, [settings]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    return {
        settings,
        loading,
        error,
        realtime,
        wsConnected,
        fetchSettings,
        updateSettings,
        enableAutonomous,
        disableAutonomous,
        calculatePositionSize,
        getTradeAllocation,
    };
};
