'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';

export interface TabConfig {
    id: string;
    label: string;
    enabled: boolean;
    icon?: string;
}

export interface PanelConfig {
    id: string;
    label: string;
    enabled: boolean;
}

interface TerminalSettings {
    tabs: TabConfig[];
    panels: PanelConfig[];
    theme: 'dark' | 'glass' | 'midnight';
    autoPilotEnabled: boolean;
}

interface TerminalSettingsContextType {
    settings: TerminalSettings;
    updateTabVisibility: (id: string, enabled: boolean) => void;
    updatePanelVisibility: (id: string, enabled: boolean) => void;
    updateTheme: (theme: TerminalSettings['theme']) => void;
    toggleAutoPilot: () => void;
    resetSettings: () => void;
}

const DEFAULT_TABS: TabConfig[] = [
    { id: 'positions', label: 'Positions', enabled: true },
    { id: 'orders', label: 'Orders', enabled: true },
    { id: 'analysis', label: 'AI Intel', enabled: true },
    { id: 'twap', label: 'TWAP Intel', enabled: true },
    { id: 'pro', label: 'Pro', enabled: true },
    { id: 'cohorts', label: 'Social', enabled: true },
    { id: 'news', label: 'News', enabled: true },
    { id: 'liquidations', label: 'Firehose', enabled: true },
];

const DEFAULT_PANELS: PanelConfig[] = [
    { id: 'chart', label: 'Chart', enabled: true },
    { id: 'orderBook', label: 'Order Book', enabled: true },
    { id: 'orderForm', label: 'Order Form', enabled: true },
    { id: 'console', label: 'Console Hub', enabled: true },
];

const TerminalSettingsContext = createContext<TerminalSettingsContextType | undefined>(undefined);

export function TerminalSettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<TerminalSettings>({
        tabs: DEFAULT_TABS,
        panels: DEFAULT_PANELS,
        theme: 'dark',
        autoPilotEnabled: false,
    });

    // Load from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('terminal_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // Merge with defaults to handle new tabs/settings added in updates
                setSettings(prev => ({
                    ...prev,
                    ...parsed,
                    tabs: DEFAULT_TABS.map(defTab => {
                        const savedTab = parsed.tabs?.find((t: any) => t.id === defTab.id);
                        return savedTab ? { ...defTab, enabled: savedTab.enabled } : defTab;
                    }),
                    panels: DEFAULT_PANELS.map(defPanel => {
                        const savedPanel = parsed.panels?.find((p: any) => p.id === defPanel.id);
                        return savedPanel ? { ...defPanel, enabled: savedPanel.enabled } : defPanel;
                    }),
                }));
            } catch (e) {
                console.error("Failed to parse terminal settings", e);
            }
        }
    }, []);

    // Save to localStorage on change
    useEffect(() => {
        localStorage.setItem('terminal_settings', JSON.stringify(settings));
    }, [settings]);

    const updateTabVisibility = (id: string, enabled: boolean) => {
        setSettings(prev => ({
            ...prev,
            tabs: prev.tabs.map(t => t.id === id ? { ...t, enabled } : t)
        }));
    };

    const updatePanelVisibility = (id: string, enabled: boolean) => {
        setSettings(prev => ({
            ...prev,
            panels: prev.panels.map(p => p.id === id ? { ...p, enabled } : p)
        }));
    };

    const updateTheme = (theme: TerminalSettings['theme']) => {
        setSettings(prev => ({ ...prev, theme }));
    };

    const toggleAutoPilot = () => {
        setSettings(prev => ({ ...prev, autoPilotEnabled: !prev.autoPilotEnabled }));
    };

    const resetSettings = () => {
        setSettings({
            tabs: DEFAULT_TABS,
            panels: DEFAULT_PANELS,
            theme: 'dark',
            autoPilotEnabled: false,
        });
    };

    return (
        <TerminalSettingsContext.Provider value={{
            settings,
            updateTabVisibility,
            updatePanelVisibility,
            updateTheme,
            toggleAutoPilot,
            resetSettings
        }}>
            {children}
        </TerminalSettingsContext.Provider>
    );
}

export function useTerminalSettings() {
    const context = useContext(TerminalSettingsContext);
    if (!context) {
        throw new Error('useTerminalSettings must be used within a TerminalSettingsProvider');
    }
    return context;
}
