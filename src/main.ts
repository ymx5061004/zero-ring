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

// --- Crisp text on high-DPI screens ------------------------------------------
// FIT mode keeps the canvas *backing buffer* at the game size and CSS-upscales it
// to fill the screen. At the logical 390×844 that buffer is far smaller than a
// phone's physical pixel grid (e.g. ×3 on retina), so the browser stretches it and
// everything — text most visibly — turns to mush. Bumping a Text object's own
// `resolution` can't fix that alone: the high-res glyph texture still gets squashed
// into a 390-wide buffer.
//
// So we render the *whole* game at device-pixel density: the canvas buffer is sized
// to GAME_*×SUPERSAMPLE and every (non-scrolling) main camera is zoomed by the same
// factor, which leaves all 390×844 layout coordinates untouched while the pixels are
// drawn at native density. The Text `resolution` patch below then matches, so glyph
// textures are 1:1 with the buffer and stay sharp. FIT still CSS-fits the (now
// high-res) buffer to the screen, so the on-screen size is unchanged.
const SUPERSAMPLE = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);

// Patch the factory so all `this.add.text(...)` calls inherit the matching
// resolution; size/position/input are unaffected.
const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
  text(x: number, y: number, text: string | string[], style?: Record<string, unknown>): Phaser.GameObjects.Text;
};
const originalText = factory.text;
factory.text = function patchedText(x, y, text, style) {
  const merged = { ...(style ?? {}) };
  if (merged.resolution === undefined) merged.resolution = SUPERSAMPLE;
  return originalText.call(this, x, y, text, merged);
};

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Backing buffer at device-pixel density; the design space stays 390×844 via
    // the per-camera zoom installed below. Aspect ratio is unchanged (the factor
    // cancels), so FIT letterboxes exactly as before.
    width: GAME_WIDTH * SUPERSAMPLE,
    height: GAME_HEIGHT * SUPERSAMPLE,
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

// Zoom every scene's main camera by SUPERSAMPLE so the high-density buffer renders
// the 390×844 design at native pixels. `centerOn` the design centre cancels the
// zoom's origin offset, mapping logical (0,0)→(0,0) and (390,844)→buffer corner —
// so all scene coordinates, input hit-testing and the DOM UI overlay are unaffected.
// None of the scenes scroll their camera (the dungeon moves its own container), so a
// single zoom+centre is correct for world and HUD alike. Re-applied on every CREATE
// to survive scene restarts. READY fires after the SceneManager's bootQueue, so the
// scene list is fully populated and no scene has rendered yet (no first-frame flash).
if (SUPERSAMPLE !== 1) {
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.scenes) {
      scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => {
        const cam = scene.cameras.main;
        cam.setZoom(SUPERSAMPLE);
        cam.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      });
    }
  });
}

// Keep the input/scale bounds correct after the (safe-area) layout settles, so
// taps map to the right place on mobile. Phaser handles 'resize' itself; these
// extra refreshes catch the post-load / orientation settle.
const refreshScale = (): void => {
  game.scale.refresh();
};
window.addEventListener('load', refreshScale);
window.addEventListener('orientationchange', () => window.setTimeout(refreshScale, 150));
window.setTimeout(refreshScale, 250);

// Recompute the canvas bounds whenever the layout settles or changes (late font
// load, safe-area insets, browser UI showing/hiding). A stale bounds rectangle is
// the usual cause of taps landing a little off, so we keep it fresh at the source.
const gameRoot = document.getElementById('game-root');
if (gameRoot && 'ResizeObserver' in window) {
  new ResizeObserver(() => refreshScale()).observe(gameRoot);
}

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
