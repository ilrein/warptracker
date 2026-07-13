/**
 * Tiny procedural sound effects via WebAudio — no audio files, so every
 * sound in the game is free and open by construction.
 */
let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
  delay = 0
): void {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + delay
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration)
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

export const audio = {
  unlock(): void {
    ac()
  },
  swing(): void {
    tone(140, 0.09, 'square', 0.05, 90)
  },
  hit(): void {
    tone(190, 0.1, 'sawtooth', 0.07, 120)
  },
  hurt(): void {
    tone(110, 0.18, 'square', 0.08, 60)
  },
  kill(): void {
    tone(320, 0.22, 'sawtooth', 0.07, 70)
  },
  levelUp(): void {
    tone(440, 0.12, 'triangle', 0.09)
    tone(554, 0.12, 'triangle', 0.09, undefined, 0.1)
    tone(659, 0.25, 'triangle', 0.1, undefined, 0.2)
  },
  warpClosed(): void {
    tone(220, 0.4, 'sine', 0.1, 440)
    tone(330, 0.4, 'sine', 0.08, 660, 0.05)
  },
  riftCleared(): void {
    tone(392, 0.2, 'triangle', 0.1)
    tone(494, 0.2, 'triangle', 0.1, undefined, 0.15)
    tone(587, 0.2, 'triangle', 0.1, undefined, 0.3)
    tone(784, 0.5, 'triangle', 0.12, undefined, 0.45)
  },
  death(): void {
    tone(200, 1.1, 'sawtooth', 0.1, 40)
  },
  dodge(): void {
    tone(420, 0.16, 'sine', 0.06, 120)
  },
}
