import Phaser from 'phaser';
import { FontFamily, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { HtmlButton } from '../ui/HtmlButton';
import { getClass, type ClassId } from '../data/classes';

interface EndData {
  classId: ClassId;
  level: number;
  depth: number;
  kills: number;
  turns: number;
  bestDepth: number;
  /** 环之碎屑 earned this run + the new total (0.3 meta-progression). */
  shards?: number;
  totalShards?: number;
}

export class VictoryScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Victory);
  }

  create(data: EndData): void {
    this.cameras.main.setBackgroundColor(Palette.bg);
    this.cameras.main.fadeIn(320, 0, 0, 0);
    const cx = GAME_WIDTH / 2;
    const cls = getClass(data.classId);

    this.drawRadiantRing(cx, 196);

    this.add
      .text(cx, 304, '零环归手', {
        fontFamily: FontFamily,
        fontSize: '46px',
        color: toCss(Palette.accentBright),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 352, `${cls.name} · ${cls.title}`, {
        fontFamily: FontFamily,
        fontSize: '15px',
        color: toCss(Palette.textDim),
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 392, '你击败了零环守卫，环成闭环，终归于零。', {
        fontFamily: FontFamily,
        fontSize: '13px',
        color: toCss(Palette.accentDim),
      })
      .setOrigin(0.5);

    const rows: Array<[string, string]> = [
      ['职业', getClass(data.classId).name],
      ['等级', `Lv ${data.level}`],
      ['击杀数量', `${data.kills}`],
      ['通关回合', `${data.turns}`],
      ['最深记录', `第 ${data.bestDepth} 层`],
    ];
    if (data.shards !== undefined) rows.push(['环之碎屑', `+${data.shards}（共 ${data.totalShards ?? 0}）`]);
    this.drawStats(cx, 430, rows);

    new HtmlButton(this, cx, 648, '再来一局', () => this.scene.start(SceneKeys.ClassSelect), {
      width: 260,
      height: 52,
      variant: 'primary',
    });
    new HtmlButton(this, cx, 712, '返回主菜单', () => this.scene.start(SceneKeys.MainMenu), {
      width: 260,
      height: 52,
    });
  }

  /** A bright, slowly turning ring with an outward shimmer. */
  private drawRadiantRing(cx: number, cy: number): void {
    const ring = this.add.container(cx, cy);

    const outer = this.add.graphics();
    outer.lineStyle(2, Palette.accent, 0.9);
    outer.strokeCircle(0, 0, 80);
    outer.lineStyle(2, Palette.accentBright, 1);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      outer.lineBetween(Math.cos(a) * 84, Math.sin(a) * 84, Math.cos(a) * 94, Math.sin(a) * 94);
    }

    const inner = this.add.graphics();
    inner.lineStyle(4, Palette.accentBright, 1);
    inner.strokeCircle(0, 0, 56);
    inner.lineStyle(1, Palette.accent, 0.7);
    inner.strokeCircle(0, 0, 42);

    ring.add([outer, inner]);
    this.tweens.add({ targets: outer, rotation: Math.PI * 2, duration: 24000, repeat: -1 });

    // Expanding shimmer pulse.
    const pulse = this.add.graphics();
    ring.add(pulse);
    const halo = { r: 60, a: 0.5 };
    this.tweens.add({
      targets: halo,
      r: 110,
      a: 0,
      duration: 1600,
      repeat: -1,
      onUpdate: () => {
        pulse.clear();
        pulse.lineStyle(2, Palette.accentBright, halo.a);
        pulse.strokeCircle(0, 0, halo.r);
      },
    });
  }

  private drawStats(cx: number, y: number, rows: ReadonlyArray<readonly [string, string]>): void {
    const w = 280;
    const rowH = 38;
    const h = rows.length * rowH + 20;
    const top = y - 10;

    const panel = this.add.graphics();
    panel.fillStyle(Palette.panel, 0.6);
    panel.fillRoundedRect(cx - w / 2, top, w, h, 12);
    panel.lineStyle(1, Palette.border, 1);
    panel.strokeRoundedRect(cx - w / 2, top, w, h, 12);

    rows.forEach(([label, value], i) => {
      const ry = top + 10 + rowH / 2 + i * rowH;
      this.add
        .text(cx - w / 2 + 22, ry, label, {
          fontFamily: FontFamily,
          fontSize: '15px',
          color: toCss(Palette.textDim),
        })
        .setOrigin(0, 0.5);
      this.add
        .text(cx + w / 2 - 22, ry, value, {
          fontFamily: FontFamily,
          fontSize: '17px',
          color: toCss(Palette.accentBright),
          fontStyle: 'bold',
        })
        .setOrigin(1, 0.5);
    });
  }
}
