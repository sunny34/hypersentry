/**
 * Formats numbers into compact notation (e.g., 1.2M, 500K)
 * Standardizing on 2 decimal places for Millions and Billions for precision.
 */
export const formatCompact = (num: number | string | undefined | null): string => {
    if (num === undefined || num === null) return '0.00';
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return '0.00';

    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';

    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';

    return sign + abs.toFixed(n < 1 && n !== 0 ? 4 : 2);
};

/**
 * Parses shorthand notation (e.g., '10k', '1.5M', '50%', 'max') into a raw number.
 * @param input The raw string input from the user
 * @param contextValue Optional reference value for context-aware parsing (e.g., max balance)
 */
export const parseSmartInput = (input: string | number, contextValue?: number): number => {
    if (typeof input === 'number') return input;
    if (!input) return 0;

    const trimmed = input.trim().toLowerCase();

    // Handle 'max'
    if (trimmed === 'max') return contextValue || 0;

    // Handle percentage
    if (trimmed.endsWith('%')) {
        const percent = parseFloat(trimmed.replace('%', ''));
        if (isNaN(percent)) return 0;
        return (contextValue || 0) * (percent / 100);
    }

    const match = trimmed.match(/^([-+]?\d*\.?\d+)\s*([kmbt]?)$/);

    if (!match) {
        const parsed = parseFloat(trimmed);
        return isNaN(parsed) ? 0 : parsed;
    }

    const val = parseFloat(match[1]);
    const suffix = match[2];

    switch (suffix) {
        case 'k': return val * 1e3;
        case 'm': return val * 1e6;
        case 'b': return val * 1e9;
        case 't': return val * 1e12;
        default: return val;
    }
};

/**
 * Parses shorthand notation (e.g., '10k', '1.5M') into a raw number.
 */
export const parseCompact = (input: string | number): number => {
    return parseSmartInput(input);
};

/**
 * Formats a number to a fixed precision string
 */
export const formatFixed = (num: number | string, precision: number = 2): string => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return '0.00';
    return n.toFixed(precision);
};
