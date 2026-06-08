import Phaser from 'phaser';
import { FontFamily, toCss } from '../config';
import { effectAnim } from '../assets/atlas';

/**
 * Lightweight, screen-space visual effects: one-shot effect-sheet animations,
 * floating damage/heal numbers and a small particle burst. Kept deliberately
 * cheap (a handful of objects, all self-destroying) for mobile.
 */

const FX_DEPTH = 30;
const NUM_DEPTH = 60;

/** Play a one-shot effect animation (slash / magic / impact …) at (x, y). */
export function playEffect(scene: Phaser.Scene, key: string, x: number, y: number, scale = 1): void {
  if (!scene.textures.exists('effects') || !scene.anims.exists(effectAnim(key))) return;
  const spr = scene.add.sprite(x, y, 'effects').setScale(scale).setDepth(FX_DEPTH);
  spr.play(effectAnim(key));
  spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => spr.destroy());
}

/** A combat number that rises and fades (red for damage, green for heal). */
export function floatNumber(scene: Phaser.Scene, x: number, y: number, text: string, color: number): void {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: FontFamily,
      fontSize: '17px',
      color: toCss(color),
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setDepth(NUM_DEPTH);
  scene.tweens.add({
    targets: t,
    y: y - 26,
    alpha: { from: 1, to: 0 },
    duration: 720,
    ease: 'Quad.easeOut',
    onComplete: () => t.destroy(),
  });
}

/** A small radial burst of particles (default 6 — intentionally restrained). */
export function burst(scene: Phaser.Scene, x: number, y: number, color: number, count = 6): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.4;
    const dist = 9 + (i % 2) * 6;
    const dot = scene.add.rectangle(x, y, 3, 3, color).setDepth(FX_DEPTH + 1);
    scene.tweens.add({
      targets: dot,
      x: x + Math.cos(a) * dist,
      y: y + Math.sin(a) * dist,
      alpha: { from: 1, to: 0 },
      scale: { from: 1, to: 0.3 },
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => dot.destroy(),
    });
  }
}
