'use client';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

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
    accentColor: 'emerald' | 'blue' | 'amber' | 'purple';
    panelSizes: Record<string, any>;
}

interface TerminalSettingsContextType {
    settings: TerminalSettings;
    updateTabVisibility: (id: string, enabled: boolean) => void;
    updatePanelVisibility: (id: string, enabled: boolean) => void;
    updateTheme: (theme: TerminalSettings['theme']) => void;
    toggleAutoPilot: () => void;
    resetSettings: () => void;
    updateAccentColor: (color: TerminalSettings['accentColor']) => void;
    updatePanelSizes: (groupId: string, sizes: any) => void;
    saveLayout: (name: string) => void;
    loadLayout: (name: string) => void;
    deleteLayout: (name: string) => void;
    currentLayoutName: string;
    layouts: Record<string, TerminalSettings>;
}

const DEFAULT_TABS: TabConfig[] = [
    { id: 'positions', label: 'Positions', enabled: true },
    { id: 'orders', label: 'Orders', enabled: true },
    { id: 'analysis', label: 'AI Intel', enabled: true },
    { id: 'twap', label: 'TWAP Intel', enabled: true },
    { id: 'ai', label: 'AI Command', enabled: true },
    { id: 'lab', label: 'Lab', enabled: true },
    { id: 'predictions', label: 'Predictions', enabled: true },
    { id: 'cohorts', label: 'Social', enabled: true },
    { id: 'news', label: 'News', enabled: true },
];

const DEFAULT_PANELS: PanelConfig[] = [
    { id: 'chart', label: 'Chart', enabled: true },
    { id: 'orderBook', label: 'Order Book', enabled: true },
    { id: 'orderForm', label: 'Order Form', enabled: true },
    { id: 'console', label: 'Console Hub', enabled: true },
];

const TerminalSettingsContext = createContext<TerminalSettingsContextType | undefined>(undefined);

interface StoredSettings {
    tabs?: Array<Pick<TabConfig, 'id' | 'enabled'>>;
    panels?: Array<Pick<PanelConfig, 'id' | 'enabled'>>;
    theme?: TerminalSettings['theme'];
    autoPilotEnabled?: boolean;
    layouts?: Record<string, TerminalSettings>;
    currentLayoutName?: string;
    panelSizes?: Record<string, any>;
}

const DEFAULT_SETTINGS: TerminalSettings = {
    tabs: DEFAULT_TABS,
    panels: DEFAULT_PANELS,
    theme: 'dark',
    autoPilotEnabled: false,
    accentColor: 'emerald',
    panelSizes: {
        'main-group': [70, 30],
        'top-group': [60, 40],
        'right-group': [50, 50]
    }
};

const ACCENT_COLORS = {
    emerald: { main: '#10b981', glow: 'rgba(16, 185, 129, 0.4)' },
    blue: { main: '#3b82f6', glow: 'rgba(59, 130, 246, 0.4)' },
    amber: { main: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' },
    purple: { main: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.4)' },
};

const mergeWithDefaults = (stored: StoredSettings): TerminalSettings => {
    // console.log("[TerminalSettings] Merging with defaults. Stored panelSizes:", stored.panelSizes);
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        tabs: DEFAULT_TABS.map((defTab: TabConfig) => {
            const savedTab = stored.tabs?.find((t: any) => t.id === defTab.id);
            return savedTab ? { ...defTab, enabled: savedTab.enabled } : defTab;
        }),
        panels: DEFAULT_PANELS.map((defPanel: PanelConfig) => {
            const savedPanel = stored.panels?.find((p: any) => p.id === defPanel.id);
            return savedPanel ? { ...defPanel, enabled: savedPanel.enabled } : defPanel;
        }),
        panelSizes: stored.panelSizes || DEFAULT_SETTINGS.panelSizes
    };
};

const STORAGE_KEY = 'terminal_settings_v4';

export function TerminalSettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<TerminalSettings>(() => {
        if (typeof window === 'undefined') {
            return DEFAULT_SETTINGS;
        }

        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            return DEFAULT_SETTINGS;
        }

        try {
            const parsed = JSON.parse(saved) as StoredSettings;
            return mergeWithDefaults(parsed);
        } catch (e) {
            console.error('Failed to parse terminal settings', e);
            return DEFAULT_SETTINGS;
        }
    });

    // Save to localStorage on change
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('terminal_settings_v3', JSON.stringify(settings));

            // Apply accent color to CSS variables
            const colors = ACCENT_COLORS[settings.accentColor];
            if (colors) {
                document.documentElement.style.setProperty('--color-accent', colors.main);
                document.documentElement.style.setProperty('--color-accent-glow', colors.glow);
            }
        }
    }, [settings]);

    const [layouts, setLayouts] = useState<Record<string, TerminalSettings>>(() => {
        if (typeof window === 'undefined') return {};
        const saved = localStorage.getItem('terminal_layouts');
        if (!saved) return {};
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse terminal layouts', e);
            return {};
        }
    });

    const [currentLayoutName, setCurrentLayoutName] = useState<string>(() => {
        if (typeof window === 'undefined') return 'Default';
        return localStorage.getItem('terminal_current_layout') || 'Default';
    });

    // Save layouts to localStorage
    useEffect(() => {
        localStorage.setItem('terminal_layouts', JSON.stringify(layouts));
    }, [layouts]);

    useEffect(() => {
        localStorage.setItem('terminal_current_layout', currentLayoutName);
    }, [currentLayoutName]);

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
        setSettings(DEFAULT_SETTINGS);
    };

    const updateAccentColor = (accentColor: TerminalSettings['accentColor']) => {
        setSettings(prev => ({ ...prev, accentColor }));
    };

    const layoutUpdateTimer = useRef<NodeJS.Timeout | null>(null);

    const updatePanelSizes = (groupId: string, sizes: any) => {
        if (layoutUpdateTimer.current) clearTimeout(layoutUpdateTimer.current);

        layoutUpdateTimer.current = setTimeout(() => {
            setSettings(prev => ({
                ...prev,
                panelSizes: {
                    ...prev.panelSizes,
                    [groupId]: sizes
                }
            }));
        }, 500); // Debounce to 500ms for stability
    };

    const saveLayout = (name: string) => {
        setLayouts(prev => ({
            ...prev,
            [name]: settings
        }));
        setCurrentLayoutName(name);
    };

    const loadLayout = (name: string) => {
        const layout = layouts[name];
        if (layout) {
            setSettings(layout);
            setCurrentLayoutName(name);
        }
    };

    const deleteLayout = (name: string) => {
        if (name === 'Default') return;
        setLayouts(prev => {
            const next = { ...prev };
            delete next[name];
            return next;
        });
        if (currentLayoutName === name) {
            setCurrentLayoutName('Default');
        }
    };

    return (
        <TerminalSettingsContext.Provider value={{
            settings,
            updateTabVisibility,
            updatePanelVisibility,
            updateTheme,
            toggleAutoPilot,
            resetSettings,
            updateAccentColor,
            updatePanelSizes,
            saveLayout,
            loadLayout,
            deleteLayout,
            currentLayoutName,
            layouts
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
