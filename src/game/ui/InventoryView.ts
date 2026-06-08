import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { Button } from './Button';
import type { EquipSlot, InventorySystem } from '../systems/InventorySystem';
import {
  equipSlotOf,
  RARITY_COLOR,
  RARITY_NAME,
  TYPE_NAME,
  type ItemDef,
} from '../data/items';

export interface InventoryHandlers {
  onUse: (item: ItemDef) => void;
  onEquip: (item: ItemDef) => void;
  onUnequip: (slot: EquipSlot) => void;
  onClose: () => void;
}

const PX = 12;
const PY = 64;
const PW = 366;
const PH = 728;

const COLS = 5;
const ROWS = 4;
const CELL = 58;
const GAP = 8;
const GRID_X = PX + 24;
const GRID_Y = PY + 168;

const STAT_LABEL: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  agility: '敏捷',
  magic: '法术',
  maxHp: '生命',
};
const SCROLL_DESC: Record<string, string> = {
  reveal: '照亮全层',
  smite: '灼伤视野内敌人',
  blink: '瞬间挪移',
  vigor: '回满生命',
};

function effectSummary(item: ItemDef): string {
  const e = item.effects;
  const parts: string[] = [];
  if (e.equip) {
    for (const [k, v] of Object.entries(e.equip)) {
      if (v) parts.push(`${STAT_LABEL[k] ?? k} ${v > 0 ? '+' : ''}${v}`);
    }
  }
  if (e.heal) parts.push(`回复 ${e.heal >= 999 ? '全部' : e.heal} 生命`);
  if (e.boost?.maxHp) parts.push(`生命上限 +${e.boost.maxHp}（永久）`);
  if (e.scroll) parts.push(SCROLL_DESC[e.scroll] ?? '');
  if (e.gold) parts.push(`金币 +${e.gold}`);
  return parts.join('　');
}

/**
 * The inventory overlay — a Phaser container (no new page). Shows equipped gear,
 * gold and a 5×4 item grid; tap an item to select, then use/equip it. Sized for
 * touch. Rebuilds its dynamic content after each action.
 */
export class InventoryView extends Phaser.GameObjects.Container {
  private readonly inv: InventorySystem;
  private readonly handlers: InventoryHandlers;
  private readonly content: Phaser.GameObjects.Container;
  private selected: ItemDef | null = null;
  private alive = true;

  constructor(scene: Phaser.Scene, inv: InventorySystem, handlers: InventoryHandlers) {
    super(scene, 0, 0);
    this.setDepth(1000);
    this.inv = inv;
    this.handlers = handlers;

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    this.add(dim);

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(PX, PY, PW, PH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(PX, PY, PW, PH, 16);
    this.add(panel);

    this.add(
      scene.add
        .text(PX + 22, PY + 28, '背包', { fontFamily: FontFamily, fontSize: '22px', color: toCss(Palette.accent), fontStyle: 'bold' })
        .setOrigin(0, 0.5),
    );

    this.add(new Button(scene, PX + PW - 28, PY + 28, '✕', () => this.handlers.onClose(), { width: 38, height: 32, fontSize: 18 }));
    this.add(new Button(scene, GAME_WIDTH / 2, PY + PH - 34, '关闭返回', () => this.handlers.onClose(), { width: 240, height: 46, fontSize: 18 }));

    this.content = scene.add.container(0, 0);
    this.add(this.content);

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
    this.rebuild();
  }

  private rebuild(): void {
    this.content.removeAll(true);
    const add = (o: Phaser.GameObjects.GameObject): void => {
      this.content.add(o);
    };

    add(
      this.scene.add
        .text(PX + PW - 60, PY + 28, `◇ ${this.inv.gold}`, { fontFamily: FontFamily, fontSize: '15px', color: toCss(Palette.accentBright), fontStyle: 'bold' })
        .setOrigin(1, 0.5),
    );

    // --- equipped slots ------------------------------------------------
    const slots: Array<[EquipSlot, string, number]> = [
      ['weapon', '武器', PX + 64],
      ['armor', '防具', PX + 183],
      ['ring', '饰品', PX + 302],
    ];
    for (const [slot, label, cx] of slots) {
      const item = this.inv.equipped[slot];
      this.makeSlot(add, cx, PY + 82, item, label, () => {
        if (item) this.afterAction(() => this.handlers.onUnequip(slot));
      });
    }

    const rule = this.scene.add.graphics();
    rule.lineStyle(1, Palette.border, 1);
    rule.lineBetween(PX + 16, PY + 150, PX + PW - 16, PY + 150);
    add(rule);

    // --- bag grid ------------------------------------------------------
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const index = r * COLS + c;
        const item = this.inv.items[index] ?? null;
        const cx = GRID_X + CELL / 2 + c * (CELL + GAP);
        const cy = GRID_Y + CELL / 2 + r * (CELL + GAP);
        this.makeCell(add, cx, cy, item);
      }
    }

    // --- detail + action ----------------------------------------------
    this.makeDetail(add);
  }

  private makeSlot(
    add: (o: Phaser.GameObjects.GameObject) => void,
    cx: number,
    cy: number,
    item: ItemDef | null,
    label: string,
    onTap: () => void,
  ): void {
    const size = 52;
    const g = this.scene.add.graphics();
    g.fillStyle(Palette.panelDown, 1);
    g.fillRoundedRect(cx - size / 2, cy - size / 2, size, size, 8);
    g.lineStyle(2, item ? RARITY_COLOR[item.rarity] : Palette.border, 1);
    g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 8);
    add(g);

    if (item && this.scene.textures.exists('items')) {
      add(this.scene.add.image(cx, cy, 'items', item.spriteFrame).setScale(1.3));
    } else if (!item) {
      add(this.scene.add.text(cx, cy, '空', { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.textMuted) }).setOrigin(0.5));
    }

    add(this.scene.add.text(cx, cy + size / 2 + 9, label, { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.textDim) }).setOrigin(0.5));

    const zone = this.scene.add.zone(cx, cy, size, size).setInteractive();
    zone.on('pointerup', onTap);
    add(zone);
  }

  private makeCell(add: (o: Phaser.GameObjects.GameObject) => void, cx: number, cy: number, item: ItemDef | null): void {
    const selected = item !== null && item === this.selected;
    const g = this.scene.add.graphics();
    g.fillStyle(selected ? Palette.panelLight : Palette.panelDown, 1);
    g.fillRoundedRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL, 8);
    g.lineStyle(selected ? 2.5 : 1.5, item ? RARITY_COLOR[item.rarity] : Palette.border, item ? 1 : 0.6);
    g.strokeRoundedRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL, 8);
    add(g);

    if (item) {
      if (this.scene.textures.exists('items')) {
        add(this.scene.add.image(cx, cy - 4, 'items', item.spriteFrame).setScale(1.35));
      }
      add(
        this.scene.add
          .text(cx, cy + CELL / 2 - 9, item.name, { fontFamily: FontFamily, fontSize: '9px', color: toCss(selected ? Palette.text : Palette.textDim) })
          .setOrigin(0.5),
      );
      const zone = this.scene.add.zone(cx, cy, CELL, CELL).setInteractive();
      zone.on('pointerup', () => {
        this.selected = this.selected === item ? null : item;
        this.rebuild();
      });
      add(zone);
    }
  }

  private makeDetail(add: (o: Phaser.GameObjects.GameObject) => void): void {
    const left = PX + 22;
    const top = GRID_Y + ROWS * (CELL + GAP) + 6;
    const item = this.selected;
    if (!item) {
      add(
        this.scene.add
          .text(GAME_WIDTH / 2, top + 40, `背包　${this.inv.items.length} / ${this.inv.capacity}　·　点选物品查看`, {
            fontFamily: FontFamily,
            fontSize: '13px',
            color: toCss(Palette.textMuted),
          })
          .setOrigin(0.5),
      );
      return;
    }

    add(
      this.scene.add
        .text(left, top, item.name, { fontFamily: FontFamily, fontSize: '18px', color: toCss(RARITY_COLOR[item.rarity]), fontStyle: 'bold' })
        .setOrigin(0, 0),
    );
    add(
      this.scene.add
        .text(left, top + 26, `${TYPE_NAME[item.type]} · ${RARITY_NAME[item.rarity]}`, { fontFamily: FontFamily, fontSize: '12px', color: toCss(Palette.textMuted) })
        .setOrigin(0, 0),
    );
    add(
      this.scene.add
        .text(left, top + 48, item.description, { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.textDim), lineSpacing: 3, wordWrap: { width: PW - 56 } })
        .setOrigin(0, 0),
    );
    const summary = effectSummary(item);
    if (summary) {
      add(
        this.scene.add
          .text(left, top + 92, summary, { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.accent), wordWrap: { width: PW - 56 } })
          .setOrigin(0, 0),
      );
    }

    const equippable = equipSlotOf(item.type) !== null;
    add(
      new Button(this.scene, GAME_WIDTH / 2, top + 134, equippable ? '装备' : '使用', () => {
        this.afterAction(() => (equippable ? this.handlers.onEquip(item) : this.handlers.onUse(item)));
      }, {
        width: 200,
        height: 44,
        fontSize: 18,
        fill: Palette.accentDim,
        fillHover: 0x8a7440,
        border: Palette.accent,
      }),
    );
  }

  /** Run a handler that mutates the inventory, then clear selection and redraw. */
  private afterAction(fn: () => void): void {
    fn();
    if (!this.alive) return; // the action may have ended the game and closed this
    this.selected = null;
    this.rebuild();
  }

  override destroy(fromScene?: boolean): void {
    this.alive = false;
    super.destroy(fromScene);
  }
}
