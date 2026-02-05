export class Indicators {
    // Simple Moving Average
    static calculateSMA(data: { value: number }[], period: number) {
        if (data.length < period) return [];
        const sma = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].value;
            }
            sma.push({ time: (data[i] as any).time, value: sum / period });
        }
        return sma;
    }

    // Exponential Moving Average
    static calculateEMA(data: { time: number, close: number }[], period: number) {
        if (data.length === 0) return [];
        const ema = [];
        const k = 2 / (period + 1);

        // Initialize with SMA
        let sum = 0;
        const initialSlice = data.slice(0, Math.min(period, data.length));
        initialSlice.forEach(d => sum += d.close);
        let prevEMA = sum / initialSlice.length;

        if (data.length >= period) {
            ema.push({ time: data[period - 1].time, value: prevEMA });
        }

        for (let i = period; i < data.length; i++) {
            const currentEMA = data[i].close * k + prevEMA * (1 - k);
            ema.push({ time: data[i].time, value: currentEMA });
            prevEMA = currentEMA;
        }
        return ema;
    }

    // True Range
    static calculateTR(current: any, prev: any) {
        const hl = current.high - current.low;
        const hc = Math.abs(current.high - prev.close);
        const lc = Math.abs(current.low - prev.close);
        return Math.max(hl, hc, lc);
    }

    // Average True Range
    static calculateATR(data: any[], period: number) {
        if (data.length <= period) return [];
        const trs = [0]; // First TR is 0 or high-low, but consistent with most libs
        for (let i = 1; i < data.length; i++) {
            trs.push(this.calculateTR(data[i], data[i - 1]));
        }

        const atr = [];
        // Initial ATR is SMA of TR
        let sum = 0;
        for (let i = 1; i <= period; i++) sum += trs[i];
        let prevATR = sum / period;
        atr.push({ time: data[period].time, value: prevATR });

        for (let i = period + 1; i < data.length; i++) {
            // Wilder's Smoothing
            const currentATR = (prevATR * (period - 1) + trs[i]) / period;
            atr.push({ time: data[i].time, value: currentATR });
            prevATR = currentATR;
        }
        return atr;
    }

    // Supertrend
    // Returns { time, value, direction: 1 (long) | -1 (short) }
    static calculateSupertrend(data: any[], period: number = 10, multiplier: number = 3) {
        if (data.length <= period) return [];

        const atrData = this.calculateATR(data, period);
        // Map ATR back to corresponding data indices
        // ATR starts at index 'period'

        const supertrend = [];
        let prevFinalUpper = 0;
        let prevFinalLower = 0;
        let prevTrend = 1; // 1: Bullish, -1: Bearish

        // We can only start calculating supertrend where we have ATR
        // ATR array index 0 corresponds to data index 'period'

        for (let i = 0; i < atrData.length; i++) {
            const currentIdx = period + i;
            const current = data[currentIdx];
            const prev = data[currentIdx - 1];
            const atr = atrData[i].value;

            const basicUpper = (current.high + current.low) / 2 + multiplier * atr;
            const basicLower = (current.high + current.low) / 2 - multiplier * atr;

            let finalUpper = basicUpper;
            let finalLower = basicLower;

            // Logic from standard supertrend calc
            if (i > 0) {
                if (basicUpper < prevFinalUpper || prev.close > prevFinalUpper) {
                    finalUpper = basicUpper;
                } else {
                    finalUpper = prevFinalUpper;
                }

                if (basicLower > prevFinalLower || prev.close < prevFinalLower) {
                    finalLower = basicLower;
                } else {
                    finalLower = prevFinalLower;
                }
            }

            let trend = prevTrend;
            if (prevTrend === 1) { // Up
                if (current.close < prevFinalLower) {
                    trend = -1;
                }
            } else { // Down
                if (current.close > prevFinalUpper) {
                    trend = 1;
                }
            }

            supertrend.push({
                time: current.time,
                value: trend === 1 ? finalLower : finalUpper,
                direction: trend,
                color: trend === 1 ? '#10b981' : '#ef4444'
            });

            prevFinalUpper = finalUpper;
            prevFinalLower = finalLower;
            prevTrend = trend;
        }

        return supertrend;
    }

    // Elliot Wave Scanner (ZigZag)
    // Identifies potential pivots
    static calculateZigZag(data: any[], deviation: number = 5) {
        // Deviation percent
        const zigzag = [];
        let trend = 0; // 1 up, -1 down
        let lastPivotPrice = data[0].close;
        let lastPivotIndex = 0;

        // Add first point
        zigzag.push({ time: data[0].time, value: data[0].close, type: 'start' });

        for (let i = 1; i < data.length; i++) {
            const current = data[i];
            const change = ((current.close - lastPivotPrice) / lastPivotPrice) * 100;

            if (trend === 0) {
                if (Math.abs(change) >= deviation) {
                    trend = change > 0 ? 1 : -1;
                    lastPivotPrice = current.close;
                    lastPivotIndex = i;
                    zigzag.push({ time: current.time, value: current.close, type: trend === 1 ? 'high' : 'low' });
                }
            } else if (trend === 1) { // Uptrend
                if (current.close > lastPivotPrice) {
                    // New High
                    lastPivotPrice = current.close;
                    lastPivotIndex = i;
                    // Update last zig point
                    zigzag[zigzag.length - 1] = { time: current.time, value: current.close, type: 'high' };
                } else if (change <= -deviation) {
                    // Reversal
                    trend = -1;
                    lastPivotPrice = current.close;
                    lastPivotIndex = i;
                    zigzag.push({ time: current.time, value: current.close, type: 'low' });
                }
            } else { // Downtrend
                if (current.close < lastPivotPrice) {
                    // New Low
                    lastPivotPrice = current.close;
                    lastPivotIndex = i;
                    // Update last zig point
                    zigzag[zigzag.length - 1] = { time: current.time, value: current.close, type: 'low' };
                } else if (change >= deviation) {
                    // Reversal
                    trend = 1;
                    lastPivotPrice = current.close;
                    lastPivotIndex = i;
                    zigzag.push({ time: current.time, value: current.close, type: 'high' });
                }
            }
        }
        return zigzag;
    }

    // Bollinger Bands
    static calculateBollingerBands(data: any[], period: number = 20, multiplier: number = 2) {
        if (data.length < period) return [];
        const bb = [];

        for (let i = period - 1; i < data.length; i++) {
            const slice = data.slice(i - period + 1, i + 1);
            let sum = 0;
            slice.forEach(d => sum += d.close);
            const sma = sum / period;

            let sumSqDiff = 0;
            slice.forEach(d => sumSqDiff += Math.pow(d.close - sma, 2));
            const stdDev = Math.sqrt(sumSqDiff / period);

            bb.push({
                time: data[i].time,
                upper: sma + multiplier * stdDev,
                middle: sma,
                lower: sma - multiplier * stdDev
            });
        }
        return bb;
    }

    // Volume Weighted Average Price (VWAP)
    // NOTE: Intraday VWAP usually resets daily. Here we calculate rolling for simplicity or based on dataset.
    static calculateVWAP(data: any[]) {
        const vwap = [];
        let cumVolume = 0;
        let cumPV = 0;

        for (const candle of data) {
            const typicalPrice = (candle.high + candle.low + candle.close) / 3;
            const volume = candle.volume || 0;

            // If we wanted to reset daily, we'd check if day changed here.
            // For now, simple cumulative over loaded data.

            cumVolume += volume;
            cumPV += typicalPrice * volume;

            if (cumVolume > 0) {
                vwap.push({ time: candle.time, value: cumPV / cumVolume });
            }
        }
        return vwap;
    }

    // Parabolic SAR
    static calculateParabolicSAR(data: any[], start: number = 0.02, increment: number = 0.02, max: number = 0.2) {
        if (data.length === 0) return [];

        const result = [];
        let isLong = true;
        let af = start;
        let ep = data[0].high;
        let sar = data[0].low;

        result.push({ time: data[0].time, value: sar });

        for (let i = 1; i < data.length; i++) {
            const prev = result[i - 1];
            const candle = data[i];
            const prevCandle = data[i - 1];

            // Calculate new SAR
            let nextSar = sar + af * (ep - sar);

            if (isLong) {
                if (data[i - 1].low < nextSar) nextSar = data[i - 1].low;
                if (i > 1 && data[i - 2].low < nextSar) nextSar = data[i - 2].low;
            } else {
                if (data[i - 1].high > nextSar) nextSar = data[i - 1].high;
                if (i > 1 && data[i - 2].high > nextSar) nextSar = data[i - 2].high;
            }

            sar = nextSar;

            // Check reversal
            let reversed = false;
            if (isLong) {
                if (candle.low < sar) {
                    isLong = false;
                    sar = ep;
                    ep = candle.low;
                    af = start;
                    reversed = true;
                }
            } else {
                if (candle.high > sar) {
                    isLong = true;
                    sar = ep;
                    ep = candle.high;
                    af = start;
                    reversed = true;
                }
            }

            if (!reversed) {
                if (isLong) {
                    if (candle.high > ep) {
                        ep = candle.high;
                        af = Math.min(af + increment, max);
                    }
                } else {
                    if (candle.low < ep) {
                        ep = candle.low;
                        af = Math.min(af + increment, max);
                    }
                }
            }

            result.push({ time: candle.time, value: sar });
        }
        return result;
    }

    // Relative Strength Index (RSI)
    static calculateRSI(data: any[], period: number = 14) {
        if (data.length <= period) return [];

        const rsi = [];
        let gainSum = 0;
        let lossSum = 0;

        // Initial SMA
        for (let i = 1; i <= period; i++) {
            const change = data[i].close - data[i - 1].close;
            if (change > 0) gainSum += change;
            else lossSum += Math.abs(change);
        }

        let avgGain = gainSum / period;
        let avgLoss = lossSum / period;

        rsi.push({
            time: data[period].time,
            value: 100 - (100 / (1 + (avgGain / (avgLoss || 1))))
        });

        for (let i = period + 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            rsi.push({
                time: data[i].time,
                value: 100 - (100 / (1 + (avgGain / (avgLoss || 1))))
            });
        }
        return rsi;
    }
}

