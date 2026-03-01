const { PluginSettingTab, Setting } = require("obsidian");

const { DEFAULT_SETTINGS, NORTHSTAR_FORGE_COMMANDS } = require("./constants");
const {
  attachSuggestions,
  createDatalistId,
  getVaultFolderSuggestions,
  normalizeFolderPath,
  normalizeHomeListTemplate,
} = require("./utils");

class GoalsDashboardSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const folderSuggestions = getVaultFolderSuggestions(this.app.vault, [
      DEFAULT_SETTINGS.goalsFolder,
      DEFAULT_SETTINGS.kanbanFolder,
      this.plugin.settings.goalsFolder,
      this.plugin.settings.kanbanFolder,
    ]);

    containerEl.createEl("h2", { text: "Northstar Forge settings" });

    new Setting(containerEl)
      .setName("Open homepage on startup")
      .setDesc("Automatically open Northstar Homepage when Obsidian starts.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openHomepageOnStartup).onChange(async (value) => {
          this.plugin.settings.openHomepageOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("iCloud calendar ICS URL")
      .setDesc("Paste your iCloud Calendar subscription URL (.ics).")
      .addText((text) =>
        text
          .setPlaceholder("https://pXX-caldav.icloud.com/published/2/...")
          .setValue(this.plugin.settings.homeCalendarIcsUrl)
          .onChange(async (value) => {
            this.plugin.settings.homeCalendarIcsUrl = String(value ?? "").trim();
            this.plugin.homeCalendarCache = {
              url: "",
              fetchedAt: 0,
              events: [],
              error: "",
            };
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("iCloud CalDAV base URL")
      .setDesc("Used for write-back. Usually https://caldav.icloud.com")
      .addText((text) =>
        text
          .setPlaceholder("https://caldav.icloud.com")
          .setValue(this.plugin.settings.homeCaldavBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.homeCaldavBaseUrl = String(value ?? "").trim();
            this.plugin.settings.homeCaldavCalendarUrl = "";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("iCloud Apple ID")
      .setDesc("Apple ID used for CalDAV Basic Auth.")
      .addText((text) =>
        text
          .setPlaceholder("name@example.com")
          .setValue(this.plugin.settings.homeCaldavUsername)
          .onChange(async (value) => {
            this.plugin.settings.homeCaldavUsername = String(value ?? "").trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("iCloud app-specific password")
      .setDesc("Create one at appleid.apple.com, then paste it here. Stored in local plugin data.")
      .addText((text) => {
        text
          .setPlaceholder("xxxx-xxxx-xxxx-xxxx")
          .setValue(this.plugin.settings.homeCaldavPassword)
          .onChange(async (value) => {
            this.plugin.settings.homeCaldavPassword = String(value ?? "");
            await this.plugin.saveSettings();
          });

        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        return text;
      });

    new Setting(containerEl)
      .setName("iCloud CalDAV calendar URL")
      .setDesc("Optional. Leave empty to auto-discover writable calendars.")
      .addText((text) =>
        text
          .setPlaceholder("https://caldav.icloud.com/.../calendars/.../")
          .setValue(this.plugin.settings.homeCaldavCalendarUrl)
          .onChange(async (value) => {
            this.plugin.settings.homeCaldavCalendarUrl = String(value ?? "").trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Daily list template")
      .setDesc("One item per line. This list resets every day at 05:00 local time.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Plan top task\\nReview calendar\\nMove body")
          .setValue(this.plugin.settings.homeListTemplate)
          .onChange(async (value) => {
            this.plugin.settings.homeListTemplate = normalizeHomeListTemplate(
              value,
              DEFAULT_SETTINGS.homeListTemplate,
            );
            await this.plugin.saveSettings();
            await this.plugin.ensureHomeDailyListState();
          });

        text.inputEl.rows = 5;
        text.inputEl.addClass("northstar-settings-textarea");
        return text;
      });

    new Setting(containerEl)
      .setName("Goals folder")
      .setDesc("Folder that contains your goal markdown files.")
      .addText((text) => {
        text
          .setPlaceholder("Goals")
          .setValue(this.plugin.settings.goalsFolder)
          .onChange(async (value) => {
            this.plugin.settings.goalsFolder = value.trim() || DEFAULT_SETTINGS.goalsFolder;
            await this.plugin.saveSettings();
          });

        attachSuggestions(
          containerEl,
          text.inputEl,
          createDatalistId("Goals folder"),
          folderSuggestions,
        );

        return text;
      });

    new Setting(containerEl)
      .setName("Kanban folder")
      .setDesc("Folder that contains markdown kanban boards.")
      .addText((text) => {
        text
          .setPlaceholder("Kanban")
          .setValue(this.plugin.settings.kanbanFolder)
          .onChange(async (value) => {
            this.plugin.settings.kanbanFolder = normalizeFolderPath(value, DEFAULT_SETTINGS.kanbanFolder);
            await this.plugin.saveSettings();
          });

        attachSuggestions(
          containerEl,
          text.inputEl,
          createDatalistId("Kanban folder"),
          folderSuggestions,
        );

        return text;
      });

    const commandsEl = containerEl.createDiv({ cls: "planning-hub-command-list" });
    commandsEl.createEl("h3", { text: "Commands" });
    commandsEl.createEl("p", { text: "Current Northstar Forge commands:" });
    const listEl = commandsEl.createEl("ul");
    for (const commandName of NORTHSTAR_FORGE_COMMANDS) {
      listEl.createEl("li", { text: commandName });
    }
  }
}

module.exports = { GoalsDashboardSettingTab };
