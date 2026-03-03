const { ItemView, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_KANBAN_TODO_DASHBOARD } = require("../constants");
const {
  attachSuggestions,
  createDatalistId,
  formatHoursValue,
  groupBy,
  normalizeKanbanListOrder,
  normalizePriority,
} = require("../utils");
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

    const [todos, goals] = await Promise.all([this.plugin.getKanbanBoards(), this.plugin.getGoals()]);
    const todosByList = groupBy(todos, (todo) => todo.list);
    const { goalOptions, milestoneOptions, tagOptions } = this.collectTodoValueOptions(todos, goals);
    const listsInView = normalizeKanbanListOrder(
      this.plugin.settings.kanbanListOrder,
      Array.from(todosByList.keys()),
    );
    const archivedLists = listsInView.filter((listName) => this.plugin.isKanbanListArchived(listName));
    const activeLists = listsInView.filter((listName) => !this.plugin.isKanbanListArchived(listName));

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
    if (archivedLists.length > 0) {
      statRow.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Archived Lists ${archivedLists.length}`,
      });
    }

    if (todos.length === 0) {
      container.createEl("p", {
        cls: "goals-dashboard-empty",
        text: `No todo files found in ${this.plugin.settings.kanbanFolder || "configured folder"}.`,
      });
    }

    const lanes = container.createDiv({ cls: "kanban-todo-lanes" });
    for (const listName of activeLists) {
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

      const listTopRight = listTop.createDiv({ cls: "kanban-todo-list-top-right" });
      const listStats = listTopRight.createDiv({ cls: "kanban-todo-list-stats" });
      listStats.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Open ${openInList}`,
      });
      listStats.createEl("span", {
        cls: "milestone-stat-chip",
        text: `Done ${doneInList}`,
      });

      const listActions = listTopRight.createDiv({ cls: "kanban-todo-list-actions" });
      const renameButton = listActions.createEl("button", {
        cls: "kanban-todo-list-action",
      });
      renameButton.ariaLabel = `Rename list ${listName}`;
      setIcon(renameButton, "pencil");
      renameButton.addEventListener("click", async () => {
        await this.renameListFromDashboard(listName, listsInView);
      });

      const archiveButton = listActions.createEl("button", {
        cls: "kanban-todo-list-action",
      });
      archiveButton.ariaLabel = `Archive list ${listName}`;
      setIcon(archiveButton, "archive");
      archiveButton.addEventListener("click", async () => {
        await this.archiveListFromDashboard(listName, listTodos);
      });

      const removeButton = listActions.createEl("button", {
        cls: "kanban-todo-list-action is-danger",
      });
      removeButton.ariaLabel = `Remove list ${listName}`;
      setIcon(removeButton, "trash-2");
      removeButton.addEventListener("click", async () => {
        await this.removeListFromDashboard(listName, listTodos, listsInView);
      });

      const list = listWrap.createDiv({ cls: "kanban-todo-checklist" });
      if (visibleTodos.length === 0) {
        const empty = list.createDiv({ cls: "kanban-todo-empty" });
        empty.createSpan({ text: "No open todos in this list." });
        continue;
      }

      let draggingTodoPath = "";
      let activeDropRow = null;
      let activeDropPosition = "before";

      const clearDropIndicators = () => {
        if (!activeDropRow) {
          return;
        }

        activeDropRow.removeClass("is-drop-before");
        activeDropRow.removeClass("is-drop-after");
        activeDropRow = null;
      };

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

        const dragHandle = row.createEl("button", {
          cls: "kanban-todo-row-drag",
        });
        dragHandle.ariaLabel = `Drag to reorder ${todo.name}`;
        dragHandle.draggable = true;
        setIcon(dragHandle, "grip-vertical");

        dragHandle.addEventListener("dragstart", (event) => {
          draggingTodoPath = todo.file.path;
          row.addClass("is-dragging");
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", todo.file.path);
          }
        });

        dragHandle.addEventListener("dragend", () => {
          draggingTodoPath = "";
          row.removeClass("is-dragging");
          clearDropIndicators();
        });

        row.addEventListener("dragover", (event) => {
          if (!draggingTodoPath || draggingTodoPath === todo.file.path) {
            return;
          }

          event.preventDefault();
          const rect = row.getBoundingClientRect();
          const isBefore = event.clientY < rect.top + rect.height / 2;
          activeDropPosition = isBefore ? "before" : "after";

          if (activeDropRow && activeDropRow !== row) {
            clearDropIndicators();
          }

          activeDropRow = row;
          row.classList.toggle("is-drop-before", isBefore);
          row.classList.toggle("is-drop-after", !isBefore);
        });

        row.addEventListener("dragleave", (event) => {
          if (activeDropRow !== row) {
            return;
          }

          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && row.contains(nextTarget)) {
            return;
          }

          clearDropIndicators();
        });

        row.addEventListener("drop", async (event) => {
          if (!draggingTodoPath || draggingTodoPath === todo.file.path) {
            return;
          }

          event.preventDefault();
          const fromIndex = visibleTodos.findIndex((item) => item.file.path === draggingTodoPath);
          const targetIndex = visibleTodos.findIndex((item) => item.file.path === todo.file.path);
          if (fromIndex < 0 || targetIndex < 0) {
            clearDropIndicators();
            return;
          }

          let toIndex = targetIndex;
          if (activeDropPosition === "after") {
            toIndex += 1;
          }
          if (fromIndex < toIndex) {
            toIndex -= 1;
          }

          const clampedIndex = Math.max(0, Math.min(toIndex, visibleTodos.length - 1));
          clearDropIndicators();
          await this.moveTodoWithinList(listName, visibleTodos, fromIndex, clampedIndex);
        });

        const body = row.createDiv({ cls: "kanban-todo-body" });

        const openButton = body.createEl("button", {
          cls: "kanban-todo-row-link",
          text: todo.name,
        });
        openButton.addEventListener("click", async () => {
          await this.openBoardInRightPane(todo.file);
        });

        this.createTodoQuickEditFields(body, todo, {
          listOptions: activeLists,
          goalOptions,
          milestoneOptions,
          tagOptions,
        });
      }
    }

    if (activeLists.length === 0) {
      const empty = container.createDiv({ cls: "kanban-todo-empty" });
      empty.createSpan({ text: "No active lists. Unarchive a list or add a new one." });
    }

    if (archivedLists.length > 0) {
      const archivedSection = container.createDiv({ cls: "kanban-archived-section" });
      const archivedHeader = archivedSection.createDiv({ cls: "kanban-archived-header" });
      archivedHeader.createEl("h3", {
        cls: "kanban-archived-title",
        text: "Archived Lists",
      });

      const archivedList = archivedSection.createDiv({ cls: "kanban-archived-list" });
      for (const listName of archivedLists) {
        const listTodos = [...(todosByList.get(listName) || [])];
        const openInList = listTodos.filter((todo) => !todo.done).length;
        const doneInList = listTodos.length - openInList;

        const row = archivedList.createDiv({ cls: "kanban-archived-row" });
        row.createEl("div", {
          cls: "kanban-archived-row-name",
          text: listName,
        });
        row.createEl("div", {
          cls: "kanban-archived-row-stats",
          text: `Open ${openInList} / Done ${doneInList}`,
        });

        const actions = row.createDiv({ cls: "kanban-archived-row-actions" });
        const unarchiveButton = actions.createEl("button", {
          cls: "goals-dashboard-refresh",
          text: "Unarchive",
        });
        unarchiveButton.addEventListener("click", async () => {
          await this.unarchiveListFromDashboard(listName);
        });

        const removeButton = actions.createEl("button", {
          cls: "goals-dashboard-refresh",
          text: "Remove",
        });
        removeButton.addEventListener("click", async () => {
          await this.removeListFromDashboard(listName, listTodos, listsInView);
        });
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

  async moveTodoWithinList(listName, visibleTodos, fromIndex, toIndex) {
    const todos = Array.isArray(visibleTodos) ? [...visibleTodos] : [];
    if (fromIndex < 0 || fromIndex >= todos.length || toIndex < 0 || toIndex >= todos.length) {
      return;
    }

    const [moved] = todos.splice(fromIndex, 1);
    todos.splice(toIndex, 0, moved);
    const orderedPaths = todos.map((todo) => todo.file.path);

    try {
      await this.plugin.reorderKanbanTodosInList(listName, orderedPaths);
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to reorder todos.");
    }
  }

  createTodoQuickEditFields(container, todo, valueOptions = {}) {
    const quickEdit = container.createDiv({ cls: "kanban-todo-quick-edit" });

    const rowOne = quickEdit.createDiv({ cls: "kanban-todo-quick-edit-row" });
    this.createTodoQuickEditInput(rowOne, {
      label: "Todo",
      value: String(todo.text || ""),
      placeholder: "Todo text",
      onCommit: async (value) => {
        await this.saveTodoText(todo.file, value);
      },
    });

    const rowTwo = quickEdit.createDiv({ cls: "kanban-todo-quick-edit-row" });
    this.createTodoQuickEditInputWithSuggestions(rowTwo, {
      label: "List",
      value: String(todo.list || "Today"),
      placeholder: "Today",
      suggestions: valueOptions.listOptions,
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "list", String(value || "").trim());
      },
    });

    this.createTodoQuickEditSelect(rowTwo, {
      label: "Priority",
      value: normalizePriority(todo.priority),
      options: [
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "priority", value);
      },
    });

    const rowThree = quickEdit.createDiv({ cls: "kanban-todo-quick-edit-row" });
    this.createTodoQuickEditInputWithSuggestions(rowThree, {
      label: "Milestone",
      value: String(todo.milestone || ""),
      placeholder: "2026W9",
      suggestions: valueOptions.milestoneOptions,
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "milestone", String(value || "").trim());
      },
    });

    this.createTodoQuickEditInputWithSuggestions(rowThree, {
      label: "Goal",
      value: String(todo.goal || ""),
      placeholder: "Linked goal",
      suggestions: valueOptions.goalOptions,
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "goal", String(value || "").trim());
      },
    });

    this.createTodoQuickEditInputWithSuggestions(rowThree, {
      label: "Tags",
      value: Array.isArray(todo.tags) ? todo.tags.join(", ") : String(todo.tags || ""),
      placeholder: "research, writing",
      suggestions: valueOptions.tagOptions,
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "tags", String(value || "").trim());
      },
    });

    const rowFour = quickEdit.createDiv({ cls: "kanban-todo-quick-edit-row" });
    this.createTodoQuickEditInput(rowFour, {
      label: "Due",
      type: "date",
      value: String(todo.due || ""),
      placeholder: "",
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "due", String(value || "").trim());
      },
    });

    this.createTodoQuickEditInput(rowFour, {
      label: "Plan Hours",
      type: "number",
      step: "0.5",
      min: "0",
      value: Number.isFinite(todo.planHours) ? formatHoursValue(todo.planHours) : "",
      placeholder: "0",
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "planHours", String(value || "").trim());
      },
    });

    this.createTodoQuickEditInput(rowFour, {
      label: "Hours Left",
      type: "number",
      step: "0.5",
      min: "0",
      value: Number.isFinite(todo.hoursLeft) ? formatHoursValue(todo.hoursLeft) : "",
      placeholder: "0",
      onCommit: async (value) => {
        await this.saveTodoField(todo.file, "hoursLeft", String(value || "").trim());
      },
    });
  }

  collectTodoValueOptions(todos, goals) {
    const uniqueSorted = (values) =>
      Array.from(
        new Set(
          (Array.isArray(values) ? values : [])
            .map((value) => String(value ?? "").trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right));

    const goalOptions = uniqueSorted([
      ...(Array.isArray(goals) ? goals.map((goal) => goal.title) : []),
      ...(Array.isArray(todos) ? todos.map((todo) => todo.goal) : []),
    ]);

    const milestoneOptions = uniqueSorted([
      ...(Array.isArray(goals) ? goals.map((goal) => goal.milestone) : []),
      ...(Array.isArray(this.plugin.settings.milestoneOrder)
        ? this.plugin.settings.milestoneOrder
        : []),
      ...(Array.isArray(todos) ? todos.map((todo) => todo.milestone) : []),
    ]);

    const tagOptions = uniqueSorted(
      Array.isArray(todos) ? todos.flatMap((todo) => (Array.isArray(todo.tags) ? todo.tags : [])) : [],
    );

    return {
      goalOptions,
      milestoneOptions,
      tagOptions,
    };
  }

  createTodoQuickEditInput(container, config) {
    const field = container.createDiv({ cls: "kanban-todo-quick-edit-field" });
    field.createEl("label", {
      cls: "kanban-todo-quick-edit-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "kanban-todo-quick-edit-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });
    if (config.step != null) {
      input.step = String(config.step);
    }
    if (config.min != null) {
      input.min = String(config.min);
    }
    if (config.max != null) {
      input.max = String(config.max);
    }

    const commit = async () => {
      await this.tryCommitTodoQuickEdit(config.onCommit, input.value);
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

  createTodoQuickEditInputWithSuggestions(container, config) {
    const field = container.createDiv({ cls: "kanban-todo-quick-edit-field" });
    field.createEl("label", {
      cls: "kanban-todo-quick-edit-label",
      text: config.label,
    });

    const input = field.createEl("input", {
      cls: "kanban-todo-quick-edit-input",
      type: config.type || "text",
      value: String(config.value ?? ""),
      placeholder: config.placeholder || "",
    });

    const datalistId = createDatalistId(config.label);
    attachSuggestions(field, input, datalistId, config.suggestions);

    const commit = async () => {
      await this.tryCommitTodoQuickEdit(config.onCommit, input.value);
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

  createTodoQuickEditSelect(container, config) {
    const field = container.createDiv({ cls: "kanban-todo-quick-edit-field" });
    field.createEl("label", {
      cls: "kanban-todo-quick-edit-label",
      text: config.label,
    });

    const select = field.createEl("select", {
      cls: "kanban-todo-quick-edit-input",
    });

    for (const option of config.options) {
      const optionEl = select.createEl("option", {
        text: option.label,
        value: option.value,
      });
      optionEl.selected = option.value === config.value;
    }

    select.addEventListener("change", async () => {
      await this.tryCommitTodoQuickEdit(config.onCommit, select.value);
    });
  }

  async saveTodoField(file, key, value) {
    await this.plugin.updateKanbanTodoFields(file, { [key]: value });
  }

  async saveTodoText(file, value) {
    await this.plugin.updateKanbanTodoText(file, value);
  }

  async tryCommitTodoQuickEdit(commitFn, value) {
    try {
      await commitFn(value);
      await this.render();
    } catch (error) {
      if (error && error.message === "missing-todo-text") {
        new Notice("Please provide todo content.");
      } else if (error && error.message === "todo-checkbox-not-found") {
        new Notice("No checkbox todo found in this file.");
      } else {
        console.error(error);
        new Notice("Failed to update todo property.");
      }
      await this.render();
    }
  }

  async createTodoFromDashboard() {
    const [todos, goals] = await Promise.all([this.plugin.getKanbanBoards(), this.plugin.getGoals()]);
    const allTodoLists = normalizeKanbanListOrder(
      this.plugin.settings.kanbanListOrder,
      todos.map((todo) => todo.list),
    );
    const todoLists = allTodoLists.filter((listName) => !this.plugin.isKanbanListArchived(listName));
    const valueOptions = this.collectTodoValueOptions(todos, goals);

    const payload = await this.promptCreateTodo({
      name: "",
      text: "",
      list: todoLists[0] || "Today",
      listOptions: todoLists,
      milestone: "",
      milestoneOptions: valueOptions.milestoneOptions,
      goal: "",
      goalOptions: valueOptions.goalOptions,
      priority: "medium",
      due: "",
      tags: "",
      tagOptions: valueOptions.tagOptions,
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
      if (result.unarchived) {
        new Notice(`List restored: ${result.name}`);
      } else if (result.created) {
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

  async renameListFromDashboard(currentName, listsInView) {
    const nextName = await this.promptKanbanListName({
      title: "Rename Kanban List",
      label: "New List Name",
      submitText: "Rename",
      value: currentName,
      placeholder: "Next",
      suggestions: listsInView.filter((name) => name !== currentName),
    });

    if (!nextName) {
      return;
    }

    try {
      const result = await this.plugin.renameKanbanList(currentName, nextName);
      if (result.renamed) {
        const movedText = result.movedCount > 0 ? ` (${result.movedCount} todo moved)` : "";
        new Notice(`List renamed: ${result.from} -> ${result.to}${movedText}`);
      } else {
        new Notice(`List already named: ${result.to}`);
      }
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to rename list.");
    }
  }

  async archiveListFromDashboard(listName, listTodos) {
    const todoCount = listTodos.length;
    const message =
      todoCount > 0
        ? `Archive list "${listName}" with ${todoCount} ${todoCount === 1 ? "todo" : "todos"}?`
        : `Archive empty list "${listName}"?`;

    if (!window.confirm(message)) {
      return;
    }

    try {
      const result = await this.plugin.archiveKanbanList(listName);
      if (result.archived) {
        new Notice(`List archived: ${result.name}`);
      } else {
        new Notice(`List already archived: ${result.name}`);
      }
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to archive list.");
    }
  }

  async unarchiveListFromDashboard(listName) {
    try {
      const result = await this.plugin.unarchiveKanbanList(listName);
      if (result.unarchived) {
        new Notice(`List restored: ${result.name}`);
      } else {
        new Notice(`List is already active: ${result.name}`);
      }
      await this.render();
    } catch (error) {
      console.error(error);
      new Notice("Failed to restore list.");
    }
  }

  async removeListFromDashboard(listName, listTodos, listsInView) {
    const todoCount = listTodos.length;
    const destinationOptions = listsInView.filter((name) => name !== listName);
    let targetList = "";

    if (todoCount > 0) {
      if (destinationOptions.length === 0) {
        new Notice("Cannot remove the only list while it still has todos.");
        return;
      }

      const todoLabel = todoCount === 1 ? "todo" : "todos";

      targetList = await this.promptKanbanListName({
        title: "Remove Kanban List",
        label: "Move todos to",
        submitText: "Remove list",
        value: destinationOptions[0],
        placeholder: "Today",
        suggestions: destinationOptions,
        description: `${todoCount} ${todoLabel} will be moved before removing "${listName}".`,
      });

      if (!targetList) {
        return;
      }
    }

    const message =
      todoCount > 0
        ? `Remove list "${listName}" and move ${todoCount} ${todoCount === 1 ? "todo" : "todos"} to "${targetList}"?`
        : `Remove empty list "${listName}"?`;

    if (!window.confirm(message)) {
      return;
    }

    try {
      const result = await this.plugin.removeKanbanList(listName, targetList);
      if (result.movedCount > 0) {
        new Notice(
          `List removed: ${result.removed}. Moved ${result.movedCount} ${
            result.movedCount === 1 ? "todo" : "todos"
          } to ${result.target}.`,
        );
      } else {
        new Notice(`List removed: ${result.removed}`);
      }
      await this.render();
    } catch (error) {
      if (error && error.message === "remove-list-target-matches-source") {
        new Notice("Please choose another destination list.");
      } else {
        console.error(error);
        new Notice("Failed to remove list.");
      }
    }
  }

  async promptCreateTodo(defaults) {
    return new Promise((resolve) => {
      const modal = new CreateKanbanTodoModal(this.app, defaults, resolve);
      modal.open();
    });
  }

  async promptCreateList() {
    return this.promptKanbanListName({
      title: "Add Kanban List",
      label: "List Name",
      submitText: "Add list",
      placeholder: "Next",
    });
  }

  async promptKanbanListName(options) {
    return new Promise((resolve) => {
      const modal = new CreateKanbanListModal(this.app, resolve, options);
      modal.open();
    });
  }
}

module.exports = { KanbanTodoDashboardView };
