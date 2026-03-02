function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  }
  return map;
}

let datalistCounter = 0;

function createDatalistId(label) {
  datalistCounter += 1;
  const normalized = String(label ?? "field")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return `goals-datalist-${normalized || "field"}-${datalistCounter}`;
}

function attachSuggestions(fieldEl, inputEl, datalistId, suggestions) {
  const normalizedSuggestions = Array.isArray(suggestions)
    ? suggestions
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
    : [];

  if (normalizedSuggestions.length === 0) {
    return;
  }

  inputEl.setAttribute("list", datalistId);
  const datalist = fieldEl.createEl("datalist");
  datalist.id = datalistId;

  for (const suggestion of normalizedSuggestions) {
    datalist.createEl("option", { value: suggestion });
  }
}

function getUniqueGoalValues(goals, key) {
  const values = [];
  for (const goal of goals) {
    const rawValue = String(goal?.[key] ?? "").trim();
    if (!rawValue) {
      continue;
    }

    if (!values.includes(rawValue)) {
      values.push(rawValue);
    }
  }

  return values.sort((left, right) => left.localeCompare(right));
}

function isSidebarLeaf(workspace, leaf) {
  if (!leaf || typeof leaf.getRoot !== "function") {
    return false;
  }

  const root = leaf.getRoot();
  return root === workspace.leftSplit || root === workspace.rightSplit;
}

function normalizeStatus(status) {
  const normalized = String(status).trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "off-track") {
    return "miss";
  }
  return normalized;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBoard(value) {
  const board = String(value ?? "").trim();
  return board || "Uncategorized";
}

function normalizeKanbanListName(value) {
  const list = String(value ?? "").trim();
  return list || "Today";
}

function normalizeKanbanListOrder(persistedOrder, listsInView) {
  const unique = [];

  for (const list of Array.isArray(persistedOrder) ? persistedOrder : []) {
    const normalized = normalizeKanbanListName(list);
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }

  for (const list of Array.isArray(listsInView) ? listsInView : []) {
    const normalized = normalizeKanbanListName(list);
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }

  if (unique.length === 0) {
    unique.push("Today");
  }

  return unique;
}

function normalizePriority(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function normalizeDateString(value) {
  return String(value ?? "").trim();
}

function parseHoursValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

function normalizeTagList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const normalized = [];
  for (const entry of values) {
    const cleaned = String(entry ?? "")
      .trim()
      .replace(/^#/, "")
      .replace(/\s+/g, "-");
    if (!cleaned || normalized.includes(cleaned)) {
      continue;
    }
    normalized.push(cleaned);
  }

  return normalized;
}

function needsKanbanFrontmatterHydration(frontmatter) {
  const fm = frontmatter || {};
  const requiredKeys = [
    "list",
    "milestone",
    "goal",
    "priority",
    "due",
    "schedule",
    "tags",
    "planHours",
    "hoursLeft",
  ];

  return requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(fm, key));
}

function parseKanbanTodoMetadata(frontmatter) {
  const fm = frontmatter || {};
  const planHours = parseHoursValue(fm.planHours ?? fm.plannedHours);
  const hoursLeft = parseHoursValue(fm.hoursLeft);

  return {
    list: normalizeKanbanListName(fm.list),
    milestone: normalizeMilestone(fm.milestone),
    goal: String(fm.goal ?? "").trim(),
    priority: normalizePriority(fm.priority),
    due: normalizeDateString(fm.due),
    tags: normalizeTagList(fm.tags),
    schedule: String(fm.schedule ?? fm.schdule ?? "").trim(),
    planHours,
    hoursLeft,
  };
}

function formatHoursValue(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function buildTodoMetadataLabels(todo) {
  const labels = [];
  labels.push(`Milestone: ${todo.milestone || "Unscheduled Milestone"}`);

  if (todo.goal) {
    labels.push(`Goal: ${todo.goal}`);
  }

  labels.push(`Priority: ${capitalizeLabel(todo.priority || "medium")}`);

  if (todo.due) {
    labels.push(`Due: ${todo.due}`);
  }

  if (todo.schedule) {
    labels.push(`Schedule: ${todo.schedule}`);
  }

  if (Number.isFinite(todo.hoursLeft) && Number.isFinite(todo.planHours)) {
    labels.push(`Hours Left: ${formatHoursValue(todo.hoursLeft)}/${formatHoursValue(todo.planHours)}h`);
  } else if (Number.isFinite(todo.hoursLeft)) {
    labels.push(`Hours Left: ${formatHoursValue(todo.hoursLeft)}h`);
  } else if (Number.isFinite(todo.planHours)) {
    labels.push(`Plan Hours: ${formatHoursValue(todo.planHours)}h`);
  }

  if (Array.isArray(todo.tags) && todo.tags.length > 0) {
    labels.push(`Tags: ${todo.tags.map((tag) => `#${tag}`).join(" ")}`);
  }

  return labels;
}

function capitalizeLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeMilestone(value) {
  const milestone = String(value ?? "").trim();
  return milestone || "Unscheduled Milestone";
}

function normalizeGoalsFolder(value) {
  return normalizeFolderPath(value, "Goals");
}

function getVaultFolderSuggestions(vault, fallbackValues = []) {
  const suggestions = [];

  const pushUniquePath = (value) => {
    const normalized = normalizeFolderPath(value, "");
    if (!normalized || suggestions.includes(normalized)) {
      return;
    }
    suggestions.push(normalized);
  };

  for (const value of Array.isArray(fallbackValues) ? fallbackValues : []) {
    pushUniquePath(value);
  }

  const abstractFiles =
    vault && typeof vault.getAllLoadedFiles === "function" ? vault.getAllLoadedFiles() : [];

  for (const entry of abstractFiles) {
    if (!entry) {
      continue;
    }

    if (Array.isArray(entry.children)) {
      pushUniquePath(entry.path);
    }

    if (entry.parent) {
      pushUniquePath(entry.parent.path);
    }
  }

  return suggestions.sort((left, right) => left.localeCompare(right));
}

function normalizeFolderPath(value, fallback = "") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized || fallback;
}

async function ensureFolderExists(vault, folderPath) {
  if (!folderPath) {
    return;
  }

  const parts = folderPath.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      await vault.createFolder(current);
    }
  }
}

function sanitizeFileName(name) {
  return String(name)
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

function getUniquePath(vault, folder, baseName) {
  const normalizedFolder = normalizeGoalsFolder(folder);
  let suffix = 0;

  while (true) {
    const fileName = suffix === 0 ? `${baseName}.md` : `${baseName}-${suffix}.md`;
    const candidate = `${normalizedFolder}/${fileName}`;
    if (!vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function buildGoalTemplate(values) {
  const lines = [
    "---",
    "type: goal",
    `board: ${toYamlString(normalizeBoard(values.board))}`,
    `metric: ${toYamlString(values.metric)}`,
    "start: 0",
    "current: 0",
    `target: ${Number(values.target) || 1}`,
    `due: ${toYamlString(values.due)}`,
    "status: on-track",
    'owner: ""',
    'milestone: "Main Milestone"',
    'milestoneDue: ""',
    "milestonePercent: 0",
    "boardArchived: false",
    "---",
    "",
    "## Comments",
    "",
  ];

  return lines.join("\n");
}

function buildKanbanTodoTemplate(payload) {
  const line = String(payload.text ?? "").replace(/\r?\n+/g, " ").trim();
  const milestone = String(payload.milestone ?? "").trim();
  const goal = String(payload.goal ?? "").trim();
  const priority = normalizePriority(payload.priority);
  const due = normalizeDateString(payload.due);
  const schedule = String(payload.schedule ?? "").trim();
  const tags = normalizeTagList(payload.tags);
  const planHours = parseHoursValue(payload.planHours);
  const hoursLeft = parseHoursValue(payload.hoursLeft);

  return [
    "---",
    `list: ${toYamlString(normalizeKanbanListName(payload.list))}`,
    `milestone: ${toYamlString(milestone)}`,
    `goal: ${toYamlString(goal)}`,
    `priority: ${toYamlString(priority)}`,
    `due: ${toYamlString(due)}`,
    `schedule: ${toYamlString(schedule)}`,
    `tags: ${toYamlArray(tags)}`,
    `planHours: ${Number.isFinite(planHours) ? planHours : 0}`,
    `hoursLeft: ${Number.isFinite(hoursLeft) ? hoursLeft : Number.isFinite(planHours) ? planHours : 0}`,
    "---",
    "",
    `- [ ] ${line}`,
    "",
  ].join("\n");
}

function toYamlString(value) {
  const escaped = String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function toYamlArray(values) {
  const entries = Array.isArray(values) ? values : [];
  return `[${entries.map((entry) => toYamlString(entry)).join(", ")}]`;
}

function isGoalArchived(goal) {
  return isTruthy(goal.archived) || isTruthy(goal.boardArchived) || normalizeStatus(goal.status) === "archived";
}

function isBoardArchived(frontmatter) {
  const boardStatus = String(frontmatter.boardStatus ?? "").trim().toLowerCase();
  return isTruthy(frontmatter.boardArchived) || boardStatus === "archived";
}

function isTruthy(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function shouldHideBoard(boardName, boardGoals) {
  if (!boardGoals.length) {
    return true;
  }

  if (String(boardName).trim().toLowerCase() === "archived") {
    return true;
  }

  return false;
}

function getOrderedBoardEntries(groupedBoards, persistedOrder) {
  const boards = Array.from(groupedBoards.keys());
  const normalizedOrder = normalizeBoardOrder(persistedOrder, boards);

  return normalizedOrder
    .map((board) => [board, groupedBoards.get(board)])
    .filter(([, boardGoals]) => Array.isArray(boardGoals) && boardGoals.length > 0);
}

function normalizeBoardOrder(persistedOrder, boardsInView) {
  const uniquePersisted = [];
  for (const board of Array.isArray(persistedOrder) ? persistedOrder : []) {
    const normalized = normalizeBoard(board);
    if (!uniquePersisted.includes(normalized)) {
      uniquePersisted.push(normalized);
    }
  }

  for (const board of boardsInView) {
    const normalized = normalizeBoard(board);
    if (!uniquePersisted.includes(normalized)) {
      uniquePersisted.push(normalized);
    }
  }

  return uniquePersisted.filter((board) => boardsInView.includes(board));
}

function createBoardSummary(container, boardGoals) {
  const { percent, onTrack, atRisk, miss } = summarizeBoard(boardGoals);

  const summary = container.createDiv({ cls: "board-summary" });

  const progressCard = summary.createDiv({ cls: "board-summary-progress" });
  progressCard.createEl("div", {
    cls: "board-summary-progress-label",
    text: `Progress: ${percent}%`,
  });

  const progress = progressCard.createEl("progress", {
    cls: "board-summary-progress-bar",
  });
  progress.max = 100;
  progress.value = percent;

  const statusWrap = summary.createDiv({ cls: "board-summary-status-grid" });
  createBoardStatusCard(statusWrap, "On Track", onTrack, "on-track");
  createBoardStatusCard(statusWrap, "At Risk", atRisk, "at-risk");
  createBoardStatusCard(statusWrap, "Miss", miss, "miss");
}

function createBoardStatusCard(container, label, value, variant) {
  const card = container.createDiv({ cls: `board-summary-status board-summary-status-${variant}` });
  card.createEl("div", {
    cls: "board-summary-status-label",
    text: label,
  });
  card.createEl("div", {
    cls: "board-summary-status-value",
    text: String(value),
  });
}

function summarizeBoard(goals) {
  let sumStart = 0;
  let sumCurrent = 0;
  let sumTarget = 0;
  let fallbackPercentSum = 0;

  let onTrack = 0;
  let atRisk = 0;
  let miss = 0;

  for (const goal of goals) {
    sumStart += Number(goal.start) || 0;
    sumCurrent += Number(goal.current) || 0;
    sumTarget += Number(goal.target) || 0;
    fallbackPercentSum += Number(goal.percent) || 0;

    const statusBucket = getStatusBucket(goal.status);
    if (statusBucket === "on-track") {
      onTrack += 1;
    } else if (statusBucket === "at-risk") {
      atRisk += 1;
    } else {
      miss += 1;
    }
  }

  const denominator = sumTarget - sumStart;
  let percent = 0;
  if (denominator > 0) {
    percent = Math.round(clamp(((sumCurrent - sumStart) / denominator) * 100, 0, 100));
  } else if (goals.length > 0) {
    percent = Math.round(clamp(fallbackPercentSum / goals.length, 0, 100));
  }

  return { percent, onTrack, atRisk, miss };
}

function getStatusBucket(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "on-track") {
    return "on-track";
  }

  if (normalized === "at-risk") {
    return "at-risk";
  }

  return "miss";
}

function extractTodoItems(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const todos = [];

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    todos.push({
      done: String(match[1]).toLowerCase() === "x",
      text: String(match[2] ?? "").trim(),
    });
  }

  return todos;
}

function parseSingleTodoFile(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  for (const line of lines) {
    const todoMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (!todoMatch) {
      continue;
    }

    return {
      done: String(todoMatch[1]).toLowerCase() === "x",
      text: String(todoMatch[2] ?? "").trim(),
    };
  }

  return null;
}

function compareDue(leftDue, rightDue) {
  const left = String(leftDue ?? "").trim();
  const right = String(rightDue ?? "").trim();

  if (left && right) {
    return left.localeCompare(right);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

function normalizeHomeListTemplate(value, fallback) {
  const raw = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (raw) {
    return raw;
  }

  return String(fallback ?? "").replace(/\r\n/g, "\n").trim();
}

function parseHomeListTemplate(value) {
  const lines = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return ["Plan top task"];
  }

  return lines;
}

function normalizeHomeDailyListState(value) {
  const resetKey = String(value?.resetKey ?? "").trim();
  const items = Array.isArray(value?.items)
    ? value.items
      .map((item) => ({
        text: String(item?.text ?? "").trim(),
        done: Boolean(item?.done),
        archived: Boolean(item?.archived),
      }))
      .filter((item) => item.text)
    : [];

  return { resetKey, items };
}

function getHomeListResetKey(date) {
  const now = date instanceof Date ? date : new Date();
  const shifted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mergeHomeDailyItems(currentItems, templateItems) {
  const items = Array.isArray(currentItems) ? currentItems : [];
  const template = Array.isArray(templateItems) ? templateItems : [];
  const result = [];

  for (const templateText of template) {
    const existing = items.find((item) => item.text === templateText);
    if (existing) {
      result.push({
        text: existing.text,
        done: Boolean(existing.done),
        archived: Boolean(existing.archived),
      });
    } else {
      result.push({ text: templateText, done: false, archived: false });
    }
  }

  for (const item of items) {
    if (!template.includes(item.text)) {
      result.push({
        text: item.text,
        done: Boolean(item.done),
        archived: Boolean(item.archived),
      });
    }
  }

  return result;
}

function isSameHomeDailyItems(leftItems, rightItems) {
  const left = Array.isArray(leftItems) ? leftItems : [];
  const right = Array.isArray(rightItems) ? rightItems : [];
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (!rightItem) {
      return false;
    }

    if (
      leftItem.text !== rightItem.text ||
      Boolean(leftItem.done) !== Boolean(rightItem.done) ||
      Boolean(leftItem.archived) !== Boolean(rightItem.archived)
    ) {
      return false;
    }
  }

  return true;
}

function toBase64(value) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(String(value ?? ""), "utf8").toString("base64");
  }

  if (typeof btoa === "function") {
    return btoa(String(value ?? ""));
  }

  throw new Error("base64-not-supported");
}

function createEventUid() {
  const random = Math.random().toString(36).slice(2, 10);
  return `northstar-${Date.now()}-${random}`;
}

function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function formatIcsUtcDateTime(date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function formatIcsDateOnly(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseLocalDateTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseLocalDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizeEventTimes(payload) {
  const allDay = Boolean(payload?.allDay);
  if (allDay) {
    const startDate = parseLocalDate(payload?.start);
    if (!startDate) {
      throw new Error("invalid-calendar-start");
    }

    const rawEndDate = parseLocalDate(payload?.end);
    const endDate = rawEndDate && rawEndDate >= startDate ? rawEndDate : startDate;
    const exclusiveEnd = new Date(endDate);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);

    return {
      allDay: true,
      start: startDate,
      end: exclusiveEnd,
    };
  }

  const start = parseLocalDateTime(payload?.start);
  if (!start) {
    throw new Error("invalid-calendar-start");
  }

  const rawEnd = parseLocalDateTime(payload?.end);
  const end = rawEnd && rawEnd > start ? rawEnd : new Date(start.getTime() + 60 * 60 * 1000);

  return {
    allDay: false,
    start,
    end,
  };
}

function buildIcsEvent(payload) {
  const title = String(payload?.title ?? "").trim();
  if (!title) {
    throw new Error("missing-calendar-title");
  }

  const description = String(payload?.description ?? "").trim();
  const uid = String(payload?.uid ?? "").trim() || createEventUid();
  const when = normalizeEventTimes(payload);
  const now = new Date();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Northstar Forge//iCloud CalDAV//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@northstar.local`,
    `DTSTAMP:${formatIcsUtcDateTime(now)}`,
    `SUMMARY:${escapeIcsText(title)}`,
  ];

  if (when.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(when.start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(when.end)}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtcDateTime(when.start)}`);
    lines.push(`DTEND:${formatIcsUtcDateTime(when.end)}`);
  }

  if (description) {
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

async function discoverCaldavCalendarUrl(baseUrl, authHeaders) {
  const normalizedBase = normalizeHttpUrl(baseUrl);
  const principalUrl = await fetchCurrentUserPrincipalUrl(normalizedBase, authHeaders);
  if (!principalUrl) {
    return "";
  }

  const calendarHomeUrl = await fetchCalendarHomeSetUrl(principalUrl, authHeaders);
  if (!calendarHomeUrl) {
    return "";
  }

  const calendars = await listCalendarCollectionUrls(calendarHomeUrl, authHeaders);
  if (calendars.length === 0) {
    return "";
  }

  return calendars[0];
}

function normalizeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const url = new URL(raw);
  return url.toString().replace(/\/+$/, "");
}

async function fetchCurrentUserPrincipalUrl(baseUrl, authHeaders) {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal /></d:prop></d:propfind>';

  const response = await requestDavXml({
    url: baseUrl,
    method: "PROPFIND",
    headers: {
      ...authHeaders,
      Depth: "0",
    },
    body,
  });

  const href = readFirstPropHref(response, "current-user-principal");
  if (!href) {
    return "";
  }

  return resolveDavHref(baseUrl, href);
}

async function fetchCalendarHomeSetUrl(principalUrl, authHeaders) {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set /></d:prop></d:propfind>';

  const response = await requestDavXml({
    url: principalUrl,
    method: "PROPFIND",
    headers: {
      ...authHeaders,
      Depth: "0",
    },
    body,
  });

  const href = readFirstPropHref(response, "calendar-home-set");
  if (!href) {
    return "";
  }

  return resolveDavHref(principalUrl, href);
}

async function listCalendarCollectionUrls(calendarHomeUrl, authHeaders) {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    "<d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>";

  const response = await requestDavXml({
    url: calendarHomeUrl,
    method: "PROPFIND",
    headers: {
      ...authHeaders,
      Depth: "1",
    },
    body,
  });

  const rows = parseDavResourceRows(response);
  return rows
    .filter((row) => row.isCalendar)
    .map((row) => resolveDavHref(calendarHomeUrl, row.href))
    .filter((url) => !/\/(inbox|outbox)\/?$/i.test(url));
}

async function requestDavXml(options) {
  try {
    const response = await requestUrl({
      ...options,
      headers: {
        "Content-Type": 'application/xml; charset="utf-8"',
        ...options.headers,
      },
    });

    return String(response?.text ?? "");
  } catch (error) {
    const status = Number(error?.status ?? 0);
    if (status === 401 || status === 403) {
      throw new Error("caldav-auth-failed");
    }

    if (status >= 400) {
      throw new Error(`caldav-discovery-failed:${status}`);
    }

    throw error;
  }
}

function parseDavXml(xmlText) {
  const parser = new DOMParser();
  return parser.parseFromString(String(xmlText ?? ""), "application/xml");
}

function readFirstPropHref(xmlText, propertyName) {
  const xml = parseDavXml(xmlText);
  const props = getElementsByLocalName(xml, propertyName);
  for (const prop of props) {
    const href = getElementsByLocalName(prop, "href")[0];
    const value = String(href?.textContent ?? "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function parseDavResourceRows(xmlText) {
  const xml = parseDavXml(xmlText);
  const rows = [];
  const responses = getElementsByLocalName(xml, "response");
  for (const response of responses) {
    const hrefNode = getElementsByLocalName(response, "href")[0];
    const href = String(hrefNode?.textContent ?? "").trim();
    if (!href) {
      continue;
    }

    const isCalendar = getElementsByLocalName(response, "calendar").length > 0;
    const displaynameNode = getElementsByLocalName(response, "displayname")[0];
    const displayname = String(displaynameNode?.textContent ?? "").trim();
    rows.push({ href, displayname, isCalendar });
  }

  return rows;
}

function getElementsByLocalName(node, localName) {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

function resolveDavHref(baseUrl, href) {
  return new URL(String(href ?? "").trim(), baseUrl).toString().replace(/\/+$/, "");
}

function roundUpToHalfHour(date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minute = rounded.getMinutes();
  if (minute === 0 || minute === 30) {
    return rounded;
  }

  const next = minute < 30 ? 30 : 60;
  rounded.setMinutes(next);
  return rounded;
}

function formatDateLocalValue(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTimeLocalValue(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function extractUpcomingCalendarEvents(icsText, now) {
  const unfoldedLines = unfoldIcsLines(icsText);
  const events = [];
  let currentEvent = null;

  for (const line of unfoldedLines) {
    if (line === "BEGIN:VEVENT") {
      currentEvent = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (currentEvent) {
        const parsed = parseCalendarEvent(currentEvent);
        if (parsed) {
          events.push(parsed);
        }
      }
      currentEvent = null;
      continue;
    }

    if (!currentEvent) {
      continue;
    }

    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) {
      continue;
    }

    const key = rawKey.split(";")[0].toUpperCase();
    const value = rest.join(":");
    currentEvent[key] = value;
  }

  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  return events
    .filter((event) => event.start >= startDate && event.start < endDate)
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

function unfoldIcsLines(content) {
  const lines = String(content ?? "").split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseCalendarEvent(rawEvent) {
  const summary = String(rawEvent.SUMMARY ?? "Untitled").trim() || "Untitled";
  const start = parseIcsDate(rawEvent.DTSTART);
  if (!start) {
    return null;
  }

  return {
    summary,
    start: start.date,
    allDay: start.allDay,
  };
}

function parseIcsDate(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return null;
  }

  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return {
      date: new Date(year, month - 1, day, 0, 0, 0),
      allDay: true,
    };
  }

  const match = value.match(/^(\d{8})T(\d{6})(Z?)$/);
  if (!match) {
    return null;
  }

  const datePart = match[1];
  const timePart = match[2];
  const isUtc = Boolean(match[3]);

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));

  return {
    date: isUtc
      ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
      : new Date(year, month - 1, day, hour, minute, second),
    allDay: false,
  };
}

function groupCalendarEventsByDate(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = formatDateHeading(event.start);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(event);
  }
  return grouped;
}

function formatDateHeading(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatClockTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

module.exports = {
  groupBy,
  createDatalistId,
  attachSuggestions,
  getUniqueGoalValues,
  isSidebarLeaf,
  normalizeStatus,
  clamp,
  normalizeBoard,
  normalizeKanbanListName,
  normalizeKanbanListOrder,
  normalizePriority,
  normalizeDateString,
  parseHoursValue,
  normalizeTagList,
  needsKanbanFrontmatterHydration,
  parseKanbanTodoMetadata,
  formatHoursValue,
  buildTodoMetadataLabels,
  capitalizeLabel,
  normalizeMilestone,
  normalizeGoalsFolder,
  getVaultFolderSuggestions,
  normalizeFolderPath,
  sanitizeFileName,
  getUniquePath,
  buildGoalTemplate,
  buildKanbanTodoTemplate,
  toYamlString,
  toYamlArray,
  isGoalArchived,
  isBoardArchived,
  isTruthy,
  shouldHideBoard,
  getOrderedBoardEntries,
  normalizeBoardOrder,
  createBoardSummary,
  createBoardStatusCard,
  summarizeBoard,
  getStatusBucket,
  extractTodoItems,
  parseSingleTodoFile,
  compareDue,
  normalizeHomeListTemplate,
  parseHomeListTemplate,
  normalizeHomeDailyListState,
  getHomeListResetKey,
  mergeHomeDailyItems,
  isSameHomeDailyItems,
  toBase64,
  createEventUid,
  escapeIcsText,
  formatIcsUtcDateTime,
  formatIcsDateOnly,
  parseLocalDateTime,
  parseLocalDate,
  normalizeEventTimes,
  buildIcsEvent,
  normalizeHttpUrl,
  parseDavXml,
  readFirstPropHref,
  parseDavResourceRows,
  getElementsByLocalName,
  resolveDavHref,
  roundUpToHalfHour,
  formatDateLocalValue,
  formatDateTimeLocalValue,
  extractUpcomingCalendarEvents,
  unfoldIcsLines,
  parseCalendarEvent,
  parseIcsDate,
  groupCalendarEventsByDate,
  formatDateHeading,
  formatClockTime,
};
