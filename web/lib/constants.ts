const API_PORT = process.env.NEXT_PUBLIC_API_PORT || '8000';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const normalizeUrl = (value: string) => value.replace(/\/+$/, '');
const isLoopbackHost = (value: string) => LOOPBACK_HOSTS.has(value.toLowerCase());

const remapLoopbackToCurrentHost = (value: string) => {
    if (typeof window === 'undefined') return normalizeUrl(value);
    try {
        const parsed = new URL(value);
        const browserHost = window.location.hostname;
        if (!isLoopbackHost(parsed.hostname) || isLoopbackHost(browserHost)) {
            return normalizeUrl(value);
        }
        parsed.hostname = browserHost;
        return normalizeUrl(parsed.toString());
    } catch {
        return normalizeUrl(value);
    }
};

const getRuntimeApiUrl = () => {
    if (typeof window === 'undefined') return null;
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const host = window.location.hostname;
    return `${protocol}://${host}:${API_PORT}`;
};

export const getApiUrl = () => {
    const explicit = process.env.NEXT_PUBLIC_API_URL;
    if (explicit && explicit.trim().length > 0) {
        return remapLoopbackToCurrentHost(explicit.trim());
    }
    const runtime = getRuntimeApiUrl();
    if (runtime) {
        return normalizeUrl(runtime);
    }
    return 'http://localhost:8000';
};

export const API_URL = getApiUrl();

export const getWsUrl = () => {
    const explicit = process.env.NEXT_PUBLIC_WS_URL;
    if (explicit && explicit.trim().length > 0) {
        return remapLoopbackToCurrentHost(explicit.trim());
    }
    const apiBase = getApiUrl();
    return `${apiBase.replace(/^http/i, 'ws')}/ws`;
};
