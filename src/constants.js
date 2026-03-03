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
  homeMetricDefinitions: [
    {
      id: "learning-hours",
      label: "学习时间",
      aliases: ["learningHours", "学习时间"],
      kind: "number",
    },
    {
      id: "exercise-done",
      label: "锻炼情况",
      aliases: ["exerciseDone", "锻炼情况"],
      kind: "binary",
    },
    {
      id: "sleep-hours",
      label: "睡眠时间",
      aliases: ["sleepHours", "睡眠时间"],
      kind: "number",
    },
    {
      id: "masturbation",
      label: "撸管",
      aliases: ["masturbation", "撸管"],
      kind: "binary",
    },
  ],
  homeDailyListState: {
    resetKey: "",
    items: [],
  },
  homeCalendarTasksByDate: {},
  goalsFolder: "Goals",
  kanbanFolder: "Kanban",
  boardOrder: [],
  milestoneOrder: [],
  milestoneRanges: {},
  milestoneArchived: [],
  kanbanListOrder: ["Today"],
  kanbanArchivedLists: [],
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
