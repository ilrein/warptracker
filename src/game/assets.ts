import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

/**
 * Quaternius CC0 models (see ASSETS.md). Each GLB carries its own animation
 * clips, loaded once and cloned per entity via SkeletonUtils.
 */
const NAMES = ['knight', 'sword', 'helmet', 'skeleton', 'bat', 'ghost', 'demon'] as const
export type ModelName = (typeof NAMES)[number]

interface CachedModel {
  scene: THREE.Group
  clips: Map<string, THREE.AnimationClip>
  rawHeight: number
}

const cache = new Map<ModelName, CachedModel>()

/** "HumanArmature|HumanArmature|Roll" → "Roll", "Skeleton_Attack" → "Attack" */
function normalizeClipName(model: ModelName, raw: string): string {
  let name = raw.split('|').pop() ?? raw
  const prefix = `${model}_`
  if (name.toLowerCase().startsWith(prefix)) name = name.slice(prefix.length)
  return name
}

export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder) // hero.glb is meshopt-compressed
  let done = 0
  await Promise.all(
    NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`/models/${name}.glb`)
      // some FBX→Blender→glTF conversions carry a zeroed material alpha
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats as THREE.MeshStandardMaterial[]) {
          mat.opacity = 1
          mat.transparent = false
          mat.depthWrite = true
        }
      })
      const clips = new Map<string, THREE.AnimationClip>()
      for (const clip of gltf.animations) {
        clips.set(normalizeClipName(name, clip.name), clip)
      }
      const bounds = new THREE.Box3().setFromObject(gltf.scene)
      cache.set(name, {
        scene: gltf.scene,
        clips,
        rawHeight: Math.max(0.001, bounds.max.y - bounds.min.y),
      })
      onProgress?.(++done, NAMES.length)
    })
  )
}

export interface ModelInstance {
  root: THREE.Group
  clips: Map<string, THREE.AnimationClip>
}

/** Clone a loaded model, scaled so its bounding height equals targetHeight. */
export function instantiate(name: ModelName, targetHeight: number): ModelInstance {
  const cached = cache.get(name)
  if (!cached) throw new Error(`model not loaded: ${name}`)
  const root = SkeletonUtils.clone(cached.scene) as THREE.Group
  const s = targetHeight / cached.rawHeight
  root.scale.setScalar(s)
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = true
      obj.frustumCulled = false // skinned meshes move; avoid pop-out at screen edges
    }
  })
  return { root, clips: cached.clips }
}

/** Find a skeleton bone by fuzzy name match (e.g. "palm" + "r"). */
export function findBone(root: THREE.Object3D, ...tokens: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (found) return
    const n = obj.name.toLowerCase()
    if (tokens.every((t) => n.includes(t.toLowerCase()))) found = obj
  })
  return found
}
