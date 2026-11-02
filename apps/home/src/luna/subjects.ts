/*
 * What the family's school subjects are, as the AI reads each name once (Luna's Decisions) after the messages are
 * read, kept with the family's settings on this computer:
 *  - in the timetables: which subjects are PE, the day the gym kit goes along (LocalState.pe), and which the child
 *    packs for, the Bring line in Homework, not lunch, a break or a class teacher's moment (LocalState.bring);
 *  - in the grade books: whether a subject is academic, another subject, or behaviour (LocalState.gradeKinds), for
 *    the averages in Grades.
 * Without the AI the names' usual words are used (data/schedule.ts, data/grades.ts); the parent's own word, set at a
 * lesson or a report-card subject, wins over both.
 */
import { accountScope, getState, setState } from "../data/store";
import { intelligenceOn, type GradeKind } from "../data/model";
import { knownLessons } from "../data/schedule";
import { subjectsOf } from "../data/grades";
import { providerIdentity } from "../ai/config";
import { decide, type DecisionQuestion } from "./client";

/** The questions' versions: a change here asks again. */
const PE_SUBJECTS = "pe-subjects@1";
const BRING_SUBJECTS = "bring-subjects@1";
const GRADE_SUBJECTS = "grade-subjects@1";
/** Questions asked in one call. */
const PER_CALL = 30;

/** The timetables' subject names: the questions only about the subject names not yet read by this AI. */
function timetableQuestions(name: string, k: number, peBy: string, bringBy: string): DecisionQuestion[] {
  const { pe, bring } = getState().local;
  const out: DecisionQuestion[] = [];
  if (pe?.[name]?.by !== peBy)
    out.push({
      type: "predicate",
      name: `pe_${k}`,
      instructions: `Is the subject "${name}" physical education: a lesson of sport or exercise (gym, swimming, outdoor sports) for which pupils bring their sports clothes?`,
    });
  if (bring?.[name]?.by !== bringBy)
    out.push({
      type: "predicate",
      name: `bring_${k}`,
      instructions: `Is "${name}" a lesson of a school subject that pupils pack for (its books, notebooks, materials or sports kit)? No for lunch, a break, an assembly, the class teacher's short moment with the class, a club, or remedial teaching.`,
    });
  return out;
}

const KINDS: { value: GradeKind; description: string }[] = [
  // The neutral answer first: a refusal or a doubt reads as another subject.
  { value: "other", description: "Another school subject: arts and skills (visual arts, music, crafts, PE, home economics), an elective, student guidance" },
  {
    value: "academic",
    description: "An academic subject (lukuaine): mother tongue and literature, another language, mathematics, a science (environmental studies, biology, geography, physics, chemistry), history, civics, religion or ethics, health education",
  },
  { value: "conduct", description: "Not a subject: behaviour, or work habits" },
];

let running: Promise<void> | null = null;
let again = false;

/**
 * Ask about the subjects not read yet by this AI, in the timetables and the grade books (a failure is asked again on
 * the next run). One run at a time: a call during a run runs it once more after it, for a grade book read meanwhile.
 */
export function runSubjects(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await askSubjects();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

async function askSubjects(): Promise<void> {
  const { settings, snapshot } = getState();
  if (!intelligenceOn(settings) || !snapshot) return;
  const ai = providerIdentity(settings);
  const peBy = `${PE_SUBJECTS} ${ai}`;
  const bringBy = `${BRING_SUBJECTS} ${ai}`;
  const gradeBy = `${GRADE_SUBJECTS} ${ai}`;
  const perChild = snapshot.children.map((c) => snapshot.perChild[c.number]);
  const lessons = [...new Set(perChild.flatMap((d) => knownLessons(d).map((l) => l.subject)))].filter(Boolean);
  const graded = [...new Set(perChild.flatMap((d) => subjectsOf(d?.gradebook?.entries ?? []).map((s) => s.name)))].filter(Boolean);
  const kinds = getState().local.gradeKinds;
  const asks = [
    ...lessons.map((name, k) => ({ name, questions: timetableQuestions(name, k, peBy, bringBy) })),
    ...graded
      .filter((name) => kinds?.[name]?.by !== gradeBy)
      .map((name, k): { name: string; questions: DecisionQuestion[] } => ({
        name,
        questions: [{ type: "choice", name: `kind_${k}`, instructions: `What is "${name}" on a Finnish school's report card?`, choices: KINDS }],
      })),
  ].filter((a) => a.questions.length);
  const scope = accountScope();
  for (let i = 0; i < asks.length; ) {
    // Whole subjects to a call, up to PER_CALL questions.
    const batch: typeof asks = [];
    for (let n = 0; i < asks.length && (!batch.length || n + asks[i].questions.length <= PER_CALL); i += 1) {
      n += asks[i].questions.length;
      batch.push(asks[i]);
    }
    let answers: Awaited<ReturnType<typeof decide>>;
    try {
      answers = await decide(
        `Subjects at a Finnish school (Wilma), as the school names them in the timetable or on the report card; the school may teach in Finnish or Swedish.\n${[...new Set(batch.map((a) => a.name))].map((name) => `- ${name}`).join("\n")}`,
        batch.flatMap((a) => a.questions)
      );
    } catch {
      return;
    }
    if (scope !== accountScope() || providerIdentity(getState().settings) !== ai) return;
    setState((s) => {
      const pe = { ...s.local.pe };
      const bring = { ...s.local.bring };
      const gradeKinds = { ...s.local.gradeKinds };
      for (const { name, questions } of batch)
        for (const q of questions) {
          const a = answers[q.name];
          if (a?.type === "predicate" && q.name.startsWith("pe_")) pe[name] = { ...pe[name], ai: a.probability, by: peBy };
          if (a?.type === "predicate" && q.name.startsWith("bring_")) bring[name] = { ...bring[name], ai: a.probability, by: bringBy };
          if (a?.type === "choice" && KINDS.some((k) => k.value === a.choice)) gradeKinds[name] = { ...gradeKinds[name], ai: a.choice as GradeKind, by: gradeBy };
        }
      return { local: { ...s.local, pe, bring, gradeKinds } };
    });
  }
}
