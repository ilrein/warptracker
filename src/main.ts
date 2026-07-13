import './style.css'
import { Game } from './game/game'

const game = new Game(document.getElementById('app')!)

// debug handle for tests and tinkering (see CONTRIBUTING.md)
;(window as unknown as { __WT: Game }).__WT = game
