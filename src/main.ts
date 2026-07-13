import './style.css'
import { Game } from './game/game'
import { loadAssets } from './game/assets'
import { showClassSelect } from './game/classes'

const status = document.getElementById('loading-status')!
const intro = document.getElementById('intro-overlay')!
intro.classList.add('show')

async function boot(): Promise<void> {
  await loadAssets((done, total) => {
    status.textContent = `summoning… ${done}/${total}`
  })
  intro.classList.remove('show')
  const classId = await showClassSelect()
  const game = new Game(document.getElementById('app')!, classId)
  // debug handles for tests and tinkering (see CONTRIBUTING.md)
  ;(window as unknown as { __WT: Game }).__WT = game
  void import('./game/debug').then((m) => m.installDebug())
}

boot().catch((err: Error) => {
  intro.classList.add('show')
  status.textContent = `failed to load: ${err.message}`
})
