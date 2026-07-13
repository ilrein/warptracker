import * as THREE from 'three'

/**
 * Action-combat input: WASD/arrows to move, mouse to aim, left click to
 * attack (hold to keep swinging), Space/Shift to dodge, wheel to zoom.
 */
export class InputManager {
  private keys = new Set<string>()
  private ndc = new THREE.Vector2()
  private hasPointer = false
  private raycaster = new THREE.Raycaster()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  attackHeld = false
  private attackPressed = false
  private dodgePressed = false
  private interacted = false

  onZoom?: (delta: number) => void
  onFirstInteraction?: () => void

  constructor(dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.dodgePressed = true
        e.preventDefault()
      }
      this.markInteracted()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.attackHeld = false
    })

    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.attackPressed = true
        this.attackHeld = true
      }
      this.updateNdc(e)
      this.markInteracted()
    })
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.attackHeld = false
    })
    dom.addEventListener('pointermove', (e) => this.updateNdc(e))
    dom.addEventListener('wheel', (e) => this.onZoom?.(Math.sign(e.deltaY)), { passive: true })
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private markInteracted(): void {
    if (!this.interacted) {
      this.interacted = true
      this.onFirstInteraction?.()
    }
  }

  private updateNdc(e: PointerEvent): void {
    this.hasPointer = true
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
  }

  /** Raw movement input in screen space: x = right, y = up. */
  moveInput(): THREE.Vector2 {
    const v = new THREE.Vector2(0, 0)
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v.y += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v.y -= 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v.x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v.x += 1
    if (v.lengthSq() > 1) v.normalize()
    return v
  }

  /** Where the mouse points on the ground plane, given the current camera. */
  aimPoint(camera: THREE.Camera): THREE.Vector3 | null {
    if (!this.hasPointer) return null
    this.raycaster.setFromCamera(this.ndc, camera)
    const point = new THREE.Vector3()
    return this.raycaster.ray.intersectPlane(this.groundPlane, point) ? point : null
  }

  /** Edge-triggered: true once per click. */
  takeAttackPressed(): boolean {
    const v = this.attackPressed
    this.attackPressed = false
    return v
  }

  /** Edge-triggered: true once per dodge key press. */
  takeDodgePressed(): boolean {
    const v = this.dodgePressed
    this.dodgePressed = false
    return v
  }
}
