import {
    LayoutDashboard,
    Activity,
    Wallet,
    Settings,
    LogOut,
    ChevronLeft,
    ChevronRight,
    Terminal,
    Menu,
    X,
    MessageSquare,
    Globe,
    Zap,
    Upload,
    Plus,
    User as UserIcon,
    BarChart3,
    Fish,
} from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useHyperliquidSession } from '@/hooks/useHyperliquidSession';
import { useState } from 'react';
import axios from 'axios';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from '@/contexts/SidebarContext';

interface SidebarProps {
    view?: string;
    setView?: (view: string) => void;
    onImport?: () => void;
    onAdd?: () => void;
    currentView?: string;
    onViewChange?: (view: string) => void;
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
}

export default function Sidebar({ view, setView, onImport, onAdd, currentView, onViewChange, isMobileOpen = false, onMobileClose }: SidebarProps) {
    const { user, isAuthenticated, logout, isLoading, token } = useAuth();
    const { isCollapsed, toggle } = useSidebar();
    const { isAgentActive } = useHyperliquidSession();
    const [showTelegram, setShowTelegram] = useState(false);
    const [chatId, setChatId] = useState('');
    const router = useRouter();
    const pathname = usePathname();

    // Helper function to determine view from path
    const getPathView = (path: string) => {
        if (path === '/') return 'dashboard';
        if (path.includes('/terminal')) return 'terminal';
        if (path.includes('/alpha')) return 'cockpit';
        if (path.includes('/arb')) return 'arb';
        return 'dashboard';
    };

    // Support both patterns
    const activeView = currentView || view || getPathView(pathname);
    const handleViewChange = (newView: string) => {
        if (onMobileClose) onMobileClose(); // Close on navigation (mobile)

        if (newView === 'terminal') {
            router.push('/terminal');
        } else if (newView === 'cockpit') {
            router.push('/alpha');
        } else if (newView === 'strategies') {
            router.push('/terminal?tab=lab');
        } else if (newView === 'arb') {
            router.push('/arb');
        } else if (newView === 'risk') {
            router.push('/risk');
        } else if (newView === 'whales') {
            router.push('/whales');
        } else if (newView === 'settings') {
            router.push('/settings');
        } else if (pathname === '/terminal' || pathname === '/arb' || pathname === '/risk' || pathname === '/alpha') {
            router.push('/');
        } else {
            setView?.(newView);
            onViewChange?.(newView);
        }
    };

    const saveTelegram = async (e: any) => {
        // ... existing implementation
        e.preventDefault();
        try {
            await axios.post(
                `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/auth/profile/update`,
                { telegram_chat_id: chatId },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setShowTelegram(false);
            window.location.reload();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <>
            {/* Mobile Backdrop */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-black/80 z-40 lg:hidden backdrop-blur-sm"
                    onClick={onMobileClose}
                />
            )}

            {/* Sidebar Container */}
            <div className={`
                fixed inset-y-0 left-0 z-50 bg-[var(--background)]/95 backdrop-blur-xl border-r border-[var(--glass-border)] flex flex-col transition-transform duration-300 ease-in-out
                ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}
                w-64 
                ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            `}>
                {/* Brand */}
                <div className={`p-6 border-b border-[var(--glass-border)] flex items-center justify-between transition-all shrink-0`}>
                    <div className={`flex items-center gap-3 ${isCollapsed ? 'lg:justify-center lg:w-full' : ''}`}>
                        <div className="w-8 h-8 bg-[var(--color-primary)] rounded-full flex items-center justify-center shrink-0">
                            <Zap className="text-black w-5 h-5" />
                        </div>
                        {(!isCollapsed || isMobileOpen) && <h1 className="text-lg font-bold tracking-tight whitespace-nowrap block lg:group-hover:block text-[var(--foreground)]">
                            Hyperliquid <span className="text-[var(--color-primary)]">Sentry</span>
                        </h1>}
                    </div>

                    {/* Desktop Collapse Toggle */}
                    {!isCollapsed && (
                        <button onClick={toggle} className="p-1 hover:bg-white/5 rounded-lg text-gray-400 transition hidden lg:block">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                    )}

                    {/* Mobile Close Button */}
                    <button onClick={onMobileClose} className="p-1 hover:bg-white/5 rounded-lg text-gray-400 transition lg:hidden">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Collapsed Toggle (Centered) - Desktop Only */}
                {isCollapsed && (
                    <div className="w-full justify-center py-2 border-b border-[var(--glass-border)]/50 hidden lg:flex">
                        <button onClick={toggle} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 transition">
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {/* Navigation */}
                <div className="flex-1 p-4 space-y-2 overflow-y-auto overflow-x-hidden">
                    {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase px-4 mb-2">Menu</p>}

                    <button
                        onClick={() => handleViewChange('dashboard')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'dashboard' ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Dashboard" : ""}
                    >
                        <LayoutDashboard className="w-5 h-5 shrink-0" />
                        {!isCollapsed && <span className="font-medium whitespace-nowrap">Dashboard</span>}
                    </button>

                    <button
                        onClick={() => handleViewChange('terminal')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'terminal' ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Trading Terminal" : ""}
                    >
                        <div className="relative">
                            <BarChart3 className="w-5 h-5 shrink-0" />
                            {isAgentActive && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full border border-[var(--background)] shadow-[0_0_5px_rgba(52,211,153,0.5)]" />
                            )}
                        </div>
                        {!isCollapsed && <span className="font-medium whitespace-nowrap">Trading Terminal</span>}
                    </button>

                    <button
                        onClick={() => handleViewChange('strategies')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'strategies' ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Strategies" : ""}
                    >
                        <Activity className="w-5 h-5 shrink-0" />
                        {!isCollapsed && <span className="font-medium whitespace-nowrap">Strategies</span>}
                    </button>

                    {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase px-4 mt-6 mb-2">Pro Suite</p>}

                    <button
                        onClick={() => handleViewChange('cockpit')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'cockpit' || pathname === '/alpha' ? 'bg-blue-500/10 text-blue-400' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Decision Cockpit" : ""}
                    >
                        <Terminal className="w-5 h-5 shrink-0" />
                        {!isCollapsed && (
                            <div className="flex items-center justify-between flex-1">
                                <span className="font-medium whitespace-nowrap">Decision Cockpit</span>
                                <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded font-black tracking-widest">PRO</span>
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => handleViewChange('arb')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'arb' ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Arb Scanner" : ""}
                    >
                        <Globe className="w-5 h-5 shrink-0" />
                        {!isCollapsed && (
                            <div className="flex items-center justify-between flex-1">
                                <span className="font-medium whitespace-nowrap">Arb Scanner</span>
                                <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 rounded font-black tracking-widest">PRO</span>
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => handleViewChange('risk')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'risk' ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Risk Simulator" : ""}
                    >
                        <Zap className="w-5 h-5 shrink-0" />
                        {!isCollapsed && (
                            <div className="flex items-center justify-between flex-1">
                                <span className="font-medium whitespace-nowrap">Risk Simulator</span>
                                <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 rounded font-black tracking-widest">PRO</span>
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => handleViewChange('whales')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'whales' || pathname === '/whales' ? 'bg-cyan-500/10 text-cyan-400' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Whale Tracker" : ""}
                    >
                        <Fish className="w-5 h-5 shrink-0" />
                        {!isCollapsed && (
                            <div className="flex items-center justify-between flex-1">
                                <span className="font-medium whitespace-nowrap">Whale Tracker</span>
                                <span className="text-[8px] bg-cyan-500/20 text-cyan-400 px-1 rounded font-black tracking-widest animate-pulse">NEW</span>
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => handleViewChange('settings')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'settings' ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                        title={isCollapsed ? "Settings" : ""}
                    >
                        <Settings className="w-5 h-5 shrink-0" />
                        {!isCollapsed && <span className="font-medium whitespace-nowrap">Settings</span>}
                    </button>

                    {/* Actions Grid - Only show when authenticated */}
                    {isAuthenticated && (
                        <>
                            {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase px-4 mt-8 mb-2">Actions</p>}
                            {isCollapsed && <div className="h-8" />} {/* Spacer */}
                            <div className={`grid ${isCollapsed ? 'grid-cols-1 gap-4' : 'grid-cols-2 gap-2'} px-1`}>
                                <button
                                    onClick={onImport}
                                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-[var(--background)] border border-[var(--glass-border)] hover:border-[var(--color-primary)]/30 hover:bg-white/5 transition text-gray-300 ${isCollapsed ? 'aspect-square' : ''}`}
                                    title="Import"
                                >
                                    <Upload className="w-5 h-5 text-[var(--color-primary)] shrink-0" />
                                    {!isCollapsed && <span className="text-xs font-bold">Import</span>}
                                </button>
                                <button
                                    onClick={onAdd}
                                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-[var(--background)] border border-[var(--glass-border)] hover:border-[var(--color-primary)]/30 hover:bg-white/5 transition text-gray-300 ${isCollapsed ? 'aspect-square' : ''}`}
                                    title="Add Wallet"
                                >
                                    <Plus className="w-5 h-5 text-[var(--color-primary)] shrink-0" />
                                    {!isCollapsed && <span className="text-xs font-bold">Add Wallet</span>}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* User Info - Only when logged in */}
                {isAuthenticated && user && (
                    <div className="p-4 border-t border-[var(--glass-border)]">
                        <div className={`bg-[var(--background)] border border-[var(--glass-border)] rounded-2xl p-4 ${isCollapsed ? 'flex justify-center' : ''}`}>
                            <div className={`flex items-center gap-3 ${!isCollapsed ? 'mb-3' : ''}`}>
                                {user.avatar_url ? (
                                    <Image
                                        src={user.avatar_url}
                                        alt={user.name}
                                        width={40}
                                        height={40}
                                        unoptimized
                                        className="w-10 h-10 rounded-full border-2 border-[var(--color-primary)]"
                                    />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center shrink-0">
                                        <UserIcon className="w-5 h-5 text-[var(--color-primary)]" />
                                    </div>
                                )}
                                {!isCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-[var(--foreground)] truncate">{user.name}</p>
                                        <p className="text-xs text-gray-500 truncate cursor-pointer hover:text-[var(--color-primary)]" onClick={() => {
                                            setChatId(user.telegram_chat_id || '');
                                            setShowTelegram(true);
                                        }}>
                                            {user.telegram_chat_id ? '📱 Connected' : '🔗 Connect Telegram'}
                                        </p>
                                    </div>
                                )}
                            </div>
                            {!isCollapsed && (
                                <button
                                    onClick={logout}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-white/5 hover:bg-white/10 border border-[var(--glass-border)] text-gray-300 rounded-lg font-medium text-sm transition"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Sign Out
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Telegram Modal */}
                {showTelegram && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={() => setShowTelegram(false)}>
                        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-3xl p-8 w-full max-w-sm relative animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
                            <h3 className="text-xl font-bold mb-4 text-white">Connect Telegram</h3>
                            <p className="text-sm text-gray-400 mb-6">
                                1. Start a chat with <a href="https://t.me/getmyid_bot" target="_blank" className="text-blue-400 hover:underline">@getmyid_bot</a><br />
                                2. Copy your &quot;Current Chat ID&quot;<br />
                                3. Paste it below
                            </p>
                            <form onSubmit={saveTelegram} className="space-y-4">
                                <input
                                    value={chatId}
                                    onChange={e => setChatId(e.target.value)}
                                    placeholder="e.g. 123456789"
                                    className="w-full bg-black/50 border border-gray-700 rounded-xl p-3 text-white focus:border-green-500 outline-none"
                                />
                                <button type="submit" className="w-full py-3 bg-green-600 hover:bg-green-500 text-black font-bold rounded-xl transition">
                                    Save Chat ID
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
