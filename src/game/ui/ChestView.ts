import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';

/** The chest's *known* state — what the player has learned, drives which buttons show. */
export interface ChestState {
  locked: boolean;
  trapped: boolean;
  /** True once 检查 / 灯火 has resolved the trap status (so it can be shown). */
  trapDiscovered: boolean;
  /** Display name of the discovered trap (empty unless trapDiscovered && trapped). */
  trapName: string;
}

export interface ChestHandlers {
  onInspect: () => void;
  onPick: () => void;
  onDisarm: () => void;
  onForce: () => void;
  onOpen: () => void;
  onCancel: () => void;
}

/**
 * The chest interaction menu (0.3). Opened by bumping a closed chest — like stepping
 * into the merchant — instead of auto-opening on step. Mirrors the GameMenu overlay
 * (dim + panel + DOM buttons). Only context-valid actions are shown: 开锁 when locked,
 * 拆陷阱 only once a trap is discovered, 打开 only when unlocked. Every shown action is
 * a real attempt that the scene resolves and charges a turn for; 取消 is free.
 */
export class ChestView extends Phaser.GameObjects.Container {
  private closed = false;
  private btns: HtmlButton[] = [];

  constructor(scene: Phaser.Scene, state: ChestState, handlers: ChestHandlers) {
    super(scene, 0, 0);
    this.setDepth(1100);
    blockUi();

    // A line listing what the player knows (lock is visible; trap needs 检查).
    const tags: string[] = [];
    if (state.locked) tags.push('上锁');
    if (state.trapDiscovered) tags.push(state.trapped ? `机关·${state.trapName}` : '无机关');
    else tags.push('机关未知');
    const status = `宝箱（${tags.join(' · ')}）`;

    // Build the action list from the known state.
    const actions: Array<[string, () => void, ('primary' | 'ghost')?]> = [];
    if (!state.trapDiscovered) actions.push(['检查', handlers.onInspect]);
    if (state.locked) actions.push(['开锁', handlers.onPick]);
    if (state.trapDiscovered && state.trapped) actions.push(['拆陷阱', handlers.onDisarm]);
    actions.push(['强开', handlers.onForce, 'ghost']);
    if (!state.locked) actions.push(['打开', handlers.onOpen, 'primary']);
    actions.push(['取消', handlers.onCancel, 'ghost']);

    const panelW = 280;
    const panelH = 96 + actions.length * 58 + 16;
    const left = Math.round((GAME_WIDTH - panelW) / 2);
    const top = Math.round((GAME_HEIGHT - panelH) / 2);

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    // A tap outside the panel cancels (free) — pointer is buffer px, map it back.
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= left && w.x <= left + panelW && w.y >= top && w.y <= top + panelH;
      if (!inPanel) this.finish(handlers.onCancel);
    });

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(left, top, panelW, panelH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(left, top, panelW, panelH, 16);

    const title = scene.add
      .text(GAME_WIDTH / 2, top + 30, '宝箱', { fontFamily: FontFamily, fontSize: '22px', color: toCss(Palette.accent), fontStyle: 'bold' })
      .setOrigin(0.5);
    const sub = scene.add
      .text(GAME_WIDTH / 2, top + 60, status, { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.textDim) })
      .setOrigin(0.5);

    this.add([dim, panel, title, sub]);

    const cx = GAME_WIDTH / 2;
    let by = top + 96 + 24;
    for (const [label, handler, variant] of actions) {
      this.btns.push(
        new HtmlButton(scene, cx, by, label, () => this.finish(handler), {
          width: 200,
          height: 48,
          fontSize: 17,
          variant,
          layer: 'modal',
        }),
      );
      by += 58;
    }

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 110 });
  }

  /** Tear down the menu, then run the chosen action (so the scene owns the turn cost). */
  private finish(handler: () => void): void {
    if (this.closed) return;
    this.closed = true;
    this.btns.forEach((b) => b.destroy());
    this.btns = [];
    unblockUi();
    this.destroy();
    handler();
  }

  /** Idempotent teardown so the owner (death / floor change) can tear it down directly. */
  override destroy(fromScene?: boolean): void {
    if (!this.closed) {
      this.closed = true;
      this.btns.forEach((b) => b.destroy());
      this.btns = [];
      unblockUi();
    }
    super.destroy(fromScene);
  }
}
