import { ENV_VARS } from "./credentials.js";

/*
 * Help for people and agents: `wilma --help` lists the commands, `wilma help
 * <command>` (or `wilma <command> --help`) explains one with examples.
 */

interface CommandHelp {
  usage: string[];
  about: string;
  examples: string[];
  output?: string;
}

const STUDENT = "--student <number|name>";

const COMMAND_HELP: Record<string, CommandHelp> = {
  summary: {
    usage: [`wilma summary [--since <date>] [--days 7] [${STUDENT}]`],
    about:
      "The daily briefing for every child: today's and the next school day's lessons, upcoming exams (with start times when the school gives one), recent homework, lesson notes since the previous school day (teachers' feedback and absences), recent bulletins, and recent and unread messages. Start here.",
    examples: ["wilma summary", "wilma summary --since yesterday", `wilma summary --student Kiia`],
    output:
      "{ generatedAt, students: [{ student, summary: { today, tomorrow, todaySchedule, tomorrowSchedule, upcomingExams, homework, lessonNotes, news, messages, unreadMessages } }] }. --since <date> keeps only what is from that day on (for daily runs); messages carry unread and replyCount.",
  },
  schedule: {
    usage: [`wilma schedule [today|tomorrow|week|next-week|<YYYY-MM-DD>|<weekday>] [${STUDENT}]`],
    about: "Lessons with times, teachers and rooms. Default: this week. 'tomorrow' is the next school day; a weekday (mon…sun, or ma…su) is its next occurrence.",
    examples: ["wilma schedule tomorrow", "wilma schedule next-week", "wilma schedule 2026-10-07", "wilma schedule thu --student Kiia"],
    output: "{ when, date | weekStart+weekEnd, students: [{ student, lessons: [{ date, start, end, subject, teacher, room }] }] }",
  },
  homework: {
    usage: [`wilma homework [--limit 10] [${STUDENT}]`],
    about: "Recent homework by lesson, newest first.",
    examples: ["wilma homework", "wilma homework --limit 30"],
  },
  exams: {
    usage: [`wilma exams [--limit 20] [${STUDENT}]`],
    about: "Upcoming exams with subject, name, topic (what to study), teacher and the start time when the school gives one.",
    examples: ["wilma exams"],
    output: "{ students: [{ student, exams: [{ date, time, subject, name, topic, teacher }] }] }",
  },
  grades: {
    usage: [`wilma grades [--limit 20] [${STUDENT}]`],
    about: "Recent exam grades. For course and report-card grades, see `wilma gradebook`.",
    examples: ["wilma grades"],
  },
  gradebook: {
    usage: [`wilma gradebook [${STUDENT}]`],
    about: "Completed courses and grades (Suoritukset) by subject, including term and school-year (report card) grades, with credits and dates.",
    examples: ["wilma gradebook --student Kiia"],
    output: "{ students: [{ student, gradebook: [{ name, code, grade, credits, date, children: [...] }] }] }",
  },
  notes: {
    usage: [`wilma notes [--date <date> | --days 14 | --from <date> [--to <date>]] [${STUDENT}]`, `wilma notes summary [--from <date>] [--to <date>] [${STUDENT}]`],
    about:
      "Lesson notes (merkinnät) teachers log: absences, lateness, and feedback such as praise or missing books or homework, with the teacher's own words in `note`. One day (default today) or a period. `notes summary` counts them by kind for the school year or a period.",
    examples: ["wilma notes --date yesterday", "wilma notes --days 14", "wilma notes summary"],
    output: "{ date | from+to, students: [{ student, notes: [{ date, start, end, subject, typeLabel, teacher, note }] }] }",
  },
  messages: {
    usage: [`wilma messages [--folder inbox|outbox|appointments|archive|drafts] [--limit 20] [${STUDENT}]`, `wilma messages <id> [${STUDENT}]`],
    about: "Messages, newest first (subject, sender, date, unread, replyCount), or one message with its whole thread of replies.",
    examples: ["wilma messages", "wilma messages --folder appointments", "wilma messages 27164611"],
  },
  news: {
    usage: [`wilma news [--limit 20] [--older] [${STUDENT}]`, `wilma news <id> [${STUDENT}]`, `wilma news <id> download <resource> [--output <directory>] [${STUDENT}]`],
    about:
      "School bulletins (tiedotteet): the newest dated ones and every pinned one (pinned: true); --older adds older bulletins (archived: true). `news <id>` reads one, with its linked resources; `download` fetches a resource (a file, or not_a_file when the link is a web page).",
    examples: ["wilma news", "wilma news 73291", "wilma news 73291 download 1 --output ./attachments"],
  },
  printouts: {
    usage: [`wilma printouts [${STUDENT}]`, `wilma printouts <id> [--output <directory>] [${STUDENT}]`],
    about: "PDF documents the school offers (Tulosteet), such as report cards or absence reports; `printouts <id>` downloads one.",
    examples: ["wilma printouts", "wilma printouts 24719 --output ~/Downloads"],
  },
  students: {
    usage: ["wilma students"],
    about: "The children on the saved logins (number, name, and their Wilma when there are several).",
    examples: ["wilma students"],
  },
  login: {
    usage: ["wilma login [--no-browser]", "wilma login --tenant <url|city> --username <name> [--password-stdin] [--totp-secret <key>]"],
    about:
      "Log in to Wilma. Opens a one-time login page in the browser where the parent picks their school's Wilma; logins are saved on this computer. Families with children on different Wilmas add each one there. Without a browser, pass --tenant and --username with the password on stdin or in WILMA_PASSWORD.",
    examples: ["wilma login"],
  },
  accounts: {
    usage: ["wilma accounts", "wilma accounts remove <number|Wilma name|username>"],
    about: "Saved Wilma logins, numbered (one per Wilma the children use); remove one.",
    examples: ["wilma accounts", "wilma accounts remove 2"],
  },
  "find-school": {
    usage: ["wilma find-school <city or school>"],
    about:
      "Find a Wilma address. Most city schools share their city's Wilma (big cities don't list each school); colleges, private schools and many small municipalities' schools have their own.",
    examples: ["wilma find-school tampere", "wilma find-school kalevan lukio"],
  },
  mcp: {
    usage: ["wilma mcp"],
    about: "Run the MCP server over stdio for Claude, ChatGPT and other assistants (the same data as these commands, as tools).",
    examples: ["npx -y @wilm-ai/wilma-cli@2 mcp"],
  },
  update: { usage: ["wilma update"], about: "Update the CLI with npm.", examples: ["wilma update"] },
  config: { usage: ["wilma config clear"], about: "Delete every saved login and session on this computer.", examples: ["wilma config clear"] },
};

const OVERVIEW: [string, string][] = [
  ["summary", "daily briefing for every child (start here)"],
  ["schedule [when]", "lessons: today, tomorrow, week, next-week, a date or a weekday"],
  ["exams", "upcoming exams with topics and start times"],
  ["homework", "recent homework"],
  ["notes [summary]", "lesson notes: absences and teachers' feedback; summary counts them"],
  ["messages [id]", "messages, or one with its replies"],
  ["news [id [download r]]", "bulletins, one bulletin, or a linked file"],
  ["grades", "recent exam grades"],
  ["gradebook", "course and report-card grades"],
  ["printouts [id]", "PDFs such as report cards"],
  ["students", "the children"],
  ["login", "log in (opens a page in the browser)"],
  ["accounts", "saved logins; accounts remove <n>"],
  ["find-school <query>", "find a Wilma address by city or school"],
  ["mcp", "MCP server for AI assistants"],
  ["update", "update the CLI"],
];

export function generalHelp(): string {
  const width = Math.max(...OVERVIEW.map(([name]) => name.length));
  return [
    "WilmAI: read Finland's Wilma school system (read-only).",
    "",
    "Usage: wilma <command> [options]",
    "",
    ...OVERVIEW.map(([name, about]) => `  ${name.padEnd(width)}  ${about}`),
    "",
    "Every command covers all children; --student <number|name> narrows to one.",
    "Output is JSON when another program reads it (agents, pipes) and text in a terminal;",
    "--json or --text forces either. Dates are YYYY-MM-DD (or today, yesterday, tomorrow);",
    "times in JSON are Finnish time with their offset.",
    "",
    "Errors are JSON too: { status: \"error\", code, message } with exit code 2 for usage",
    "errors, 3 when not logged in, 1 otherwise.",
    "",
    `Without a saved login, set ${ENV_VARS.tenant}, ${ENV_VARS.username} and ${ENV_VARS.password}`,
    `(plus ${ENV_VARS.totpSecret} for two-step verification). The password is never a command-line flag.`,
    "",
    "More: wilma help <command>   ·   wilma --version",
  ].join("\n");
}

export function commandHelp(command: string): string | null {
  const help = COMMAND_HELP[command];
  if (!help) return null;
  return [
    ...help.usage.map((line, i) => `${i === 0 ? "Usage: " : "       "}${line}`),
    "",
    help.about,
    ...(help.output ? ["", `JSON: ${help.output}`] : []),
    "",
    "Examples:",
    ...help.examples.map((example) => `  ${example}`),
  ].join("\n");
}
