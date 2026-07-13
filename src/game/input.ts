import * as THREE from 'three'

export interface PickResult {
  enemyIndex: number | null
  ground: THREE.Vector3 | null
}

/**
 * Pointer input: raycasts clicks against enemies first, then the ground.
 * Holding the button keeps issuing move orders (Diablo-style drag walk).
 */
export class InputManager {
  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private pointerDown = false
  private lastEvent: PointerEvent | null = null
  private marker: THREE.Mesh
  private markerT = 1

  onPick?: (result: PickResult) => void
  onZoom?: (delta: number) => void
  onFirstInteraction?: () => void
  private interacted = false

  constructor(
    dom: HTMLElement,
    private camera: THREE.Camera,
    scene: THREE.Scene,
    private getEnemyMeshes: () => THREE.Object3D[]
  ) {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.45, 24),
      new THREE.MeshBasicMaterial({
        color: 0x86efac,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.position.y = 0.05
    scene.add(this.marker)

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      this.pointerDown = true
      this.lastEvent = e
      if (!this.interacted) {
        this.interacted = true
        this.onFirstInteraction?.()
      }
      this.pick(e, true)
    })
    dom.addEventListener('pointermove', (e) => {
      this.lastEvent = e
    })
    window.addEventListener('pointerup', () => {
      this.pointerDown = false
    })
    dom.addEventListener('wheel', (e) => this.onZoom?.(Math.sign(e.deltaY)), { passive: true })
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** Re-issue move orders while the pointer is held down. */
  update(dt: number): void {
    if (this.pointerDown && this.lastEvent) this.pick(this.lastEvent, false)
    if (this.markerT < 1) {
      this.markerT += dt * 2
      const mat = this.marker.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, 1 - this.markerT)
      this.marker.scale.setScalar(1 + this.markerT * 0.6)
    }
  }

  private pick(e: PointerEvent, allowTargeting: boolean): void {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)

    if (allowTargeting) {
      const meshes = this.getEnemyMeshes()
      const hits = this.raycaster.intersectObjects(meshes, true)
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object
        while (obj && obj.userData.enemyIndex === undefined) obj = obj.parent
        if (obj) {
          this.onPick?.({ enemyIndex: obj.userData.enemyIndex as number, ground: null })
          return
        }
      }
    }

    const point = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(this.groundPlane, point)) {
      if (allowTargeting) {
        this.marker.position.set(point.x, 0.05, point.z)
        this.marker.scale.setScalar(1)
        this.markerT = 0
      }
      this.onPick?.({ enemyIndex: null, ground: point })
    }
  }
}
