import * as THREE from 'three'
import { mulberry32 } from './rng'

export const WORLD_RADIUS = 46

/** Builds the static battlefield: ground, fog, lights, and gothic scatter. */
export function buildWorld(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x05040a)
  scene.fog = new THREE.FogExp2(0x05040a, 0.022)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 18, 64),
    new THREE.MeshStandardMaterial({ color: 0x14121c, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.name = 'ground'
  scene.add(ground)

  const hemi = new THREE.HemisphereLight(0x5a5480, 0x1a1528, 3.2)
  scene.add(hemi)

  const moon = new THREE.DirectionalLight(0x8aa0c8, 1.8)
  moon.position.set(-30, 40, -20)
  moon.castShadow = true
  moon.shadow.mapSize.set(2048, 2048)
  const cam = moon.shadow.camera
  cam.left = -60
  cam.right = 60
  cam.top = 60
  cam.bottom = -60
  scene.add(moon)

  scatterDecor(scene)
}

function scatterDecor(scene: THREE.Scene): void {
  const rand = mulberry32(1337)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2734, roughness: 0.95 })
  const boneMat = new THREE.MeshStandardMaterial({ color: 0x4a4456, roughness: 0.9 })
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x1d1826, roughness: 1 })

  const decor = new THREE.Group()
  decor.name = 'decor'

  for (let i = 0; i < 70; i++) {
    const angle = rand() * Math.PI * 2
    const radius = 8 + rand() * (WORLD_RADIUS + 6)
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const kind = rand()

    let mesh: THREE.Mesh
    if (kind < 0.5) {
      // jagged rock
      const s = 0.4 + rand() * 1.6
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat)
      mesh.position.set(x, s * 0.4, z)
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    } else if (kind < 0.8) {
      // dead tree: trunk + a couple of bare branches
      const tree = new THREE.Group()
      const h = 2.5 + rand() * 3
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, h, 5), trunkMat)
      trunk.position.y = h / 2
      trunk.castShadow = true
      tree.add(trunk)
      for (let b = 0; b < 3; b++) {
        const bl = 0.8 + rand() * 1.4
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, bl, 4), trunkMat)
        branch.position.y = h * (0.55 + rand() * 0.4)
        branch.rotation.z = (rand() - 0.5) * 2.2
        branch.rotation.y = rand() * Math.PI * 2
        branch.translateY(bl / 2)
        tree.add(branch)
      }
      tree.position.set(x, 0, z)
      tree.rotation.z = (rand() - 0.5) * 0.15
      decor.add(tree)
      continue
    } else {
      // broken pillar / old monolith
      const h = 1 + rand() * 2.6
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, h, 6), boneMat)
      mesh.position.set(x, h / 2, z)
      mesh.rotation.z = (rand() - 0.5) * 0.35
      mesh.rotation.y = rand() * Math.PI
    }
    mesh.castShadow = true
    decor.add(mesh)
  }
  scene.add(decor)
}
