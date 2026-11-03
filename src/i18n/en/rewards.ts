import type { rewards as deRewards } from "../de/rewards";

/** F7 · Texte für Punkte und Stufen (RewardsPage), englisch. Eigener Chunk – lädt erst mit der Seite. */
export const rewards = {
  title: "Rewards",
  lead: "You earn points for outings that actually happened.",
  points: (n: number) => (n === 1 ? "1 point" : `${n} points`),
  balanceLabel: "Your points",
  levels: ["Newcomer", "Regular joiner", "Regular", "Organising talent", "Legend"],
  /** V2 Etappe 3o: Stufen als Leiter auf der Punktekarte. */
  levelsLabel: "Levels",
  levelFrom: (points: number) => (points === 0 ? "from the start" : `from ${points}`),
  levelReached: "reached",
  levelCurrent: "your level",
  historyCount: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  milestonesCount: (done: number, all: number) => `${done} of ${all}`,
  partnersStatus: "Examples",
  nextLevel: (points: number, level: string) => (points === 1 ? `1 more point to “${level}”` : `${points} more points to “${level}”`),
  maxLevel: "Top level reached.",
  rulesTitle: "How you earn points",
  rules: [
    { points: 30, title: "Organised a plan", body: "You created a plan that happened and was completed." },
    { points: 10, title: "Were there", body: "You said yes to a completed plan." },
  ],
  rulesFine: "Points are only awarded for plans with at least two people in, once per plan, and for at most three attended and two organised plans per day. They're awarded on the server when a plan is completed.",
  milestonesTitle: "Milestones",
  milestones: {
    firstAttended: "First outing",
    fiveAttended: "Been there five times",
    firstOrganized: "Organised for the first time",
    fiveOrganized: "Organised five plans",
  },
  milestoneDone: "Reached",
  milestoneProgress: (current: number, target: number) => `${current} of ${target}`,
  historyTitle: "History",
  historyEmpty: { title: "No points yet", body: "Complete your first plan together – then it shows up here." },
  reason: { plan_organized: "Organised a plan", plan_attended: "Were there", partner_bonus: "Partner bonus", admin_adjustment: "Correction" },
  showPlan: "View plan",
  partnersTitle: "Partner rewards",
  partnersNotice: {
    title: "No partners yet",
    body: "The rewards below are examples of what offers could look like. They don't exist, and nothing can be redeemed.",
  },
  partnerExamples: [
    { title: "2-for-1 on your second round of bowling", partner: "Example bowling alley", cost: 150 },
    { title: "Free nachos with your cinema ticket", partner: "Example cinema", cost: 100 },
    { title: "10% off the group bill", partner: "Example restaurant", cost: 300 },
  ],
  redeem: "Can't be redeemed",
  cost: (n: number) => (n === 1 ? "1 point" : `${n} points`),
} satisfies typeof deRewards;
