import type { MessageFolder } from "@wilm-ai/wilma-client";
import { SCHEDULE_WHEN, WilmaAiError, parseIsoDate } from "./agent-data.js";
import { normalizeResourceId } from "./downloads.js";

/*
 * Command line → command, action, arguments and flags. 2.0 commands are short
 * (`wilma schedule tomorrow`, `wilma messages 123`); the 1.x forms (`kids
 * list`, `tenants`, `attendance list`, `messages read 123`, `news resource
 * download 1 2`) keep working.
 */

export interface Flags {
  json?: boolean;
  text?: boolean;
  debug?: boolean;
  help?: boolean;
  version?: boolean;
  student?: string;
  limit?: number;
  days?: number;
  since?: string;
  from?: string;
  to?: string;
  date?: string;
  when?: string;
  weekday?: string;
  folder?: MessageFolder;
  older?: boolean;
  output?: string;
  totpSecret?: string;
}

export interface ParsedCommand {
  /** Canonical command name, or null for none (interactive menu / help). */
  command: string | null;
  /** e.g. "read", "download", "summary", "remove", "clear" — null for the default (list). */
  action: string | null;
  /** Ids and other positional values, already checked. */
  args: string[];
  flags: Flags;
  /** Login and mcp parse their own options. */
  raw: string[];
}

const DATA_COMMANDS = [
  "summary",
  "schedule",
  "homework",
  "exams",
  "grades",
  "gradebook",
  "notes",
  "messages",
  "news",
  "printouts",
  "students",
] as const;
const OTHER_COMMANDS = ["accounts", "find-school", "login", "mcp", "update", "config", "help"] as const;

const ALIASES: Record<string, string> = {
  kids: "students",
  tenants: "find-school",
  attendance: "notes",
  "lesson-notes": "notes",
  absences: "notes",
  exam: "exams",
  message: "messages",
};

const MESSAGE_FOLDERS: MessageFolder[] = ["inbox", "archive", "outbox", "drafts", "appointments"];
const WEEKDAY_WORDS = /^(mon|tue|wed|thu|fri|sat|sun|ma|ti|ke|to|pe|la|su|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

const usage = (message: string) => new WilmaAiError("invalid_argument", `${message} See wilma --help.`);

export function parseCliArgs(argv: string[]): ParsedCommand {
  const flags: Flags = {};
  const positionals: string[] = [];
  const first = argv.find((arg) => !arg.startsWith("-"));
  const firstCommand = first ? (ALIASES[first] ?? first) : null;
  // Login and the MCP server take their own options.
  if (firstCommand === "login" || firstCommand === "mcp") {
    const at = argv.indexOf(first!);
    const raw = argv.slice(at + 1);
    return { command: firstCommand, action: null, args: [], flags: { json: raw.includes("--json") }, raw };
  }

  const value = (i: number): string => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) throw usage(`${argv[i]} needs a value.`);
    return next;
  };
  const positiveInt = (i: number, max: number): number => {
    const raw = value(i);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) throw usage(`${argv[i]} must be a whole number from 1 to ${max} (got "${raw}").`);
    return n;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const v = value(i);
      i += 1;
      return v;
    };
    switch (arg) {
      case "--json":
        flags.json = true;
        break;
      case "--text":
        flags.text = true;
        break;
      case "--debug":
        flags.debug = true;
        break;
      case "--older":
        flags.older = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      case "--version":
      case "-v":
        flags.version = true;
        break;
      case "--all-students":
      case "--all":
        // Every child is the default now; accepted for 1.x commands.
        break;
      case "--student":
        flags.student = take();
        break;
      case "--limit":
        flags.limit = positiveInt(i, 1000);
        i += 1;
        break;
      case "--days":
        flags.days = positiveInt(i, 365);
        i += 1;
        break;
      case "--since":
        flags.since = parseIsoDate(take());
        break;
      case "--from":
        flags.from = parseIsoDate(take());
        break;
      case "--to":
        flags.to = parseIsoDate(take());
        break;
      case "--date":
        flags.date = parseIsoDate(take());
        break;
      case "--when": {
        const when = take();
        if (!(SCHEDULE_WHEN as readonly string[]).includes(when)) throw usage(`--when must be one of ${SCHEDULE_WHEN.join(", ")} (got "${when}").`);
        flags.when = when;
        break;
      }
      case "--weekday":
        flags.weekday = take();
        break;
      case "--folder": {
        const folder = take() as MessageFolder;
        if (!MESSAGE_FOLDERS.includes(folder)) throw usage(`--folder must be one of ${MESSAGE_FOLDERS.join(", ")} (got "${folder}").`);
        flags.folder = folder;
        break;
      }
      case "--output":
        flags.output = take();
        break;
      case "--totp-secret":
        flags.totpSecret = take();
        break;
      default:
        if (arg.startsWith("-")) throw usage(`Unknown option "${arg}".`);
        positionals.push(arg);
    }
  }

  if (flags.json && flags.text) throw usage("Use either --json or --text.");
  if (!positionals.length) return { command: null, action: null, args: [], flags, raw: argv };

  const [name, ...rest] = positionals;
  const command = ALIASES[name] ?? name;
  if (!(DATA_COMMANDS as readonly string[]).includes(command) && !(OTHER_COMMANDS as readonly string[]).includes(command)) {
    throw new WilmaAiError("unknown_command", `Unknown command "${name}". See wilma --help.`);
  }
  // `<command> list` is the 1.x spelling of the default action.
  const args = rest[0] === "list" ? rest.slice(1) : rest;
  const parsed = (action: string | null, values: string[] = []): ParsedCommand => ({ command, action, args: values, flags, raw: argv });
  const noMore = (extra: string[]) => {
    if (extra.length) throw usage(`Unexpected "${extra.join(" ")}" after ${command}.`);
  };

  switch (command) {
    case "schedule": {
      const [period, ...extra] = args;
      noMore(extra);
      if (period) {
        if ((SCHEDULE_WHEN as readonly string[]).includes(period)) flags.when = period;
        else if (WEEKDAY_WORDS.test(period)) flags.weekday = period;
        else if (/^\d{4}-\d{2}-\d{2}$/.test(period) || period === "yesterday") flags.date = parseIsoDate(period);
        else throw usage(`Unknown period "${period}". Use today, tomorrow, week, next-week, a date (YYYY-MM-DD) or a weekday.`);
      }
      return parsed(null);
    }
    case "notes": {
      if (args[0] === "summary") {
        noMore(args.slice(1));
        return parsed("summary");
      }
      noMore(args);
      return parsed(null);
    }
    case "messages": {
      const [first, second, ...extra] = args;
      if (first === "read") {
        noMore(extra);
        return parsed("read", [checkId(second, "message")]);
      }
      if (first !== undefined) {
        noMore([second, ...extra].filter((x) => x !== undefined) as string[]);
        return parsed("read", [checkId(first, "message")]);
      }
      return parsed(null);
    }
    case "news": {
      const [first, second, third, fourth, ...extra] = args;
      if (first === "read") {
        noMore([third, fourth, ...extra].filter((x) => x !== undefined) as string[]);
        return parsed("read", [checkId(second, "news")]);
      }
      if (first === "resource") {
        if (second !== "download") throw usage('Expected "wilma news <id> download <resource>".');
        noMore(extra);
        return parsed("download", [checkId(third, "news"), checkResource(fourth)]);
      }
      if (first !== undefined) {
        const id = checkId(first, "news");
        if (second === undefined) return parsed("read", [id]);
        if (second !== "download") throw usage(`Unexpected "${second}" after news ${first}.`);
        noMore([fourth, ...extra].filter((x) => x !== undefined) as string[]);
        return parsed("download", [id, checkResource(third)]);
      }
      return parsed(null);
    }
    case "printouts": {
      const [first, second, ...extra] = args;
      if (first === "download") {
        noMore(extra);
        return parsed("download", [checkId(second, "printout")]);
      }
      if (first !== undefined) {
        noMore([second, ...extra].filter((x) => x !== undefined) as string[]);
        return parsed("download", [checkId(first, "printout")]);
      }
      return parsed(null);
    }
    case "accounts":
      if (args[0] === "remove") return parsed("remove", args.slice(1));
      noMore(args);
      return parsed(null);
    case "config":
      if (args[0] !== "clear" || args.length > 1) throw usage('Expected "wilma config clear".');
      return parsed("clear");
    case "find-school":
      if (!args.length) throw usage('Expected "wilma find-school <city or school>".');
      return parsed(null, args);
    case "help":
      return parsed(null, args.slice(0, 1).map((topic) => ALIASES[topic] ?? topic));
    default:
      noMore(args);
      return parsed(null);
  }
}

function checkId(raw: string | undefined, entity: string): string {
  if (!raw) throw usage(`Missing ${entity} id.`);
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) throw usage(`Invalid ${entity} id "${raw}". Expected a positive whole number.`);
  return raw;
}

function checkResource(raw: string | undefined): string {
  const id = normalizeResourceId(raw);
  if (!id) throw usage("Missing resource id (e.g. 1, or resource-1 from the bulletin's resources).");
  return id;
}
