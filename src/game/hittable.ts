import type * as THREE from 'three'

/** Anything the hero's sword and skills can hit: enemies, warpspires. */
export interface Hittable {
  position: THREE.Vector3
  radius: number
  alive: boolean
  takeDamage(amount: number, knockback: THREE.Vector3 | null): void
}
