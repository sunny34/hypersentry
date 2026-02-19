"use client";
import React, { useState, useEffect } from 'react';
import { useTradingSettings } from '@/hooks/useTradingSettings';
import { useModeStore } from '@/store/useModeStore';
import { AlertTriangle, Wallet, Activity, TrendingUp, Shield, Power } from 'lucide-react';

interface TradingSettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const TradingSettingsPanel: React.FC<TradingSettingsPanelProps> = ({ isOpen, onClose }) => {
    const { mode, setMode } = useModeStore();
    const { settings, loading, realtime, wsConnected, updateSettings, calculatePositionSize, getTradeAllocation } = useTradingSettings();
    const [formData, setFormData] = useState(settings);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setFormData(settings);
    }, [settings]);

    const handleChange = (field: string, value: number | boolean) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        await updateSettings(formData);
        setSaving(false);
        onClose();
    };

    const handleToggleAutonomous = () => {
        if (mode === 'autonomous') {
            setMode('manual');
        } else {
            setMode('autonomous');
        }
        onClose();
    };

    // Calculate allocation preview
    const allocationPreview = getTradeAllocation(3); // Assume 3 active trades
    const positionPreview = calculatePositionSize(80); // 80% confidence

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="bg-gray-950 border border-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/50">
                    <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-blue-400" />
                        <h2 className="text-lg font-bold text-white">Trading Configuration</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>

                <div className="p-4 space-y-6">
                    {/* Account Balance - Live from Hyperliquid */}
                    <div className="bg-gradient-to-r from-green-950/30 to-blue-950/30 border border-green-500/20 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Wallet className="w-4 h-4 text-green-400" />
                                <span className="text-sm font-semibold text-green-400">Account Balance</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {realtime && wsConnected && (
                                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        Live
                                    </span>
                                )}
                                <span className="text-xs text-gray-500">Hyperliquid</span>
                            </div>
                        </div>
                        <div className="text-3xl font-black text-white">
                            ${(settings.account_balance || settings.equity_usd).toLocaleString()}
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                            Available: ${(settings.available_balance || settings.equity_usd).toLocaleString()}
                        </div>
                    </div>

                    {/* Position Sizing */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                            <Activity className="w-4 h-4" /> Position Sizing
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Max Position Size ($)</label>
                                <input
                                    type="number"
                                    value={formData.max_position_usd}
                                    onChange={e => handleChange('max_position_usd', Number(e.target.value))}
                                    className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Risk Per Trade (%)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={formData.max_risk_pct * 100}
                                    onChange={e => handleChange('max_risk_pct', Number(e.target.value) / 100)}
                                    className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Allocation Preview */}
                    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="w-4 h-4 text-blue-400" />
                            <span className="text-sm font-semibold text-gray-300">Intelligent Allocation Preview</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <div className="text-xl font-bold text-white">${allocationPreview.perTrade.toFixed(0)}</div>
                                <div className="text-xs text-gray-500">Per Trade (3 active)</div>
                            </div>
                            <div>
                                <div className="text-xl font-bold text-white">${allocationPreview.totalExposure.toFixed(0)}</div>
                                <div className="text-xs text-gray-500">Total Exposure</div>
                            </div>
                            <div>
                                <div className="text-xl font-bold text-green-400">${positionPreview.toFixed(0)}</div>
                                <div className="text-xs text-gray-500">80% Conf. Size</div>
                            </div>
                        </div>
                    </div>

                    {/* Target Levels */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Risk Parameters</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Take Profit (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={formData.target_profit_pct * 100}
                                    onChange={e => handleChange('target_profit_pct', Number(e.target.value) / 100)}
                                    className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Stop Loss (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={formData.stop_loss_pct * 100}
                                    onChange={e => handleChange('stop_loss_pct', Number(e.target.value) / 100)}
                                    className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Max Daily Trades</label>
                                <input
                                    type="number"
                                    value={formData.max_daily_trades}
                                    onChange={e => handleChange('max_daily_trades', Number(e.target.value))}
                                    className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Max Daily Loss (%)</label>
                                <input
                                    type="number"
                                    step="1"
                                    value={formData.max_daily_loss_pct * 100}
                                    onChange={e => handleChange('max_daily_loss_pct', Number(e.target.value) / 100)}
                                    className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Autonomous Mode Toggle */}
                    <div className="border border-gray-800 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${mode === 'autonomous' ? 'bg-red-500/20' : 'bg-gray-800'}`}>
                                    <Power className={`w-5 h-5 ${mode === 'autonomous' ? 'text-red-400' : 'text-gray-400'}`} />
                                </div>
                                <div>
                                    <div className="text-sm font-semibold text-white">
                                        {mode === 'autonomous' ? 'Autonomous Mode ACTIVE' : 'Autonomous Mode'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {mode === 'autonomous' 
                                            ? 'AI is executing trades automatically' 
                                            : 'Enable to auto-trade based on signals'}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={handleToggleAutonomous}
                                className={`px-6 py-3 rounded-lg font-bold text-sm transition-all ${
                                    mode === 'autonomous' 
                                        ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30' 
                                        : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/30'
                                }`}
                            >
                                {mode === 'autonomous' ? 'DISABLE' : 'ENABLE'}
                            </button>
                        </div>
                        
                        {mode === 'autonomous' && (
                            <div className="mt-4 pt-4 border-t border-gray-800 flex items-center gap-2 text-xs text-yellow-500">
                                <AlertTriangle className="w-4 h-4" />
                                <span>Autonomous mode is active. All trades will execute automatically.</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-4 border-t border-gray-800">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 border border-gray-700 text-gray-400 hover:bg-gray-900 rounded text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TradingSettingsPanel;
