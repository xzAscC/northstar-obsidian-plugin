const fs = require("fs");
const path = require("path");
const Module = require("module");
const obsidian = require("obsidian");
const { Plugin, requestUrl } = obsidian;

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
  normalizeHomeDailyListState,
  normalizeHomeListTemplate,
  normalizeKanbanListName,
  normalizeKanbanListOrder,
  normalizeMilestone,
  normalizePriority,
  normalizeTagList,
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
    this.settings.homeCalendarIcsUrl = String(this.settings.homeCalendarIcsUrl ?? "").trim();
    this.settings.homeCaldavBaseUrl = String(this.settings.homeCaldavBaseUrl ?? "").trim();
    this.settings.homeCaldavUsername = String(this.settings.homeCaldavUsername ?? "").trim();
    this.settings.homeCaldavPassword = String(this.settings.homeCaldavPassword ?? "");
    this.settings.homeCaldavCalendarUrl = String(this.settings.homeCaldavCalendarUrl ?? "").trim();
    this.settings.homeListTemplate = normalizeHomeListTemplate(
      this.settings.homeListTemplate,
      DEFAULT_SETTINGS.homeListTemplate,
    );
    this.settings.homeDailyListState = normalizeHomeDailyListState(this.settings.homeDailyListState);

    if (!Array.isArray(this.settings.boardOrder)) {
      this.settings.boardOrder = [];
    }

    this.settings.kanbanListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, []);

    this.settings.goalsFolder = normalizeFolderPath(this.settings.goalsFolder, DEFAULT_SETTINGS.goalsFolder);
    this.settings.kanbanFolder = normalizeFolderPath(this.settings.kanbanFolder, DEFAULT_SETTINGS.kanbanFolder);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async ensureHomeDailyListState() {
    const nextResetKey = getHomeListResetKey(new Date());
    const templateItems = parseHomeListTemplate(this.settings.homeListTemplate);
    const state = normalizeHomeDailyListState(this.settings.homeDailyListState);

    if (state.resetKey !== nextResetKey) {
      this.settings.homeDailyListState = {
        resetKey: nextResetKey,
        items: templateItems.map((text) => ({ text, done: false })),
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
    const items = [...ensured.state.items, { text: value, done: false }];
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
        unit: frontmatter.unit ?? "",
        due: frontmatter.due ?? "",
        status: frontmatter.status ?? "on-track",
        milestone: frontmatter.milestone ?? frontmatter.task ?? "",
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
      due: String(payload.due ?? "").trim(),
      target: targetValue,
    });

    return this.app.vault.create(filePath, content);
  }

  async createKanbanTodoFile(payload) {
    const name = String(payload.name ?? "").trim();
    const text = String(payload.text ?? "").trim();
    const list = normalizeKanbanListName(payload.list);
    const milestone = String(payload.milestone ?? "").trim();

    if (!name) {
      throw new Error("missing-todo-name");
    }

    if (!text) {
      throw new Error("missing-todo-text");
    }

    if (!milestone) {
      throw new Error("missing-todo-milestone");
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
    const content = buildKanbanTodoTemplate({
      text,
      list,
      milestone,
      goal: payload.goal,
      priority: payload.priority,
      due: payload.due,
      schedule: payload.schedule,
      tags: payload.tags,
      planHours: payload.planHours,
      hoursLeft: payload.hoursLeft,
    });

    return this.app.vault.create(filePath, content);
  }

  async createKanbanList(name) {
    const listName = normalizeKanbanListName(name);
    const nextListOrder = normalizeKanbanListOrder(this.settings.kanbanListOrder, [listName]);
    const changed = nextListOrder.join("\n") !== this.settings.kanbanListOrder.join("\n");
    if (changed) {
      this.settings.kanbanListOrder = nextListOrder;
      await this.saveSettings();
    }

    return {
      name: listName,
      created: changed,
    };
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
        schedule: metadata.schedule,
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

      return String(left.name).localeCompare(String(right.name));
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

      if (!Object.prototype.hasOwnProperty.call(fm, "schedule")) {
        fm.schedule = String(metadata.schedule ?? "").trim();
      }

      if (!Object.prototype.hasOwnProperty.call(fm, "tags")) {
        fm.tags = normalizeTagList(metadata.tags);
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

  async setKanbanTodoDone(file, done) {
    const raw = await this.app.vault.cachedRead(file);
    const lines = String(raw ?? "").split(/\r?\n/);
    const targetState = done ? "x" : " ";

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*[-*]\s+)\[([ xX])\](\s+.+)$/);
      if (!match) {
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
    if (activeGoals.length === 0) {
      return [];
    }

    const goalsWithTodos = await Promise.all(
      activeGoals.map(async (goal) => {
        const todos = await this.getGoalTodos(goal.file);
        return { ...goal, todos };
      }),
    );

    const grouped = new Map();
    for (const goal of goalsWithTodos) {
      const milestoneName = normalizeMilestone(goal.milestone);
      if (!grouped.has(milestoneName)) {
        grouped.set(milestoneName, {
          name: milestoneName,
          due: String(goal.milestoneDue ?? "").trim(),
          goals: [],
          todos: [],
          todoOpen: 0,
          todoDone: 0,
        });
      }

      const bucket = grouped.get(milestoneName);
      bucket.goals.push(goal);

      if (!bucket.due) {
        bucket.due = String(goal.milestoneDue ?? "").trim();
      }

      for (const todo of goal.todos) {
        bucket.todos.push({
          goalTitle: goal.title,
          goalFile: goal.file,
          text: todo.text,
          done: todo.done,
        });

        if (todo.done) {
          bucket.todoDone += 1;
        } else {
          bucket.todoOpen += 1;
        }
      }
    }

    const milestones = Array.from(grouped.values());
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
