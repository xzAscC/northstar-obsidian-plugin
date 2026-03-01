const { ItemView, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_GOALS_DASHBOARD } = require("../constants");
const {
  attachSuggestions,
  createBoardSummary,
  createDatalistId,
  getOrderedBoardEntries,
  getUniqueGoalValues,
  groupBy,
  isGoalArchived,
  normalizeBoard,
  normalizeBoardOrder,
  normalizeStatus,
  shouldHideBoard,
} = require("../utils");
const { CreateGoalModal } = require("../modals");

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
    return "Northstar Forge";
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
    header.createEl("h2", { text: "Northstar Forge" });

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

module.exports = { GoalsDashboardView };
