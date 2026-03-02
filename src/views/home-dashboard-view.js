const { ItemView, Notice } = require("obsidian");

const { VIEW_TYPE_HOME_DASHBOARD } = require("../constants");

class HomeDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
    this.minuteTimer = null;
    this.secondTimer = null;
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

    this.initializeClockState();
    this.secondTimer = window.setInterval(() => {
      this.tickClockState();
      this.updateClockDisplay();
    }, 1000);
    this.registerInterval(this.secondTimer);

    await this.render();
  }

  async onClose() {
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.secondTimer) {
      window.clearInterval(this.secondTimer);
      this.secondTimer = null;
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

    const milestoneButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Milestone",
    });
    milestoneButton.addEventListener("click", async () => {
      await this.plugin.activateMilestoneView();
    });

    const kanbanTodoButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "Kanban Todo",
    });
    kanbanTodoButton.addEventListener("click", async () => {
      await this.plugin.activateKanbanTodoView();
    });

    const grid = container.createDiv({ cls: "northstar-homepage-grid" });
    this.calendarTaskSummary = this.plugin.getHomeCalendarTaskSummaryByDate();

    const calendarCard = grid.createDiv({ cls: "northstar-homepage-card" });
    this.initializeCalendarState();
    this.renderLocalCalendar(calendarCard);

    const clockCard = grid.createDiv({ cls: "northstar-homepage-card northstar-homepage-clock-card" });
    this.renderClockCard(clockCard);

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
    const visibleItems = Array.isArray(state.items)
      ? state.items
        .map((item, index) => ({ ...item, index }))
        .filter((item) => !item.archived)
      : [];
    if (visibleItems.length === 0) {
      listCard.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "No items. Add one above or configure template in settings.",
      });
    } else {
      const list = listCard.createDiv({ cls: "northstar-daily-list" });
      visibleItems.forEach((item) => {
        const row = list.createDiv({ cls: `northstar-daily-item${item.done ? " is-done" : ""}` });

        const checkbox = row.createEl("input", {
          type: "checkbox",
        });
        checkbox.checked = Boolean(item.done);
        checkbox.addEventListener("change", async () => {
          await this.plugin.setHomeDailyItemDone(item.index, checkbox.checked);
          this.queueRefresh();
        });

        row.createSpan({
          cls: "northstar-daily-item-text",
          text: item.text,
        });

        const archiveButton = row.createEl("button", {
          cls: "northstar-daily-archive",
          text: "Archive",
        });
        archiveButton.addEventListener("click", async () => {
          await this.plugin.archiveHomeDailyItem(item.index);
          this.queueRefresh();
        });

        const removeButton = row.createEl("button", {
          cls: "northstar-daily-remove",
          text: "Remove",
        });
        removeButton.addEventListener("click", async () => {
          await this.plugin.removeHomeDailyItem(item.index);
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
    } else {
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

    const calendarTasksCard = container.createDiv({
      cls: "northstar-homepage-card northstar-homepage-calendar-tasks-card",
    });
    await this.renderCalendarTasksCard(calendarTasksCard);
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

      const taskSummary = this.calendarTaskSummary?.[day.dateKey];
      if (taskSummary && taskSummary.total > 0) {
        dayButton.createSpan({
          cls: "northstar-calendar-day-task-count",
          text: `${taskSummary.done}/${taskSummary.total}`,
        });
      }

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

  async renderCalendarTasksCard(card) {
    const date = this.calendarState?.selected ? this.toStartOfDay(this.calendarState.selected) : this.toStartOfDay(new Date());
    const dateKey = this.toDateKey(date);
    const isToday = this.isSameDate(date, new Date());
    const tasks = await this.plugin.getHomeCalendarTasksByDate(dateKey);
    const doneCount = tasks.filter((task) => task.done).length;

    const top = card.createDiv({ cls: "northstar-homepage-card-top" });
    top.createEl("h3", {
      text: isToday ? "今日任务" : `${dateKey} 任务`,
    });
    top.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: tasks.length > 0 ? `完成 ${doneCount}/${tasks.length}` : "还没有任务",
    });

    const addRow = card.createDiv({ cls: "northstar-daily-list-add" });
    const addInput = addRow.createEl("input", {
      cls: "goals-create-input",
      type: "text",
      placeholder: isToday ? "添加今天要做的事" : `给 ${dateKey} 添加任务`,
    });
    const addButton = addRow.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "添加任务",
    });

    const rangeRow = card.createDiv({ cls: "northstar-calendar-task-range" });
    const startInput = rangeRow.createEl("input", {
      cls: "goals-create-input",
      type: "date",
      value: dateKey,
    });
    const endInput = rangeRow.createEl("input", {
      cls: "goals-create-input",
      type: "date",
      value: dateKey,
    });
    const rangeButton = rangeRow.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "添加到区间",
    });

    card.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: "将同一任务批量添加到多个日期（含起止日）。",
    });

    const handleCreate = async () => {
      await this.tryAddCalendarTask(dateKey, addInput.value);
      addInput.value = "";
      addInput.focus();
    };

    addButton.addEventListener("click", handleCreate);
    addInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      await handleCreate();
    });

    rangeButton.addEventListener("click", async () => {
      const addedDays = await this.tryAddCalendarTaskRange(startInput.value, endInput.value, addInput.value);
      if (addedDays > 0) {
        addInput.value = "";
        addInput.focus();
      }
    });

    if (tasks.length === 0) {
      card.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "这一天还没有任务，先添加一个吧。",
      });
      return;
    }

    const list = card.createDiv({ cls: "northstar-calendar-task-list" });
    tasks.forEach((task, index) => {
      const row = list.createDiv({ cls: `northstar-calendar-task-row${task.done ? " is-done" : ""}` });

      const checkbox = row.createEl("input", {
        type: "checkbox",
      });
      checkbox.checked = Boolean(task.done);
      checkbox.addEventListener("change", async () => {
        await this.plugin.setHomeCalendarTaskDone(dateKey, index, checkbox.checked);
        this.queueRefresh();
      });

      row.createSpan({
        cls: "northstar-calendar-task-text",
        text: task.text,
      });

      const removeButton = row.createEl("button", {
        cls: "northstar-daily-remove",
        text: "移除",
      });
      removeButton.addEventListener("click", async () => {
        await this.plugin.removeHomeCalendarTask(dateKey, index);
        this.queueRefresh();
      });
    });
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
      const result = await this.plugin.openOrCreateDailyNoteByDateKey(dateKey, {
        openInRightSplit: true,
      });
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

  async tryAddCalendarTask(dateKey, value) {
    try {
      await this.plugin.addHomeCalendarTask(dateKey, value);
      this.queueRefresh();
    } catch (error) {
      const code = String(error?.message ?? "");
      if (code === "empty-calendar-task") {
        new Notice("请输入任务内容。");
        return;
      }

      if (code === "invalid-calendar-date") {
        new Notice("日期无效，无法保存任务。");
        return;
      }

      console.error(error);
      new Notice("添加任务失败。");
    }
  }

  async tryAddCalendarTaskRange(startDateKey, endDateKey, value) {
    try {
      const addedDays = await this.plugin.addHomeCalendarTaskRange(startDateKey, endDateKey, value);
      this.queueRefresh();

      if (addedDays > 1) {
        new Notice(`已添加到 ${addedDays} 天。`);
      }

      return addedDays;
    } catch (error) {
      const code = String(error?.message ?? "");
      if (code === "empty-calendar-task") {
        new Notice("请输入任务内容。");
        return 0;
      }

      if (code === "invalid-calendar-date") {
        new Notice("日期无效，无法保存任务。");
        return 0;
      }

      if (code === "invalid-calendar-range") {
        new Notice("起始日期不能晚于结束日期。");
        return 0;
      }

      console.error(error);
      new Notice("添加任务失败。");
      return 0;
    }
  }

  initializeClockState() {
    if (this.clockState) {
      return;
    }

    const focusMs = 25 * 60 * 1000;
    this.clockState = {
      now: Date.now(),
      pomodoro: {
        mode: "focus",
        durations: {
          focus: focusMs,
          break: 5 * 60 * 1000,
        },
        running: false,
        endAt: 0,
        remainingMs: focusMs,
        sessions: 0,
      },
      countdown: {
        running: false,
        endAt: 0,
        remainingMs: 10 * 60 * 1000,
        presetMs: 10 * 60 * 1000,
      },
    };
  }

  renderClockCard(card) {
    this.initializeClockState();

    const top = card.createDiv({ cls: "northstar-homepage-card-top" });
    top.createEl("h3", { text: "时钟" });
    top.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: "番茄钟 / 倒计时 / 本地时间",
    });

    const localBlock = card.createDiv({ cls: "northstar-clock-local" });
    const localTime = localBlock.createEl("strong", { cls: "northstar-clock-local-time" });
    const localDate = localBlock.createEl("span", { cls: "northstar-clock-local-date" });

    const pomodoroBlock = card.createDiv({ cls: "northstar-clock-block" });
    const pomodoroHeader = pomodoroBlock.createDiv({ cls: "northstar-clock-block-top" });
    pomodoroHeader.createEl("strong", { text: "番茄钟" });
    const pomodoroMode = pomodoroHeader.createEl("span", { cls: "northstar-clock-mode" });
    const pomodoroTimer = pomodoroBlock.createEl("div", { cls: "northstar-clock-timer" });
    const pomodoroSessions = pomodoroBlock.createEl("span", { cls: "northstar-clock-meta" });
    const pomodoroProgress = pomodoroBlock.createDiv({ cls: "northstar-clock-progress" });
    const pomodoroProgressBar = pomodoroProgress.createDiv({ cls: "northstar-clock-progress-bar" });

    const pomodoroActions = pomodoroBlock.createDiv({ cls: "northstar-clock-actions" });
    const pomodoroStartPause = pomodoroActions.createEl("button", {
      cls: "goals-dashboard-refresh",
    });
    const pomodoroReset = pomodoroActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "重置",
    });
    const pomodoroSwitch = pomodoroActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "切换",
    });

    pomodoroStartPause.addEventListener("click", () => {
      this.togglePomodoro();
      this.updateClockDisplay();
    });
    pomodoroReset.addEventListener("click", () => {
      this.resetPomodoro();
      this.updateClockDisplay();
    });
    pomodoroSwitch.addEventListener("click", () => {
      this.switchPomodoroMode();
      this.updateClockDisplay();
    });

    const countdownBlock = card.createDiv({ cls: "northstar-clock-block" });
    const countdownTop = countdownBlock.createDiv({ cls: "northstar-clock-block-top" });
    countdownTop.createEl("strong", { text: "倒计时" });
    const countdownHint = countdownTop.createEl("span", { cls: "northstar-clock-meta" });

    const countdownPresetRow = countdownBlock.createDiv({ cls: "northstar-clock-countdown-config" });
    const minuteInput = countdownPresetRow.createEl("input", {
      cls: "goals-create-input",
      type: "number",
      min: "0",
      max: "999",
      step: "1",
    });
    minuteInput.value = String(Math.floor(this.clockState.countdown.presetMs / 60000));

    const secondInput = countdownPresetRow.createEl("input", {
      cls: "goals-create-input",
      type: "number",
      min: "0",
      max: "59",
      step: "1",
    });
    secondInput.value = String(Math.floor((this.clockState.countdown.presetMs % 60000) / 1000));

    const applyPreset = () => {
      const minutes = Math.max(0, Math.min(999, Number(minuteInput.value) || 0));
      const seconds = Math.max(0, Math.min(59, Number(secondInput.value) || 0));
      const presetMs = (minutes * 60 + seconds) * 1000;
      if (presetMs <= 0) {
        return;
      }

      const countdown = this.clockState.countdown;
      countdown.presetMs = presetMs;
      if (!countdown.running) {
        countdown.remainingMs = presetMs;
      }

      minuteInput.value = String(minutes);
      secondInput.value = String(seconds);
      this.updateClockDisplay();
    };

    minuteInput.addEventListener("change", applyPreset);
    secondInput.addEventListener("change", applyPreset);

    const countdownTimer = countdownBlock.createEl("div", { cls: "northstar-clock-timer" });
    const countdownProgress = countdownBlock.createDiv({ cls: "northstar-clock-progress" });
    const countdownProgressBar = countdownProgress.createDiv({ cls: "northstar-clock-progress-bar" });

    const countdownActions = countdownBlock.createDiv({ cls: "northstar-clock-actions" });
    const countdownStartPause = countdownActions.createEl("button", {
      cls: "goals-dashboard-refresh",
    });
    const countdownReset = countdownActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "重置",
    });

    countdownStartPause.addEventListener("click", () => {
      this.toggleCountdown();
      this.updateClockDisplay();
    });
    countdownReset.addEventListener("click", () => {
      this.resetCountdown();
      this.updateClockDisplay();
    });

    this.clockDom = {
      localTime,
      localDate,
      pomodoroTimer,
      pomodoroMode,
      pomodoroSessions,
      pomodoroProgressBar,
      pomodoroStartPause,
      countdownHint,
      countdownTimer,
      countdownProgressBar,
      countdownStartPause,
    };

    this.updateClockDisplay();
  }

  tickClockState() {
    this.initializeClockState();

    const now = Date.now();
    this.clockState.now = now;

    const pomodoro = this.clockState.pomodoro;
    if (pomodoro.running) {
      const remaining = pomodoro.endAt - now;
      if (remaining <= 0) {
        const wasFocus = pomodoro.mode === "focus";
        if (wasFocus) {
          pomodoro.sessions += 1;
        }

        pomodoro.mode = wasFocus ? "break" : "focus";
        const nextDuration = pomodoro.durations[pomodoro.mode];
        pomodoro.remainingMs = nextDuration;
        pomodoro.endAt = now + nextDuration;
        new Notice(wasFocus ? "番茄钟结束，开始休息。" : "休息结束，开始新一轮专注。");
      } else {
        pomodoro.remainingMs = remaining;
      }
    }

    const countdown = this.clockState.countdown;
    if (countdown.running) {
      const remaining = countdown.endAt - now;
      if (remaining <= 0) {
        countdown.running = false;
        countdown.remainingMs = 0;
        new Notice("倒计时结束。");
      } else {
        countdown.remainingMs = remaining;
      }
    }
  }

  updateClockDisplay() {
    if (!this.clockDom || !this.clockState) {
      return;
    }

    const now = new Date(this.clockState.now || Date.now());
    this.clockDom.localTime.setText(
      now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    this.clockDom.localDate.setText(
      now.toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    );

    const pomodoro = this.clockState.pomodoro;
    const pomodoroTotal = pomodoro.durations[pomodoro.mode];
    const pomodoroProgress = pomodoroTotal <= 0 ? 0 : 1 - pomodoro.remainingMs / pomodoroTotal;
    this.clockDom.pomodoroTimer.setText(this.formatClockDuration(pomodoro.remainingMs));
    this.clockDom.pomodoroMode.setText(pomodoro.mode === "focus" ? "专注" : "休息");
    this.clockDom.pomodoroSessions.setText(`已完成轮次：${pomodoro.sessions}`);
    this.clockDom.pomodoroStartPause.setText(pomodoro.running ? "暂停" : "开始");
    this.clockDom.pomodoroProgressBar.style.width = `${Math.max(0, Math.min(1, pomodoroProgress)) * 100}%`;

    const countdown = this.clockState.countdown;
    const countdownTotal = Math.max(1000, countdown.presetMs);
    const countdownProgress = countdownTotal <= 0 ? 0 : 1 - countdown.remainingMs / countdownTotal;
    this.clockDom.countdownHint.setText(
      `预设 ${this.formatClockDuration(countdown.presetMs, { includeHours: false })}`,
    );
    this.clockDom.countdownTimer.setText(this.formatClockDuration(countdown.remainingMs));
    this.clockDom.countdownStartPause.setText(countdown.running ? "暂停" : "开始");
    this.clockDom.countdownProgressBar.style.width = `${Math.max(0, Math.min(1, countdownProgress)) * 100}%`;
  }

  togglePomodoro() {
    const pomodoro = this.clockState.pomodoro;
    if (!pomodoro.running) {
      pomodoro.running = true;
      pomodoro.endAt = Date.now() + pomodoro.remainingMs;
      return;
    }

    pomodoro.remainingMs = Math.max(0, pomodoro.endAt - Date.now());
    pomodoro.running = false;
  }

  resetPomodoro() {
    const pomodoro = this.clockState.pomodoro;
    pomodoro.running = false;
    pomodoro.remainingMs = pomodoro.durations[pomodoro.mode];
    pomodoro.endAt = 0;
  }

  switchPomodoroMode() {
    const pomodoro = this.clockState.pomodoro;
    pomodoro.mode = pomodoro.mode === "focus" ? "break" : "focus";
    pomodoro.running = false;
    pomodoro.remainingMs = pomodoro.durations[pomodoro.mode];
    pomodoro.endAt = 0;
  }

  toggleCountdown() {
    const countdown = this.clockState.countdown;
    if (!countdown.running) {
      if (countdown.remainingMs <= 0) {
        countdown.remainingMs = countdown.presetMs;
      }
      countdown.running = true;
      countdown.endAt = Date.now() + countdown.remainingMs;
      return;
    }

    countdown.remainingMs = Math.max(0, countdown.endAt - Date.now());
    countdown.running = false;
  }

  resetCountdown() {
    const countdown = this.clockState.countdown;
    countdown.running = false;
    countdown.remainingMs = countdown.presetMs;
    countdown.endAt = 0;
  }

  formatClockDuration(ms, options = {}) {
    const clamped = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const seconds = clamped % 60;
    const includeHours = options.includeHours !== false && hours > 0;
    if (includeHours) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    const totalMinutes = hours * 60 + minutes;
    return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
}

module.exports = { HomeDashboardView };
