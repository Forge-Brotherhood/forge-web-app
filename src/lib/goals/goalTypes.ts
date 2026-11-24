import { z } from "zod";

/** The words a goal is described in, shared by the chat request, the goal tools and the goal cards. */
export const GOAL_SHAPES = ["finish", "practice", "learn", "grow"] as const;
export type GoalShape = (typeof GOAL_SHAPES)[number];

export const GOAL_CATEGORIES = ["reading", "prayer", "community", "growth", "other"] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export const GOAL_RHYTHMS = ["daily", "few_per_week", "weekly"] as const;
export type GoalRhythm = (typeof GOAL_RHYTHMS)[number];

/** At most this many goals are active at once. The app enforces it; the server refuses a fourth. */
export const MAX_ACTIVE_GOALS = 3;

/** A reading goal's pace: whole chapters a day. The device works out the end date from it when none is given. */
export const MAX_CHAPTERS_PER_DAY = 20;
export const chaptersPerDaySchema = z.number().int().min(1).max(MAX_CHAPTERS_PER_DAY);
