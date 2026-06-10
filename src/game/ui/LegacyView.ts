import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';
import { SaveManager } from '../core/SaveManager';
import { UPGRADES, upgradeCost } from '../core/Meta';

const PW = 348;
const PX = Math.round((GAME_WIDTH - PW) / 2);
const ROW_H = 66;

/**
 * The 传承 (Legacy) screen: spend 环之碎屑 earned across runs on permanent upgrades
 * that apply at the start of every new run — the meta-progression that rewards
 * replaying (0.3). Reads/writes the meta blob directly via SaveManager.
 */
export class LegacyView extends Phaser.GameObjects.Container {
  private closed = false;
  private readonly content: Phaser.GameObjects.Container;
  private readonly top: number;
  private readonly panelH: number;
  private readonly onClose: () => void;
  private shardText!: Phaser.GameObjects.Text;
  private dynBtns: HtmlButton[] = [];
  private closeBtn?: HtmlButton;

  constructor(scene: Phaser.Scene, onClose: () => void) {
    super(scene, 0, 0);
    this.setDepth(1100);
    this.onClose = onClose;
    blockUi();

    this.panelH = 84 + UPGRADES.length * ROW_H + 70;
    this.top = Math.round((GAME_HEIGHT - this.panelH) / 2);
    const top = this.top;

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= PX && w.x <= PX + PW && w.y >= top && w.y <= top + this.panelH;
      if (!inPanel) this.close();
    });
    this.add(dim);

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(PX, top, PW, this.panelH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(PX, top, PW, this.panelH, 16);
    this.add(panel);

    this.add(
      scene.add
        .text(PX + 22, top + 30, '传承', { fontFamily: FontFamily, fontSize: '22px', color: toCss(Palette.accent), fontStyle: 'bold' })
        .setOrigin(0, 0.5),
    );
    this.add(
      scene.add
        .text(PX + 22, top + 56, '消耗环之碎屑，强化每一次轮回（开局生效）', { fontFamily: FontFamily, fontSize: '12px', color: toCss(Palette.textMuted) })
        .setOrigin(0, 0.5),
    );
    this.shardText = scene.add
      .text(PX + PW - 22, top + 32, '', { fontFamily: FontFamily, fontSize: '16px', color: toCss(Palette.accentBright), fontStyle: 'bold' })
      .setOrigin(1, 0.5);
    this.add(this.shardText);

    this.content = scene.add.container(0, 0);
    this.add(this.content);

    this.closeBtn = new HtmlButton(scene, GAME_WIDTH / 2, top + this.panelH - 34, '关闭', () => this.close(), {
      width: 220,
      height: 46,
      fontSize: 18,
      layer: 'modal',
    });

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
    this.rebuild();
  }

  private rebuild(): void {
    if (this.closed) return;
    this.content.removeAll(true);
    this.dynBtns.forEach((b) => b.destroy());
    this.dynBtns = [];
    const meta = SaveManager.getMeta();
    this.shardText.setText(`◇ 碎屑 ${meta.shards}`);

    const rowsTop = this.top + 84;
    UPGRADES.forEach((u, i) => {
      // Clamp the displayed level to the (possibly lowered) cap so an over-bought
      // older save reads as 已满 instead of an out-of-range level (phase 9).
      const lvl = Math.min(meta.upgrades[u.key] ?? 0, u.max);
      const maxed = lvl >= u.max;
      const cost = upgradeCost(u.base, lvl);
      const afford = meta.shards >= cost;
      const cy = rowsTop + i * ROW_H + ROW_H / 2;
      const rx = PX + 14;
      const rw = PW - 28;

      const g = this.content.scene.add.graphics();
      g.fillStyle(Palette.panelLight, 1);
      g.fillRoundedRect(rx, cy - ROW_H / 2 + 3, rw, ROW_H - 6, 8);
      g.lineStyle(1.5, maxed ? Palette.accent : Palette.border, 1);
      g.strokeRoundedRect(rx, cy - ROW_H / 2 + 3, rw, ROW_H - 6, 8);
      this.content.add(g);

      this.content.add(
        this.content.scene.add
          .text(rx + 16, cy - 13, `${u.name}　${u.kind === 'unlock' ? (maxed ? '已解锁' : '可解锁') : `Lv ${lvl}/${u.max}`}`, { fontFamily: FontFamily, fontSize: '15px', color: toCss(Palette.text), fontStyle: 'bold' })
          .setOrigin(0, 0.5),
      );
      this.content.add(
        this.content.scene.add
          .text(rx + 16, cy + 9, u.desc, { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.textMuted) })
          .setOrigin(0, 0.5),
      );

      // Right side: a 升级 button with the cost, or 已满 when maxed.
      if (maxed) {
        this.content.add(
          this.content.scene.add
            .text(rx + rw - 16, cy, u.kind === 'unlock' ? '已解锁' : '已满', { fontFamily: FontFamily, fontSize: '14px', color: toCss(Palette.accent), fontStyle: 'bold' })
            .setOrigin(1, 0.5),
        );
      } else {
        this.dynBtns.push(
          new HtmlButton(this.content.scene, rx + rw - 52, cy, `◇${cost}`, () => this.buy(u.key, cost), {
            width: 84,
            height: 40,
            fontSize: 14,
            variant: afford ? 'primary' : 'default',
            layer: 'modal',
          }),
        );
      }
    });
  }

  private buy(key: keyof ReturnType<typeof SaveManager.getMeta>['upgrades'], cost: number): void {
    const meta = SaveManager.getMeta();
    const lvl = meta.upgrades[key];
    const def = UPGRADES.find((u) => u.key === key);
    if (!def || lvl >= def.max || meta.shards < cost) return;
    meta.shards -= cost;
    meta.upgrades[key] = lvl + 1;
    SaveManager.saveMeta(meta);
    this.rebuild();
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeBtn?.destroy();
    this.dynBtns.forEach((b) => b.destroy());
    this.dynBtns = [];
    unblockUi();
    this.onClose();
    this.destroy();
  }
}
