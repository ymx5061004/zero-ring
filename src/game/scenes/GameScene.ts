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
import {
  generateDungeon,
  isWalkable,
  MAX_DEPTH,
  TILE_SPRITE_KEY,
  TileType,
  type DungeonMap,
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
import { InventorySystem, type EquipSlot } from '../systems/InventorySystem';
import { InventoryView } from '../ui/InventoryView';
import { rollChestLoot, rollMonsterDrop } from '../systems/LootSystem';
import { getItem, type ItemDef, type ScrollAction } from '../data/items';

interface GameSceneData {
  classId?: ClassId;
  resume?: boolean;
}

interface ItemEntity {
  x: number;
  y: number;
  key: string;
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
};

const TILE_DESC: Record<TileType, string> = {
  [TileType.Wall]: '石墙',
  [TileType.Floor]: '空地',
  [TileType.Door]: '一扇门',
  [TileType.StairsDown]: '向下的阶梯',
  [TileType.Trap]: '陷阱',
  [TileType.Chest]: '未开启的宝箱',
  [TileType.ChestOpen]: '已开启的宝箱',
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
  private menuOpen = false;
  private gameOver = false;
  private kills = 0;
  private deathCause = '环窟的危险';
  private animScale = 1;
  private travelPath: Vec[] = [];
  private travelDest: Vec | null = null;
  private travelMarker?: Phaser.GameObjects.Image;

  private depthText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
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
      this.inventory = new InventorySystem(this.player);
      this.inventory.restore(run.gold, run.bag, run.equip);
      this.kills = run.kills;
    } else {
      classId = data.classId ?? CLASSES[0].id;
      this.player = Player.fromClass(getClass(classId));
      this.depth = 1;
      this.turn = 0;
      this.createdAt = Date.now();
      this.inventory = new InventorySystem(this.player);
      this.inventory.add(getItem('heal_potion'));
      this.inventory.add(getItem('bread'));
      this.kills = 0;
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

  /** Generate the current floor: map, monsters, items, and the boss on floor 5. */
  private loadFloor(): void {
    this.stopTravel();
    this.monsterSprites.forEach((s) => s.destroy());
    this.monsterSprites.clear();
    this.monsters = [];
    this.items.forEach((e) => e.sprite.destroy());
    this.items = [];

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
    this.frameByType = {
      [TileType.Wall]: 0,
      [TileType.Floor]: 1,
      [TileType.Door]: 2,
      [TileType.StairsDown]: 3,
      [TileType.Trap]: 4,
      [TileType.Chest]: 6,
      [TileType.ChestOpen]: 7,
    };
    if (!this.atlas) return;
    for (const t of [TileType.Wall, TileType.Floor, TileType.Door, TileType.StairsDown, TileType.Trap, TileType.Chest]) {
      const entry = tileByKey(this.atlas, TILE_SPRITE_KEY[t]);
      if (entry) this.frameByType[t] = entry.frames[0];
    }
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

  /** Place an item entity on the map (nudging off an occupied tile). */
  private spawnItem(id: string, x: number, y: number, redraw = true): void {
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
    const def = getItem(id);
    const sprite = this.add.image(0, 0, 'items', def.spriteFrame).setScale(0.85).setVisible(false);
    this.tileLayer.add(sprite);
    this.items.push({ x: tx, y: ty, key: id, sprite });
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
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      downX = p.x;
      downY = p.y;
    });
    zone.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.menuOpen || this.gameOver) return;
      // Only treat clearly-moved pointers as drags; a generous slop keeps touch
      // taps (which always jitter a little) from being ignored.
      if (Math.abs(p.x - downX) > 24 || Math.abs(p.y - downY) > 24) return;
      // A tap while moving / travelling cancels the current trip.
      if (this.busy) {
        if (this.travelPath.length) this.stopTravel();
        return;
      }
      const tx = this.player.x + Math.round((p.x - PLAY_CX) / TILE);
      const ty = this.player.y + Math.round((p.y - PLAY_CY) / TILE);
      // Long-press inspects the tile; a quick tap walks there.
      if (p.upTime - p.downTime > 380) this.describeTile(tx, ty);
      else this.travelTo(tx, ty);
    });
  }

  private describeTile(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return;
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
      if (item) parts.push(getItem(item.key).name);
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
    // Adjacent tap: a single step (which also resolves into an attack).
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const inb = tx >= 0 && ty >= 0 && tx < this.map.width && ty < this.map.height;
      if (this.monsterAt(tx, ty) || (inb && isWalkable(this.map.tiles[ty][tx]))) {
        this.tryMove(dx, dy);
        return;
      }
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
    if (Math.abs(dx) + Math.abs(dy) !== 1 || !isWalkable(this.map.tiles[next.y][next.x]) || this.monsterAt(next.x, next.y)) {
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
    const passable = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < W && y < H && isWalkable(this.map.tiles[y][x]) && !this.monsterAt(x, y);
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
          x < 0 || y < 0 || x >= width || y >= height || tiles[y][x] === TileType.Wall,
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
        if (this.usesTiles) img.setFrame(this.frameByType[type]);
        else img.setTint(TILE_COLOR[type]);
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
    if (this.player.isDead) return; // a trap finished us; die() already ran
    this.tryPickup();
    this.endPlayerTurn();
  }

  private resolveTile(x: number, y: number): void {
    switch (this.map.tiles[y][x]) {
      case TileType.Trap: {
        const raw = this.rng.range(2, 4 + Math.floor(this.depth / 2));
        const dealt = Math.max(1, raw - Math.floor(this.player.defense / 2));
        this.player.takeDamage(dealt);
        this.map.tiles[y][x] = TileType.Floor;
        this.refresh();
        this.flashDamage();
        this.cameras.main.shake(90, 0.004);
        this.flashSprite(this.playerSprite);
        floatNumber(this, PLAY_CX, PLAY_CY - 18, `-${dealt}`, Palette.danger);
        this.pushLog(`你踩中了陷阱，受到 ${dealt} 点伤害！`);
        this.stopTravel();
        this.updateHud();
        if (this.player.isDead) {
          this.deathCause = '致命的陷阱';
          this.die();
        }
        break;
      }
      case TileType.Chest: {
        this.map.tiles[y][x] = TileType.ChestOpen;
        const loot = rollChestLoot(this.depth, this.rng);
        for (const id of loot) this.spawnItem(id, x, y, false);
        this.refresh();
        playEffect(this, 'spark', PLAY_CX, PLAY_CY - 6, 1.2);
        this.pushLog(`你打开了宝箱，散落出 ${loot.map((id) => getItem(id).name).join('、')}！`);
        break;
      }
      case TileType.StairsDown:
        this.pushLog('你发现了向下的阶梯。点击「下楼」继续深入。');
        break;
      case TileType.Door:
        this.pushLog('你推开一扇门。');
        break;
      default:
        break;
    }
  }

  /** End the player's turn: run one round of monster AI + combat, then animate it. */
  private endPlayerTurn(): void {
    if (this.gameOver) return;
    const events = runMonsterTurns(this.monsters, {
      player: this.player,
      isWall: (x, y) =>
        x < 0 || y < 0 || x >= this.map.width || y >= this.map.height || this.map.tiles[y][x] === TileType.Wall,
      rng: this.rng,
    });
    this.presentTurn(events);
    this.updateHud();
    if (this.player.isDead) {
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
    this.updateHud();

    if (foe.id === 'ringwarden') this.victory();
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

  // --- pickups -----------------------------------------------------------

  /** Gold is collected automatically; other items go to the bag (req. 8). */
  private tryPickup(): void {
    const idx = this.items.findIndex((e) => e.x === this.player.x && e.y === this.player.y);
    if (idx === -1) return;
    const ent = this.items[idx];
    const def = getItem(ent.key);

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

    if (this.inventory.isFull()) {
      this.pushLog(`背包已满，无法拾起${def.name}（在背包中使用物品以腾出空间）。`);
      return;
    }
    this.inventory.add(def);
    this.items.splice(idx, 1);
    ent.sprite.destroy();
    playEffect(this, 'spark', PLAY_CX, PLAY_CY - 6, 0.8);
    this.pushLog(`你拾起了${def.name}。`);
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
      onClose: () => this.closeInventory(),
    });
  }

  private closeInventory(): void {
    this.invView?.destroy();
    this.invView = undefined;
    this.menuOpen = false;
    this.persist();
  }

  private useItem(item: ItemDef): void {
    const res = this.inventory.use(item);
    this.pushLog(res.message);
    if (res.scroll) this.applyScroll(res.scroll);
    this.updateHud();
  }

  private equipItem(item: ItemDef): void {
    const msg = this.inventory.equip(item);
    if (msg) this.pushLog(msg);
    this.updateHud();
  }

  private unequipSlot(slot: EquipSlot): void {
    const msg = this.inventory.unequip(slot);
    if (msg) this.pushLog(msg);
    this.updateHud();
  }

  /** Resolve a scroll's world effect (used from the inventory). */
  private applyScroll(action: ScrollAction): void {
    switch (action) {
      case 'reveal':
        for (let y = 0; y < this.map.height; y++) this.map.explored[y].fill(true);
        this.refresh();
        this.pushLog('环窟在你眼前徐徐展开。');
        break;
      case 'smite': {
        const targets = this.monsters.filter((mob) => !mob.isDead && !mob.dying && this.map.visible[mob.y][mob.x]);
        if (!targets.length) {
          this.pushLog('视野内没有可灼伤的敌人。');
          break;
        }
        const dmg = 6 + Math.floor(this.player.magic / 2);
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
        const spots: Array<[number, number]> = [];
        for (let dy = -this.radius; dy <= this.radius; dy++) {
          for (let dx = -this.radius; dx <= this.radius; dx++) {
            const nx = this.player.x + dx;
            const ny = this.player.y + dy;
            if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height) continue;
            if (this.map.tiles[ny][nx] === TileType.Floor && !this.monsterAt(nx, ny) && !(nx === this.player.x && ny === this.player.y)) {
              spots.push([nx, ny]);
            }
          }
        }
        if (!spots.length) {
          this.pushLog('周围无处可去。');
          break;
        }
        const [nx, ny] = this.rng.pick(spots);
        this.player.x = nx;
        this.player.y = ny;
        this.updateFOV();
        this.refresh();
        this.pushLog('一阵眩晕，你出现在别处。');
        break;
      }
      case 'vigor': {
        const before = this.player.hp;
        this.player.heal(this.player.maxHp);
        this.pushLog(`秘力涌动，恢复了 ${this.player.hp - before} 点生命。`);
        this.updateHud();
        break;
      }
    }
  }

  private onCharacter(): void {
    const c = this.cls;
    const p = this.player;
    const body = [
      `${c.name} · ${c.title}`,
      '',
      `等级　${p.level}　·　经验 ${p.exp} / ${p.expToNext}`,
      `生命　${p.hp} / ${p.maxHp}`,
      `攻击　${p.attack}　　防御　${p.defense}`,
      `敏捷　${p.agility}　　法术　${p.magic}　　金币　${this.inventory.gold}`,
      '',
      `武器　${this.inventory.equipped.weapon?.name ?? '无'}`,
      `防具　${this.inventory.equipped.armor?.name ?? '无'}　饰品　${this.inventory.equipped.ring?.name ?? '无'}`,
      '',
      `技能 · ${c.skill.name}`,
      c.skill.description,
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
    this.persist();
    this.scene.start(SceneKeys.MainMenu);
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
      level: this.player.level,
      exp: this.player.exp,
      gold: inv.gold,
      bag: inv.bag,
      equip: inv.equip,
      turn: this.turn,
      kills: this.kills,
      createdAt: this.createdAt,
    };
    SaveManager.saveRun(run);
  }
}
