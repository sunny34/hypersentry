import { Activity, Zap, Upload, Plus, LayoutDashboard, LogOut, User as UserIcon, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
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
}

export default function Sidebar({ view, setView, onImport, onAdd, currentView, onViewChange }: SidebarProps) {
    const { user, isAuthenticated, logout, isLoading, token } = useAuth();
    const { isCollapsed, toggle } = useSidebar();
    const [showTelegram, setShowTelegram] = useState(false);
    const [chatId, setChatId] = useState('');
    const router = useRouter();
    const pathname = usePathname();

    // Support both patterns
    const activeView = currentView || view || (pathname === '/terminal' ? 'terminal' : 'dashboard');
    const handleViewChange = (newView: string) => {
        if (newView === 'terminal') {
            router.push('/terminal');
        } else if (pathname === '/terminal') {
            router.push('/');
        } else {
            setView?.(newView);
            onViewChange?.(newView);
        }
    };

    const saveTelegram = async (e: any) => {
        e.preventDefault();
        try {
            await axios.post(
                `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/auth/profile/update`,
                { telegram_chat_id: chatId },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setShowTelegram(false);
            window.location.reload(); // Reload to refresh user context
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className={`${isCollapsed ? 'w-20' : 'w-64'} border-r border-gray-800 h-screen fixed left-0 top-0 bg-black/95 backdrop-blur-xl flex flex-col z-50 transition-all duration-300`}>
            {/* Brand */}
            <div className={`p-6 border-b border-gray-800 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} transition-all`}>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center animate-pulse shrink-0">
                        <Zap className="text-black w-5 h-5" />
                    </div>
                    {!isCollapsed && <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">Hyperliquid <span className="text-green-500">Sentry</span></h1>}
                </div>
                {!isCollapsed && (
                    <button onClick={toggle} className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 transition">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Collapsed Toggle (Centered) */}
            {isCollapsed && (
                <div className="w-full flex justify-center py-2 border-b border-gray-800/50">
                    <button onClick={toggle} className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 transition">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Navigation */}
            <div className="flex-1 p-4 space-y-2 overflow-y-auto overflow-x-hidden">
                {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase px-4 mb-2">Menu</p>}

                <button
                    onClick={() => handleViewChange('dashboard')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'dashboard' ? 'bg-[#00ff9d]/10 text-[#00ff9d]' : 'text-gray-400 hover:bg-gray-900 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Dashboard" : ""}
                >
                    <LayoutDashboard className="w-5 h-5 shrink-0" />
                    {!isCollapsed && <span className="font-medium whitespace-nowrap">Dashboard</span>}
                </button>

                <button
                    onClick={() => handleViewChange('terminal')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'terminal' ? 'bg-[#00ff9d]/10 text-[#00ff9d]' : 'text-gray-400 hover:bg-gray-900 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Trading Terminal" : ""}
                >
                    <BarChart3 className="w-5 h-5 shrink-0" />
                    {!isCollapsed && <span className="font-medium whitespace-nowrap">Trading Terminal</span>}
                </button>

                <button
                    onClick={() => handleViewChange('twap')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeView === 'twap' ? 'bg-[#00ff9d]/10 text-[#00ff9d]' : 'text-gray-400 hover:bg-gray-900 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Whale Monitor" : ""}
                >
                    <Activity className="w-5 h-5 shrink-0" />
                    {!isCollapsed && <span className="font-medium whitespace-nowrap">Whale Monitor</span>}
                </button>

                {/* Actions Grid - Only show when authenticated */}
                {isAuthenticated && (
                    <>
                        {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase px-4 mt-8 mb-2">Actions</p>}
                        {isCollapsed && <div className="h-8" />} {/* Spacer */}
                        <div className={`grid ${isCollapsed ? 'grid-cols-1 gap-4' : 'grid-cols-2 gap-2'} px-1`}>
                            <button
                                onClick={onImport}
                                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition text-gray-300 ${isCollapsed ? 'aspect-square' : ''}`}
                                title="Import"
                            >
                                <Upload className="w-5 h-5 text-blue-400 shrink-0" />
                                {!isCollapsed && <span className="text-xs font-bold">Import</span>}
                            </button>
                            <button
                                onClick={onAdd}
                                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition text-gray-300 ${isCollapsed ? 'aspect-square' : ''}`}
                                title="Add Wallet"
                            >
                                <Plus className="w-5 h-5 text-[#00ff9d] shrink-0" />
                                {!isCollapsed && <span className="text-xs font-bold">Add Wallet</span>}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* User Info - Only when logged in */}
            {isAuthenticated && user && (
                <div className="p-4 border-t border-gray-800">
                    <div className={`bg-gray-900 rounded-2xl p-4 ${isCollapsed ? 'flex justify-center' : ''}`}>
                        <div className={`flex items-center gap-3 ${!isCollapsed ? 'mb-3' : ''}`}>
                            {user.avatar_url ? (
                                <img
                                    src={user.avatar_url}
                                    alt={user.name}
                                    className="w-10 h-10 rounded-full border-2 border-green-500"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                                    <UserIcon className="w-5 h-5 text-green-400" />
                                </div>
                            )}
                            {!isCollapsed && (
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-white truncate">{user.name}</p>
                                    <p className="text-xs text-gray-500 truncate cursor-pointer hover:text-blue-400" onClick={() => {
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
                                className="w-full flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium text-sm transition"
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
                            2. Copy your "Current Chat ID"<br />
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
    );
}
