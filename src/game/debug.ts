import * as THREE from 'three'
import { instantiate, findBone } from './assets'

/** Exposes internals on window for headless tests and contributor tinkering. */
export function installDebug(): void {
  ;(window as unknown as Record<string, unknown>).__WTdebug = {
    THREE,
    instantiate,
    findBone,
  }
}
