const { ItemView } = require("obsidian");

const { VIEW_TYPE_MILESTONE_DASHBOARD } = require("../constants");

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
        text: "No milestone data found in active goals or kanban todos.",
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
          text: "No open todos in this milestone.",
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
            text: todo.source === "kanban" ? `Kanban: ${todo.goalTitle}` : todo.goalTitle,
          });
          openGoalButton.addEventListener("click", async () => {
            await this.openGoalInRightPane(todo.goalFile);
          });
        }
      }
    }
  }

}

module.exports = { MilestoneDashboardView };
