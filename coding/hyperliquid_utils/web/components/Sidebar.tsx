'use client';
import { Activity, Shield, Zap, Upload, Plus, LayoutDashboard, Settings, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Sidebar({ view, setView, onImport, onAdd }: any) {
    return (
        <div className="w-64 border-r border-gray-800 h-screen fixed left-0 top-0 bg-black/95 backdrop-blur-xl flex flex-col z-50">
            {/* Brand */}
            <div className="p-6 border-b border-gray-800 flex items-center gap-3">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center animate-pulse">
                    <Zap className="text-black w-5 h-5" />
                </div>
                <h1 className="text-lg font-bold tracking-tight">Hyperliquid <span className="text-green-500">Hunter</span></h1>
            </div>

            {/* Navigation */}
            <div className="flex-1 p-4 space-y-2 overflow-y-auto">
                <p className="text-xs font-bold text-gray-500 uppercase px-4 mb-2">Menu</p>

                <button
                    onClick={() => setView('dashboard')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${view === 'dashboard' ? 'bg-[#00ff9d]/10 text-[#00ff9d]' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
                >
                    <LayoutDashboard className="w-5 h-5" />
                    <span className="font-medium">Dashboard</span>
                </button>

                <button
                    onClick={() => setView('twap')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${view === 'twap' ? 'bg-[#00ff9d]/10 text-[#00ff9d]' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
                >
                    <Activity className="w-5 h-5" />
                    <span className="font-medium">Whale Monitor</span>
                </button>

                <button
                    onClick={() => setView('security')}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-900 hover:text-white transition"
                >
                    <Shield className="w-5 h-5" />
                    <span className="font-medium">Security</span>
                </button>

                <button
                    onClick={() => setView('settings')}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-900 hover:text-white transition"
                >
                    <Settings className="w-5 h-5" />
                    <span className="font-medium">Settings</span>
                </button>

                {/* Actions Grid */}
                <p className="text-xs font-bold text-gray-500 uppercase px-4 mt-8 mb-2">Actions</p>
                <div className="grid grid-cols-2 gap-2 px-1">
                    <button
                        onClick={onImport}
                        className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition text-gray-300"
                    >
                        <Upload className="w-5 h-5 text-blue-400" />
                        <span className="text-xs font-bold">Import</span>
                    </button>
                    <button
                        onClick={onAdd}
                        className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition text-gray-300"
                    >
                        <Plus className="w-5 h-5 text-[#00ff9d]" />
                        <span className="text-xs font-bold">Add Wallet</span>
                    </button>
                </div>
            </div>

            {/* User / Social Login */}
            <div className="p-4 border-t border-gray-800">
                <div className="bg-gray-900 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-3 text-center">Connect Account</p>
                    <div className="space-y-2">
                        <button className="w-full flex items-center justify-center gap-2 py-2 bg-white text-black rounded-lg font-bold text-sm hover:bg-gray-200 transition">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                            Google
                        </button>
                        <button className="w-full flex items-center justify-center gap-2 py-2 bg-black border border-gray-700 text-white rounded-lg font-bold text-sm hover:bg-gray-800 transition">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zl-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                            X (Twitter)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
