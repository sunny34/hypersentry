export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const getWsUrl = () => {
    if (typeof window === 'undefined') return '/ws';
    const wsBase = API_URL.replace(/^http/, 'ws');
    return `${wsBase}/ws`;
};
