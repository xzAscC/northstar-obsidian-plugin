const { ItemView, Notice } = require("obsidian");

const { VIEW_TYPE_HOME_DASHBOARD } = require("../constants");

class HomeDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
    this.minuteTimer = null;
  }

  getViewType() {
    return VIEW_TYPE_HOME_DASHBOARD;
  }

  getDisplayText() {
    return "Northstar Homepage";
  }

  getIcon() {
    return "house";
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

    this.minuteTimer = window.setInterval(async () => {
      const result = await this.plugin.ensureHomeDailyListState();
      if (result.changed) {
        this.queueRefresh();
      }
    }, 60 * 1000);
    this.registerInterval(this.minuteTimer);

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

  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("goals-dashboard-view");
    container.addClass("northstar-homepage-view");

    const header = container.createDiv({ cls: "goals-dashboard-header" });
    header.createEl("h2", { text: "Northstar Homepage" });

    const headerActions = header.createDiv({ cls: "goals-dashboard-header-actions" });
    const refreshButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Refresh",
    });
    refreshButton.addEventListener("click", () => this.render());

    const goalsButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Goals",
    });
    goalsButton.addEventListener("click", async () => {
      await this.plugin.activateView();
    });

    const grid = container.createDiv({ cls: "northstar-homepage-grid" });

    const calendarCard = grid.createDiv({ cls: "northstar-homepage-card" });
    this.initializeCalendarState();
    this.renderLocalCalendar(calendarCard);

    const listCard = grid.createDiv({ cls: "northstar-homepage-card" });
    const listTop = listCard.createDiv({ cls: "northstar-homepage-card-top" });
    listTop.createEl("h3", { text: "Daily List" });
    listTop.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: "Refresh at 05:00",
    });

    const addRow = listCard.createDiv({ cls: "northstar-daily-list-add" });
    const addInput = addRow.createEl("input", {
      cls: "goals-create-input",
      type: "text",
      placeholder: "Add an item",
    });
    const addButton = addRow.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Add",
    });
    addButton.addEventListener("click", async () => {
      await this.tryAddDailyItem(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    addInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      await this.tryAddDailyItem(addInput.value);
      addInput.value = "";
    });

    const state = await this.plugin.getHomeDailyListState();
    if (!Array.isArray(state.items) || state.items.length === 0) {
      listCard.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "No items. Add one above or configure template in settings.",
      });
    } else {
      const list = listCard.createDiv({ cls: "northstar-daily-list" });
      state.items.forEach((item, index) => {
        const row = list.createDiv({ cls: `northstar-daily-item${item.done ? " is-done" : ""}` });

        const checkbox = row.createEl("input", {
          type: "checkbox",
        });
        checkbox.checked = Boolean(item.done);
        checkbox.addEventListener("change", async () => {
          await this.plugin.setHomeDailyItemDone(index, checkbox.checked);
          this.queueRefresh();
        });

        row.createSpan({
          cls: "northstar-daily-item-text",
          text: item.text,
        });

        const removeButton = row.createEl("button", {
          cls: "northstar-daily-remove",
          text: "Remove",
        });
        removeButton.addEventListener("click", async () => {
          await this.plugin.removeHomeDailyItem(index);
          this.queueRefresh();
        });
      });
    }

    const metricsCard = grid.createDiv({ cls: "northstar-homepage-card northstar-homepage-metrics-card" });
    const metricsTop = metricsCard.createDiv({ cls: "northstar-homepage-card-top" });
    metricsTop.createEl("h3", { text: "Daily Metrics" });

    const metricsSnapshot = await this.plugin.getHomeDailyMetrics();
    metricsTop.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: `Past ${metricsSnapshot.lookbackDays} days`,
    });

    const metrics = Array.isArray(metricsSnapshot.metrics) ? metricsSnapshot.metrics : [];
    const hasAnySamples = metrics.some((metric) => Array.isArray(metric.samples) && metric.samples.length > 0);
    if (!hasAnySamples) {
      metricsCard.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "No metric data found. Fill these properties in daily notes: learningHours, exerciseDone, sleepHours, masturbation.",
      });
      return;
    }

    const formatMetricValue = (value) => {
      if (!Number.isFinite(value)) {
        return "-";
      }
      return Number.isInteger(value) ? String(value) : String(Number(value).toFixed(2));
    };

    const metricList = metricsCard.createDiv({ cls: "northstar-metric-list" });
    metrics.forEach((metric) => {
      const item = metricList.createDiv({ cls: "northstar-metric-item" });
      const meta = item.createDiv({ cls: "northstar-metric-meta" });

      meta.createEl("strong", {
        cls: "northstar-metric-name",
        text: metric.label,
      });
      meta.createSpan({
        cls: "northstar-metric-stats",
        text: `latest ${formatMetricValue(metric.latest)} | avg ${formatMetricValue(metric.average)}`,
      });

      if (!Array.isArray(metric.samples) || metric.samples.length === 0) {
        item.createEl("p", {
          cls: "goals-dashboard-empty",
          text: "No entries yet.",
        });
        return;
      }

      const sparkline = item.createDiv({ cls: "northstar-metric-sparkline" });
      const values = metric.samples.map((sample) => sample.value);
      const maxValue = metric.kind === "binary" ? 1 : Math.max(...values, 1);
      metric.samples.forEach((sample) => {
        const bar = sparkline.createSpan({ cls: "northstar-metric-bar" });
        const ratio = maxValue <= 0 ? 0 : sample.value / maxValue;
        const height = Math.max(0.08, Math.min(1, ratio));
        bar.style.height = `${Math.round(height * 100)}%`;
        bar.title = `${sample.date}: ${sample.value}`;
      });
    });
  }

  initializeCalendarState() {
    if (this.calendarState) {
      return;
    }

    const today = this.toStartOfDay(new Date());
    this.calendarState = {
      mode: "month",
      cursor: today,
      selected: today,
    };
  }

  renderLocalCalendar(calendarCard) {
    const top = calendarCard.createDiv({ cls: "northstar-homepage-card-top" });
    top.createEl("h3", { text: "Local Calendar" });

    const controls = top.createDiv({ cls: "northstar-calendar-toolbar" });
    const modeSwitch = controls.createDiv({ cls: "northstar-calendar-mode-switch" });

    const monthModeButton = modeSwitch.createEl("button", {
      cls: `northstar-calendar-mode-btn${this.calendarState.mode === "month" ? " is-active" : ""}`,
      text: "Month",
    });
    monthModeButton.type = "button";
    monthModeButton.addEventListener("click", () => {
      if (this.calendarState.mode === "month") {
        return;
      }
      this.calendarState.mode = "month";
      this.queueRefresh();
    });

    const weekModeButton = modeSwitch.createEl("button", {
      cls: `northstar-calendar-mode-btn${this.calendarState.mode === "week" ? " is-active" : ""}`,
      text: "Week",
    });
    weekModeButton.type = "button";
    weekModeButton.addEventListener("click", () => {
      if (this.calendarState.mode === "week") {
        return;
      }
      this.calendarState.mode = "week";
      this.queueRefresh();
    });

    const navigation = calendarCard.createDiv({ cls: "northstar-calendar-nav" });

    const previousButton = navigation.createEl("button", {
      cls: "northstar-calendar-nav-btn",
      text: "<",
    });
    previousButton.type = "button";
    previousButton.addEventListener("click", () => {
      this.shiftCalendar(-1);
      this.queueRefresh();
    });

    const title = navigation.createEl("strong", { cls: "northstar-calendar-title" });
    title.setText(this.getCalendarTitle());

    const nextButton = navigation.createEl("button", {
      cls: "northstar-calendar-nav-btn",
      text: ">",
    });
    nextButton.type = "button";
    nextButton.addEventListener("click", () => {
      this.shiftCalendar(1);
      this.queueRefresh();
    });

    const weekdays = calendarCard.createDiv({ cls: "northstar-calendar-weekdays" });
    ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((label) => {
      weekdays.createSpan({ text: label });
    });

    const grid = calendarCard.createDiv({ cls: "northstar-calendar-grid" });
    this.getCalendarCells().forEach((day) => {
      const classes = [
        "northstar-calendar-cell",
        day.inCurrentScope ? "is-current-scope" : "is-outside-scope",
        day.exists ? "is-existing" : "is-missing",
      ];
      if (day.isToday) {
        classes.push("is-today");
      }
      if (day.isSelected) {
        classes.push("is-selected");
      }

      const dayButton = grid.createEl("button", {
        cls: classes.join(" "),
      });
      dayButton.type = "button";
      dayButton.title = `${day.dateKey}\n${day.path}`;

      dayButton.createSpan({
        cls: "northstar-calendar-day-number",
        text: String(day.date.getDate()),
      });

      dayButton.createSpan({
        cls: "northstar-calendar-day-state",
        text: day.exists ? "Open" : "Create",
      });

      dayButton.addEventListener("click", async () => {
        this.calendarState.selected = day.date;
        this.calendarState.cursor = day.date;
        await this.tryOpenCalendarDay(day.dateKey);
        this.queueRefresh();
      });
    });

    const hint = calendarCard.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: "Click a date to open or create the daily note from template.",
    });
    hint.title = "Missing notes are auto-created from the configured template.";
  }

  getCalendarTitle() {
    if (this.calendarState.mode === "week") {
      const weekStart = this.getWeekStart(this.calendarState.cursor);
      const weekEnd = this.addDays(weekStart, 6);
      const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
      const sameMonth = sameYear && weekStart.getMonth() === weekEnd.getMonth();
      const startLabel = weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const endLabel = weekEnd.toLocaleDateString(undefined, {
        month: sameMonth ? undefined : "short",
        day: "numeric",
        year: sameYear ? undefined : "numeric",
      });
      const yearLabel = weekEnd.getFullYear();
      return `${startLabel} - ${endLabel}, ${yearLabel}`;
    }

    return this.calendarState.cursor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }

  getCalendarCells() {
    if (this.calendarState.mode === "week") {
      const weekStart = this.getWeekStart(this.calendarState.cursor);
      const cells = [];
      for (let index = 0; index < 7; index += 1) {
        cells.push(this.buildCalendarCell(this.addDays(weekStart, index), true));
      }
      return cells;
    }

    const monthStart = this.toStartOfDay(
      new Date(this.calendarState.cursor.getFullYear(), this.calendarState.cursor.getMonth(), 1),
    );
    const monthStartWeekday = (monthStart.getDay() + 6) % 7;
    const gridStart = this.addDays(monthStart, -monthStartWeekday);
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = this.addDays(gridStart, index);
      cells.push(this.buildCalendarCell(date, date.getMonth() === monthStart.getMonth()));
    }
    return cells;
  }

  buildCalendarCell(date, inCurrentScope) {
    const path = this.plugin.getDailyNotePathByDate(date);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const exists = Boolean(existing && !Array.isArray(existing.children) && existing.extension === "md");

    return {
      date,
      dateKey: this.toDateKey(date),
      path,
      exists,
      inCurrentScope,
      isToday: this.isSameDate(date, new Date()),
      isSelected: this.isSameDate(date, this.calendarState.selected),
    };
  }

  shiftCalendar(step) {
    const direction = step >= 0 ? 1 : -1;
    const source = this.calendarState.cursor;
    if (this.calendarState.mode === "week") {
      this.calendarState.cursor = this.addDays(source, direction * 7);
      return;
    }

    const moved = new Date(source.getFullYear(), source.getMonth() + direction, 1);
    this.calendarState.cursor = this.toStartOfDay(moved);
  }

  getWeekStart(date) {
    const normalized = this.toStartOfDay(date);
    const weekdayIndex = (normalized.getDay() + 6) % 7;
    return this.addDays(normalized, -weekdayIndex);
  }

  addDays(date, offsetDays) {
    return this.toStartOfDay(new Date(date.getTime() + offsetDays * 24 * 60 * 60 * 1000));
  }

  toStartOfDay(date) {
    const normalized = new Date(date.getTime());
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  toDateKey(date) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  isSameDate(left, right) {
    if (!left || !right) {
      return false;
    }
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  async tryOpenCalendarDay(dateKey) {
    try {
      const result = await this.plugin.openOrCreateDailyNoteByDateKey(dateKey);
      new Notice(result.created ? "Daily note created from template." : "Daily note opened.");
    } catch (error) {
      const code = String(error?.message ?? "");
      if (code === "invalid-calendar-date") {
        new Notice("Invalid date.");
        return;
      }

      if (code === "daily-template-not-found") {
        new Notice("Daily template not found. Check plugin settings.");
        return;
      }

      if (code === "daily-path-conflict") {
        new Notice("Daily path exists but is not a markdown note.");
        return;
      }

      console.error(error);
      new Notice("Failed to open daily note.");
    }
  }

  async tryAddDailyItem(value) {
    try {
      await this.plugin.addHomeDailyItem(value);
      this.queueRefresh();
    } catch (error) {
      if (error && error.message === "empty-home-item") {
        new Notice("Please enter a list item.");
      } else {
        console.error(error);
        new Notice("Failed to add daily item.");
      }
    }
  }
}

module.exports = { HomeDashboardView };
