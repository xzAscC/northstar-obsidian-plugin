const {
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
} = require("obsidian");

const VIEW_TYPE_GOALS_DASHBOARD = "goals-dashboard-view";
const VIEW_TYPE_MILESTONE_DASHBOARD = "goals-milestone-view";
const VIEW_TYPE_KANBAN_TODO_DASHBOARD = "goals-kanban-todo-view";

const DEFAULT_SETTINGS = {
  goalsFolder: "Goals",
  kanbanFolder: "Kanban",
  boardOrder: [],
  kanbanListOrder: ["Today"],
};

class GoalsDashboardPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_GOALS_DASHBOARD,
      (leaf) => new GoalsDashboardView(leaf, this),
    );

    this.registerView(
      VIEW_TYPE_MILESTONE_DASHBOARD,
      (leaf) => new MilestoneDashboardView(leaf, this),
    );

    this.registerView(
      VIEW_TYPE_KANBAN_TODO_DASHBOARD,
      (leaf) => new KanbanTodoDashboardView(leaf, this),
    );

    this.addRibbonIcon("target", "Open Planning Hub", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-goals-dashboard",
      name: "Open Planning Hub",
      callback: () => this.activateView(),
    });

    this.addRibbonIcon("flag", "Open Milestone Kanban", () => {
      this.activateMilestoneView();
    });

    this.addCommand({
      id: "open-milestones-dashboard",
      name: "Open Milestone Kanban",
      callback: () => this.activateMilestoneView(),
    });

    this.addRibbonIcon("columns-3", "Open Kanban Todo", () => {
      this.activateKanbanTodoView();
    });

    this.addCommand({
      id: "open-kanban-todo-dashboard",
      name: "Open Kanban Todo",
      callback: () => this.activateKanbanTodoView(),
    });

    this.addSettingTab(new GoalsDashboardSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GOALS_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MILESTONE_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_KANBAN_TODO_DASHBOARD);
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

  async activateMilestoneView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_MILESTONE_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_MILESTONE_DASHBOARD,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async activateKanbanTodoView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_KANBAN_TODO_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_KANBAN_TODO_DASHBOARD,
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

    this.settings.kanbanListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, []);

    this.settings.goalsFolder = normalizeFolderPath(this.settings.goalsFolder, DEFAULT_SETTINGS.goalsFolder);
    this.settings.kanbanFolder = normalizeFolderPath(this.settings.kanbanFolder, DEFAULT_SETTINGS.kanbanFolder);
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
      goals.push({
        file,
        name: file.basename,
        title: String(frontmatter.title ?? file.basename).trim() || file.basename,
        board: normalizeBoard(frontmatter.board ?? frontmatter.area ?? "Uncategorized"),
        metric: frontmatter.metric ?? frontmatter.unit ?? "",
        start,
        current,
        target,
        unit: frontmatter.unit ?? "",
        due: frontmatter.due ?? "",
        status: frontmatter.status ?? "on-track",
        milestone: frontmatter.milestone ?? frontmatter.task ?? "",
        milestoneDue: frontmatter.milestoneDue ?? frontmatter.taskDue ?? "",
        percent,
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

      return String(a.title).localeCompare(String(b.title));
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

  async updateGoalFields(file, updates) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [key, value] of Object.entries(updates)) {
        fm[key] = value;
      }
    });
  }

  async createGoalFile(payload) {
    const name = String(payload.name ?? "").trim();
    if (!name) {
      throw new Error("missing-goal-name");
    }

    const goalsFolder = normalizeGoalsFolder(this.settings.goalsFolder);
    await ensureFolderExists(this.app.vault, goalsFolder);

    const targetValue = Number(payload.target ?? 1);
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      throw new Error("invalid-target");
    }

    const sanitizedBaseName = sanitizeFileName(name) || `goal-${Date.now()}`;
    const filePath = getUniquePath(this.app.vault, goalsFolder, sanitizedBaseName);
    const content = buildGoalTemplate({
      board: normalizeBoard(payload.board),
      metric: String(payload.metric ?? "").trim(),
      due: String(payload.due ?? "").trim(),
      target: targetValue,
    });

    return this.app.vault.create(filePath, content);
  }

  async createKanbanTodoFile(payload) {
    const name = String(payload.name ?? "").trim();
    const text = String(payload.text ?? "").trim();
    const list = normalizeKanbanListName(payload.list);
    const milestone = String(payload.milestone ?? "").trim();

    if (!name) {
      throw new Error("missing-todo-name");
    }

    if (!text) {
      throw new Error("missing-todo-text");
    }

    if (!milestone) {
      throw new Error("missing-todo-milestone");
    }

    const kanbanFolder = normalizeFolderPath(this.settings.kanbanFolder, DEFAULT_SETTINGS.kanbanFolder);
    await ensureFolderExists(this.app.vault, kanbanFolder);

    const nextListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [list]);
    if (nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n")) {
      this.settings.kanbanListOrder = nextListOrder;
      await this.saveSettings();
    }

    const sanitizedBaseName = sanitizeFileName(name) || `todo-${Date.now()}`;
    const filePath = getUniquePath(this.app.vault, kanbanFolder, sanitizedBaseName);
    const content = buildKanbanTodoTemplate({
      text,
      list,
      milestone,
      goal: payload.goal,
      priority: payload.priority,
      due: payload.due,
      schedule: payload.schedule,
      tags: payload.tags,
      planHours: payload.planHours,
      hoursLeft: payload.hoursLeft,
    });

    return this.app.vault.create(filePath, content);
  }

  async createKanbanList(name) {
    const listName = normalizeKanbanListName(name);
    const nextListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [listName]);
    const changed = nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n");
    if (changed) {
      this.settings.kanbanListOrder = nextListOrder;
      await this.saveSettings();
    }

    return {
      name: listName,
      created: changed,
    };
  }

  async getGoalTodos(file) {
    const raw = await this.app.vault.cachedRead(file);
    return extractTodoItems(raw);
  }

  async getKanbanBoards() {
    const allFiles = this.app.vault.getMarkdownFiles();
    const todos = [];
    const base = normalizeFolderPath(this.settings.kanbanFolder, "");
    const folderPrefix = base ? `${base}/` : "";

    for (const file of allFiles) {
      if (base) {
        const inFolder = file.path === base || file.path.startsWith(folderPrefix);
        if (!inFolder) {
          continue;
        }
      }

      const raw = await this.app.vault.cachedRead(file);
      const todo = parseSingleTodoFile(raw);
      if (!todo) {
        continue;
      }

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const metadata = parseKanbanTodoMetadata(frontmatter);

      todos.push({
        file,
        name: file.basename,
        text: todo.text,
        done: todo.done,
        list: metadata.list,
        milestone: metadata.milestone,
        goal: metadata.goal,
        priority: metadata.priority,
        due: metadata.due,
        tags: metadata.tags,
        schedule: metadata.schedule,
        planHours: metadata.planHours,
        hoursLeft: metadata.hoursLeft,
      });
    }

    const listOrder = normalizeKanbanListOrder(
      this.settings.kanbanListOrder,
      todos.map((todo) => todo.list),
    );

    return todos.sort((left, right) => {
      const leftListIndex = listOrder.indexOf(left.list);
      const rightListIndex = listOrder.indexOf(right.list);
      if (leftListIndex !== rightListIndex) {
        return leftListIndex - rightListIndex;
      }

      if (left.done !== right.done) {
        return Number(left.done) - Number(right.done);
      }

      return String(left.name).localeCompare(String(right.name));
    });
  }

  async setKanbanTodoDone(file, done) {
    const raw = await this.app.vault.cachedRead(file);
    const lines = String(raw ?? "").split(/\r?\n/);
    const targetState = done ? "x" : " ";

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*[-*]\s+)\[([ xX])\](\s+.+)$/);
      if (!match) {
        continue;
      }

      lines[index] = `${match[1]}[${targetState}]${match[3]}`;
      await this.app.vault.modify(file, lines.join("\n"));
      return;
    }

    throw new Error("todo-checkbox-not-found");
  }

  async getMilestones() {
    const goals = await this.getGoals();
    const activeGoals = goals.filter((goal) => !isGoalArchived(goal));
    if (activeGoals.length === 0) {
      return [];
    }

    const goalsWithTodos = await Promise.all(
      activeGoals.map(async (goal) => {
        const todos = await this.getGoalTodos(goal.file);
        return { ...goal, todos };
      }),
    );

    const grouped = new Map();
    for (const goal of goalsWithTodos) {
      const milestoneName = normalizeMilestone(goal.milestone);
      if (!grouped.has(milestoneName)) {
        grouped.set(milestoneName, {
          name: milestoneName,
          due: String(goal.milestoneDue ?? "").trim(),
          goals: [],
          todos: [],
          todoOpen: 0,
          todoDone: 0,
        });
      }

      const bucket = grouped.get(milestoneName);
      bucket.goals.push(goal);

      if (!bucket.due) {
        bucket.due = String(goal.milestoneDue ?? "").trim();
      }

      for (const todo of goal.todos) {
        bucket.todos.push({
          goalTitle: goal.title,
          goalFile: goal.file,
          text: todo.text,
          done: todo.done,
        });

        if (todo.done) {
          bucket.todoDone += 1;
        } else {
          bucket.todoOpen += 1;
        }
      }
    }

    const milestones = Array.from(grouped.values());
    milestones.sort((left, right) => {
      const dueCompare = compareDue(left.due, right.due);
      if (dueCompare !== 0) {
        return dueCompare;
      }

      return String(left.name).localeCompare(String(right.name));
    });

    return milestones;
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
    return "Planning Hub";
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
    header.createEl("h2", { text: "Planning Hub" });

    const headerActions = header.createDiv({ cls: "goals-dashboard-header-actions" });

    const createButton = headerActions.createEl("button", {
      cls: "goals-dashboard-create",
    });
    createButton.ariaLabel = "Create New Goal";
    const createIcon = createButton.createSpan({ cls: "goals-dashboard-create-icon" });
    setIcon(createIcon, "plus");
    createButton.createSpan({
      cls: "goals-dashboard-create-label",
      text: "Create New Goal",
    });
    createButton.addEventListener("click", async () => {
      await this.createGoalFromDashboard();
    });

    const refreshButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Refresh",
    });
    refreshButton.addEventListener("click", () => this.render());

    const milestoneButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Milestone Kanban",
    });
    milestoneButton.addEventListener("click", async () => {
      await this.plugin.activateMilestoneView();
    });

    const kanbanButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Kanban Todo",
    });
    kanbanButton.addEventListener("click", async () => {
      await this.plugin.activateKanbanTodoView();
    });

    const goals = await this.plugin.getGoals();
    const boardOptions = getUniqueGoalValues(goals, "board");
    const metricOptions = getUniqueGoalValues(goals, "metric");

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
        const titleInput = topRow.createEl("input", {
          cls: "goal-title-input",
          type: "text",
          value: goal.title,
          placeholder: goal.name,
        });

        const commitTitle = async () => {
          await this.tryCommitQuickEdit(async (value) => {
            await this.saveGoalField(goal.file, "title", String(value || "").trim());
          }, titleInput.value);
        };

        titleInput.addEventListener("change", commitTitle);
        titleInput.addEventListener("keydown", async (event) => {
          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();
          await commitTitle();
          titleInput.blur();
        });

        const menuButton = topRow.createEl("button", {
          cls: "goal-menu-btn",
        });
        menuButton.ariaLabel = `Open ${goal.title}`;
        setIcon(menuButton, "more-vertical");
        menuButton.addEventListener("click", async () => {
          await this.openGoalInRightPane(goal.file);
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

        const quickEdit = card.createDiv({ cls: "goal-quick-edit" });
        this.createQuickEditFields(quickEdit, goal, {
          boardOptions,
          metricOptions,
        });

        const actions = card.createDiv({ cls: "goal-actions" });
        const minusTenBtn = actions.createEl("button", {
          cls: "goal-action-btn",
          text: "-10",
        });
        const minusBtn = actions.createEl("button", {
          cls: "goal-action-btn",
          text: "-1",
        });
        const plusBtn = actions.createEl("button", {
          cls: "goal-action-btn",
          text: "+1",
        });
        const plusTenBtn = actions.createEl("button", {
          cls: "goal-action-btn",
          text: "+10",
        });

        minusBtn.addEventListener("click", async () => {
          await this.adjustCurrent(goal.file, -1);
        });

        minusTenBtn.addEventListener("click", async () => {
          await this.adjustCurrent(goal.file, -10);
        });

        plusBtn.addEventListener("click", async () => {
          await this.adjustCurrent(goal.file, 1);
        });

        plusTenBtn.addEventListener("click", async () => {
          await this.adjustCurrent(goal.file, 10);
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

  async createGoalFromDashboard() {
    const goals = await this.plugin.getGoals();
    const boardOptions = getUniqueGoalValues(goals, "board");
    const metricOptions = getUniqueGoalValues(goals, "metric");
    const defaultBoard = normalizeBoard(
      this.plugin.settings.boardOrder?.[0] ?? boardOptions[0] ?? "Uncategorized",
    );
    const payload = await this.promptCreateGoal({
      board: defaultBoard,
      boardOptions,
      metricOptions,
    });
    if (!payload) {
      return;
    }

    try {
      const file = await this.plugin.createGoalFile(payload);
      new Notice(`Goal created: ${file.basename}`);
      await this.render();
      await this.openGoalInRightPane(file);
    } catch (error) {
      if (error && error.message === "missing-goal-name") {
        new Notice("Please provide a goal name.");
      } else if (error && error.message === "invalid-target") {
        new Notice("Target must be a number greater than 0.");
      } else {
        console.error(error);
        new Notice("Failed to create goal.");
      }
    }
  }

  async promptCreateGoal(defaults) {
    return new Promise((resolve) => {
      const modal = new CreateGoalModal(this.app, defaults, resolve);
      modal.open();
    });
  }

  createQuickEditFields(container, goal, valueOptions = {}) {
    const rowOne = container.createDiv({ cls: "goal-quick-edit-row" });
    this.createQuickEditInputWithSuggestions(rowOne, {
      label: "Board",
      value: goal.board,
      placeholder: "Uncategorized",
      suggestions: valueOptions.boardOptions,
      onCommit: async (value) => {
        const nextBoard = normalizeBoard(value);
        await this.saveGoalField(goal.file, "board", nextBoard);
      },
    });

    this.createQuickEditInputWithSuggestions(rowOne, {
      label: "Metric",
      value: goal.metric,
      placeholder: "Metric",
      suggestions: valueOptions.metricOptions,
      onCommit: async (value) => {
        await this.saveGoalField(goal.file, "metric", String(value || "").trim());
      },
    });

    const rowTwo = container.createDiv({ cls: "goal-quick-edit-row goal-quick-edit-row-numbers" });
    this.createQuickEditInput(rowTwo, {
      label: "Start",
      value: String(goal.start),
      type: "number",
      onCommit: async (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error("invalid-number");
        }

        await this.saveGoalField(goal.file, "start", parsed);
      },
    });

    this.createQuickEditInput(rowTwo, {
      label: "Current",
      value: String(goal.current),
      type: "number",
      onCommit: async (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error("invalid-number");
        }

        await this.saveGoalField(goal.file, "current", parsed);
      },
    });

    this.createQuickEditInput(rowTwo, {
      label: "Target",
      value: String(goal.target),
      type: "number",
      onCommit: async (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error("invalid-number");
        }

        await this.saveGoalField(goal.file, "target", parsed);
      },
    });

    this.createQuickEditInput(rowTwo, {
      label: "Due",
      value: String(goal.due || ""),
      placeholder: "YYYY-MM-DD",
      onCommit: async (value) => {
        await this.saveGoalField(goal.file, "due", String(value || "").trim());
      },
    });

    const rowThree = container.createDiv({ cls: "goal-quick-edit-row" });
    this.createQuickEditSelect(rowThree, {
      label: "Status",
      value: normalizeStatus(goal.status),
      options: [
        { value: "on-track", label: "On Track" },
        { value: "at-risk", label: "At Risk" },
        { value: "off-track", label: "Off Track" },
      ],
      onCommit: async (value) => {
        await this.saveGoalField(goal.file, "status", value);
      },
    });
  }

  createQuickEditInput(container, config) {
    const field = container.createDiv({ cls: "goal-quick-edit-field" });
    field.createEl("label", {
      cls: "goal-quick-edit-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goal-quick-edit-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    const commit = async () => {
      await this.tryCommitQuickEdit(config.onCommit, input.value);
    };

    input.addEventListener("change", commit);
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      await commit();
    });
  }

  createQuickEditInputWithSuggestions(container, config) {
    const field = container.createDiv({ cls: "goal-quick-edit-field" });
    field.createEl("label", {
      cls: "goal-quick-edit-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goal-quick-edit-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    const datalistId = createDatalistId(config.label);
    attachSuggestions(field, input, datalistId, config.suggestions);

    const commit = async () => {
      await this.tryCommitQuickEdit(config.onCommit, input.value);
    };

    input.addEventListener("change", commit);
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      await commit();
    });
  }

  createQuickEditSelect(container, config) {
    const field = container.createDiv({ cls: "goal-quick-edit-field" });
    field.createEl("label", {
      cls: "goal-quick-edit-label",
      text: config.label,
    });

    const select = field.createEl("select", {
      cls: "goal-quick-edit-input",
    });

    for (const option of config.options) {
      const optionEl = select.createEl("option", {
        text: option.label,
        value: option.value,
      });
      optionEl.selected = option.value === config.value;
    }

    select.addEventListener("change", async () => {
      await this.tryCommitQuickEdit(config.onCommit, select.value);
    });
  }

  async saveGoalField(file, key, value) {
    await this.plugin.updateGoalFields(file, { [key]: value });
  }

  async tryCommitQuickEdit(commitFn, value) {
    try {
      await commitFn(value);
      await this.render();
    } catch (error) {
      if (error && error.message === "invalid-number") {
        new Notice("Please enter a valid number.");
      } else {
        console.error(error);
        new Notice("Failed to update goal property.");
      }
      await this.render();
    }
  }
}

class MilestoneDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
  }

  getViewType() {
    return VIEW_TYPE_MILESTONE_DASHBOARD;
  }

  getDisplayText() {
    return "Milestone Kanban";
  }

  getIcon() {
    return "flag";
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
    container.addClass("milestones-dashboard-view");

    const header = container.createDiv({ cls: "goals-dashboard-header" });
    header.createEl("h2", { text: "Milestone Kanban" });

    const headerActions = header.createDiv({ cls: "goals-dashboard-header-actions" });

    const goalsButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Goals",
    });
    goalsButton.addEventListener("click", async () => {
      await this.plugin.activateView();
    });

    const refreshButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Refresh",
    });
    refreshButton.addEventListener("click", () => this.render());

    const kanbanButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Kanban Todo",
    });
    kanbanButton.addEventListener("click", async () => {
      await this.plugin.activateKanbanTodoView();
    });

    const milestones = await this.plugin.getMilestones();
    if (milestones.length === 0) {
      container.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "No milestone data found in active goals.",
      });
      return;
    }

    const list = container.createDiv({ cls: "milestone-kanban-board" });
    for (const milestone of milestones) {
      const card = list.createDiv({ cls: "milestone-lane" });
      const top = card.createDiv({ cls: "milestone-lane-top" });
      top.createEl("h3", {
        cls: "milestone-lane-title",
        text: milestone.name,
      });

      const stats = top.createDiv({ cls: "milestone-lane-stats" });
      stats.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Goals ${milestone.goals.length}`,
      });
      stats.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Open ${milestone.todoOpen}`,
      });

      if (milestone.due) {
        stats.createEl("span", {
          cls: "milestone-stat-chip",
          text: `Due ${milestone.due}`,
        });
      }

      const goalsList = card.createDiv({ cls: "milestone-goal-pill-list" });
      for (const goal of milestone.goals) {
        const openButton = goalsList.createEl("button", {
          cls: "milestone-goal-pill",
          text: `${goal.title} ${goal.percent}%`,
        });

        openButton.addEventListener("click", async () => {
          await this.openGoalInRightPane(goal.file);
        });
      }

      const openTodos = milestone.todos.filter((todo) => !todo.done);
      if (openTodos.length === 0) {
        card.createEl("p", {
          cls: "milestone-todo-empty",
          text: "No open markdown todos in linked goals.",
        });
      } else {
        const todoList = card.createDiv({ cls: "milestone-todo-list" });
        for (const todo of openTodos) {
          const todoItem = todoList.createDiv({
            cls: "milestone-todo-item",
          });
          todoItem.createSpan({
            cls: "milestone-todo-text",
            text: `[ ] ${todo.text}`,
          });
          const openGoalButton = todoItem.createEl("button", {
            cls: "milestone-todo-goal-link",
            text: todo.goalTitle,
          });
          openGoalButton.addEventListener("click", async () => {
            await this.openGoalInRightPane(todo.goalFile);
          });
        }
      }
    }
  }

}

class KanbanTodoDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
  }

  getViewType() {
    return VIEW_TYPE_KANBAN_TODO_DASHBOARD;
  }

  getDisplayText() {
    return "Kanban Todo";
  }

  getIcon() {
    return "columns-3";
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
  }

  queueRefresh() {
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      this.render();
    }, 150);
  }

  async openBoardInRightPane(file) {
    const leaf = this.app.workspace.getLeaf("split");
    await leaf.openFile(file, { active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("goals-dashboard-view");
    container.addClass("kanban-todo-dashboard-view");

    const header = container.createDiv({ cls: "goals-dashboard-header" });
    header.createEl("h2", { text: "Kanban Todo" });

    const headerActions = header.createDiv({ cls: "goals-dashboard-header-actions" });
    const createButton = headerActions.createEl("button", {
      cls: "goals-dashboard-create",
    });
    createButton.ariaLabel = "Create New Todo";
    const createIcon = createButton.createSpan({ cls: "goals-dashboard-create-icon" });
    setIcon(createIcon, "plus");
    createButton.createSpan({
      cls: "goals-dashboard-create-label",
      text: "Create New Todo",
    });
    createButton.addEventListener("click", async () => {
      await this.createTodoFromDashboard();
    });

    const createListButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Add List",
    });
    createListButton.addEventListener("click", async () => {
      await this.createListFromDashboard();
    });

    const goalsButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Goals",
    });
    goalsButton.addEventListener("click", async () => {
      await this.plugin.activateView();
    });

    const milestoneButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Milestone Kanban",
    });
    milestoneButton.addEventListener("click", async () => {
      await this.plugin.activateMilestoneView();
    });

    const refreshButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Refresh",
    });
    refreshButton.addEventListener("click", () => this.render());

    const todos = await this.plugin.getKanbanBoards();

    const openCount = todos.filter((todo) => !todo.done).length;
    const doneCount = todos.length - openCount;

    const statRow = container.createDiv({ cls: "kanban-todo-inline-stats" });
    statRow.createEl("span", {
      cls: "milestone-stat-chip",
      text: `Open ${openCount}`,
    });
    statRow.createEl("span", {
      cls: "milestone-stat-chip",
      text: `Done ${doneCount}`,
    });
    statRow.createEl("span", {
      cls: "milestone-stat-chip",
      text: `Total ${todos.length}`,
    });

    const todosByList = groupBy(todos, (todo) => todo.list);
    const listsInView = normalizeKanbanListOrder(
      this.plugin.settings.kanbanListOrder,
      Array.from(todosByList.keys()),
    );

    if (todos.length === 0) {
      container.createEl("p", {
        cls: "goals-dashboard-empty",
        text: `No todo files found in ${this.plugin.settings.kanbanFolder || "configured folder"}.`,
      });
    }

    const lanes = container.createDiv({ cls: "kanban-todo-lanes" });
    for (const listName of listsInView) {
      const listTodos = [...(todosByList.get(listName) || [])];
      const openInList = listTodos.filter((todo) => !todo.done).length;
      const doneInList = listTodos.length - openInList;

      const listWrap = lanes.createDiv({ cls: "kanban-todo-list-wrap" });
      const listTop = listWrap.createDiv({ cls: "kanban-todo-list-top" });
      listTop.createEl("h3", {
        cls: "kanban-todo-list-title",
        text: listName,
      });

      const listStats = listTop.createDiv({ cls: "kanban-todo-list-stats" });
      listStats.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Open ${openInList}`,
      });
      listStats.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Done ${doneInList}`,
      });

      const list = listWrap.createDiv({ cls: "kanban-todo-checklist" });
      if (listTodos.length === 0) {
        const empty = list.createDiv({ cls: "kanban-todo-empty" });
        empty.createSpan({ text: "No todos in this list yet." });
        continue;
      }

      for (const todo of listTodos) {
        const row = list.createDiv({
          cls: `kanban-todo-row${todo.done ? " is-done" : ""}`,
        });

        const checkbox = row.createEl("button", {
          cls: `kanban-todo-checkbox${todo.done ? " is-checked" : ""}`,
        });
        checkbox.ariaLabel = todo.done ? "Mark todo as open" : "Mark todo as done";
        checkbox.setAttribute("aria-checked", todo.done ? "true" : "false");
        setIcon(checkbox, todo.done ? "check" : "");
        checkbox.addEventListener("click", async (event) => {
          event.preventDefault();
          await this.toggleTodoState(todo.file, todo.done);
        });

        const body = row.createDiv({ cls: "kanban-todo-body" });

        const openButton = body.createEl("button", {
          cls: "kanban-todo-row-link",
          text: todo.text || todo.name,
        });
        openButton.addEventListener("click", async () => {
          await this.openBoardInRightPane(todo.file);
        });

        const metadata = buildTodoMetadataLabels(todo);
        if (metadata.length > 0) {
          const metadataRow = body.createDiv({ cls: "kanban-todo-meta" });
          for (const label of metadata) {
            metadataRow.createSpan({
              cls: "kanban-todo-meta-chip",
              text: label,
            });
          }
        }
      }
    }
  }

  async toggleTodoState(file, currentDone) {
    try {
      await this.plugin.setKanbanTodoDone(file, !currentDone);
      await this.render();
    } catch (error) {
      if (error && error.message === "todo-checkbox-not-found") {
        new Notice("No checkbox todo found in this file.");
      } else {
        console.error(error);
        new Notice("Failed to update todo status.");
      }
    }
  }

  async createTodoFromDashboard() {
    const todoLists = normalizeKanbanListOrder(
      this.plugin.settings.kanbanListOrder,
      (await this.plugin.getKanbanBoards()).map((todo) => todo.list),
    );

    const payload = await this.promptCreateTodo({
      name: "",
      text: "",
      list: todoLists[0] || "Today",
      listOptions: todoLists,
      milestone: "",
      goal: "",
      priority: "medium",
      due: "",
      schedule: "",
      tags: "",
      planHours: "",
      hoursLeft: "",
    });
    if (!payload) {
      return;
    }

    try {
      const file = await this.plugin.createKanbanTodoFile(payload);
      new Notice(`Todo created: ${file.basename}`);
      await this.render();
      await this.openBoardInRightPane(file);
    } catch (error) {
      if (error && error.message === "missing-todo-name") {
        new Notice("Please provide a todo name.");
      } else if (error && error.message === "missing-todo-text") {
        new Notice("Please provide todo content.");
      } else if (error && error.message === "missing-todo-milestone") {
        new Notice("Please provide a milestone for this todo.");
      } else {
        console.error(error);
        new Notice("Failed to create todo.");
      }
    }
  }

  async createListFromDashboard() {
    const listName = await this.promptCreateList();
    if (!listName) {
      return;
    }

    try {
      const result = await this.plugin.createKanbanList(listName);
      if (result.created) {
        new Notice(`List created: ${result.name}`);
      } else {
        new Notice(`List already exists: ${result.name}`);
      }
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to create list.");
    }
  }

  async promptCreateTodo(defaults) {
    return new Promise((resolve) => {
      const modal = new CreateKanbanTodoModal(this.app, defaults, resolve);
      modal.open();
    });
  }

  async promptCreateList() {
    return new Promise((resolve) => {
      const modal = new CreateKanbanListModal(this.app, resolve);
      modal.open();
    });
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

    containerEl.createEl("h2", { text: "Planning Hub settings" });

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

    new Setting(containerEl)
      .setName("Kanban folder")
      .setDesc("Folder that contains markdown kanban boards.")
      .addText((text) =>
        text
          .setPlaceholder("Kanban")
          .setValue(this.plugin.settings.kanbanFolder)
          .onChange(async (value) => {
            this.plugin.settings.kanbanFolder = normalizeFolderPath(value, DEFAULT_SETTINGS.kanbanFolder);
            await this.plugin.saveSettings();
          }),
      );
  }
}

class CreateGoalModal extends Modal {
  constructor(app, defaults, onSubmit) {
    super(app);
    this.defaults = defaults;
    this.onSubmit = onSubmit;
    this.submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Create New Goal");
    contentEl.empty();
    contentEl.addClass("goals-create-modal");

    const form = contentEl.createEl("form", { cls: "goals-create-form" });

    const nameInput = this.createInputField(form, {
      label: "Goal Name",
      placeholder: "Read 24 papers",
      required: true,
    });

    const boardInput = this.createInputFieldWithSuggestions(form, {
      label: "Board",
      value: this.defaults.board,
      placeholder: "Uncategorized",
      suggestions: this.defaults.boardOptions,
    });

    const metricInput = this.createInputFieldWithSuggestions(form, {
      label: "Metric",
      placeholder: "Papers",
      suggestions: this.defaults.metricOptions,
    });

    const targetInput = this.createInputField(form, {
      label: "Target",
      value: "1",
      type: "number",
      required: true,
    });

    const dueInput = this.createInputField(form, {
      label: "Due",
      type: "date",
    });

    const actions = form.createDiv({ cls: "goals-create-actions" });
    const cancelButton = actions.createEl("button", {
      type: "button",
      text: "Cancel",
    });
    const createButton = actions.createEl("button", {
      cls: "mod-cta",
      type: "submit",
      text: "Create",
    });

    cancelButton.addEventListener("click", () => {
      this.close();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      this.submitted = true;
      this.onSubmit({
        name: nameInput.value,
        board: boardInput.value,
        metric: metricInput.value,
        target: targetInput.value,
        due: dueInput.value,
      });
      this.close();
    });

    window.setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 0);

    createButton.disabled = false;
  }

  onClose() {
    if (!this.submitted) {
      this.onSubmit(null);
    }

    this.contentEl.empty();
  }

  createInputField(container, config) {
    const field = container.createDiv({ cls: "goals-create-field" });
    field.createEl("label", {
      cls: "goals-create-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goals-create-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    if (config.required) {
      input.required = true;
    }

    return input;
  }

  createInputFieldWithSuggestions(container, config) {
    const field = container.createDiv({ cls: "goals-create-field" });
    field.createEl("label", {
      cls: "goals-create-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goals-create-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    if (config.required) {
      input.required = true;
    }

    const datalistId = createDatalistId(config.label);
    attachSuggestions(field, input, datalistId, config.suggestions);

    return input;
  }
}

class CreateKanbanTodoModal extends Modal {
  constructor(app, defaults, onSubmit) {
    super(app);
    this.defaults = defaults;
    this.onSubmit = onSubmit;
    this.submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Create New Todo");
    contentEl.empty();
    contentEl.addClass("goals-create-modal");

    const form = contentEl.createEl("form", { cls: "goals-create-form" });

    const nameInput = this.createInputField(form, {
      label: "Todo Name",
      placeholder: "Inbox",
      value: this.defaults.name,
      required: true,
    });

    const todoInput = this.createTextareaField(form, {
      label: "Todo",
      placeholder: "Follow up plugin issue #12",
      value: this.defaults.text,
      required: true,
    });

    const listInput = this.createInputFieldWithSuggestions(form, {
      label: "List",
      placeholder: "Today",
      value: this.defaults.list,
      suggestions: this.defaults.listOptions,
      required: true,
    });

    const milestoneInput = this.createInputField(form, {
      label: "Milestone",
      placeholder: "Q1 Shipping",
      value: this.defaults.milestone,
      required: true,
    });

    const goalInput = this.createInputField(form, {
      label: "Goal",
      placeholder: "Optional linked goal",
      value: this.defaults.goal,
    });

    const priorityInput = this.createInputFieldWithSuggestions(form, {
      label: "Priority",
      placeholder: "medium",
      value: this.defaults.priority,
      suggestions: ["high", "medium", "low"],
    });

    const dueInput = this.createInputField(form, {
      label: "Due Date",
      type: "date",
      value: this.defaults.due,
    });

    const scheduleInput = this.createInputField(form, {
      label: "Schedule",
      placeholder: "Mon-Fri 09:00-11:00",
      value: this.defaults.schedule,
    });

    const tagsInput = this.createInputField(form, {
      label: "Tags",
      placeholder: "research, writing",
      value: this.defaults.tags,
    });

    const planHoursInput = this.createInputField(form, {
      label: "Plan Hours",
      type: "number",
      value: this.defaults.planHours,
      placeholder: "8",
    });
    planHoursInput.step = "0.5";
    planHoursInput.min = "0";

    const hoursLeftInput = this.createInputField(form, {
      label: "Hours Left",
      type: "number",
      value: this.defaults.hoursLeft,
      placeholder: "6",
    });
    hoursLeftInput.step = "0.5";
    hoursLeftInput.min = "0";

    const actions = form.createDiv({ cls: "goals-create-actions" });
    const cancelButton = actions.createEl("button", {
      type: "button",
      text: "Cancel",
    });
    actions.createEl("button", {
      cls: "mod-cta",
      type: "submit",
      text: "Create",
    });

    cancelButton.addEventListener("click", () => {
      this.close();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      this.submitted = true;
      this.onSubmit({
        name: nameInput.value,
        text: todoInput.value,
        list: listInput.value,
        milestone: milestoneInput.value,
        goal: goalInput.value,
        priority: priorityInput.value,
        due: dueInput.value,
        schedule: scheduleInput.value,
        tags: tagsInput.value,
        planHours: planHoursInput.value,
        hoursLeft: hoursLeftInput.value,
      });
      this.close();
    });

    window.setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 0);
  }

  onClose() {
    if (!this.submitted) {
      this.onSubmit(null);
    }

    this.contentEl.empty();
  }

  createInputField(container, config) {
    const field = container.createDiv({ cls: "goals-create-field" });
    field.createEl("label", {
      cls: "goals-create-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goals-create-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    if (config.required) {
      input.required = true;
    }

    return input;
  }

  createTextareaField(container, config) {
    const field = container.createDiv({ cls: "goals-create-field" });
    field.createEl("label", {
      cls: "goals-create-label",
      text: config.label,
    });

    const textarea = field.createEl("textarea", {
      cls: "goals-create-input",
      text: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    if (config.required) {
      textarea.required = true;
    }

    textarea.rows = 3;
    return textarea;
  }

  createInputFieldWithSuggestions(container, config) {
    const field = container.createDiv({ cls: "goals-create-field" });
    field.createEl("label", {
      cls: "goals-create-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goals-create-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    if (config.required) {
      input.required = true;
    }

    const datalistId = createDatalistId(config.label);
    attachSuggestions(field, input, datalistId, config.suggestions);

    return input;
  }
}

class CreateKanbanListModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Add Kanban List");
    contentEl.empty();
    contentEl.addClass("goals-create-modal");

    const form = contentEl.createEl("form", { cls: "goals-create-form" });
    const listInput = this.createInputField(form, {
      label: "List Name",
      placeholder: "Next",
      required: true,
    });

    const actions = form.createDiv({ cls: "goals-create-actions" });
    const cancelButton = actions.createEl("button", {
      type: "button",
      text: "Cancel",
    });
    actions.createEl("button", {
      cls: "mod-cta",
      type: "submit",
      text: "Add list",
    });

    cancelButton.addEventListener("click", () => {
      this.close();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitted = true;
      this.onSubmit(listInput.value);
      this.close();
    });

    window.setTimeout(() => {
      listInput.focus();
      listInput.select();
    }, 0);
  }

  onClose() {
    if (!this.submitted) {
      this.onSubmit(null);
    }

    this.contentEl.empty();
  }

  createInputField(container, config) {
    const field = container.createDiv({ cls: "goals-create-field" });
    field.createEl("label", {
      cls: "goals-create-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "goals-create-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    if (config.required) {
      input.required = true;
    }

    return input;
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

let datalistCounter = 0;

function createDatalistId(label) {
  datalistCounter += 1;
  const normalized = String(label ?? "field")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return `goals-datalist-${normalized || "field"}-${datalistCounter}`;
}

function attachSuggestions(fieldEl, inputEl, datalistId, suggestions) {
  const normalizedSuggestions = Array.isArray(suggestions)
    ? suggestions
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
    : [];

  if (normalizedSuggestions.length === 0) {
    return;
  }

  inputEl.setAttribute("list", datalistId);
  const datalist = fieldEl.createEl("datalist");
  datalist.id = datalistId;

  for (const suggestion of normalizedSuggestions) {
    datalist.createEl("option", { value: suggestion });
  }
}

function getUniqueGoalValues(goals, key) {
  const values = [];
  for (const goal of goals) {
    const rawValue = String(goal?.[key] ?? "").trim();
    if (!rawValue) {
      continue;
    }

    if (!values.includes(rawValue)) {
      values.push(rawValue);
    }
  }

  return values.sort((left, right) => left.localeCompare(right));
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBoard(value) {
  const board = String(value ?? "").trim();
  return board || "Uncategorized";
}

function normalizeKanbanListName(value) {
  const list = String(value ?? "").trim();
  return list || "Today";
}

function normalizeKanbanListOrder(persistedOrder, listsInView) {
  const unique = [];

  for (const list of Array.isArray(persistedOrder) ? persistedOrder : []) {
    const normalized = normalizeKanbanListName(list);
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }

  for (const list of Array.isArray(listsInView) ? listsInView : []) {
    const normalized = normalizeKanbanListName(list);
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }

  if (unique.length === 0) {
    unique.push("Today");
  }

  return unique;
}

function normalizePriority(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function normalizeDateString(value) {
  return String(value ?? "").trim();
}

function parseHoursValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

function normalizeTagList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const normalized = [];
  for (const entry of values) {
    const cleaned = String(entry ?? "")
      .trim()
      .replace(/^#/, "")
      .replace(/\s+/g, "-");
    if (!cleaned || normalized.includes(cleaned)) {
      continue;
    }
    normalized.push(cleaned);
  }

  return normalized;
}

function parseKanbanTodoMetadata(frontmatter) {
  const fm = frontmatter || {};
  const planHours = parseHoursValue(fm.planHours ?? fm.plannedHours);
  const hoursLeft = parseHoursValue(fm.hoursLeft);

  return {
    list: normalizeKanbanListName(fm.list),
    milestone: normalizeMilestone(fm.milestone),
    goal: String(fm.goal ?? "").trim(),
    priority: normalizePriority(fm.priority),
    due: normalizeDateString(fm.due),
    tags: normalizeTagList(fm.tags),
    schedule: String(fm.schedule ?? fm.schdule ?? "").trim(),
    planHours,
    hoursLeft,
  };
}

function formatHoursValue(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function buildTodoMetadataLabels(todo) {
  const labels = [];
  labels.push(`Milestone: ${todo.milestone || "Unscheduled Milestone"}`);

  if (todo.goal) {
    labels.push(`Goal: ${todo.goal}`);
  }

  labels.push(`Priority: ${capitalizeLabel(todo.priority || "medium")}`);

  if (todo.due) {
    labels.push(`Due: ${todo.due}`);
  }

  if (todo.schedule) {
    labels.push(`Schedule: ${todo.schedule}`);
  }

  if (Number.isFinite(todo.hoursLeft) && Number.isFinite(todo.planHours)) {
    labels.push(`Hours Left: ${formatHoursValue(todo.hoursLeft)}/${formatHoursValue(todo.planHours)}h`);
  } else if (Number.isFinite(todo.hoursLeft)) {
    labels.push(`Hours Left: ${formatHoursValue(todo.hoursLeft)}h`);
  } else if (Number.isFinite(todo.planHours)) {
    labels.push(`Plan Hours: ${formatHoursValue(todo.planHours)}h`);
  }

  if (Array.isArray(todo.tags) && todo.tags.length > 0) {
    labels.push(`Tags: ${todo.tags.map((tag) => `#${tag}`).join(" ")}`);
  }

  return labels;
}

function capitalizeLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeMilestone(value) {
  const milestone = String(value ?? "").trim();
  return milestone || "Unscheduled Milestone";
}

function normalizeGoalsFolder(value) {
  return normalizeFolderPath(value, "Goals");
}

function normalizeFolderPath(value, fallback = "") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized || fallback;
}

async function ensureFolderExists(vault, folderPath) {
  if (!folderPath) {
    return;
  }

  const parts = folderPath.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      await vault.createFolder(current);
    }
  }
}

function sanitizeFileName(name) {
  return String(name)
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

function getUniquePath(vault, folder, baseName) {
  const normalizedFolder = normalizeGoalsFolder(folder);
  let suffix = 0;

  while (true) {
    const fileName = suffix === 0 ? `${baseName}.md` : `${baseName}-${suffix}.md`;
    const candidate = `${normalizedFolder}/${fileName}`;
    if (!vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function buildGoalTemplate(values) {
  const lines = [
    "---",
    "type: goal",
    `board: ${toYamlString(normalizeBoard(values.board))}`,
    `metric: ${toYamlString(values.metric)}`,
    "start: 0",
    "current: 0",
    `target: ${Number(values.target) || 1}`,
    'unit: ""',
    `due: ${toYamlString(values.due)}`,
    "status: on-track",
    'owner: ""',
    'milestone: "Main Milestone"',
    'milestoneDue: ""',
    "milestonePercent: 0",
    "boardArchived: false",
    "---",
    "",
    "## Comments",
    "",
  ];

  return lines.join("\n");
}

function buildKanbanTodoTemplate(payload) {
  const line = String(payload.text ?? "").replace(/\r?\n+/g, " ").trim();
  const milestone = String(payload.milestone ?? "").trim();
  const goal = String(payload.goal ?? "").trim();
  const priority = normalizePriority(payload.priority);
  const due = normalizeDateString(payload.due);
  const schedule = String(payload.schedule ?? "").trim();
  const tags = normalizeTagList(payload.tags);
  const planHours = parseHoursValue(payload.planHours);
  const hoursLeft = parseHoursValue(payload.hoursLeft);

  return [
    "---",
    `list: ${toYamlString(normalizeKanbanListName(payload.list))}`,
    `milestone: ${toYamlString(milestone)}`,
    `goal: ${toYamlString(goal)}`,
    `priority: ${toYamlString(priority)}`,
    `due: ${toYamlString(due)}`,
    `schedule: ${toYamlString(schedule)}`,
    `tags: ${toYamlArray(tags)}`,
    `planHours: ${Number.isFinite(planHours) ? planHours : 0}`,
    `hoursLeft: ${Number.isFinite(hoursLeft) ? hoursLeft : Number.isFinite(planHours) ? planHours : 0}`,
    "---",
    "",
    `- [ ] ${line}`,
    "",
  ].join("\n");
}

function toYamlString(value) {
  const escaped = String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function toYamlArray(values) {
  const entries = Array.isArray(values) ? values : [];
  return `[${entries.map((entry) => toYamlString(entry)).join(", ")}]`;
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

function extractTodoItems(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const todos = [];

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    todos.push({
      done: String(match[1]).toLowerCase() === "x",
      text: String(match[2] ?? "").trim(),
    });
  }

  return todos;
}

function parseSingleTodoFile(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  for (const line of lines) {
    const todoMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!todoMatch) {
      continue;
    }

    return {
      done: String(todoMatch[1]).toLowerCase() === "x",
      text: String(todoMatch[2] ?? "").trim(),
    };
  }

  return null;
}

function compareDue(leftDue, rightDue) {
  const left = String(leftDue ?? "").trim();
  const right = String(rightDue ?? "").trim();

  if (left && right) {
    return left.localeCompare(right);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

module.exports = GoalsDashboardPlugin;
