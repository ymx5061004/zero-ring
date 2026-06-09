import Phaser from 'phaser';
import { FontFamily, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { HtmlButton } from '../ui/HtmlButton';
import { getClass, type ClassId } from '../data/classes';

interface EndData {
  classId: ClassId;
  level: number;
  depth: number;
  kills: number;
  cause: string;
  bestDepth: number;
  /** 环之碎屑 earned this run + the new total (0.3 meta-progression). */
  shards?: number;
  totalShards?: number;
}

export class DeathScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Death);
  }

  create(data: EndData): void {
    this.cameras.main.setBackgroundColor(Palette.bgDeep);
    this.cameras.main.fadeIn(280, 0, 0, 0);
    const cx = GAME_WIDTH / 2;
    const cls = getClass(data.classId);

    this.drawBrokenRing(cx, 150);

    this.add
      .text(cx, 248, '你已陨落', { fontFamily: FontFamily, fontSize: '42px', color: toCss(Palette.danger), fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(cx, 292, '环窟收回了又一名造访者。', { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.textMuted) })
      .setOrigin(0.5);

    const rows: Array<[string, string]> = [
      ['职业', cls.name],
      ['等级', `Lv ${data.level}`],
      ['到达楼层', `第 ${data.depth} 层`],
      ['击杀数量', `${data.kills}`],
      ['死亡原因', data.cause],
      ['最深记录', `第 ${data.bestDepth} 层`],
    ];
    if (data.shards !== undefined) rows.push(['环之碎屑', `+${data.shards}（共 ${data.totalShards ?? 0}）`]);
    this.drawStats(cx, 330, rows);

    new HtmlButton(this, cx, 648, '重新开始', () => this.scene.start(SceneKeys.ClassSelect), {
      width: 260,
      height: 52,
      variant: 'primary',
    });
    new HtmlButton(this, cx, 712, '返回主菜单', () => this.scene.start(SceneKeys.MainMenu), {
      width: 260,
      height: 52,
    });
  }

  private drawBrokenRing(cx: number, cy: number): void {
    const g = this.add.graphics();
    g.lineStyle(3, Palette.dangerDim, 0.95);
    g.beginPath();
    g.arc(cx, cy, 72, Phaser.Math.DegToRad(35), Phaser.Math.DegToRad(300), false);
    g.strokePath();
    g.lineStyle(1, Palette.dangerDim, 0.5);
    g.beginPath();
    g.arc(cx, cy, 54, Phaser.Math.DegToRad(60), Phaser.Math.DegToRad(330), false);
    g.strokePath();
  }

  private drawStats(cx: number, y: number, rows: ReadonlyArray<readonly [string, string]>): void {
    const w = 280;
    const rowH = 32;
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
          color: toCss(Palette.text),
          fontStyle: 'bold',
        })
        .setOrigin(1, 0.5);
    });
  }
}
