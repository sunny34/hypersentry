'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'neon' | 'midnight' | 'stealth' | 'matrix';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window === 'undefined') return 'neon';
        const savedTheme = localStorage.getItem('app-theme') as Theme | null;
        if (savedTheme && ['neon', 'midnight', 'stealth', 'matrix'].includes(savedTheme)) {
            return savedTheme;
        }
        return 'neon';
    });

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem('app-theme', newTheme);
    };

    // Apply theme class to body/html
    useEffect(() => {
        const root = document.documentElement;
        // Remove all theme classes
        root.classList.remove('theme-neon', 'theme-midnight', 'theme-stealth', 'theme-matrix');
        // Add new theme class
        root.classList.add(`theme-${theme}`);
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
