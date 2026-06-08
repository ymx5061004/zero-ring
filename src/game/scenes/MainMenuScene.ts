import Phaser from 'phaser';
import { FontFamily, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SettingsView } from '../ui/SettingsView';
import { SaveManager } from '../core/SaveManager';
import { getAtlas, heroAnim, monsterAnim, spritesReady } from '../assets/atlas';

const HELP_TEXT = [
  '目标',
  '　逐层深入环窟（共五层），在最深处击败「零环守卫」，取回零环。',
  '',
  '操作',
  '　点按地图任意处，角色自动寻路前往（遇敌会停下）；点相邻怪物即攻击。',
  '　长按地图格可查看该格信息。',
  '　站在阶梯「>」上点「下楼」深入下一层。',
  '　「背包」使用物品、装备武器防具；「角色」「日志」查看状态与战报。',
  '',
  '成长',
  '　击败怪物获得经验，升级提升属性并回血；拾取金币、药剂、卷轴与装备。',
  '',
  '存档',
  '　进度自动保存，可从主菜单「继续游戏」返回未竟的旅程。',
].join('\n');

const ABOUT_TEXT = [
  '《零环》是一款移动端竖屏的单人地牢探索游戏，以传统回合制 roguelike 为灵感，所有内容均为原创。',
  '',
  '本作不含任何第三方版权素材：图形全部由代码实时绘制，文字与数值皆为原创设定。',
  '',
  '技术　Vite · TypeScript · Phaser 3',
  '存档　浏览器本地存储',
  '',
  '愿你在环窟之中，走得比上一次更深。',
].join('\n');

export class MainMenuScene extends Phaser.Scene {
  private settingsView?: SettingsView;

  constructor() {
    super(SceneKeys.MainMenu);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(Palette.bg);
    this.settingsView = undefined;
    const cx = GAME_WIDTH / 2;

    new Button(this, GAME_WIDTH - 44, 34, '设置', () => this.openSettings(), { width: 64, height: 32, fontSize: 14 });

    this.drawEmblem(cx, 178);

    this.add
      .text(cx, 304, '零环', {
        fontFamily: FontFamily,
        fontSize: '62px',
        color: toCss(Palette.text),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 356, '深入环窟，寻回失落的零环', {
        fontFamily: FontFamily,
        fontSize: '15px',
        color: toCss(Palette.textDim),
      })
      .setOrigin(0.5);

    // --- Primary actions -------------------------------------------------
    new Button(this, cx, 440, '开始游戏', () => this.scene.start(SceneKeys.ClassSelect), {
      fill: Palette.accentDim,
      fillHover: 0x8a7440,
      border: Palette.accent,
      textColor: Palette.text,
    });

    const run = SaveManager.loadRun();
    const continueLabel = run ? `继续游戏 · 第 ${run.depth} 层` : '继续游戏';
    new Button(this, cx, 506, continueLabel, () => this.scene.start(SceneKeys.Game, { resume: true }), {
      fontSize: run ? 18 : 20,
    }).setEnabled(run !== null);

    new Button(this, cx, 572, '帮助', () => new Modal(this, '如何游玩', HELP_TEXT));
    new Button(this, cx, 638, '关于', () => new Modal(this, '关于本作', ABOUT_TEXT));

    this.buildShowcaseStrip(cx);

    this.add
      .text(cx, 812, 'v0.1.0 · 原创试做', {
        fontFamily: FontFamily,
        fontSize: '12px',
        color: toCss(Palette.textMuted),
      })
      .setOrigin(0.5);
  }

  private openSettings(): void {
    if (this.settingsView) return;
    this.settingsView = new SettingsView(this, () => {
      this.settingsView?.destroy();
      this.settingsView = undefined;
    });
  }

  /** A live strip of generated sprites + a link to the full gallery. */
  private buildShowcaseStrip(cx: number): void {
    new Button(this, cx, 690, '素材图鉴', () => this.scene.start(SceneKeys.Showcase), {
      width: 150,
      height: 38,
      fontSize: 15,
    });

    const atlas = getAtlas(this);
    if (!atlas || !spritesReady(this)) return;

    const heroes = atlas.heroes;
    const hw = GAME_WIDTH / heroes.length;
    heroes.forEach((h, i) => {
      this.add
        .sprite(hw * (i + 0.5), 730, 'heroes', h.idle[0])
        .setScale(1.15)
        .play(heroAnim(h.key, 'idle'));
    });

    const monsters = atlas.monsters.slice(0, 10);
    const mw = GAME_WIDTH / monsters.length;
    monsters.forEach((m, i) => {
      this.add
        .sprite(mw * (i + 0.5), 766, 'monsters', m.idle[0])
        .setScale(1.0)
        .play(monsterAnim(m.key));
    });
  }

  /** Concentric "ring" emblem with a slowly rotating ticked outer band. */
  private drawEmblem(cx: number, cy: number): void {
    const emblem = this.add.container(cx, cy);

    const outer = this.add.graphics();
    outer.lineStyle(2, Palette.accentDim, 0.85);
    outer.strokeCircle(0, 0, 82);
    outer.lineStyle(2, Palette.accent, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      outer.lineBetween(Math.cos(a) * 86, Math.sin(a) * 86, Math.cos(a) * 96, Math.sin(a) * 96);
    }

    const inner = this.add.graphics();
    inner.lineStyle(3, Palette.accent, 1);
    inner.strokeCircle(0, 0, 60);
    inner.lineStyle(1, Palette.accentDim, 0.6);
    inner.strokeCircle(0, 0, 46);

    emblem.add([outer, inner]);
    this.tweens.add({ targets: outer, rotation: Math.PI * 2, duration: 64000, repeat: -1 });
  }
}
