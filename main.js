const {
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
} = require("obsidian");

const VIEW_TYPE_GOALS_DASHBOARD = "goals-dashboard-view";

const DEFAULT_SETTINGS = {
  goalsFolder: "Goals",
  boardOrder: [],
};

class GoalsDashboardPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_GOALS_DASHBOARD,
      (leaf) => new GoalsDashboardView(leaf, this),
    );

    this.addRibbonIcon("target", "Open Goals Dashboard", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-goals-dashboard",
      name: "Open Goals Dashboard",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new GoalsDashboardSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GOALS_DASHBOARD);
  }

  async activateView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_GOALS_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_GOALS_DASHBOARD,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.boardOrder)) {
      this.settings.boardOrder = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async getGoals() {
    const allFiles = this.app.vault.getMarkdownFiles();
    const goals = [];
    const base = this.settings.goalsFolder.replace(/^\/+|\/+$/g, "");
    const folderPrefix = `${base}/`;

    for (const file of allFiles) {
      const inFolder = file.path === base || file.path.startsWith(folderPrefix);
      if (!inFolder) {
        continue;
      }

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || frontmatter.type !== "goal") {
        continue;
      }

      const start = Number(frontmatter.start ?? 0);
      const current = Number(frontmatter.current ?? 0);
      const target = Number(frontmatter.target ?? 0);

      if (![start, current, target].every(Number.isFinite)) {
        continue;
      }

      const denominator = target - start;
      const rawProgress = denominator === 0 ? (current >= target ? 1 : 0) : (current - start) / denominator;
      const clampedProgress = Math.max(0, Math.min(1, rawProgress));
      const percent = Math.round(clampedProgress * 100);
      const content = await this.app.vault.cachedRead(file);

      goals.push({
        file,
        name: file.basename,
        board: normalizeBoard(frontmatter.board ?? frontmatter.area ?? "Uncategorized"),
        metric: frontmatter.metric ?? frontmatter.unit ?? "",
        start,
        current,
        target,
        unit: frontmatter.unit ?? "",
        due: frontmatter.due ?? "",
        status: frontmatter.status ?? "on-track",
        percent,
        ownerInitials: getOwnerInitials(frontmatter),
        taskTitle: String(frontmatter.task ?? frontmatter.taskTitle ?? "Main Task"),
        taskDue: frontmatter.taskDue ?? frontmatter.due ?? "",
        taskPercent: getTaskPercent(frontmatter),
        commentsCount: countComments(content),
        archived: isTruthy(frontmatter.archived),
        boardArchived: isBoardArchived(frontmatter),
      });
    }

    return goals.sort((a, b) => {
      const boardCompare = String(a.board).localeCompare(String(b.board));
      if (boardCompare !== 0) {
        return boardCompare;
      }

      if (a.due && b.due) {
        const dueCompare = String(a.due).localeCompare(String(b.due));
        if (dueCompare !== 0) {
          return dueCompare;
        }
      }

      return a.name.localeCompare(b.name);
    });
  }

  async updateCurrent(file, delta) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const currentValue = Number(fm.current ?? 0);
      fm.current = Number.isFinite(currentValue) ? currentValue + delta : delta;
    });
  }

  async archiveBoardGoals(goals) {
    for (const goal of goals) {
      await this.app.fileManager.processFrontMatter(goal.file, (fm) => {
        fm.board = normalizeBoard(fm.board ?? fm.area ?? goal.board);
        fm.boardArchived = true;
        fm.boardStatus = "archived";
      });
    }
  }
}

class GoalsDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
    this.draggingBoard = null;
  }

  getViewType() {
    return VIEW_TYPE_GOALS_DASHBOARD;
  }

  getDisplayText() {
    return "Goals Dashboard";
  }

  getIcon() {
    return "target";
  }

  async onOpen() {
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.queueRefresh();
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", () => {
        this.queueRefresh();
      }),
    );

    await this.render();
  }

  async onClose() {
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.draggingBoard = null;
  }

  queueRefresh() {
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      this.render();
    }, 150);
  }

  async openGoalInRightPane(file) {
    const leaf = this.app.workspace.getLeaf("split");
    await leaf.openFile(file, { active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("goals-dashboard-view");

    const header = container.createDiv({ cls: "goals-dashboard-header" });
    header.createEl("h2", { text: "Goals Dashboard" });

    const refreshButton = header.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Refresh",
    });
    refreshButton.addEventListener("click", () => this.render());

    const goals = await this.plugin.getGoals();

    if (goals.length === 0) {
      container.createEl("p", {
        cls: "goals-dashboard-empty",
        text: `No goal files found in ${this.plugin.settings.goalsFolder}/`,
      });
      return;
    }

    const activeGoals = goals.filter((goal) => !isGoalArchived(goal));
    const grouped = groupBy(activeGoals, (goal) => String(goal.board));
    const orderedEntries = getOrderedBoardEntries(grouped, this.plugin.settings.boardOrder);
    const visibleEntries = orderedEntries.filter(([board, boardGoals]) => !shouldHideBoard(board, boardGoals));
    const visibleBoardNames = visibleEntries.map(([board]) => board);

    if (visibleEntries.length === 0) {
      container.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "No active boards to display.",
      });
      return;
    }

    for (const [board, boardGoals] of visibleEntries) {
      const section = container.createDiv({ cls: "goals-board-section" });
      const boardHeader = section.createDiv({ cls: "goals-board-header" });
      boardHeader.createEl("h3", { cls: "goals-board-title", text: board });
      this.createBoardHeaderActions(boardHeader, board, boardGoals, visibleBoardNames, section);
      createBoardSummary(section, boardGoals);

      const boardWrap = section.createDiv({ cls: "goals-board-grid" });
      for (const goal of boardGoals) {
        const card = boardWrap.createDiv({ cls: "goal-card" });

        const topRow = card.createDiv({ cls: "goal-top-row" });
        const title = topRow.createEl("button", {
          cls: "goal-title-link",
          text: `Goal: ${goal.name}`,
        });
        title.addEventListener("click", async () => {
          await this.openGoalInRightPane(goal.file);
        });

        const menuButton = topRow.createEl("button", {
          cls: "goal-menu-btn",
        });
        menuButton.ariaLabel = `Open ${goal.name}`;
        setIcon(menuButton, "more-vertical");
        menuButton.addEventListener("click", async () => {
          await this.openGoalInRightPane(goal.file);
        });

        const metric = card.createDiv({ cls: "goal-metric-row" });
        metric.createSpan({ cls: "goal-label", text: "Metric:" });
        metric.createSpan({
          cls: "goal-metric-text",
          text: goal.metric ? ` ${goal.metric}` : " -",
        });

        const progressText = card.createEl("div", {
          cls: "goal-progress-text",
          text: `${goal.percent}% Complete`,
        });
        progressText.title = `${goal.current} / ${goal.target} ${goal.unit}`.trim();

        const progress = card.createEl("progress", {
          cls: "goal-progress",
        });
        progress.max = 100;
        progress.value = goal.percent;

        const stats = card.createDiv({ cls: "goal-stats" });
        createStatItem(stats, "Start", goal.start);
        createStatItem(stats, "Current", goal.current);
        createStatItem(stats, "Goal", goal.target);

        const statusRow = card.createDiv({ cls: "goal-status-row" });
        const status = statusRow.createEl("button", {
          cls: `goal-status goal-status-${normalizeStatus(goal.status)}`,
          text: `${formatStatus(goal.status)} v`,
        });
        status.ariaLabel = `Status: ${goal.status}`;
        status.addEventListener("click", async () => {
          await this.openGoalInRightPane(goal.file);
        });

        const sideMeta = statusRow.createDiv({ cls: "goal-side-meta" });
        const comments = sideMeta.createDiv({ cls: "goal-comments" });
        const commentsIcon = comments.createSpan({ cls: "goal-comments-icon" });
        setIcon(commentsIcon, "message-circle");
        comments.createSpan({ text: String(goal.commentsCount) });

        sideMeta.createEl("span", {
          cls: "goal-owner-chip",
          text: goal.ownerInitials,
        });

        const meta = card.createDiv({ cls: "goal-meta" });
        const taskLink = meta.createEl("button", {
          cls: "goal-task-link",
          text: goal.taskTitle,
        });
        taskLink.addEventListener("click", async () => {
          await this.openGoalInRightPane(goal.file);
        });

        const taskBottom = meta.createDiv({ cls: "goal-task-bottom" });
        taskBottom.createEl("span", {
          text: goal.taskDue ? `Due By: ${goal.taskDue}` : "Due By: -",
        });
        taskBottom.createEl("span", {
          text: `${formatPercent(goal.taskPercent)} Complete`,
        });

        const actions = card.createDiv({ cls: "goal-actions" });
        const minusBtn = actions.createEl("button", {
          cls: "goal-action-btn",
          text: "-1",
        });
        const plusBtn = actions.createEl("button", {
          cls: "goal-action-btn",
          text: "+1",
        });

        minusBtn.addEventListener("click", async () => {
          await this.adjustCurrent(goal.file, -1);
        });

        plusBtn.addEventListener("click", async () => {
          await this.adjustCurrent(goal.file, 1);
        });
      }
    }
  }

  createBoardHeaderActions(headerEl, board, boardGoals, boardOrder, sectionEl) {
    const controls = headerEl.createDiv({ cls: "goals-board-controls" });
    const dragHint = controls.createDiv({
      cls: "goals-board-drag-hint",
      text: "Drag",
    });
    dragHint.ariaLabel = `Drag to reorder board ${board}`;
    dragHint.title = "Drag board to reorder";

    const archiveButton = controls.createEl("button", {
      cls: "goals-board-archive-btn",
      text: "Archive",
    });
    archiveButton.addEventListener("click", async () => {
      await this.archiveBoard(board, boardGoals);
    });

    this.enableBoardDragAndDrop(sectionEl, board, boardOrder);
  }

  enableBoardDragAndDrop(sectionEl, board, visibleBoardOrder) {
    sectionEl.setAttribute("draggable", "true");
    sectionEl.dataset.board = board;

    sectionEl.addEventListener("dragstart", (event) => {
      this.draggingBoard = board;
      sectionEl.addClass("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", board);
      }
    });

    sectionEl.addEventListener("dragend", () => {
      this.draggingBoard = null;
      this.clearDragClasses();
    });

    sectionEl.addEventListener("dragover", (event) => {
      const sourceBoard = this.draggingBoard;
      if (!sourceBoard || sourceBoard === board) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      sectionEl.addClass("is-drop-target");
    });

    sectionEl.addEventListener("dragleave", () => {
      sectionEl.removeClass("is-drop-target");
    });

    sectionEl.addEventListener("drop", async (event) => {
      event.preventDefault();
      sectionEl.removeClass("is-drop-target");

      const sourceBoard = this.draggingBoard || event.dataTransfer?.getData("text/plain");
      if (!sourceBoard || sourceBoard === board) {
        return;
      }

      const targetIndex = visibleBoardOrder.indexOf(board);
      await this.moveBoardToIndex(sourceBoard, targetIndex, visibleBoardOrder);
    });
  }

  async moveBoardToIndex(board, targetIndex, visibleBoardOrder) {
    const normalizedOrder = normalizeBoardOrder(this.plugin.settings.boardOrder, visibleBoardOrder);
    const sourceIndex = normalizedOrder.indexOf(board);
    if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= normalizedOrder.length) {
      return;
    }

    if (sourceIndex === targetIndex) {
      return;
    }

    const [moved] = normalizedOrder.splice(sourceIndex, 1);
    normalizedOrder.splice(targetIndex, 0, moved);
    this.plugin.settings.boardOrder = normalizedOrder;
    await this.plugin.saveSettings();
    await this.render();
  }

  clearDragClasses() {
    const sections = this.containerEl.querySelectorAll(".goals-board-section");
    for (const section of sections) {
      section.removeClass("is-dragging");
      section.removeClass("is-drop-target");
    }
  }

  async archiveBoard(board, boardGoals) {
    try {
      await this.plugin.archiveBoardGoals(boardGoals);
      new Notice(`Board archived: ${board}`);
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to archive board.");
    }
  }

  async adjustCurrent(file, delta) {
    try {
      await this.plugin.updateCurrent(file, delta);
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to update current value.");
    }
  }
}

class GoalsDashboardSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Goals Dashboard settings" });

    new Setting(containerEl)
      .setName("Goals folder")
      .setDesc("Folder that contains your goal markdown files.")
      .addText((text) =>
        text
          .setPlaceholder("Goals")
          .setValue(this.plugin.settings.goalsFolder)
          .onChange(async (value) => {
            this.plugin.settings.goalsFolder = value.trim() || DEFAULT_SETTINGS.goalsFolder;
            await this.plugin.saveSettings();
          }),
      );
  }
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  }
  return map;
}

function isSidebarLeaf(workspace, leaf) {
  if (!leaf || typeof leaf.getRoot !== "function") {
    return false;
  }

  const root = leaf.getRoot();
  return root === workspace.leftSplit || root === workspace.rightSplit;
}

function normalizeStatus(status) {
  const normalized = String(status).trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "off-track") {
    return "miss";
  }
  return normalized;
}

function createStatItem(container, label, value) {
  const item = container.createDiv({ cls: "goal-stat-item" });
  item.createEl("span", { cls: "goal-label", text: `${label}:` });
  item.createEl("span", { cls: "goal-stat-value", text: String(value) });
}

function formatStatus(status) {
  const value = String(status || "on-track");
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function countComments(content) {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+comments\s*$/i.test(line.trim()));

  if (headingIndex === -1) {
    return 0;
  }

  let count = 0;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (/^##\s+/.test(line)) {
      break;
    }

    if (/^[-*+]\s+/.test(line)) {
      count += 1;
    }
  }

  return count;
}

function getOwnerInitials(frontmatter) {
  const raw = String(frontmatter.owner ?? frontmatter.assignee ?? "").trim();
  if (!raw) {
    return "GO";
  }

  const chunks = raw
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());

  return chunks.join("") || "GO";
}

function getTaskPercent(frontmatter) {
  const explicitPercent = Number(frontmatter.taskPercent);
  if (Number.isFinite(explicitPercent)) {
    return clamp(explicitPercent, 0, 100);
  }

  const current = Number(frontmatter.taskCurrent ?? 0);
  const target = Number(frontmatter.taskTarget ?? 0);
  if (Number.isFinite(current) && Number.isFinite(target) && target > 0) {
    return clamp((current / target) * 100, 0, 100);
  }

  return 0;
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBoard(value) {
  const board = String(value ?? "").trim();
  return board || "Uncategorized";
}

function isGoalArchived(goal) {
  return isTruthy(goal.archived) || isTruthy(goal.boardArchived) || normalizeStatus(goal.status) === "archived";
}

function isBoardArchived(frontmatter) {
  const boardStatus = String(frontmatter.boardStatus ?? "").trim().toLowerCase();
  return isTruthy(frontmatter.boardArchived) || boardStatus === "archived";
}

function isTruthy(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function shouldHideBoard(boardName, boardGoals) {
  if (!boardGoals.length) {
    return true;
  }

  if (String(boardName).trim().toLowerCase() === "archived") {
    return true;
  }

  return false;
}

function getOrderedBoardEntries(groupedBoards, persistedOrder) {
  const boards = Array.from(groupedBoards.keys());
  const normalizedOrder = normalizeBoardOrder(persistedOrder, boards);

  return normalizedOrder
    .map((board) => [board, groupedBoards.get(board)])
    .filter(([, boardGoals]) => Array.isArray(boardGoals) && boardGoals.length > 0);
}

function normalizeBoardOrder(persistedOrder, boardsInView) {
  const uniquePersisted = [];
  for (const board of Array.isArray(persistedOrder) ? persistedOrder : []) {
    const normalized = normalizeBoard(board);
    if (!uniquePersisted.includes(normalized)) {
      uniquePersisted.push(normalized);
    }
  }

  for (const board of boardsInView) {
    const normalized = normalizeBoard(board);
    if (!uniquePersisted.includes(normalized)) {
      uniquePersisted.push(normalized);
    }
  }

  return uniquePersisted.filter((board) => boardsInView.includes(board));
}

function createBoardSummary(container, boardGoals) {
  const { percent, onTrack, atRisk, miss } = summarizeBoard(boardGoals);

  const summary = container.createDiv({ cls: "board-summary" });

  const progressCard = summary.createDiv({ cls: "board-summary-progress" });
  progressCard.createEl("div", {
    cls: "board-summary-progress-label",
    text: `Progress: ${percent}%`,
  });

  const progress = progressCard.createEl("progress", {
    cls: "board-summary-progress-bar",
  });
  progress.max = 100;
  progress.value = percent;

  const statusWrap = summary.createDiv({ cls: "board-summary-status-grid" });
  createBoardStatusCard(statusWrap, "On Track", onTrack, "on-track");
  createBoardStatusCard(statusWrap, "At Risk", atRisk, "at-risk");
  createBoardStatusCard(statusWrap, "Miss", miss, "miss");
}

function createBoardStatusCard(container, label, value, variant) {
  const card = container.createDiv({ cls: `board-summary-status board-summary-status-${variant}` });
  card.createEl("div", {
    cls: "board-summary-status-label",
    text: label,
  });
  card.createEl("div", {
    cls: "board-summary-status-value",
    text: String(value),
  });
}

function summarizeBoard(goals) {
  let sumStart = 0;
  let sumCurrent = 0;
  let sumTarget = 0;
  let fallbackPercentSum = 0;

  let onTrack = 0;
  let atRisk = 0;
  let miss = 0;

  for (const goal of goals) {
    sumStart += Number(goal.start) || 0;
    sumCurrent += Number(goal.current) || 0;
    sumTarget += Number(goal.target) || 0;
    fallbackPercentSum += Number(goal.percent) || 0;

    const statusBucket = getStatusBucket(goal.status);
    if (statusBucket === "on-track") {
      onTrack += 1;
    } else if (statusBucket === "at-risk") {
      atRisk += 1;
    } else {
      miss += 1;
    }
  }

  const denominator = sumTarget - sumStart;
  let percent = 0;
  if (denominator > 0) {
    percent = Math.round(clamp(((sumCurrent - sumStart) / denominator) * 100, 0, 100));
  } else if (goals.length > 0) {
    percent = Math.round(clamp(fallbackPercentSum / goals.length, 0, 100));
  }

  return { percent, onTrack, atRisk, miss };
}

function getStatusBucket(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "on-track") {
    return "on-track";
  }

  if (normalized === "at-risk") {
    return "at-risk";
  }

  return "miss";
}

module.exports = GoalsDashboardPlugin;
