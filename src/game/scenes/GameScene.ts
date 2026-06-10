import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { HtmlButton } from '../ui/HtmlButton';
import { Modal } from '../ui/Modal';
import { CONTROLS_TOP, MobileControls } from '../ui/MobileControls';
import { burst, floatNumber, playEffect } from '../ui/Fx';
import { Settings } from '../core/Settings';
import { Player } from '../entities/Player';
import { Monster } from '../entities/Monster';
import { getMonster, monsterLore, spawnPool } from '../data/monsters';
import { CLASSES, getClass, type CharClass, type ClassId } from '../data/classes';
import { SaveManager } from '../core/SaveManager';
import { metaStatBonus } from '../core/Meta';
import type { RunState, SerializedFloor } from '../core/types';
import { RNG } from '../core/RNG';
import { computeFOV } from '../core/FOV';
import { runMonsterTurns, type TurnEvent } from '../core/TurnSystem';
import { resolveAttack, type AttackResult } from '../systems/CombatSystem';
import {
  applyStatus,
  cleanse,
  restoreStatuses,
  serializeStatuses,
  statusDetails,
  statusStrip,
  tickStatuses,
  type StatusType,
} from '../systems/StatusSystem';
import { hasLineOfSight } from '../world/Los';
import {
  blocksSight as tileBlocksSight,
  generateDungeon,
  isClosedDoor,
  isWalkable,
  MAX_DEPTH,
  TILE_SPRITE_KEY,
  TileType,
  type ChestInstance,
  type DungeonMap,
  type TrapInstance,
  type TrapKind,
  type Vec,
} from '../world/Dungeon';
import {
  getAtlas,
  heroAnim,
  heroAvatarFrame,
  monsterAnim,
  monsterByFrame,
  tileByKey,
  type SpriteAtlas,
} from '../assets/atlas';
import { EQUIP_SLOTS, InventorySystem, SLOT_LABEL, type EquipSlot } from '../systems/InventorySystem';
import { InventoryView } from '../ui/InventoryView';
import { GameMenu } from '../ui/GameMenu';
import { MapView } from '../ui/MapView';
import { SettingsView } from '../ui/SettingsView';
import { ChestView } from '../ui/ChestView';
import { AltarView } from '../ui/AltarView';
import { rollChestLoot, rollMonsterDrop, rollShopStock } from '../systems/LootSystem';
import { equipSlotOf, getItem, itemPrice, type PotionAction, type ScrollAction } from '../data/items';
import { ShopView, type ShopEntry } from '../ui/ShopView';
import { deserializeInstance, Identifier, isGear, plainInstance, rollInstance, serializeInstance, type Beatitude, type ItemInstance } from '../systems/ItemInstance';

interface GameSceneData {
  classId?: ClassId;
  resume?: boolean;
}

interface ItemEntity {
  x: number;
  y: number;
  inst: ItemInstance;
  sprite: Phaser.GameObjects.Image;
}

/**
 * Three-way outcome of a player action (0.3 action economy). It lets the unified
 * commit tell apart an action that was never really attempted (no target / no
 * direction → free) from one that was actually performed but whiffed (e.g. a
 * thrown blade that flew but hit nothing → still costs a turn + a charge).
 */
type ActionResult = 'notAttempted' | 'failedAfterAttempt' | 'succeeded';

// Display geometry. Only a window of tiles around the player is ever rendered.
const TILE = 32;
const VIEW_COLS = 13;
const VIEW_ROWS = 23;
const HALF_COLS = (VIEW_COLS - 1) / 2;
const HALF_ROWS = (VIEW_ROWS - 1) / 2;
const PLAY_CX = GAME_WIDTH / 2;
const PLAY_CY = 404;
const HUD_H = 68;
const MOVE_MS = 130;
const CRIT_COLOR = 0xffd24a;
const ELITE_TINT = 0xffcc66;

/** Display names for chest trap kinds (0.3 chest interaction). */
const TRAP_NAME: Record<TrapKind, string> = {
  spike: '尖刺',
  poison: '毒气',
  snare: '索套',
  teleport: '传送',
};

// --- 0.3.10 balance knobs ------------------------------------------------
// Central tuning constants for the values flagged as most likely to need a nudge
// during the balance pass (kept here so they aren't scattered magic numbers).
/** 零环守卫 phase-2 attack bump — softened from +3 so the flip isn't a sudden wall. */
const BOSS_PHASE2_ATTACK = 2;
const BOSS_PHASE2_AGILITY = 2;
/** Heal/turn the boss regenerates for 6 turns after flipping. */
const BOSS_PHASE2_REGEN = 2;
/** 断链狂徒 low-HP regen power — softened from 2 to curb the sustain-stacking flagged in phase 8. */
const RAGE_REGEN_POWER = 1;

/** Log lines shown when a player status wears off (0.3 input-layer feedback). */
const STATUS_RECOVERY: Partial<Record<StatusType, string>> = {
  frozen: '冰霜消融，你重新能够行动。',
  slowed: '迟缓散去，脚步恢复轻快。',
  confused: '眩晕退去，你的方向感恢复了。',
  feared: '你重新镇定下来。',
  vulnerable: '易伤的虚弱褪去了。',
  poisoned: '毒素终于散尽。',
  burning: '身上的火焰熄灭了。',
  blinded: '昏翳散去，视野重新开阔。',
};

/** Log fragment when a monster's on-hit attack lands a status (0.3.1). */
const ONHIT_FLAVOR: Partial<Record<StatusType, string>> = {
  frozen: '的寒息冻住了你的动作！',
  confused: '的孢子让你头晕目眩。',
  feared: '的尖啸攫住你的心神。',
  burning: '的炽焰点燃了你！',
  slowed: '的黏丝缠住了你的脚步。',
  vulnerable: '的酸液腐蚀着你，伤口更易撕裂。',
  poisoned: '的毒液渗入了你的伤口。',
};

const TILE_COLOR: Record<TileType, number> = {
  [TileType.Wall]: Palette.wall,
  [TileType.Floor]: Palette.floor,
  [TileType.Door]: 0x8a5a32,
  [TileType.StairsDown]: Palette.accent,
  [TileType.Trap]: Palette.danger,
  [TileType.Chest]: 0xd0a838,
  [TileType.ChestOpen]: 0x8a6a28,
  [TileType.DoorClosed]: 0x6e4626,
  [TileType.DoorLocked]: 0x9a5a2a,
};

const TILE_DESC: Record<TileType, string> = {
  [TileType.Wall]: '石墙',
  [TileType.Floor]: '空地',
  [TileType.Door]: '敞开的门',
  [TileType.StairsDown]: '向下的阶梯',
  [TileType.Trap]: '显露的陷阱',
  [TileType.Chest]: '未开启的宝箱',
  [TileType.ChestOpen]: '已开启的宝箱',
  [TileType.DoorClosed]: '关闭的门',
  [TileType.DoorLocked]: '上锁的门',
};

/**
 * The playable scene: a 40×40 dungeon with a player-centred viewport, smooth
 * tile-by-tile movement, fog of war, and turn-based combat. After each player
 * action the monsters take a turn (move / attack / wander) via TurnSystem.
 */
export class GameScene extends Phaser.Scene {
  private cls!: CharClass;
  private player!: Player;
  private rng!: RNG;
  private map!: DungeonMap;
  private depth = 1;
  private turn = 0;
  private createdAt = 0;
  private busy = false;

  private atlas: SpriteAtlas | null = null;
  private heroKey = 'knight';
  private usesTiles = false;
  private frameByType!: Record<TileType, number>;

  private tileLayer!: Phaser.GameObjects.Container;
  private pool: Phaser.GameObjects.Image[][] = [];
  private playerSprite!: Phaser.GameObjects.Sprite;

  /** Vision radius (default 8); the lamp-bearing wanderer sees a little farther. */
  private radius = 8;
  private monsters: Monster[] = [];
  private monsterSprites = new Map<Monster, Phaser.GameObjects.Sprite>();
  private items: ItemEntity[] = [];

  private inventory!: InventorySystem;
  private invView?: InventoryView;
  private mapView?: MapView;
  private settingsView?: SettingsView;
  private shopView?: ShopView;
  private chestView?: ChestView;
  private altarView?: AltarView;
  /** Special-room ambiance lines already shown this floor (keyed by room origin). */
  private announcedRooms = new Set<string>();
  /** The floor's merchant (absent on the boss floor); stock is part of the seed. */
  private merchant?: { x: number; y: number; sprite: Phaser.GameObjects.Sprite };
  private shopStock: ShopEntry[] = [];
  /** 商路 meta unlock (phase 9): the merchant carries an extra slot + exotic wares. */
  private tradeRoutes = false;
  /** Seed of the current floor (persisted so resume rebuilds the same layout). */
  private floorSeed = 0;
  /** A saved floor snapshot to restore on resume (set in create, consumed once). */
  private pendingFloor?: SerializedFloor;
  private menuOpen = false;
  private gameOver = false;

  // --- 0.2 skill / ability state (reset each floor) ----------------------
  /** Remaining per-floor charges for limited active skills. */
  private skillUses = 0;
  /** 环骑士: whether 环誓 death-save has fired on this floor. */
  private ringOathUsed = false;
  /** 折光 affix: spent on the first ranged hit each floor (phase 7). */
  private refractUsed = false;
  /** 蓄盐 affix: charge built per turn, spent to amplify the next active skill. */
  private saltCharge = 0;
  /** The saltcharge bonus threaded into the skill currently being cast. */
  private skillSaltBonus = 0;
  /** 铁拳僧 combo: current target + stack count. */
  private comboTarget: Monster | null = null;
  private comboCount = 0;
  /** Direction-pick (aim) mode for targeted skills. */
  private aiming = false;
  private aimPick: ((dx: number, dy: number) => void) | null = null;
  private dirButtons: HtmlButton[] = [];

  private kills = 0;
  private deathCause = '环窟的危险';
  private animScale = 1;
  private travelPath: Vec[] = [];
  private travelDest: Vec | null = null;
  private travelMarker?: Phaser.GameObjects.Image;

  private depthText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private fxText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private logLines: string[] = [];

  constructor() {
    super(SceneKeys.Game);
  }

  create(data: GameSceneData): void {
    this.cameras.main.setBackgroundColor(Palette.bgDeep);
    this.busy = false;
    this.menuOpen = false;
    this.gameOver = false;
    this.invView = undefined;
    this.mapView = undefined;
    this.settingsView = undefined;
    this.shopView = undefined;
    this.chestView = undefined;
    this.altarView = undefined;
    this.announcedRooms = new Set();
    this.logLines = [];
    this.atlas = getAtlas(this);

    let classId: ClassId;
    if (data.resume) {
      const run = SaveManager.loadRun();
      if (!run) {
        this.scene.start(SceneKeys.MainMenu);
        return;
      }
      this.player = Player.fromRun(run);
      // Negative/positive statuses survive a save round-trip now (0.3) — a poisoned
      // hero stays poisoned after 继续游戏 (old saves had none → empty list).
      this.player.statuses = restoreStatuses(run.playerStatuses);
      this.depth = run.depth;
      this.turn = run.turn;
      this.createdAt = run.createdAt;
      classId = run.classId;
      const ident = new Identifier();
      ident.restore(run.ident);
      this.inventory = new InventorySystem(this.player, ident);
      this.inventory.restore(run.gold, run.bag, run.equip);
      this.kills = run.kills;
      // Reuse the saved floor seed so the resumed layout matches what was left.
      this.floorSeed = run.floorSeed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
      // A full snapshot restores the exact floor state; older saves fall back to
      // regenerating from the seed (same layout, but the floor restarts).
      this.pendingFloor = run.floor;
    } else {
      classId = data.classId ?? CLASSES[0].id;
      this.player = Player.fromClass(getClass(classId));
      this.depth = 1;
      this.turn = 0;
      this.createdAt = Date.now();
      const ident = new Identifier(new RNG((Math.floor(Math.random() * 0xffffffff)) >>> 0));
      this.inventory = new InventorySystem(this.player, ident);
      this.grantStartingItems(getClass(classId));
      // Permanent legacy upgrades at the start of a new run. The *vertical* stat bonuses
      // are skipped in 纯净模式 (phase 9); the horizontal 商路 unlock applies regardless
      // (it's set below, for both new and resumed runs).
      if (!Settings.get().classicMode) {
        const b = metaStatBonus(SaveManager.getMeta().upgrades);
        if (b.maxHp) {
          this.player.maxHp += b.maxHp;
          this.player.hp = this.player.maxHp;
        }
        this.player.attack += b.attack;
        if (b.gold) this.inventory.addGold(b.gold);
        for (let i = 0; i < b.potions; i++) this.inventory.add(plainInstance('heal_potion'));
      }
      this.kills = 0;
      this.floorSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    }

    // 商路 unlock is player-wide (not a run stat) — read it for new AND resumed runs.
    this.tradeRoutes = (SaveManager.getMeta().upgrades.tradeRoutes ?? 0) >= 1;

    this.cls = getClass(classId);
    this.heroKey = this.cls.hero;
    this.radius = this.cls.id === 'copperlamp-wanderer' ? 10 : 8;

    this.rng = new RNG((Math.floor(Math.random() * 0xffffffff) ^ Math.imul(this.depth, 0x9e3779b1)) >>> 0);
    this.deathCause = '环窟的危险';
    this.animScale = Settings.animScale();

    this.buildFrameMap();
    this.buildViewport();
    this.buildPlayer();
    this.buildHud();
    this.buildControls();
    this.bindKeyboard();
    this.buildInspectZone();

    const restored = !!this.pendingFloor;
    if (restored) {
      this.restoreFloor(this.pendingFloor!);
      this.pendingFloor = undefined;
    } else {
      this.loadFloor();
    }
    this.updateHud();
    this.persist();
    this.pushLog(
      restored
        ? `你回到了环窟第 ${this.depth} 层，旅程继续。`
        : this.depth >= MAX_DEPTH
          ? `你踏入环窟最深处——第 ${this.depth} 层。`
          : `你踏入了环窟的第 ${this.depth} 层。`,
    );
  }

  /**
   * Equip a fresh hero with its class kit (req. phase 1). Gold-type entries add
   * coins; the best weapon/armor/accessory is auto-worn so the kit is ready. Falls
   * back to a basic potion + bread if a class somehow lists nothing.
   */
  private grantStartingItems(cls: CharClass): void {
    const ids = cls.startingItems.length ? cls.startingItems : ['heal_potion', 'bread'];
    for (const id of ids) {
      const def = getItem(id);
      if (def.type === 'gold') {
        this.inventory.addGold(def.effects.gold ?? 0);
        continue;
      }
      this.inventory.add(plainInstance(id));
      // A hero knows their own starting potions / scrolls.
      if (def.type === 'potion' || def.type === 'scroll') this.inventory.ident.identify(id);
    }
    // Auto-wear every starting gear piece (the inventory routes it to its slot).
    for (const inst of [...this.inventory.items]) {
      if (equipSlotOf(getItem(inst.defId))) this.inventory.equip(inst);
    }
  }

  /** Generate the current floor: map, monsters, items, and the boss on floor 5. */
  private loadFloor(): void {
    this.stopTravel();
    this.exitAim();
    // Per-floor ability bookkeeping resets on every descent.
    this.skillUses = this.cls.skill.usesPerFloor ?? 0;
    this.ringOathUsed = false;
    this.refractUsed = false; // 折光 re-arms each floor
    this.saltCharge = 0;
    this.comboTarget = null;
    this.comboCount = 0;
    this.announcedRooms = new Set(); // special-room ambiance re-arms on a new floor
    this.monsterSprites.forEach((s) => s.destroy());
    this.monsterSprites.clear();
    this.monsters = [];
    this.items.forEach((e) => e.sprite.destroy());
    this.items = [];
    this.merchant?.sprite.destroy();
    this.merchant = undefined;
    this.shopStock = [];

    // Seed generation from the (persisted) floor seed so a resumed run rebuilds
    // the identical layout, monsters and loot rather than a fresh floor.
    this.rng = new RNG(this.floorSeed >>> 0);
    this.map = generateDungeon(this.depth, this.rng);
    this.player.x = this.map.spawn.x;
    this.player.y = this.map.spawn.y;
    this.buildMonsters();
    this.buildItems();
    if (this.depth >= MAX_DEPTH) this.spawnBoss();
    else this.placeMerchant();
    this.updateFOV();
    this.refresh();
  }

  /** Capture the full current floor so 继续游戏 can restore it exactly (0.3). */
  private snapshotFloor(): SerializedFloor {
    return {
      px: this.player.x,
      py: this.player.y,
      tiles: this.map.tiles.map((row) => row.slice()),
      explored: this.map.explored.map((row) => row.map((b) => (b ? 1 : 0))),
      spawn: { ...this.map.spawn },
      stairs: { ...this.map.stairsDown },
      traps: this.map.traps.map((t) => ({ x: t.x, y: t.y, kind: t.kind, hidden: t.hidden })),
      chests: this.map.chests.map((c) => ({
        x: c.x, y: c.y, opened: c.opened, locked: c.locked, trapped: c.trapped,
        trapDiscovered: c.trapDiscovered, trapType: c.trapType, lootGenerated: c.lootGenerated,
        altar: c.altar,
      })),
      monsters: this.monsters.map((m) => ({
        key: m.id, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, attack: m.attack, exp: m.exp,
        elite: m.elite, name: m.name, skipNext: m.skipNext, phase2: m.phase2, spawnedSplit: m.spawnedSplit,
        statuses: serializeStatuses(m),
        stolenGold: m.stolenGold, warningShown: m.warningShown, lowHpWarned: m.lowHpWarned,
        anchorX: m.anchorX, anchorY: m.anchorY,
      })),
      items: this.items.map((e) => ({ inst: serializeInstance(e.inst), x: e.x, y: e.y })),
      merchant: this.merchant
        ? { x: this.merchant.x, y: this.merchant.y, stock: this.shopStock.map((s) => ({ inst: serializeInstance(s.inst), price: s.price, sold: s.sold })) }
        : null,
      skillUses: this.skillUses,
      ringOathUsed: this.ringOathUsed,
    };
  }

  /** Rebuild the floor from a snapshot — the exact state the player left behind. */
  private restoreFloor(s: SerializedFloor): void {
    this.stopTravel();
    this.exitAim();
    this.comboTarget = null;
    this.comboCount = 0;
    this.skillUses = s.skillUses;
    this.ringOathUsed = s.ringOathUsed;
    this.refractUsed = false; // affix per-floor flags reset on resume (slightly generous)
    this.saltCharge = 0;
    this.monsterSprites.forEach((sp) => sp.destroy());
    this.monsterSprites.clear();
    this.monsters = [];
    this.items.forEach((e) => e.sprite.destroy());
    this.items = [];
    this.merchant?.sprite.destroy();
    this.merchant = undefined;
    this.shopStock = [];

    const height = s.tiles.length;
    const width = s.tiles[0]?.length ?? 0;
    const visible: boolean[][] = [];
    for (let y = 0; y < height; y++) visible.push(new Array(width).fill(false));
    this.map = {
      width,
      height,
      tiles: s.tiles.map((row) => row.slice()),
      rooms: [],
      spawn: { ...s.spawn },
      stairsDown: { ...s.stairs },
      explored: s.explored.map((row) => row.map((n) => n === 1)),
      visible,
      monsters: [],
      items: [],
      traps: s.traps.map((t) => ({ x: t.x, y: t.y, kind: t.kind as TrapInstance['kind'], hidden: t.hidden })),
      chests: s.chests.map((c) => ({
        x: c.x, y: c.y, opened: c.opened, locked: c.locked, trapped: c.trapped,
        trapDiscovered: c.trapDiscovered ?? false,
        trapType: c.trapType as TrapKind | undefined,
        lootGenerated: c.lootGenerated ?? false,
        altar: c.altar ?? false,
      })),
    };
    this.player.x = s.px;
    this.player.y = s.py;

    const hasTex = this.textures.exists('monsters');
    for (const ms of s.monsters) {
      const def = getMonster(ms.key);
      const m = new Monster(def, ms.x, ms.y);
      m.hp = ms.hp;
      m.maxHp = ms.maxHp;
      m.attack = ms.attack;
      m.exp = ms.exp;
      m.name = ms.name;
      m.elite = ms.elite;
      m.skipNext = ms.skipNext;
      m.phase2 = ms.phase2;
      m.spawnedSplit = ms.spawnedSplit;
      m.statuses = restoreStatuses(ms.statuses); // poison/fear/etc. survive resume (0.3)
      // Trait runtime state survives resume too; older saves lack it → safe defaults.
      m.stolenGold = ms.stolenGold ?? 0;
      m.warningShown = ms.warningShown ?? false;
      m.lowHpWarned = ms.lowHpWarned ?? false;
      m.anchorX = ms.anchorX;
      m.anchorY = ms.anchorY;
      this.monsters.push(m);
      if (!hasTex) continue;
      const sprite = this.add.sprite(0, 0, 'monsters', def.spriteFrame).setVisible(false);
      const design = this.atlas ? monsterByFrame(this.atlas, def.spriteFrame) : null;
      if (design && this.anims.exists(monsterAnim(design.key, 'idle'))) sprite.play(monsterAnim(design.key, 'idle'));
      if (m.boss) sprite.setScale(1.45);
      else if (m.elite) {
        sprite.setScale(1.3).setTint(ELITE_TINT);
        sprite.setData('tint', ELITE_TINT);
      }
      this.tileLayer.add(sprite);
      this.monsterSprites.set(m, sprite);
    }

    for (const it of s.items) {
      this.placeFloorItem(deserializeInstance(it.inst), it.x, it.y, false);
    }

    if (s.merchant) {
      this.shopStock = s.merchant.stock.map((e) => ({ inst: deserializeInstance(e.inst), price: e.price, sold: e.sold }));
      const hasHeroes = this.textures.exists('heroes') && this.atlas !== null;
      const frame = hasHeroes ? heroAvatarFrame(this.atlas!, 'alchemist') : undefined;
      const sprite = this.add.sprite(0, 0, hasHeroes ? 'heroes' : 'zr-px', frame).setScale(1.2).setVisible(false);
      if (hasHeroes && this.anims.exists(heroAnim('alchemist', 'idle'))) sprite.play(heroAnim('alchemist', 'idle'));
      this.tileLayer.add(sprite);
      this.merchant = { x: s.merchant.x, y: s.merchant.y, sprite };
    }

    this.updateFOV();
    this.refresh();
  }

  /** Place the final-floor boss (零环守卫) where the stairs would be. */
  private spawnBoss(): void {
    const def = getMonster('ringwarden');
    const { x, y } = this.map.stairsDown;
    this.map.tiles[y][x] = TileType.Floor; // the boss replaces the way down
    const boss = new Monster(def, x, y);
    this.monsters.push(boss);
    if (this.textures.exists('monsters')) {
      const sprite = this.add.sprite(0, 0, 'monsters', def.spriteFrame).setScale(1.45).setVisible(false);
      const design = this.atlas ? monsterByFrame(this.atlas, def.spriteFrame) : null;
      if (design && this.anims.exists(monsterAnim(design.key, 'idle'))) sprite.play(monsterAnim(design.key, 'idle'));
      this.tileLayer.add(sprite);
      this.monsterSprites.set(boss, sprite);
    }
    this.pushLog('一股威压自深处传来——零环守卫盘踞在这一层。');
  }

  /** Descend to the next floor (via the 下楼 button while on the stairs). */
  private descend(): void {
    if (this.busy || this.menuOpen) return;
    if (this.map.tiles[this.player.y][this.player.x] !== TileType.StairsDown) {
      this.pushLog('脚下没有向下的阶梯。');
      return;
    }
    if (this.depth >= MAX_DEPTH) return;
    this.busy = true;
    this.depth += 1;
    // A new floor gets its own fresh seed (persisted on arrival below).
    this.floorSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const cam = this.cameras.main;
    cam.fadeOut(240, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.loadFloor();
      this.updateHud();
      this.persist();
      this.pushLog(
        this.depth >= MAX_DEPTH
          ? `你来到环窟最深处——第 ${this.depth} 层。`
          : `你拾级而下，来到第 ${this.depth} 层。`,
      );
      cam.fadeIn(260, 0, 0, 0);
      this.busy = false;
    });
  }

  // --- setup -------------------------------------------------------------

  private buildFrameMap(): void {
    // Fallback indices for the no-atlas case (door now has closed[0] + open[1]).
    this.frameByType = {
      [TileType.Wall]: 0,
      [TileType.Floor]: 1,
      [TileType.Door]: 3, // open doorway
      [TileType.StairsDown]: 4,
      [TileType.Trap]: 5,
      [TileType.Chest]: 7,
      [TileType.ChestOpen]: 8,
      [TileType.DoorClosed]: 2, // closed door
      [TileType.DoorLocked]: 2,
    };
    if (!this.atlas) return;
    for (const t of [
      TileType.Wall,
      TileType.Floor,
      TileType.Door,
      TileType.StairsDown,
      TileType.Trap,
      TileType.Chest,
      TileType.DoorClosed,
      TileType.DoorLocked,
    ]) {
      const entry = tileByKey(this.atlas, TILE_SPRITE_KEY[t]);
      if (entry) this.frameByType[t] = entry.frames[0];
    }
    const door = tileByKey(this.atlas, 'door');
    if (door && door.frames.length > 1) this.frameByType[TileType.Door] = door.frames[1];
    const chest = tileByKey(this.atlas, 'chest');
    if (chest && chest.frames.length > 1) this.frameByType[TileType.ChestOpen] = chest.frames[1];
  }

  private buildViewport(): void {
    this.usesTiles = this.textures.exists('tiles');
    if (!this.usesTiles && !this.textures.exists('zr-px')) {
      const g = this.make.graphics();
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 1, 1);
      g.generateTexture('zr-px', 1, 1);
      g.destroy();
    }
    const texKey = this.usesTiles ? 'tiles' : 'zr-px';

    this.tileLayer = this.add.container(PLAY_CX, PLAY_CY).setDepth(1);
    this.pool = [];
    for (let j = 0; j < VIEW_ROWS; j++) {
      const row: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < VIEW_COLS; i++) {
        const img = this.add.image((i - HALF_COLS) * TILE, (j - HALF_ROWS) * TILE, texKey, this.usesTiles ? 0 : undefined);
        img.setDisplaySize(TILE, TILE);
        this.tileLayer.add(img);
        row.push(img);
      }
      this.pool.push(row);
    }
  }

  /** Spawn live Monster entities from the map, each with an animated sprite. */
  private buildMonsters(): void {
    this.monsters = [];
    this.monsterSprites.clear();
    const hasTex = this.textures.exists('monsters');
    // Elites grow more common with depth; deterministic from the floor seed.
    const eliteChance = Math.min(0.22, 0.04 + this.depth * 0.025);
    for (const mob of this.map.monsters) {
      const def = getMonster(mob.key);
      const monster = new Monster(def, mob.x, mob.y);
      if (!def.boss && this.rng.chance(eliteChance)) monster.makeElite(this.depth);
      if (monster.hasTrait('guardsTreasure') && !monster.boss) this.assignAnchor(monster);
      this.monsters.push(monster);
      if (!hasTex) continue;
      const sprite = this.add.sprite(0, 0, 'monsters', def.spriteFrame).setVisible(false);
      const design = this.atlas ? monsterByFrame(this.atlas, def.spriteFrame) : null;
      if (design && this.anims.exists(monsterAnim(design.key, 'idle'))) sprite.play(monsterAnim(design.key, 'idle'));
      if (monster.elite) {
        // A golden tint + larger silhouette flags the threat; stored so the hit
        // flash can restore it after clearing the white flash.
        sprite.setScale(1.3).setTint(ELITE_TINT);
        sprite.setData('tint', ELITE_TINT);
      }
      this.tileLayer.add(sprite);
      this.monsterSprites.set(monster, sprite);
    }
  }

  /**
   * Pin a guardsTreasure monster to a post for the AI leash: the nearest chest
   * within 5 tiles (so it guards actual loot), else its own spawn tile. Greedy
   * return-to-anchor only steps onto walkable tiles, so it never wedges in a wall.
   */
  private assignAnchor(m: Monster): void {
    let ax = m.x;
    let ay = m.y;
    let best = 6;
    for (const c of this.map.chests) {
      const d = Math.max(Math.abs(c.x - m.x), Math.abs(c.y - m.y));
      if (d <= 5 && d < best) {
        best = d;
        ax = c.x;
        ay = c.y;
      }
    }
    m.anchorX = ax;
    m.anchorY = ay;
  }

  private buildItems(): void {
    this.items = [];
    if (!this.textures.exists('items')) return;
    for (const it of this.map.items) {
      this.spawnItem(it.key, it.x, it.y, false);
    }
  }

  /** Spawn a freshly-rolled item entity on the map (drops, chest loot, floor loot). */
  private spawnItem(id: string, x: number, y: number, redraw = true, qualityDepth = this.depth): void {
    this.placeFloorItem(rollInstance(id, this.rng, qualityDepth), x, y, redraw);
  }

  /**
   * Place an existing instance on the floor, relocating off a wall or an occupied
   * tile to the nearest reachable floor (0.3.1 fix: a phaser/穿墙怪 that dies *inside*
   * a wall used to drop loot the player could never reach).
   */
  private placeFloorItem(inst: ItemInstance, x: number, y: number, redraw = true): void {
    const { x: tx, y: ty } = this.nearestDropTile(x, y);
    const def = getItem(inst.defId);
    const sprite = this.add.image(0, 0, 'items', def.spriteFrame).setScale(0.85).setVisible(false);
    this.tileLayer.add(sprite);
    this.items.push({ x: tx, y: ty, inst, sprite });
    if (redraw) this.renderEntities();
  }

  /**
   * The nearest walkable, unoccupied tile to (x, y) — BFS outward (passing *through*
   * walls) so loot dropped inside a wall ends up on reachable floor (0.3.1).
   */
  private nearestDropTile(x: number, y: number): Vec {
    const ok = (ax: number, ay: number): boolean =>
      ax >= 0 && ay >= 0 && ax < this.map.width && ay < this.map.height &&
      isWalkable(this.map.tiles[ay][ax]) && !this.items.some((e) => e.x === ax && e.y === ay);
    if (ok(x, y)) return { x, y };
    const W = this.map.width;
    const seen = new Set<number>([y * W + x]);
    const queue: Vec[] = [{ x, y }];
    for (let head = 0; head < queue.length && head < 600; head++) {
      const cur = queue[head];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.map.height) continue;
        const k = ny * W + nx;
        if (seen.has(k)) continue;
        seen.add(k);
        if (ok(nx, ny)) return { x: nx, y: ny };
        queue.push({ x: nx, y: ny }); // keep expanding through walls toward floor
      }
    }
    return { x, y }; // fallback (no floor found — should never happen)
  }

  /** Place the floor's merchant in a non-spawn room with a seeded stock of wares. */
  private placeMerchant(): void {
    const occupied = (x: number, y: number): boolean =>
      this.items.some((e) => e.x === x && e.y === y) ||
      (x === this.map.stairsDown.x && y === this.map.stairsDown.y) ||
      (x === this.map.spawn.x && y === this.map.spawn.y);
    // The merchant-vault template pins the spot (a locked 密室); else pick a room.
    const vault = !!this.map.merchantVault;
    let mx: number;
    let my: number;
    if (this.map.merchantHint) {
      mx = this.map.merchantHint.x;
      my = this.map.merchantHint.y;
    } else {
      const candidates = this.map.rooms.filter(
        (r) => !(r.cx === this.map.spawn.x && r.cy === this.map.spawn.y),
      );
      if (!candidates.length) return;
      const room = candidates[this.rng.range(0, candidates.length - 1)];
      mx = room.cx;
      my = room.cy;
    }
    if (occupied(mx, my)) {
      const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        .map(([dx, dy]) => [mx + dx, my + dy] as [number, number])
        .find(
          ([ax, ay]) =>
            ay >= 0 && ax >= 0 && ay < this.map.height && ax < this.map.width &&
            isWalkable(this.map.tiles[ay][ax]) && !occupied(ax, ay),
        );
      if (!free) return;
      [mx, my] = free;
    }
    // Seeded stock so a resumed floor shows the same wares. Gear has a chance to
    // be a rolled (affixed / enchanted / blessed) piece — better wares cost more.
    // A vault stocks deeper-rolled, more often-magical wares — at a premium (phase 6).
    // 商路 (phase 9) adds an extra slot and opens the exotic pool (buying choice).
    const stockDepth = vault ? this.depth + 2 : this.depth;
    const gearChance = vault ? 0.75 : 0.5;
    const priceMult = vault ? 1.4 : 1;
    const slots = 5 + (this.tradeRoutes ? 1 : 0);
    this.shopStock = rollShopStock(stockDepth, this.rng, slots, this.tradeRoutes).map((id) => {
      const def = getItem(id);
      let inst: ItemInstance;
      if (isGear(def.type) && this.rng.chance(gearChance)) {
        inst = rollInstance(id, this.rng, stockDepth + 1);
        inst.identified = true; // the merchant's gear is appraised
        if (inst.beatitude === 'cursed') {
          inst.beatitude = 'uncursed';
          if (inst.enchantment < 0) inst.enchantment = 0;
        }
      } else {
        inst = plainInstance(id);
      }
      const affixCount = inst.affixes?.length ?? 0;
      const premium = affixCount * 18 + Math.max(0, inst.enchantment) * 8 + (inst.beatitude === 'blessed' ? 12 : 0);
      return { inst, price: Math.round((itemPrice(def, this.depth) + premium) * priceMult), sold: false };
    });
    const hasHeroes = this.textures.exists('heroes') && this.atlas !== null;
    const frame = hasHeroes ? heroAvatarFrame(this.atlas!, 'alchemist') : undefined;
    const sprite = this.add.sprite(0, 0, hasHeroes ? 'heroes' : 'zr-px', frame).setScale(1.2).setVisible(false);
    if (hasHeroes && this.anims.exists(heroAnim('alchemist', 'idle'))) sprite.play(heroAnim('alchemist', 'idle'));
    this.tileLayer.add(sprite);
    this.merchant = { x: mx, y: my, sprite };
  }

  private buildPlayer(): void {
    const hasHeroes = this.textures.exists('heroes') && this.atlas !== null;
    const frame = hasHeroes ? heroAvatarFrame(this.atlas!, this.cls.hero) : undefined;
    this.playerSprite = this.add
      .sprite(PLAY_CX, PLAY_CY, hasHeroes ? 'heroes' : 'zr-px', frame)
      .setDepth(5);
    if (hasHeroes) {
      this.playerSprite.setScale(1.25);
      if (this.anims.exists(heroAnim(this.heroKey, 'idle'))) this.playerSprite.play(heroAnim(this.heroKey, 'idle'));
    } else {
      this.playerSprite.setDisplaySize(24, 24).setTint(this.cls.color);
    }
  }

  private buildHud(): void {
    const hud = this.add.container(0, 0).setDepth(20);

    const frame = this.add.graphics();
    frame.fillStyle(Palette.bgDeep, 0.96);
    frame.fillRect(0, 0, GAME_WIDTH, HUD_H);
    frame.lineStyle(1, Palette.border, 1);
    frame.lineBetween(0, HUD_H, GAME_WIDTH, HUD_H);
    hud.add(frame);

    if (this.textures.exists('heroes') && this.atlas) {
      hud.add(this.add.image(20, 32, 'heroes', heroAvatarFrame(this.atlas, this.cls.hero)).setScale(1.05));
    }

    hud.add(
      this.add
        .text(42, 18, this.cls.name, { fontFamily: FontFamily, fontSize: '16px', color: toCss(this.cls.color), fontStyle: 'bold' })
        .setOrigin(0, 0.5),
    );
    this.depthText = this.add
      .text(316, 18, '', { fontFamily: FontFamily, fontSize: '14px', color: toCss(Palette.accent), fontStyle: 'bold' })
      .setOrigin(1, 0.5);
    hud.add(this.depthText);

    this.hpBar = this.add.graphics();
    hud.add(this.hpBar);
    this.hpText = this.add
      .text(42 + 137, 40, '', { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.white), fontStyle: 'bold' })
      .setOrigin(0.5);
    hud.add(this.hpText);

    // Mana + active-status strip, tucked into the right gutter beside the bar.
    this.fxText = this.add
      .text(GAME_WIDTH - 8, 40, '', { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.cool), fontStyle: 'bold' })
      .setOrigin(1, 0.5);
    hud.add(this.fxText);

    this.statusText = this.add
      .text(12, 58, '', { fontFamily: FontFamily, fontSize: '12px', color: toCss(Palette.textDim), wordWrap: { width: GAME_WIDTH - 24 } })
      .setOrigin(0, 0.5);
    hud.add(this.statusText);

    new HtmlButton(this, 360, 20, '菜单', () => this.openMenu(), {
      width: 52,
      height: 26,
      fontSize: 13,
      variant: 'ghost',
    });
  }

  private buildControls(): void {
    new MobileControls(this, {
      onSkill: () => this.onSkill(),
      onSearch: () => this.onSearch(),
      onWait: () => this.onWait(),
      onInventory: () => this.onInventory(),
      onCharacter: () => this.onCharacter(),
      onLog: () => this.onLog(),
      onDescend: () => this.onDescend(),
    });
  }

  private bindKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const bind = (keys: string, dx: number, dy: number): void => {
      keys.split(',').forEach((k) =>
        kb.on(`keydown-${k}`, () => {
          if (this.aiming) {
            this.resolveAim(dx, dy);
            return;
          }
          this.stopTravel();
          this.tryMove(dx, dy);
        }),
      );
    };
    bind('UP,W', 0, -1);
    bind('DOWN,S', 0, 1);
    bind('LEFT,A', -1, 0);
    bind('RIGHT,D', 1, 0);
  }

  /** Scale a base animation duration by the player's speed setting. */
  private ms(base: number): number {
    return Math.round(base * this.animScale);
  }

  /** Tapping the map area reports what occupies that tile (req. 8). */
  private buildInspectZone(): void {
    const top = HUD_H;
    const h = CONTROLS_TOP - HUD_H;
    const zone = this.add.zone(GAME_WIDTH / 2, top + h / 2, GAME_WIDTH, h).setInteractive().setDepth(2);
    let downX = 0;
    let downY = 0;
    // Pointer x/y are in canvas-buffer pixels (high-DPI buffer is GAME_*×SUPERSAMPLE),
    // so map back to the 390×844 design space via the camera before any tile math.
    const logical = (p: Phaser.Input.Pointer): Phaser.Math.Vector2 =>
      this.cameras.main.getWorldPoint(p.x, p.y);
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const w = logical(p);
      downX = w.x;
      downY = w.y;
    });
    zone.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.menuOpen || this.gameOver || this.aiming) return;
      const w = logical(p);
      // Only treat clearly-moved pointers as drags; a generous slop keeps touch
      // taps (which always jitter a little) from being ignored.
      if (Math.abs(w.x - downX) > 24 || Math.abs(w.y - downY) > 24) return;
      // A tap while moving / travelling cancels the current trip.
      if (this.busy) {
        if (this.travelPath.length) this.stopTravel();
        return;
      }
      const tx = this.player.x + Math.round((w.x - PLAY_CX) / TILE);
      const ty = this.player.y + Math.round((w.y - PLAY_CY) / TILE);
      // Long-press inspects the tile; a quick tap walks there.
      if (p.upTime - p.downTime > 380) this.describeTile(tx, ty);
      else this.travelTo(tx, ty);
    });
  }

  private describeTile(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return;
    // Long-pressing an adjacent open door closes it (req. phase 7).
    if (this.map.tiles[y][x] === TileType.Door && this.tryCloseDoor(x, y)) return;
    if (!this.map.explored[y][x]) {
      this.pushLog('那里仍笼罩在黑暗中。');
      return;
    }
    if (this.merchant && this.merchant.x === x && this.merchant.y === y) {
      this.pushLog('〔此处〕一位游商歇脚于此——走近便可交易（以金币购物）。');
      return;
    }
    const visible = this.map.visible[y][x];
    const parts: string[] = [];
    let lore = '';
    if (visible) {
      const mob = this.monsters.find((m) => !m.isDead && !m.dying && m.x === x && m.y === y);
      if (mob) {
        parts.push(`${mob.name}（${mob.hp}/${mob.maxHp}）`);
        // 图鉴: if this kind has been slain before, surface a short lore hint (phase 9).
        if (SaveManager.hasSeen(mob.id)) lore = `〔图鉴〕${mob.name}：${monsterLore(getMonster(mob.id))}`;
      }
      const item = this.items.find((e) => e.x === x && e.y === y);
      if (item) parts.push(this.inventory.name(item.inst));
    }
    parts.push(TILE_DESC[this.map.tiles[y][x]]);
    this.pushLog(`〔此处〕${parts.join('，')}${visible ? '' : '（记忆中）'}`);
    if (lore) this.pushLog(lore);
  }

  // --- tap-to-move (path travel) ----------------------------------------

  /** Walk toward a tapped tile (or attack/step if it is adjacent). */
  private travelTo(tx: number, ty: number): void {
    if (tx === this.player.x && ty === this.player.y) return;
    const dx = tx - this.player.x;
    const dy = ty - this.player.y;
    // Adjacent tap: a single step — which tryMove resolves into an attack, an
    // open/kick of a door, a trap disarm, or a plain move.
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const inb = tx >= 0 && ty >= 0 && tx < this.map.width && ty < this.map.height;
      const t = inb ? this.map.tiles[ty][tx] : TileType.Wall;
      if (this.monsterAt(tx, ty) || (inb && (isWalkable(t) || isClosedDoor(t)))) {
        this.tryMove(dx, dy);
        return;
      }
    }
    // Ranged tap: a visible monster in range with clear line of sight (req. phase 3).
    const foe = this.monsterAt(tx, ty);
    if (foe && this.canRangedAttack(tx, ty)) {
      this.stopTravel();
      this.playerRangedAttack(foe);
      return;
    }
    const path = this.findPath(tx, ty);
    if (!path || !path.length) {
      this.pushLog('无法抵达那里。');
      return;
    }
    this.travelPath = path;
    this.travelDest = { x: tx, y: ty };
    this.showMarker();
    this.continueTravel();
  }

  /** Take the next travelling step if it is still safe and possible. */
  private continueTravel(): void {
    if (this.busy || this.gameOver || this.menuOpen) return;
    if (!this.travelPath.length) {
      this.stopTravel();
      return;
    }
    if (this.monsterNear()) {
      this.pushLog('附近出现了敌人，你停下脚步。');
      this.stopTravel();
      return;
    }
    const next = this.travelPath[0];
    const dx = next.x - this.player.x;
    const dy = next.y - this.player.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1 || this.monsterAt(next.x, next.y)) {
      this.stopTravel();
      return;
    }
    // A closed door on the path opens this turn; the next tick walks through it.
    if (this.map.tiles[next.y][next.x] === TileType.DoorClosed) {
      this.tryMove(dx, dy);
      return;
    }
    if (!isWalkable(this.map.tiles[next.y][next.x])) {
      this.stopTravel();
      return;
    }
    this.travelPath.shift();
    this.tryMove(dx, dy);
  }

  private stopTravel(): void {
    this.travelPath = [];
    this.travelDest = null;
    this.travelMarker?.setVisible(false);
  }

  /** A living, visible monster within one tile halts auto-travel. */
  private monsterNear(): boolean {
    return this.monsters.some(
      (m) =>
        !m.isDead &&
        !m.dying &&
        this.map.visible[m.y][m.x] &&
        Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y)) <= 1,
    );
  }

  /** BFS over walkable, unoccupied tiles; targets an adjacent tile if the goal is a monster. */
  private findPath(tx: number, ty: number): Vec[] | null {
    const W = this.map.width;
    const H = this.map.height;
    // Closed (but not locked) doors are routable — travel opens them en route.
    const passable = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < W && y < H &&
      (isWalkable(this.map.tiles[y][x]) || this.map.tiles[y][x] === TileType.DoorClosed) &&
      !this.monsterAt(x, y);
    const startK = this.player.y * W + this.player.x;
    const cameFrom = new Map<number, number>();
    const visited = new Set<number>([startK]);
    const queue: Vec[] = [{ x: this.player.x, y: this.player.y }];
    const targetPassable = passable(tx, ty);
    const targetIsMonster = this.monsterAt(tx, ty) != null;
    let goalK = -1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      if (targetPassable && cur.x === tx && cur.y === ty) {
        goalK = cur.y * W + cur.x;
        break;
      }
      if (!targetPassable && targetIsMonster && Math.abs(cur.x - tx) + Math.abs(cur.y - ty) === 1) {
        goalK = cur.y * W + cur.x;
        break;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const k = ny * W + nx;
        if (visited.has(k) || !passable(nx, ny)) continue;
        visited.add(k);
        cameFrom.set(k, cur.y * W + cur.x);
        queue.push({ x: nx, y: ny });
      }
    }
    if (goalK < 0 || goalK === startK) return null;
    const path: Vec[] = [];
    let ck = goalK;
    while (ck !== startK) {
      path.unshift({ x: ck % W, y: (ck / W) | 0 });
      const prev = cameFrom.get(ck);
      if (prev === undefined) return null;
      ck = prev;
    }
    return path;
  }

  private showMarker(): void {
    if (!this.travelMarker) {
      const frame = this.atlas ? tileByKey(this.atlas, 'goal')?.frames[0] ?? 9 : 9;
      this.travelMarker = this.add
        .image(0, 0, this.usesTiles ? 'tiles' : 'zr-px', this.usesTiles ? frame : undefined)
        .setDepth(4);
      if (!this.usesTiles) this.travelMarker.setDisplaySize(TILE, TILE).setTint(Palette.accent).setAlpha(0.5);
      this.tileLayer.add(this.travelMarker);
      this.tweens.add({ targets: this.travelMarker, alpha: { from: 0.45, to: 1 }, duration: 520, yoyo: true, repeat: -1 });
    }
    this.travelMarker.setVisible(true);
  }

  // --- rendering ---------------------------------------------------------

  private refresh(): void {
    this.renderViewport();
    this.renderEntities();
  }

  /** Recompute fog of war from the player's current tile. */
  private updateFOV(): void {
    const { width, height, tiles, explored, visible } = this.map;
    for (let y = 0; y < height; y++) visible[y].fill(false);
    // 目盲 (裂灯卷轴 / 0.3): sight shrinks sharply while blinded, then recovers as the
    // status ticks down — a real risk window the player can read on the HUD.
    const radius = this.player.hasStatus('blinded') ? Math.max(2, this.radius - 4) : this.radius;
    computeFOV(
      {
        width,
        height,
        blocksSight: (x, y) =>
          x < 0 || y < 0 || x >= width || y >= height || tileBlocksSight(tiles[y][x]),
      },
      this.player.x,
      this.player.y,
      radius,
      (x, y) => {
        if (x >= 0 && y >= 0 && x < width && y < height) {
          visible[y][x] = true;
          explored[y][x] = true;
        }
      },
    );
  }

  /** Draw the tile window: visible normally, explored dimmed, unexplored hidden. */
  private renderViewport(): void {
    const explored = this.map.explored;
    const visible = this.map.visible;
    for (let j = 0; j < VIEW_ROWS; j++) {
      for (let i = 0; i < VIEW_COLS; i++) {
        const mapX = this.player.x - HALF_COLS + i;
        const mapY = this.player.y - HALF_ROWS + j;
        const img = this.pool[j][i];
        const inBounds = mapX >= 0 && mapY >= 0 && mapX < this.map.width && mapY < this.map.height;
        if (!inBounds || !explored[mapY][mapX]) {
          img.setVisible(false);
          continue;
        }
        img.setVisible(true);
        const type = this.map.tiles[mapY][mapX];
        if (this.usesTiles) {
          img.setFrame(this.frameByType[type]);
          // Open/closed doors are distinct sprites now; only mark locked ones.
          if (type === TileType.DoorLocked) img.setTint(0xc06a3a);
          else img.clearTint();
        } else {
          img.setTint(TILE_COLOR[type]);
        }
        img.setAlpha(visible[mapY][mapX] ? 1 : 0.4);
      }
    }
  }

  /** Snap monsters and items to their viewport positions; visible only in FOV. */
  private renderEntities(): void {
    const visible = this.map.visible;
    for (const m of this.monsters) {
      const spr = this.monsterSprites.get(m);
      if (!spr) continue;
      const vis = this.inView(m.x, m.y) && visible[m.y][m.x];
      spr.setVisible(vis);
      spr.setPosition((m.x - this.player.x) * TILE, (m.y - this.player.y) * TILE);
      if (vis && m.hasTrait('explodesOnDeath')) this.warnExploder(m);
    }
    for (const it of this.items) {
      it.sprite.setVisible(this.inView(it.x, it.y) && visible[it.y][it.x]);
      it.sprite.setPosition((it.x - this.player.x) * TILE, (it.y - this.player.y) * TILE);
    }
    if (this.merchant) {
      const m = this.merchant;
      m.sprite.setVisible(this.inView(m.x, m.y) && visible[m.y][m.x]);
      m.sprite.setPosition((m.x - this.player.x) * TILE, (m.y - this.player.y) * TILE);
    }
    if (this.travelMarker && this.travelDest) {
      const show = this.travelPath.length > 0 && this.inView(this.travelDest.x, this.travelDest.y);
      this.travelMarker.setVisible(show);
      if (show) this.travelMarker.setPosition((this.travelDest.x - this.player.x) * TILE, (this.travelDest.y - this.player.y) * TILE);
    }
  }

  private inView(x: number, y: number): boolean {
    return Math.abs(x - this.player.x) <= HALF_COLS && Math.abs(y - this.player.y) <= HALF_ROWS;
  }

  /**
   * explodesOnDeath learnability: a one-time "danger" tell the first time the
   * monster is seen, and a second when it drops to a sliver — so its death blast is
   * never a blind surprise. Both are flag-guarded, so seeing it every frame never
   * spams the log.
   */
  private warnExploder(m: Monster): void {
    if (!m.warningShown) {
      m.warningShown = true;
      this.pushLog(`${m.name}的腹腔泛着不稳定的红光——它似乎会在死亡时炸裂。`);
    } else if (!m.lowHpWarned && m.hp <= m.maxHp * 0.3) {
      m.lowHpWarned = true;
      this.pushLog(`${m.name}周身的余烬剧烈闪烁，即将炸裂！`);
    }
  }

  // --- player status input layer (0.3) -----------------------------------

  /**
   * Frozen input gate: a frozen hero can't act, but the *attempt* still fails and
   * burns a turn — the ice thaws by one as statuses tick inside the commit. Returns
   * true when it swallowed the action. UI opens / cancels never call this, so
   * opening the bag or cancelling an aim while frozen stays free.
   */
  private consumedByFreeze(): boolean {
    if (this.busy || this.menuOpen || this.gameOver) return false;
    if (!this.player.hasStatus('frozen')) return false;
    this.stopTravel();
    this.pushLog('冰霜锁住了你的动作。');
    this.busy = true;
    this.commitPlayerAction('frozen-skip');
    return true;
  }

  /**
   * Confusion may scramble an intended cardinal direction into a random one (~35%).
   * Movement, ranged shots and aimed skills all route through this. The scrambled
   * direction still runs the normal legality checks, so a bad roll into a wall just
   * bumps (no turn) like any blocked move, and a skill into nothing fizzles as usual.
   */
  private confuseDir(dx: number, dy: number): { dx: number; dy: number } {
    if (!this.player.hasStatus('confused') || !this.rng.chance(0.35)) return { dx, dy };
    this.pushLog('你的方向感被搅乱了。');
    // Scramble to one of the *other* three cardinals, so a scramble is always a real
    // misdirection (the 35% roll is the actual chance of veering off, not diluted by
    // re-picking the same way).
    const others = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>).filter(
      ([x, y]) => !(x === dx && y === dy),
    );
    const [ndx, ndy] = this.rng.pick(others.length ? others : [[1, 0]]);
    return { dx: ndx, dy: ndy };
  }

  // --- player turn -------------------------------------------------------

  private tryMove(dx: number, dy: number): void {
    if (this.busy || this.menuOpen) return;
    if (this.consumedByFreeze()) return;
    ({ dx, dy } = this.confuseDir(dx, dy));
    if (dx < 0) this.playerSprite.setFlipX(true);
    else if (dx > 0) this.playerSprite.setFlipX(false);

    const nx = this.player.x + dx;
    const ny = this.player.y + dy;

    const foe = this.monsterAt(nx, ny);
    if (foe) {
      this.playerAttack(foe, dx, dy);
      return;
    }

    // Stepping into the merchant opens the shop instead of moving onto its tile.
    if (this.merchant && this.merchant.x === nx && this.merchant.y === ny) {
      this.openShop();
      return;
    }

    const inBounds = nx >= 0 && ny >= 0 && nx < this.map.width && ny < this.map.height;
    // Bumping a closed chest opens the interaction menu (no auto-open / auto-trap, 0.3).
    if (inBounds && this.map.tiles[ny][nx] === TileType.Chest) {
      this.openChestMenu(nx, ny);
      return;
    }
    // Doors: a closed door opens (one turn); a locked door is forced (req. phase 7).
    if (inBounds && this.map.tiles[ny][nx] === TileType.DoorClosed) {
      this.openDoor(nx, ny);
      return;
    }
    if (inBounds && this.map.tiles[ny][nx] === TileType.DoorLocked) {
      this.forceDoor(nx, ny);
      return;
    }
    // Stepping toward a *revealed* trap tries to disarm it rather than walking on.
    if (inBounds && this.map.tiles[ny][nx] === TileType.Trap) {
      this.disarmTrap(nx, ny);
      return;
    }
    if (!inBounds || !isWalkable(this.map.tiles[ny][nx])) {
      this.pushLog('一堵石墙挡住了去路。');
      this.bump(dx, dy);
      return;
    }

    this.busy = true;
    this.player.x = nx;
    this.player.y = ny;
    if (this.anims.exists(heroAnim(this.heroKey, 'walk'))) this.playerSprite.play(heroAnim(this.heroKey, 'walk'), true);

    this.updateFOV();
    this.refresh();
    this.tileLayer.setPosition(PLAY_CX + dx * TILE, PLAY_CY + dy * TILE);
    this.tweens.add({
      targets: this.tileLayer,
      x: PLAY_CX,
      y: PLAY_CY,
      duration: this.ms(MOVE_MS),
      ease: 'Linear',
      onComplete: () => this.onArrive(),
    });
  }

  /** A blocked move: nudge the hero toward the wall and back (no turn passes). */
  private bump(dx: number, dy: number): void {
    this.busy = true;
    this.tweens.add({
      targets: this.playerSprite,
      x: PLAY_CX + dx * 6,
      y: PLAY_CY + dy * 6,
      duration: 60,
      yoyo: true,
      onComplete: () => {
        this.playerSprite.setPosition(PLAY_CX, PLAY_CY);
        this.busy = false;
      },
    });
  }

  private onArrive(): void {
    if (this.anims.exists(heroAnim(this.heroKey, 'idle'))) this.playerSprite.play(heroAnim(this.heroKey, 'idle'), true);
    this.resolveTile(this.player.x, this.player.y);
    this.checkSpecialRoom();
    this.triggerTrap(this.player.x, this.player.y);
    if (this.player.isDead) return; // a floor trap finished us; die() already ran
    this.tryPickup();
    this.commitPlayerAction('move');
  }

  private resolveTile(x: number, y: number): void {
    // Chests are no longer auto-opened on step (0.3) — you bump them to interact.
    if (this.map.tiles[y][x] === TileType.StairsDown) {
      this.pushLog('你发现了向下的阶梯。点击「下楼」继续深入。');
    }
  }

  /** Tick the player's own status effects (poison/burn/regen) for this turn. */
  private tickPlayerStatuses(): void {
    if (!this.player.statuses.length) return;
    const before = new Set<StatusType>(this.player.statuses.map((s) => s.type));
    const events = tickStatuses(this.player, '你');
    for (const ev of events) {
      this.pushLog(ev.message);
      if (ev.damage > 0) {
        floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${ev.damage}`, Palette.danger);
        this.flashSprite(this.playerSprite);
      } else if (ev.healed > 0) {
        floatNumber(this, PLAY_CX, PLAY_CY - 18, `+${ev.healed}`, Palette.success);
      }
    }
    // Announce any status that just wore off (frozen/slowed/confused/feared/…).
    for (const t of before) {
      if (!this.player.hasStatus(t) && STATUS_RECOVERY[t]) this.pushLog(STATUS_RECOVERY[t]!);
    }
    this.updateHud();
  }

  /** Tick every monster's status effects (poison/burn/regen); dispatch any deaths. */
  private tickMonsterStatuses(): void {
    for (const m of [...this.monsters]) {
      if (m.isDead || m.dying || !m.statuses.length) continue;
      const events = tickStatuses(m, m.name);
      const sx = PLAY_CX + (m.x - this.player.x) * TILE;
      const sy = PLAY_CY + (m.y - this.player.y) * TILE;
      for (const ev of events) {
        if (ev.damage > 0) floatNumber(this, sx, sy - 12, `-${ev.damage}`, Palette.success);
        else if (ev.healed > 0) floatNumber(this, sx, sy - 12, `+${ev.healed}`, Palette.success);
      }
      if (m.isDead) this.killMonster(m, sx, sy);
    }
  }

  /** The boss flips into an enraged second phase once below half health (req. phase 6). */
  private maybeBossPhase(): void {
    for (const m of this.monsters) {
      if (!m.boss || m.phase2 || m.isDead || m.dying) continue;
      if (m.hp > m.maxHp * 0.5) continue;
      m.phase2 = true;
      m.attack += BOSS_PHASE2_ATTACK;
      m.agility += BOSS_PHASE2_AGILITY;
      applyStatus(m, 'regenerating', 6, BOSS_PHASE2_REGEN);
      const sx = PLAY_CX + (m.x - this.player.x) * TILE;
      const sy = PLAY_CY + (m.y - this.player.y) * TILE;
      playEffect(this, 'shock', sx, sy, 2.0);
      this.cameras.main.shake(160, 0.005);
      this.pushLog('零环守卫发出震鸣，迸发出第二阶段的狂暴！');
    }
  }

  /**
   * The single commit entry every *successful, world-changing* player action
   * funnels through (0.3 phase 1 — unified action economy). It advances the turn
   * exactly once, ticks the player's statuses, then runs exactly one monster round
   * (their AI + combat, status ticks, sprung traps), repaints FOV/HUD, saves, and
   * checks death — each thing once. UI-only actions (opening the bag, inspecting a
   * tile, cancelling an aim, a failed/blocked attempt) must NOT call this, so the
   * world never advances twice for one action — nor for free.
   *
   * `reason` is diagnostic only (a label for the action that drove the turn).
   */
  private commitPlayerAction(reason?: string): void {
    if (this.gameOver) return;
    // 铁拳僧 combo survives only a continuous melee chain — every other committed
    // action (move / wait / search / ranged / skill / door / chest / item) breaks it.
    if (reason !== 'melee') this.breakCombo();
    this.turn += 1;
    this.tickPlayerStatuses();
    if (this.player.isDead && !this.tryDeathSave()) {
      this.deathCause = '不治的伤势';
      this.die();
      return;
    }
    this.player.regenMana();
    // 蓄盐 affix: bank a charge each turn (capped), spent to amplify the next skill.
    if (this.inventory.hasRule('saltcharge')) {
      this.saltCharge = Math.min(Math.round(this.inventory.ruleParam('saltcharge', 'cap', 3)), this.saltCharge + 1);
    }

    // Monster status effects tick (poison/burn/regen); boss may flip to phase 2.
    this.tickMonsterStatuses();
    this.maybeBossPhase();

    // One monster round. A *slowed* hero lags a beat, so the world gets a second
    // round before the next move — hard-capped at two, so it can never recurse or
    // pile up into an unexplained death (each round ends on its own death check).
    if (this.runMonsterRound()) return; // player died — die() already dispatched
    if (!this.gameOver && !this.player.isDead && this.player.hasStatus('slowed')) {
      this.pushLog('迟缓缠身，敌人趁势又逼近一步！');
      if (this.runMonsterRound()) return;
    }

    this.persist();
    this.time.delayedCall(this.ms(170), () => {
      this.busy = false;
      this.continueTravel();
    });
  }

  /**
   * Run exactly one monster round: AI + combat, animate it, spring any traps they
   * stepped onto, repaint and refresh the HUD, then check player death. Returns true
   * when the round killed the player (die() has been dispatched). Status ticks live
   * in commitPlayerAction, NOT here, so a slowed double-round never double-ticks.
   */
  private runMonsterRound(): boolean {
    const events = runMonsterTurns(this.monsters, {
      player: this.player,
      inBounds: (x, y) => x >= 0 && y >= 0 && x < this.map.width && y < this.map.height,
      isWallTile: (x, y) => this.map.tiles[y]?.[x] === TileType.Wall,
      isClosedDoor: (x, y) => isClosedDoor(this.map.tiles[y]?.[x] ?? TileType.Wall),
      blocksSight: (x, y) =>
        x < 0 || y < 0 || x >= this.map.width || y >= this.map.height || tileBlocksSight(this.map.tiles[y][x]),
      openDoor: (x, y) => {
        this.map.tiles[y][x] = TileType.Door;
      },
      rng: this.rng,
    });
    this.presentTurn(events);
    this.resolveMonsterTraps(events);
    this.renderViewport(); // repaint any doors monsters opened
    this.updateHud();
    if (this.player.isDead && !this.tryDeathSave()) {
      const killer = events.find((e) => e.combat?.killed)?.monster;
      if (killer) this.deathCause = `${killer.name}的攻击`;
      this.die();
      return true;
    }
    return false;
  }

  // --- combat ------------------------------------------------------------

  private monsterAt(x: number, y: number): Monster | null {
    return this.monsters.find((m) => !m.isDead && !m.dying && m.x === x && m.y === y) ?? null;
  }

  /** Player strikes an adjacent monster (req. 8): lunge + effect + resolution. */
  private playerAttack(foe: Monster, dx: number, dy: number): void {
    this.busy = true;
    if (dx < 0) this.playerSprite.setFlipX(true);
    else if (dx > 0) this.playerSprite.setFlipX(false);
    if (this.anims.exists(heroAnim(this.heroKey, 'attack'))) this.playerSprite.play(heroAnim(this.heroKey, 'attack'), true);

    const fx = PLAY_CX + dx * TILE;
    const fy = PLAY_CY + dy * TILE;
    playEffect(this, this.cls.magic >= 6 ? 'magic' : 'slash', fx, fy, 1.15);

    // Feared: too rattled to land a clean blow — melee bites ~40% softer (ranged is
    // unaffected, so a frightened hero can still fight back from a distance).
    const feared = this.player.hasStatus('feared');
    if (feared) this.pushLog('恐惧攫住你，这一击软弱无力。');
    const savedAtk = this.player.attack;
    if (feared) this.player.attack = Math.max(1, Math.round(this.player.attack * 0.6));
    const result = resolveAttack(this.player, foe, this.rng);
    if (feared) this.player.attack = savedAtk;
    this.applyMeleeBonus(foe, result);
    this.applyAffixHit(foe, result, false);
    const spr = this.monsterSprites.get(foe);
    if (result.dodged) {
      floatNumber(this, fx, fy - 14, '闪避', Palette.textDim);
      this.pushLog(`${foe.name}闪避了你的攻击。`);
    } else {
      if (spr) {
        this.flashSprite(spr);
        const design = this.atlas ? monsterByFrame(this.atlas, foe.spriteFrame) : null;
        if (design && this.anims.exists(monsterAnim(design.key, 'hurt'))) spr.play(monsterAnim(design.key, 'hurt'));
        this.recoilSprite(spr, dx, dy, result.crit ? 14 : 9);
        if (result.crit && !result.killed) this.punchSprite(spr, 1.3);
      }
      burst(this, fx, fy, result.crit ? CRIT_COLOR : 0xeaeaf0, result.crit ? 14 : 7);
      this.hitShake(result.damage, result.crit);
      floatNumber(this, fx, fy - 14, `-${result.damage}`, result.crit ? CRIT_COLOR : Palette.white, { big: result.crit });
      this.pushLog(
        result.crit
          ? `你暴击${foe.name}，造成 ${result.damage} 点伤害！`
          : `你命中${foe.name}，造成 ${result.damage} 点伤害。`,
      );
      if (result.killed) this.killMonster(foe, fx, fy, true);
    }

    this.tweens.add({
      targets: this.playerSprite,
      x: PLAY_CX + dx * 12,
      y: PLAY_CY + dy * 12,
      duration: this.ms(90),
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.playerSprite.setPosition(PLAY_CX, PLAY_CY);
        if (this.anims.exists(heroAnim(this.heroKey, 'idle'))) this.playerSprite.play(heroAnim(this.heroKey, 'idle'), true);
        this.commitPlayerAction('melee');
      },
    });
  }

  /** Remove a slain monster: death fade + particles, grant exp, maybe level up. */
  private killMonster(foe: Monster, fx: number, fy: number, byMelee = false): void {
    if (foe.dying) return;
    const wasBurning = foe.hasStatus('burning');
    foe.dying = true;
    if (foe === this.comboTarget) {
      this.comboTarget = null; // 铁拳僧 combo resets when its target dies
      this.comboCount = 0;
    }
    SaveManager.recordSeen(foe.id); // 图鉴: this kind is now known (lore on re-encounter)
    this.kills += 1;
    const idx = this.monsters.indexOf(foe);
    if (idx !== -1) this.monsters.splice(idx, 1);
    this.pushLog(`你击倒了${foe.name}，获得 ${foe.exp} 点经验。`);
    // A kill should land hard: a warm shard burst, a white flash burst and a shake.
    burst(this, fx, fy, 0xd98a6a, 12);
    burst(this, fx, fy, 0xffffff, 6);
    this.hitShake(7, true);

    const spr = this.monsterSprites.get(foe);
    if (spr) {
      this.monsterSprites.delete(foe);
      this.tweens.add({
        targets: spr,
        alpha: 0,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 260,
        ease: 'Quad.easeOut',
        onComplete: () => spr.destroy(),
      });
    }

    const levelUp = this.player.gainExp(foe.exp);
    if (levelUp) {
      playEffect(this, 'heal', PLAY_CX, PLAY_CY - 6, 1.3);
      floatNumber(this, PLAY_CX, PLAY_CY - 26, `LV ${levelUp.level}!`, Palette.accentBright);
      this.pushLog(
        `升级！等级 ${levelUp.level}，最大生命 +${levelUp.maxHpGain}，${levelUp.stat === 'attack' ? '攻击' : '防御'} +1，恢复 ${levelUp.healed} 点生命。`,
      );
    }

    if (foe.elite) {
      // Elites always leave a stronger, *appraised* and never-cursed piece behind —
      // biased toward gear (one re-roll) so the reward feels worth the tougher fight.
      let id = rollShopStock(this.depth, this.rng, 1)[0];
      if (id && !isGear(getItem(id).type)) {
        const alt = rollShopStock(this.depth, this.rng, 1)[0];
        if (alt && isGear(getItem(alt).type)) id = alt;
      }
      if (id) {
        const inst = rollInstance(id, this.rng, this.depth + 4);
        inst.identified = true;
        if (inst.beatitude === 'cursed') inst.beatitude = 'uncursed';
        if (inst.enchantment < 0) inst.enchantment = 0;
        // Guarantee the reward is at least slightly better than a plain piece.
        if (isGear(getItem(id).type) && (inst.affixes?.length ?? 0) === 0 && inst.enchantment === 0) {
          inst.enchantment = 1;
        }
        this.placeFloorItem(inst, foe.x, foe.y);
        this.pushLog(`精英倒下，留下了${this.inventory.name(inst)}！`);
      }
    } else if (!foe.spawnedSplit) {
      // Split-spawned children drop nothing — kept off the loot table to stop a
      // splitter from being farmed into a pile of items.
      const drop = rollMonsterDrop(this.depth, this.rng);
      if (drop) {
        this.spawnItem(drop, foe.x, foe.y);
        this.pushLog(`${foe.name}掉落了${getItem(drop).name}。`);
      }
    }

    // stealsGold: a thief that dies coughs the coins back up (guard against double
    // return — reset to 0 — though killMonster already runs at most once per foe).
    if (foe.stolenGold > 0) {
      const recovered = foe.stolenGold;
      foe.stolenGold = 0;
      this.inventory.addGold(recovered);
      floatNumber(this, fx, fy - 24, `+${recovered} 金`, Palette.accentBright);
      this.pushLog(`你夺回了被偷走的 ${recovered} 枚环币。`);
    }

    this.applyAffixKill(foe, fx, fy, byMelee, wasBurning);

    if (foe.hasTrait('explodesOnDeath')) this.explodeOnDeath(foe, fx, fy);
    if (foe.hasTrait('splitsOnDeath') && !foe.spawnedSplit) this.splitOnDeath(foe);

    this.updateHud();

    if (foe.boss) this.victory();
  }

  /** explodesOnDeath: a death blast damages everything orthogonally adjacent. */
  private explodeOnDeath(foe: Monster, fx: number, fy: number): void {
    const dmg = 4 + this.depth;
    playEffect(this, 'shock', fx, fy, 1.6);
    this.cameras.main.shake(120, 0.004);
    if (Math.abs(foe.x - this.player.x) + Math.abs(foe.y - this.player.y) === 1) {
      this.player.takeDamage(dmg);
      this.flashSprite(this.playerSprite);
      floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${dmg}`, Palette.danger);
    }
    for (const m of [...this.monsters]) {
      if (m === foe || m.isDead || m.dying) continue;
      if (Math.abs(m.x - foe.x) + Math.abs(m.y - foe.y) !== 1) continue;
      m.takeDamage(dmg);
      const mx = PLAY_CX + (m.x - this.player.x) * TILE;
      const my = PLAY_CY + (m.y - this.player.y) * TILE;
      floatNumber(this, mx, my - 12, `-${dmg}`, Palette.danger);
      if (m.isDead) this.killMonster(m, mx, my);
    }
    this.pushLog(`${foe.name}迸裂开来，余烬四溅！`);
    if (this.player.isDead && !this.tryDeathSave()) {
      this.deathCause = `${foe.name}的爆裂`;
      this.die();
    }
  }

  /** splitsOnDeath: spawn up to two weaker, non-splitting copies on free tiles. */
  private splitOnDeath(foe: Monster): void {
    const def = getMonster(foe.id);
    const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: foe.x + dx, y: foe.y + dy }))
      .filter(
        (p) =>
          p.x >= 0 && p.y >= 0 && p.x < this.map.width && p.y < this.map.height &&
          isWalkable(this.map.tiles[p.y][p.x]) && !this.monsterAt(p.x, p.y) &&
          !(p.x === this.player.x && p.y === this.player.y),
      );
    const n = Math.min(2, spots.length);
    for (let i = 0; i < n; i++) {
      const child = new Monster(def, spots[i].x, spots[i].y);
      child.spawnedSplit = true; // never splits again (checked in killMonster)
      child.maxHp = Math.max(3, Math.floor(def.hp / 2));
      child.hp = child.maxHp;
      child.attack = Math.max(1, def.attack - 1);
      child.exp = Math.max(1, Math.floor(def.exp / 3)); // worth far less than the parent
      // Children start with a clean status list (no inherited poison/fear) on purpose.
      this.monsters.push(child);
      this.addMonsterSprite(child);
    }
    if (n > 0) this.pushLog(`${foe.name}碎裂，重组成 ${n} 头更小的骨兽！`);
  }

  /** Register an animated sprite for a monster spawned mid-run (split / summon). */
  private addMonsterSprite(monster: Monster): void {
    if (!this.textures.exists('monsters')) return;
    const sprite = this.add.sprite(0, 0, 'monsters', monster.spriteFrame).setVisible(false);
    const design = this.atlas ? monsterByFrame(this.atlas, monster.spriteFrame) : null;
    if (design && this.anims.exists(monsterAnim(design.key, 'idle'))) sprite.play(monsterAnim(design.key, 'idle'));
    this.tileLayer.add(sprite);
    this.monsterSprites.set(monster, sprite);
    sprite.setPosition((monster.x - this.player.x) * TILE, (monster.y - this.player.y) * TILE);
    sprite.setVisible(this.inView(monster.x, monster.y) && this.map.visible[monster.y][monster.x]);
  }

  /** The boss is slain — clear the run save, keep history, show victory. */
  private victory(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.busy = true;
    this.invView?.destroy();
    this.invView = undefined;
    this.shopView?.destroy();
    this.shopView = undefined;
    this.chestView?.destroy();
    this.chestView = undefined;
    this.altarView?.destroy();
    this.altarView = undefined;
    this.menuOpen = false;
    SaveManager.clearRun();
    const meta = SaveManager.recordOutcome(this.depth, true, this.kills);
    playEffect(this, 'shock', PLAY_CX, PLAY_CY, 2.2);
    this.pushLog('零环守卫崩解了……零环，重归你手！');
    this.time.delayedCall(950, () =>
      this.scene.start(SceneKeys.Victory, {
        classId: this.cls.id,
        level: this.player.level,
        depth: this.depth,
        kills: this.kills,
        turns: this.turn,
        bestDepth: meta.bestDepth,
        shards: meta.shardGain,
        totalShards: meta.shards,
      }),
    );
  }

  /** Animate and log one monster's action (move slide, or attack on the player). */
  private presentTurn(events: TurnEvent[]): void {
    for (const ev of events) {
      const spr = this.monsterSprites.get(ev.monster);
      if (ev.action.type === 'move') {
        if (!spr) continue;
        const lx = (ev.monster.x - this.player.x) * TILE;
        const ly = (ev.monster.y - this.player.y) * TILE;
        const vis = this.inView(ev.monster.x, ev.monster.y) && this.map.visible[ev.monster.y][ev.monster.x];
        spr.setVisible(vis);
        if (vis) this.tweens.add({ targets: spr, x: lx, y: ly, duration: this.ms(110), ease: 'Quad.easeOut' });
        else spr.setPosition(lx, ly);
      } else if (ev.action.type === 'attack' && ev.combat) {
        this.presentMonsterAttack(ev.monster, ev.combat, ev.action.ranged, spr);
      }
    }
  }

  private presentMonsterAttack(monster: Monster, combat: AttackResult, ranged: boolean, spr?: Phaser.GameObjects.Sprite): void {
    const ddx = Math.sign(this.player.x - monster.x);
    const ddy = Math.sign(this.player.y - monster.y);
    if (spr && this.inView(monster.x, monster.y) && this.map.visible[monster.y][monster.x]) {
      const bx = (monster.x - this.player.x) * TILE;
      const by = (monster.y - this.player.y) * TILE;
      this.tweens.add({ targets: spr, x: bx + ddx * 8, y: by + ddy * 8, duration: this.ms(80), yoyo: true, ease: 'Quad.easeOut' });
    }

    if (combat.dodged) {
      floatNumber(this, PLAY_CX, PLAY_CY - 20, '闪避', Palette.accent);
      this.pushLog(`你闪避了${monster.name}的攻击。`);
      return;
    }

    this.flashSprite(this.playerSprite);
    this.flashDamage();
    this.recoilSprite(this.playerSprite, ddx, ddy, combat.crit ? 12 : 7);
    this.hitShake(combat.damage, combat.crit);
    floatNumber(this, PLAY_CX + this.rng.range(-6, 6), PLAY_CY - 18, `-${combat.damage}`, combat.crit ? CRIT_COLOR : Palette.danger, { big: combat.crit });
    this.pushLog(
      combat.crit
        ? `${monster.name}的暴击命中你，造成 ${combat.damage} 点伤害！`
        : `${monster.name}命中你，造成 ${combat.damage} 点伤害。`,
    );

    // 折光 affix: blunt the FIRST ranged shot you take each floor (heals back the
    // reduced portion before the post-round death check, so it can be a panic save).
    if (ranged && this.inventory.hasRule('refract') && !this.refractUsed) {
      this.refractUsed = true;
      const back = Math.round(combat.damage * this.inventory.ruleParam('refract', 'reduce', 0.6));
      if (back > 0) {
        this.player.heal(back);
        floatNumber(this, PLAY_CX, PLAY_CY - 30, `+${back}`, Palette.cool);
        this.pushLog(`折光闪烁，化解了 ${back} 点远程伤害。`);
      }
    }

    // On-hit status attacks (0.3.1) — frostslug freezes, miasmacap confuses, shriekbat
    // fears, etc. Resolved here (scene-side) so the float / log / HUD update together.
    const oh = monster.onHit;
    if (oh && (oh.chance === undefined || this.rng.chance(oh.chance))) {
      const applied = applyStatus(this.player, oh.status, oh.turns, oh.power, this.rng);
      if (applied > 0) {
        this.pushLog(`${monster.name}${ONHIT_FLAVOR[oh.status] ?? '使你陷入了异常状态。'}`);
        this.flashSprite(this.playerSprite);
        this.updateHud();
      }
    }

    // On-hit trait flavour (the poison status itself is applied in TurnSystem).
    if (monster.hasTrait('poisonAttack')) this.pushLog(`${monster.name}的毒孢沾上了你。`);
    if (monster.hasTrait('stealsGold') && this.inventory.gold > 0) {
      const stolen = Math.min(this.inventory.gold, this.rng.range(3, 8 + this.depth));
      this.inventory.gold = Math.max(0, this.inventory.gold - stolen);
      monster.stolenGold += stolen; // it now flees with the loot — recovered on its death
      floatNumber(this, PLAY_CX, PLAY_CY - 32, `-${stolen} 金`, Palette.accent);
      this.pushLog(`${monster.name}咬走了你 ${stolen} 枚环币！`);
    }
  }

  /** A brief white "hit flash" on any sprite (req. 14); restores an elite's tint. */
  private flashSprite(spr: Phaser.GameObjects.Sprite): void {
    const baseTint = spr.getData('tint') as number | undefined;
    spr.setTintFill(0xffffff);
    this.time.delayedCall(90, () => {
      if (!spr.active) return;
      if (baseTint !== undefined) spr.setTint(baseTint);
      else spr.clearTint();
    });
  }

  // --- hit juice (打击感) -------------------------------------------------

  /** Camera shake scaled by damage and amplified on crits. */
  private hitShake(damage: number, crit = false): void {
    const intensity = Math.min(0.012, 0.0022 + damage * 0.0006) * (crit ? 1.7 : 1);
    this.cameras.main.shake(crit ? 200 : 130, intensity);
  }

  /** Knock a tile-layer sprite back along (dx,dy) and snap it home (recoil feel). */
  private recoilSprite(spr: Phaser.GameObjects.Sprite, dx: number, dy: number, dist: number): void {
    const ox = spr.x;
    const oy = spr.y;
    this.tweens.add({
      targets: spr,
      x: ox + dx * dist,
      y: oy + dy * dist,
      duration: this.ms(70),
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (spr.active) spr.setPosition(ox, oy);
      },
    });
  }

  /** A quick scale-overshoot on a sprite — emphasises a crit landing. */
  private punchSprite(spr: Phaser.GameObjects.Sprite, amount = 1.3): void {
    const sx = spr.scaleX;
    const sy = spr.scaleY;
    this.tweens.add({
      targets: spr,
      scaleX: sx * amount,
      scaleY: sy * amount,
      duration: this.ms(70),
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (spr.active) spr.setScale(sx, sy);
      },
    });
  }

  private die(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.busy = true;
    this.invView?.destroy();
    this.invView = undefined;
    this.shopView?.destroy();
    this.shopView = undefined;
    this.chestView?.destroy();
    this.chestView = undefined;
    this.altarView?.destroy();
    this.altarView = undefined;
    this.menuOpen = false;
    SaveManager.clearRun();
    const meta = SaveManager.recordOutcome(this.depth, false, this.kills);
    this.pushLog('你的生命走到了尽头……');
    this.time.delayedCall(520, () =>
      this.scene.start(SceneKeys.Death, {
        classId: this.cls.id,
        level: this.player.level,
        depth: this.depth,
        kills: this.kills,
        cause: this.deathCause,
        bestDepth: meta.bestDepth,
        shards: meta.shardGain,
        totalShards: meta.shards,
      }),
    );
  }

  private flashDamage(): void {
    const r = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, Palette.danger, 0.3)
      .setDepth(40);
    this.tweens.add({ targets: r, alpha: 0, duration: 220, onComplete: () => r.destroy() });
  }

  /** Apply the melee-only passive bonuses (铁拳僧 combo, 断链狂徒 rage) to a hit. */
  private applyMeleeBonus(foe: Monster, result: AttackResult): void {
    if (result.dodged) return;
    let bonus = 0;
    let note = '';
    if (this.cls.id === 'ironfist-monk') {
      // Combo only grows on a *continuous* melee chain on the same target; it is
      // reset elsewhere (commitPlayerAction breaks it on any non-melee action, and
      // killMonster clears it when the target dies). Capped at 5.
      this.comboCount = Math.min(5, this.comboTarget === foe ? this.comboCount + 1 : 1);
      this.comboTarget = foe;
      const stacks = this.comboCount - 1;
      if (stacks > 0) {
        bonus += Math.min(8, stacks * 2);
        note = `连击x${this.comboCount}`;
      }
    } else if (this.cls.id === 'chainbreaker') {
      const missing = 1 - this.player.hp / Math.max(1, this.player.maxHp);
      bonus += Math.round((this.player.attack * 0.6 + 2) * missing);
      if (missing > 0.5) {
        note = '狂怒';
        // 断链狂徒 route: fighting on below half HP knits wounds shut — a *dynamic*
        // regen (never a permanent stat), small enough to reward the gamble without
        // granting immortality.
        if (!this.player.hasStatus('regenerating')) this.pushLog('狂怒灼烧伤口，竟自行愈合起来。');
        applyStatus(this.player, 'regenerating', 2, RAGE_REGEN_POWER);
      }
    }
    if (bonus > 0) {
      foe.takeDamage(bonus);
      result.damage += bonus;
      result.killed = foe.isDead;
      if (note) this.pushLog(`〔${note}〕额外造成 ${bonus} 点伤害。`);
    }
  }

  /** Break the 铁拳僧 combo (called on any non-melee action). Logs only mid-chain. */
  private breakCombo(): void {
    if (this.comboCount >= 2) this.pushLog(`连击中断（x${this.comboCount} 归零）。`);
    this.comboTarget = null;
    this.comboCount = 0;
  }

  // --- rule-affix hooks (0.3 phase 7) ------------------------------------
  // Equipment rule effects are dispatched here, NOT scattered as ad-hoc ifs across
  // combat. Each hook reads the player's currently-equipped rule affixes
  // (inventory.hasRule / ruleParam) and applies any that match. Important procs log;
  // high-frequency ones (echo / breakstep) keep their logging terse.

  /** On a connecting hit: 断步 (vs slowed/frozen), 血契 (≤25% hp), and 回声 (ranged). */
  private applyAffixHit(foe: Monster, result: AttackResult, ranged: boolean): void {
    if (result.dodged) return;
    const inv = this.inventory;
    let bonus = 0;
    const notes: string[] = [];
    if ((foe.hasStatus('slowed') || foe.hasStatus('frozen')) && inv.hasRule('breakstep')) {
      bonus += Math.round(inv.ruleParam('breakstep', 'bonus', 4));
      notes.push('断步');
    }
    if (this.player.hp <= this.player.maxHp * 0.25 && inv.hasRule('bloodpact')) {
      bonus += Math.round(inv.ruleParam('bloodpact', 'atk', 4));
      notes.push('血契');
    }
    if (bonus > 0 && !result.killed) {
      foe.takeDamage(bonus);
      result.damage += bonus;
      result.killed = foe.isDead;
      this.pushLog(`〔${notes.join('·')}〕额外造成 ${bonus} 点伤害。`);
    }
    // 回声: a ranged hit's echo reveals hidden traps around where it landed and
    // leaves the target briefly vulnerable (a mark for the follow-up).
    if (ranged && inv.hasRule('echo')) {
      const found = this.discoverHidden(foe.x, foe.y, Math.round(inv.ruleParam('echo', 'radius', 2)));
      if (!foe.isDead) applyStatus(foe, 'vulnerable', Math.round(inv.ruleParam('echo', 'mark', 2)), 1, this.rng);
      if (found) this.pushLog(`回声荡开，照见 ${found} 处隐藏机关。`);
    }
  }

  /** On a kill: 盗火 (burning foe → mana), 裂骨 (melee → splash to adjacent foes). */
  private applyAffixKill(foe: Monster, _fx: number, _fy: number, byMelee: boolean, wasBurning: boolean): void {
    const inv = this.inventory;
    if (wasBurning && inv.hasRule('firetheft')) {
      const amt = Math.round(inv.ruleParam('firetheft', 'mana', 4));
      if (this.player.maxMana > 0) {
        this.player.restoreMana(amt);
        this.pushLog(`盗火：自烈焰中夺回 ${amt} 点法力。`);
      } else {
        this.player.heal(Math.ceil(amt / 2));
        this.pushLog('盗火：烈焰之力涌入你的躯体。');
      }
    }
    if (byMelee && inv.hasRule('splinter')) {
      const dmg = Math.round(inv.ruleParam('splinter', 'dmg', 3));
      let hit = 0;
      for (const m of [...this.monsters]) {
        if (m === foe || m.isDead || m.dying) continue;
        if (Math.abs(m.x - foe.x) + Math.abs(m.y - foe.y) !== 1) continue;
        m.takeDamage(dmg);
        const mx = PLAY_CX + (m.x - this.player.x) * TILE;
        const my = PLAY_CY + (m.y - this.player.y) * TILE;
        floatNumber(this, mx, my - 12, `-${dmg}`, Palette.danger);
        hit++;
        if (m.isDead) this.killMonster(m, mx, my); // chain (not melee → no re-splinter)
      }
      if (hit) this.pushLog(`裂骨迸溅，波及 ${hit} 个相邻之敌。`);
    }
  }

  /**
   * 环誓: once per floor the 环骑士 survives a lethal blow, then turns 易伤. Deliberately
   * gates EVERY death path — every `die()` site first calls this, so a poison/burn tick,
   * an explosion, a trap, the 裂心 potion's self-damage, or a direct blow all trigger the
   * oath equally (no source bypasses it). `ringOathUsed` resets per floor and persists.
   */
  private tryDeathSave(): boolean {
    if (this.cls.id !== 'ring-knight' || this.ringOathUsed || !this.player.isDead) return false;
    this.ringOathUsed = true;
    this.player.hp = Math.max(1, Math.round(this.player.maxHp * 0.3));
    applyStatus(this.player, 'vulnerable', 3, 1);
    playEffect(this, 'shock', PLAY_CX, PLAY_CY, 2.0);
    floatNumber(this, PLAY_CX, PLAY_CY - 26, '环誓!', Palette.accentBright);
    this.pushLog('环誓迸发！你在致命一击下挺住，但接下来三回合陷入易伤。');
    this.updateHud();
    return true;
  }

  // --- 0.2 abilities: skills, aiming, ranged attacks, search -------------

  /** Tapping 技能: validate cost / charges, then aim or cast the class ability. */
  private onSkill(): void {
    if (this.busy || this.menuOpen || this.gameOver || this.aiming) return;
    if (this.consumedByFreeze()) return;
    const skill = this.cls.skill;
    if (skill.kind === 'passive') {
      this.pushLog(`〔${skill.name}〕是被动技能，会在战斗中自动生效。`);
      return;
    }
    if (skill.manaCost && this.player.mana < skill.manaCost) {
      this.pushLog(`法力不足：施放〔${skill.name}〕需要 ${skill.manaCost} 点法力。`);
      return;
    }
    if (skill.usesPerFloor !== undefined && this.skillUses <= 0) {
      this.pushLog(`〔${skill.name}〕本层次数已用尽，下楼后恢复。`);
      return;
    }
    if (skill.needsDirection) {
      this.enterAim(`选择〔${skill.name}〕的方向`, (dx, dy) => this.castSkill(dx, dy));
      return;
    }
    this.castSkill(0, 0);
  }

  /**
   * Perform the skill, then settle its cost by outcome (0.3 action economy):
   *  - notAttempted (no direction / blocked exit): nothing left the player — free,
   *    no charge, no turn.
   *  - failedAfterAttempt (e.g. a blade was thrown but hit nothing): the skill DID
   *    act on the world, so it still spends a charge + a turn (mana is reserved for
   *    a genuine success).
   *  - succeeded: spend mana + charge + a turn.
   */
  private castSkill(dx: number, dy: number): void {
    const skill = this.cls.skill;
    // 蓄盐: hand the banked charge to the skill being cast (damage skills read it).
    this.skillSaltBonus = this.inventory.hasRule('saltcharge') ? this.saltCharge : 0;
    const result = this.performSkill(dx, dy);
    if (result === 'notAttempted') {
      this.skillSaltBonus = 0;
      return; // performSkill already logged the reason; charge is preserved
    }
    if (this.skillSaltBonus > 0) {
      this.pushLog(`蓄盐迸发，这一击的威力随之攀升。`);
      this.saltCharge = 0; // spent
    }
    this.skillSaltBonus = 0;
    if (skill.manaCost && result === 'succeeded') this.player.spendMana(skill.manaCost);
    if (skill.usesPerFloor !== undefined) this.skillUses = Math.max(0, this.skillUses - 1);
    this.updateHud();
    if (this.gameOver || this.player.isDead) return;
    this.busy = true;
    this.commitPlayerAction('skill');
  }

  /** Dispatch to the class ability, returning how it resolved (see {@link ActionResult}). */
  private performSkill(dx: number, dy: number): ActionResult {
    switch (this.cls.id) {
      case 'ash-medic':
        return this.skillFirstAid();
      case 'starsalt-mage':
        return this.skillSaltBurst();
      case 'bonebell-priest':
        return this.skillKnell();
      case 'rift-thief':
        return this.skillRiftStep(dx, dy);
      case 'brokenblade-ranger':
        return this.skillShardThrow(dx, dy);
      case 'copperlamp-wanderer':
        return this.skillLantern();
      default:
        this.pushLog('该职业没有可主动施放的技能。');
        return 'notAttempted';
    }
  }

  private skillFirstAid(): ActionResult {
    const heal = 10 + this.player.magic;
    const before = this.player.hp;
    this.player.heal(heal);
    const got = this.player.hp - before;
    const removed = cleanse(this.player);
    playEffect(this, 'heal', PLAY_CX, PLAY_CY - 6, 1.3);
    floatNumber(this, PLAY_CX, PLAY_CY - 22, `+${got}`, Palette.success);
    this.pushLog(`灰烬急救：回复 ${got} 点生命${removed.length ? '，并净化了不良状态' : ''}。`);
    return 'succeeded';
  }

  private skillSaltBurst(): ActionResult {
    // 蓄盐 widens the blast (≥2 charge) and always sharpens its bite.
    const radius = 2 + (this.skillSaltBonus >= 2 ? 1 : 0);
    const dmg = 5 + Math.floor(this.player.magic * 0.8) + this.skillSaltBonus;
    const targets = this.monsters.filter(
      (m) => !m.isDead && !m.dying && this.chebyshev(m.x, m.y) <= radius,
    );
    playEffect(this, 'shock', PLAY_CX, PLAY_CY, 1.8);
    this.cameras.main.shake(120, 0.004);
    for (const m of targets) {
      m.takeDamage(dmg);
      applyStatus(m, 'slowed', 2, 1);
      const sx = PLAY_CX + (m.x - this.player.x) * TILE;
      const sy = PLAY_CY + (m.y - this.player.y) * TILE;
      playEffect(this, 'magic', sx, sy, 1.0);
      floatNumber(this, sx, sy - 12, `-${dmg}`, CRIT_COLOR);
      if (m.isDead) this.killMonster(m, sx, sy);
    }
    this.pushLog(targets.length ? `星盐炸裂，波及 ${targets.length} 个敌人并令其迟缓。` : '星盐炸裂，但周围空无一人。');
    return 'succeeded';
  }

  private skillKnell(): ActionResult {
    const radius = 3;
    let feared = 0;
    let slowed = 0;
    for (const m of this.monsters) {
      if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > radius) continue;
      const sx = PLAY_CX + (m.x - this.player.x) * TILE;
      const sy = PLAY_CY + (m.y - this.player.y) * TILE;
      // The boss shrugs most of it off — fear/slow land for only 1 turn (it resists
      // the knell), so 钟鸣 stays a control tool against packs, not a boss-lock.
      const dur = m.boss ? 1 : 3;
      if (m.tags.includes('undead')) {
        applyStatus(m, 'feared', dur, 1, this.rng);
        feared++;
        floatNumber(this, sx, sy - 12, '惧', Palette.cool);
      } else {
        applyStatus(m, 'slowed', dur, 1, this.rng);
        slowed++;
        floatNumber(this, sx, sy - 12, '缓', Palette.textDim);
      }
    }
    playEffect(this, 'shock', PLAY_CX, PLAY_CY, 1.6);
    this.pushLog(`骨钟长鸣：${feared} 个亡灵恐惧，${slowed} 个敌人迟缓。`);
    return 'succeeded';
  }

  private skillRiftStep(dx: number, dy: number): ActionResult {
    if (dx === 0 && dy === 0) {
      this.pushLog('需要选择一个方向。');
      return 'notAttempted';
    }
    const mx = this.player.x + dx;
    const my = this.player.y + dy;
    const nx = this.player.x + dx * 2;
    const ny = this.player.y + dy * 2;
    const landInb = nx >= 0 && ny >= 0 && nx < this.map.width && ny < this.map.height;
    const midInb = mx >= 0 && my >= 0 && mx < this.map.width && my < this.map.height;
    // Design A — a *true* wall-phase: the MIDDLE tile must be something solid to slip
    // past (a wall, a shut/locked door, a chest); phasing across open ground does
    // nothing (the rift needs a barrier to bite on). The LANDING must be standable.
    const midTile = midInb ? this.map.tiles[my][mx] : TileType.Wall;
    const midIsBarrier =
      midTile === TileType.Wall ||
      midTile === TileType.DoorClosed ||
      midTile === TileType.DoorLocked ||
      midTile === TileType.Chest;
    if (!midIsBarrier) {
      this.pushLog('裂隙没有咬住现实——前方并无可穿之障。');
      return 'notAttempted';
    }
    const landBlocked =
      !landInb ||
      !isWalkable(this.map.tiles[ny][nx]) ||
      this.monsterAt(nx, ny) !== null ||
      (this.merchant !== undefined && this.merchant.x === nx && this.merchant.y === ny);
    if (landBlocked) {
      this.pushLog('裂隙的另一端无处落脚。');
      return 'notAttempted';
    }
    this.player.x = nx;
    this.player.y = ny;
    this.tileLayer.setPosition(PLAY_CX, PLAY_CY);
    this.updateFOV();
    this.refresh();
    playEffect(this, 'spark', PLAY_CX, PLAY_CY, 1.2);
    this.pushLog('你侧身没入裂隙，穿墙而出。');
    this.resolveTile(this.player.x, this.player.y);
    // You phase *past* the barrier but materialise fully onto the far tile — a hidden
    // trap there still springs (no safe blind-phasing onto traps).
    this.triggerTrap(this.player.x, this.player.y);
    if (!this.player.isDead) this.tryPickup();
    return 'succeeded';
  }

  private skillShardThrow(dx: number, dy: number): ActionResult {
    if (dx === 0 && dy === 0) {
      this.pushLog('需要选择一个方向。');
      return 'notAttempted';
    }
    const range = 6;
    let tx = this.player.x;
    let ty = this.player.y;
    let foe: Monster | null = null;
    let hitWall = false;
    for (let i = 1; i <= range; i++) {
      const cx = this.player.x + dx * i;
      const cy = this.player.y + dy * i;
      if (this.blocksShot(cx, cy)) {
        hitWall = true;
        break;
      }
      tx = cx;
      ty = cy;
      const m = this.monsterAt(cx, cy);
      if (m) {
        foe = m;
        break;
      }
    }
    this.spawnProjectile(this.player.x, this.player.y, tx, ty, CRIT_COLOR);
    if (!foe) {
      // The blade was actually thrown — it just hit nothing. A launched-but-missed
      // shot still costs a turn + a charge (no free directional scouting).
      this.pushLog(hitWall ? '碎刃撞在墙上，迸出细响。' : '碎刃没入黑暗，没有命中目标。');
      return 'failedAfterAttempt';
    }
    const dmg = this.player.attack + 4 + Math.floor(this.player.agility / 2) + this.skillSaltBonus;
    foe.takeDamage(dmg);
    applyStatus(foe, 'poisoned', 2, 2);
    const fx = PLAY_CX + (foe.x - this.player.x) * TILE;
    const fy = PLAY_CY + (foe.y - this.player.y) * TILE;
    const spr = this.monsterSprites.get(foe);
    if (spr) this.flashSprite(spr);
    floatNumber(this, fx, fy - 14, `-${dmg}`, CRIT_COLOR);
    this.pushLog(`碎刃命中${foe.name}，造成 ${dmg} 点重创并使其流血。`);
    if (foe.isDead) this.killMonster(foe, fx, fy);
    return 'succeeded';
  }

  private skillLantern(): ActionResult {
    const radius = 6;
    for (let yy = this.player.y - radius; yy <= this.player.y + radius; yy++) {
      for (let xx = this.player.x - radius; xx <= this.player.x + radius; xx++) {
        if (xx < 0 || yy < 0 || xx >= this.map.width || yy >= this.map.height) continue;
        if ((xx - this.player.x) ** 2 + (yy - this.player.y) ** 2 <= radius * radius) {
          this.map.explored[yy][xx] = true;
        }
      }
    }
    const found = this.discoverHidden(this.player.x, this.player.y, radius);
    // 铜灯旅人's lamp also reveals the trap status of nearby chests (req. phase 5).
    let chestsRead = 0;
    for (const c of this.map.chests) {
      if (c.opened || c.trapDiscovered) continue;
      if (Math.max(Math.abs(c.x - this.player.x), Math.abs(c.y - this.player.y)) > radius) continue;
      c.trapDiscovered = true;
      chestsRead++;
    }
    // Benefit: the lamp's glare routs creatures of shadow, the undead, and phasers.
    let scared = 0;
    for (const m of this.monsters) {
      if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > radius) continue;
      if (m.tags.includes('shadow') || m.tags.includes('undead') || m.hasTrait('phasesThroughWalls')) {
        applyStatus(m, 'feared', 2, 1, this.rng);
        scared++;
      }
    }
    // Cost: the light betrays your position — ranged hunters in range close a step.
    let alerted = 0;
    for (const m of this.monsters) {
      if (m.isDead || m.dying || m.aiType !== 'ranged' || this.chebyshev(m.x, m.y) > radius) continue;
      this.stepMonsterToward(m);
      alerted++;
    }
    playEffect(this, 'heal', PLAY_CX, PLAY_CY, 1.6);
    this.refresh();
    const bits = ['铜灯照亮四周'];
    if (found) bits.push(`照见 ${found} 处隐藏机关`);
    if (chestsRead) bits.push(`看穿 ${chestsRead} 只宝箱的虚实`);
    if (scared) bits.push(`吓退 ${scared} 个潜影`);
    if (alerted) bits.push(`却也惊动了 ${alerted} 个远处的猎手`);
    this.pushLog(bits.join('，') + '。');
    return 'succeeded';
  }

  /** Chebyshev (king-move) distance from the player to a tile. */
  private chebyshev(x: number, y: number): number {
    return Math.max(Math.abs(x - this.player.x), Math.abs(y - this.player.y));
  }

  // --- direction (aim) mode ---------------------------------------------

  private enterAim(prompt: string, onPick: (dx: number, dy: number) => void): void {
    this.exitAim();
    this.aiming = true;
    this.aimPick = onPick;
    this.pushLog(`${prompt}（点按方向，× 取消）`);
    const cx = GAME_WIDTH / 2;
    const cy = PLAY_CY + 150;
    const mk = (label: string, dx: number, dy: number, ox: number, oy: number): HtmlButton =>
      new HtmlButton(this, cx + ox, cy + oy, label, () => this.resolveAim(dx, dy), {
        width: 56,
        height: 50,
        fontSize: 22,
        variant: 'primary',
      });
    this.dirButtons = [
      mk('↑', 0, -1, 0, -56),
      mk('↓', 0, 1, 0, 56),
      mk('←', -1, 0, -62, 0),
      mk('→', 1, 0, 62, 0),
      new HtmlButton(this, cx, cy, '×', () => {
        this.exitAim();
        this.pushLog('取消了施放。');
      }, { width: 50, height: 50, fontSize: 20, variant: 'ghost' }),
    ];
  }

  private resolveAim(dx: number, dy: number): void {
    const pick = this.aimPick;
    this.exitAim();
    // Confusion can scramble an aimed direction too (ranged skills / rift-step).
    ({ dx, dy } = this.confuseDir(dx, dy));
    pick?.(dx, dy);
  }

  private exitAim(): void {
    this.aiming = false;
    this.aimPick = null;
    this.dirButtons.forEach((b) => b.destroy());
    this.dirButtons = [];
  }

  // --- ranged attacks ----------------------------------------------------

  /** A tile that stops a shot or sight (a wall; closed/locked doors in phase 7). */
  private blocksShot(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return true;
    const t = this.map.tiles[y][x];
    return t === TileType.Wall || t === TileType.DoorClosed || t === TileType.DoorLocked;
  }

  private rangedReach(): number {
    const w = this.inventory.equipped.mainhand;
    if (!w) return 0;
    const def = getItem(w.defId);
    return def.ranged ? def.range ?? 4 : 0;
  }

  /** A non-adjacent, visible monster within range and clear line of sight. */
  private canRangedAttack(tx: number, ty: number): boolean {
    const reach = this.rangedReach();
    if (reach <= 0) return false;
    const dist = Math.max(Math.abs(tx - this.player.x), Math.abs(ty - this.player.y));
    // Exclude only orthogonally-adjacent tiles (those are a melee step). A
    // diagonally-adjacent foe (Chebyshev 1 but Manhattan 2) has no melee path in a
    // 4-direction game, so it must remain a valid ranged target.
    const manhattan = Math.abs(tx - this.player.x) + Math.abs(ty - this.player.y);
    if (manhattan <= 1 || dist > reach) return false;
    if (!this.map.visible[ty][tx]) return false;
    return hasLineOfSight(this.player.x, this.player.y, tx, ty, (x, y) => this.blocksShot(x, y));
  }

  private playerRangedAttack(foe: Monster): void {
    if (this.consumedByFreeze()) return;
    this.busy = true;
    if (foe.x < this.player.x) this.playerSprite.setFlipX(true);
    else if (foe.x > this.player.x) this.playerSprite.setFlipX(false);
    if (this.anims.exists(heroAnim(this.heroKey, 'attack'))) this.playerSprite.play(heroAnim(this.heroKey, 'attack'), true);
    const fx = PLAY_CX + (foe.x - this.player.x) * TILE;
    const fy = PLAY_CY + (foe.y - this.player.y) * TILE;
    this.spawnProjectile(this.player.x, this.player.y, foe.x, foe.y, Palette.accentBright);

    const result = resolveAttack(this.player, foe, this.rng);
    this.applyAffixHit(foe, result, true);
    const spr = this.monsterSprites.get(foe);
    if (result.dodged) {
      floatNumber(this, fx, fy - 14, '闪避', Palette.textDim);
      this.pushLog(`${foe.name}躲开了你的远程攻击。`);
    } else {
      if (spr) {
        this.flashSprite(spr);
        if (result.crit && !result.killed) this.punchSprite(spr, 1.3);
      }
      burst(this, fx, fy, result.crit ? CRIT_COLOR : 0xeaeaf0, result.crit ? 14 : 7);
      this.hitShake(result.damage, result.crit);
      floatNumber(this, fx, fy - 14, `-${result.damage}`, result.crit ? CRIT_COLOR : Palette.white, { big: result.crit });
      this.pushLog(
        result.crit
          ? `你远程暴击${foe.name}，造成 ${result.damage} 点伤害！`
          : `你射中${foe.name}，造成 ${result.damage} 点伤害。`,
      );
      if (result.killed) this.killMonster(foe, fx, fy);
    }

    this.time.delayedCall(this.ms(150), () => {
      if (this.anims.exists(heroAnim(this.heroKey, 'idle'))) this.playerSprite.play(heroAnim(this.heroKey, 'idle'), true);
      this.commitPlayerAction('ranged');
    });
  }

  /** A small travelling dot along a shot line, in viewport (player-centred) space. */
  private spawnProjectile(x0: number, y0: number, x1: number, y1: number, color: number): void {
    const sx = PLAY_CX + (x0 - this.player.x) * TILE;
    const sy = PLAY_CY + (y0 - this.player.y) * TILE;
    const ex = PLAY_CX + (x1 - this.player.x) * TILE;
    const ey = PLAY_CY + (y1 - this.player.y) * TILE;
    const dot = this.add.circle(sx, sy, 4, color).setDepth(6);
    this.tweens.add({ targets: dot, x: ex, y: ey, duration: this.ms(130), ease: 'Quad.easeOut', onComplete: () => dot.destroy() });
  }

  /** Reveal hidden traps within `radius` (Chebyshev), marking them on the map. */
  private discoverHidden(cx: number, cy: number, radius: number): number {
    let found = 0;
    for (const tr of this.map.traps) {
      if (!tr.hidden) continue;
      if (Math.max(Math.abs(tr.x - cx), Math.abs(tr.y - cy)) <= radius) {
        this.revealTrap(tr);
        found++;
      }
    }
    if (found) this.refresh();
    return found;
  }

  private onSearch(): void {
    if (this.busy || this.menuOpen || this.gameOver || this.aiming) return;
    if (this.consumedByFreeze()) return;
    this.busy = true;
    // 灯芯 affix widens the sweep; 静步 keeps it quiet.
    const inv = this.inventory;
    const radius =
      (this.cls.id === 'copperlamp-wanderer' ? 3 : 1) +
      (inv.hasRule('wicklight') ? Math.round(inv.ruleParam('wicklight', 'radius', 1)) : 0);
    const found = this.discoverHidden(this.player.x, this.player.y, radius);
    this.pushLog(found ? `你仔细搜索，发现了 ${found} 处隐藏机关！` : '你仔细搜索四周，没有发现异常。');
    // 灯芯's noise can draw a nearby foe — 静步 dampens the risk sharply.
    if (inv.hasRule('wicklight')) {
      let attract = inv.ruleParam('wicklight', 'attract', 0.22);
      if (inv.hasRule('silentstep')) attract *= 0.35;
      if (this.rng.chance(attract) && this.lureMonsters(6, false) > 0) {
        this.pushLog('灯芯的响动惊动了什么，有敌人循声而来。');
      }
    }
    this.commitPlayerAction('search');
  }

  // --- doors, traps, chests (phase 7) ------------------------------------

  private openDoor(x: number, y: number): void {
    this.map.tiles[y][x] = TileType.Door;
    this.updateFOV();
    this.refresh();
    this.pushLog('你推开了一扇门。');
    this.busy = true;
    this.commitPlayerAction('open-door');
  }

  /** Force a locked door: a kick whose odds scale with raw strength (attack). */
  private forceDoor(x: number, y: number): void {
    const chance = Phaser.Math.Clamp(0.25 + this.player.attack * 0.03, 0.2, 0.85);
    this.busy = true;
    this.pushLog('你踹向上锁的门。');
    if (this.rng.chance(chance)) {
      this.map.tiles[y][x] = TileType.Door;
      this.updateFOV();
      this.refresh();
      this.cameras.main.shake(90, 0.004);
      this.pushLog('砰！门应声而开。');
    } else {
      this.pushLog('上锁的门纹丝不动，再试一次吧。');
    }
    // A kick is a real attempt: it costs a turn whether it bursts the door or not.
    this.commitPlayerAction('force-door');
  }

  /** Close an adjacent open door (long-press gesture). Returns true if it closed. */
  private tryCloseDoor(x: number, y: number): boolean {
    if (this.map.tiles[y][x] !== TileType.Door) return false;
    if (this.chebyshev(x, y) !== 1) return false;
    if (this.monsterAt(x, y) || this.items.some((e) => e.x === x && e.y === y)) return false;
    this.map.tiles[y][x] = TileType.DoorClosed;
    this.updateFOV();
    this.refresh();
    this.pushLog('你关上了一扇门。');
    this.busy = true;
    this.commitPlayerAction('close-door');
    return true;
  }

  // --- chest interaction (0.3) -------------------------------------------
  // A closed chest is now an obstacle you *bump* (like the merchant): it opens a
  // menu of 检查 / 开锁 / 拆陷阱 / 强开 / 打开 / 取消 rather than auto-resolving on step.
  // Opening the menu is free; every action is a real attempt that closes the menu and
  // costs a turn (so monsters close in while you fiddle — "fight now or pry the box?").
  // 取消 is free. Success odds key off agility / attack, with 裂隙盗 & 铜灯旅人 bonuses.

  /** Whether this class is the lock-and-trap specialist (裂隙盗). */
  private get isThief(): boolean {
    return this.cls.id === 'rift-thief';
  }
  /** Whether this class is the lantern-bearer (铜灯旅人), better at spotting chest traps. */
  private get isLamp(): boolean {
    return this.cls.id === 'copperlamp-wanderer';
  }

  /** 静步 affix: a flat bonus to lock-pick / disarm odds (phase 7). */
  private silentBonus(): number {
    return this.inventory.hasRule('silentstep') ? this.inventory.ruleParam('silentstep', 'bonus', 0.12) : 0;
  }

  private openChestMenu(x: number, y: number): void {
    if (this.busy || this.menuOpen || this.gameOver || this.chestView) return;
    const chest = this.map.chests.find((c) => c.x === x && c.y === y && !c.opened);
    if (!chest) return;
    // A 石龛 altar uses the same Chest tile but a different (bless/curse) interaction.
    if (chest.altar) {
      this.openAltar(chest);
      return;
    }
    this.stopTravel();
    this.menuOpen = true;
    this.chestView = new ChestView(
      this,
      {
        locked: chest.locked,
        trapped: chest.trapped,
        trapDiscovered: !!chest.trapDiscovered,
        trapName: chest.trapType ? TRAP_NAME[chest.trapType] : '',
      },
      {
        onInspect: () => this.chestAction(() => this.chestInspect(chest)),
        onPick: () => this.chestAction(() => this.chestPick(chest)),
        onDisarm: () => this.chestAction(() => this.chestDisarm(chest)),
        onForce: () => this.chestAction(() => this.chestForce(chest)),
        onOpen: () => this.chestAction(() => this.chestOpen(chest)),
        onCancel: () => this.closeChest(),
      },
    );
  }

  private closeChest(): void {
    this.chestView?.destroy();
    this.chestView = undefined;
    this.altarView?.destroy();
    this.altarView = undefined;
    this.menuOpen = false;
  }

  /** Run a chest action: ChestView.finish already tore the menu down — just reset our
   *  state, perform the logic, then spend a turn (monsters get their round in view). */
  private chestAction(perform: () => void): void {
    this.chestView = undefined;
    this.menuOpen = false;
    perform();
    if (this.gameOver || this.player.isDead) return;
    this.busy = true;
    this.commitPlayerAction('chest');
  }

  /** 检查: reveal whether (and what) the chest is trapped. Safe — never springs it. */
  private chestInspect(chest: ChestInstance): void {
    const chance = Phaser.Math.Clamp(
      0.45 + this.player.agility * 0.035 + (this.isThief ? 0.25 : 0) + (this.isLamp ? 0.25 : 0),
      0.25,
      0.95,
    );
    if (this.rng.chance(chance)) {
      chest.trapDiscovered = true;
      if (chest.trapped) {
        const name = chest.trapType ? TRAP_NAME[chest.trapType] : '未知';
        this.pushLog(`你仔细检查，发现箱内暗藏${name}机关。`);
      } else {
        this.pushLog('你仔细检查，确认这只宝箱没有机关。');
      }
    } else {
      this.pushLog('你检查了宝箱，却看不出端倪（可再试）。');
    }
  }

  /** 开锁: pick the lock (agility + 裂隙盗). Failure just leaves it locked. */
  private chestPick(chest: ChestInstance): void {
    if (!chest.locked) {
      this.pushLog('宝箱并未上锁。');
      return;
    }
    const chance = Phaser.Math.Clamp(0.3 + this.player.agility * 0.045 + (this.isThief ? 0.3 : 0) + this.silentBonus(), 0.2, 0.9);
    if (this.rng.chance(chance)) {
      chest.locked = false;
      this.pushLog('咔哒——你撬开了锁。');
    } else {
      this.pushLog('锁芯纹丝不动，你没能撬开（可再试）。');
    }
  }

  /** 拆陷阱: disarm a discovered trap (agility + 裂隙盗, slight 铜灯旅人 edge). Failure may spring it. */
  private chestDisarm(chest: ChestInstance): void {
    if (!chest.trapped) {
      this.pushLog('宝箱上并无机关可拆。');
      return;
    }
    const chance = Phaser.Math.Clamp(
      0.35 + this.player.agility * 0.04 + (this.isThief ? 0.3 : 0) + (this.isLamp ? 0.1 : 0) + this.silentBonus(),
      0.2,
      0.95,
    );
    if (this.rng.chance(chance)) {
      chest.trapped = false;
      this.pushLog('你屏息拆除了宝箱的机关。');
    } else if (this.rng.chance(0.55)) {
      this.pushLog('拆除失手——机关触发了！');
      this.springChestTrap(chest);
    } else {
      this.pushLog('拆除失手，但机关没有触发（可再试）。');
    }
  }

  /** 强开: smash it open (attack-based). Trapped chests spring; some loot is wrecked. */
  private chestForce(chest: ChestInstance): void {
    // Smashing a still-trapped chest springs it regardless of whether the box yields.
    if (chest.trapped) {
      this.springChestTrap(chest);
      if (this.player.isDead) return;
    }
    const chance = Phaser.Math.Clamp(0.3 + this.player.attack * 0.035, 0.25, 0.9);
    this.cameras.main.shake(80, 0.004);
    if (this.rng.chance(chance)) {
      chest.locked = false;
      this.pushLog('你猛力砸下，宝箱应声崩裂！');
      this.generateChestLoot(chest, true); // brute force wrecks part of the haul
    } else {
      this.pushLog('宝箱被你砸得变形，却没能撬开（可再试）。');
    }
  }

  /** 打开: open an unlocked chest. An undisarmed trap springs first, then loot spills. */
  private chestOpen(chest: ChestInstance): void {
    if (chest.locked) {
      this.pushLog('宝箱锁着，先开锁或强开。');
      return;
    }
    if (chest.trapped) {
      this.springChestTrap(chest);
      if (this.player.isDead) return;
    }
    this.generateChestLoot(chest, false);
  }

  /** Spring a chest's trap on the player (reuses the trap damage/status path). */
  private springChestTrap(chest: ChestInstance): void {
    const kind: TrapKind = chest.trapType ?? this.rng.pick(['spike', 'poison', 'snare'] as TrapKind[]);
    chest.trapped = false; // consumed — chests don't re-trap
    chest.trapDiscovered = true;
    this.applyTrapToPlayer({ x: chest.x, y: chest.y, kind, hidden: false });
  }

  /** Produce a chest's loot exactly once; `damaged` (强开) destroys ~40% of it. */
  private generateChestLoot(chest: ChestInstance, damaged: boolean): void {
    if (chest.lootGenerated) return; // never double-produce
    chest.lootGenerated = true;
    chest.opened = true;
    this.map.tiles[chest.y][chest.x] = TileType.ChestOpen;
    let loot = rollChestLoot(this.depth, this.rng);
    let destroyed = 0;
    if (damaged) {
      const kept: string[] = [];
      for (const id of loot) {
        if (this.rng.chance(0.4)) destroyed++;
        else kept.push(id);
      }
      loot = kept;
    }
    for (const id of loot) this.spawnItem(id, chest.x, chest.y, false);
    this.refresh();
    playEffect(this, 'spark', PLAY_CX, PLAY_CY - 6, 1.2);
    const haul = loot.length ? `散落出 ${loot.map((id) => getItem(id).name).join('、')}` : '却空空如也';
    const note = destroyed ? `（${destroyed} 件宝物在砸击中损毁）` : '';
    this.pushLog(`宝箱打开，${haul}${note}。`);
  }

  // --- 石龛 altar (0.3 phase 6) -------------------------------------------

  private openAltar(chest: ChestInstance): void {
    if (this.busy || this.menuOpen || this.gameOver || this.altarView) return;
    this.stopTravel();
    this.menuOpen = true;
    this.altarView = new AltarView(this, {
      onPray: () => {
        this.altarView = undefined;
        this.menuOpen = false;
        this.altarPray(chest);
        if (this.gameOver || this.player.isDead) return;
        this.busy = true;
        this.commitPlayerAction('altar');
      },
      onLeave: () => {
        this.altarView = undefined;
        this.menuOpen = false;
      },
    });
  }

  /** The altar gamble: bless or curse a random piece of gear, with a slim ill omen. */
  private altarPray(chest: ChestInstance): void {
    chest.opened = true;
    this.map.tiles[chest.y][chest.x] = TileType.ChestOpen;
    this.refresh();
    playEffect(this, 'heal', PLAY_CX, PLAY_CY, 1.4);
    const target = this.randomGearInstance();
    const roll = this.rng.next();
    if (roll < 0.45 && target) {
      const wasCursed = target.beatitude === 'cursed';
      target.beatitude = 'blessed';
      target.identified = true;
      applyStatus(this.player, 'regenerating', 4, 2);
      this.pushLog(
        wasCursed
          ? `圣光萦绕，${this.inventory.name(target)}的诅咒被洗去，化作祝福。`
          : `圣光萦绕，${this.inventory.name(target)}受到祝福，你周身泛起暖意。`,
      );
    } else if (roll < 0.8 && target) {
      target.beatitude = 'cursed';
      target.identified = true;
      applyStatus(this.player, 'vulnerable', 3, 1);
      this.pushLog(`阴影自石龛渗出，${this.inventory.name(target)}染上了诅咒。`);
    } else {
      // Ill omen — a summoned foe, or (no room / no gear) a lingering hex.
      if (!this.summonNearPlayer()) {
        applyStatus(this.player, 'feared', 3, 1, this.rng);
        this.pushLog('石龛发出不祥的嗡鸣，恐惧攫住了你。');
      }
    }
    this.updateHud();
  }

  /** A random gear instance carried or worn (for the altar gamble); null if none. */
  private randomGearInstance(): ItemInstance | null {
    const gear = this.inventory.allInstances().filter((i) => isGear(getItem(i.defId).type));
    return gear.length ? this.rng.pick(gear) : null;
  }

  /** Summon a depth-appropriate monster on a free tile beside the player. */
  private summonNearPlayer(): boolean {
    const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => ({ x: this.player.x + dx, y: this.player.y + dy }))
      .filter(
        (p) =>
          p.x >= 0 && p.y >= 0 && p.x < this.map.width && p.y < this.map.height &&
          isWalkable(this.map.tiles[p.y][p.x]) && !this.monsterAt(p.x, p.y),
      );
    if (!spots.length) return false;
    const spot = this.rng.pick(spots);
    const m = new Monster(getMonster(this.rng.pick(spawnPool(this.depth))), spot.x, spot.y);
    this.monsters.push(m);
    this.addMonsterSprite(m);
    this.pushLog('石龛索取祭品，一头环窟之物循味而至！');
    return true;
  }

  /** Show a special room's one-time ambiance line the first time the player enters it. */
  private checkSpecialRoom(): void {
    const rooms = this.map.specialRooms;
    if (!rooms) return;
    for (const sr of rooms) {
      if (
        this.player.x >= sr.x && this.player.x < sr.x + sr.w &&
        this.player.y >= sr.y && this.player.y < sr.y + sr.h
      ) {
        const key = `${sr.x},${sr.y}`;
        if (!this.announcedRooms.has(key)) {
          this.announcedRooms.add(key);
          this.pushLog(sr.ambiance);
        }
      }
    }
  }

  private trapAt(x: number, y: number): TrapInstance | undefined {
    return this.map.traps.find((t) => t.x === x && t.y === y);
  }

  private revealTrap(tr: TrapInstance): void {
    tr.hidden = false;
    if (this.map.tiles[tr.y][tr.x] === TileType.Floor) this.map.tiles[tr.y][tr.x] = TileType.Trap;
  }

  private consumeTrap(tr: TrapInstance): void {
    const i = this.map.traps.indexOf(tr);
    if (i !== -1) this.map.traps.splice(i, 1);
    if (this.map.tiles[tr.y][tr.x] === TileType.Trap) this.map.tiles[tr.y][tr.x] = TileType.Floor;
    this.refresh();
  }

  /** Attempt to disarm a revealed trap (agility-based); failure springs it. */
  private disarmTrap(x: number, y: number): void {
    this.busy = true;
    const tr = this.trapAt(x, y);
    if (!tr) {
      if (this.map.tiles[y][x] === TileType.Trap) this.map.tiles[y][x] = TileType.Floor;
      this.refresh();
      this.commitPlayerAction('disarm-trap');
      return;
    }
    this.pushLog('你俯身拆除机关。');
    const chance = Phaser.Math.Clamp(0.4 + this.player.agility * 0.04 + this.silentBonus(), 0.2, 0.9);
    if (this.rng.chance(chance)) {
      this.consumeTrap(tr);
      this.pushLog('你小心地拆除了陷阱。');
    } else {
      this.consumeTrap(tr);
      this.pushLog('拆除失手，陷阱触发了！');
      this.applyTrapToPlayer(tr);
      if (this.gameOver) return;
    }
    // Disarming is a committed attempt — success or a sprung trap both cost a turn.
    this.commitPlayerAction('disarm-trap');
  }

  /** The player steps on (or springs) a trap. Hidden traps are revealed first. */
  private triggerTrap(x: number, y: number): void {
    const tr = this.trapAt(x, y);
    if (!tr) return;
    this.consumeTrap(tr);
    this.applyTrapToPlayer(tr);
  }

  private applyTrapToPlayer(tr: TrapInstance): void {
    this.stopTravel();
    switch (tr.kind) {
      case 'spike': {
        const raw = this.rng.range(3, 5 + Math.floor(this.depth / 2));
        const dealt = Math.max(1, raw - Math.floor(this.player.defense / 2));
        this.player.takeDamage(dealt);
        this.flashDamage();
        this.flashSprite(this.playerSprite);
        floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${dealt}`, Palette.danger);
        this.pushLog(`尖刺陷阱弹出，你受到 ${dealt} 点伤害！`);
        break;
      }
      case 'poison': {
        const dealt = this.rng.range(1, 3);
        this.player.takeDamage(dealt);
        applyStatus(this.player, 'poisoned', 3, 2, this.rng);
        floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${dealt}`, Palette.success);
        this.pushLog('毒气自陷阱喷涌而出，你中毒了！');
        break;
      }
      case 'teleport': {
        if (this.blinkPlayer()) this.pushLog('传送陷阱将你掷向了别处。');
        else this.pushLog('传送陷阱微微震颤，却无处可送。');
        break;
      }
      case 'snare': {
        applyStatus(this.player, 'slowed', 3, 1, this.rng);
        this.pushLog('陷阱的索套缚住你的脚步，行动变得迟缓。');
        break;
      }
    }
    this.cameras.main.shake(80, 0.004);
    this.updateHud();
    if (this.player.isDead && !this.tryDeathSave()) {
      this.deathCause = '致命的陷阱';
      this.die();
    }
  }

  private applyTrapToMonster(m: Monster, tr: TrapInstance): void {
    const sx = PLAY_CX + (m.x - this.player.x) * TILE;
    const sy = PLAY_CY + (m.y - this.player.y) * TILE;
    switch (tr.kind) {
      case 'spike': {
        const dmg = this.rng.range(3, 6);
        m.takeDamage(dmg);
        floatNumber(this, sx, sy - 12, `-${dmg}`, Palette.danger);
        break;
      }
      case 'poison':
        applyStatus(m, 'poisoned', 3, 2, this.rng);
        break;
      case 'snare':
        applyStatus(m, 'slowed', 3, 1, this.rng);
        break;
      case 'teleport': {
        const spot = this.randomFloorTile();
        if (spot) {
          m.x = spot.x;
          m.y = spot.y;
        }
        break;
      }
    }
    this.pushLog(`${m.name}触发了陷阱。`);
    if (m.isDead) this.killMonster(m, sx, sy);
  }

  /** Monsters that walked onto a trap this round spring it (req. phase 7). */
  private resolveMonsterTraps(events: TurnEvent[]): void {
    for (const ev of events) {
      if (ev.action.type !== 'move') continue;
      const m = ev.monster;
      if (m.isDead || m.dying) continue;
      const tr = this.trapAt(m.x, m.y);
      if (!tr) continue;
      this.consumeTrap(tr);
      this.applyTrapToMonster(m, tr);
    }
  }

  private randomFloorTile(): Vec | null {
    for (let tries = 0; tries < 60; tries++) {
      const x = this.rng.range(0, this.map.width - 1);
      const y = this.rng.range(0, this.map.height - 1);
      if (this.map.tiles[y][x] === TileType.Floor && !this.monsterAt(x, y) && !(x === this.player.x && y === this.player.y)) {
        return { x, y };
      }
    }
    return null;
  }

  /** Teleport the player to a random floor tile within `radius`. */
  private blinkPlayer(radius = Math.max(6, this.radius)): boolean {
    const spots: Array<[number, number]> = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = this.player.x + dx;
        const ny = this.player.y + dy;
        if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height) continue;
        if (this.map.tiles[ny][nx] === TileType.Floor && !this.monsterAt(nx, ny) && !(nx === this.player.x && ny === this.player.y)) {
          spots.push([nx, ny]);
        }
      }
    }
    if (!spots.length) return false;
    const [nx, ny] = this.rng.pick(spots);
    this.player.x = nx;
    this.player.y = ny;
    this.tileLayer.setPosition(PLAY_CX, PLAY_CY);
    this.updateFOV();
    this.refresh();
    return true;
  }

  // --- pickups -----------------------------------------------------------

  /** Gold is collected automatically; other items go to the bag (req. 8). */
  private tryPickup(): void {
    const idx = this.items.findIndex((e) => e.x === this.player.x && e.y === this.player.y);
    if (idx === -1) return;
    const ent = this.items[idx];
    const def = getItem(ent.inst.defId);

    if (def.type === 'gold') {
      if (!Settings.get().autoPickupGold) return; // setting off: leave the coins on the floor
      const amount = (def.effects.gold ?? 1) + this.rng.range(0, 2 + this.depth);
      this.inventory.addGold(amount);
      this.items.splice(idx, 1);
      ent.sprite.destroy();
      playEffect(this, 'spark', PLAY_CX, PLAY_CY - 6, 0.8);
      floatNumber(this, PLAY_CX, PLAY_CY - 18, `+${amount} 金`, Palette.accentBright);
      this.pushLog(`你拾起了 ${amount} 枚金币。`);
      return;
    }

    const label = this.inventory.name(ent.inst);
    if (this.inventory.isFull() && !this.inventory.items.some((i) => i.defId === ent.inst.defId && i.beatitude === ent.inst.beatitude)) {
      this.pushLog(`背包已满，无法拾起${label}（在背包中使用物品以腾出空间）。`);
      return;
    }
    this.inventory.add(ent.inst);
    this.items.splice(idx, 1);
    ent.sprite.destroy();
    playEffect(this, 'spark', PLAY_CX, PLAY_CY - 6, 0.8);
    this.pushLog(`你拾起了${label}。`);
  }

  // --- action buttons ----------------------------------------------------

  private onWait(): void {
    if (this.busy || this.menuOpen) return;
    if (this.consumedByFreeze()) return;
    this.busy = true;
    this.pushLog('你停下脚步，戒备四周。');
    this.commitPlayerAction('wait');
  }

  private onInventory(): void {
    if (this.busy || this.menuOpen) return;
    this.stopTravel();
    this.menuOpen = true;
    this.invView = new InventoryView(this, this.inventory, {
      onUse: (item) => this.useItem(item),
      onEquip: (item) => this.equipItem(item),
      onUnequip: (slot) => this.unequipSlot(slot),
      onDrop: (item) => this.dropItem(item),
      onClose: () => this.closeInventory(),
    });
  }

  private closeInventory(): void {
    this.invView?.destroy();
    this.invView = undefined;
    this.menuOpen = false;
    this.persist();
  }

  private useItem(item: ItemInstance): void {
    const res = this.inventory.use(item);
    if (res.message) this.pushLog(res.message);
    // Resolve the world effect (which logs what happened) BEFORE the identity reveal,
    // so an unknown item reads "the effect … then you recognise what it was" (0.3).
    if (res.scroll) this.applyScroll(res.scroll, res.beatitude ?? 'uncursed');
    else if (res.potion) this.applyPotion(res.potion, res.beatitude ?? 'uncursed');
    if (res.revealName) this.pushLog(`……你认出了这是${res.revealName}。`);
    this.updateHud();
    if (res.ok) this.commitInventoryAction();
  }

  // 0.3 action economy — Plan A: equipping, unequipping and dropping are real
  // world actions, so a *successful* one spends a turn just like using a consumable.
  // commitInventoryAction closes the bag first, so the monster round plays out in
  // view rather than unseen behind the overlay (and InventoryView.afterAction sees
  // `alive === false` and skips its rebuild). A failed attempt — cursed gear that
  // won't swap or unequip — changes nothing and stays free. Plan A is chosen over
  // the "free while no enemy is visible" variant for a clearer, always-consistent
  // rule (the stated preference).
  private equipItem(item: ItemInstance): void {
    const res = this.inventory.equip(item);
    if (res.message) this.pushLog(res.message);
    this.updateHud();
    if (res.ok) this.commitInventoryAction();
  }

  private unequipSlot(slot: EquipSlot): void {
    const res = this.inventory.unequip(slot);
    if (res.message) this.pushLog(res.message);
    // 赦链: forcing a cursed piece off exacts a price — a bite of HP + vulnerable.
    if (res.unchainCost) {
      const bite = Math.max(1, Math.round(this.player.maxHp * 0.1));
      this.player.takeDamage(bite);
      applyStatus(this.player, 'vulnerable', 3, 1);
      floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${bite}`, Palette.danger);
      this.pushLog(`挣脱诅咒的代价随之而来：你失去 ${bite} 点生命，并变得易伤。`);
    }
    this.updateHud();
    if (res.ok) this.commitInventoryAction();
  }

  /** Drop a bag item onto the floor (frees a full bag; recoverable by walking back). */
  private dropItem(item: ItemInstance): void {
    const label = this.inventory.name(item);
    this.inventory.remove(item);
    this.placeFloorItem(item, this.player.x, this.player.y);
    this.pushLog(`你把${label}丢在了脚边。`);
    this.commitInventoryAction();
  }

  /**
   * A successful inventory action (use / equip / unequip / drop) costs one turn:
   * close the overlay so the world is visible, then funnel through the unified
   * commit so the monsters act exactly once. Opening the bag never costs a turn.
   */
  private commitInventoryAction(): void {
    this.closeInventory();
    if (this.gameOver || this.player.isDead) return;
    this.busy = true;
    this.commitPlayerAction('inventory');
  }

  /** Resolve a scroll's world effect, scaled by its blessing / curse (req. phase 4). */
  private applyScroll(action: ScrollAction, beatitude: Beatitude = 'uncursed'): void {
    const blessed = beatitude === 'blessed';
    const cursed = beatitude === 'cursed';
    switch (action) {
      case 'reveal':
        for (let y = 0; y < this.map.height; y++) this.map.explored[y].fill(true);
        if (blessed) this.inventory.identifyAllCarried();
        this.refresh();
        this.pushLog(blessed ? '环窟在你眼前徐徐展开，随身之物也一并看清。' : '环窟在你眼前徐徐展开。');
        break;
      case 'smite': {
        const targets = this.monsters.filter((mob) => !mob.isDead && !mob.dying && this.map.visible[mob.y][mob.x]);
        if (!targets.length) {
          this.pushLog('视野内没有可灼伤的敌人。');
          break;
        }
        const dmg = Math.max(1, Math.round((6 + this.player.magic / 2) * (blessed ? 1.5 : cursed ? 0.6 : 1)));
        for (const mob of targets) {
          mob.takeDamage(dmg);
          const sx = PLAY_CX + (mob.x - this.player.x) * TILE;
          const sy = PLAY_CY + (mob.y - this.player.y) * TILE;
          playEffect(this, 'magic', sx, sy, 1.0);
          floatNumber(this, sx, sy - 12, `-${dmg}`, CRIT_COLOR);
          if (mob.isDead) this.killMonster(mob, sx, sy);
        }
        this.pushLog(`灼光降下，灼伤了 ${targets.length} 个敌人。`);
        break;
      }
      case 'blink': {
        if (this.blinkPlayer()) this.pushLog('一阵眩晕，你出现在别处。');
        else this.pushLog('周围无处可去。');
        break;
      }
      case 'vigor': {
        const before = this.player.hp;
        this.player.heal(cursed ? Math.round(this.player.maxHp * 0.5) : this.player.maxHp);
        this.pushLog(`秘力涌动，恢复了 ${this.player.hp - before} 点生命。`);
        this.updateHud();
        break;
      }
      case 'identify': {
        // 0.3 rebalance: no more whole-bag reveal. Uncursed reveals one item, blessed
        // three; cursed still reveals one but rattles you (confused).
        const count = blessed ? 3 : 1;
        const names = this.inventory.identifyFirst(count);
        if (names.length) this.pushLog(`鉴物卷轴生效，看清了：${names.join('、')}。`);
        else this.pushLog('卷轴诵毕，却没有秘密回应你。'); // scroll still consumed
        if (cursed) {
          applyStatus(this.player, 'confused', 3, 1, this.rng);
          this.pushLog('字迹在眼前扭动刺目，你的心神一阵紊乱。');
          this.updateHud();
        }
        break;
      }
      case 'uncurse': {
        if (cursed) {
          const victim = this.inventory.curseRandomEquipped();
          if (victim) {
            this.pushLog(`解缚之力逆转，${victim}缠上了新的诅咒！`);
          } else {
            applyStatus(this.player, 'vulnerable', 3, 1);
            this.pushLog('解缚之力无处着力，反噬使你变得易伤。');
            this.updateHud();
          }
          break;
        }
        if (blessed) {
          const n = this.inventory.uncurseEquipped();
          this.pushLog(n ? `解缚之力大盛，${n} 件装备的诅咒尽数解除。` : '身上并无被诅咒的装备。');
        } else {
          const name = this.inventory.uncurseFirst();
          this.pushLog(name ? `解缚卷轴生效，${name}的诅咒被解除。` : '身上并无被诅咒的装备。');
        }
        break;
      }
      case 'lure': {
        // 引噪: a din draws nearby creatures a step toward you (blessed also muddles
        // them; cursed reaches farther). A risk — or a way to herd foes for an AoE.
        const radius = cursed ? 8 : 5;
        const n = this.lureMonsters(radius, blessed);
        this.refresh();
        if (n) this.pushLog(blessed ? `刺响炸开，引来 ${n} 个敌人，并搅乱了它们的心神。` : `刺响炸开，引来了 ${n} 个敌人的注意。`);
        else this.pushLog('刺响在空荡的回廊里回荡，无人应答。');
        break;
      }
      case 'displace': {
        // 错位: a random blink; cursed instead swaps you with the nearest foe.
        if (cursed) {
          if (this.swapWithNearestMonster()) this.pushLog('空间猛地错位，你与一头敌人对调了位置！');
          else if (this.blinkPlayer()) this.pushLog('空间错位，你被抛向别处。');
          else this.pushLog('空间扭动，却无处可去。');
        } else if (this.blinkPlayer()) {
          this.pushLog(blessed ? '空间柔和地折叠，你安然挪到了别处。' : '空间错位，你被掷往别处。');
        } else {
          this.pushLog('周围无处可去。');
        }
        break;
      }
      case 'dimlight': {
        // 裂灯: vision shrinks (目盲). Blessed reveals nearby traps before it dims;
        // cursed dims longer and adds fear.
        if (blessed) {
          const found = this.discoverHidden(this.player.x, this.player.y, 6);
          applyStatus(this.player, 'blinded', 3, 1);
          this.updateFOV();
          this.refresh();
          this.pushLog(found ? `灯火湮灭前照见了 ${found} 处隐藏机关，随后四周归于昏暗。` : '灯火湮灭前扫过四周，随后归于昏暗。');
        } else {
          applyStatus(this.player, 'blinded', cursed ? 7 : 5, 1);
          if (cursed) applyStatus(this.player, 'feared', 3, 1, this.rng);
          this.updateFOV();
          this.refresh();
          this.pushLog(cursed ? '光亮尽数剥落，黑暗与恐惧一同攫住你。' : '光亮自四周剥落，你的视野骤然收窄。');
        }
        this.updateHud();
        break;
      }
    }
    // A cursed scroll without its own backfire above leaves you briefly vulnerable.
    if (cursed && (action === 'reveal' || action === 'smite' || action === 'blink' || action === 'vigor')) {
      applyStatus(this.player, 'vulnerable', 3, 1);
      this.pushLog('卷轴的诅咒反噬，你一阵恍惚，变得易伤。');
      this.updateHud();
    }
  }

  /**
   * Resolve a status / double-edged potion's world effect, scaled by beatitude (0.3).
   * Each is a real risk-or-tool: venom (poison, blessed splashes foes), mist (confuse,
   * blessed muddles foes too), scald (burn — blessed breathes fire at foes instead),
   * riftheart (lose HP for regeneration, cursed only the loss + vulnerable).
   */
  private applyPotion(action: PotionAction, beatitude: Beatitude = 'uncursed'): void {
    const blessed = beatitude === 'blessed';
    const cursed = beatitude === 'cursed';
    switch (action) {
      case 'venom': {
        const turns = blessed ? 2 : cursed ? 6 : 4;
        applyStatus(this.player, 'poisoned', turns, cursed ? 3 : 2, this.rng);
        this.flashSprite(this.playerSprite);
        this.pushLog('黑血灌入喉中，毒素在血脉里蔓延——你中毒了。');
        if (blessed) {
          let hit = 0;
          for (const m of this.monsters) {
            if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > 1) continue;
            applyStatus(m, 'poisoned', 2, 1, this.rng);
            hit++;
          }
          if (hit) this.pushLog(`你向四周喷出毒沫，${hit} 个邻近的敌人也中了毒。`);
        }
        break;
      }
      case 'mist': {
        const turns = cursed ? 6 : blessed ? 2 : 4;
        applyStatus(this.player, 'confused', turns, 1, this.rng);
        this.pushLog('一团灰雾涌上心头，你的方向感开始紊乱。');
        if (blessed) {
          let hit = 0;
          for (const m of this.monsters) {
            if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > 2) continue;
            applyStatus(m, 'confused', 3, 1, this.rng);
            hit++;
          }
          if (hit) this.pushLog(`迷雾向外弥散，${hit} 个敌人也陷入了混乱。`);
        }
        break;
      }
      case 'scald': {
        if (blessed) {
          let hit = 0;
          for (const m of this.monsters) {
            if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > 1) continue;
            applyStatus(m, 'burning', 3, 2, this.rng);
            const sx = PLAY_CX + (m.x - this.player.x) * TILE;
            const sy = PLAY_CY + (m.y - this.player.y) * TILE;
            playEffect(this, 'magic', sx, sy, 1.0);
            hit++;
          }
          this.pushLog(hit ? `你张口喷出一道烈焰，${hit} 个邻近的敌人被点燃！` : '你喷出一道烈焰，却没烧到谁。');
        } else {
          applyStatus(this.player, 'burning', cursed ? 6 : 4, cursed ? 3 : 2, this.rng);
          this.flashSprite(this.playerSprite);
          this.pushLog('烈焰自喉间炸开，你被自己点燃了！');
        }
        break;
      }
      case 'riftheart': {
        const loss = cursed ? 8 : 6;
        this.player.takeDamage(loss);
        this.flashDamage();
        this.flashSprite(this.playerSprite);
        floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${loss}`, Palette.danger);
        if (cursed) {
          applyStatus(this.player, 'vulnerable', 3, 1);
          this.pushLog('裂心之力撕扯心脉，只余痛楚与脆弱。');
        } else {
          applyStatus(this.player, 'regenerating', blessed ? 6 : 4, blessed ? 3 : 2);
          this.pushLog('剧痛过后，一股暖流涌入伤口，开始持续愈合。');
        }
        this.updateHud();
        if (this.player.isDead && !this.tryDeathSave()) {
          this.deathCause = '裂心之痛';
          this.die();
        }
        break;
      }
    }
    this.updateHud();
  }

  /** 引噪卷轴: draw monsters within `radius` a step toward the player (+ optional confuse). */
  private lureMonsters(radius: number, confuse: boolean): number {
    let n = 0;
    for (const m of this.monsters) {
      if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > radius) continue;
      n++;
      if (confuse) applyStatus(m, 'confused', 3, 1, this.rng);
      this.stepMonsterToward(m);
    }
    return n;
  }

  /** One greedy step of a monster toward the player onto a free, walkable tile. */
  private stepMonsterToward(m: Monster): void {
    const sx = Math.sign(this.player.x - m.x);
    const sy = Math.sign(this.player.y - m.y);
    const adx = Math.abs(this.player.x - m.x);
    const ady = Math.abs(this.player.y - m.y);
    const order: Array<[number, number]> = adx >= ady ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
    for (const [dx, dy] of order) {
      if (dx === 0 && dy === 0) continue;
      const nx = m.x + dx;
      const ny = m.y + dy;
      if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height) continue;
      if (!isWalkable(this.map.tiles[ny][nx]) || this.monsterAt(nx, ny)) continue;
      if (nx === this.player.x && ny === this.player.y) continue;
      m.x = nx;
      m.y = ny;
      return;
    }
  }

  /** 错位卷轴 (cursed): swap the player with the nearest living monster. */
  private swapWithNearestMonster(): boolean {
    let best: Monster | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (m.isDead || m.dying) continue;
      const d = this.chebyshev(m.x, m.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) return false;
    const px = this.player.x;
    const py = this.player.y;
    this.player.x = best.x;
    this.player.y = best.y;
    best.x = px;
    best.y = py;
    this.tileLayer.setPosition(PLAY_CX, PLAY_CY);
    this.updateFOV();
    this.refresh();
    return true;
  }

  /** Lines listing every equipped slot (two per row) for the character panel. */
  private equippedSummary(): string[] {
    const filled = EQUIP_SLOTS.filter((sl) => this.inventory.equipped[sl]);
    if (!filled.length) return ['装备　（空）'];
    const cell = (sl: EquipSlot): string => `${SLOT_LABEL[sl]} ${this.inventory.name(this.inventory.equipped[sl]!)}`;
    const lines: string[] = [];
    for (let i = 0; i < filled.length; i += 2) {
      lines.push(filled[i + 1] ? `${cell(filled[i])}　${cell(filled[i + 1])}` : cell(filled[i]));
    }
    return lines;
  }

  private onCharacter(): void {
    const c = this.cls;
    const p = this.player;
    const s = c.skill;
    const skillTag = s.kind === 'active' ? '主动' : '被动';
    const skillCost: string[] = [];
    if (s.manaCost) skillCost.push(`耗法 ${s.manaCost}`);
    if (s.usesPerFloor !== undefined) skillCost.push(`本层剩余 ${this.skillUses}/${s.usesPerFloor}`);
    const details = statusDetails(p);
    const body = [
      `${c.name} · ${c.title}`,
      '',
      `等级　${p.level}　·　经验 ${p.exp} / ${p.expToNext}`,
      `生命　${p.hp} / ${p.maxHp}` + (p.maxMana > 0 ? `　　法力　${p.mana} / ${p.maxMana}` : ''),
      `攻击　${p.attack}　　防御　${p.defense}`,
      `敏捷　${p.agility}　　法术　${p.magic}　　金币　${this.inventory.gold}`,
      ...(details.length ? [`状态　${details.join('　')}`] : []),
      '',
      ...this.equippedSummary(),
      '',
      `技能 · ${s.name}（${skillTag}${skillCost.length ? '，' + skillCost.join('，') : ''}）`,
      s.description,
      '',
      `当前　第 ${this.depth} 层　·　步数 ${this.turn}`,
    ].join('\n');
    new Modal(this, '角色', body);
  }

  private onLog(): void {
    const recent = this.logLines.slice(-12);
    new Modal(this, '日志', recent.length ? recent.join('\n') : '（暂无记录）');
  }

  private onDescend(): void {
    this.descend();
  }

  private openMenu(): void {
    if (this.busy || this.menuOpen) return;
    this.stopTravel();
    this.menuOpen = true;
    new GameMenu(this, {
      onResume: () => {
        this.menuOpen = false;
      },
      onMap: () => this.openMap(),
      onSettings: () => this.openSettings(),
      onQuit: () => {
        this.persist();
        this.scene.start(SceneKeys.MainMenu);
      },
    });
  }

  /** Full-floor minimap (explored only). Opened from the in-game menu. */
  private openMap(): void {
    if (this.mapView) return;
    this.menuOpen = true;
    this.mapView = new MapView(this, this.map, this.player, this.depth, () => {
      this.mapView = undefined;
      this.menuOpen = false;
    });
  }

  /** Settings mid-run, reusing the menu overlay from the title screen. */
  private openSettings(): void {
    if (this.settingsView) return;
    this.menuOpen = true;
    this.settingsView = new SettingsView(this, () => {
      // SettingsView.close() tears down its own buttons but NOT its container, so
      // the owner must destroy it — otherwise the (button-less) panel stays stuck
      // on screen with no way to dismiss it.
      this.settingsView?.destroy();
      this.settingsView = undefined;
      this.animScale = Settings.animScale();
      this.menuOpen = false;
    });
  }

  // --- merchant / shop ---------------------------------------------------

  /** Open the merchant's shop (reached by stepping into the merchant). */
  private openShop(): void {
    if (this.busy || this.menuOpen || this.shopView || !this.merchant) return;
    this.stopTravel();
    this.menuOpen = true;
    this.shopView = new ShopView(this, this.inventory, this.shopStock, {
      onBuy: (entry) => this.buyFromShop(entry),
      onClose: () => {
        this.shopView = undefined;
        this.menuOpen = false;
        this.persist();
      },
    });
  }

  /**
   * Buy one ware: charge gold, add it to the bag, then spend a turn (0.3 action
   * economy — a purchase is a real action). The shop stays open so several wares
   * can be bought in a row; each *successful* buy advances exactly one monster
   * round (a busy-guard stops a double-tap from committing twice — the would-be
   * double-turn risk here). Validation failures (sold out / no gold / full bag)
   * change nothing and are free. The round plays out behind the dimmed overlay, so
   * lingering at a merchant while enemies close in carries real risk.
   */
  private buyFromShop(entry: ShopEntry): void {
    if (this.busy || this.gameOver) return; // mid-commit re-entrancy guard
    if (entry.sold) return;
    if (this.inventory.gold < entry.price) {
      this.pushLog('金币不足。');
      return;
    }
    if (!this.inventory.add(entry.inst)) {
      this.pushLog('背包已满，先腾出空间（可丢弃物品）。');
      return;
    }
    const def = getItem(entry.inst.defId);
    if (def.type === 'potion' || def.type === 'scroll') this.inventory.ident.identify(entry.inst.defId);
    this.inventory.gold -= entry.price;
    const label = this.inventory.name(entry.inst);
    entry.sold = true;
    this.pushLog(`你买下了${label}（-${entry.price} 金）。`);
    this.updateHud();
    if (this.gameOver || this.player.isDead) return;
    this.busy = true;
    this.commitPlayerAction('buy');
  }

  // --- HUD / log ---------------------------------------------------------

  private updateHud(): void {
    this.depthText.setText(`第 ${this.depth} / ${MAX_DEPTH} 层`);
    const bx = 42;
    const by = 34;
    const bw = GAME_WIDTH - bx - 76;
    const bh = 12;
    const ratio = Phaser.Math.Clamp(this.player.hp / this.player.maxHp, 0, 1);
    const fillColor = ratio > 0.5 ? Palette.success : ratio > 0.25 ? Palette.accent : Palette.danger;
    this.hpBar.clear();
    this.hpBar.fillStyle(Palette.panelDown, 1);
    this.hpBar.fillRoundedRect(bx, by, bw, bh, 5);
    if (ratio > 0) {
      this.hpBar.fillStyle(fillColor, 1);
      this.hpBar.fillRoundedRect(bx, by, Math.max(6, bw * ratio), bh, 5);
    }
    this.hpBar.lineStyle(1, Palette.border, 1);
    this.hpBar.strokeRoundedRect(bx, by, bw, bh, 5);
    this.hpText.setText(`Lv ${this.player.level}　${this.player.hp}/${this.player.maxHp}`);
    this.hpText.setPosition(bx + bw / 2, by + bh / 2);

    const fx: string[] = [];
    if (this.player.maxMana > 0) fx.push(`法 ${this.player.mana}/${this.player.maxMana}`);
    if (this.comboCount >= 2) fx.push(`连击x${this.comboCount}`); // 铁拳僧 combo readout
    const strip = statusStrip(this.player);
    if (strip) fx.push(strip);
    this.fxText.setText(fx.join('  '));
  }

  private pushLog(message: string): void {
    this.logLines.push(message);
    if (this.logLines.length > 60) this.logLines.shift();
    this.statusText.setText(message);
  }

  private persist(): void {
    const inv = this.inventory.serialize();
    const run: RunState = {
      classId: this.cls.id,
      depth: this.depth,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      attack: this.player.attack,
      defense: this.player.defense,
      agility: this.player.agility,
      magic: this.player.magic,
      mana: this.player.mana,
      maxMana: this.player.maxMana,
      level: this.player.level,
      exp: this.player.exp,
      gold: inv.gold,
      bag: inv.bag,
      equip: inv.equip,
      ident: this.inventory.ident.serialize(),
      playerStatuses: serializeStatuses(this.player),
      turn: this.turn,
      kills: this.kills,
      floorSeed: this.floorSeed,
      floor: this.snapshotFloor(),
      createdAt: this.createdAt,
    };
    SaveManager.saveRun(run);
  }
}
