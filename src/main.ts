import Phaser from 'phaser';
import './style.css';

import { GAME_HEIGHT, GAME_WIDTH } from './game/config';
import { Settings } from './game/core/Settings';
import { BootScene } from './game/scenes/BootScene';
import { MainMenuScene } from './game/scenes/MainMenuScene';
import { ClassSelectScene } from './game/scenes/ClassSelectScene';
import { GameScene } from './game/scenes/GameScene';
import { DeathScene } from './game/scenes/DeathScene';
import { VictoryScene } from './game/scenes/VictoryScene';
import { SpriteShowcaseScene } from './game/scenes/SpriteShowcaseScene';

/**
 * 《零环》— game bootstrap. A fixed 390×844 portrait design that is letterboxed
 * (FIT + centred) onto whatever screen it runs on. The page itself is black and
 * non-scrolling; see src/style.css.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [
    BootScene,
    MainMenuScene,
    ClassSelectScene,
    GameScene,
    DeathScene,
    VictoryScene,
    SpriteShowcaseScene,
  ],
  disableContextMenu: true,
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
  },
  input: {
    activePointers: 2,
  },
};

const game = new Phaser.Game(config);

// Keep the input/scale bounds correct after the (safe-area) layout settles, so
// taps map to the right place on mobile. Phaser handles 'resize' itself; these
// extra refreshes catch the post-load / orientation settle.
const refreshScale = (): void => {
  game.scale.refresh();
};
window.addEventListener('load', refreshScale);
window.addEventListener('orientationchange', () => window.setTimeout(refreshScale, 150));
window.setTimeout(refreshScale, 250);

// Dev-only console handles for inspection/debugging. Stripped from production builds.
if (import.meta.env.DEV) {
  const w = window as Window & { zeroRing?: Phaser.Game; zeroRingSettings?: typeof Settings };
  w.zeroRing = game;
  w.zeroRingSettings = Settings;
}

// Register the service worker for an installable, offline-capable PWA.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
