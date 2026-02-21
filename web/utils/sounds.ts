'use client';

class SoundEngine {
    private ctx: AudioContext | null = null;

    private getContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    private playTone(freq: number, type: OscillatorType, duration: number, volume: number) {
        try {
            const ctx = this.getContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);

            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('Audio play failed:', e);
        }
    }

    // High crisp ping for order execution
    playOrderSuccess() {
        this.playTone(880, 'sine', 0.15, 0.1);
        setTimeout(() => this.playTone(1760, 'sine', 0.1, 0.05), 50);
    }

    // Lower deeper ping for errors/failed orders
    playError() {
        this.playTone(220, 'square', 0.2, 0.05);
    }

    // High-conviction signal pulse (synthetic processing sound)
    playAlphaSignal() {
        this.playTone(1200, 'triangle', 0.05, 0.05);
        setTimeout(() => this.playTone(1400, 'triangle', 0.05, 0.05), 40);
        setTimeout(() => this.playTone(1600, 'triangle', 0.05, 0.05), 80);
    }

    // Deep sonar pulse for liquidations (Alert)
    playLiquidationAlert() {
        this.playTone(150, 'sine', 0.8, 0.2);
        this.playTone(300, 'sine', 0.4, 0.1);
    }
}

export const terminalSound = new SoundEngine();
