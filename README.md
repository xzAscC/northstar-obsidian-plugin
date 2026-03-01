---
tags:
  - ops/plugin/obsidian
  - content/guide
  - area/tech-notes/opencode
---

# Northstar Forge（Goal / Kanban Todo / Milestone）

相关链接：[[tech-notes/obsidian-goals-plugin-implementation-plan]] [[tech-notes/README]]

这个插件会扫描 `Goals/` 下 `type: goal` 的笔记，并渲染成类似 Leantime 的 Goal 卡片板。
同时提供：

- `Northstar Homepage`：启动 Obsidian 自动打开主页，包含 Local Calendar（点击日期打开对应日报；若缺失会按模板创建）和 Daily List（本地时间每天 05:00 自动重置）。
- `Milestone Kanban`：集中查看某个里程碑下包含的 goal 与 markdown todo。
- `Kanban Todo`：读取 `Kanban/` 目录中的 todo 文件（每个 todo 一个 `.md` 文件），直接在 Northstar Forge 里查看未完成待办。

> 注意：`milestone`、`list`、`priority` 等字段必须写在 Markdown 文件开头的 frontmatter（Obsidian Properties）里，不能只写在正文。

## 1) 目标文件格式

每个目标一个 Markdown 文件，建议放在 `Goals/` 目录。

```yaml
---
type: goal
board: Reading
metric: Papers
start: 0
current: 2
target: 30
unit: papers
due: 2026-12-31
status: on-track

owner: xu
milestone: 全年里程碑
milestoneDue: 2027-01-01
milestonePercent: 0

boardArchived: false
---
```

正文里可选加评论段，插件会自动统计列表条数：

```md
## Comments
- comment 1
- comment 2
```

## 2) 卡片字段说明

- `Goal: <文件名>`：来自笔记文件名。
- `board`：用于分组展示（兼容旧字段 `area`）。
- `Metric`：优先读取 `metric`，没有时回退到 `unit`。
- 进度条与 `% Complete`：由 `start/current/target` 自动计算。
- `Status`：读取 `status`，如 `on-track` / `at-risk` / `off-track`。
- 评论数：统计 `## Comments` 下的无序列表项。
- 右侧圆形头像：读取 `owner` 或 `assignee` 的首字母。
- 底部里程碑条：`milestone`、`milestoneDue`、`milestonePercent`。

`milestonePercent` 也可不写，改用这组字段自动算：

```yaml
milestoneCurrent: 3
milestoneTarget: 12
```

## 3) 如何开启和使用

1. 把目标笔记放到 `Goals/`（或在插件设置里改 `Goals folder`）。
2. 在 Obsidian 启用插件后，点击左侧 `target` 图标或命令面板执行 `Open Northstar Forge`（会在主工作区以标签页打开，不再固定到右侧边栏）。
3. 每个 board 顶部会显示总览（Progress、On Track、At Risk、Miss）。
4. 可拖拽 board 区块手动调整显示顺序（会持久保存）。
5. 可点击 board 标题右侧 `Archive` 按钮，一键归档整个 board（会把该 board 下目标写入 `boardArchived: true` 并隐藏）。
6. 在面板中使用 `+1 / -1 / +10 / -10` 快速调整 `current`，会直接写回 frontmatter。
7. 每张卡片可直接修改基础字段（`title`、`board`、`metric`、`start/current/target`、`due`、`status`），无需打开原始 Markdown。
8. 在 dashboard 顶部点击 `Create New Goal` 可直接新建目标文件（填写名称、board、metric、target、due）。
9. 编辑任意目标文件后，面板会自动刷新（也可点 `Refresh`）。
10. 启用插件并打开 Obsidian 时，默认会自动打开 `Northstar Homepage`（可在设置中关闭）。
11. 主页 `Local Calendar` 支持 `Month / Week` 视图切换，并可通过左右按钮切换月份或周。
12. 点击任意日期会打开对应日报；若文件不存在，会按 `Daily template path` 自动创建。
13. 可在设置里指定 `Local calendar daily root` 与 `Daily template path`。
14. 主页 `Daily List` 会在本地时间每天 `05:00` 自动重置，模版可在设置里配置（每行一条）。
15. 点击右上角 `Milestone Kanban`（或命令 `Open Milestone Kanban`）可打开里程碑看板，按 milestone 聚合 goal 与 todo。
16. 点击 `Kanban Todo`（或命令 `Open Kanban Todo`）可打开 Kanban 任务视图，按「一个文件一个 todo」展示。
17. 在 `Kanban Todo` 页点击 `Create New Todo` 可直接新建 todo 文件（填写名称与任务内容）。
18. 每个 todo 文件正文建议使用单行 checkbox：`- [ ] 任务内容`。
19. todo 元数据（`list`、`milestone`、`goal`、`priority`、`due`、`schedule`、`tags`、`planHours`、`hoursLeft`）必须写在文件开头 frontmatter。
20. 若旧 todo 文件缺少上述 frontmatter 字段，插件在读取时会自动补齐默认 properties 并写回文件。
21. 视图默认只展示未完成项；已完成项不会在列表中显示。
22. 可在面板里直接点击 checkbox 切换 `- [ ]` / `- [x]`，并写回原文件。
23. 视图中不展示 `Todo:` / `Done:` 前缀，直接显示 checkbox 形态内容。

## 4) 常见问题

- 看不到卡片：检查 frontmatter 是否有 `type: goal`，且数值字段是数字。
- 某个 board 不显示：检查是否配置了 `boardArchived: true`，或 board 名称是 `Archived`。
- 进度异常：确认 `start/current/target` 都是可解析的数字。
- 评论数为 0：确认使用二级标题 `## Comments`，并在下方使用 `-` 列表。
