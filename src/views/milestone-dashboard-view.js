const { ItemView, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_MILESTONE_DASHBOARD } = require("../constants");

class MilestoneDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
    this.draggingMilestone = null;
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

  getOrderedMilestones(milestones) {
    const preferredOrder = Array.isArray(this.plugin.settings.milestoneOrder)
      ? this.plugin.settings.milestoneOrder.map((name) => String(name ?? "").trim()).filter(Boolean)
      : [];
    const milestoneMap = new Map(milestones.map((milestone) => [milestone.name, milestone]));
    const ordered = [];

    for (const name of preferredOrder) {
      const milestone = milestoneMap.get(name);
      if (!milestone) {
        continue;
      }

      ordered.push(milestone);
      milestoneMap.delete(name);
    }

    for (const milestone of milestones) {
      if (!milestoneMap.has(milestone.name)) {
        continue;
      }

      ordered.push(milestone);
      milestoneMap.delete(milestone.name);
    }

    return ordered;
  }

  getLaneSizeClass(milestone, openTodoCount) {
    const titleWeight = Math.ceil(String(milestone.name ?? "").length / 18);
    const score = milestone.goals.length * 2 + openTodoCount + titleWeight;
    if (openTodoCount >= 6 || score >= 12) {
      return "is-size-large";
    }

    if (openTodoCount <= 1 && milestone.goals.length <= 1 && score <= 4) {
      return "is-size-compact";
    }

    return "is-size-regular";
  }

  enableMilestoneDragAndDrop(laneEl, milestoneName, visibleOrder) {
    laneEl.setAttribute("draggable", "true");
    laneEl.dataset.milestone = milestoneName;

    laneEl.addEventListener("dragstart", (event) => {
      this.draggingMilestone = milestoneName;
      laneEl.addClass("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", milestoneName);
      }
    });

    laneEl.addEventListener("dragend", () => {
      this.draggingMilestone = null;
      this.clearDragClasses();
    });

    laneEl.addEventListener("dragover", (event) => {
      const sourceMilestone = this.draggingMilestone;
      if (!sourceMilestone || sourceMilestone === milestoneName) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      laneEl.addClass("is-drop-target");
    });

    laneEl.addEventListener("dragleave", () => {
      laneEl.removeClass("is-drop-target");
    });

    laneEl.addEventListener("drop", async (event) => {
      event.preventDefault();
      laneEl.removeClass("is-drop-target");

      const sourceMilestone = this.draggingMilestone || event.dataTransfer?.getData("text/plain");
      if (!sourceMilestone || sourceMilestone === milestoneName) {
        return;
      }

      const targetIndex = visibleOrder.indexOf(milestoneName);
      await this.moveMilestoneToIndex(sourceMilestone, targetIndex, visibleOrder);
    });
  }

  async moveMilestoneToIndex(sourceMilestone, targetIndex, visibleOrder) {
    const normalizedOrder = visibleOrder.map((name) => String(name ?? "").trim()).filter(Boolean);
    const sourceIndex = normalizedOrder.indexOf(sourceMilestone);

    if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= normalizedOrder.length) {
      return;
    }

    if (sourceIndex === targetIndex) {
      return;
    }

    const [moved] = normalizedOrder.splice(sourceIndex, 1);
    normalizedOrder.splice(targetIndex, 0, moved);
    this.plugin.settings.milestoneOrder = normalizedOrder;
    await this.plugin.saveSettings();
    await this.render();
  }

  clearDragClasses() {
    const lanes = this.containerEl.querySelectorAll(".milestone-lane");
    for (const lane of lanes) {
      lane.removeClass("is-dragging");
      lane.removeClass("is-drop-target");
    }
  }

  async toggleMilestoneTodo(todo) {
    try {
      await this.plugin.setCheckboxTodoDone(todo.todoFile, todo.todoIndex, !todo.done);
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

  async saveMilestoneTodoText(todo, nextText) {
    try {
      await this.plugin.updateCheckboxTodoText(todo.todoFile, todo.todoIndex, nextText);
      await this.render();
    } catch (error) {
      if (error && error.message === "missing-todo-text") {
        new Notice("Please provide todo content.");
      } else if (error && error.message === "todo-checkbox-not-found") {
        new Notice("No checkbox todo found in this file.");
      } else {
        console.error(error);
        new Notice("Failed to update todo text.");
      }

      await this.render();
    }
  }

  async archiveMilestoneFromDashboard(milestone) {
    const openCount = Number(milestone.todoOpen ?? 0);
    const doneCount = Number(milestone.todoDone ?? 0);
    const goalCount = Array.isArray(milestone.goals) ? milestone.goals.length : 0;
    const message =
      `Archive milestone "${milestone.name}"?\n` +
      `Goals: ${goalCount} | Open todos: ${openCount} | Done todos: ${doneCount}`;

    if (!window.confirm(message)) {
      return;
    }

    try {
      const result = await this.plugin.archiveMilestone(milestone.name);
      if (result.archived) {
        new Notice(`Milestone archived: ${result.name}`);
      } else {
        new Notice(`Milestone already archived: ${result.name}`);
      }
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to archive milestone.");
    }
  }

  async unarchiveMilestoneFromDashboard(milestoneName) {
    try {
      const result = await this.plugin.unarchiveMilestone(milestoneName);
      if (result.unarchived) {
        new Notice(`Milestone restored: ${result.name}`);
      } else {
        new Notice(`Milestone is already active: ${result.name}`);
      }
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to restore milestone.");
    }
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
        text: "No milestone data found in active goals or kanban todos.",
      });
      return;
    }

    const orderedMilestones = this.getOrderedMilestones(milestones);
    const activeMilestones = orderedMilestones.filter(
      (milestone) => !this.plugin.isMilestoneArchived(milestone.name),
    );
    const archivedMilestones = orderedMilestones.filter((milestone) =>
      this.plugin.isMilestoneArchived(milestone.name),
    );
    const visibleOrder = orderedMilestones.map((milestone) => milestone.name);

    if (archivedMilestones.length > 0) {
      const statRow = container.createDiv({ cls: "kanban-todo-inline-stats" });
      statRow.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Archived Milestones ${archivedMilestones.length}`,
      });
    }

    let list = null;
    if (activeMilestones.length > 0) {
      list = container.createDiv({ cls: "milestone-kanban-board" });
    }

    for (const milestone of activeMilestones) {
      const openTodos = milestone.todos.filter((todo) => !todo.done);
      const laneSizeClass = this.getLaneSizeClass(milestone, openTodos.length);
      const card = list.createDiv({ cls: `milestone-lane ${laneSizeClass}` });

      this.enableMilestoneDragAndDrop(card, milestone.name, visibleOrder);

      const top = card.createDiv({ cls: "milestone-lane-top" });
      const titleRow = top.createDiv({ cls: "milestone-lane-title-row" });
      titleRow.createEl("h3", {
        cls: "milestone-lane-title",
        text: milestone.name,
      });

      const titleActions = titleRow.createDiv({ cls: "milestone-lane-title-actions" });
      const dragHint = titleActions.createDiv({
        cls: "milestone-lane-drag-hint",
        text: "Drag",
      });
      dragHint.ariaLabel = `Drag to reorder milestone ${milestone.name}`;
      dragHint.title = "Drag milestone to reorder";

      const archiveButton = titleActions.createEl("button", {
        cls: "milestone-lane-action",
      });
      archiveButton.ariaLabel = `Archive milestone ${milestone.name}`;
      archiveButton.title = "Archive milestone";
      setIcon(archiveButton, "archive");
      archiveButton.addEventListener("click", async () => {
        await this.archiveMilestoneFromDashboard(milestone);
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

      if (openTodos.length === 0) {
        card.createEl("p", {
          cls: "milestone-todo-empty",
          text: "No open todos in this milestone.",
        });
        continue;
      }

      const todoList = card.createDiv({ cls: "milestone-todo-list" });
      for (const todo of openTodos) {
        const todoItem = todoList.createDiv({
          cls: "milestone-todo-item",
        });
        const todoMain = todoItem.createDiv({ cls: "milestone-todo-main" });

        const checkbox = todoMain.createEl("button", {
          cls: "milestone-todo-checkbox",
        });
        checkbox.ariaLabel = "Mark todo as done";
        checkbox.setAttribute("aria-checked", "false");
        checkbox.addEventListener("click", async (event) => {
          event.preventDefault();
          await this.toggleMilestoneTodo(todo);
        });

        const todoInput = todoMain.createEl("input", {
          cls: "milestone-todo-input",
          type: "text",
          value: String(todo.text || ""),
        });
        const commitTodoText = async () => {
          const nextText = String(todoInput.value ?? "");
          if (nextText.trim() === String(todo.text || "").trim()) {
            return;
          }

          await this.saveMilestoneTodoText(todo, nextText);
        };
        todoInput.addEventListener("change", commitTodoText);
        todoInput.addEventListener("keydown", async (event) => {
          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();
          await commitTodoText();
        });

        const openGoalButton = todoItem.createEl("button", {
          cls: "milestone-todo-goal-link",
          text: todo.source === "kanban" ? `Kanban: ${todo.goalTitle}` : todo.goalTitle,
        });
        openGoalButton.addEventListener("click", async () => {
          await this.openGoalInRightPane(todo.goalFile);
        });
      }
    }

    if (activeMilestones.length === 0) {
      container.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "No active milestones. Unarchive one below to show it on the board.",
      });
    }

    if (archivedMilestones.length > 0) {
      const archivedSection = container.createDiv({ cls: "milestone-archived-section" });
      archivedSection.createEl("h3", {
        cls: "milestone-archived-title",
        text: "Archived Milestones",
      });

      const archivedList = archivedSection.createDiv({ cls: "milestone-archived-list" });
      for (const milestone of archivedMilestones) {
        const row = archivedList.createDiv({ cls: "milestone-archived-row" });
        row.createEl("div", {
          cls: "milestone-archived-row-name",
          text: milestone.name,
        });
        row.createEl("div", {
          cls: "milestone-archived-row-stats",
          text: `Goals ${milestone.goals.length} / Open ${milestone.todoOpen} / Done ${milestone.todoDone}`,
        });

        const actions = row.createDiv({ cls: "milestone-archived-row-actions" });
        const unarchiveButton = actions.createEl("button", {
          cls: "goals-dashboard-refresh",
          text: "Unarchive",
        });
        unarchiveButton.addEventListener("click", async () => {
          await this.unarchiveMilestoneFromDashboard(milestone.name);
        });
      }
    }
  }
}

module.exports = { MilestoneDashboardView };
