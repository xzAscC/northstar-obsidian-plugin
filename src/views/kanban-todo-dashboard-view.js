const { ItemView, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_KANBAN_TODO_DASHBOARD } = require("../constants");
const { buildTodoMetadataLabels, groupBy, normalizeKanbanListOrder } = require("../utils");
const { CreateKanbanListModal, CreateKanbanTodoModal } = require("../modals");

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
      const visibleTodos = listTodos.filter((todo) => !todo.done);
      const openInList = visibleTodos.length;
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
      if (visibleTodos.length === 0) {
        const empty = list.createDiv({ cls: "kanban-todo-empty" });
        empty.createSpan({ text: "No open todos in this list." });
        continue;
      }

      for (const todo of visibleTodos) {
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

module.exports = { KanbanTodoDashboardView };
