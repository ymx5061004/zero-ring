import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { HtmlButton } from '../ui/HtmlButton';
import { uiStage } from '../ui/UiLayer';
import { CLASSES, type CharClass } from '../data/classes';
import {
  getAtlas,
  heroAnim,
  heroAvatarFrame,
  itemByKey,
  type SpriteAtlas,
} from '../assets/atlas';

const HEADER_H = 76;
const FOOTER_H = 122;
const LIST_TOP = HEADER_H;
const LIST_BOTTOM = GAME_HEIGHT - FOOTER_H; // 722
const VIEW_H = LIST_BOTTOM - LIST_TOP;

const CARD_X = 14;
const CARD_W = GAME_WIDTH - CARD_X * 2;
const CARD_H = 136;
const CARD_GAP = 10;

const STAT_LABELS = ['体', '攻', '守', '敏', '法'];

/**
 * Class selection: a vertically scrollable list of rich cards. Every card shows
 * the class avatar, name, a short description and its key attributes. Tapping a
 * card highlights it; the fixed "开始冒险" button launches the run with the chosen
 * class. Layout, art and copy are all original.
 */
export class ClassSelectScene extends Phaser.Scene {
  private atlas: SpriteAtlas | null = null;
  private selectedIndex = 0;
  private cardRedraws: Array<(selected: boolean) => void> = [];

  private list!: Phaser.GameObjects.Container;
  private scrollMin = 0;
  private startBtn!: HtmlButton;

  constructor() {
    super(SceneKeys.ClassSelect);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(Palette.bg);
    this.atlas = getAtlas(this);
    this.cardRedraws = [];

    // --- scrollable card list (built first, clipped + covered by chrome) ---
    this.list = this.add.container(CARD_X + CARD_W / 2, LIST_TOP).setDepth(1);
    CLASSES.forEach((cls, i) => {
      const localY = i * (CARD_H + CARD_GAP) + CARD_H / 2;
      this.cardRedraws.push(this.makeCard(cls, localY));
    });
    const totalH = CLASSES.length * (CARD_H + CARD_GAP) - CARD_GAP;
    this.scrollMin = LIST_TOP - Math.max(0, totalH - VIEW_H);

    const maskG = this.make.graphics();
    maskG.fillStyle(0xffffff);
    maskG.fillRect(CARD_X, LIST_TOP, CARD_W, VIEW_H);
    this.list.setMask(maskG.createGeometryMask());

    this.buildChrome();
    this.enableScroll();
    this.select(0);
  }

  // --- chrome (fixed header + footer, drawn above the list) --------------

  private buildChrome(): void {
    const cx = GAME_WIDTH / 2;

    // Header.
    const header = this.add.graphics().setDepth(10);
    header.fillStyle(Palette.bg, 1);
    header.fillRect(0, 0, GAME_WIDTH, HEADER_H);
    header.lineStyle(1, Palette.border, 1);
    header.lineBetween(0, HEADER_H, GAME_WIDTH, HEADER_H);
    this.add
      .zone(0, 0, GAME_WIDTH, HEADER_H)
      .setOrigin(0, 0)
      .setInteractive()
      .setDepth(10); // swallow taps over scrolled-up cards

    this.add
      .text(cx, 30, '选择职业', {
        fontFamily: FontFamily,
        fontSize: '26px',
        color: toCss(Palette.text),
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(11);
    this.add
      .text(cx, 56, '上下滑动浏览，点选一位探索者', {
        fontFamily: FontFamily,
        fontSize: '12px',
        color: toCss(Palette.textDim),
      })
      .setOrigin(0.5)
      .setDepth(11);

    new HtmlButton(this, 42, 30, '返回', () => this.scene.start(SceneKeys.MainMenu), {
      width: 60,
      height: 32,
      fontSize: 14,
      variant: 'ghost',
    });

    // Footer.
    const footer = this.add.graphics().setDepth(10);
    footer.fillStyle(Palette.bg, 1);
    footer.fillRect(0, LIST_BOTTOM, GAME_WIDTH, FOOTER_H);
    footer.lineStyle(1, Palette.border, 1);
    footer.lineBetween(0, LIST_BOTTOM, GAME_WIDTH, LIST_BOTTOM);
    this.add
      .zone(0, LIST_BOTTOM, GAME_WIDTH, FOOTER_H)
      .setOrigin(0, 0)
      .setInteractive()
      .setDepth(10);

    this.startBtn = new HtmlButton(this, cx, LIST_BOTTOM + 56, '开始冒险', () => this.startGame(), {
      width: 300,
      height: 52,
      fontSize: 22,
      variant: 'primary',
    });
  }

  // --- cards -------------------------------------------------------------

  private makeCard(cls: CharClass, localY: number): (selected: boolean) => void {
    const card = this.add.container(0, localY);
    const hw = CARD_W / 2;
    const hh = CARD_H / 2;

    const bg = this.add.graphics();
    card.add(bg);

    // Pulsing selection glow (drawn above the panel, beneath the content).
    const glow = this.add.graphics();
    card.add(glow);
    let glowTween: Phaser.Tweens.Tween | undefined;
    const drawGlow = (alpha: number): void => {
      glow.clear();
      glow.lineStyle(2, cls.color, alpha);
      glow.strokeRoundedRect(-hw + 2, -hh + 2, CARD_W - 4, CARD_H - 4, 11);
      glow.lineStyle(5, cls.color, alpha * 0.35);
      glow.strokeRoundedRect(-hw + 1, -hh + 1, CARD_W - 2, CARD_H - 2, 12);
    };

    card.add(this.makeAvatar(cls, -hw + 38, -2, 2.0));

    card.add(
      this.add
        .text(-hw + 78, -hh + 18, cls.name, {
          fontFamily: FontFamily,
          fontSize: '19px',
          color: toCss(cls.color),
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5),
    );
    card.add(
      this.add
        .text(-hw + 78, -hh + 38, cls.title, {
          fontFamily: FontFamily,
          fontSize: '12px',
          color: toCss(Palette.textDim),
        })
        .setOrigin(0, 0.5),
    );

    // Starting-item icons (top-right).
    cls.startingItems.slice(0, 3).forEach((key, i) => {
      const ix = hw - 48 + i * 20;
      const itemDef = this.atlas ? itemByKey(this.atlas, key) : null;
      if (itemDef && this.textures.exists('items')) {
        card.add(this.add.image(ix, -hh + 22, 'items', itemDef.frame).setScale(0.82));
      }
    });

    card.add(
      this.add
        .text(-hw + 78, -hh + 56, cls.description, {
          fontFamily: FontFamily,
          fontSize: '12px',
          color: toCss(Palette.textDim),
          lineSpacing: 3,
          wordWrap: { width: CARD_W - 96 },
        })
        .setOrigin(0, 0),
    );

    // Key attributes.
    const stats = [cls.hp, cls.attack, cls.defense, cls.agility, cls.magic];
    stats.forEach((value, i) => {
      const sx = -hw + 80 + i * 52;
      card.add(
        this.add
          .text(sx, hh - 32, STAT_LABELS[i], { fontFamily: FontFamily, fontSize: '11px', color: toCss(Palette.textMuted) })
          .setOrigin(0, 0.5),
      );
      card.add(
        this.add
          .text(sx + 18, hh - 32, String(value), {
            fontFamily: FontFamily,
            fontSize: '14px',
            color: toCss(cls.color),
            fontStyle: 'bold',
          })
          .setOrigin(0, 0.5),
      );
    });

    // Signature skill.
    card.add(
      this.add
        .text(-hw + 80, hh - 14, `技 · ${cls.skill.name}　${cls.skill.description}`, {
          fontFamily: FontFamily,
          fontSize: '11px',
          color: toCss(Palette.accent),
          wordWrap: { width: CARD_W - 96 },
        })
        .setOrigin(0, 0.5),
    );

    // Selection is handled by a native DOM hit area over the card (see
    // enableScroll); the canvas card is just the visual.
    card.setSize(CARD_W, CARD_H);
    this.list.add(card);

    const redraw = (selected: boolean): void => {
      bg.clear();
      bg.fillStyle(selected ? Palette.panelLight : Palette.panel, 1);
      bg.fillRoundedRect(-hw, -hh, CARD_W, CARD_H, 12);
      if (selected) {
        bg.fillStyle(cls.color, 0.12);
        bg.fillRoundedRect(-hw, -hh, CARD_W, CARD_H, 12);
      }
      bg.lineStyle(selected ? 2.5 : 1.5, selected ? cls.color : Palette.border, 1);
      bg.strokeRoundedRect(-hw, -hh, CARD_W, CARD_H, 12);
      // left accent stripe
      bg.fillStyle(cls.color, selected ? 1 : 0.7);
      bg.fillRect(-hw + 3, -hh + 12, 4, CARD_H - 24);

      // Start / stop the selection glow pulse.
      if (selected && !glowTween) {
        const o = { a: 0.4 };
        glowTween = this.tweens.add({
          targets: o,
          a: 0.95,
          duration: 700,
          yoyo: true,
          repeat: -1,
          onUpdate: () => drawGlow(o.a),
        });
      } else if (!selected && glowTween) {
        glowTween.stop();
        glowTween = undefined;
        glow.clear();
      }
    };
    redraw(false);
    return redraw;
  }

  /** A class avatar — the generated hero sprite (animated) or a text fallback. */
  private makeAvatar(cls: CharClass, x: number, y: number, scale: number): Phaser.GameObjects.GameObject {
    if (this.atlas && this.textures.exists('heroes')) {
      const sprite = this.add.sprite(x, y, 'heroes', heroAvatarFrame(this.atlas, cls.hero)).setScale(scale);
      if (this.anims.exists(heroAnim(cls.hero, 'idle'))) {
        sprite.play(heroAnim(cls.hero, 'idle'));
      }
      return sprite;
    }
    return this.add
      .text(x, y, cls.name.charAt(0), {
        fontFamily: FontFamily,
        fontSize: `${Math.round(scale * 18)}px`,
        color: toCss(cls.color),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
  }

  private select(index: number): void {
    this.selectedIndex = index;
    this.cardRedraws.forEach((fn, i) => fn(i === index));
    this.startBtn.setLabel(`开始冒险 · ${CLASSES[index].name}`);
  }

  // --- scrolling ---------------------------------------------------------

  /**
   * The card list scrolls and selects entirely through DOM: a native-scrolling
   * overlay (perfect touch momentum, no canvas drag heuristics) holds a
   * transparent hit button over each card. The canvas list visual is kept in
   * sync with the overlay's scroll position.
   */
  private enableScroll(): void {
    const totalH = CLASSES.length * (CARD_H + CARD_GAP) - CARD_GAP;
    const clampY = (v: number): number => Phaser.Math.Clamp(v, this.scrollMin, LIST_TOP);
    const stage = uiStage(this, 'base');

    const scroller = document.createElement('div');
    scroller.className = 'cs-scroller';
    scroller.style.left = `${CARD_X}px`;
    scroller.style.top = `${LIST_TOP}px`;
    scroller.style.width = `${CARD_W}px`;
    scroller.style.height = `${VIEW_H}px`;

    const inner = document.createElement('div');
    inner.className = 'cs-scroller-inner';
    inner.style.height = `${Math.max(totalH, VIEW_H)}px`;
    scroller.appendChild(inner);

    CLASSES.forEach((_, i) => {
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'ui-btn ui-btn--hit';
      hit.style.left = '0px';
      hit.style.top = `${i * (CARD_H + CARD_GAP)}px`;
      hit.style.width = `${CARD_W}px`;
      hit.style.height = `${CARD_H}px`;
      hit.addEventListener('click', (e) => {
        e.preventDefault();
        this.select(i);
      });
      inner.appendChild(hit);
    });

    // Mirror native scroll onto the canvas list (no canvas pointer handling).
    scroller.addEventListener('scroll', () => {
      this.list.y = clampY(LIST_TOP - scroller.scrollTop);
    });

    stage.appendChild(scroller);

    const cleanup = (): void => scroller.remove();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  private startGame(): void {
    this.scene.start(SceneKeys.Game, { classId: CLASSES[this.selectedIndex].id });
  }
}
