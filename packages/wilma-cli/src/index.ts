#!/usr/bin/env node
import { emitKeypressEvents } from "node:readline";
import { select, input, password } from "@inquirer/prompts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APIError,
  AuthenticationError,
  MfaRequiredError,
  NetworkError,
  WilmaClient,
  listTenants,
  type MessageFolder,
  type MfaCallback,
  type StudentInfo,
  type TenantInfo,
  type WilmaProfile,
} from "@wilm-ai/wilma-client";
import { clearConfig, getConfigPath, loadConfig, obfuscateSecret, revealSecret, saveConfig, type StoredProfile } from "./config.js";
import {
  WilmaAccess,
  WilmaAiError,
  adoptSession,
  flushSessions,
  useSessionStore,
  type FetchedAttachment,
  type StudentRef,
} from "./agent-data.js";
import { createAccess } from "./access.js";
import { parseCliArgs, type ParsedCommand } from "./cli-args.js";
import { commandHelp, generalHelp } from "./cli-help.js";
import { compactText, formatText, messageLine, newsLine } from "./cli-output.js";
import { ENV_VARS, isMfaFailure, mfaCallbackFor, resolveAccounts, saveLogin, verifyLoginSession } from "./credentials.js";
import { createUniqueDownloadFile } from "./downloads.js";
import { openBrowser, startLoginServer } from "./login-server.js";
import { runMcpServer } from "./mcp.js";
import { toAgentJson } from "./output-json.js";
import { clearSessions, fileSessionStore } from "./session-store.js";
import { normalizeTenantUrl, resolveTenant, searchTenants } from "./tenant-search.js";
import { generateTOTP, parseTotpSecret } from "./totp.js";

// Enable keypress events for escape key detection
if (process.stdin.isTTY) {
  emitKeypressEvents(process.stdin);
}

/** How results are printed: JSON for programs (agents, pipes), text for a person at a terminal. */
interface Output {
  json: boolean;
  pretty: boolean;
  /** Print a result: JSON, or the text from `text` (default: the command's formatter). */
  data(result: unknown, text?: () => string): void;
}

function outputMode(argv: string[]): { json: boolean; pretty: boolean } {
  const json = argv.includes("--json") || (!argv.includes("--text") && !process.stdout.isTTY);
  return { json, pretty: json && Boolean(process.stdout.isTTY) };
}

function makeOutput(argv: string[], fallbackText?: (result: unknown) => string): Output {
  const mode = outputMode(argv);
  return {
    ...mode,
    data(result, text) {
      if (mode.json) console.log(toAgentJson(result, mode.pretty));
      else console.log((text ?? (() => (fallbackText ? fallbackText(result) : toAgentJson(result, true))))());
    },
  };
}

const ACTIONS = [
  { value: "summary", name: "Daily summary" },
  { value: "schedule-today", name: "Today's schedule" },
  { value: "schedule-tomorrow", name: "Next school day's schedule" },
  { value: "homework", name: "Recent homework" },
  { value: "exams", name: "Upcoming exams" },
  { value: "grades", name: "Exam grades" },
  { value: "notes", name: "Lesson notes (last 14 days)" },
  { value: "gradebook", name: "Gradebook" },
  { value: "news", name: "List news" },
  { value: "messages", name: "List messages" },
  { value: "exit", name: "Exit" },
];

async function main() {
  const argv = process.argv.slice(2);

  // MCP mode speaks JSON-RPC on stdout: no update checks or notices.
  if (argv[0] === "mcp") {
    await runMcpServer(await readPackageVersion().catch(() => "unknown"));
    return;
  }

  // School data is printed in many places; filter every printed line so a
  // message can't smuggle terminal escape sequences. JSON keeps the data and
  // only escapes it. Prompts write to the terminal directly (and keep their
  // colours); their choices go through compactText.
  const clean = outputMode(argv).json ? jsonSafe : terminalSafe;
  for (const method of ["log", "error"] as const) {
    const print = console[method].bind(console);
    console[method] = (...parts: unknown[]) => print(...parts.map((part) => (typeof part === "string" ? clean(part) : part)));
  }

  // Commands continue the last Wilma session instead of logging in each time.
  useSessionStore(fileSessionStore);

  // Update notices are for people; agents and scripts skip the check.
  const updateCheck = process.stderr.isTTY ? startUpdateCheck() : null;
  try {
    await runCommand(argv);
    if (updateCheck) await showUpdateNotice(updateCheck);
  } finally {
    updateCheck?.cancel();
  }
}

async function runCommand(argv: string[]) {
  const parsed = parseCliArgs(argv);
  const { command, action, args, flags } = parsed;
  const out = makeOutput(argv, (result) => formatText(command ?? "", action, result));

  if (flags.version && !command) {
    console.log(await readPackageVersion());
    return;
  }
  if (command === "help" || flags.help) {
    const topic = command === "help" ? args[0] : command;
    const text = topic ? commandHelp(topic) : generalHelp();
    if (!text) throw new WilmaAiError("unknown_command", `No help for "${topic}". See wilma --help.`);
    console.log(text);
    return;
  }

  switch (command) {
    case null: {
      // The interactive menu needs a person at a terminal; programs get the help.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(generalHelp());
        return;
      }
      await runInteractive(await loadConfig());
      return;
    }
    case "login":
      await handleLogin(parsed.raw, out);
      return;
    case "accounts":
      await handleAccounts(action, args, out);
      return;
    case "find-school":
      await handleFindSchool(args.join(" "), out);
      return;
    case "update":
      await handleUpdate();
      return;
    case "config":
      await clearConfig();
      await clearSessions();
      out.data({ status: "cleared", configPath: getConfigPath() }, () => `Cleared saved logins and sessions (${getConfigPath()}).`);
      return;
    default:
      try {
        await runDataCommand(parsed, out);
      } finally {
        // Also after an error: the session is still good for the next command.
        await flushSessions();
      }
  }
}

/** Data commands: every child by default, the same results as the MCP tools. */
async function runDataCommand(parsed: ParsedCommand, out: Output) {
  const { command, action, args, flags } = parsed;
  const accounts = await resolveAccounts(await loadConfig());
  if (!accounts.length) {
    throw new WilmaAiError(
      "not_logged_in",
      `No saved Wilma login. Run \`wilma login\`, or set ${ENV_VARS.tenant}, ${ENV_VARS.username} and ${ENV_VARS.password}.`
    );
  }
  const access = createAccess(accounts, { debug: flags.debug, totpSecret: flags.totpSecret });
  const student = flags.student;
  switch (command) {
    case "summary":
      return out.data(await access.summary({ student, days: flags.days, since: flags.since }));
    case "schedule":
      return out.data(await access.schedule({ student, when: flags.when as never, date: flags.date, weekday: flags.weekday }));
    case "homework":
      return out.data(await access.homework({ student, limit: flags.limit }));
    case "exams":
      return out.data(await access.upcomingExams({ student, limit: flags.limit }));
    case "grades":
      return out.data(await access.grades({ student, limit: flags.limit }));
    case "gradebook":
      return out.data(await access.gradebook({ student }));
    case "notes":
      if (action === "summary") return out.data(await access.lessonNotesSummary({ student, from: flags.from, to: flags.to }));
      return out.data(await access.lessonNotes({ student, date: flags.date, days: flags.days, from: flags.from, to: flags.to }));
    case "messages":
      if (action === "read") return out.data(await access.message({ id: Number(args[0]), student }));
      return out.data(await access.messages({ student, folder: flags.folder, limit: flags.limit }));
    case "news":
      if (action === "read") return out.data(await access.newsItem({ id: Number(args[0]), student }));
      if (action === "download") {
        const fetched = await access.newsAttachment({ newsId: Number(args[0]), resourceId: args[1], student });
        return printDownload(fetched, flags.output, out);
      }
      return out.data(await access.news({ student, limit: flags.limit, includeOlder: flags.older }));
    case "printouts":
      if (action === "download") return printDownload(await access.printout({ id: args[0], student }), flags.output, out);
      return out.data(await access.printouts({ student }));
    case "students":
      return out.data({ students: await access.studentList() });
    default:
      throw new WilmaAiError("unknown_command", `Unknown command "${command}". See wilma --help.`);
  }
}

/** Save a fetched file in the output folder (default: the current one), never overwriting. */
async function saveDownload(fetched: Extract<FetchedAttachment, { status: "fetched" }>, outputOption?: string): Promise<string> {
  // "~/Downloads" typed at the interactive prompt (no shell to expand it).
  const output = outputOption?.replace(/^~(?=$|[\\/])/, homedir());
  const directory = resolve(output ?? process.cwd());
  await mkdir(directory, { recursive: true });
  const { path, handle } = await createUniqueDownloadFile(directory, fetched.fileName);
  try {
    await handle.writeFile(fetched.data);
  } finally {
    await handle.close();
  }
  return path;
}

async function printDownload(fetched: FetchedAttachment & { student: StudentRef }, outputOption: string | undefined, out: Output) {
  const printoutId = "printoutId" in fetched ? fetched.printoutId : undefined;
  const source = printoutId ? { printoutId } : { newsId: fetched.newsId, resourceId: fetched.resource.id };
  if (fetched.status === "not_a_file") {
    out.data(
      { status: "not_a_file", student: fetched.student, ...source, label: fetched.resource.label, url: fetched.resource.url, message: fetched.message },
      () => [fetched.resource.label, fetched.message, fetched.resource.url].join("\n")
    );
    return;
  }
  const path = await saveDownload(fetched, outputOption);
  out.data(
    { status: "downloaded", student: fetched.student, ...source, label: fetched.resource.label, path, contentType: fetched.contentType, sizeBytes: fetched.data.byteLength },
    () => `Downloaded ${fetched.resource.label} to ${path}`
  );
}

async function handleFindSchool(query: string, out: Output) {
  const wilmas = (await searchTenants(query, 15)).map((t) => ({ url: t.url, name: t.name }));
  const hint = wilmas.length ? undefined : `No Wilma found for "${query}". Many schools use their city's Wilma: try the city or municipality the school is in.`;
  out.data({ wilmas, ...(hint ? { hint } : {}) }, () => (hint ? hint : wilmas.map((t) => `${t.url}  ${t.name}`).join("\n")));
}

async function runInteractive(config: { profiles: StoredProfile[]; lastProfileId?: string | null }) {
  const mfa = createInteractiveMfa(() => saveConfig(config));
  while (true) {
    const profile = await chooseProfile(config, mfa);
    if (!profile) {
      return;
    }
    const access = new WilmaAccess({ profile: { ...profile, studentNumber: null }, mfa: mfa.callback });
    const student = profile.studentNumber ?? undefined;
    const show = (command: string, result: unknown, action: string | null = null) => {
      console.clear();
      console.log(formatText(command, action, result));
    };

    let nextAction = await selectOrCancel({
      message: "What do you want to view?",
      pageSize: 15,
      choices: [
        ...ACTIONS.filter((a) => a.value !== "exit"),
        { value: "back", name: "Back to students" },
        { value: "exit", name: "Exit" },
      ],
    });
    if (nextAction === null) {
      // Esc from main menu -> back to student picker
      continue;
    }

    while (nextAction !== "exit" && nextAction !== "back") {
      if (nextAction === "summary") show("summary", await access.summary({ student }));
      if (nextAction === "schedule-today") show("schedule", await access.schedule({ student, when: "today" }));
      if (nextAction === "schedule-tomorrow") show("schedule", await access.schedule({ student, when: "tomorrow" }));
      if (nextAction === "homework") show("homework", await access.homework({ student }));
      if (nextAction === "exams") show("exams", await access.upcomingExams({ student }));
      if (nextAction === "grades") show("grades", await access.grades({ student }));
      if (nextAction === "notes") show("notes", await access.lessonNotes({ student, days: 14 }));
      if (nextAction === "gradebook") show("gradebook", await access.gradebook({ student }));
      if (nextAction === "news") await selectNewsToRead(access, student);
      if (nextAction === "messages") {
        const folder = await selectOrCancel<MessageFolder>({
          message: "Select folder",
          choices: [
            { value: "inbox", name: "Inbox" },
            { value: "archive", name: "Archive" },
            { value: "outbox", name: "Outbox" },
            { value: "drafts", name: "Drafts" },
            { value: "appointments", name: "Appointments" },
          ],
        });
        if (folder !== null) {
          await selectMessageToRead(access, student, folder);
        }
      }

      const followUp = await selectOrCancel({
        message: "What next?",
        pageSize: 15,
        choices: [
          ...ACTIONS.filter((a) => a.value !== "exit"),
          { value: "back", name: "Back to students" },
          { value: "exit", name: "Exit" },
        ],
      }, false);
      nextAction = followUp ?? "back";
    }
    await flushSessions();
    if (nextAction === "exit") {
      return;
    }
  }
}

async function selectNewsToRead(access: WilmaAccess, student: string | undefined) {
  const news = (await access.news({ student, limit: 30 })).students[0]?.news ?? [];
  if (!news.length) return;
  const choices = [
    { value: "back", name: "Back" },
    ...news.map((item) => ({ value: String(item.wilmaId), name: newsLine(item) })),
  ];
  const selected = await selectOrCancel<string>({ message: "Read which bulletin?", choices });
  if (!selected || selected === "back") return;
  const read = await access.newsItem({ id: Number(selected), student });
  console.clear();
  console.log(formatText("news", "read", read));
  for (;;) {
    const resources = read.news.resources ?? [];
    if (!resources.length) return;
    const pick = await selectOrCancel<string>(
      {
        message: "Links",
        choices: [
          { value: "back", name: "Continue" },
          ...resources.map((resource) => ({ value: resource.id, name: `Download "${compactText(resource.label)}"` })),
        ],
      },
      false
    );
    if (!pick || pick === "back") return;
    const directory = await inputOrCancel({ message: "Save to directory", default: resolve(homedir(), "Downloads") });
    if (directory === null) continue;
    try {
      const fetched = await access.newsAttachment({ newsId: read.news.wilmaId, resourceId: pick, student });
      if (fetched.status === "not_a_file") console.log(`${fetched.message}\n${fetched.resource.url}`);
      else console.log(`Downloaded ${fetched.resource.label} to ${await saveDownload(fetched, directory)}`);
    } catch (error) {
      console.error("Download failed:", error instanceof Error ? error.message : error);
    }
  }
}

async function selectMessageToRead(access: WilmaAccess, student: string | undefined, folder: MessageFolder) {
  const messages = (await access.messages({ student, folder, limit: 30 })).students[0]?.messages ?? [];
  if (!messages.length) {
    console.log(`\nNo messages in ${folder}.`);
    return;
  }
  const choices = [
    { value: "back", name: "Back" },
    ...messages.map((msg) => ({ value: String(msg.wilmaId), name: messageLine(msg) })),
  ];
  const selected = await selectOrCancel<string>({ message: "Read which message?", choices });
  if (!selected || selected === "back") return;
  console.clear();
  console.log(formatText("messages", "read", await access.message({ id: Number(selected), student })));
}

async function chooseProfile(
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  mfa: InteractiveMfa
): Promise<WilmaProfile | null> {
  const onMfa = mfa.callback;
  if (config.profiles.length) {
    const choices = config.profiles.map((p) => ({
      value: p.id,
      name: `${p.username} @ ${p.tenantName ?? p.tenantUrl}`.trim(),
    }));
    choices.push({ value: "new", name: "Use a new login" });

    const selected = await selectOrCancel({
      message: "Choose a saved profile or create a new one",
      choices,
      default: config.lastProfileId ?? undefined,
    });
    if (selected === null) return null;

    if (selected !== "new") {
      const stored = config.profiles.find((p) => p.id === selected);
      if (!stored) {
        throw new Error("Stored profile not found");
      }
      mfa.profile = stored;
      mfa.typedSecret = null;
      const secret = revealSecret(stored.passwordObfuscated);
      if (!secret) {
        throw new Error("Stored password could not be decoded");
      }
      const selectedStudent = await chooseStudentFromProfile(stored, {
        baseUrl: stored.tenantUrl,
        username: stored.username,
        password: secret,
      }, onMfa);
      if (!selectedStudent) {
        return null;
      }
      stored.lastUsedAt = new Date().toISOString();
      stored.lastStudentNumber = selectedStudent?.studentNumber ?? null;
      stored.lastStudentName = selectedStudent?.name ?? null;
      config.lastProfileId = stored.id;
      await saveConfig(config);
      return {
        baseUrl: stored.tenantUrl,
        username: stored.username,
        password: secret,
        studentNumber: selectedStudent?.studentNumber ?? undefined,
      };
    }
  }

  const tenant = await selectTenant();
  if (!tenant) return null;
  const username = await inputOrCancel({ message: "Wilma username" });
  if (username === null) return null;
  const passwordValue = await passwordOrCancel({ message: "Wilma password" });
  if (passwordValue === null) return null;

  // Codes for a new login can't come from another saved login's key.
  mfa.profile = undefined;
  mfa.typedSecret = null;
  const newProfile = { baseUrl: tenant.url, username, password: passwordValue };
  const verified = await WilmaClient.login(newProfile, onMfa);
  const students = await verified.students();
  // The commands that follow continue this session instead of logging in again.
  adoptSession(newProfile, verified);
  const student = await chooseStudent(students);
  if (!student) return null;

  // Same rules as `wilma login`: one entry per account, whatever the username's case.
  const stored = await saveLogin(config, {
    tenantUrl: tenant.url,
    tenantName: tenant.name,
    username,
    password: passwordValue,
    totpSecret: mfa.typedSecret,
    students,
  });
  stored.lastStudentNumber = student.studentNumber;
  stored.lastStudentName = student.name;
  await saveConfig(config);
  mfa.profile = stored;

  return {
    baseUrl: stored.tenantUrl,
    username,
    password: passwordValue,
    studentNumber: student.studentNumber,
  };
}

async function selectTenant(): Promise<TenantInfo | null> {
  const tenants = await listTenants();
  let query = await inputOrCancel({
    message: "Search tenant by city/name (blank to list all, or type URL)",
    default: "",
  });
  if (query === null) return null;

  while (true) {
    if (query.startsWith("http://") || query.startsWith("https://")) {
      return {
        url: query.trim().replace(/\/$/, ""),
        name: query.trim(),
        municipalities: [],
      };
    }

    const filtered = query.trim() ? await searchTenants(query, 20) : tenants;

    const choices = filtered.slice(0, 20).map((t) => ({
      value: t.url,
      name: `${t.name ?? t.url} (${t.url})`,
    }));
    choices.push({ value: "search", name: "Search again" });
    choices.push({ value: "manual", name: "Enter URL manually" });

    const selected = await selectOrCancel({
      message: "Select tenant",
      choices,
    });
    if (selected === null) return null;

    if (selected === "search") {
      const nextQuery = await inputOrCancel({ message: "Search tenant by city/name (or type URL)" });
      if (nextQuery === null) return null;
      query = nextQuery;
      continue;
    }

    if (selected === "manual") {
      const manual = await inputOrCancel({ message: "Tenant URL" });
      if (manual === null) return null;
      return {
        url: manual.trim().replace(/\/$/, ""),
        name: manual.trim(),
        municipalities: [],
      };
    }

    const tenant = tenants.find((t) => t.url === selected);
    if (!tenant) {
      throw new Error("Tenant not found");
    }
    return tenant;
  }
}

async function chooseStudent(students: StudentInfo[]): Promise<StudentInfo | null> {
  if (!students.length) {
    const manual = await inputOrCancel({ message: "Student number (not found automatically)" });
    if (manual === null) return null;
    return { studentNumber: manual.trim(), name: manual.trim(), href: `/!${manual.trim()}/` };
  }

  if (students.length === 1) {
    return students[0];
  }

  const selected = await selectOrCancel({
    message: "Select student",
    choices: students.map((s) => ({
      value: s.studentNumber,
      name: `${compactText(s.name)} (${s.studentNumber})`,
    })),
  });
  if (selected === null) return null;

  return students.find((s) => s.studentNumber === selected) ?? null;
}

async function chooseStudentFromProfile(
  stored: StoredProfile,
  baseProfile: { baseUrl: string; username: string; password: string },
  onMfa?: MfaCallback
): Promise<StudentInfo | null> {
  let students: StudentInfo[] = [];
  const fresh = await new WilmaAccess({ profile: baseProfile, mfa: onMfa }).students().catch((err) => {
    if (stored.students?.length) return [];
    throw err;
  });
  if (fresh.length) {
    students = fresh;
    stored.students = fresh.map((s) => ({ studentNumber: s.studentNumber, name: s.name }));
  } else if (stored.students && stored.students.length) {
    students = stored.students.map((s) => ({
      studentNumber: s.studentNumber,
      name: s.name,
      href: `/!${s.studentNumber}/`,
    }));
  }

  const defaultStudent = stored.lastStudentNumber
    ? students.find((s) => s.studentNumber === stored.lastStudentNumber)
    : undefined;

  if (!students.length) {
    return null;
  }
  if (students.length === 1) {
    return students[0];
  }

  const selected = await selectOrCancel({
    message: "Select student",
    default: defaultStudent?.studentNumber,
    choices: students.map((s) => ({
      value: s.studentNumber,
      name: `${compactText(s.name)} (${s.studentNumber})`,
    })),
  });
  if (selected === null) return null;

  return students.find((s) => s.studentNumber === selected) ?? null;
}

async function handleLogin(args: string[], out: Output) {
  const flags: {
    tenant?: string;
    username?: string;
    passwordStdin?: boolean;
    totpSecret?: string;
    browser: boolean;
  } = { browser: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--tenant") flags.tenant = args[++i];
    else if (arg === "--username") flags.username = args[++i];
    else if (arg === "--password-stdin") flags.passwordStdin = true;
    else if (arg === "--totp-secret") flags.totpSecret = args[++i];
    else if (arg === "--no-browser") flags.browser = false;
    else if (arg === "--json" || arg === "--text") continue;
    else if (arg === "--password") {
      throw new WilmaAiError("invalid_argument", `Passing the password as a flag would leave it in shell history. Use ${ENV_VARS.password} or --password-stdin.`);
    } else throw new WilmaAiError("invalid_argument", `Unknown login option "${arg}". See wilma help login.`);
  }

  const report = (stored: StoredProfile) => {
    const students = (stored.students ?? []).map((s) => s.name);
    if (out.json) {
      out.data({ status: "ok", wilma: stored.tenantName ?? stored.tenantUrl, username: stored.username, students, configPath: getConfigPath() });
      return;
    }
    console.log(`Logged in to ${stored.tenantName ?? stored.tenantUrl} as ${stored.username}.`);
    if (students.length) console.log(`Children: ${students.join(", ")}`);
    console.log(`Saved to ${getConfigPath()}`);
  };

  // Non-interactive: flags (with env fallback) — for agents and scripts.
  if (flags.tenant || flags.username || flags.passwordStdin) {
    const tenantQuery = flags.tenant ?? process.env[ENV_VARS.tenant];
    const username = flags.username ?? process.env[ENV_VARS.username];
    if (!tenantQuery || !username) {
      throw new WilmaAiError("invalid_argument", "Non-interactive login needs --tenant and --username (or WILMA_TENANT / WILMA_USERNAME).");
    }
    const password = flags.passwordStdin ? (await readStdin()).replace(/\r?\n$/, "") : process.env[ENV_VARS.password];
    if (!password) {
      throw new WilmaAiError("invalid_argument", `No password given. Pipe it with --password-stdin or set ${ENV_VARS.password}.`);
    }
    const tenant = await resolveTenant(tenantQuery);
    const totpSecret = flags.totpSecret ?? process.env[ENV_VARS.totpSecret] ?? null;
    const { client, students } = await verifyLoginSession({ tenantUrl: tenant.url, username, password, totpSecret });
    // The next commands continue this session: no second login (or code).
    adoptSession({ baseUrl: normalizeTenantUrl(tenant.url), username, password }, client);
    const stored = await saveLogin(await loadConfig(), {
      tenantUrl: tenant.url,
      tenantName: tenant.name,
      username,
      password,
      totpSecret,
      students,
    });
    report(stored);
    await flushSessions();
    return;
  }

  // Browser: a one-time page on 127.0.0.1 where the parent logs in.
  if (flags.browser && openBrowser("about:blank", { dryRun: true }) === "headless") {
    // A cloud computer: the parent can't reach a page served here.
    throw new WilmaAiError("no_browser", HEADLESS_LOGIN_HELP);
  }
  const server = await startLoginServer({
    onSaved: (stored) => {
      if (out.json) return;
      const students = (stored.students ?? []).map((s) => s.name);
      console.log(`\nLogged in to ${stored.tenantName ?? stored.tenantUrl} as ${stored.username}.`);
      if (students.length) console.log(`Children: ${students.join(", ")}`);
      console.log("Add another Wilma in the browser if a child is on a different one, or press Done there (or Enter here) to finish.");
    },
  });
  const opened = flags.browser && openBrowser(server.url) === "opened";
  if (!out.json) {
    console.log(opened ? "Opening your browser to log in to Wilma…" : "Open this link in a browser on this computer to log in to Wilma:");
    console.log(`  ${server.url}`);
    console.log("Waiting for login (Ctrl+C to cancel)…");
  } else {
    console.error(JSON.stringify({ status: "waiting", url: server.url }));
  }
  // Enter in the terminal finishes too, in case the browser tab was closed without pressing Done.
  const finishOnEnter = () => server.close();
  if (process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.once("data", finishOnEnter);
  }
  const logins = await server.closed;
  if (process.stdin.isTTY) {
    process.stdin.off("data", finishOnEnter);
    process.stdin.pause();
  }
  if (!logins.length) {
    throw new WilmaAiError("login_cancelled", "Login page closed before logging in. Run `wilma login` again.");
  }
  await flushSessions();
  if (out.json) {
    out.data({
      status: "ok",
      logins: logins.map((stored) => ({
        wilma: stored.tenantName ?? stored.tenantUrl,
        username: stored.username,
        students: (stored.students ?? []).map((s) => s.name),
      })),
      configPath: getConfigPath(),
    });
    return;
  }
  console.log(`\nSaved to ${getConfigPath()}`);
}

const HEADLESS_LOGIN_HELP = [
  "This computer has no browser, so the login page can't be shown here.",
  "If you are an agent on a cloud computer, set up the login with the user instead:",
  "  1. Ask the user which city their children's school is in (or the school's name),",
  "     run `wilma tenants <city>` and let them pick their Wilma from the list.",
  `  2. Ask them to store their Wilma username and password in your secret settings as`,
  `     ${ENV_VARS.username} and ${ENV_VARS.password} (plus ${ENV_VARS.totpSecret} for two-step verification),`,
  `     and set ${ENV_VARS.tenant} to the address they picked. Commands then work without \`wilma login\`.`,
  "  Never ask the user to type their Wilma password into the chat.",
].join("\n");

/** List saved Wilma logins, or remove one: `wilma accounts remove <number|Wilma name|username>`. */
async function handleAccounts(action: string | null, args: string[], out: Output) {
  const config = await loadConfig();
  if (action === "remove") {
    const target = args.join(" ").trim().toLowerCase();
    if (!target) throw new WilmaAiError("invalid_argument", "Which login? Use the number from `wilma accounts`, the Wilma name or the username.");
    const byNumber = /^\d+$/.test(target) ? config.profiles[Number(target) - 1] : undefined;
    const matches = byNumber
      ? [byNumber]
      : config.profiles.filter((p) => [p.tenantName ?? "", p.tenantUrl, p.username].some((v) => v.toLowerCase() === target));
    if (matches.length !== 1) {
      throw new WilmaAiError(
        matches.length ? "ambiguous_account" : "unknown_account",
        matches.length ? `"${target}" matches several logins; use its number.` : `No saved login matches "${target}".`
      );
    }
    const removed = matches[0];
    config.profiles = config.profiles.filter((p) => p.id !== removed.id);
    if (config.lastProfileId === removed.id) config.lastProfileId = config.profiles[0]?.id ?? null;
    await saveConfig(config);
    await clearSessions();
    const result = { status: "removed", wilma: removed.tenantName ?? removed.tenantUrl, username: removed.username };
    out.data(result, () => `Removed ${removed.username} @ ${result.wilma}.`);
    return;
  }
  const accounts = config.profiles.map((p, i) => ({
    number: i + 1,
    wilma: p.tenantName ?? p.tenantUrl,
    url: p.tenantUrl,
    username: p.username,
    children: (p.students ?? []).map((st) => st.name),
  }));
  out.data({ accounts }, () =>
    accounts.length
      ? [
          ...accounts.map((a) => `${a.number}. ${a.wilma} — ${a.username}${a.children.length ? ` (${a.children.join(", ")})` : ""}`),
          "",
          "Add another with `wilma login`; remove one with `wilma accounts remove <number>`.",
        ].join("\n")
      : "No saved Wilma logins. Run `wilma login`."
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function readPackageVersion(): Promise<string> {
  // fileURLToPath: install paths can have spaces, non-ASCII letters or a Windows drive.
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const data = JSON.parse(raw) as { version?: string };
  return data.version ?? "unknown";
}

async function handleUpdate(): Promise<void> {
  const currentVersion = await readPackageVersion();
  console.log(`Current version: ${currentVersion}`);
  console.log("Updating @wilm-ai/wilma-cli...\n");

  // npm is npm.cmd on Windows, which only runs through a shell. The command is a
  // fixed string, so the shell sees no user input.
  const command = "npm install -g @wilm-ai/wilma-cli@latest";
  const child = process.platform === "win32"
    ? spawn(command, { stdio: "inherit", shell: true })
    : spawn("npm", command.split(" ").slice(1), { stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", (err) => {
      reject((err as NodeJS.ErrnoException).code === "ENOENT"
        ? new Error("npm wasn't found. Install Node.js (it includes npm) from https://nodejs.org and run `wilma update` again.")
        : err);
    });
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`npm couldn't update WilmAI (exit code ${code}); see npm's message above.`);
  }
  console.log("\nUpdate complete.");
}

// --- Version check / update notification ---

const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getVersionCachePath(): string {
  return resolve(dirname(getConfigPath()), "version-check.json");
}

interface VersionCache {
  latestVersion: string | null;
  checkedAt: number;
}

async function readVersionCache(): Promise<VersionCache | null> {
  try {
    const raw = await readFile(getVersionCachePath(), "utf-8");
    return JSON.parse(raw) as VersionCache;
  } catch {
    return null;
  }
}

async function writeVersionCache(cache: VersionCache): Promise<void> {
  const cachePath = getVersionCachePath();
  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  await writeFile(cachePath, JSON.stringify(cache), { encoding: "utf-8", mode: 0o600 });
}

interface UpdateCheck {
  result: Promise<string | null>;
  /** Stop a check still in flight, so it never keeps the command running. */
  cancel(): void;
}

/**
 * Ask npm for the latest version at most once a day. A failed check counts as
 * a check too: agents in sandboxes without internet access shouldn't pay for
 * a timeout on every command.
 */
function startUpdateCheck(): UpdateCheck {
  const controller = new AbortController();
  let cancelled = false;
  const result = (async (): Promise<string | null> => {
    const cache = await readVersionCache();
    if (cache && Date.now() - cache.checkedAt < VERSION_CHECK_INTERVAL_MS) {
      return cache.latestVersion;
    }
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch("https://registry.npmjs.org/@wilm-ai/wilma-cli/latest", { signal: controller.signal });
      const data = response.ok ? ((await response.json()) as { version?: string }) : {};
      const latestVersion = data.version ?? cache?.latestVersion ?? null;
      await writeVersionCache({ latestVersion, checkedAt: Date.now() });
      return latestVersion;
    } catch {
      // Cancelled because the command finished: try again next time.
      if (!cancelled) await writeVersionCache({ latestVersion: cache?.latestVersion ?? null, checkedAt: Date.now() }).catch(() => {});
      return cache?.latestVersion ?? null;
    } finally {
      clearTimeout(timeout);
    }
  })().catch(() => null);
  return {
    result,
    cancel() {
      cancelled = true;
      controller.abort();
    },
  };
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split(".").map(Number);
  const currentParts = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

async function showUpdateNotice(check: UpdateCheck): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const latestVersion = await Promise.race([
      check.result,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1000);
      }),
    ]);
    if (!latestVersion) return;

    const currentVersion = await readPackageVersion();
    if (isNewerVersion(latestVersion, currentVersion)) {
      process.stderr.write(
        `\nUpdate available: ${currentVersion} → ${latestVersion}\n` +
        `Run "wilma update" to update.\n`
      );
    }
  } catch {
    // Silently ignore any errors
  } finally {
    clearTimeout(timer);
  }
}

async function selectOrCancel<T>(opts: Parameters<typeof select>[0], clearScreen = true): Promise<T | null> {
  if (clearScreen) {
    console.clear();
  }
  const prompt = select(opts as any, { clearPromptOnDone: true });

  const onKeypress = (_ch: string, key: { name?: string } | undefined) => {
    if (key?.name === "escape") {
      prompt.cancel();
    }
  };

  process.stdin.on("keypress", onKeypress);

  try {
    const result = await prompt;
    return result as T;
  } catch (err) {
    if (isPromptCancel(err)) {
      return null;
    }
    throw err;
  } finally {
    process.stdin.removeListener("keypress", onKeypress);
  }
}

interface InteractiveMfa {
  callback: MfaCallback;
  /** The saved login being used (undefined while logging in with a new one). */
  profile: StoredProfile | undefined;
  /** A setup key typed during a new login, saved with that login. */
  typedSecret: string | null;
}

function createInteractiveMfa(saveProfile: () => Promise<void>): InteractiveMfa {
  let lastCode: string | null = null;
  let lastCodeTime = 0;
  let lastCodeFor: StoredProfile | undefined;
  let lastFormkey: string | null = null;
  // One code generator per key: switching logins must not reuse another login's key.
  const generators = new Map<string, MfaCallback>();
  const state: InteractiveMfa = {
    profile: undefined,
    typedSecret: null,
    callback: async (formkey: string): Promise<string> => {
      // Asked again for the same challenge means Wilma rejected the code.
      const retry = formkey === lastFormkey;
      lastFormkey = formkey;

      // A saved or just-typed key generates codes (a retry waits for the next one).
      const secret = state.profile?.totpSecretObfuscated
        ? revealSecret(state.profile.totpSecretObfuscated)
        : state.typedSecret;
      if (secret) {
        if (!generators.has(secret)) generators.set(secret, mfaCallbackFor(secret)!);
        return generators.get(secret)!(formkey);
      }

      // TOTP codes are valid for 30s: a second login in the same window reuses the typed code.
      const now = Math.floor(Date.now() / 30000);
      if (!retry && lastCode && now === lastCodeTime && lastCodeFor === state.profile) {
        return lastCode;
      }
      if (retry) {
        console.log("That code wasn't accepted. Wait for the next code in your authenticator app.");
      }

      const choice = await select({
        message: "MFA required. Choose how to authenticate:",
        choices: [
          { value: "code", name: "Enter one-time code from authenticator app" },
          { value: "secret", name: "Save TOTP secret for automatic login" },
        ],
      });

      if (choice === "secret") {
        const secretInput = (await input({
          message: "Paste TOTP secret (base32 key or otpauth:// URI)",
        })).trim();
        if (!secretInput) throw new Error("MFA cancelled");
        const parsed = parseTotpSecret(secretInput);
        if (state.profile) {
          state.profile.totpSecretObfuscated = obfuscateSecret(secretInput);
          await saveProfile();
        } else {
          // A new login: saved together with the login once it succeeds.
          state.typedSecret = secretInput;
        }
        generators.set(secretInput, mfaCallbackFor(secretInput)!);
        const code = generateTOTP(parsed);
        lastCode = code;
        lastCodeTime = now;
        lastCodeFor = state.profile;
        return code;
      }

      const code = await input({ message: "Enter MFA code from authenticator app" });
      if (!code) throw new Error("MFA cancelled");
      lastCode = code.trim();
      lastCodeTime = now;
      lastCodeFor = state.profile;
      return lastCode;
    },
  };
  return state;
}

async function inputOrCancel(opts: Parameters<typeof input>[0]): Promise<string | null> {
  console.clear();
  const prompt = input(opts as any, { clearPromptOnDone: true });

  const onKeypress = (_ch: string, key: { name?: string } | undefined) => {
    if (key?.name === "escape") {
      prompt.cancel();
    }
  };

  process.stdin.on("keypress", onKeypress);

  try {
    const result = await prompt;
    return result;
  } catch (err) {
    if (isPromptCancel(err)) {
      return null;
    }
    throw err;
  } finally {
    process.stdin.removeListener("keypress", onKeypress);
  }
}

async function passwordOrCancel(opts: Parameters<typeof password>[0]): Promise<string | null> {
  console.clear();
  const prompt = password(opts as any, { clearPromptOnDone: true });

  const onKeypress = (_ch: string, key: { name?: string } | undefined) => {
    if (key?.name === "escape") {
      prompt.cancel();
    }
  };

  process.stdin.on("keypress", onKeypress);

  try {
    const result = await prompt;
    return result;
  } catch (err) {
    if (isPromptCancel(err)) {
      return null;
    }
    throw err;
  } finally {
    process.stdin.removeListener("keypress", onKeypress);
  }
}

function isPromptCancel(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  return (
    name === "AbortError" ||
    name === "ExitPromptError" ||
    name === "CancelPromptError" ||
    message.includes("User force closed the prompt") ||
    message.toLowerCase().includes("cancel") ||
    message.toLowerCase().includes("aborted")
  );
}

/**
 * Remove terminal escape sequences and control characters (keeping newlines
 * and tabs), so text from Wilma or a bulletin link can't retitle the window,
 * clear the screen, write the clipboard or overwrite a line.
 */
function terminalSafe(value: string): string {
  return value
    .replace(/\u001b(\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(\u0007|\u001b\\)?|[@-Z\\-_])/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/**
 * JSON output keeps every character: JSON.stringify already escapes control
 * characters except DEL and the C1 range, which some terminals act on, so
 * escape those too (inside JSON they can only occur in strings).
 */
function jsonSafe(value: string): string {
  return value.replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}


/** An error as agents and scripts get it: a stable code, a message, and the exit code. */
function describeError(err: unknown): { code: string; message: string; hint?: string; cause?: string; details?: Record<string, unknown>; exitCode: number } {
  if (err instanceof WilmaAiError) {
    const exitCode = err.code === "invalid_argument" || err.code === "unknown_command" ? 2 : err.code === "not_logged_in" ? 3 : 1;
    return { code: err.code, message: err.message, details: err.details, exitCode };
  }
  if (err instanceof MfaRequiredError) {
    return {
      code: "mfa_required",
      message: "Two-step verification is on for this Wilma account.",
      hint: `Run \`wilma login\` and give the authenticator setup key on the login page, or set ${ENV_VARS.totpSecret} to the key (base32 or otpauth:// URI).`,
      exitCode: 1,
    };
  }
  if (isMfaFailure(err)) {
    return {
      code: "mfa_failed",
      message: "Wilma didn't accept the two-step verification code.",
      hint: "The saved authenticator setup key may be wrong or changed: run `wilma login` again.",
      exitCode: 1,
    };
  }
  if (err instanceof AuthenticationError) {
    return {
      code: "login_failed",
      message: "Wilma didn't accept the saved login (has the password changed?).",
      hint: "Run `wilma login` again.",
      exitCode: 1,
    };
  }
  if (err instanceof NetworkError) {
    return { code: "network", message: err.message, ...(err.code ? { cause: err.code } : {}), ...(err.hint ? { hint: err.hint } : {}), exitCode: 1 };
  }
  if (err instanceof APIError) {
    return { code: err.status === 404 ? "not_found" : "wilma_error", message: err.message, exitCode: 1 };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/isn't valid JSON/.test(message)) return { code: "config_invalid", message, exitCode: 1 };
  return { code: "error", message, exitCode: 1 };
}

main().catch((err) => {
  if (isPromptCancel(err)) {
    process.exit(0);
  }
  const { exitCode, details, ...failure } = describeError(err);
  const mode = outputMode(process.argv.slice(2));
  if (mode.json) {
    console.log(toAgentJson({ status: "error", ...failure, ...(details ?? {}) }, mode.pretty));
  } else {
    console.error(`Error: ${failure.message}`);
    if (failure.hint) console.error(failure.hint);
  }
  process.exit(exitCode);
});
