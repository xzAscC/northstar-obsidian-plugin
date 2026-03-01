const { ItemView, Notice } = require("obsidian");

const { VIEW_TYPE_HOME_DASHBOARD } = require("../constants");
const { groupCalendarEventsByDate, formatClockTime } = require("../utils");
const { CreateIcloudEventModal } = require("../modals");

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

    const newEventButton = headerActions.createEl("button", {
      cls: "goals-dashboard-refresh",
      text: "New Event",
    });
    newEventButton.addEventListener("click", async () => {
      const payload = await this.promptCreateIcloudEvent();
      if (!payload) {
        return;
      }

      await this.tryCreateIcloudEvent(payload);
    });

    const grid = container.createDiv({ cls: "northstar-homepage-grid" });

    const calendarCard = grid.createDiv({ cls: "northstar-homepage-card" });
    const calendarTop = calendarCard.createDiv({ cls: "northstar-homepage-card-top" });
    calendarTop.createEl("h3", { text: "iCloud Calendar" });
    const calendarHint = calendarTop.createEl("span", {
      cls: "northstar-homepage-card-hint",
      text: "Next 7 days",
    });
    calendarHint.title = "Calendar events from your iCloud .ics subscription";

    const calendarUrl = String(this.plugin.settings.homeCalendarIcsUrl ?? "").trim();
    if (!calendarUrl) {
      calendarCard.createEl("p", {
        cls: "goals-dashboard-empty",
        text: "Set iCloud Calendar URL in plugin settings to show events.",
      });
    } else {
      const { events, error } = await this.plugin.getIcloudCalendarEvents();
      if (error) {
        calendarCard.createEl("p", {
          cls: "goals-dashboard-empty",
          text: `Calendar fetch failed: ${error}`,
        });
      } else if (events.length === 0) {
        calendarCard.createEl("p", {
          cls: "goals-dashboard-empty",
          text: "No upcoming events in the next 7 days.",
        });
      } else {
        const groups = groupCalendarEventsByDate(events);
        const list = calendarCard.createDiv({ cls: "northstar-calendar-list" });
        for (const [dateLabel, dateEvents] of groups) {
          const group = list.createDiv({ cls: "northstar-calendar-group" });
          group.createEl("h4", {
            cls: "northstar-calendar-date",
            text: dateLabel,
          });
          for (const event of dateEvents) {
            const eventRow = group.createDiv({ cls: "northstar-calendar-event" });
            eventRow.createSpan({
              cls: "northstar-calendar-time",
              text: event.allDay ? "All day" : formatClockTime(event.start),
            });
            eventRow.createSpan({
              cls: "northstar-calendar-title",
              text: event.summary,
            });
          }
        }
      }
    }

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
      return;
    }

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

  async promptCreateIcloudEvent() {
    return new Promise((resolve) => {
      const modal = new CreateIcloudEventModal(this.app, resolve);
      modal.open();
    });
  }

  async tryCreateIcloudEvent(payload) {
    try {
      await this.plugin.createIcloudCalendarEvent(payload);
      new Notice("Event added to iCloud calendar.");
      await this.render();
    } catch (error) {
      const code = String(error?.message ?? "");
      if (code === "missing-caldav-credentials") {
        new Notice("Set CalDAV URL, Apple ID and app-specific password in plugin settings.");
        return;
      }

      if (code === "missing-calendar-title") {
        new Notice("Please enter an event title.");
        return;
      }

      if (code === "invalid-calendar-start") {
        new Notice("Please enter a valid start/end time.");
        return;
      }

      if (code === "invalid-caldav-url") {
        new Notice("Invalid CalDAV base URL.");
        return;
      }

      if (code === "invalid-caldav-calendar-url") {
        new Notice("Invalid CalDAV calendar URL.");
        return;
      }

      if (code === "caldav-auth-failed") {
        new Notice("CalDAV auth failed. Check Apple ID and app-specific password.");
        return;
      }

      if (code === "calendar-not-found") {
        new Notice("No writable calendar found via CalDAV. Set Calendar URL manually in settings.");
        return;
      }

      if (code.startsWith("caldav-discovery-failed:")) {
        const status = code.split(":")[1] || "unknown";
        new Notice(`Calendar discovery failed (HTTP ${status}).`);
        return;
      }

      if (code.startsWith("caldav-put-failed:")) {
        const status = code.split(":")[1] || "unknown";
        new Notice(`Failed to create event (HTTP ${status}).`);
        return;
      }

      if (code === "event-already-exists") {
        new Notice("Event already exists. Try again.");
        return;
      }

      console.error(error);
      new Notice("Failed to create iCloud event.");
    }
  }
}

module.exports = { HomeDashboardView };
