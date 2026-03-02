const { PluginSettingTab, Setting } = require("obsidian");

const { DEFAULT_SETTINGS, NORTHSTAR_FORGE_COMMANDS } = require("./constants");
const {
  attachSuggestions,
  createDatalistId,
  getVaultFolderSuggestions,
  normalizeFolderPath,
  normalizeHomeListTemplate,
} = require("./utils");

function formatHomeMetricDefinitions(definitions) {
  return (Array.isArray(definitions) ? definitions : [])
    .map((item) => {
      const label = String(item?.label ?? "").trim();
      const kind = String(item?.kind ?? "number").trim().toLowerCase() === "binary" ? "binary" : "number";
      const aliases = Array.isArray(item?.aliases)
        ? item.aliases
            .map((alias) => String(alias ?? "").trim())
            .filter(Boolean)
        : [];
      if (!label || aliases.length === 0) {
        return "";
      }

      return `${label} | ${kind} | ${aliases.join(",")}`;
    })
    .filter(Boolean)
    .join("\n");
}

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
      .setName("Local calendar daily root")
      .setDesc("Daily notes root folder used by homepage calendar.")
      .addText((text) => {
        text
          .setPlaceholder("Daily")
          .setValue(this.plugin.settings.homeCalendarDailyRoot)
          .onChange(async (value) => {
            this.plugin.settings.homeCalendarDailyRoot = normalizeFolderPath(
              value,
              DEFAULT_SETTINGS.homeCalendarDailyRoot,
            );
            await this.plugin.saveSettings();
          });

        attachSuggestions(
          containerEl,
          text.inputEl,
          createDatalistId("Local calendar root"),
          folderSuggestions,
        );

        return text;
      });

    new Setting(containerEl)
      .setName("Daily template path")
      .setDesc("Used when a daily note does not exist yet.")
      .addText((text) => {
        text
          .setPlaceholder("Daily/templates/daily-template.md")
          .setValue(this.plugin.settings.homeCalendarDailyTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.homeCalendarDailyTemplatePath =
              String(value ?? "").trim() || DEFAULT_SETTINGS.homeCalendarDailyTemplatePath;
            await this.plugin.saveSettings();
          });

        attachSuggestions(
          containerEl,
          text.inputEl,
          createDatalistId("Daily template path"),
          this.app.vault
            .getMarkdownFiles()
            .map((file) => file.path),
        );

        return text;
      });

    new Setting(containerEl)
      .setName("Calendar lookahead days")
      .setDesc("How many upcoming days are shown on homepage calendar.")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.settings.homeCalendarLookaheadDays))
          .onChange(async (value) => {
            const parsed = Number(value);
            const normalized = Number.isFinite(parsed)
              ? Math.max(1, Math.min(31, Math.round(parsed)))
              : DEFAULT_SETTINGS.homeCalendarLookaheadDays;
            this.plugin.settings.homeCalendarLookaheadDays = normalized;
            await this.plugin.saveSettings();
            this.display();
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
      .setName("Daily metrics fields")
      .setDesc(
        "One metric per line. Format: Label | number/binary | key1,key2 . First key is used for writing today.",
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("学习时间 | number | learningHours,学习时间")
          .setValue(formatHomeMetricDefinitions(this.plugin.settings.homeMetricDefinitions))
          .onChange(async (value) => {
            this.plugin.setHomeMetricDefinitionsFromText(value);
            await this.plugin.saveSettings();
          });

        text.inputEl.rows = 6;
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
