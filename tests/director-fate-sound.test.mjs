import assert from 'node:assert/strict';
import test from 'node:test';
import { createFateSound } from '../public/scripts/extensions/director/fate-sound.js';

function audioLab(t, { active = true, state = 'running', resumeRejects = false } = {}) {
    const descriptors = new Map(['AudioContext', 'webkitAudioContext', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const created = [];
    const activation = { isActive: active };
    class FakeAudioContext {
        constructor() {
            this.state = state;
            this.currentTime = 10;
            this.destination = {};
            this.oscillators = [];
            this.gains = [];
            this.resumes = 0;
            created.push(this);
        }

        resume() {
            this.resumes++;
            if (resumeRejects) return Promise.reject(new Error('Autoplay denied'));
            this.state = 'running';
            return Promise.resolve();
        }

        createOscillator() {
            const oscillator = {
                frequency: parameter(),
                connect(target) { this.target = target; },
                disconnect() { this.disconnected = true; },
                start(time) { this.started = time; },
                stop(time) { this.stopped = time; },
            };
            this.oscillators.push(oscillator);
            return oscillator;
        }

        createGain() {
            const gain = {
                gain: parameter(),
                connect(target) { this.target = target; },
                disconnect() { this.disconnected = true; },
            };
            this.gains.push(gain);
            return gain;
        }
    }
    const set = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    set('AudioContext', FakeAudioContext);
    set('webkitAudioContext', undefined);
    set('navigator', { userActivation: activation });
    t.after(() => {
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    return { created, activation, set };
}

function parameter() {
    return {
        points: [],
        setValueAtTime(value, time) { this.points.push({ value, time }); },
        exponentialRampToValueAtTime(value, time) { this.points.push({ value, time }); },
    };
}

test('sound stays lazy and disabled or unknown sounds create no context', t => {
    const lab = audioLab(t);
    let enabled = false;
    const sound = createFateSound(() => enabled);
    assert.equal(lab.created.length, 0);
    assert.doesNotThrow(() => sound.play('draw'));
    enabled = true;
    assert.doesNotThrow(() => sound.play('other'));
    assert.doesNotThrow(() => sound.play('__proto__'));
    assert.equal(lab.created.length, 0);
});

test('context creation requires an active gesture when user activation is available', t => {
    const lab = audioLab(t, { active: false });
    const sound = createFateSound(() => true);
    sound.play('seal');
    assert.equal(lab.created.length, 0);
    lab.activation.isActive = true;
    sound.play('draw');
    assert.equal(lab.created.length, 1);
    lab.activation.isActive = false;
    sound.play('seal');
    assert.equal(lab.created.length, 1);
    assert.equal(lab.created[0].oscillators.length, 2);
});

test('asynchronous seals cannot create or replace a context without user activation support', t => {
    const lab = audioLab(t);
    lab.set('navigator', {});
    const sound = createFateSound(() => true);
    sound.play('seal');
    assert.equal(lab.created.length, 0);
    sound.play('draw');
    assert.equal(lab.created.length, 1);
    sound.play('seal');
    assert.equal(lab.created[0].oscillators.length, 2);
    lab.created[0].state = 'closed';
    sound.play('seal');
    assert.equal(lab.created.length, 1);
    sound.play('flip');
    assert.equal(lab.created.length, 2);
});

test('each ritual tone uses a short oscillator and gain envelope, then disconnects', t => {
    const lab = audioLab(t);
    const sound = createFateSound(() => true);
    for (const kind of ['draw', 'seal', 'flip']) sound.play(kind);
    assert.equal(lab.created.length, 1);
    const audio = lab.created[0];
    assert.equal(audio.oscillators.length, 3);
    for (const [index, oscillator] of audio.oscillators.entries()) {
        const gain = audio.gains[index];
        const duration = oscillator.stopped - oscillator.started;
        assert.ok(duration >= 0.15 && duration <= 0.4);
        assert.equal(oscillator.target, gain);
        assert.equal(gain.target, audio.destination);
        assert.equal(gain.gain.points.at(-1).value, 0.0001);
        assert.equal(gain.gain.points.at(-1).time, oscillator.stopped);
        oscillator.onended();
        assert.equal(oscillator.disconnected, true);
        assert.equal(gain.disconnected, true);
    }
});

test('suspended contexts resume and play only after permission succeeds', async t => {
    const lab = audioLab(t, { state: 'suspended' });
    const sound = createFateSound(() => true);
    sound.play('flip');
    assert.equal(lab.created[0].resumes, 1);
    assert.equal(lab.created[0].oscillators.length, 0);
    await Promise.resolve();
    assert.equal(lab.created[0].oscillators.length, 1);
});

test('disabling sound while resume is pending prevents a delayed tone', async t => {
    const lab = audioLab(t, { state: 'suspended' });
    let enabled = true;
    const sound = createFateSound(() => enabled);
    sound.play('draw');
    enabled = false;
    await Promise.resolve();
    assert.equal(lab.created[0].oscillators.length, 0);
});

test('autoplay refusal is silent and creates no queued oscillator', async t => {
    const lab = audioLab(t, { state: 'suspended', resumeRejects: true });
    const sound = createFateSound(() => true);
    assert.doesNotThrow(() => sound.play('draw'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(lab.created[0].oscillators.length, 0);
});

test('unsupported audio and failures in settings or browser audio never throw', t => {
    const lab = audioLab(t);
    lab.set('AudioContext', undefined);
    assert.doesNotThrow(() => createFateSound(() => true).play('draw'));
    lab.set('AudioContext', class { constructor() { throw new Error('Audio unavailable'); } });
    assert.doesNotThrow(() => createFateSound(() => true).play('draw'));
    assert.doesNotThrow(() => createFateSound(() => { throw new Error('Settings unavailable'); }).play('draw'));
    lab.set('AudioContext', class {
        state = 'running';
        createOscillator() { throw new Error('Nodes unavailable'); }
    });
    assert.doesNotThrow(() => createFateSound(() => true).play('draw'));
    lab.set('AudioContext', class {
        state = 'suspended';
        resume() { throw new Error('Cannot resume'); }
    });
    assert.doesNotThrow(() => createFateSound(() => true).play('draw'));
});
