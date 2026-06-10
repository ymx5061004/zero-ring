import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';
import { getItem, RARITY_COLOR, RARITY_NAME, TYPE_NAME } from '../data/items';
import { isGear, type ItemInstance } from '../systems/ItemInstance';
import type { InventorySystem } from '../systems/InventorySystem';

/** One purchasable line of the merchant's stock (carries the exact instance sold). */
export interface ShopEntry {
  inst: ItemInstance;
  price: number;
  sold: boolean;
}

export interface ShopHandlers {
  /** Attempt to buy the entry; the scene validates gold/space and sets `sold`. */
  onBuy: (entry: ShopEntry) => void;
  onClose: () => void;
}

const PW = 344;
const PX = Math.round((GAME_WIDTH - PW) / 2);
const ROW_H = 54;

/**
 * The merchant's shop overlay — gives gold a purpose (req: 金币用途). Lists a few
 * wares with prices; tap a row to buy (the scene checks gold and bag space). Sold
 * rows grey out. Layout mirrors the other canvas overlays (dim backdrop + panel +
 * DOM controls), so taps map back through the camera before hit-testing.
 */
export class ShopView extends Phaser.GameObjects.Container {
  private readonly inv: InventorySystem;
  private readonly stock: ShopEntry[];
  private readonly handlers: ShopHandlers;
  private readonly content: Phaser.GameObjects.Container;
  private readonly top: number;
  private readonly panelH: number;
  private goldText!: Phaser.GameObjects.Text;
  private dynBtns: HtmlButton[] = [];
  private closeBtn?: HtmlButton;
  private closed = false;

  constructor(scene: Phaser.Scene, inv: InventorySystem, stock: ShopEntry[], handlers: ShopHandlers) {
    super(scene, 0, 0);
    this.setDepth(1100);
    this.inv = inv;
    this.stock = stock;
    this.handlers = handlers;
    blockUi();

    const headerH = 72;
    this.panelH = headerH + stock.length * ROW_H + 70;
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
        .text(PX + 22, top + 30, '商人', { fontFamily: FontFamily, fontSize: '22px', color: toCss(Palette.accent), fontStyle: 'bold' })
        .setOrigin(0, 0.5),
    );
    this.add(
      scene.add
        .text(PX + 22, top + 54, '以金币换取行囊之物', { fontFamily: FontFamily, fontSize: '12px', color: toCss(Palette.textMuted) })
        .setOrigin(0, 0.5),
    );
    this.goldText = scene.add
      .text(PX + PW - 22, top + 30, '', { fontFamily: FontFamily, fontSize: '16px', color: toCss(Palette.accentBright), fontStyle: 'bold' })
      .setOrigin(1, 0.5);
    this.add(this.goldText);

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

  /** Redraw stock rows + gold; call after a purchase mutates state. */
  rebuild(): void {
    if (this.closed) return;
    this.content.removeAll(true);
    this.dynBtns.forEach((b) => b.destroy());
    this.dynBtns = [];
    this.goldText.setText(`◇ ${this.inv.gold}`);

    const rowsTop = this.top + 72;
    this.stock.forEach((entry, i) => {
      const def = getItem(entry.inst.defId);
      // Gear shows its rolled name (affixes / +N / blessing); consumables show the
      // plain catalogue name (the merchant's wares are known, not aliased).
      const label = isGear(def.type) ? this.inv.name(entry.inst) : def.name;
      const cy = rowsTop + i * ROW_H + ROW_H / 2;
      const rx = PX + 14;
      const rw = PW - 28;
      const affordable = this.inv.gold >= entry.price;

      const g = this.scene.add.graphics();
      g.fillStyle(entry.sold ? Palette.panelDown : Palette.panelLight, entry.sold ? 0.5 : 1);
      g.fillRoundedRect(rx, cy - ROW_H / 2 + 3, rw, ROW_H - 6, 8);
      g.lineStyle(1.5, entry.sold ? Palette.border : RARITY_COLOR[def.rarity], entry.sold ? 0.5 : 1);
      g.strokeRoundedRect(rx, cy - ROW_H / 2 + 3, rw, ROW_H - 6, 8);
      this.content.add(g);

      if (this.scene.textures.exists('items')) {
        this.content.add(this.scene.add.image(rx + 26, cy, 'items', def.spriteFrame).setScale(1.1).setAlpha(entry.sold ? 0.4 : 1));
      }
      this.content.add(
        this.scene.add
          .text(rx + 50, cy - 9, label, { fontFamily: FontFamily, fontSize: '14px', color: toCss(entry.sold ? Palette.textMuted : RARITY_COLOR[def.rarity]), fontStyle: 'bold', wordWrap: { width: rw - 110 } })
          .setOrigin(0, 0.5),
      );
      this.content.add(
        this.scene.add
          .text(rx + 50, cy + 10, `${TYPE_NAME[def.type]} · ${RARITY_NAME[def.rarity]}`, { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.textMuted) })
          .setOrigin(0, 0.5),
      );
      const priceColor = entry.sold ? Palette.textMuted : affordable ? Palette.accentBright : Palette.danger;
      this.content.add(
        this.scene.add
          .text(rx + rw - 14, cy, entry.sold ? '已售' : `◇ ${entry.price}`, { fontFamily: FontFamily, fontSize: '15px', color: toCss(priceColor), fontStyle: 'bold' })
          .setOrigin(1, 0.5),
      );

      if (!entry.sold) {
        this.dynBtns.push(
          new HtmlButton(this.scene, PX + PW / 2, cy, '', () => {
            this.handlers.onBuy(entry);
            this.rebuild();
          }, { width: rw, height: ROW_H - 6, variant: 'hit', layer: 'modal' }),
        );
      }
    });
  }

  private close(): void {
    if (this.closed) return;
    this.handlers.onClose();
    this.destroy(); // does the actual teardown (idempotent)
  }

  /**
   * Teardown lives here (not just in close()) so the owner can tear the shop down
   * directly — e.g. the run ends on a purchase-driven monster round — and a scene
   * shutdown still unblocks the UI and frees the DOM buttons exactly once.
   */
  override destroy(fromScene?: boolean): void {
    if (!this.closed) {
      this.closed = true;
      this.closeBtn?.destroy();
      this.dynBtns.forEach((b) => b.destroy());
      this.dynBtns = [];
      unblockUi();
    }
    super.destroy(fromScene);
  }
}
