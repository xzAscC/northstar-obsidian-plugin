const VIEW_TYPE_HOME_DASHBOARD = "northstar-home-dashboard-view";
const VIEW_TYPE_GOALS_DASHBOARD = "goals-dashboard-view";
const VIEW_TYPE_MILESTONE_DASHBOARD = "goals-milestone-view";
const VIEW_TYPE_KANBAN_TODO_DASHBOARD = "goals-kanban-todo-view";

const DEFAULT_SETTINGS = {
  openHomepageOnStartup: true,
  homeCalendarDailyRoot: "Daily",
  homeCalendarDailyTemplatePath: "Daily/templates/daily-template.md",
  homeCalendarLookaheadDays: 7,
  homeListTemplate: "Plan top task\nReview calendar\nMove body",
  homeDailyListState: {
    resetKey: "",
    items: [],
  },
  goalsFolder: "Goals",
  kanbanFolder: "Kanban",
  boardOrder: [],
  kanbanListOrder: ["Today"],
};

const NORTHSTAR_FORGE_COMMANDS = [
  "Open Northstar Homepage",
  "Open Northstar Forge",
  "Open Milestone Kanban",
  "Open Kanban Todo",
];

module.exports = {
  VIEW_TYPE_HOME_DASHBOARD,
  VIEW_TYPE_GOALS_DASHBOARD,
  VIEW_TYPE_MILESTONE_DASHBOARD,
  VIEW_TYPE_KANBAN_TODO_DASHBOARD,
  DEFAULT_SETTINGS,
  NORTHSTAR_FORGE_COMMANDS,
};
