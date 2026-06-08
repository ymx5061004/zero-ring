import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { applyPixelFilter, buildAnimations, getAtlas, preloadSprites } from '../assets/atlas';

/**
 * Entry scene. Loads the procedurally generated spritesheets + atlas manifest,
 * registers animations, then shows a brief title flash and hands off to the main
 * menu. If assets are missing the game still runs (scenes guard on availability).
 */
export class BootScene extends Phaser.Scene {
  private assetError = false;

  constructor() {
    super(SceneKeys.Boot);
  }

  preload(): void {
    this.cameras.main.setBackgroundColor(Palette.bg);
    preloadSprites(this);
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.assetError = true;
      console.warn('[零环] 素材加载失败，将以无贴图模式继续：', file?.src ?? file?.key);
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(Palette.bg);

    // Crisp pixel scaling for the sheets, then build animations from the manifest.
    applyPixelFilter(this);
    const atlas = getAtlas(this);
    if (atlas && !this.assetError) {
      buildAnimations(this, atlas);
    }

    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '零环', {
        fontFamily: FontFamily,
        fontSize: '72px',
        color: toCss(Palette.accent),
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.tweens.add({
      targets: title,
      alpha: 1,
      duration: 520,
      ease: 'Sine.easeInOut',
      yoyo: true,
      hold: 280,
      onComplete: () => this.scene.start(SceneKeys.MainMenu),
    });
  }
}
