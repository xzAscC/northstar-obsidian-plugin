const { Modal } = require("obsidian");

const {
  attachSuggestions,
  createDatalistId,
  formatDateLocalValue,
  formatDateTimeLocalValue,
  roundUpToHalfHour,
} = require("../utils");

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
      label: "Title",
      placeholder: "Inbox",
      value: this.defaults.name,
      required: true,
    });

    const todoInput = this.createTextareaField(form, {
      label: "Todo",
      placeholder: "Follow up plugin issue #12",
      value: this.defaults.text,
    });

    const listInput = this.createInputFieldWithSuggestions(form, {
      label: "List",
      placeholder: "Today",
      value: this.defaults.list,
      suggestions: this.defaults.listOptions,
    });

    const milestoneInput = this.createInputFieldWithSuggestions(form, {
      label: "Milestone",
      placeholder: "Q1 Shipping",
      value: this.defaults.milestone,
      suggestions: this.defaults.milestoneOptions,
    });

    const goalInput = this.createInputFieldWithSuggestions(form, {
      label: "Goal",
      placeholder: "Optional linked goal",
      value: this.defaults.goal,
      suggestions: this.defaults.goalOptions,
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

    const tagsInput = this.createInputFieldWithSuggestions(form, {
      label: "Tags",
      placeholder: "research, writing",
      value: this.defaults.tags,
      suggestions: this.defaults.tagOptions,
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
  constructor(app, onSubmit, options = {}) {
    super(app);
    this.onSubmit = onSubmit;
    this.options = options;
    this.submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    const title = String(this.options.title ?? "Add Kanban List").trim() || "Add Kanban List";
    const label = String(this.options.label ?? "List Name").trim() || "List Name";
    const placeholder = String(this.options.placeholder ?? "Next").trim();
    const submitText = String(this.options.submitText ?? "Add list").trim() || "Submit";
    const defaultValue = String(this.options.value ?? "");

    this.titleEl.setText(title);
    contentEl.empty();
    contentEl.addClass("goals-create-modal");

    const form = contentEl.createEl("form", { cls: "goals-create-form" });
    if (this.options.description) {
      form.createEl("p", {
        cls: "goals-create-description",
        text: String(this.options.description),
      });
    }

    const hasSuggestions =
      Array.isArray(this.options.suggestions) && this.options.suggestions.length > 0;

    const listInput = hasSuggestions
      ? this.createInputFieldWithSuggestions(form, {
        label,
        placeholder,
        required: true,
        value: defaultValue,
        suggestions: this.options.suggestions,
      })
      : this.createInputField(form, {
        label,
        placeholder,
        required: true,
        value: defaultValue,
      });

    const actions = form.createDiv({ cls: "goals-create-actions" });
    const cancelButton = actions.createEl("button", {
      type: "button",
      text: "Cancel",
    });
    actions.createEl("button", {
      cls: "mod-cta",
      type: "submit",
      text: submitText,
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

class CreateIcloudEventModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Create iCloud Event");
    contentEl.empty();
    contentEl.addClass("goals-create-modal");

    const form = contentEl.createEl("form", { cls: "goals-create-form" });
    const titleInput = this.createInputField(form, {
      label: "Title",
      placeholder: "Focus session",
      required: true,
    });

    const allDayField = form.createDiv({ cls: "goals-create-field" });
    allDayField.createEl("label", {
      cls: "goals-create-label",
      text: "All day",
    });
    const allDayInput = allDayField.createEl("input", {
      type: "checkbox",
    });

    const now = new Date();
    const roundedStart = roundUpToHalfHour(now);
    const defaultEnd = new Date(roundedStart.getTime() + 60 * 60 * 1000);

    const startInput = this.createInputField(form, {
      label: "Start",
      type: "datetime-local",
      value: formatDateTimeLocalValue(roundedStart),
      required: true,
    });

    const endInput = this.createInputField(form, {
      label: "End",
      type: "datetime-local",
      value: formatDateTimeLocalValue(defaultEnd),
      required: true,
    });

    const notesInput = this.createTextareaField(form, {
      label: "Notes",
      placeholder: "Optional",
      value: "",
    });

    allDayInput.addEventListener("change", () => {
      const checked = allDayInput.checked;
      startInput.type = checked ? "date" : "datetime-local";
      endInput.type = checked ? "date" : "datetime-local";

      if (checked) {
        startInput.value = formatDateLocalValue(roundedStart);
        endInput.value = formatDateLocalValue(roundedStart);
      } else {
        startInput.value = formatDateTimeLocalValue(roundedStart);
        endInput.value = formatDateTimeLocalValue(defaultEnd);
      }
    });

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
        title: titleInput.value,
        start: startInput.value,
        end: endInput.value,
        allDay: allDayInput.checked,
        description: notesInput.value,
      });
      this.close();
    });

    window.setTimeout(() => {
      titleInput.focus();
      titleInput.select();
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
}

module.exports = {
  CreateGoalModal,
  CreateKanbanTodoModal,
  CreateKanbanListModal,
  CreateIcloudEventModal,
};
