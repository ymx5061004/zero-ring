import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';
import { TileType, type DungeonMap } from '../world/Dungeon';

/**
 * A full-floor minimap overlay (req: see the whole floor, explored areas only).
 * Draws one cell per tile for everything the player has explored, marks the
 * down-stairs and the player's current position. Fog-of-war is respected: tiles
 * never explored stay blank.
 */
export class MapView extends Phaser.GameObjects.Container {
  private closed = false;
  private closeBtn?: HtmlButton;
  private readonly onClose: () => void;

  constructor(
    scene: Phaser.Scene,
    map: DungeonMap,
    player: { x: number; y: number },
    depth: number,
    onClose: () => void,
  ) {
    super(scene, 0, 0);
    this.setDepth(1100);
    this.onClose = onClose;
    blockUi();

    const CS = 7; // pixels per tile
    const gridW = map.width * CS;
    const gridH = map.height * CS;
    const padX = 22;
    const TITLE_H = 56;
    const BTN_BLOCK = 76;
    const panelW = gridW + padX * 2;
    const panelH = TITLE_H + gridH + BTN_BLOCK;
    const left = Math.round((GAME_WIDTH - panelW) / 2);
    const top = Math.round((GAME_HEIGHT - panelH) / 2);
    const gridX = left + padX;
    const gridY = top + TITLE_H;

    // Dim, input-blocking backdrop — a tap outside the panel closes the map.
    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= left && w.x <= left + panelW && w.y >= top && w.y <= top + panelH;
      if (!inPanel) this.close();
    });

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(left, top, panelW, panelH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(left, top, panelW, panelH, 16);

    const title = scene.add
      .text(GAME_WIDTH / 2, top + 30, `地图 · 第 ${depth} 层`, {
        fontFamily: FontFamily,
        fontSize: '20px',
        color: toCss(Palette.accent),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const g = scene.add.graphics();
    g.fillStyle(Palette.bgDeep, 1);
    g.fillRect(gridX, gridY, gridW, gridH);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!map.explored[y][x]) continue;
        const t = map.tiles[y][x];
        let color: number;
        switch (t) {
          case TileType.Wall:
            color = Palette.wall;
            break;
          case TileType.StairsDown:
            color = Palette.accent;
            break;
          case TileType.Chest:
            color = Palette.accentBright;
            break;
          case TileType.Door:
          case TileType.DoorClosed:
          case TileType.DoorLocked:
            color = Palette.borderBright;
            break;
          default:
            color = Palette.floorAlt; // floor, opened chest, revealed trap, …
        }
        g.fillStyle(color, 1);
        g.fillRect(gridX + x * CS, gridY + y * CS, CS, CS);
      }
    }
    // Player marker, drawn last so it sits on top.
    const px = gridX + player.x * CS + CS / 2;
    const py = gridY + player.y * CS + CS / 2;
    g.fillStyle(Palette.success, 1);
    g.fillCircle(px, py, CS * 0.8);
    g.lineStyle(1.5, Palette.white, 1);
    g.strokeCircle(px, py, CS * 0.8);

    const hint = scene.add
      .text(GAME_WIDTH / 2, gridY + gridH + 16, '绿点为你　·　金色为下层阶梯', {
        fontFamily: FontFamily,
        fontSize: '12px',
        color: toCss(Palette.textMuted),
      })
      .setOrigin(0.5);

    this.add([dim, panel, g, title, hint]);

    this.closeBtn = new HtmlButton(scene, GAME_WIDTH / 2, top + panelH - 34, '关闭', () => this.close(), {
      width: 200,
      height: 46,
      fontSize: 18,
      layer: 'modal',
    });

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeBtn?.destroy();
    unblockUi();
    this.onClose();
    this.destroy();
  }
}
