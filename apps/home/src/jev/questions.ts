/*
 * What Jev is asked about each item. Jev answers typed questions with
 * probabilities, not prose: code decides what to do with the answers.
 * Changing any wording or option is a new version (results are cached
 * per version).
 *
 * The decisions classify: triage (every item, a few questions in one call),
 * the tone of a teacher's note, and what an exam mark is and how good. What
 * an item says (the guardian's step, its deadline, the dates) is read by
 * Luna's reading instead (luna/events.ts), not pointed at among lines and
 * dates code found. Choice answers lean to the first option, so the neutral
 * option always comes first.
 */

export type Entry = string | number | boolean | null | Entry[] | { [key: string]: Entry };
export type Question =
  | { type: "choice"; instructions: Entry; criteria: Record<string, Entry> }
  | { type: "score"; instructions: Entry; criteria: Entry[] }
  | { type: "noul"; instructions: Entry; criteria?: { true?: Entry; false?: Entry } };

export const TRIAGE_QS = "wilma-triage@3";

// Option order matters (first-option bias): the neutral catch-all first.
export const KINDS = {
  general: { label: "General", what: "Other general school information" },
  newsletter: { label: "Newsletter", what: "A weekly letter or newsletter covering many topics" },
  practical: { label: "Practical", what: "Practical matters: clothing, equipment, meals, forms, permissions, payments, things to bring" },
  schoolwork: { label: "Schoolwork", what: "Exams, tests, homework, projects or study tasks" },
  schedule: { label: "Schedule change", what: "A change to the school day: a different start or end time, cancelled lessons, days off" },
  event: { label: "Event", what: "An event, trip, excursion, party, performance or parents' evening on a set date", not_for: "Exams and tests" },
  feedback: { label: "Feedback", what: "Feedback about this pupil's work, behaviour, effort or progress" },
  wellbeing: { label: "Wellbeing", what: "Health, absences, wellbeing, safety or support for the pupil" },
} as const;
export type Kind = keyof typeof KINDS;

export const SCOPES = {
  school: { label: "School", what: "Sent by the school to all its families or to a whole grade" },
  group: { label: "Class", what: "Sent to the pupil's own class, group or course, usually by its teacher" },
  pupil: { label: "About your child", what: "Written to this pupil's guardians about this pupil" },
  wider: { label: "City or association", what: "From the city, a service, a project or an association, to many schools or families" },
} as const;
export type Scope = keyof typeof SCOPES;

export const triageQuestions: Record<string, Question> = {
  needs_action: {
    type: "noul",
    instructions: "The guardian must do something because of this.",
    criteria: {
      true: "A required step for the guardian: reply, give or refuse permission, sign, fill in a form, register, choose, pay, book a time, or check or bring something for the pupil.",
      false: "Information only, or an optional invitation, event, meeting, offer or survey the guardian may join if they want.",
    },
  },
  kind: {
    type: "choice",
    instructions: "What is this school communication mainly about?",
    criteria: Object.fromEntries(
      Object.entries(KINDS).map(([key, kind]): [string, Entry] => [key, "not_for" in kind ? { what: kind.what, not_for: kind.not_for } : { what: kind.what }])
    ),
  },
  scope: {
    type: "choice",
    instructions: "Who is this written to?",
    criteria: Object.fromEntries(Object.entries(SCOPES).map(([key, scope]): [string, Entry] => [key, { what: scope.what }])),
  },
  praise: {
    type: "noul",
    instructions: "It praises the pupil or thanks them for their work, effort or behaviour.",
  },
};

/*
 * A student's own login (viewer "student"): the same sorting, asked of the pupil who reads it. A guardian's step
 * isn't theirs; a step for the pupil is. Its own version, so a parent's cached answers stay as they are.
 */
export const TRIAGE_PUPIL_QS = "wilma-triage-pupil@1";

export const PUPIL_SCOPES = { ...SCOPES, pupil: { label: "To you", what: "Written to this pupil, about them" } } as const;

export const triagePupilQuestions: Record<string, Question> = {
  ...triageQuestions,
  needs_action: {
    type: "noul",
    instructions: "The pupil reading this must do something themself because of this.",
    criteria: {
      true: "A required step for this pupil: do or hand in a task, prepare for an exam or a lesson, bring or return something, reply, sign up or register, or take part in something on a set date.",
      false: "Information only, a step only a guardian takes (permission, a guardians' form, a payment, booking a meeting, explaining an absence), a step for other classes or grades, or an optional invitation, event, offer or survey.",
    },
  },
  scope: {
    type: "choice",
    instructions: "Who is this written to?",
    criteria: Object.fromEntries(Object.entries(PUPIL_SCOPES).map(([key, scope]): [string, Entry] => [key, { what: scope.what }])),
  },
};

export const TONE_QS = "wilma-note-tone@1";

export const toneQuestions: Record<string, Question> = {
  tone: {
    type: "choice",
    instructions: "How does this teacher's note about the pupil read to a parent?",
    criteria: {
      praise: { what: "Praise or positive feedback" },
      neutral: { what: "A neutral record or instruction: an absence and its reason (ill, a health visit), what is coming (an exam and its topics), or work or an exam to do later" },
      concern: { what: "A concern: a task the pupil left undone, something forgotten, behaviour or another problem" },
    },
  },
};

export const TONE_PUPIL_QS = "wilma-note-tone-pupil@1";

export const tonePupilQuestions: Record<string, Question> = {
  tone: { ...toneQuestions.tone, instructions: "How does this teacher's note read to the pupil it is about?" } as Question,
};

/*
 * A note's type as the school named it ("Hyvä!", "Jaksoit työskennellä pitkäjänteisesti ja sinnikkäästi",
 * "Ennalta anottu vapaa"): what kind it is, asked once per label. Without AI, words decide (data/notes.ts).
 * An unexplained absence stays a code rule: it's Wilma's own state, and it makes a task.
 */
export const NOTE_LABEL_QS = "wilma-note-label@3";

export const noteLabelQuestions: Record<string, Question> = {
  // Praise on its own (a yes or no reads it better than one option among many): "Autoit muita oppilaita".
  praise: {
    type: "noul",
    instructions: "This type of lesson note tells the pupil something good they did.",
    criteria: {
      true: "Praise or encouragement: good work, effort, persistence, taking responsibility, helping or considering others.",
      false: "Information, an absence, being late, something forgotten or not done, or a remark about behaviour.",
    },
  },
  note_kind: {
    type: "choice",
    instructions: "A school names the types of notes its teachers mark on a lesson in Wilma. What kind of note is this type?",
    criteria: {
      other: { what: "Something else: information for the pupil or family, a neutral record, studying elsewhere, other school work, praise" },
      absence: { what: "An absence: illness, a leave asked for beforehand, another explained absence" },
      late: { what: "Arriving late to the lesson" },
      forgot: { what: "Something not done or not brought: homework, a task, books, materials or equipment" },
      remark: { what: "A remark about behaviour or effort: disturbing the lesson, using a phone, breaking a rule, not concentrating" },
    },
  },
};

/**
 * A homework text, once per text: whether it gives the whole class something to do, and which of its sentences are
 * only for pupils who missed the lesson (folded away for a child who was there). Without AI, its words decide
 * (data/homework.ts).
 */
export const HOMEWORK_QS = "wilma-homework@1";

export function homeworkQuestions(sentences: number): Record<string, Question> {
  const questions: Record<string, Question> = {
    for_class: {
      type: "noul",
      instructions: "This is homework a teacher wrote in Wilma after a lesson. Does it give the whole class something to do or prepare before a coming lesson?",
      criteria: {
        true: "Homework, reading, a task to finish, revising for a test, or something to bring; also when it has instructions for pupils who were away as well.",
        false: "It says there's no homework, only tells what was done in the lesson, or gives work only to pupils who missed the lesson.",
      },
    },
  };
  for (let i = 1; i <= sentences; i += 1)
    questions[`away_${i}`] = {
      type: "noul",
      instructions: `Sentence ${i} of the homework: is it meant only for pupils who missed the lesson (were away or ill), not for the whole class?`,
      criteria: {
        true: "Only for pupils who missed the lesson, or a heading for their instructions.",
        false: "For the whole class, or about something else, such as missing a test.",
      },
    };
  return questions;
}

export const MARK_QS = "wilma-exam-mark@4";

/** What a Finnish parent knows about how schools mark, for reading a mark the note doesn't explain. The note wins when it says otherwise. */
const FINNISH_MARKS =
  "In Finnish schools, unless the note says otherwise: school grades run from 4 (failed) to 10 (best), with + and - a quarter up or down and ½ half a grade up. " +
  "Letter marks are T–H–K: K = kiitettävä (excellent, the best), H = hyvä (good), T = tyydyttävä (satisfactory); (-) or - after a letter is a little lower, (+) or + a little higher. " +
  "On a pass/fail scale, S = suoritettu or hyväksytty (passed) and H = hylätty (failed). " +
  "Points are out of the maximum the mark or the note gives.";

/** How good a result is, best first after the neutral option; the share of the best each level stands for. */
export const MARK_LEVELS: Record<string, { what: string; share: number }> = {
  best: { what: "The best possible, or all but perfect", share: 1 },
  very_good: { what: "Very good", share: 0.85 },
  good: { what: "Good", share: 0.7 },
  fair: { what: "Fair, satisfactory", share: 0.55 },
  weak: { what: "Weak, only just passed", share: 0.4 },
  failed: { what: "Failed", share: 0.15 },
};

/**
 * One exam's mark, as Wilma's exam list gives it (the "Arvosana" column),
 * with the exam's name and the teacher's note. Schools write all sorts here:
 * school grades, points, other scales, letters, "poissa". The decisions say
 * what the mark is and how good it is on its own scale; the maximum of
 * points or a scale is read from the text (luna/marks.ts), so code never
 * guesses from the wording.
 */
export function markQuestions(): Record<string, Question> {
  return {
    kind: {
      type: "choice",
      instructions: { question: "What is this exam mark? Read the mark together with the exam's name and the teacher's note.", background: FINNISH_MARKS },
      criteria: {
        unclear: "Can't tell from what is written",
        school_grade: { what: "A Finnish school grade on the 4–10 scale, such as 9, 8+, 9-, 9½ or 7,5", not_for: "Points, or a number on another scale the note names" },
        points: { what: "Points from a test or task, out of a maximum the mark or the note gives, such as 24 of 25", not_for: "A school grade" },
        other_scale: { what: "A number on another scale the teacher names, such as 4 on a scale of 1–5" },
        letter: { what: "A letter or word grade, such as K, H or T (kiitettävä, hyvä, tyydyttävä), or a word like hyvä" },
        pass_fail: { what: "Passed or failed only, such as S (suoritettu) or H (hylätty)" },
        no_result: { what: "Not a result: the pupil was absent (poissa), or the work is missing or not done" },
      },
    },
    level: {
      type: "choice",
      instructions: {
        question: "How good is this result on its own scale, from the best possible down to failed?",
        judge_on: "The mark's own scale, not the 4–10 school scale: 4 on a scale of 1–5 is very good, 18 of 20 points is very good, K is the best letter.",
        background: FINNISH_MARKS,
      },
      criteria: { unclear: "Can't tell", ...Object.fromEntries(Object.entries(MARK_LEVELS).map(([key, level]): [string, Entry] => [key, level.what])) },
    },
  };
}
