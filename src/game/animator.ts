import * as THREE from 'three'

export interface PlayOptions {
  /** loop forever (default true); one-shots clamp on their last frame */
  loop?: boolean
  /** crossfade duration in seconds */
  fade?: number
  /** stretch/compress the clip to exactly this many seconds */
  duration?: number
}

/** Thin AnimationMixer wrapper: named clips, crossfades, one-shots. */
export class Animator {
  private mixer: THREE.AnimationMixer
  private actions = new Map<string, THREE.AnimationAction>()
  private clipDurations = new Map<string, number>()
  private current: THREE.AnimationAction | null = null
  private currentName = ''

  constructor(root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root)
    for (const [name, clip] of clips) {
      this.actions.set(name, this.mixer.clipAction(clip))
      this.clipDurations.set(name, clip.duration)
    }
  }

  has(name: string): boolean {
    return this.actions.has(name)
  }

  play(name: string, opts: PlayOptions = {}): void {
    const { loop = true, fade = 0.12, duration } = opts
    const next = this.actions.get(name)
    if (!next) return
    // restarting the same looping clip is a no-op; one-shots always restart
    if (loop && this.currentName === name && this.current?.isRunning()) return

    next.reset()
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    next.clampWhenFinished = !loop
    const clipDuration = this.clipDurations.get(name) ?? 1
    next.timeScale = duration ? clipDuration / duration : 1
    next.play()

    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, fade, false)
    }
    this.current = next
    this.currentName = name
  }

  update(dt: number): void {
    this.mixer.update(dt)
  }
}
