'use client';
import { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';

// API Base URL - configured via environment variable for production
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function CSVUpload({ onUploadComplete }: { onUploadComplete: () => void }) {
    const { token } = useAuth();
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
    const [count, setCount] = useState(0);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragging(true);
        } else if (e.type === 'dragleave') {
            setIsDragging(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
            setStatus('idle');
        }
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setStatus('idle');
        }
    };

    const uploadFile = async () => {
        if (!file) return;
        setStatus('uploading');

        // Create form data
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await axios.post(`${API_URL}/wallets/upload_csv`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
            });
            setCount(res.data.count);
            setStatus('success');
            setTimeout(() => {
                onUploadComplete();
                setFile(null);
                setStatus('idle');
            }, 2000);
        } catch (e) {
            setStatus('error');
        }
    };

    return (
        <div className="w-full max-w-md mx-auto">
            <AnimatePresence>
                <motion.div
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => document.getElementById('file-upload')?.click()}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`
                relative group cursor-pointer
                border-2 border-dashed rounded-2xl p-8
                flex flex-col items-center justify-center text-center
                transition-all duration-300 ease-out
                ${isDragging
                            ? 'border-[#00ff9d] bg-[#00ff9d]/5 scale-[1.02] shadow-[0_0_30px_rgba(0,255,157,0.2)]'
                            : 'border-gray-800 bg-gray-900/30 hover:border-gray-600 hover:bg-gray-900/50'}
            `}
                >
                    <input
                        id="file-upload"
                        type="file"
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={handleChange}
                    />

                    {status === 'uploading' ? (
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="w-10 h-10 text-[#00ff9d] animate-spin" />
                            <p className="text-gray-400 font-mono text-sm">Parsing blockchain data...</p>
                        </div>
                    ) : status === 'success' ? (
                        <div className="flex flex-col items-center gap-3">
                            <motion.div
                                initial={{ scale: 0 }} animate={{ scale: 1 }}
                                className="w-12 h-12 rounded-full bg-[#00ff9d]/20 flex items-center justify-center"
                            >
                                <CheckCircle className="w-6 h-6 text-[#00ff9d]" />
                            </motion.div>
                            <div>
                                <p className="text-white font-bold">Import Successful</p>
                                <p className="text-[#00ff9d] text-sm font-mono">Added {count} wallets</p>
                            </div>
                        </div>
                    ) : file ? (
                        <div className="flex flex-col items-center gap-4 w-full">
                            <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center">
                                <FileText className="w-6 h-6 text-gray-300" />
                            </div>
                            <div>
                                <p className="text-white font-medium truncate max-w-[200px]">{file.name}</p>
                                <p className="text-gray-500 text-xs text-center mt-1">Ready to import</p>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); uploadFile(); }}
                                className="w-full py-2 bg-[#00ff9d] hover:bg-[#00cc7d] text-black font-bold rounded-lg transition shadow-[0_0_15px_rgba(0,255,157,0.3)] hover:shadow-[0_0_25px_rgba(0,255,157,0.5)]"
                            >
                                Import Wallets
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className={`
                        w-16 h-16 rounded-2xl mb-4 flex items-center justify-center transition-colors
                        ${isDragging ? 'bg-[#00ff9d]/20 text-[#00ff9d]' : 'bg-gray-800 text-gray-400 group-hover:bg-gray-700 group-hover:text-gray-200'}
                    `}>
                                <Upload className="w-8 h-8" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-200 group-hover:text-white transition">
                                Import CSV / List
                            </h3>
                            <p className="text-sm text-gray-500 mt-2 max-w-[200px]">
                                Drag & drop a file here, or click to browse.
                            </p>
                            <p className="text-xs text-gray-600 mt-4 font-mono">
                                Format: Address, Alias (Optional)
                            </p>
                            <a
                                href="data:text/csv;charset=utf-8,0x1234567890abcdef1234567890abcdef12345678,Whale 1%0A0xabcdef1234567890abcdef1234567890abcdef12,Alpha Team"
                                download="wallet_template.csv"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-[#00ff9d] hover:underline mt-2 z-10 relative"
                            >
                                Download Template
                            </a>
                        </>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
