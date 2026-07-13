import './style.css'
import { Game } from './game/game'
import { loadAssets } from './game/assets'

const status = document.getElementById('loading-status')!
document.getElementById('intro-overlay')!.classList.add('show')

loadAssets((done, total) => {
  status.textContent = `summoning… ${done}/${total}`
})
  .then(() => {
    status.textContent = 'Click anywhere to begin'
    const game = new Game(document.getElementById('app')!)
    // debug handle for tests and tinkering (see CONTRIBUTING.md)
    ;(window as unknown as { __WT: Game }).__WT = game
  })
  .catch((err: Error) => {
    status.textContent = `failed to load: ${err.message}`
  })
