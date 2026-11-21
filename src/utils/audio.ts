import countdownAudioUrl from '../assets/audio/countdown-10-to-0.mp3';

export interface CountdownCueSlice {
  second: number;
  startSec: number;
  durSec: number;
}

// Measured from src/assets/audio/countdown-10-to-0.mp3 (15.768s, 24kHz mono)
export const COUNTDOWN_AUDIO_CUES: CountdownCueSlice[] = [
  { second: 10, startSec: 0.22, durSec: 0.22 },
  { second: 9, startSec: 1.34, durSec: 0.64 },
  { second: 8, startSec: 2.88, durSec: 0.62 },
  { second: 7, startSec: 4.42, durSec: 0.64 },
  { second: 6, startSec: 5.96, durSec: 0.62 },
  { second: 5, startSec: 7.48, durSec: 0.46 },
  { second: 4, startSec: 8.88, durSec: 0.36 },
  { second: 3, startSec: 10.12, durSec: 0.34 },
  { second: 2, startSec: 11.36, durSec: 0.32 },
  { second: 1, startSec: 12.58, durSec: 0.40 },
  { second: 0, startSec: 13.90, durSec: 1.12 },
];

class SoundEffects {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private countdownAudio: HTMLAudioElement | null = null;
  private countdownBuffer: AudioBuffer | null = null;
  private countdownLoadPromise: Promise<AudioBuffer | null> | null = null;
  private countdownNodes: AudioBufferSourceNode[] = [];
  private activeScheduleToken: number = 0;

  constructor() {
    // Lazily initialized upon first user interaction
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stopCountdownAudio();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public playClick() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch {
      // AudioContext policy
    }
  }

  public playBeep() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(160, this.ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    } catch {
      // ignore
    }
  }

  public stopCountdownAudio() {
    this.activeScheduleToken += 1;
    for (const node of this.countdownNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // already stopped
      }
    }
    this.countdownNodes = [];
    try {
      if (this.countdownAudio) {
        this.countdownAudio.pause();
        this.countdownAudio.currentTime = 0;
      }
    } catch {
      // ignore audio cleanup errors
    }
  }

  public preloadCountdownAudio(): Promise<AudioBuffer | null> {
    if (this.countdownBuffer) return Promise.resolve(this.countdownBuffer);
    if (this.countdownLoadPromise) return this.countdownLoadPromise;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return Promise.resolve(null);
    }

    this.countdownLoadPromise = (async () => {
      try {
        this.initCtx();
        if (!this.ctx) return null;
        const resp = await fetch(countdownAudioUrl);
        if (!resp.ok) return null;
        const arrBuf = await resp.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arrBuf);
        this.countdownBuffer = decoded;
        return decoded;
      } catch {
        return null;
      }
    })();

    return this.countdownLoadPromise;
  }

  public async scheduleCountdownCues(remainingMs: number) {
    if (this.isMuted || typeof window === 'undefined') return;
    this.stopCountdownAudio();
    const token = this.activeScheduleToken;
    const startedAtPerf = performance.now();

    try {
      this.initCtx();
      if (!this.ctx) {
        this.playCountdownAudio();
        return;
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume().catch(() => {});
      }

      const buffer = this.countdownBuffer || (await this.preloadCountdownAudio());
      if (token !== this.activeScheduleToken || this.isMuted) return;

      if (!buffer) {
        this.playCountdownAudio();
        return;
      }

      const elapsedMs = performance.now() - startedAtPerf;
      const effectiveRemMs = remainingMs - elapsedMs;
      const baseTime = this.ctx.currentTime;

      for (const cue of COUNTDOWN_AUDIO_CUES) {
        const delaySec = (effectiveRemMs - cue.second * 1000) / 1000;
        if (delaySec < -0.25) continue;

        const startWhen = baseTime + Math.max(0, delaySec);
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;

        const gain = this.ctx.createGain();
        const fade = 0.008;
        gain.gain.setValueAtTime(0.001, startWhen);
        gain.gain.linearRampToValueAtTime(1.0, startWhen + fade);
        gain.gain.setValueAtTime(1.0, startWhen + Math.max(fade, cue.durSec - fade));
        gain.gain.linearRampToValueAtTime(0.001, startWhen + cue.durSec);

        src.connect(gain);
        gain.connect(this.ctx.destination);
        src.start(startWhen, cue.startSec, cue.durSec);
        this.countdownNodes.push(src);
      }
    } catch {
      // Respect browser autoplay restrictions silently
    }
  }

  public playCountdownAudio() {
    if (this.isMuted || typeof Audio === 'undefined') return;
    try {
      this.stopCountdownAudio();
      if (!this.countdownAudio) {
        this.countdownAudio = new Audio(countdownAudioUrl);
        this.countdownAudio.preload = 'auto';
      }
      this.countdownAudio.currentTime = 0;
      const playPromise = this.countdownAudio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Respect browser autoplay restrictions silently
        });
      }
    } catch {
      // Respect browser autoplay restrictions silently
    }
  }

  public playBettingLockAlert() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const tones = [
        { freq: 880, start: 0, dur: 0.11 },
        { freq: 660, start: 0.14, dur: 0.15 },
      ];
      for (const tone of tones) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(tone.freq, now + tone.start);

        gain.gain.setValueAtTime(0.2, now + tone.start);
        gain.gain.exponentialRampToValueAtTime(0.005, now + tone.start + tone.dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + tone.start);
        osc.stop(now + tone.start + tone.dur);
      }
    } catch {
      // Respect browser autoplay restrictions silently
    }
  }

  public playSelect() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch {
      // ignore
    }
  }

  public playReelTick() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(260 + Math.random() * 80, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.03);
    } catch {
      // ignore
    }
  }

  public playResultIncoming() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      // Dramatic chime roll
      const freqs = [330, 392, 440, 523.25];
      freqs.forEach((f, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, this.ctx.currentTime + i * 0.08);

        gain.gain.setValueAtTime(0.18, this.ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.08 + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + i * 0.08);
        osc.stop(this.ctx.currentTime + i * 0.08 + 0.3);
      });
    } catch {
      // ignore
    }
  }

  public playChannelReveal(channel: string) {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const channelPitches: Record<string, number[]> = {
        A: [440, 659.25, 880], // A4 -> E5 -> A5
        B: [493.88, 739.99, 987.77], // B4 -> F#5 -> B5
        C: [523.25, 783.99, 1046.5], // C5 -> G5 -> C6
        D: [587.33, 880, 1174.66], // D5 -> A5 -> D6
        E: [659.25, 987.77, 1318.51, 1567.98], // E5 -> B5 -> E6 -> G6 grand finish!
      };

      const notes = channelPitches[channel] || [523.25, 1046.5];

      // Thump / Gong impact
      const oscThump = this.ctx.createOscillator();
      const gainThump = this.ctx.createGain();
      oscThump.type = 'triangle';
      oscThump.frequency.setValueAtTime(220, this.ctx.currentTime);
      oscThump.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + 0.18);

      gainThump.gain.setValueAtTime(0.28, this.ctx.currentTime);
      gainThump.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

      oscThump.connect(gainThump);
      gainThump.connect(this.ctx.destination);
      oscThump.start();
      oscThump.stop(this.ctx.currentTime + 0.2);

      // Chimes
      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.05);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.05 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + idx * 0.05);
        osc.stop(this.ctx.currentTime + idx * 0.05 + 0.35);
      });
    } catch {
      // ignore
    }
  }

  public playReelStop() {
    this.playChannelReveal('A');
  }

  public playWin() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.1);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.1 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + idx * 0.1);
        osc.stop(this.ctx.currentTime + idx * 0.1 + 0.35);
      });
    } catch {
      // ignore
    }
  }

  public playCash() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987.77, this.ctx.currentTime); // B5
      osc.frequency.setValueAtTime(1318.51, this.ctx.currentTime + 0.08); // E6

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    } catch {
      // ignore
    }
  }
}

export const sound = new SoundEffects();
