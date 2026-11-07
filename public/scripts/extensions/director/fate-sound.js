const TONES = {
    draw: { frequency: 320, endFrequency: 560, duration: 0.22 },
    seal: { frequency: 220, endFrequency: 110, duration: 0.28 },
    flip: { frequency: 440, endFrequency: 880, duration: 0.18 },
};

/** Short, optional ritual sounds. Call play directly from the initial user click. */
export function createFateSound(getEnabled) {
    let context = null;

    function synthesize(audio, tone) {
        let oscillator;
        let gain;
        const disconnect = () => {
            try { oscillator?.disconnect(); } catch { /* Audio is optional. */ }
            try { gain?.disconnect(); } catch { /* Audio is optional. */ }
        };
        try {
            oscillator = audio.createOscillator();
            gain = audio.createGain();
            oscillator.onended = disconnect;
            oscillator.type = 'sine';
            const start = audio.currentTime;
            oscillator.frequency.setValueAtTime(tone.frequency, start);
            oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, start + tone.duration);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.06, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start(start);
            oscillator.stop(start + tone.duration);
        } catch {
            disconnect();
        }
    }

    function play(kind) {
        try {
            const tone = Object.hasOwn(TONES, kind) ? TONES[kind] : null;
            if (!tone || !getEnabled()) return;
            if (!context || context.state === 'closed') {
                // Do not create a context from asynchronous generation callbacks.
                const active = globalThis.navigator?.userActivation?.isActive;
                if (active === false || (kind === 'seal' && active !== true)) return;
                const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
                if (!AudioContext) return;
                context = new AudioContext();
            }
            const audio = context;
            if (audio.state === 'suspended') {
                Promise.resolve(audio.resume()).then(() => {
                    if (audio.state === 'running' && getEnabled()) synthesize(audio, tone);
                }).catch(() => {});
                return;
            }
            if (audio.state === 'running') synthesize(audio, tone);
        } catch { /* Unsupported audio, disabled settings and autoplay refusals stay silent. */ }
    }

    return { play };
}
