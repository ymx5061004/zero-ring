import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';
import { SLOT_LABEL, type EquipSlot, type InventorySystem } from '../systems/InventorySystem';
import {
  equipSlotOf,
  getAffix,
  getItem,
  RARITY_COLOR,
  RARITY_NAME,
  STAT_LABEL_CN,
  TYPE_NAME,
  type ItemDef,
  type StatKey,
} from '../data/items';
import { equipBonus, type ItemInstance } from '../systems/ItemInstance';

export interface InventoryHandlers {
  onUse: (item: ItemInstance) => void;
  onEquip: (item: ItemInstance) => void;
  onUnequip: (slot: EquipSlot) => void;
  onDrop: (item: ItemInstance) => void;
  onClose: () => void;
}

const PX = 12;
const PY = 64;
const PW = 366;
const PH = 728;

const COLS = 5;
const ROWS = 4;
const CELL = 52;
const GAP = 6;
const GRID_W = COLS * CELL + (COLS - 1) * GAP;
const GRID_X = PX + (PW - GRID_W) / 2;
const GRID_Y = PY + 268;

// Paper-doll: the eleven slots in three columns (left armour / centre
// accessories / right armour + shield). Every label is original (see SLOT_LABEL).
const SLOT = 40;
const COL_L = PX + 44;
const COL_R = PX + PW - 44;
const COL_C = PX + PW / 2;
const DOLL: Array<[EquipSlot, number, number]> = [
  ['mainhand', COL_L, PY + 64],
  ['head', COL_L, PY + 110],
  ['shoulders', COL_L, PY + 156],
  ['body', COL_L, PY + 202],
  ['offhand', COL_R, PY + 64],
  ['gloves', COL_R, PY + 110],
  ['belt', COL_R, PY + 156],
  ['feet', COL_R, PY + 202],
  ['amulet', COL_C, PY + 86],
  ['ring1', COL_C, PY + 150],
  ['ring2', COL_C, PY + 214],
];

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
  identify: '鉴定随身物品',
  uncurse: '解除装备诅咒',
  lure: '引来附近敌人',
  displace: '随机错位传送',
  dimlight: '视野收窄（目盲）',
};
const POTION_DESC: Record<string, string> = {
  venom: '使自身中毒',
  mist: '使自身混乱',
  scald: '灼烧（火）',
  riftheart: '损血换回复（双刃）',
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
  if (e.potion) parts.push(POTION_DESC[e.potion] ?? '');
  if (e.gold) parts.push(`金币 +${e.gold}`);
  return parts.join('　');
}

const STAT_ORDER: StatKey[] = ['attack', 'defense', 'agility', 'magic', 'maxHp'];

/** A gear instance's *total* equip bonus (base + affixes + enchantment), for display. */
function gearStatLine(inst: ItemInstance): string {
  const b = equipBonus(inst);
  return STAT_ORDER.filter((k) => b[k] !== 0)
    .map((k) => `${STAT_LABEL_CN[k]} ${b[k] > 0 ? '+' : ''}${b[k]}`)
    .join('　');
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
  private selected: ItemInstance | null = null;
  private alive = true;
  /** Persistent DOM buttons (close ✕ / 关闭返回). */
  private staticBtns: HtmlButton[] = [];
  /** DOM hit/action buttons recreated on each rebuild() (slots, cells, action). */
  private dynBtns: HtmlButton[] = [];

  constructor(scene: Phaser.Scene, inv: InventorySystem, handlers: InventoryHandlers) {
    super(scene, 0, 0);
    this.setDepth(1000);
    this.inv = inv;
    this.handlers = handlers;
    // Canvas overlay below the DOM layer — hide the in-game base buttons behind it.
    blockUi();

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

    this.staticBtns.push(
      new HtmlButton(scene, PX + PW - 28, PY + 28, '✕', () => this.handlers.onClose(), { width: 40, height: 36, fontSize: 18, variant: 'ghost', layer: 'modal' }),
      new HtmlButton(scene, GAME_WIDTH / 2, PY + PH - 34, '关闭返回', () => this.handlers.onClose(), { width: 240, height: 46, fontSize: 18, layer: 'modal' }),
    );

    this.content = scene.add.container(0, 0);
    this.add(this.content);

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
    this.rebuild();
  }

  private rebuild(): void {
    this.content.removeAll(true);
    // Recreate the DOM hit/action buttons that track the (rebuilt) canvas content.
    this.dynBtns.forEach((b) => b.destroy());
    this.dynBtns = [];
    const add = (o: Phaser.GameObjects.GameObject): void => {
      this.content.add(o);
    };

    add(
      this.scene.add
        .text(PX + PW - 60, PY + 28, `◇ ${this.inv.gold}`, { fontFamily: FontFamily, fontSize: '15px', color: toCss(Palette.accentBright), fontStyle: 'bold' })
        .setOrigin(1, 0.5),
    );

    // --- equipped slots (paper-doll) -----------------------------------
    for (const [slot, cx, cy] of DOLL) {
      const item = this.inv.equipped[slot];
      this.makeSlot(add, cx, cy, item, SLOT_LABEL[slot], () => {
        if (item) this.afterAction(() => this.handlers.onUnequip(slot));
      });
    }

    const rule = this.scene.add.graphics();
    rule.lineStyle(1, Palette.border, 1);
    rule.lineBetween(PX + 16, GRID_Y - 16, PX + PW - 16, GRID_Y - 16);
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
    item: ItemInstance | null,
    label: string,
    onTap: () => void,
  ): void {
    const def = item ? getItem(item.defId) : null;
    const size = SLOT;
    const g = this.scene.add.graphics();
    g.fillStyle(Palette.panelDown, 1);
    g.fillRoundedRect(cx - size / 2, cy - size / 2, size, size, 7);
    g.lineStyle(2, def ? RARITY_COLOR[def.rarity] : Palette.border, 1);
    g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 7);
    add(g);

    if (def && this.scene.textures.exists('items')) {
      // Filled: just the icon — the column position conveys the slot.
      add(this.scene.add.image(cx, cy, 'items', def.spriteFrame).setScale(1.05));
    } else {
      // Empty: the slot's name sits inside the box, so nothing crowds the rows.
      add(
        this.scene.add
          .text(cx, cy, label, { fontFamily: FontFamily, fontSize: '9px', color: toCss(Palette.textMuted), align: 'center', wordWrap: { width: size - 4 } })
          .setOrigin(0.5),
      );
    }

    // Native DOM hit area over the canvas slot.
    this.dynBtns.push(
      new HtmlButton(this.scene, cx, cy, '', onTap, { width: size, height: size, variant: 'hit', layer: 'modal' }),
    );
  }

  private makeCell(add: (o: Phaser.GameObjects.GameObject) => void, cx: number, cy: number, item: ItemInstance | null): void {
    const def = item ? getItem(item.defId) : null;
    const selected = item !== null && item === this.selected;
    const g = this.scene.add.graphics();
    g.fillStyle(selected ? Palette.panelLight : Palette.panelDown, 1);
    g.fillRoundedRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL, 8);
    g.lineStyle(selected ? 2.5 : 1.5, def ? RARITY_COLOR[def.rarity] : Palette.border, item ? 1 : 0.6);
    g.strokeRoundedRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL, 8);
    add(g);

    if (item && def) {
      if (this.scene.textures.exists('items')) {
        add(this.scene.add.image(cx, cy - 4, 'items', def.spriteFrame).setScale(1.35));
      }
      if (item.quantity > 1) {
        add(
          this.scene.add
            .text(cx + CELL / 2 - 6, cy - CELL / 2 + 6, `${item.quantity}`, { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.accentBright), fontStyle: 'bold' })
            .setOrigin(1, 0),
        );
      }
      add(
        this.scene.add
          .text(cx, cy + CELL / 2 - 9, this.inv.name(item), { fontFamily: FontFamily, fontSize: '9px', color: toCss(selected ? Palette.text : Palette.textDim) })
          .setOrigin(0.5),
      );
      this.dynBtns.push(
        new HtmlButton(this.scene, cx, cy, '', () => {
          this.selected = this.selected === item ? null : item;
          this.rebuild();
        }, { width: CELL, height: CELL, variant: 'hit', layer: 'modal' }),
      );
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

    const def = getItem(item.defId);
    const unidentified = (def.type === 'potion' || def.type === 'scroll') && !this.inv.ident.isIdentified(item.defId);
    add(
      this.scene.add
        .text(left, top, this.inv.name(item), { fontFamily: FontFamily, fontSize: '18px', color: toCss(unidentified ? Palette.textDim : RARITY_COLOR[def.rarity]), fontStyle: 'bold' })
        .setOrigin(0, 0),
    );
    add(
      this.scene.add
        .text(left, top + 26, unidentified ? `${TYPE_NAME[def.type]} · 未鉴定` : `${TYPE_NAME[def.type]} · ${RARITY_NAME[def.rarity]}`, { fontFamily: FontFamily, fontSize: '12px', color: toCss(Palette.textMuted) })
        .setOrigin(0, 0),
    );
    // Flow the description, the effect summary and the action button down from one
    // another (measuring each block) so wrapped text never collides with the button.
    const descText = this.scene.add
      .text(left, top + 48, unidentified ? '尚未鉴定——使用后方知其效，亦可用鉴物卷轴看清。' : def.description, { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.textDim), lineSpacing: 3, wordWrap: { width: PW - 56 } })
      .setOrigin(0, 0);
    add(descText);
    let y = top + 48 + descText.height + 8;
    const gear = equipSlotOf(def) !== null;
    // Gear shows its total rolled bonus (base + affixes + enchant); others their effect.
    const summary = unidentified ? '' : gear ? gearStatLine(item) : effectSummary(def);
    if (summary) {
      const sumText = this.scene.add
        .text(left, y, summary, { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.accent), wordWrap: { width: PW - 56 } })
        .setOrigin(0, 0);
      add(sumText);
      y += sumText.height + 8;
    } else {
      y += 4;
    }
    // Affix names — the heart of the "找到神装" moment, in bright gold.
    if (!unidentified && gear) {
      const affixes = (item.affixes ?? []).map(getAffix).filter((a): a is NonNullable<typeof a> => !!a);
      if (affixes.length) {
        const ax = this.scene.add
          .text(left, y, `词缀　${affixes.map((a) => a.name).join(' · ')}`, { fontFamily: FontFamily, fontSize: '12px', color: toCss(Palette.accentBright), fontStyle: 'bold', wordWrap: { width: PW - 56 } })
          .setOrigin(0, 0);
        add(ax);
        y += ax.height + 6;
        // Rule affixes carry a description (numeric affixes are self-evident from the stat line).
        for (const a of affixes) {
          if (!a.description) continue;
          const dt = this.scene.add
            .text(left, y, `· ${a.name}：${a.description}`, { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.textDim), wordWrap: { width: PW - 56 } })
            .setOrigin(0, 0);
          add(dt);
          y += dt.height + 4;
        }
      }
    }
    y += 4;

    // Primary action (装备 / 使用) plus a 丢弃 to free a full bag — dropped items
    // land at the player's feet and can be picked back up.
    const equippable = equipSlotOf(def) !== null;
    const btnY = y + 22;
    this.dynBtns.push(
      new HtmlButton(this.scene, PX + PW / 2 - 50, btnY, equippable ? '装备' : '使用', () => {
        this.afterAction(() => (equippable ? this.handlers.onEquip(item) : this.handlers.onUse(item)));
      }, {
        width: 156,
        height: 44,
        fontSize: 18,
        variant: 'primary',
        layer: 'modal',
      }),
      new HtmlButton(this.scene, PX + PW / 2 + 90, btnY, '丢弃', () => {
        this.afterAction(() => this.handlers.onDrop(item));
      }, {
        width: 76,
        height: 44,
        fontSize: 16,
        variant: 'ghost',
        layer: 'modal',
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
    this.staticBtns.forEach((b) => b.destroy());
    this.dynBtns.forEach((b) => b.destroy());
    this.staticBtns = [];
    this.dynBtns = [];
    unblockUi();
    super.destroy(fromScene);
  }
}
