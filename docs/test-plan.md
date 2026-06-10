# 《零环》0.3「规则互锁」手动测试清单

本项目不引入自动化测试框架；以下为发布前的人工回归清单。建议在桌面浏览器（`npm run dev`）与一台真机（同局域网访问）各跑一遍。

> **调试入口**：开发模式下控制台暴露 `window.zeroRing`（Phaser.Game 实例）。
> - 直接进职业：`zeroRing.scene.start('GameScene', { classId: 'rift-thief' })`
> - 拿到场景：`const s = zeroRing.scene.getScene('GameScene')`，可读 `s.player / s.monsters / s.inventory / s.map`，或直接调私有方法定向触发（如 `s.applyAffixHit`, `s.skillRiftStep`, `s.chestInspect`）。
> - 9 个职业 id：`ring-knight · ash-medic · rift-thief · starsalt-mage · bonebell-priest · brokenblade-ranger · ironfist-monk · copperlamp-wanderer · chainbreaker`

每项格式：**目的 / 步骤 / 预期 / 失败时优先查的文件**。

---

## 0. 冒烟（每次必跑）
- **目的**：核心链路与构建可用。
- **步骤**：`npm run build`；启动 → 主菜单 → 选职业 → 进入 → 移动 / 近战 / 捡物 / 下楼 / 在第 5 层击败 Boss。
- **预期**：构建通过（含 `tsc`）；控制台无报错；六大流程（新游戏 / 读档 / 死亡 / 胜利 / 下楼 / 战斗）正常。
- **失败查**：`scenes/GameScene.ts`、`scenes/BootScene.ts`、`main.ts`。

## 1. 新游戏流程
- **目的**：开局状态正确。
- **步骤**：主菜单「新游戏」→ 选每个职业各开一次。
- **预期**：等级 1、满血、按职业属性；背包/装备符合 `startingItems` 且武器/防具/饰品已自动穿戴；金币/药剂含局外加成（除非纯净模式）。
- **失败查**：`GameScene.create`、`grantStartingItems`、`data/classes.ts`、`core/Meta.ts`。

## 2. 九职业 startingItems
- **目的**：每职业起始物正确入背包并自动着装。
- **步骤**：逐个职业开局，打开背包查看 11 槽人偶与背包格。
- **预期**：环骑士=环钢长剑+守誓圆盾+干面包；灰烬医师=锈匕+治愈药剂+翠藓药剂；裂隙盗=锈匕+疾行皮靴+钱袋；星盐法师=星盐法杖+碧泉药剂+照明卷轴；骨钟祭司=低语魔杖+环力护符+翠藓药剂；碎刃游侠=猎手短弓+锈匕+环窟果；铁拳僧=疾行皮靴+风干肉+蛮力指环；铜灯旅人=锈匕+照明卷轴+金币；断链狂徒=裂石战斧+风干肉+治愈药剂。武器/防具/饰品已穿戴；起始药剂/卷轴默认已鉴定。
- **失败查**：`data/classes.ts`、`grantStartingItems`、`systems/InventorySystem.ts`。

## 3. 九职业技能（消耗规则见下）
- **目的**：被动自动生效、主动正确消耗。
- **步骤**：每职业点「技能」键，制造触发场景。
- **预期**：
  - 环骑士·环誓（被动）：致命伤害时存活回 30% 血 + 易伤 3 回合，**每层一次**。
  - 灰烬医师·急救（主动，耗法 4）：回血并净化不良状态。
  - 裂隙盗·穿墙（主动，每层 3 次，需方向）：见 §测试 11/skill。
  - 星盐法师·盐爆（主动，耗法 6）：范围伤害 + 迟缓，**不伤玩家**。
  - 骨钟祭司·钟鸣（主动，耗法 5）：undead 恐惧、余者迟缓；**Boss 仅 1 回合**。
  - 碎刃游侠·投掷（主动，每层 4 次，需方向）：命中重创 + 流血；**空射也消耗**。
  - 铁拳僧·连击（被动）：连续命中同目标递增，上限 5。
  - 铜灯旅人·灯火（主动，每层 3 次）：照亮 + 照陷阱/宝箱虚实，恐吓 shadow/undead/穿墙；**代价**：惊动范围内远程怪。
  - 断链狂徒·狂怒（被动）：低血近战附加伤害，<50% 时获短暂回复。
  - 法力/次数不足、点被动技能键：有日志、**不消耗回合**。
- **失败查**：`GameScene.onSkill/castSkill/performSkill/skill*`、`data/classes.ts`。

## 4. 动作经济（核心：唯一提交入口 `commitPlayerAction`）
- **目的**：所有成功世界动作各消耗 1 回合；UI 不消耗；绝不双回合。
- **步骤 & 预期**（敌人相邻时逐项验证「执行→怪物行动一轮」）：
  - 移动 / 近战 / 远程（含射空）/ 用药剂 / 用食物 / 用卷轴 / 主动技能成功 / **装备 / 卸下 / 丢弃 / 购买** / 搜索 / 等待 / 开门 / 踹门 / 拆陷阱 / 宝箱各动作 → **各 1 回合**。
  - 打开背包 / 角色 / 日志 / 地图 / 设置 / 商店 / 取消瞄准 / 长按查看格子 → **不消耗**。
  - 撞墙 / 背包内无法使用 / 装备失败 / 卸下被诅咒失败 / 金币不足购买失败 / 无方向技能 / 无目标取消 → **不消耗**。
  - 任一动作只触发**一轮**怪物（迟缓状态例外，见 §5）。
- **失败查**：`commitPlayerAction`、`runMonsterRound`、各动作处理（`tryMove/playerAttack/playerRangedAttack/useItem/equipItem/unequipSlot/dropItem/buyFromShop/onSearch/onWait/chest*`）。

## 5. 状态效果（玩家输入层）
- **目的**：八状态对玩家/怪物均生效。
- **步骤**：用 `s.player.statuses=[{type,turns,power}]` 注入，或经陷阱/药剂/技能触发。
  - poisoned/burning：每回合扣血、HUD 显示「毒N/燃N」。
  - frozen：下一次世界动作**失败但消耗 1 回合**，日志「冰霜锁住了你的动作」。
  - confused：移动/方向技能约 35% 偏转，日志「方向感被搅乱」。
  - feared：玩家近战伤害约 ×0.6。
  - slowed：每次行动后怪物**额外行动一轮**（封顶 2 轮），日志「迟缓缠身」。
  - vulnerable：受到伤害 +30%。
  - regenerating：每回合回血。
- **预期**：效果如上；状态结束有恢复日志；同一动作内状态**只 tick 一次**（slowed 双轮下毒只扣一次）。
- **失败查**：`systems/StatusSystem.ts`、`GameScene.tickPlayerStatuses/consumedByFreeze/confuseDir/applyAffixHit`、`core/TurnSystem.ts`。

## 6. 状态存档（玩家）
- **目的**：玩家状态随存档保留。
- **步骤**：中毒/易伤中途退出 → 继续游戏。
- **预期**：状态类型、剩余回合、power 一致恢复；未知状态类型跳过并 `console.warn`、不崩溃。
- **失败查**：`StatusSystem.serializeStatuses/restoreStatuses`、`GameScene.persist`、`core/types.ts(RunState.playerStatuses)`。

## 7. 怪物状态存档
- **目的**：怪物身上状态随楼层快照保留。
- **步骤**：用技能使怪物恐惧/迟缓 → 退出 → 继续。
- **预期**：对应怪物状态恢复。
- **失败查**：`GameScene.snapshotFloor/restoreFloor`、`core/types.ts(SerializedFloor.monsters.statuses)`。

## 8. 鉴定系统
- **目的**：未知物品别名 + 使用揭示。
- **步骤**：捡未鉴药剂/卷轴；使用其一；用鉴物卷轴。
- **预期**：未鉴显示别名（同局固定）；使用后**先播效果、再「认出了这是…」**；鉴物卷轴普通=鉴 1、祝福=鉴 3、诅咒=鉴 1 + 混乱、空背包仍消耗。
- **失败查**：`systems/ItemInstance.ts(Identifier/displayName)`、`InventorySystem.use/identifyFirst`、`GameScene.useItem/applyScroll`。

## 9. blessed / cursed
- **目的**：祝咒影响效果。
- **步骤**：使用不同祝咒的药剂/卷轴；装备不同祝咒装备。
- **预期**：祝福增强（回血 ×1.5、鉴 3 等）、诅咒减弱并常附负面（易伤/混乱）；装备祝咒在装备/鉴定后显示【祝福】/【诅咒】。
- **失败查**：`InventorySystem.use`、`GameScene.applyScroll/applyPotion`、`ItemInstance.rollInstance`。

## 10. cursed 装备卸下 / 解链
- **目的**：诅咒锁定与解除路径。
- **步骤**：装备 cursed 装备尝试卸下；用解缚卷轴；佩戴「赦链」词缀再卸 cursed。
- **预期**：普通卸下被拒（提示）；解缚卷轴普通=解 1、祝福=解全部、诅咒=反噬给装备上诅咒；赦链可强卸 cursed 但扣 10% 生命 + 易伤。
- **失败查**：`InventorySystem.unequip/uncurseFirst/uncurseEquipped/curseRandomEquipped`、`GameScene.applyScroll('uncurse')/unequipSlot`。

## 11. 规则词缀触发
- **目的**：10 个规则词缀实际改变打法、不刷屏。
- **步骤**：经 `s.inventory.equipped.mainhand.affixes=['<key>']` 等装上，触发对应场景。
- **预期**：回声（远程命中→照陷阱 + 标记易伤）、裂骨（近战击杀→邻敌溅射）、折光（每层首次远程减伤）、赦链（卸 cursed）、蓄盐（积蓄→技能增幅）、断步（打 slowed/frozen 增伤）、盗火（杀 burning→回法/回血）、灯芯（搜索 +1 范围 + 偶尔引怪）、血契（≤25% 攻击↑、治疗减半）、静步（开锁/拆陷阱加成）。重要词缀有日志，高频词缀不每回合刷。
- **失败查**：`data/items.ts(AFFIXES)`、`InventorySystem.ruleAffixes/hasRule/ruleParam`、`GameScene.applyAffixHit/applyAffixKill/presentMonsterAttack`。

## 12. 怪物 traits
- **目的**：八类 trait 行为真实。
- **步骤 & 预期**：
  - stealsGold：命中偷金 → 逃离；**击杀夺回**。
  - guardsTreasure：守在锚点宝箱附近，被引远/失明则返回，不卡墙。
  - explodesOnDeath：进入视野**首次预警**、低血再警；死亡炸伤四邻、可远程/陷阱引爆。
  - splitsOnDeath：分裂体不再分裂、**经验 1/3、无掉落**。
  - phasesThroughWalls：可穿墙、**永不出界**。
  - keepsDistance：贴近时后退。
  - poisonAttack：命中使你中毒。
  - opensDoors：会推开关闭的门。
- **失败查**：`systems/AISystem.ts`、`core/TurnSystem.ts`、`GameScene.killMonster/explodeOnDeath/splitOnDeath/presentMonsterAttack/buildMonsters(assignAnchor)`。

## 13. 宝箱交互（撞箱开菜单）
- **目的**：检查/开锁/拆陷阱/强开/打开各自正确、各消耗 1 回合。
- **步骤**：走向关闭宝箱 → 弹菜单；逐个动作。
- **预期**：**踩上不自动开/不自动触发陷阱**；检查（安全，揭示机关）；开锁（敏捷+裂隙盗）；拆陷阱（失败可触发）；强开（攻击；可损货、必触发未拆机关）；打开（上锁不可、未拆机关先触发再产出）；打开后不重复产出；取消免费。
- **失败查**：`GameScene.openChestMenu/chestInspect/chestPick/chestDisarm/chestForce/chestOpen/generateChestLoot/springChestTrap`、`ui/ChestView.ts`、`world/Dungeon.ts(ChestInstance)`。

## 14. 门
- **目的**：开/关/踹/锁/挡视线。
- **步骤**：走向关闭门（开）、上锁门（踹）、长按敞开门（关）。
- **预期**：关闭/上锁门挡移动与视线；开门 1 回合；踹门成功率随攻击、失败可再试（**均消耗**）；长按关门。
- **失败查**：`GameScene.openDoor/forceDoor/tryCloseDoor`、`world/Dungeon.ts(isWalkable/blocksSight)`。

## 15. 陷阱
- **目的**：触发/发现路径。
- **步骤**：踩隐藏陷阱、搜索、铜灯照明、引怪踩陷阱。
- **预期**：尖刺扣血/毒气中毒/传送/索套迟缓；搜索发现四周（灯芯/铜灯更广）；怪物踩中同样触发；抗性减免（医师抗毒）。
- **失败查**：`GameScene.triggerTrap/applyTrapToPlayer/applyTrapToMonster/disarmTrap/discoverHidden/onSearch`、`StatusSystem.applyStatus`。

## 16. 特殊房间模板（连通性！）
- **目的**：6 模板生成且不破坏主线。
- **步骤**：多层游玩，留意进房氛围日志；或 `generateDungeon(depth, rng).specialRooms`。
- **预期**：约 85% 楼层 1–2 间特殊房；锁箱房（守宝怪+宝箱）、陷阱回廊（隐藏陷阱+奖励+远程怪）、盐井房（毒/索套+不死）、余烬巢（爆炸怪，远离出生点）、石龛房（祝祷赌注）、商人密室（锁门+奇货）；**楼梯始终可达**（控制台无「连通性」警告）；第 1 层无过难模板。
- **失败查**：`world/RoomTemplates.ts`、`world/Dungeon.ts(generateDungeon/stairsReachable)`、`ui/AltarView.ts`。

## 17. 商人
- **目的**：金币去向 + 价值。
- **步骤**：踏入游商开店；购买；解锁「商路」后再开。
- **预期**：5 件货（密室更优更贵）；购买扣金、消耗 1 回合（连买有 busy 守卫防双结算）；金币不足/背包满购买失败免费；商路解锁后 6 货位 + 奇货池。
- **失败查**：`GameScene.placeMerchant/openShop/buyFromShop`、`ui/ShopView.ts`、`systems/LootSystem.ts(rollShopStock)`。

## 18. 局外成长（传承）
- **目的**：纵向受限、横向解锁、纯净模式。
- **步骤**：主菜单「传承」消耗碎屑升级；开关「纯净模式」（设置）；解锁「商路」；击杀后长按检查同种怪。
- **预期**：体魄/利刃/行囊/备药为纵向（利刃封顶 +3、体魄封顶 +12）、商路为「解锁」；纯净模式新游戏不吃纵向加成；图鉴：见过的怪检查时显示特性提示。
- **失败查**：`core/Meta.ts(metaStatBonus/UPGRADES)`、`ui/LegacyView.ts`、`core/SaveManager.ts(getMeta/recordSeen)`、`GameScene.create`、`data/monsters.ts(monsterLore)`。

## 19. 旧存档读取
- **目的**：向前兼容、不崩溃。
- **步骤**：手工写入旧 run（无 `playerStatuses`/`floor.monsters.statuses`/`chests` 新字段）与旧 meta（无 `tradeRoutes/seen/version`、超额 `blade:5`），再「继续游戏」/开传承。
- **预期**：均正常加载；缺字段补安全默认；旧 run v5/v6 迁移；超额 meta 等级保留但效果封顶（显示已满）。
- **失败查**：`core/SaveManager.ts`、`StatusSystem.restoreStatuses`、`core/types.ts`、`core/Meta.ts`。

## 20. 死亡流程
- **目的**：死亡结算正确、不被绕过。
- **步骤**：被毒 tick/燃烧 tick/爆裂/陷阱/裂心药剂/直接攻击各致死一次（环骑士验证免死）。
- **预期**：清当前存档、保留历史、计入碎屑；环骑士每层一次免死，所有死亡来源均触发。
- **失败查**：`GameScene.die/tryDeathSave/commitPlayerAction/runMonsterRound`、`core/SaveManager.recordOutcome`、`scenes/DeathScene.ts`。

## 21. 通关流程
- **目的**：胜利结算。
- **步骤**：第 5 层击败「零环守卫」（含半血二阶段）。
- **预期**：二阶段有震鸣预警、属性提升（+2 攻/+2 敏/回复）不至于「突然过难」；胜利清存档、保留历史、给碎屑。
- **失败查**：`GameScene.victory/maybeBossPhase`、`scenes/VictoryScene.ts`。

## 22. 移动端按钮 / 布局
- **目的**：竖屏触控可用、不遮挡。
- **步骤**：真机或窄窗口；点底部 7 键、方向键（瞄准/穿墙时）、商店/背包/宝箱/石龛 overlay 的按钮、长按查看、点外部取消。
- **预期**：按钮整齐不重叠、均响应；overlay DOM 按钮可点、关闭后干净拆除（不残留、不锁 UI）；横屏提示「请竖向放置」。
- **失败查**：`ui/MobileControls.ts`、`ui/HtmlButton.ts`、`ui/UiLayer.ts`、`ui/ChestView.ts/AltarView.ts/ShopView.ts/InventoryView.ts`。

---

## 已知限制 / 备注
- `frozen / confused / feared` 的玩家**输入层已接好**，但当前主要由药剂/卷轴/技能触发（无怪物直接冻结玩家的来源）——验证可用 `s.player.statuses` 注入。
- 商人/石龛在 overlay 开启时执行动作会让怪物在暗幕后行动一轮（设计如此：滞留有风险）。
- 远程攻击与定向技能采用「方向选择」模式而非任意选靶，以适配移动端。
- 数值微调集中在 `GameScene` 顶部 `0.3.10 balance knobs` 常量块。
