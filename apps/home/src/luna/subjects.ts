/*
 * Which school subjects are PE, the day the gym kit goes along: the AI reads
 * each subject name in the family's timetables once (Luna's Decisions), after
 * the messages are read, and the answer is kept with the family's settings on
 * this computer (LocalState.pe). Without the AI the name's usual words are
 * used (data/schedule.ts nameSaysPE); the parent's own word, set at a lesson,
 * wins over both.
 */
import { accountScope, getState, setState } from "../data/store";
import { intelligenceOn } from "../data/model";
import { knownLessons } from "../data/schedule";
import { providerIdentity } from "../ai/config";
import { decide } from "./client";

/** The question's version: a change here asks again. */
const PE_SUBJECTS = "pe-subjects@1";
/** Subjects asked in one call. */
const BATCH = 30;

/** Ask about the subjects not read yet by this AI (a failure is asked again on the next run). */
export async function runSubjects(): Promise<void> {
  const { settings, snapshot, local } = getState();
  if (!intelligenceOn(settings) || !snapshot) return;
  const by = `${PE_SUBJECTS} ${providerIdentity(settings)}`;
  const scope = accountScope();
  const subjects = [...new Set(snapshot.children.flatMap((c) => knownLessons(snapshot.perChild[c.number]).map((l) => l.subject)))].filter(Boolean);
  const todo = subjects.filter((name) => local.pe?.[name]?.by !== by);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let answers: Awaited<ReturnType<typeof decide>>;
    try {
      answers = await decide(
        `Subjects in a Finnish school's timetable (Wilma), as the school names them; the school may teach in Finnish or Swedish.\n${batch.map((name) => `- ${name}`).join("\n")}`,
        batch.map((name, k) => ({
          type: "predicate" as const,
          name: `pe_${k}`,
          instructions: `Is the subject "${name}" physical education: a lesson of sport or exercise (gym, swimming, outdoor sports) for which pupils bring their sports clothes?`,
        }))
      );
    } catch {
      return;
    }
    if (scope !== accountScope() || providerIdentity(getState().settings) !== providerIdentity(settings)) return;
    setState((s) => {
      const pe = { ...s.local.pe };
      batch.forEach((name, k) => {
        const a = answers[`pe_${k}`];
        if (a?.type === "predicate") pe[name] = { ...pe[name], ai: a.probability, by };
      });
      return { local: { ...s.local, pe } };
    });
  }
}
