const fs = require("fs");
const path = require("path");
const Module = require("module");
const obsidian = require("obsidian");
const { Notice, Plugin, requestUrl } = obsidian;

const NORTHSTAR_OBSIDIAN_PATCH_FLAG = "__northstarObsidianRequirePatched";
if (!globalThis[NORTHSTAR_OBSIDIAN_PATCH_FLAG]) {
  const originalModuleLoad = Module._load;
  Module._load = function patchedModuleLoad(request, parent, isMain) {
    if (request === "obsidian") {
      return obsidian;
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
  globalThis[NORTHSTAR_OBSIDIAN_PATCH_FLAG] = true;
}

function requirePluginModule(relativePath) {
  const normalizedPath = String(relativePath ?? "")
    .trim()
    .replace(/^\.\//, "");

  const candidateRoots = new Set();

  function addCandidateRoot(rootPath) {
    const normalizedRoot = String(rootPath ?? "").trim();
    if (!normalizedRoot) {
      return;
    }

    if (!candidateRoots.has(normalizedRoot)) {
      candidateRoots.add(normalizedRoot);
    }
  }

  if (typeof __dirname === "string" && __dirname) {
    addCandidateRoot(__dirname);
  }

  if (typeof __filename === "string" && __filename) {
    addCandidateRoot(path.dirname(__filename));
  }

  if (typeof module !== "undefined" && module && typeof module.filename === "string") {
    addCandidateRoot(path.dirname(module.filename));
  }

  const cwd =
    typeof process !== "undefined" && process && typeof process.cwd === "function"
      ? process.cwd()
      : "";
  if (cwd) {
    addCandidateRoot(path.join(cwd, ".obsidian", "plugins", "northstar"));
    addCandidateRoot(path.join(cwd, ".obsidian", "plugins", "Northstar"));
  }

  const appRef = typeof globalThis !== "undefined" ? globalThis.app : undefined;
  const basePath = String(appRef?.vault?.adapter?.basePath ?? "").trim();
  const configDir = String(appRef?.vault?.configDir ?? ".obsidian").trim() || ".obsidian";
  if (basePath) {
    addCandidateRoot(path.join(basePath, configDir, "plugins", "northstar"));
    addCandidateRoot(path.join(basePath, configDir, "plugins", "Northstar"));
  }

  for (const root of candidateRoots) {
    const absolutePath = path.join(root, normalizedPath);
    const hasModule =
      fs.existsSync(absolutePath) ||
      fs.existsSync(`${absolutePath}.js`) ||
      fs.existsSync(path.join(absolutePath, "index.js"));
    if (hasModule) {
      return require(absolutePath);
    }
  }

  throw new Error(
    `Northstar module resolution failed for '${normalizedPath}'. Tried: ${Array.from(candidateRoots)
      .map((root) => path.join(root, normalizedPath))
      .join(", ")}`,
  );
}

const {
  DEFAULT_SETTINGS,
  VIEW_TYPE_GOALS_DASHBOARD,
  VIEW_TYPE_HOME_DASHBOARD,
  VIEW_TYPE_KANBAN_TODO_DASHBOARD,
  VIEW_TYPE_MILESTONE_DASHBOARD,
} = requirePluginModule("src/constants");
const {
  buildGoalTemplate,
  buildIcsEvent,
  buildKanbanTodoTemplate,
  compareDue,
  createEventUid,
  extractTodoItems,
  extractUpcomingCalendarEvents,
  getHomeListResetKey,
  getUniquePath,
  isBoardArchived,
  isGoalArchived,
  isSameHomeDailyItems,
  isSidebarLeaf,
  isTruthy,
  mergeHomeDailyItems,
  needsKanbanFrontmatterHydration,
  normalizeBoard,
  normalizeDateString,
  normalizeFolderPath,
  normalizeGoalsFolder,
  formatDateHeading,
  normalizeHomeDailyListState,
  normalizeHomeListTemplate,
  normalizeKanbanListName,
  normalizeKanbanListOrder,
  normalizeMilestone,
  normalizePriority,
  normalizeTagList,
  parseHoursValue,
  parseHomeListTemplate,
  parseKanbanTodoMetadata,
  parseSingleTodoFile,
  sanitizeFileName,
  toBase64,
  normalizeHttpUrl,
} = requirePluginModule("src/utils");
const { GoalsDashboardSettingTab } = requirePluginModule("src/goals-dashboard-setting-tab");
const { GoalsDashboardView } = requirePluginModule("src/views/goals-dashboard-view");
const { HomeDashboardView } = requirePluginModule("src/views/home-dashboard-view");
const { KanbanTodoDashboardView } = requirePluginModule("src/views/kanban-todo-dashboard-view");
const { MilestoneDashboardView } = requirePluginModule("src/views/milestone-dashboard-view");

async function ensureFolderExists(vault, folderPath) {
  const normalizedPath = String(folderPath ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) {
    return;
  }

  const parts = normalizedPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!vault.getAbstractFileByPath(currentPath)) {
      await vault.createFolder(currentPath);
    }
  }
}

function formatDateKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const matched = String(dateKey ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function listDateKeysInRange(startDateKey, endDateKey) {
  const startDate = parseDateKey(startDateKey);
  const endDate = parseDateKey(endDateKey);
  if (!startDate || !endDate) {
    throw new Error("invalid-calendar-date");
  }

  if (startDate.getTime() > endDate.getTime()) {
    throw new Error("invalid-calendar-range");
  }

  const dateKeys = [];
  const cursor = new Date(startDate.getTime());
  while (cursor.getTime() <= endDate.getTime()) {
    dateKeys.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return dateKeys;
}

function toStartOfDay(date) {
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function addDays(date, days) {
  return toStartOfDay(new Date(date.getTime() + days * 24 * 60 * 60 * 1000));
}

function formatMonthKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getIsoWeekInfo(date) {
  const base = toStartOfDay(date);
  const weekday = (base.getDay() + 6) % 7;
  const weekStart = addDays(base, -weekday);
  const weekEnd = addDays(weekStart, 6);

  const weekAnchor = addDays(weekStart, 3);
  const weekYear = weekAnchor.getFullYear();
  const firstWeekAnchor = new Date(weekYear, 0, 4, 0, 0, 0, 0);
  const firstWeekday = (firstWeekAnchor.getDay() + 6) % 7;
  const firstWeekStart = addDays(firstWeekAnchor, -firstWeekday);
  const weekNumber = Math.floor((weekStart.getTime() - firstWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return {
    weekYear,
    weekNumber,
    weekStart,
    weekEnd,
  };
}

function parseDateFromDailyBasename(basename) {
  const matched = String(basename ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }

  return parsed;
}

function parseBriefMetricValue(rawValue, kind) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (kind === "binary") {
    return numeric > 0 ? 1 : 0;
  }

  return Number(numeric.toFixed(2));
}

function buildBriefFallbackTemplate(periodTitle) {
  return [
    `# ${periodTitle}`,
    "",
    "- 范围：{{startDate}} 至 {{endDate}}",
    "- 生成时间：{{generatedAt}}",
    "",
    "## 概览",
    "{{overviewSection}}",
    "",
    "## 完成事项",
    "{{completedItemsSection}}",
    "",
    "## 未完成事项",
    "{{pendingItemsSection}}",
    "",
    "## 指标趋势",
    "{{metricsSection}}",
    "",
    "## 下阶段重点",
    "- ",
  ].join("\n");
}

function renderBriefTemplate(templateContent, values) {
  return String(templateContent ?? "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return "";
    }

    return String(values[key] ?? "");
  });
}

function normalizeHomeCalendarTaskItem(rawItem) {
  const text = String(rawItem?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  return {
    text,
    done: Boolean(rawItem?.done),
  };
}

function normalizeHomeCalendarTasksByDate(rawState) {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
    return {};
  }

  const normalized = {};
  for (const [dateKey, taskList] of Object.entries(rawState)) {
    if (!parseDateKey(dateKey)) {
      continue;
    }

    const items = Array.isArray(taskList)
      ? taskList.map((item) => normalizeHomeCalendarTaskItem(item)).filter(Boolean)
      : [];

    if (items.length > 0) {
      normalized[dateKey] = items;
    }
  }

  return normalized;
}

const DAILY_TASK_SECTION_HEADING = "## 今日任务";

function isSameHomeCalendarTasks(leftTasks, rightTasks) {
  const left = Array.isArray(leftTasks) ? leftTasks : [];
  const right = Array.isArray(rightTasks) ? rightTasks : [];
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftTask = left[index];
    const rightTask = right[index];
    if (!rightTask) {
      return false;
    }

    if (leftTask.text !== rightTask.text || Boolean(leftTask.done) !== Boolean(rightTask.done)) {
      return false;
    }
  }

  return true;
}

function parseDailyTaskSection(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const sectionStart = lines.findIndex((line) => /^##\s*今日任务\s*$/.test(line.trim()));
  if (sectionStart < 0) {
    return { hasSection: false, tasks: [] };
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      sectionEnd = index;
      break;
    }
  }

  const tasks = [];
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const match = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    const normalized = normalizeHomeCalendarTaskItem({
      text: match[2],
      done: String(match[1]).toLowerCase() === "x",
    });
    if (normalized) {
      tasks.push(normalized);
    }
  }

  return { hasSection: true, tasks };
}

function upsertDailyTaskSection(markdown, tasks) {
  const normalizedMarkdown = String(markdown ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown ? normalizedMarkdown.split("\n") : [];
  const normalizedTasks = (Array.isArray(tasks) ? tasks : [])
    .map((task) => normalizeHomeCalendarTaskItem(task))
    .filter(Boolean);
  const sectionLines = [
    DAILY_TASK_SECTION_HEADING,
    ...normalizedTasks.map((task) => `- [${task.done ? "x" : " "}] ${task.text}`),
  ];

  const sectionStart = lines.findIndex((line) => /^##\s*今日任务\s*$/.test(line.trim()));
  if (sectionStart < 0) {
    const shouldInsertSpacer = lines.length > 0 && lines[lines.length - 1].trim() !== "";
    const suffix = shouldInsertSpacer ? ["", ...sectionLines] : sectionLines;
    return [...lines, ...suffix].join("\n");
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      sectionEnd = index;
      break;
    }
  }

  return [...lines.slice(0, sectionStart), ...sectionLines, ...lines.slice(sectionEnd)].join("\n");
}

function normalizeHomeMetricKind(rawKind) {
  return String(rawKind ?? "number").trim().toLowerCase() === "binary" ? "binary" : "number";
}

function sanitizeHomeMetricAliases(rawAliases) {
  const source = Array.isArray(rawAliases)
    ? rawAliases
    : String(rawAliases ?? "")
        .split(",")
        .map((item) => item.trim());
  return source
    .map((alias) => String(alias ?? "").trim())
    .filter((alias, index, list) => alias && list.indexOf(alias) === index);
}

function toHomeMetricId(seed, index) {
  const normalized = String(seed ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `metric-${index + 1}`;
}

function normalizeHomeMetricDefinitions(rawDefinitions) {
  const fallback = Array.isArray(DEFAULT_SETTINGS.homeMetricDefinitions)
    ? DEFAULT_SETTINGS.homeMetricDefinitions
    : [];
  const source = Array.isArray(rawDefinitions) && rawDefinitions.length > 0 ? rawDefinitions : fallback;
  const usedIds = new Set();
  const normalized = [];

  source.forEach((item, index) => {
    const label = String(item?.label ?? "").trim();
    const aliases = sanitizeHomeMetricAliases(item?.aliases);
    const kind = normalizeHomeMetricKind(item?.kind);
    const primaryAlias = aliases[0] || label;
    const idSeed = item?.id || primaryAlias || label;
    let id = toHomeMetricId(idSeed, index);
    while (usedIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    usedIds.add(id);

    if (!label || !primaryAlias) {
      return;
    }

    normalized.push({
      id,
      label,
      aliases: aliases.length > 0 ? aliases : [primaryAlias],
      kind,
    });
  });

  return normalized.length > 0
    ? normalized
    : normalizeHomeMetricDefinitions(DEFAULT_SETTINGS.homeMetricDefinitions);
}

function parseHomeMetricDefinitionsFromText(sourceText) {
  const lines = String(sourceText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = lines.map((line) => {
    const [labelPart, kindPart, aliasesPart] = line.split("|").map((part) => String(part ?? "").trim());
    const aliases = sanitizeHomeMetricAliases(aliasesPart || labelPart);
    return {
      label: labelPart,
      kind: normalizeHomeMetricKind(kindPart),
      aliases,
    };
  });

  return normalizeHomeMetricDefinitions(parsed);
}

function normalizeMilestoneRanges(rawRanges) {
  if (!rawRanges || typeof rawRanges !== "object" || Array.isArray(rawRanges)) {
    return {};
  }

  const normalized = {};
  for (const [rawName, rawRange] of Object.entries(rawRanges)) {
    const milestoneName = normalizeMilestone(rawName);
    if (!milestoneName) {
      continue;
    }

    const start = normalizeDateString(rawRange?.start);
    const due = normalizeDateString(rawRange?.due);
    if (!start && !due) {
      continue;
    }

    normalized[milestoneName] = { start, due };
  }

  return normalized;
}

class GoalsDashboardPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.homeCalendarCache = {
      url: "",
      fetchedAt: 0,
      events: [],
      error: "",
    };

    this.registerView(
      VIEW_TYPE_HOME_DASHBOARD,
      (leaf) => new HomeDashboardView(leaf, this),
    );

    this.registerView(
      VIEW_TYPE_GOALS_DASHBOARD,
      (leaf) => new GoalsDashboardView(leaf, this),
    );

    this.addRibbonIcon("house", "Open Northstar Homepage", () => {
      this.activateHomeView();
    });

    this.addCommand({
      id: "open-northstar-homepage",
      name: "Open Northstar Homepage",
      callback: () => this.activateHomeView(),
    });

    this.registerView(
      VIEW_TYPE_MILESTONE_DASHBOARD,
      (leaf) => new MilestoneDashboardView(leaf, this),
    );

    this.registerView(
      VIEW_TYPE_KANBAN_TODO_DASHBOARD,
      (leaf) => new KanbanTodoDashboardView(leaf, this),
    );

    this.addRibbonIcon("target", "Open Northstar Forge", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-goals-dashboard",
      name: "Open Northstar Forge",
      callback: () => this.activateView(),
    });

    this.addRibbonIcon("flag", "Open Milestone Kanban", () => {
      this.activateMilestoneView();
    });

    this.addCommand({
      id: "open-milestones-dashboard",
      name: "Open Milestone Kanban",
      callback: () => this.activateMilestoneView(),
    });

    this.addRibbonIcon("columns-3", "Open Kanban Todo", () => {
      this.activateKanbanTodoView();
    });

    this.addCommand({
      id: "open-kanban-todo-dashboard",
      name: "Open Kanban Todo",
      callback: () => this.activateKanbanTodoView(),
    });

    this.addCommand({
      id: "open-current-weekly-brief",
      name: "Open Current Weekly Brief",
      callback: async () => {
        await this.openCurrentBrief("weekly");
      },
    });

    this.addCommand({
      id: "open-current-monthly-brief",
      name: "Open Current Monthly Brief",
      callback: async () => {
        await this.openCurrentBrief("monthly");
      },
    });

    this.addCommand({
      id: "open-current-yearly-brief",
      name: "Open Current Yearly Brief",
      callback: async () => {
        await this.openCurrentBrief("yearly");
      },
    });

    this.addSettingTab(new GoalsDashboardSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openHomepageOnStartup) {
        this.activateHomeView();
      }
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_HOME_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GOALS_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MILESTONE_DASHBOARD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_KANBAN_TODO_DASHBOARD);
  }

  async activateHomeView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_HOME_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_HOME_DASHBOARD,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async activateView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_GOALS_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_GOALS_DASHBOARD,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async activateMilestoneView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_MILESTONE_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_MILESTONE_DASHBOARD,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async activateKanbanTodoView() {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_KANBAN_TODO_DASHBOARD);
    let leaf = existingLeaves.find((candidate) => !isSidebarLeaf(workspace, candidate));

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_KANBAN_TODO_DASHBOARD,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.settings.openHomepageOnStartup = this.settings.openHomepageOnStartup !== false;
    this.settings.homeCalendarDailyRoot = normalizeFolderPath(
      this.settings.homeCalendarDailyRoot,
      DEFAULT_SETTINGS.homeCalendarDailyRoot,
    );
    this.settings.homeCalendarDailyTemplatePath =
      String(this.settings.homeCalendarDailyTemplatePath ?? "").trim() ||
      DEFAULT_SETTINGS.homeCalendarDailyTemplatePath;
    this.settings.briefRoot = normalizeFolderPath(this.settings.briefRoot, DEFAULT_SETTINGS.briefRoot);
    this.settings.briefTemplateWeeklyPath = String(this.settings.briefTemplateWeeklyPath ?? "").trim();
    this.settings.briefTemplateMonthlyPath = String(this.settings.briefTemplateMonthlyPath ?? "").trim();
    this.settings.briefTemplateYearlyPath = String(this.settings.briefTemplateYearlyPath ?? "").trim();
    const lookaheadDays = Number(this.settings.homeCalendarLookaheadDays);
    this.settings.homeCalendarLookaheadDays = Number.isFinite(lookaheadDays)
      ? Math.max(1, Math.min(31, Math.round(lookaheadDays)))
      : DEFAULT_SETTINGS.homeCalendarLookaheadDays;
    this.settings.homeListTemplate = normalizeHomeListTemplate(
      this.settings.homeListTemplate,
      DEFAULT_SETTINGS.homeListTemplate,
    );
    this.settings.homeMetricDefinitions = normalizeHomeMetricDefinitions(this.settings.homeMetricDefinitions);
    this.settings.homeDailyListState = normalizeHomeDailyListState(this.settings.homeDailyListState);
    this.settings.homeCalendarTasksByDate = normalizeHomeCalendarTasksByDate(
      this.settings.homeCalendarTasksByDate,
    );

    if (!Array.isArray(this.settings.boardOrder)) {
      this.settings.boardOrder = [];
    }

    if (!Array.isArray(this.settings.milestoneOrder)) {
      this.settings.milestoneOrder = [];
    }

    this.settings.milestoneOrder = this.settings.milestoneOrder
      .map((name) => normalizeMilestone(name))
      .filter((name, index, list) => name && list.indexOf(name) === index);

    this.settings.milestoneRanges = normalizeMilestoneRanges(this.settings.milestoneRanges);

    this.settings.milestoneArchived = Array.isArray(this.settings.milestoneArchived)
      ? this.settings.milestoneArchived
          .map((name) => normalizeMilestone(name))
          .filter((name, index, list) => name && list.indexOf(name) === index)
      : [];

    const archivedLists = Array.isArray(this.settings.kanbanArchivedLists)
      ? this.settings.kanbanArchivedLists
          .map((name) => normalizeKanbanListName(name))
          .filter((name, index, list) => name && list.indexOf(name) === index)
      : [];

    this.settings.kanbanListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, archivedLists);
    this.settings.kanbanArchivedLists = archivedLists.filter((name) =>
      this.settings.kanbanListOrder.includes(name),
    );
    this.settings.kanbanTodoIncludeInactiveGoals =
      this.settings.kanbanTodoIncludeInactiveGoals === true;

    this.settings.goalsFolder = normalizeFolderPath(this.settings.goalsFolder, DEFAULT_SETTINGS.goalsFolder);
    this.settings.kanbanFolder = normalizeFolderPath(this.settings.kanbanFolder, DEFAULT_SETTINGS.kanbanFolder);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setHomeMetricDefinitionsFromText(sourceText) {
    this.settings.homeMetricDefinitions = parseHomeMetricDefinitionsFromText(sourceText);
  }

  getHomeMetricDefinitions() {
    return normalizeHomeMetricDefinitions(this.settings.homeMetricDefinitions);
  }

  async ensureHomeDailyListState() {
    const nextResetKey = getHomeListResetKey(new Date());
    const templateItems = parseHomeListTemplate(this.settings.homeListTemplate);
    const state = normalizeHomeDailyListState(this.settings.homeDailyListState);

    if (state.resetKey !== nextResetKey) {
      this.settings.homeDailyListState = {
        resetKey: nextResetKey,
        items: templateItems.map((text) => ({ text, done: false, archived: false })),
      };
      await this.saveSettings();
      return { changed: true, state: this.settings.homeDailyListState };
    }

    const mergedItems = mergeHomeDailyItems(state.items, templateItems);
    const changed = !isSameHomeDailyItems(state.items, mergedItems);
    if (changed) {
      this.settings.homeDailyListState = {
        resetKey: state.resetKey,
        items: mergedItems,
      };
      await this.saveSettings();
    }

    return { changed, state: this.settings.homeDailyListState };
  }

  async getHomeDailyListState() {
    const ensured = await this.ensureHomeDailyListState();
    return ensured.state;
  }

  async setHomeDailyItemDone(index, done) {
    const ensured = await this.ensureHomeDailyListState();
    const items = [...ensured.state.items];
    if (!items[index]) {
      return;
    }

    items[index] = {
      text: items[index].text,
      done: Boolean(done),
      archived: Boolean(items[index].archived),
    };

    this.settings.homeDailyListState = {
      resetKey: ensured.state.resetKey,
      items,
    };
    await this.saveSettings();
  }

  async addHomeDailyItem(text) {
    const value = String(text ?? "").trim();
    if (!value) {
      throw new Error("empty-home-item");
    }

    const ensured = await this.ensureHomeDailyListState();
    const items = [...ensured.state.items, { text: value, done: false, archived: false }];
    this.settings.homeDailyListState = {
      resetKey: ensured.state.resetKey,
      items,
    };
    await this.saveSettings();
  }

  async archiveHomeDailyItem(index) {
    const ensured = await this.ensureHomeDailyListState();
    const items = [...ensured.state.items];
    if (!items[index]) {
      return;
    }

    items[index] = {
      text: items[index].text,
      done: Boolean(items[index].done),
      archived: true,
    };

    this.settings.homeDailyListState = {
      resetKey: ensured.state.resetKey,
      items,
    };
    await this.saveSettings();
  }

  async removeHomeDailyItem(index) {
    const ensured = await this.ensureHomeDailyListState();
    const items = ensured.state.items.filter((_, itemIndex) => itemIndex !== index);
    this.settings.homeDailyListState = {
      resetKey: ensured.state.resetKey,
      items,
    };
    await this.saveSettings();
  }

  async getHomeDailyMetrics() {
    const lookbackDays = 14;
    const metrics = this.getHomeMetricDefinitions();
    const root = normalizeFolderPath(this.settings.homeCalendarDailyRoot, DEFAULT_SETTINGS.homeCalendarDailyRoot);
    const rootPrefix = `${root}/`;

    const parseMetricValue = (rawValue, kind) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) {
        return null;
      }

      if (kind === "binary") {
        return numeric > 0 ? 1 : 0;
      }

      return Number(numeric.toFixed(2));
    };

    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate.getTime() - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
    const todayDateKey = formatDateKey(endDate);

    const allFiles = this.app.vault.getMarkdownFiles();
    const samplesByMetric = new Map(metrics.map((metric) => [metric.id, []]));
    const todayValues = {};

    for (const file of allFiles) {
      if (!String(file.path ?? "").startsWith(rootPrefix)) {
        continue;
      }

      const noteDate = parseDateFromDailyBasename(file.basename);
      if (!noteDate || noteDate < startDate || noteDate > endDate) {
        continue;
      }

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) {
        continue;
      }

      const date = file.basename;
      for (const metric of metrics) {
        const key = metric.aliases.find((alias) =>
          Object.prototype.hasOwnProperty.call(frontmatter, alias),
        );
        if (!key) {
          continue;
        }

        const value = parseMetricValue(frontmatter[key], metric.kind);
        if (value === null) {
          continue;
        }

        samplesByMetric.get(metric.id).push({
          date,
          value,
        });

        if (date === todayDateKey) {
          todayValues[metric.id] = value;
        }
      }
    }

    return {
      lookbackDays,
      todayDateKey,
      todayValues,
      metrics: metrics.map((metric) => {
        const samples = samplesByMetric
          .get(metric.id)
          .sort((left, right) => String(left.date).localeCompare(String(right.date)));
        const values = samples.map((item) => item.value);
        const latest = values.length > 0 ? values[values.length - 1] : null;
        const average =
          values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
        return {
          ...metric,
          samples,
          latest,
          average,
        };
      }),
    };
  }

  async setTodayHomeMetricValue(metricId, rawValue) {
    const metrics = this.getHomeMetricDefinitions();
    const metric = metrics.find((item) => item.id === metricId);
    if (!metric) {
      throw new Error("unknown-home-metric");
    }

    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      throw new Error("invalid-home-metric-value");
    }

    const normalizedValue = metric.kind === "binary" ? (numeric > 0 ? 1 : 0) : Number(numeric.toFixed(2));
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const targetPath = this.getDailyNotePathByDate(date);
    let targetFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (!targetFile) {
      const templateContent = await this.readDailyTemplate();
      const folderPath = targetPath.split("/").slice(0, -1).join("/");
      await ensureFolderExists(this.app.vault, folderPath);
      targetFile = await this.app.vault.create(targetPath, templateContent);
    }

    if (Array.isArray(targetFile.children) || targetFile.extension !== "md") {
      throw new Error("daily-path-conflict");
    }

    const writeKey = metric.aliases[0] || metric.id;

    await this.app.fileManager.processFrontMatter(targetFile, (frontmatter) => {
      frontmatter[writeKey] = normalizedValue;
    });
  }

  getDailyNotePathByDate(date) {
    const root = normalizeFolderPath(
      this.settings.homeCalendarDailyRoot,
      DEFAULT_SETTINGS.homeCalendarDailyRoot,
    );
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const monthFolder = `${year}-${month}`;
    return `${root}/${year}/${monthFolder}/${year}-${month}-${day}.md`;
  }

  getLocalCalendarDays() {
    const totalDays = Number.isFinite(this.settings.homeCalendarLookaheadDays)
      ? this.settings.homeCalendarLookaheadDays
      : DEFAULT_SETTINGS.homeCalendarLookaheadDays;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = [];

    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
      const path = this.getDailyNotePathByDate(date);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const exists = Boolean(existing && !Array.isArray(existing.children) && existing.extension === "md");

      items.push({
        dateKey: formatDateKey(date),
        dateLabel: formatDateHeading(date),
        path,
        exists,
        isToday: offset === 0,
      });
    }

    return items;
  }

  async getHomeCalendarTasksByDate(dateKey) {
    if (!parseDateKey(dateKey)) {
      throw new Error("invalid-calendar-date");
    }

    const source = normalizeHomeCalendarTasksByDate(this.settings.homeCalendarTasksByDate);
    const persistedTasks = Array.isArray(source[dateKey]) ? [...source[dateKey]] : [];
    const noteTasks = await this.readHomeCalendarTasksFromDailyNote(dateKey);
    if (!noteTasks.hasSection) {
      return persistedTasks;
    }

    await this.setHomeCalendarTasksByDate(dateKey, noteTasks.tasks);
    return [...noteTasks.tasks];
  }

  getHomeCalendarTaskSummaryByDate() {
    const source = normalizeHomeCalendarTasksByDate(this.settings.homeCalendarTasksByDate);
    const summary = {};

    for (const [dateKey, tasks] of Object.entries(source)) {
      const total = tasks.length;
      const done = tasks.filter((task) => task.done).length;
      summary[dateKey] = {
        total,
        done,
      };
    }

    return summary;
  }

  async addHomeCalendarTask(dateKey, text) {
    if (!parseDateKey(dateKey)) {
      throw new Error("invalid-calendar-date");
    }

    const normalizedTask = normalizeHomeCalendarTaskItem({ text, done: false });
    if (!normalizedTask) {
      throw new Error("empty-calendar-task");
    }

    const tasks = await this.getHomeCalendarTasksByDate(dateKey);
    tasks.push(normalizedTask);
    await this.setHomeCalendarTasksByDate(dateKey, tasks);
    await this.syncHomeCalendarTasksToDailyNote(dateKey, tasks, { createIfMissing: true });
    return 1;
  }

  async addHomeCalendarTaskRange(startDateKey, endDateKey, text) {
    const dateKeys = listDateKeysInRange(startDateKey, endDateKey);
    const normalizedTask = normalizeHomeCalendarTaskItem({ text, done: false });
    if (!normalizedTask) {
      throw new Error("empty-calendar-task");
    }

    const source = normalizeHomeCalendarTasksByDate(this.settings.homeCalendarTasksByDate);
    const nextState = { ...source };
    dateKeys.forEach((dateKey) => {
      const tasks = Array.isArray(nextState[dateKey]) ? [...nextState[dateKey]] : [];
      tasks.push({ ...normalizedTask });
      nextState[dateKey] = tasks;
    });

    this.settings.homeCalendarTasksByDate = nextState;
    await this.saveSettings();

    for (const dateKey of dateKeys) {
      await this.syncHomeCalendarTasksToDailyNote(dateKey, nextState[dateKey], {
        createIfMissing: false,
      });
    }

    return dateKeys.length;
  }

  async setHomeCalendarTaskDone(dateKey, index, done) {
    if (!parseDateKey(dateKey)) {
      throw new Error("invalid-calendar-date");
    }

    const tasks = await this.getHomeCalendarTasksByDate(dateKey);
    if (!tasks[index]) {
      return;
    }

    tasks[index] = {
      text: tasks[index].text,
      done: Boolean(done),
    };

    await this.setHomeCalendarTasksByDate(dateKey, tasks);
    await this.syncHomeCalendarTasksToDailyNote(dateKey, tasks, { createIfMissing: false });
  }

  async removeHomeCalendarTask(dateKey, index) {
    if (!parseDateKey(dateKey)) {
      throw new Error("invalid-calendar-date");
    }

    const tasks = (await this.getHomeCalendarTasksByDate(dateKey)).filter(
      (_, taskIndex) => taskIndex !== index,
    );
    await this.setHomeCalendarTasksByDate(dateKey, tasks);
    await this.syncHomeCalendarTasksToDailyNote(dateKey, tasks, { createIfMissing: false });
  }

  async setHomeCalendarTasksByDate(dateKey, tasks) {
    const source = normalizeHomeCalendarTasksByDate(this.settings.homeCalendarTasksByDate);
    const normalizedTasks = (Array.isArray(tasks) ? tasks : [])
      .map((task) => normalizeHomeCalendarTaskItem(task))
      .filter(Boolean);
    const currentTasks = Array.isArray(source[dateKey]) ? source[dateKey] : [];

    if (normalizedTasks.length > 0) {
      if (isSameHomeCalendarTasks(currentTasks, normalizedTasks)) {
        return;
      }

      this.settings.homeCalendarTasksByDate = {
        ...source,
        [dateKey]: normalizedTasks,
      };
      await this.saveSettings();
      return;
    }

    if (!source[dateKey]) {
      return;
    }

    const nextState = { ...source };
    delete nextState[dateKey];
    this.settings.homeCalendarTasksByDate = nextState;
    await this.saveSettings();
  }

  async readHomeCalendarTasksFromDailyNote(dateKey) {
    const date = parseDateKey(dateKey);
    if (!date) {
      throw new Error("invalid-calendar-date");
    }

    const path = this.getDailyNotePathByDate(date);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || Array.isArray(file.children) || file.extension !== "md") {
      return { hasSection: false, tasks: [] };
    }

    const markdown = await this.app.vault.cachedRead(file);
    return parseDailyTaskSection(markdown);
  }

  async syncHomeCalendarTasksToDailyNote(dateKey, tasks, options = {}) {
    const date = parseDateKey(dateKey);
    if (!date) {
      throw new Error("invalid-calendar-date");
    }

    const targetPath = this.getDailyNotePathByDate(date);
    let targetFile = this.app.vault.getAbstractFileByPath(targetPath);

    if (!targetFile) {
      if (!options.createIfMissing) {
        return;
      }

      const templateContent = await this.readDailyTemplate();
      const folderPath = targetPath.split("/").slice(0, -1).join("/");
      await ensureFolderExists(this.app.vault, folderPath);
      targetFile = await this.app.vault.create(targetPath, templateContent);
    }

    if (Array.isArray(targetFile.children) || targetFile.extension !== "md") {
      throw new Error("daily-path-conflict");
    }

    const markdown = await this.app.vault.cachedRead(targetFile);
    const nextMarkdown = upsertDailyTaskSection(markdown, tasks);
    if (nextMarkdown !== markdown) {
      await this.app.vault.modify(targetFile, nextMarkdown);
    }
  }

  async readDailyTemplate() {
    const templatePath =
      String(this.settings.homeCalendarDailyTemplatePath ?? "").trim() ||
      DEFAULT_SETTINGS.homeCalendarDailyTemplatePath;
    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!templateFile || Array.isArray(templateFile.children) || templateFile.extension !== "md") {
      throw new Error("daily-template-not-found");
    }

    return this.app.vault.cachedRead(templateFile);
  }

  getBriefPeriodInfo(periodType, anchorDate = new Date()) {
    const date = toStartOfDay(anchorDate);
    if (periodType === "weekly") {
      const isoWeek = getIsoWeekInfo(date);
      const weekLabel = `W${String(isoWeek.weekNumber).padStart(2, "0")}`;
      return {
        type: "weekly",
        title: `周报 ${isoWeek.weekYear}-${weekLabel}`,
        key: `${isoWeek.weekYear}-${weekLabel}`,
        folder: "weekly",
        fileName: `${isoWeek.weekYear}-[W]${String(isoWeek.weekNumber).padStart(2, "0")}.md`,
        startDate: isoWeek.weekStart,
        endDate: isoWeek.weekEnd,
      };
    }

    if (periodType === "monthly") {
      const startDate = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
      const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 0, 0, 0, 0);
      const key = formatMonthKey(date);
      return {
        type: "monthly",
        title: `月报 ${key}`,
        key,
        folder: "monthly",
        fileName: `${key}.md`,
        startDate,
        endDate,
      };
    }

    if (periodType === "yearly") {
      const year = date.getFullYear();
      return {
        type: "yearly",
        title: `年报 ${year}`,
        key: String(year),
        folder: "yearly",
        fileName: `${year}.md`,
        startDate: new Date(year, 0, 1, 0, 0, 0, 0),
        endDate: new Date(year, 11, 31, 0, 0, 0, 0),
      };
    }

    throw new Error("invalid-brief-period");
  }

  getBriefTemplatePath(periodType) {
    if (periodType === "weekly") {
      return String(this.settings.briefTemplateWeeklyPath ?? "").trim();
    }

    if (periodType === "monthly") {
      return String(this.settings.briefTemplateMonthlyPath ?? "").trim();
    }

    if (periodType === "yearly") {
      return String(this.settings.briefTemplateYearlyPath ?? "").trim();
    }

    return "";
  }

  async readBriefTemplate(periodType, periodTitle) {
    const templatePath = this.getBriefTemplatePath(periodType);
    if (!templatePath) {
      return buildBriefFallbackTemplate(periodTitle);
    }

    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!templateFile || Array.isArray(templateFile.children) || templateFile.extension !== "md") {
      return buildBriefFallbackTemplate(periodTitle);
    }

    return this.app.vault.cachedRead(templateFile);
  }

  async collectBriefData(startDate, endDate) {
    const metrics = this.getHomeMetricDefinitions();
    const metricSamples = new Map(metrics.map((metric) => [metric.id, []]));
    const completedCounts = new Map();
    const pendingCounts = new Map();

    let noteDays = 0;
    let taskTotal = 0;
    let taskDone = 0;

    const cursor = toStartOfDay(startDate);
    const end = toStartOfDay(endDate);
    while (cursor.getTime() <= end.getTime()) {
      const dailyPath = this.getDailyNotePathByDate(cursor);
      const file = this.app.vault.getAbstractFileByPath(dailyPath);
      if (file && !Array.isArray(file.children) && file.extension === "md") {
        noteDays += 1;
        const dateKey = formatDateKey(cursor);

        const markdown = await this.app.vault.cachedRead(file);
        const parsedTasks = parseDailyTaskSection(markdown);
        if (parsedTasks.hasSection && parsedTasks.tasks.length > 0) {
          for (const task of parsedTasks.tasks) {
            taskTotal += 1;
            const targetMap = task.done ? completedCounts : pendingCounts;
            if (task.done) {
              taskDone += 1;
            }

            targetMap.set(task.text, Number(targetMap.get(task.text) || 0) + 1);
          }
        }

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (frontmatter) {
          for (const metric of metrics) {
            const matchedAlias = metric.aliases.find((alias) =>
              Object.prototype.hasOwnProperty.call(frontmatter, alias),
            );
            if (!matchedAlias) {
              continue;
            }

            const metricValue = parseBriefMetricValue(frontmatter[matchedAlias], metric.kind);
            if (metricValue === null) {
              continue;
            }

            metricSamples.get(metric.id).push({
              date: dateKey,
              value: metricValue,
            });
          }
        }
      }

      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
    }

    const toRankedTaskLines = (map) => {
      const ranked = Array.from(map.entries())
        .sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }

          return left[0].localeCompare(right[0]);
        })
        .slice(0, 15);

      if (ranked.length === 0) {
        return "- 无";
      }

      return ranked.map(([text, count]) => (count > 1 ? `- ${text} (${count})` : `- ${text}`)).join("\n");
    };

    const formatMetric = (value) => {
      if (!Number.isFinite(value)) {
        return "-";
      }

      return Number.isInteger(value) ? String(value) : String(Number(value).toFixed(2));
    };

    const metricLines = [];
    for (const metric of metrics) {
      const samples = metricSamples.get(metric.id)
        .slice()
        .sort((left, right) => String(left.date).localeCompare(String(right.date)));
      if (samples.length === 0) {
        metricLines.push(`- ${metric.label}: 无数据`);
        continue;
      }

      const values = samples.map((sample) => sample.value);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      const latest = values[values.length - 1];
      const max = Math.max(...values);
      const min = Math.min(...values);
      metricLines.push(
        `- ${metric.label}: avg ${formatMetric(average)} | latest ${formatMetric(latest)} | min ${formatMetric(min)} | max ${formatMetric(max)} | samples ${samples.length}`,
      );
    }

    return {
      totalDays: Math.floor((toStartOfDay(endDate).getTime() - toStartOfDay(startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1,
      noteDays,
      taskTotal,
      taskDone,
      taskPending: Math.max(0, taskTotal - taskDone),
      completionRate: taskTotal > 0 ? Number(((taskDone / taskTotal) * 100).toFixed(1)) : 0,
      completedItemsSection: toRankedTaskLines(completedCounts),
      pendingItemsSection: toRankedTaskLines(pendingCounts),
      metricsSection: metricLines.length > 0 ? metricLines.join("\n") : "- 无指标",
    };
  }

  async generateBrief(periodType, anchorDate = new Date()) {
    const period = this.getBriefPeriodInfo(periodType, anchorDate);
    const data = await this.collectBriefData(period.startDate, period.endDate);
    const template = await this.readBriefTemplate(period.type, period.title);
    const overviewSection = [
      `- 覆盖日报：${data.noteDays}/${data.totalDays} 天`,
      `- 任务完成率：${data.taskDone}/${data.taskTotal} (${data.completionRate}%)`,
      `- 未完成任务：${data.taskPending}`,
    ].join("\n");

    const rendered = renderBriefTemplate(template, {
      periodTitle: period.title,
      periodKey: period.key,
      startDate: formatDateKey(period.startDate),
      endDate: formatDateKey(period.endDate),
      generatedAt: new Date().toLocaleString(),
      overviewSection,
      completedItemsSection: data.completedItemsSection,
      pendingItemsSection: data.pendingItemsSection,
      metricsSection: data.metricsSection,
    });

    const briefRoot = normalizeFolderPath(this.settings.briefRoot, DEFAULT_SETTINGS.briefRoot);
    const briefFolder = `${briefRoot}/${period.folder}`;
    const briefPath = `${briefFolder}/${period.fileName}`;
    await ensureFolderExists(this.app.vault, briefFolder);

    const existing = this.app.vault.getAbstractFileByPath(briefPath);
    if (existing && Array.isArray(existing.children)) {
      throw new Error("brief-path-conflict");
    }

    if (!existing) {
      const file = await this.app.vault.create(briefPath, rendered);
      return {
        file,
        path: briefPath,
        created: true,
      };
    }

    const previous = await this.app.vault.cachedRead(existing);
    if (previous !== rendered) {
      await this.app.vault.modify(existing, rendered);
    }

    return {
      file: existing,
      path: briefPath,
      created: false,
    };
  }

  async openCurrentBrief(periodType) {
    try {
      const result = await this.generateBrief(periodType, new Date());
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(result.file, { active: true });
      this.app.workspace.revealLeaf(leaf);
      new Notice(result.created ? "Brief created." : "Brief updated.");
    } catch (error) {
      const code = String(error?.message ?? "");
      if (code === "invalid-brief-period") {
        new Notice("Invalid brief period.");
        return;
      }

      if (code === "brief-path-conflict") {
        new Notice("Brief path exists but is not a markdown note.");
        return;
      }

      console.error(error);
      new Notice("Failed to generate brief.");
    }
  }

  async openOrCreateDailyNoteByDateKey(dateKey, options = {}) {
    const date = parseDateKey(dateKey);
    if (!date) {
      throw new Error("invalid-calendar-date");
    }

    const targetPath = this.getDailyNotePathByDate(date);
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    const isMarkdownFile = Boolean(
      existing && !Array.isArray(existing.children) && existing.extension === "md",
    );

    let targetFile = existing;
    if (!isMarkdownFile) {
      if (existing) {
        throw new Error("daily-path-conflict");
      }

      const templateContent = await this.readDailyTemplate();
      const folderPath = targetPath.split("/").slice(0, -1).join("/");
      await ensureFolderExists(this.app.vault, folderPath);
      targetFile = await this.app.vault.create(targetPath, templateContent);
    }

    const leaf = options.openInRightSplit
      ? this.app.workspace.getLeaf("split", "vertical") || this.app.workspace.getLeaf(true)
      : this.app.workspace.getLeaf(true);
    await leaf.openFile(targetFile, { active: true });
    if (options.preferPreview && leaf?.view && typeof leaf.view.setMode === "function") {
      await leaf.view.setMode("preview");
    }
    this.app.workspace.revealLeaf(leaf);

    return {
      file: targetFile,
      created: !isMarkdownFile,
    };
  }

  async getIcloudCalendarEvents() {
    const url = String(this.settings.homeCalendarIcsUrl ?? "").trim();
    if (!url) {
      return { events: [], error: "" };
    }

    const now = Date.now();
    const isCached =
      this.homeCalendarCache.url === url &&
      now - this.homeCalendarCache.fetchedAt < 5 * 60 * 1000;

    if (isCached) {
      return {
        events: this.homeCalendarCache.events,
        error: this.homeCalendarCache.error,
      };
    }

    try {
      const response = await requestUrl({
        url,
        method: "GET",
      });
      const events = extractUpcomingCalendarEvents(response.text, new Date());
      this.homeCalendarCache = {
        url,
        fetchedAt: now,
        events,
        error: "",
      };
      return { events, error: "" };
    } catch (error) {
      const message = error && error.message ? String(error.message) : "Failed to fetch iCloud calendar.";
      this.homeCalendarCache = {
        url,
        fetchedAt: now,
        events: [],
        error: message,
      };
      return { events: [], error: message };
    }
  }

  async createIcloudCalendarEvent(payload) {
    const baseUrl = String(this.settings.homeCaldavBaseUrl ?? "").trim();
    const username = String(this.settings.homeCaldavUsername ?? "").trim();
    const password = String(this.settings.homeCaldavPassword ?? "");

    if (!baseUrl || !username || !password) {
      throw new Error("missing-caldav-credentials");
    }

    const title = String(payload?.title ?? "").trim();
    if (!title) {
      throw new Error("missing-calendar-title");
    }

    const uid = createEventUid();
    const eventBody = buildIcsEvent({
      ...payload,
      uid,
    });
    const authHeaders = {
      Authorization: `Basic ${toBase64(`${username}:${password}`)}`,
    };

    let normalizedBaseUrl = "";
    try {
      normalizedBaseUrl = normalizeHttpUrl(baseUrl);
    } catch (error) {
      throw new Error("invalid-caldav-url");
    }

    const requestedCalendarUrl = String(this.settings.homeCaldavCalendarUrl ?? "").trim();
    let calendarUrl = "";
    if (requestedCalendarUrl) {
      try {
        calendarUrl = normalizeHttpUrl(requestedCalendarUrl);
      } catch (error) {
        throw new Error("invalid-caldav-calendar-url");
      }
    } else {
      calendarUrl = await discoverCaldavCalendarUrl(normalizedBaseUrl, authHeaders);
    }

    if (!calendarUrl) {
      throw new Error("calendar-not-found");
    }

    if (!requestedCalendarUrl && calendarUrl !== this.settings.homeCaldavCalendarUrl) {
      this.settings.homeCaldavCalendarUrl = calendarUrl;
      await this.saveSettings();
    }

    const separator = calendarUrl.endsWith("/") ? "" : "/";
    const eventUrl = `${calendarUrl}${separator}${uid}.ics`;

    try {
      await requestUrl({
        url: eventUrl,
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "text/calendar; charset=utf-8",
          "If-None-Match": "*",
        },
        body: eventBody,
      });
    } catch (error) {
      const status = Number(error?.status ?? 0);
      if (status === 401 || status === 403) {
        throw new Error("caldav-auth-failed");
      }

      if (status === 412) {
        throw new Error("event-already-exists");
      }

      if (status >= 400) {
        throw new Error(`caldav-put-failed:${status}`);
      }

      throw error;
    }

    this.homeCalendarCache = {
      url: "",
      fetchedAt: 0,
      events: [],
      error: "",
    };
  }

  async getGoals() {
    const allFiles = this.app.vault.getMarkdownFiles();
    const goals = [];
    const base = this.settings.goalsFolder.replace(/^\/+|\/+$/g, "");
    const folderPrefix = `${base}/`;

    for (const file of allFiles) {
      const inFolder = file.path === base || file.path.startsWith(folderPrefix);
      if (!inFolder) {
        continue;
      }

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || frontmatter.type !== "goal") {
        continue;
      }

      const start = Number(frontmatter.start ?? 0);
      const current = Number(frontmatter.current ?? 0);
      const target = Number(frontmatter.target ?? 0);

      if (![start, current, target].every(Number.isFinite)) {
        continue;
      }

      const denominator = target - start;
      const rawProgress = denominator === 0 ? (current >= target ? 1 : 0) : (current - start) / denominator;
      const clampedProgress = Math.max(0, Math.min(1, rawProgress));
      const percent = Math.round(clampedProgress * 100);
      goals.push({
        file,
        name: file.basename,
        title: String(frontmatter.title ?? file.basename).trim() || file.basename,
        board: normalizeBoard(frontmatter.board ?? frontmatter.area ?? "Uncategorized"),
        metric: frontmatter.metric ?? frontmatter.unit ?? "",
        start,
        current,
        target,
        due: frontmatter.due ?? "",
        status: frontmatter.status ?? "on-track",
        milestone: frontmatter.milestone ?? frontmatter.task ?? "",
        milestoneStart: frontmatter.milestoneStart ?? frontmatter.taskStart ?? "",
        milestoneDue: frontmatter.milestoneDue ?? frontmatter.taskDue ?? "",
        percent,
        archived: isTruthy(frontmatter.archived),
        boardArchived: isBoardArchived(frontmatter),
      });
    }

    return goals.sort((a, b) => {
      const boardCompare = String(a.board).localeCompare(String(b.board));
      if (boardCompare !== 0) {
        return boardCompare;
      }

      if (a.due && b.due) {
        const dueCompare = String(a.due).localeCompare(String(b.due));
        if (dueCompare !== 0) {
          return dueCompare;
        }
      }

      return String(a.title).localeCompare(String(b.title));
    });
  }

  async updateCurrent(file, delta) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const currentValue = Number(fm.current ?? 0);
      fm.current = Number.isFinite(currentValue) ? currentValue + delta : delta;
    });
  }

  async archiveBoardGoals(goals) {
    for (const goal of goals) {
      await this.app.fileManager.processFrontMatter(goal.file, (fm) => {
        fm.board = normalizeBoard(fm.board ?? fm.area ?? goal.board);
        fm.boardArchived = true;
        fm.boardStatus = "archived";
      });
    }
  }

  async updateGoalFields(file, updates) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [key, value] of Object.entries(updates)) {
        if (key === "due" || key === "milestoneStart" || key === "milestoneDue") {
          fm[key] = normalizeDateString(value);
          continue;
        }

        fm[key] = value;
      }
    });
  }

  async createGoalFile(payload) {
    const name = String(payload.name ?? "").trim();
    if (!name) {
      throw new Error("missing-goal-name");
    }

    const goalsFolder = normalizeGoalsFolder(this.settings.goalsFolder);
    await ensureFolderExists(this.app.vault, goalsFolder);

    const targetValue = Number(payload.target ?? 1);
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      throw new Error("invalid-target");
    }

    const sanitizedBaseName = sanitizeFileName(name) || `goal-${Date.now()}`;
    const filePath = getUniquePath(this.app.vault, goalsFolder, sanitizedBaseName);
    const content = buildGoalTemplate({
      board: normalizeBoard(payload.board),
      metric: String(payload.metric ?? "").trim(),
      due: normalizeDateString(payload.due),
      target: targetValue,
    });

    return this.app.vault.create(filePath, content);
  }

  async createKanbanTodoFile(payload) {
    const name = String(payload.name ?? "").trim();
    const text = String(payload.text ?? "").trim();
    const requestedList = String(payload.list ?? "").trim();
    const defaultList =
      this.settings.kanbanListOrder.find((listName) => !this.isKanbanListArchived(listName)) || "Today";
    const list = normalizeKanbanListName(requestedList || defaultList);
    const milestone = String(payload.milestone ?? "").trim();

    if (!name) {
      throw new Error("missing-todo-name");
    }

    const kanbanFolder = normalizeFolderPath(this.settings.kanbanFolder, DEFAULT_SETTINGS.kanbanFolder);
    await ensureFolderExists(this.app.vault, kanbanFolder);

    const nextListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [list]);
    if (nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n")) {
      this.settings.kanbanListOrder = nextListOrder;
      await this.saveSettings();
    }

    const sanitizedBaseName = sanitizeFileName(name) || `todo-${Date.now()}`;
    const filePath = getUniquePath(this.app.vault, kanbanFolder, sanitizedBaseName);
    const existingTodos = await this.getKanbanBoards();
    const maxOrderInList = existingTodos
      .filter((todo) => todo.list === list && Number.isFinite(todo.order))
      .reduce((maxOrder, todo) => Math.max(maxOrder, Number(todo.order)), -1);
    const nextOrder = maxOrderInList + 1;
    const content = buildKanbanTodoTemplate({
      text: text || name,
      list,
      milestone,
      goal: payload.goal,
      priority: payload.priority,
      due: payload.due,
      tags: payload.tags,
      order: nextOrder,
      planHours: payload.planHours,
      hoursLeft: payload.hoursLeft,
    });

    return this.app.vault.create(filePath, content);
  }

  async createKanbanList(name) {
    const listName = normalizeKanbanListName(name);
    const nextListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [listName]);
    const nextArchivedLists = this.settings.kanbanArchivedLists.filter(
      (list) => normalizeKanbanListName(list) !== listName,
    );
    const changed = nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n");
    const archiveChanged = nextArchivedLists.join("\n") !== this.settings.kanbanArchivedLists.join("\n");
    if (changed || archiveChanged) {
      this.settings.kanbanListOrder = nextListOrder;
      this.settings.kanbanArchivedLists = nextArchivedLists;
      await this.saveSettings();
    }

    return {
      name: listName,
      created: changed,
      unarchived: archiveChanged,
    };
  }

  async renameKanbanList(fromName, toName) {
    const sourceList = normalizeKanbanListName(fromName);
    const targetList = normalizeKanbanListName(toName);

    if (sourceList === targetList) {
      return {
        from: sourceList,
        to: targetList,
        renamed: false,
        movedCount: 0,
      };
    }

    const todos = await this.getKanbanBoards();
    const sourceTodos = todos.filter((todo) => todo.list === sourceList);
    for (const todo of sourceTodos) {
      await this.app.fileManager.processFrontMatter(todo.file, (fm) => {
        fm.list = targetList;
      });
    }

    const nextListOrder = normalizeKanbanListOrder(
      this.settings.kanbanListOrder.map((list) =>
        normalizeKanbanListName(list) === sourceList ? targetList : list,
      ),
      [targetList],
    );
    const nextArchivedLists = this.settings.kanbanArchivedLists
      .map((list) =>
        normalizeKanbanListName(list) === sourceList ? targetList : normalizeKanbanListName(list),
      )
      .filter((list, index, all) => all.indexOf(list) === index);

    if (
      nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n") ||
      nextArchivedLists.join("\n") !== this.settings.kanbanArchivedLists.join("\n")
    ) {
      this.settings.kanbanListOrder = nextListOrder;
      this.settings.kanbanArchivedLists = nextArchivedLists;
      await this.saveSettings();
    }

    return {
      from: sourceList,
      to: targetList,
      renamed: true,
      movedCount: sourceTodos.length,
    };
  }

  async removeKanbanList(name, destinationName) {
    const listName = normalizeKanbanListName(name);
    const todos = await this.getKanbanBoards();
    const sourceTodos = todos.filter((todo) => todo.list === listName);

    const allLists = normalizeKanbanListOrder(
      this.settings.kanbanListOrder,
      todos.map((todo) => todo.list),
    );
    const remainingLists = allLists.filter((list) => list !== listName);

    let destinationList = String(destinationName ?? "").trim()
      ? normalizeKanbanListName(destinationName)
      : "";

    if (sourceTodos.length > 0) {
      if (!destinationList) {
        destinationList = remainingLists[0] || "Today";
      }

      if (destinationList === listName) {
        throw new Error("remove-list-target-matches-source");
      }

      for (const todo of sourceTodos) {
        await this.app.fileManager.processFrontMatter(todo.file, (fm) => {
          fm.list = destinationList;
        });
      }
    }

    const nextListOrder = normalizeKanbanListOrder(
      this.settings.kanbanListOrder.filter((list) => normalizeKanbanListName(list) !== listName),
      sourceTodos.length > 0 ? [destinationList] : [],
    );
    const nextArchivedLists = this.settings.kanbanArchivedLists.filter(
      (list) => normalizeKanbanListName(list) !== listName,
    );

    if (
      nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n") ||
      nextArchivedLists.join("\n") !== this.settings.kanbanArchivedLists.join("\n")
    ) {
      this.settings.kanbanListOrder = nextListOrder;
      this.settings.kanbanArchivedLists = nextArchivedLists;
      await this.saveSettings();
    }

    return {
      removed: listName,
      target: destinationList,
      movedCount: sourceTodos.length,
    };
  }

  isKanbanListArchived(name) {
    const listName = normalizeKanbanListName(name);
    return this.settings.kanbanArchivedLists.includes(listName);
  }

  async archiveKanbanList(name) {
    const listName = normalizeKanbanListName(name);
    if (this.settings.kanbanArchivedLists.includes(listName)) {
      return {
        name: listName,
        archived: false,
      };
    }

    this.settings.kanbanListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [listName]);
    this.settings.kanbanArchivedLists = [...this.settings.kanbanArchivedLists, listName].filter(
      (list, index, all) => all.indexOf(list) === index,
    );
    await this.saveSettings();

    return {
      name: listName,
      archived: true,
    };
  }

  async unarchiveKanbanList(name) {
    const listName = normalizeKanbanListName(name);
    const nextArchivedLists = this.settings.kanbanArchivedLists.filter((list) => list !== listName);
    if (nextArchivedLists.join("\n") === this.settings.kanbanArchivedLists.join("\n")) {
      return {
        name: listName,
        unarchived: false,
      };
    }

    this.settings.kanbanArchivedLists = nextArchivedLists;
    await this.saveSettings();

    return {
      name: listName,
      unarchived: true,
    };
  }

  isMilestoneArchived(name) {
    const milestoneName = normalizeMilestone(name);
    return this.settings.milestoneArchived.includes(milestoneName);
  }

  async archiveMilestone(name) {
    const milestoneName = normalizeMilestone(name);
    if (this.settings.milestoneArchived.includes(milestoneName)) {
      return {
        name: milestoneName,
        archived: false,
      };
    }

    this.settings.milestoneOrder = [...this.settings.milestoneOrder, milestoneName].filter(
      (item, index, list) => item && list.indexOf(item) === index,
    );
    this.settings.milestoneArchived = [...this.settings.milestoneArchived, milestoneName].filter(
      (item, index, list) => item && list.indexOf(item) === index,
    );
    await this.saveSettings();

    return {
      name: milestoneName,
      archived: true,
    };
  }

  async unarchiveMilestone(name) {
    const milestoneName = normalizeMilestone(name);
    const nextArchived = this.settings.milestoneArchived.filter((item) => item !== milestoneName);
    if (nextArchived.join("\n") === this.settings.milestoneArchived.join("\n")) {
      return {
        name: milestoneName,
        unarchived: false,
      };
    }

    this.settings.milestoneArchived = nextArchived;
    await this.saveSettings();

    return {
      name: milestoneName,
      unarchived: true,
    };
  }

  async updateMilestoneRange(name, updates) {
    const milestoneName = normalizeMilestone(name);
    const currentRanges = normalizeMilestoneRanges(this.settings.milestoneRanges);
    const current = currentRanges[milestoneName] || { start: "", due: "" };
    const next = {
      start: Object.prototype.hasOwnProperty.call(updates || {}, "start")
        ? normalizeDateString(updates.start)
        : current.start,
      due: Object.prototype.hasOwnProperty.call(updates || {}, "due")
        ? normalizeDateString(updates.due)
        : current.due,
    };

    if (!next.start && !next.due) {
      delete currentRanges[milestoneName];
    } else {
      currentRanges[milestoneName] = next;
    }

    this.settings.milestoneRanges = currentRanges;
    await this.saveSettings();
  }

  async getGoalTodos(file) {
    const raw = await this.app.vault.cachedRead(file);
    return extractTodoItems(raw);
  }

  async getKanbanBoards() {
    const allFiles = this.app.vault.getMarkdownFiles();
    const todos = [];
    const base = normalizeFolderPath(this.settings.kanbanFolder, "");
    const folderPrefix = base ? `${base}/` : "";

    for (const file of allFiles) {
      if (base) {
        const inFolder = file.path === base || file.path.startsWith(folderPrefix);
        if (!inFolder) {
          continue;
        }
      }

      const raw = await this.app.vault.cachedRead(file);
      const todo = parseSingleTodoFile(raw);
      if (!todo) {
        continue;
      }

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const metadata = parseKanbanTodoMetadata(frontmatter);

      if (
        frontmatter &&
        (Object.prototype.hasOwnProperty.call(frontmatter, "schedule") ||
          Object.prototype.hasOwnProperty.call(frontmatter, "schdule"))
      ) {
        await this.removeLegacyKanbanTodoFields(file);
      }

      if (needsKanbanFrontmatterHydration(frontmatter)) {
        await this.ensureKanbanTodoFrontmatter(file, metadata);
      }

      todos.push({
        file,
        name: file.basename,
        text: todo.text,
        done: todo.done,
        list: metadata.list,
        milestone: metadata.milestone,
        goal: metadata.goal,
        priority: metadata.priority,
        due: metadata.due,
        tags: metadata.tags,
        order: metadata.order,
        planHours: metadata.planHours,
        hoursLeft: metadata.hoursLeft,
      });
    }

    const listOrder = normalizeKanbanListOrder(
      this.settings.kanbanListOrder,
      todos.map((todo) => todo.list),
    );

    return todos.sort((left, right) => {
      const leftListIndex = listOrder.indexOf(left.list);
      const rightListIndex = listOrder.indexOf(right.list);
      if (leftListIndex !== rightListIndex) {
        return leftListIndex - rightListIndex;
      }

      if (left.done !== right.done) {
        return Number(left.done) - Number(right.done);
      }

      const leftOrder = Number.isFinite(left.order) ? Number(left.order) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(right.order) ? Number(right.order) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return String(left.name).localeCompare(String(right.name));
    });
  }

  async removeLegacyKanbanTodoFields(file) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (Object.prototype.hasOwnProperty.call(fm, "schedule")) {
        delete fm.schedule;
      }

      if (Object.prototype.hasOwnProperty.call(fm, "schdule")) {
        delete fm.schdule;
      }
    });
  }

  async ensureKanbanTodoFrontmatter(file, metadata) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!Object.prototype.hasOwnProperty.call(fm, "list")) {
        fm.list = normalizeKanbanListName(metadata.list);
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "milestone")) {
        fm.milestone = normalizeMilestone(metadata.milestone);
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "goal")) {
        fm.goal = String(metadata.goal ?? "").trim();
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "priority")) {
        fm.priority = normalizePriority(metadata.priority);
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "due")) {
        fm.due = normalizeDateString(metadata.due);
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "tags")) {
        fm.tags = normalizeTagList(metadata.tags);
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "order")) {
        fm.order = Number.isFinite(metadata.order) ? metadata.order : 0;
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "planHours")) {
        fm.planHours = Number.isFinite(metadata.planHours) ? metadata.planHours : 0;
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "hoursLeft")) {
        fm.hoursLeft = Number.isFinite(metadata.hoursLeft)
          ? metadata.hoursLeft
          : Number.isFinite(metadata.planHours)
            ? metadata.planHours
            : 0;
      }
    });
  }

  async updateKanbanTodoFields(file, updates) {
    let nextList = "";
    let moveListChanged = false;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [key, value] of Object.entries(updates || {})) {
        if (key === "list") {
          const listName = normalizeKanbanListName(value);
          moveListChanged = normalizeKanbanListName(fm.list) !== listName;
          fm.list = listName;
          nextList = listName;
          continue;
        }

        if (key === "order") {
          const orderRaw = Number(value);
          fm.order = Number.isFinite(orderRaw) && orderRaw >= 0 ? Math.floor(orderRaw) : 0;
          continue;
        }

        if (key === "priority") {
          fm.priority = normalizePriority(value);
          continue;
        }

        if (key === "due") {
          fm.due = normalizeDateString(value);
          continue;
        }

        if (key === "milestone") {
          fm.milestone = normalizeMilestone(value);
          continue;
        }

        if (key === "goal") {
          fm.goal = String(value ?? "").trim();
          continue;
        }

        if (key === "tags") {
          fm.tags = normalizeTagList(value);
          continue;
        }

        if (key === "planHours") {
          const parsedPlanHours = parseHoursValue(value);
          fm.planHours = Number.isFinite(parsedPlanHours) ? parsedPlanHours : 0;
          if (!Object.prototype.hasOwnProperty.call(fm, "hoursLeft")) {
            fm.hoursLeft = fm.planHours;
          }
          continue;
        }

        if (key === "hoursLeft") {
          const parsedHoursLeft = parseHoursValue(value);
          fm.hoursLeft = Number.isFinite(parsedHoursLeft)
            ? parsedHoursLeft
            : Number.isFinite(fm.planHours)
              ? fm.planHours
              : 0;
          continue;
        }

        fm[key] = value;
      }
    });

    if (!nextList) {
      return;
    }

    if (moveListChanged) {
      await this.moveKanbanTodoToListEnd(file, nextList);
    }

    const nextListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [nextList]);
    const nextArchivedLists = this.settings.kanbanArchivedLists.filter(
      (list) => normalizeKanbanListName(list) !== nextList,
    );
    const listChanged = nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n");
    const archiveChanged = nextArchivedLists.join("\n") !== this.settings.kanbanArchivedLists.join("\n");

    if (listChanged || archiveChanged) {
      this.settings.kanbanListOrder = nextListOrder;
      this.settings.kanbanArchivedLists = nextArchivedLists;
      await this.saveSettings();
    }
  }

  async moveKanbanTodoToListEnd(file, listName) {
    const normalizedList = normalizeKanbanListName(listName);
    const todos = await this.getKanbanBoards();
    const maxOrderInList = todos
      .filter((todo) => todo.list === normalizedList && todo.file.path !== file.path && Number.isFinite(todo.order))
      .reduce((maxOrder, todo) => Math.max(maxOrder, Number(todo.order)), -1);

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.order = maxOrderInList + 1;
    });
  }

  async reorderKanbanTodosInList(listName, orderedTodoPaths) {
    const normalizedList = normalizeKanbanListName(listName);
    const todos = await this.getKanbanBoards();
    const listTodos = todos.filter((todo) => todo.list === normalizedList);
    if (listTodos.length === 0) {
      return;
    }

    const pathSet = new Set(
      (Array.isArray(orderedTodoPaths) ? orderedTodoPaths : [])
        .map((todoPath) => String(todoPath ?? "").trim())
        .filter(Boolean),
    );

    const orderedOpenTodos = (Array.isArray(orderedTodoPaths) ? orderedTodoPaths : [])
      .map((todoPath) => listTodos.find((todo) => todo.file.path === String(todoPath ?? "").trim()))
      .filter((todo) => todo && !todo.done);

    const untouchedOpenTodos = listTodos
      .filter((todo) => !todo.done)
      .filter((todo) => !pathSet.has(todo.file.path));

    const doneTodos = listTodos.filter((todo) => todo.done);
    const finalOrder = [...orderedOpenTodos, ...untouchedOpenTodos, ...doneTodos];

    for (let index = 0; index < finalOrder.length; index += 1) {
      const todo = finalOrder[index];
      if (Number.isFinite(todo.order) && Number(todo.order) === index) {
        continue;
      }

      await this.app.fileManager.processFrontMatter(todo.file, (fm) => {
        fm.order = index;
      });
    }
  }

  async updateKanbanTodoText(file, text) {
    await this.updateCheckboxTodoText(file, 0, text);
  }

  async updateCheckboxTodoText(file, todoIndex, text) {
    const line = String(text ?? "").replace(/\r?\n+/g, " ").trim();
    if (!line) {
      throw new Error("missing-todo-text");
    }

    const raw = await this.app.vault.cachedRead(file);
    const lines = String(raw ?? "").split(/\r?\n/);
    const targetIndex = Number.isFinite(todoIndex) ? Math.max(0, Math.floor(todoIndex)) : 0;
    let checkboxIndex = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*[-*]\s+\[[ xX]\]\s+).+$/);
      if (!match) {
        continue;
      }

      if (checkboxIndex !== targetIndex) {
        checkboxIndex += 1;
        continue;
      }

      lines[index] = `${match[1]}${line}`;
      await this.app.vault.modify(file, lines.join("\n"));
      return;
    }

    throw new Error("todo-checkbox-not-found");
  }

  async setKanbanTodoDone(file, done) {
    await this.setCheckboxTodoDone(file, 0, done);
  }

  async setCheckboxTodoDone(file, todoIndex, done) {
    const raw = await this.app.vault.cachedRead(file);
    const lines = String(raw ?? "").split(/\r?\n/);
    const targetState = done ? "x" : " ";
    const targetIndex = Number.isFinite(todoIndex) ? Math.max(0, Math.floor(todoIndex)) : 0;
    let checkboxIndex = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*[-*]\s+)\[([ xX])\](\s+.+)$/);
      if (!match) {
        continue;
      }

      if (checkboxIndex !== targetIndex) {
        checkboxIndex += 1;
        continue;
      }

      lines[index] = `${match[1]}[${targetState}]${match[3]}`;
      await this.app.vault.modify(file, lines.join("\n"));
      return;
    }

    throw new Error("todo-checkbox-not-found");
  }

  async getMilestones() {
    const goals = await this.getGoals();
    const activeGoals = goals.filter((goal) => !isGoalArchived(goal));
    const grouped = new Map();
    const milestoneRanges = normalizeMilestoneRanges(this.settings.milestoneRanges);
    const ensureMilestoneBucket = (milestoneName) => {
      if (!grouped.has(milestoneName)) {
        grouped.set(milestoneName, {
          name: milestoneName,
          start: "",
          due: "",
          goals: [],
          todos: [],
          todoOpen: 0,
          todoDone: 0,
        });
      }

      return grouped.get(milestoneName);
    };

    const goalsWithTodos = await Promise.all(
      activeGoals.map(async (goal) => {
        const todos = await this.getGoalTodos(goal.file);
        return { ...goal, todos };
      }),
    );

    for (const goal of goalsWithTodos) {
      const milestoneName = normalizeMilestone(goal.milestone);
      const bucket = ensureMilestoneBucket(milestoneName);
      bucket.goals.push(goal);

      const milestoneStart = String(goal.milestoneStart ?? "").trim();
      if (milestoneStart && (!bucket.start || compareDue(milestoneStart, bucket.start) < 0)) {
        bucket.start = milestoneStart;
      }

      const milestoneDue = String(goal.milestoneDue ?? "").trim();
      if (milestoneDue && (!bucket.due || compareDue(milestoneDue, bucket.due) > 0)) {
        bucket.due = milestoneDue;
      }

      for (const todo of goal.todos) {
        bucket.todos.push({
          goalTitle: goal.title,
          goalFile: goal.file,
          text: todo.text,
          todoFile: goal.file,
          todoIndex: Number.isFinite(todo.index) ? todo.index : 0,
          done: todo.done,
          source: "goal",
        });

        if (todo.done) {
          bucket.todoDone += 1;
        } else {
          bucket.todoOpen += 1;
        }
      }
    }

    const kanbanTodos = await this.getKanbanBoards();
    for (const todo of kanbanTodos) {
      const milestoneName = normalizeMilestone(todo.milestone);
      const bucket = ensureMilestoneBucket(milestoneName);

      const todoDue = String(todo.due ?? "").trim();
      if (todoDue && (!bucket.due || compareDue(todoDue, bucket.due) > 0)) {
        bucket.due = todoDue;
      }

      bucket.todos.push({
        goalTitle: String(todo.goal ?? "").trim() || todo.name,
        goalFile: todo.file,
        text: todo.text,
        todoFile: todo.file,
        todoIndex: 0,
        done: todo.done,
        source: "kanban",
      });

      if (todo.done) {
        bucket.todoDone += 1;
      } else {
        bucket.todoOpen += 1;
      }
    }

    if (grouped.size === 0) {
      return [];
    }

    const milestones = Array.from(grouped.values());
    for (const milestone of milestones) {
      const explicitRange = milestoneRanges[milestone.name] || {};
      if (explicitRange.start) {
        milestone.start = explicitRange.start;
      }

      if (explicitRange.due) {
        milestone.due = explicitRange.due;
      }
    }

    milestones.sort((left, right) => {
      const dueCompare = compareDue(left.due, right.due);
      if (dueCompare !== 0) {
        return dueCompare;
      }

      return String(left.name).localeCompare(String(right.name));
    });

    return milestones;
  }
}

module.exports = GoalsDashboardPlugin;
