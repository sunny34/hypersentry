'use client';
import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

interface SidebarContextType {
    isCollapsed: boolean;
    toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    // Optional: Persist state in localStorage
    useEffect(() => {
        const stored = localStorage.getItem('sidebarCollapsed');
        if (stored) setIsCollapsed(stored === 'true');
    }, []);

    const toggle = () => {
        setIsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('sidebarCollapsed', String(newState));
            return newState;
        });
    };

    return (
        <SidebarContext.Provider value={{ isCollapsed, toggle }}>
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const context = useContext(SidebarContext);
    if (context === undefined) {
        throw new Error('useSidebar must be used within a SidebarProvider');
    }
    return context;
}
