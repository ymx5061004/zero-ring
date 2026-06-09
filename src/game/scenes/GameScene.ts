import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { HtmlButton } from '../ui/HtmlButton';
import { Modal } from '../ui/Modal';
import { CONTROLS_TOP, MobileControls } from '../ui/MobileControls';
import { burst, floatNumber, playEffect } from '../ui/Fx';
import { Settings } from '../core/Settings';
import { Player } from '../entities/Player';
import { Monster } from '../entities/Monster';
import { getMonster } from '../data/monsters';
import { CLASSES, getClass, type CharClass, type ClassId } from '../data/classes';
import { SaveManager } from '../core/SaveManager';
import type { RunState } from '../core/types';
import { RNG } from '../core/RNG';
import { computeFOV } from '../core/FOV';
import { runMonsterTurns, type TurnEvent } from '../core/TurnSystem';
import { resolveAttack, type AttackResult } from '../systems/CombatSystem';
import { applyStatus, cleanse, statusStrip, tickStatuses } from '../systems/StatusSystem';
import { hasLineOfSight } from '../world/Los';
import {
  blocksSight as tileBlocksSight,
  generateDungeon,
  isClosedDoor,
  isWalkable,
  MAX_DEPTH,
  TILE_SPRITE_KEY,
  TileType,
  type DungeonMap,
  type TrapInstance,
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
import { rollChestLoot, rollMonsterDrop } from '../systems/LootSystem';
import { equipSlotOf, getItem, type ScrollAction } from '../data/items';
import { Identifier, plainInstance, rollInstance, type Beatitude, type ItemInstance } from '../systems/ItemInstance';

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
  /** Seed of the current floor (persisted so resume rebuilds the same layout). */
  private floorSeed = 0;
  private menuOpen = false;
  private gameOver = false;

  // --- 0.2 skill / ability state (reset each floor) ----------------------
  /** Remaining per-floor charges for limited active skills. */
  private skillUses = 0;
  /** 环骑士: whether 环誓 death-save has fired on this floor. */
  private ringOathUsed = false;
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
    } else {
      classId = data.classId ?? CLASSES[0].id;
      this.player = Player.fromClass(getClass(classId));
      this.depth = 1;
      this.turn = 0;
      this.createdAt = Date.now();
      const ident = new Identifier(new RNG((Math.floor(Math.random() * 0xffffffff)) >>> 0));
      this.inventory = new InventorySystem(this.player, ident);
      this.grantStartingItems(getClass(classId));
      this.kills = 0;
      this.floorSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    }

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

    this.loadFloor();
    this.updateHud();
    this.persist();
    this.pushLog(
      this.depth >= MAX_DEPTH
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
    this.comboTarget = null;
    this.comboCount = 0;
    this.monsterSprites.forEach((s) => s.destroy());
    this.monsterSprites.clear();
    this.monsters = [];
    this.items.forEach((e) => e.sprite.destroy());
    this.items = [];

    // Seed generation from the (persisted) floor seed so a resumed run rebuilds
    // the identical layout, monsters and loot rather than a fresh floor.
    this.rng = new RNG(this.floorSeed >>> 0);
    this.map = generateDungeon(this.depth, this.rng);
    this.player.x = this.map.spawn.x;
    this.player.y = this.map.spawn.y;
    this.buildMonsters();
    this.buildItems();
    if (this.depth >= MAX_DEPTH) this.spawnBoss();
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
    for (const mob of this.map.monsters) {
      const def = getMonster(mob.key);
      const monster = new Monster(def, mob.x, mob.y);
      this.monsters.push(monster);
      if (!hasTex) continue;
      const sprite = this.add.sprite(0, 0, 'monsters', def.spriteFrame).setVisible(false);
      const design = this.atlas ? monsterByFrame(this.atlas, def.spriteFrame) : null;
      if (design && this.anims.exists(monsterAnim(design.key, 'idle'))) sprite.play(monsterAnim(design.key, 'idle'));
      this.tileLayer.add(sprite);
      this.monsterSprites.set(monster, sprite);
    }
  }

  private buildItems(): void {
    this.items = [];
    if (!this.textures.exists('items')) return;
    for (const it of this.map.items) {
      this.spawnItem(it.key, it.x, it.y, false);
    }
  }

  /** Spawn a freshly-rolled item entity on the map (drops, chest loot, floor loot). */
  private spawnItem(id: string, x: number, y: number, redraw = true): void {
    this.placeFloorItem(rollInstance(id, this.rng), x, y, redraw);
  }

  /** Place an existing instance on the floor, nudging off an occupied tile. */
  private placeFloorItem(inst: ItemInstance, x: number, y: number, redraw = true): void {
    let tx = x;
    let ty = y;
    if (this.items.some((e) => e.x === tx && e.y === ty)) {
      const free = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
        .find(
          ([ax, ay]) =>
            ay >= 0 && ax >= 0 && ay < this.map.height && ax < this.map.width &&
            isWalkable(this.map.tiles[ay][ax]) && !this.items.some((e) => e.x === ax && e.y === ay),
        );
      if (free) [tx, ty] = free;
    }
    const def = getItem(inst.defId);
    const sprite = this.add.image(0, 0, 'items', def.spriteFrame).setScale(0.85).setVisible(false);
    this.tileLayer.add(sprite);
    this.items.push({ x: tx, y: ty, inst, sprite });
    if (redraw) this.renderEntities();
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
    const visible = this.map.visible[y][x];
    const parts: string[] = [];
    if (visible) {
      const mob = this.monsters.find((m) => !m.isDead && !m.dying && m.x === x && m.y === y);
      if (mob) parts.push(`${mob.name}（${mob.hp}/${mob.maxHp}）`);
      const item = this.items.find((e) => e.x === x && e.y === y);
      if (item) parts.push(this.inventory.name(item.inst));
    }
    parts.push(TILE_DESC[this.map.tiles[y][x]]);
    this.pushLog(`〔此处〕${parts.join('，')}${visible ? '' : '（记忆中）'}`);
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
    computeFOV(
      {
        width,
        height,
        blocksSight: (x, y) =>
          x < 0 || y < 0 || x >= width || y >= height || tileBlocksSight(tiles[y][x]),
      },
      this.player.x,
      this.player.y,
      this.radius,
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
      spr.setVisible(this.inView(m.x, m.y) && visible[m.y][m.x]);
      spr.setPosition((m.x - this.player.x) * TILE, (m.y - this.player.y) * TILE);
    }
    for (const it of this.items) {
      it.sprite.setVisible(this.inView(it.x, it.y) && visible[it.y][it.x]);
      it.sprite.setPosition((it.x - this.player.x) * TILE, (it.y - this.player.y) * TILE);
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

  // --- player turn -------------------------------------------------------

  private tryMove(dx: number, dy: number): void {
    if (this.busy || this.menuOpen) return;
    if (dx < 0) this.playerSprite.setFlipX(true);
    else if (dx > 0) this.playerSprite.setFlipX(false);

    const nx = this.player.x + dx;
    const ny = this.player.y + dy;

    const foe = this.monsterAt(nx, ny);
    if (foe) {
      this.playerAttack(foe, dx, dy);
      return;
    }

    const inBounds = nx >= 0 && ny >= 0 && nx < this.map.width && ny < this.map.height;
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
    this.turn += 1;
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
    if (this.player.isDead) return; // a chest-trap finished us; die() already ran
    this.triggerTrap(this.player.x, this.player.y);
    if (this.player.isDead) return;
    this.tryPickup();
    this.endPlayerTurn();
  }

  private resolveTile(x: number, y: number): void {
    const t = this.map.tiles[y][x];
    if (t === TileType.Chest) {
      this.openChest(x, y);
    } else if (t === TileType.StairsDown) {
      this.pushLog('你发现了向下的阶梯。点击「下楼」继续深入。');
    }
  }

  /** Tick the player's own status effects (poison/burn/regen) for this turn. */
  private tickPlayerStatuses(): void {
    if (!this.player.statuses.length) return;
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
      m.attack += 3;
      m.agility += 2;
      applyStatus(m, 'regenerating', 6, 2);
      const sx = PLAY_CX + (m.x - this.player.x) * TILE;
      const sy = PLAY_CY + (m.y - this.player.y) * TILE;
      playEffect(this, 'shock', sx, sy, 2.0);
      this.cameras.main.shake(160, 0.005);
      this.pushLog('零环守卫发出震鸣，迸发出第二阶段的狂暴！');
    }
  }

  /** End the player's turn: run one round of monster AI + combat, then animate it. */
  private endPlayerTurn(): void {
    if (this.gameOver) return;
    this.tickPlayerStatuses();
    if (this.player.isDead && !this.tryDeathSave()) {
      this.deathCause = '不治的伤势';
      this.die();
      return;
    }
    this.player.regenMana();

    // Monster status effects tick (poison/burn/regen); boss may flip to phase 2.
    this.tickMonsterStatuses();
    this.maybeBossPhase();

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
      return;
    }
    this.persist();
    this.time.delayedCall(this.ms(170), () => {
      this.busy = false;
      this.continueTravel();
    });
  }

  // --- combat ------------------------------------------------------------

  private monsterAt(x: number, y: number): Monster | null {
    return this.monsters.find((m) => !m.isDead && !m.dying && m.x === x && m.y === y) ?? null;
  }

  /** Player strikes an adjacent monster (req. 8): lunge + effect + resolution. */
  private playerAttack(foe: Monster, dx: number, dy: number): void {
    this.busy = true;
    this.turn += 1;
    if (dx < 0) this.playerSprite.setFlipX(true);
    else if (dx > 0) this.playerSprite.setFlipX(false);
    if (this.anims.exists(heroAnim(this.heroKey, 'attack'))) this.playerSprite.play(heroAnim(this.heroKey, 'attack'), true);

    const fx = PLAY_CX + dx * TILE;
    const fy = PLAY_CY + dy * TILE;
    playEffect(this, this.cls.magic >= 6 ? 'magic' : 'slash', fx, fy, 1.15);

    const result = resolveAttack(this.player, foe, this.rng);
    this.applyMeleeBonus(foe, result);
    const spr = this.monsterSprites.get(foe);
    if (result.dodged) {
      floatNumber(this, fx, fy - 14, '闪避', Palette.textDim);
      this.pushLog(`${foe.name}闪避了你的攻击。`);
    } else {
      if (spr) {
        this.flashSprite(spr);
        const design = this.atlas ? monsterByFrame(this.atlas, foe.spriteFrame) : null;
        if (design && this.anims.exists(monsterAnim(design.key, 'hurt'))) spr.play(monsterAnim(design.key, 'hurt'));
      }
      floatNumber(this, fx, fy - 14, `-${result.damage}`, result.crit ? CRIT_COLOR : Palette.white);
      this.pushLog(
        result.crit
          ? `你暴击${foe.name}，造成 ${result.damage} 点伤害！`
          : `你命中${foe.name}，造成 ${result.damage} 点伤害。`,
      );
      if (result.killed) this.killMonster(foe, fx, fy);
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
        this.endPlayerTurn();
      },
    });
  }

  /** Remove a slain monster: death fade + particles, grant exp, maybe level up. */
  private killMonster(foe: Monster, fx: number, fy: number): void {
    if (foe.dying) return;
    foe.dying = true;
    this.kills += 1;
    const idx = this.monsters.indexOf(foe);
    if (idx !== -1) this.monsters.splice(idx, 1);
    this.pushLog(`你击倒了${foe.name}，获得 ${foe.exp} 点经验。`);
    burst(this, fx, fy, 0xb86a6a, 6);

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

    const drop = rollMonsterDrop(this.depth, this.rng);
    if (drop) {
      this.spawnItem(drop, foe.x, foe.y);
      this.pushLog(`${foe.name}掉落了${getItem(drop).name}。`);
    }

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
      child.spawnedSplit = true;
      child.maxHp = Math.max(3, Math.floor(def.hp / 2));
      child.hp = child.maxHp;
      child.attack = Math.max(1, def.attack - 1);
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
        this.presentMonsterAttack(ev.monster, ev.combat, spr);
      }
    }
  }

  private presentMonsterAttack(monster: Monster, combat: AttackResult, spr?: Phaser.GameObjects.Sprite): void {
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
    this.cameras.main.shake(80, 0.003);
    floatNumber(this, PLAY_CX + this.rng.range(-6, 6), PLAY_CY - 18, `-${combat.damage}`, combat.crit ? CRIT_COLOR : Palette.danger);
    this.pushLog(
      combat.crit
        ? `${monster.name}的暴击命中你，造成 ${combat.damage} 点伤害！`
        : `${monster.name}命中你，造成 ${combat.damage} 点伤害。`,
    );

    // On-hit trait flavour (the poison status itself is applied in TurnSystem).
    if (monster.hasTrait('poisonAttack')) this.pushLog(`${monster.name}的毒孢沾上了你。`);
    if (monster.hasTrait('stealsGold') && this.inventory.gold > 0) {
      const stolen = Math.min(this.inventory.gold, this.rng.range(3, 8 + this.depth));
      this.inventory.gold = Math.max(0, this.inventory.gold - stolen);
      floatNumber(this, PLAY_CX, PLAY_CY - 32, `-${stolen} 金`, Palette.accent);
      this.pushLog(`${monster.name}叼走了你 ${stolen} 枚金币！`);
    }
  }

  /** A brief white "hit flash" on any sprite (req. 14). */
  private flashSprite(spr: Phaser.GameObjects.Sprite): void {
    spr.setTintFill(0xffffff);
    this.time.delayedCall(90, () => {
      if (spr.active) spr.clearTint();
    });
  }

  private die(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.busy = true;
    this.invView?.destroy();
    this.invView = undefined;
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
      this.comboCount = this.comboTarget === foe ? this.comboCount + 1 : 1;
      this.comboTarget = foe;
      const stacks = this.comboCount - 1;
      if (stacks > 0) {
        bonus += Math.min(8, stacks * 2);
        note = `连击x${this.comboCount}`;
      }
    } else if (this.cls.id === 'chainbreaker') {
      const missing = 1 - this.player.hp / Math.max(1, this.player.maxHp);
      bonus += Math.round((this.player.attack * 0.6 + 2) * missing);
      if (missing > 0.5) note = '狂怒';
    }
    if (bonus > 0) {
      foe.takeDamage(bonus);
      result.damage += bonus;
      result.killed = foe.isDead;
      if (note) this.pushLog(`〔${note}〕额外造成 ${bonus} 点伤害。`);
    }
  }

  /** 环誓: once per floor the 环骑士 survives a lethal blow, then turns 易伤. */
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

  /** Perform the skill; on success spend resources and pass one turn to the world. */
  private castSkill(dx: number, dy: number): void {
    const skill = this.cls.skill;
    if (!this.performSkill(dx, dy)) return; // performSkill already logged the reason
    if (skill.manaCost) this.player.spendMana(skill.manaCost);
    if (skill.usesPerFloor !== undefined) this.skillUses = Math.max(0, this.skillUses - 1);
    this.updateHud();
    if (this.gameOver || this.player.isDead) return;
    this.busy = true;
    this.turn += 1;
    this.endPlayerTurn();
  }

  /** Dispatch to the class ability. Returns false (no turn / charge spent) if it fizzles. */
  private performSkill(dx: number, dy: number): boolean {
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
        return false;
    }
  }

  private skillFirstAid(): boolean {
    const heal = 10 + this.player.magic;
    const before = this.player.hp;
    this.player.heal(heal);
    const got = this.player.hp - before;
    const removed = cleanse(this.player);
    playEffect(this, 'heal', PLAY_CX, PLAY_CY - 6, 1.3);
    floatNumber(this, PLAY_CX, PLAY_CY - 22, `+${got}`, Palette.success);
    this.pushLog(`灰烬急救：回复 ${got} 点生命${removed.length ? '，并净化了不良状态' : ''}。`);
    return true;
  }

  private skillSaltBurst(): boolean {
    const radius = 2;
    const dmg = 5 + Math.floor(this.player.magic * 0.8);
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
    return true;
  }

  private skillKnell(): boolean {
    const radius = 3;
    let feared = 0;
    let slowed = 0;
    for (const m of this.monsters) {
      if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > radius) continue;
      const sx = PLAY_CX + (m.x - this.player.x) * TILE;
      const sy = PLAY_CY + (m.y - this.player.y) * TILE;
      if (m.tags.includes('undead')) {
        applyStatus(m, 'feared', 3, 1);
        feared++;
        floatNumber(this, sx, sy - 12, '惧', Palette.cool);
      } else {
        applyStatus(m, 'slowed', 3, 1);
        slowed++;
        floatNumber(this, sx, sy - 12, '缓', Palette.textDim);
      }
    }
    playEffect(this, 'shock', PLAY_CX, PLAY_CY, 1.6);
    this.pushLog(`骨钟长鸣：${feared} 个亡灵恐惧，${slowed} 个敌人迟缓。`);
    return true;
  }

  private skillRiftStep(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) {
      this.pushLog('需要选择一个方向。');
      return false;
    }
    const nx = this.player.x + dx * 2;
    const ny = this.player.y + dy * 2;
    const inb = nx >= 0 && ny >= 0 && nx < this.map.width && ny < this.map.height;
    if (!inb || !isWalkable(this.map.tiles[ny][nx]) || this.monsterAt(nx, ny)) {
      this.pushLog('那个方向无法穿行而出。');
      return false;
    }
    this.player.x = nx;
    this.player.y = ny;
    this.tileLayer.setPosition(PLAY_CX, PLAY_CY);
    this.updateFOV();
    this.refresh();
    playEffect(this, 'spark', PLAY_CX, PLAY_CY, 1.2);
    this.pushLog('你侧身没入裂隙，穿墙而出。');
    this.resolveTile(this.player.x, this.player.y);
    if (!this.player.isDead) this.tryPickup();
    return true;
  }

  private skillShardThrow(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) {
      this.pushLog('需要选择一个方向。');
      return false;
    }
    const range = 6;
    let tx = this.player.x;
    let ty = this.player.y;
    let foe: Monster | null = null;
    for (let i = 1; i <= range; i++) {
      const cx = this.player.x + dx * i;
      const cy = this.player.y + dy * i;
      if (this.blocksShot(cx, cy)) break;
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
      this.pushLog('碎刃飞掠而过，没有命中目标。');
      return false;
    }
    const dmg = this.player.attack + 4 + Math.floor(this.player.agility / 2);
    foe.takeDamage(dmg);
    applyStatus(foe, 'poisoned', 2, 2);
    const fx = PLAY_CX + (foe.x - this.player.x) * TILE;
    const fy = PLAY_CY + (foe.y - this.player.y) * TILE;
    const spr = this.monsterSprites.get(foe);
    if (spr) this.flashSprite(spr);
    floatNumber(this, fx, fy - 14, `-${dmg}`, CRIT_COLOR);
    this.pushLog(`碎刃命中${foe.name}，造成 ${dmg} 点重创并使其流血。`);
    if (foe.isDead) this.killMonster(foe, fx, fy);
    return true;
  }

  private skillLantern(): boolean {
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
    let scared = 0;
    for (const m of this.monsters) {
      if (m.isDead || m.dying || this.chebyshev(m.x, m.y) > radius) continue;
      if (m.tags.includes('shadow')) {
        applyStatus(m, 'feared', 2, 1);
        scared++;
      }
    }
    playEffect(this, 'heal', PLAY_CX, PLAY_CY, 1.6);
    this.refresh();
    const bits = ['铜灯照亮四周'];
    if (found) bits.push(`照见 ${found} 处隐藏机关`);
    if (scared) bits.push(`吓退 ${scared} 个潜影`);
    this.pushLog(bits.join('，') + '。');
    return true;
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
    this.busy = true;
    this.turn += 1;
    if (foe.x < this.player.x) this.playerSprite.setFlipX(true);
    else if (foe.x > this.player.x) this.playerSprite.setFlipX(false);
    if (this.anims.exists(heroAnim(this.heroKey, 'attack'))) this.playerSprite.play(heroAnim(this.heroKey, 'attack'), true);
    const fx = PLAY_CX + (foe.x - this.player.x) * TILE;
    const fy = PLAY_CY + (foe.y - this.player.y) * TILE;
    this.spawnProjectile(this.player.x, this.player.y, foe.x, foe.y, Palette.accentBright);

    const result = resolveAttack(this.player, foe, this.rng);
    const spr = this.monsterSprites.get(foe);
    if (result.dodged) {
      floatNumber(this, fx, fy - 14, '闪避', Palette.textDim);
      this.pushLog(`${foe.name}躲开了你的远程攻击。`);
    } else {
      if (spr) this.flashSprite(spr);
      floatNumber(this, fx, fy - 14, `-${result.damage}`, result.crit ? CRIT_COLOR : Palette.white);
      this.pushLog(
        result.crit
          ? `你远程暴击${foe.name}，造成 ${result.damage} 点伤害！`
          : `你射中${foe.name}，造成 ${result.damage} 点伤害。`,
      );
      if (result.killed) this.killMonster(foe, fx, fy);
    }

    this.time.delayedCall(this.ms(150), () => {
      if (this.anims.exists(heroAnim(this.heroKey, 'idle'))) this.playerSprite.play(heroAnim(this.heroKey, 'idle'), true);
      this.endPlayerTurn();
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
    this.busy = true;
    this.turn += 1;
    const radius = this.cls.id === 'copperlamp-wanderer' ? 3 : 1;
    const found = this.discoverHidden(this.player.x, this.player.y, radius);
    this.pushLog(found ? `你仔细搜索，发现了 ${found} 处隐藏机关！` : '你仔细搜索四周，没有发现异常。');
    this.endPlayerTurn();
  }

  // --- doors, traps, chests (phase 7) ------------------------------------

  private openDoor(x: number, y: number): void {
    this.map.tiles[y][x] = TileType.Door;
    this.updateFOV();
    this.refresh();
    this.pushLog('你推开了一扇门。');
    this.busy = true;
    this.turn += 1;
    this.endPlayerTurn();
  }

  /** Force a locked door: a kick whose odds scale with raw strength (attack). */
  private forceDoor(x: number, y: number): void {
    const chance = Phaser.Math.Clamp(0.25 + this.player.attack * 0.03, 0.2, 0.85);
    this.busy = true;
    this.turn += 1;
    if (this.rng.chance(chance)) {
      this.map.tiles[y][x] = TileType.Door;
      this.updateFOV();
      this.refresh();
      this.cameras.main.shake(90, 0.004);
      this.pushLog('砰！你一脚踹开了上锁的门。');
    } else {
      this.pushLog('上锁的门纹丝不动，再试一次吧。');
    }
    this.endPlayerTurn();
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
    this.turn += 1;
    this.endPlayerTurn();
    return true;
  }

  private openChest(x: number, y: number): void {
    const chest = this.map.chests.find((c) => c.x === x && c.y === y && !c.opened);
    if (chest?.locked) {
      const chance = Phaser.Math.Clamp(0.3 + this.player.agility * 0.04, 0.2, 0.85);
      if (!this.rng.chance(chance)) {
        this.pushLog('宝箱上着锁，你没能撬开（可再试）。');
        return;
      }
      chest.locked = false;
      this.pushLog('咔哒——你撬开了锁。');
    }
    this.map.tiles[y][x] = TileType.ChestOpen;
    if (chest) chest.opened = true;
    if (chest?.trapped) {
      this.pushLog('宝箱暗藏机关！');
      const tr: TrapInstance = { x, y, kind: this.rng.pick(['spike', 'poison', 'snare'] as const), hidden: false };
      this.applyTrapToPlayer(tr);
      if (this.player.isDead) return;
    }
    const loot = rollChestLoot(this.depth, this.rng);
    for (const id of loot) this.spawnItem(id, x, y, false);
    this.refresh();
    playEffect(this, 'spark', PLAY_CX, PLAY_CY - 6, 1.2);
    this.pushLog(`你打开了宝箱，散落出 ${loot.map((id) => getItem(id).name).join('、')}！`);
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
    this.turn += 1;
    const tr = this.trapAt(x, y);
    if (!tr) {
      if (this.map.tiles[y][x] === TileType.Trap) this.map.tiles[y][x] = TileType.Floor;
      this.refresh();
      this.endPlayerTurn();
      return;
    }
    const chance = Phaser.Math.Clamp(0.4 + this.player.agility * 0.04, 0.2, 0.9);
    if (this.rng.chance(chance)) {
      this.consumeTrap(tr);
      this.pushLog('你小心地拆除了陷阱。');
    } else {
      this.consumeTrap(tr);
      this.pushLog('拆除失手，陷阱触发了！');
      this.applyTrapToPlayer(tr);
      if (this.gameOver) return;
    }
    this.endPlayerTurn();
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
    this.busy = true;
    this.turn += 1;
    this.pushLog('你停下脚步，戒备四周。');
    this.endPlayerTurn();
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
    this.pushLog(res.message);
    if (res.scroll) this.applyScroll(res.scroll, res.beatitude ?? 'uncursed');
    this.updateHud();
    if (res.ok) this.commitInventoryAction();
  }

  // Equipping / unequipping is gear management: keep the bag open (InventoryView
  // rebuilds itself after the action) and don't spend a turn — letting monsters act
  // here would play out unseen behind the open overlay. Only using a consumable,
  // which has an immediate world effect, closes the bag and advances the turn.
  private equipItem(item: ItemInstance): void {
    const res = this.inventory.equip(item);
    if (res.message) this.pushLog(res.message);
    this.updateHud();
    if (res.ok) this.persist();
  }

  private unequipSlot(slot: EquipSlot): void {
    const res = this.inventory.unequip(slot);
    if (res.message) this.pushLog(res.message);
    this.updateHud();
    if (res.ok) this.persist();
  }

  /** Drop a bag item onto the floor (frees a full bag; recoverable by walking back). */
  private dropItem(item: ItemInstance): void {
    const label = this.inventory.name(item);
    this.inventory.remove(item);
    this.placeFloorItem(item, this.player.x, this.player.y);
    this.pushLog(`你把${label}丢在了脚边。`);
    this.persist();
  }

  /**
   * A successful inventory action (use / equip / unequip) costs one turn (req.
   * phase 1): close the overlay so the world is visible, then let the monsters
   * act exactly once. Opening the menu itself never costs a turn.
   */
  private commitInventoryAction(): void {
    this.closeInventory();
    if (this.gameOver || this.player.isDead) return;
    this.busy = true;
    this.turn += 1;
    this.endPlayerTurn();
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
        const n = this.inventory.identifyAllCarried();
        this.pushLog(n ? `鉴物卷轴生效，看清了 ${n} 件物品的真貌。` : '随身已无未鉴之物。');
        break;
      }
      case 'uncurse': {
        const n = this.inventory.uncurseEquipped();
        this.pushLog(n ? `解缚卷轴生效，${n} 件装备的诅咒被解除。` : '身上并无被诅咒的装备。');
        break;
      }
    }
    // A cursed offensive / utility scroll backfires, leaving you briefly vulnerable.
    if (cursed && action !== 'identify' && action !== 'uncurse') {
      applyStatus(this.player, 'vulnerable', 3, 1);
      this.pushLog('卷轴的诅咒反噬，你一阵恍惚，变得易伤。');
      this.updateHud();
    }
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
    const strip = statusStrip(p);
    const body = [
      `${c.name} · ${c.title}`,
      '',
      `等级　${p.level}　·　经验 ${p.exp} / ${p.expToNext}`,
      `生命　${p.hp} / ${p.maxHp}` + (p.maxMana > 0 ? `　　法力　${p.mana} / ${p.maxMana}` : ''),
      `攻击　${p.attack}　　防御　${p.defense}`,
      `敏捷　${p.agility}　　法术　${p.magic}　　金币　${this.inventory.gold}`,
      ...(strip ? [`状态　${strip}`] : []),
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
      turn: this.turn,
      kills: this.kills,
      floorSeed: this.floorSeed,
      createdAt: this.createdAt,
    };
    SaveManager.saveRun(run);
  }
}
