/**
 * Words the code looks for around the model: subjects that are heavy, and ways of speaking that
 * a pastor who starts a conversation does not use. Plain patterns, checked the same way each time.
 */

const RELATIVES =
  "dad|mom|father|mother|husband|wife|son|daughter|child|baby|brother|sister|grandmother|grandfather|grandma|grandpa|friend|pastor|parent|spouse|fiance|fiancee";

/** Subjects that are heavy. A beat may not open one; it may only continue one a thread is already on. */
const SENSITIVE_FAMILIES = {
  death: new RegExp(
    `\\b(died|passed away|funeral|burial|grief|griev\\w*|mourn\\w*|bereave\\w*|miscarr\\w*|stillborn|lost (?:my|our|your|his|her|their) (?:${RELATIVES})|death of (?:my|our|your|his|her|their) \\w+|(?:my|our|your|his|her|their) (?:${RELATIVES})'s death)\\b`,
    "i"
  ),
  illness: /\b(cancer|diagnos\w*|terminal|hospice|chemo\w*|hospital\w*)\b/i,
  family: /\b(divorc\w*|separat(?:ed|ion)|infidelity|affair)\b/i,
  abuse: /\b(abus\w*|assault\w*|trauma\w*)\b/i,
  selfHarm: /\b(suicid\w*|self[- ]harm|kill (?:myself|yourself)|end (?:my|your) life|overdos\w*)\b/i,
  sexuality: /\b(porn\w*|lust\w*|sexual\w*|masturbat\w*)\b/i,
  addiction: /\b(addict\w*|alcohol\w*|drunk|drinking|relapse\w*|gambl\w*)\b/i,
  mentalHealth: /\b(depress\w*|anxiety|anxious|panic|therap\w*)\b/i,
  work: /\b(laid off|lost (?:my|your) job|unemploy\w*)\b/i,
} as const;

export type SensitiveFamily = keyof typeof SENSITIVE_FAMILIES;

/** The families that mean the person is in a hard season, so goal activity pauses. */
export const CARE_FAMILIES: readonly SensitiveFamily[] = ["death", "illness", "family", "abuse", "selfHarm", "work"];

export const sensitiveFamilies = (text: string): Set<SensitiveFamily> =>
  new Set((Object.keys(SENSITIVE_FAMILIES) as SensitiveFamily[]).filter((f) => SENSITIVE_FAMILIES[f].test(text)));

/** Guilt, pressure and streak talk. */
export const NUDGE_LANGUAGE =
  /\b(you haven'?t|you have not|you didn'?t|you did not|you missed|you(?:'re| are) (?:falling )?behind|falling behind|fell behind|behind (?:on|schedule)|catch(?:ing)? up|overdue|streaks?|in a row|days? without|slack(?:ing)?|you should(?:'ve| have)?|you need to|you must|don'?t give up|keep it up|stay on track|get back on track|lapsed?|failed to)\b/i;

/** Telling the person what the Guide has seen, which a beat can only know from the brief. */
export const OBSERVATION_CLAIM =
  /\b(i noticed|i(?:'ve| have) noticed|i saw|i can see|i see that|it (?:looks|seems|sounds) like you|looks like you|you(?:'ve| have) been (?:so |really )?\w+ing)\b/i;

/** Promises the beat cannot keep. A check-in the app really has scheduled is made through schedule_activity. */
export const FALSE_PROMISE =
  /\b(praying for you|i(?:'ll| will) (?:be )?pray\w*|i(?:'ll| will) (?:check|remind|follow|message|text|reach|send))\b/i;

/** Wording about whether something was read. The beat cannot see that, so a reading post never says. */
export const READING_STATE_CLAIM =
  /\b(haven'?t|have not|hasn'?t|didn'?t|did not|not yet|yet to|still need(?:s)? to|already|finished|completed|missed|skipped|nice work|well done|great job|good job)\b|\byou(?:'ve| have) (?:just )?read\b|\byou just read\b|\bdid you (?:finish|read|get to|get through)\b|(?<!\b(?:as|when|while|before|after|once|if|until) )\byou read\b/i;

/** Words that make something sound recent, for when the brief is a few days old. */
export const RECENCY_WORDS =
  /\b(recent(?:ly)?|lately|last (?:time|week|night|visit)|yesterday|earlier (?:today|this week)|the other day|this week|few days ago|since we (?:last )?(?:talked|spoke))\b/i;

export const DASHES = /[—–]/;

const WEEKDAY_STEMS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;

/** Weekdays the user asked not to be reached on ("not on Sundays"), 0 = Sunday. */
export const blockedWeekdays = (wishes: string[]): Set<number> => {
  const days = new Set<number>();
  for (const wish of wishes) {
    for (const m of wish.matchAll(/\b(?:not on|never on|no|skip)\s+(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)days?\b/gi)) {
      days.add(WEEKDAY_STEMS[m[1].toLowerCase().slice(0, 3) as keyof typeof WEEKDAY_STEMS]);
    }
  }
  return days;
};

/** Shown instead of any text when the notification must name nothing. */
export const NEUTRAL_NOTIFICATION_TEXT = "Lumen has something for you";
/** The visible title of every heartbeat push. Fixed: what Apple and Google can read never varies. */
export const NEUTRAL_NOTIFICATION_TITLE = "Lumen";

/** What a goal's thread is already about: the goal, its path and the conversation. Subjects and names outside it are not the Guide's to raise. */
export type GoalText = { title: string; why?: string; path: string[]; thread: { summary?: string; turns: Array<{ content: string }> } };

export const goalCorpus = (goal: GoalText): string =>
  [goal.title, goal.why, ...goal.path, goal.thread.summary, ...goal.thread.turns.map((t) => t.content)].filter(Boolean).join(" . ");

/** Scoring, ranking and counting, which a Grow goal never gets, in a message or on a card. */
export const SCORING_LANGUAGE =
  /\b(scor(?:e|es|ed|ing)|percent(?:age)?|rating|rank(?:ed|ing)?|badges?|achievements?|leaderboard|on track|off track|ahead of|personal best|longest|best ever|days? (?:clean|free|sober)|(?:one|two|three|four|five|six|seven|eight|nine|ten|twice|several|many) (?:days?|weeks?|months?|times|minutes?|hours?))\b/i;

/** A Grow goal has no milestones: nothing about who someone is becoming is ticked off. */
export const MILESTONE_WORD = /\bmilestones?\b/i;

/** A step toward a person is an invitation. These make it an order, a deadline or a report. */
export const ASSIGNMENT_LANGUAGE =
  /\b(have to|make sure|your assignment|homework|task|this week you|by (?:the end of|friday|sunday|tomorrow|tonight)|report back|let me know (?:how|when|if)|hold yourself|required|must)\b/i;
