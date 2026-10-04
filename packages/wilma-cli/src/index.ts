#!/usr/bin/env node
import { emitKeypressEvents } from "node:readline";
import { select, input, password } from "@inquirer/prompts";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WilmaClient,
  MfaRequiredError,
  NetworkError,
  listTenants,
  type GradebookEntry,
  type LessonNote,
  type LessonNoteSummary,
  type MfaCallback,
  type MessageFolder,
  type NewsItem,
  type Printout,
  type TenantInfo,
  type WilmaProfile,
  type StudentInfo,
} from "@wilm-ai/wilma-client";
import {
  clearConfig,
  getConfigPath,
  loadConfig,
  obfuscateSecret,
  revealSecret,
  saveConfig,
  type StoredProfile,
} from "./config.js";
import {
  buildSummaryData,
  daysBack,
  finnishDate,
  matchStudents,
  parseIsoDate,
  resolveScheduleDateSelection,
  selectNews,
  todayString,
} from "./agent-data.js";
import {
  ENV_VARS,
  mfaCallbackFor,
  resolveAccount,
  resolveAccounts,
  saveLogin,
  verifyLogin,
} from "./credentials.js";
import {
  MAX_NEWS_RESOURCE_BYTES,
  createUniqueDownloadFile,
  fileNameFromResponse,
  normalizeResourceId,
} from "./downloads.js";
import { openBrowser, startLoginServer } from "./login-server.js";
import { runMcpServer } from "./mcp.js";
import { resolveTenant, searchTenants } from "./tenant-search.js";
import { generateTOTP, parseTotpSecret } from "./totp.js";

// Enable keypress events for escape key detection
if (process.stdin.isTTY) {
  emitKeypressEvents(process.stdin);
}

const ACTIONS = [
  { value: "summary", name: "Daily summary" },
  { value: "schedule-today", name: "Today's schedule" },
  { value: "schedule-tomorrow", name: "Tomorrow's schedule" },
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
  const args = process.argv.slice(2);

  // MCP mode speaks JSON-RPC on stdout: no update checks or notices.
  if (args[0] === "mcp") {
    await runMcpServer(await readPackageVersion().catch(() => "unknown"));
    return;
  }

  // School data is printed in many places; filter every printed line so a
  // message can't smuggle terminal escape sequences. With --json the data is
  // kept and only escaped. Prompts write to the terminal directly (and keep
  // their colours); their choices go through compactText.
  const clean = args.includes("--json") ? jsonSafe : terminalSafe;
  for (const method of ["log", "error"] as const) {
    const print = console[method].bind(console);
    console[method] = (...parts: unknown[]) => print(...parts.map((part) => (typeof part === "string" ? clean(part) : part)));
  }

  // Fire version check early (non-blocking); it never outlives the command.
  const updateCheck = startUpdateCheck();
  try {
    await runCommand(args, updateCheck);
  } finally {
    updateCheck.cancel();
  }
}

async function runCommand(args: string[], updateCheck: UpdateCheck) {

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    await showUpdateNotice(updateCheck);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    const version = await readPackageVersion();
    console.log(version);
    await showUpdateNotice(updateCheck);
    return;
  }
  if (args[0] === "update") {
    await handleUpdate();
    return;
  }
  if (args[0] === "accounts") {
    await handleAccounts(args.slice(1));
    return;
  }
  if (args[0] === "tenants") {
    await handleTenants(args.slice(1));
    return;
  }
  if (args[0] === "login") {
    await handleLogin(args.slice(1));
    await showUpdateNotice(updateCheck);
    return;
  }
  if (args[0] === "config" && args[1] === "clear") {
    await clearConfig();
    console.log(`Cleared config at ${getConfigPath()}`);
    return;
  }

  const config = await loadConfig();
  if (args.length) {
    await handleCommand(args, config);
    await showUpdateNotice(updateCheck);
    return;
  }

  // The interactive menu needs a person at a terminal. Agents and scripts
  // running `wilma` without arguments would otherwise hang in a prompt.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(NO_TERMINAL_HELP);
    process.exit(1);
  }

  await runInteractive(config);
  await showUpdateNotice(updateCheck);
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
  const students = await WilmaClient.listStudents({ baseUrl: tenant.url, username, password: passwordValue }, onMfa);
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

async function runInteractive(config: { profiles: StoredProfile[]; lastProfileId?: string | null }) {
  const mfa = createInteractiveMfa(() => saveConfig(config));
  while (true) {
    const profile = await chooseProfile(config, mfa);
    if (!profile) {
      return;
    }
    const client = await WilmaClient.login(profile, mfa.callback);

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
      if (nextAction === "summary") {
        console.clear();
        await outputSummary(client, { days: 7, json: false });
      }

      if (nextAction === "schedule-today") {
        console.clear();
        await outputSchedule(client, { when: "today", json: false });
      }

      if (nextAction === "schedule-tomorrow") {
        console.clear();
        await outputSchedule(client, { when: "tomorrow", json: false });
      }

      if (nextAction === "homework") {
        console.clear();
        await outputHomework(client, { limit: 10, json: false });
      }

      if (nextAction === "exams") {
        console.clear();
        await outputUpcomingExams(client, { limit: 20, json: false });
      }

      if (nextAction === "grades") {
        console.clear();
        await outputGrades(client, { limit: 20, json: false });
      }

      if (nextAction === "notes") {
        console.clear();
        await outputAttendance(client, { from: daysBack(14), to: todayString(), json: false });
      }

      if (nextAction === "gradebook") {
        console.clear();
        console.log("\nGradebook");
        printGradebook(await client.gradebook.get());
      }

      if (nextAction === "news") {
        await selectNewsToRead(client);
      }

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
          await selectMessageToRead(client, folder);
        }
      }

      nextAction = await selectOrCancel({
        message: "What next?",
        pageSize: 15,
        choices: [
          ...ACTIONS.filter((a) => a.value !== "exit"),
          { value: "back", name: "Back to students" },
          { value: "exit", name: "Exit" },
        ],
      }, false); // Don't clear screen - preserve content output
      if (nextAction === null) {
        // Esc from action menu -> back to student picker
        nextAction = "back";
      }
    }

    if (nextAction === "exit") {
      return;
    }
  }
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
  const fresh = await WilmaClient.listStudents(baseProfile, onMfa);
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

async function handleCommand(
  args: string[],
  config: { profiles: StoredProfile[]; lastProfileId?: string | null }
) {
  const { command, subcommand, resourceAction, flags } = parseArgs(args);
  const subcommands = COMMANDS[command];
  if (!subcommands) {
    throw new Error(`Unknown command "${command}". See wilma --help.`);
  }
  if (!subcommands.includes(subcommand)) {
    throw new Error(`Unknown subcommand "${subcommand}" for ${command}. See wilma --help.`);
  }

  const account = await resolveAccount(config);
  if (!account) {
    throw new Error("No saved Wilma login found. Run `wilma login` first.");
  }
  const profile: WilmaProfile = { ...account.profile, debug: Boolean(flags.debug) };
  // An env-var account must not pick up the saved profile's students.
  if (account.source === "env") {
    config = { profiles: [], lastProfileId: null };
  }
  // Use --totp-secret flag, or fall back to the account's stored/env TOTP secret
  const mfaCallback = mfaCallbackFor(flags.totpSecret ?? account.totpSecret);
  commandMfa = mfaCallback;
  // Families with children on different Wilmas have one saved login per Wilma.
  commandAccounts = account.source === "env"
    ? [{ profile, mfa: mfaCallback }]
    : (await resolveAccounts(config)).map((a) => ({
        profile: { ...a.profile, debug: Boolean(flags.debug) },
        mfa: a.stored?.id === account.stored?.id ? mfaCallback : mfaCallbackFor(a.totpSecret),
        stored: a.stored,
      }));

  if (command === "kids") {
    const students = await getStudentsForCommand(profile, config);
    if (flags.json) {
      console.log(JSON.stringify(students, null, 2));
      return;
    }
    console.log("\nKids");
    students.forEach((s) => {
      console.log(`- ${s.studentNumber} ${s.name}`);
    });
    return;
  }

  if (command === "news") {
    if (subcommand === "resource") {
      if (resourceAction !== "download") {
        throw new Error('Expected "wilma news resource download <news-id> <resource-id>"');
      }
      const newsId = parseReadId(flags.id, "news");
      const resourceId = normalizeResourceId(flags.resourceId);
      if (!resourceId) {
        throw new Error("Missing news resource id (for example, resource-1 or just 1)");
      }
      if (!flags.student) await requireOneStudent(profile, config);
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      if (!studentInfo && !profile.studentNumber) {
        throw await studentChoiceError(profile, config);
      }
      const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
      await outputNewsResourceDownload(perStudentClient, newsId, resourceId, {
        output: flags.output,
        json: flags.json,
      });
      return;
    }
    if (subcommand === "read") {
      const newsId = parseReadId(flags.id, "news");
      if (!flags.student) await requireOneStudent(profile, config);
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      if (!studentInfo && !profile.studentNumber) {
        throw await studentChoiceError(profile, config);
      }
      const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
      await outputNewsItem(perStudentClient, newsId, flags.json, {
        studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
      });
      return;
    }
    if (flags.allStudents) {
      await outputAllNews(profile, config, flags.limit ?? 20, flags.json, mfaCallback, flags.older);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputNews(perStudentClient, {
      limit: flags.limit ?? 20,
      older: flags.older,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "messages") {
    if (subcommand === "read") {
      const messageId = parseReadId(flags.id, "message");
      if (!flags.student) await requireOneStudent(profile, config);
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      if (!studentInfo && !profile.studentNumber) {
        throw await studentChoiceError(profile, config);
      }
      const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
      await outputMessageItem(perStudentClient, messageId, flags.json);
      return;
    }
    if (flags.allStudents) {
      await outputAllMessages(profile, config, {
        folder: flags.folder ?? "inbox",
        limit: flags.limit ?? 20,
        json: flags.json,
      }, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputMessages(perStudentClient, {
      folder: flags.folder ?? "inbox",
      limit: flags.limit ?? 20,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "attendance") {
    if (flags.days && (flags.date || flags.from)) throw new Error("Use --days, --date or --from, not several.");
    if (flags.date && (flags.from || flags.to)) throw new Error("Use either --date or --from/--to, not both.");
    const from = flags.days ? daysBack(flags.days) : flags.from;
    const period = subcommand === "summary"
      ? { from, to: flags.to }
      : from
        ? { from, to: flags.to ?? todayString() }
        : { date: flags.date };
    if (flags.allStudents) {
      await outputAllAttendance(profile, config, { ...period, summary: subcommand === "summary", json: flags.json }, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    const label = studentInfo?.name ?? undefined;
    if (subcommand === "summary") {
      await outputLessonNoteSummary(perStudentClient, { ...period, json: flags.json, label });
    } else {
      await outputAttendance(perStudentClient, { ...period, json: flags.json, label });
    }
    return;
  }

  if (command === "gradebook") {
    if (flags.allStudents) {
      await outputForEachStudent(profile, config, mfaCallback, flags.json, "gradebook", (client) => client.gradebook.get(), printGradebook);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    const gradebook = await perStudentClient.gradebook.get();
    if (flags.json) {
      console.log(JSON.stringify(gradebook, null, 2));
      return;
    }
    console.log(`\n${studentInfo?.name ? `[${studentInfo.name}] ` : ""}Gradebook`);
    printGradebook(gradebook);
    return;
  }

  if (command === "printouts") {
    if (subcommand === "download") {
      if (!flags.id) throw new Error('Missing printout id. Expected "wilma printouts download <id>".');
      if (!flags.student) await requireOneStudent(profile, config);
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
      const { printout, response } = await perStudentClient.printouts.fetch(flags.id);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Printout download failed with HTTP ${response.status}`);
      }
      const resource = { id: printout.id, label: printout.title, url: printout.path };
      const saved = await saveResponseToFile(response as never, resource, flags.output);
      if (flags.json) console.log(JSON.stringify({ status: "downloaded", printoutId: printout.id, ...saved }, null, 2));
      else console.log(`Downloaded ${printout.title} to ${saved.path}`);
      return;
    }
    if (flags.allStudents) {
      await outputForEachStudent(profile, config, mfaCallback, flags.json, "printouts", (client) => client.printouts.list(), printPrintouts);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    const printouts = await perStudentClient.printouts.list();
    if (flags.json) {
      console.log(JSON.stringify(printouts, null, 2));
      return;
    }
    console.log(`\n${studentInfo?.name ? `[${studentInfo.name}] ` : ""}Printouts`);
    printPrintouts(printouts);
    return;
  }

  if (command === "exams") {
    if (flags.allStudents) {
      await outputAllExams(profile, config, flags.limit ?? 20, flags.json, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputUpcomingExams(perStudentClient, {
      limit: flags.limit ?? 20,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "schedule") {
    if (flags.allStudents) {
      await outputAllOverviewCommand(profile, config, "schedule", flags, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputSchedule(perStudentClient, {
      when: flags.when ?? "week",
      date: flags.date,
      weekday: flags.weekday,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "homework") {
    if (flags.allStudents) {
      await outputAllOverviewCommand(profile, config, "homework", flags, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputHomework(perStudentClient, {
      limit: flags.limit ?? 10,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "grades") {
    if (flags.allStudents) {
      await outputAllOverviewCommand(profile, config, "grades", flags, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputGrades(perStudentClient, {
      limit: flags.limit ?? 20,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "summary") {
    if (flags.allStudents) {
      await outputAllOverviewCommand(profile, config, "summary", flags, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      throw await studentChoiceError(profile, config);
    }
    const perStudentClient = await loginForStudent(studentInfo, profile, mfaCallback);
    await outputSummary(perStudentClient, {
      days: flags.days ?? 7,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }
}

function printUsage() {
  console.log("Usage:");
  console.log("  wilma summary [--days 7] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma schedule list [--when today|tomorrow|week] [--date YYYY-MM-DD] [--weekday mon|tue|wed|thu|fri|sat|sun] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma homework list [--limit 10] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma exams list [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma grades list [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma kids list [--json]");
  console.log("  wilma news list [--limit 20] [--older] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma news read <id> [--student <id|name>] [--json]");
  console.log("  wilma news resource download <news-id> <resource-id> [--student <id|name>] [--output <directory>] [--json]");
  console.log("  wilma messages list [--folder inbox] [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma messages read <id> [--student <id|name>] [--json]");
  console.log("  wilma attendance list [--date YYYY-MM-DD | --days 14 | --from YYYY-MM-DD [--to YYYY-MM-DD]] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma attendance summary [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma gradebook [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma printouts list [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma printouts download <id> [--student <id|name>] [--output <directory>] [--json]");
  console.log("  wilma login [--no-browser] [--json]");
  console.log("  wilma login --tenant <url|city> --username <name> [--password-stdin] [--totp-secret <key>] [--json]");
  console.log("  wilma tenants <city or school> [--json]   find your Wilma address");
  console.log("  wilma accounts [--json]                    saved Wilma logins (one per Wilma your children use)");
  console.log("  wilma accounts remove <number>");
  console.log("  wilma mcp    (MCP server over stdio for Claude, ChatGPT and other agents)");
  console.log("  wilma update");
  console.log("  wilma config clear");
  console.log("  wilma --help | -h");
  console.log("  wilma --version | -v");
  console.log("");
  console.log("MFA: --totp-secret <base32-key|otpauth://...>");
  console.log("");
  console.log(`Agents without a saved login can set ${ENV_VARS.tenant}, ${ENV_VARS.username} and ${ENV_VARS.password}`);
  console.log(`(plus ${ENV_VARS.totpSecret} for two-step verification). The password is read from`);
  console.log(`${ENV_VARS.password} or stdin, never from a command-line flag.`);
}

async function handleLogin(args: string[]) {
  const flags: {
    tenant?: string;
    username?: string;
    passwordStdin?: boolean;
    totpSecret?: string;
    browser: boolean;
    json?: boolean;
  } = { browser: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--tenant") flags.tenant = args[++i];
    else if (arg === "--username") flags.username = args[++i];
    else if (arg === "--password-stdin") flags.passwordStdin = true;
    else if (arg === "--totp-secret") flags.totpSecret = args[++i];
    else if (arg === "--no-browser") flags.browser = false;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--password") {
      throw new Error(`Passing the password as a flag would leave it in shell history. Use ${ENV_VARS.password} or --password-stdin.`);
    } else throw new Error(`Unknown login option "${arg}". See wilma --help.`);
  }

  const report = (stored: StoredProfile) => {
    const students = (stored.students ?? []).map((s) => s.name);
    if (flags.json) {
      console.log(JSON.stringify({
        status: "ok",
        wilma: stored.tenantName ?? stored.tenantUrl,
        username: stored.username,
        students,
        configPath: getConfigPath(),
      }, null, 2));
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
      throw new Error("Non-interactive login needs --tenant and --username (or WILMA_TENANT / WILMA_USERNAME).");
    }
    const password = flags.passwordStdin ? (await readStdin()).replace(/\r?\n$/, "") : process.env[ENV_VARS.password];
    if (!password) {
      throw new Error(`No password given. Pipe it with --password-stdin or set ${ENV_VARS.password}.`);
    }
    const tenant = await resolveTenant(tenantQuery);
    const totpSecret = flags.totpSecret ?? process.env[ENV_VARS.totpSecret] ?? null;
    const students = await verifyLogin({ tenantUrl: tenant.url, username, password, totpSecret });
    const stored = await saveLogin(await loadConfig(), {
      tenantUrl: tenant.url,
      tenantName: tenant.name,
      username,
      password,
      totpSecret,
      students,
    });
    report(stored);
    return;
  }

  // Browser: a one-time page on 127.0.0.1 where the parent logs in.
  if (flags.browser && openBrowser("about:blank", { dryRun: true }) === "headless") {
    // A cloud computer: the parent can't reach a page served here.
    throw new Error(HEADLESS_LOGIN_HELP);
  }
  const server = await startLoginServer({
    onSaved: (stored) => {
      if (flags.json) return;
      const students = (stored.students ?? []).map((s) => s.name);
      console.log(`\nLogged in to ${stored.tenantName ?? stored.tenantUrl} as ${stored.username}.`);
      if (students.length) console.log(`Children: ${students.join(", ")}`);
      console.log("Add another Wilma in the browser if a child is on a different one, or press Done there (or Enter here) to finish.");
    },
  });
  const opened = flags.browser && openBrowser(server.url) === "opened";
  if (!flags.json) {
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
    throw new Error("Login page closed before logging in. Run `wilma login` again.");
  }
  if (flags.json) {
    console.log(JSON.stringify({
      status: "ok",
      logins: logins.map((stored) => ({
        wilma: stored.tenantName ?? stored.tenantUrl,
        username: stored.username,
        students: (stored.students ?? []).map((s) => s.name),
      })),
      configPath: getConfigPath(),
    }, null, 2));
    return;
  }
  console.log(`\nSaved to ${getConfigPath()}`);
}

const NO_TERMINAL_HELP = [
  "wilma without arguments opens an interactive menu, which needs a terminal.",
  "From an agent or script:",
  "  wilma login                      log in (opens a login page in the user's browser)",
  "  wilma tenants <city or school>   find the user's Wilma address",
  "  wilma summary --all-students --json",
  "See wilma --help for every command.",
].join("\n");

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
async function handleAccounts(args: string[]) {
  const config = await loadConfig();
  const json = args.includes("--json");
  if (args[0] === "remove") {
    const target = args.slice(1).filter((a) => !a.startsWith("--")).join(" ").trim().toLowerCase();
    if (!target) throw new Error("Which login? Use the number from `wilma accounts`, the Wilma name or the username.");
    const byNumber = /^\d+$/.test(target) ? config.profiles[Number(target) - 1] : undefined;
    const matches = byNumber
      ? [byNumber]
      : config.profiles.filter((p) =>
          [p.tenantName ?? "", p.tenantUrl, p.username].some((v) => v.toLowerCase() === target)
        );
    if (matches.length !== 1) {
      throw new Error(matches.length ? `"${target}" matches several logins; use its number.` : `No saved login matches "${target}".`);
    }
    const removed = matches[0];
    config.profiles = config.profiles.filter((p) => p.id !== removed.id);
    if (config.lastProfileId === removed.id) config.lastProfileId = config.profiles[0]?.id ?? null;
    await saveConfig(config);
    console.log(json
      ? JSON.stringify({ status: "removed", wilma: removed.tenantName ?? removed.tenantUrl, username: removed.username })
      : `Removed ${removed.username} @ ${removed.tenantName ?? removed.tenantUrl}.`);
    return;
  }
  const list = config.profiles.map((p, i) => ({
    number: i + 1,
    wilma: p.tenantName ?? p.tenantUrl,
    url: p.tenantUrl,
    username: p.username,
    children: (p.students ?? []).map((st) => st.name),
  }));
  if (json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  if (!list.length) {
    console.log("No saved Wilma logins. Run `wilma login`.");
    return;
  }
  for (const a of list) {
    console.log(`${a.number}. ${a.wilma} — ${a.username}${a.children.length ? ` (${a.children.join(", ")})` : ""}`);
  }
  console.log("\nAdd another with `wilma login`; remove one with `wilma accounts remove <number>`.");
}

async function handleTenants(args: string[]) {
  const json = args.includes("--json");
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 15 : 15;
  const query = args.filter((a, i) => !a.startsWith("--") && !(limitIndex >= 0 && i === limitIndex + 1)).join(" ");
  const tenants = await searchTenants(query, limit);
  if (json) {
    console.log(JSON.stringify(tenants.map((t) => ({ url: t.url, name: t.name })), null, 2));
    return;
  }
  if (!tenants.length) {
    console.log(`No Wilma found for "${query}". Many schools use their city's Wilma: try the city or municipality the school is in.`);
    return;
  }
  for (const t of tenants) console.log(`${t.url}  ${t.name}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/** Commands and the subcommands each accepts (undefined = none given). */
const COMMANDS: Record<string, Array<string | undefined>> = {
  summary: [undefined],
  schedule: [undefined, "list"],
  homework: [undefined, "list"],
  exams: [undefined, "list"],
  grades: [undefined, "list"],
  kids: [undefined, "list"],
  news: [undefined, "list", "read", "resource"],
  messages: [undefined, "list", "read"],
  attendance: [undefined, "list", "summary"],
  gradebook: [undefined, "list"],
  printouts: [undefined, "list", "download"],
};

const MESSAGE_FOLDERS: MessageFolder[] = ["inbox", "archive", "outbox", "drafts", "appointments"];
const WHEN_VALUES = ["today", "tomorrow", "week"] as const;

function parseArgs(args: string[]) {
  const [command, rawSubcommand, ...rawRest] = args;
  // If "subcommand" is actually a flag, push it back into rest
  const subcommand = rawSubcommand?.startsWith("--") ? undefined : rawSubcommand;
  const rest = rawSubcommand?.startsWith("--") ? [rawSubcommand, ...rawRest] : rawRest;
  const flags: {
    json?: boolean;
    limit?: number;
    folder?: MessageFolder;
    id?: string;
    student?: string;
    allStudents?: boolean;
    debug?: boolean;
    when?: (typeof WHEN_VALUES)[number];
    date?: string;
    weekday?: string;
    totpSecret?: string;
    days?: number;
    from?: string;
    to?: string;
    older?: boolean;
    resourceId?: string;
    output?: string;
  } = {};
  const positionals: string[] = [];
  // A flag's value is the next argument, unless that is another flag
  // (`--student --json` must not read "--json" as a name).
  const value = (i: number): string => {
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${rest[i]} needs a value. See wilma --help.`);
    }
    return next;
  };
  const positiveInt = (i: number, max: number): number => {
    const raw = value(i);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new Error(`${rest[i]} must be a whole number from 1 to ${max} (got "${raw}").`);
    }
    return n;
  };
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === "--json") {
      flags.json = true;
      i += 1;
    } else if (arg === "--all-students" || arg === "--all") {
      flags.allStudents = true;
      i += 1;
    } else if (arg === "--debug") {
      flags.debug = true;
      i += 1;
    } else if (arg === "--limit") {
      flags.limit = positiveInt(i, 1000);
      i += 2;
    } else if (arg === "--days") {
      flags.days = positiveInt(i, 365);
      i += 2;
    } else if (arg === "--from") {
      flags.from = parseIsoDate(value(i));
      i += 2;
    } else if (arg === "--to") {
      flags.to = parseIsoDate(value(i));
      i += 2;
    } else if (arg === "--older") {
      flags.older = true;
      i += 1;
    } else if (arg === "--student") {
      flags.student = value(i);
      i += 2;
    } else if (arg === "--folder") {
      const folder = value(i) as MessageFolder;
      if (!MESSAGE_FOLDERS.includes(folder)) {
        throw new Error(`--folder must be one of ${MESSAGE_FOLDERS.join(", ")} (got "${folder}").`);
      }
      flags.folder = folder;
      i += 2;
    } else if (arg === "--when") {
      const when = value(i) as (typeof WHEN_VALUES)[number];
      if (!WHEN_VALUES.includes(when)) {
        throw new Error(`--when must be one of ${WHEN_VALUES.join(", ")} (got "${when}").`);
      }
      flags.when = when;
      i += 2;
    } else if (arg === "--date") {
      flags.date = parseIsoDate(value(i));
      i += 2;
    } else if (arg === "--weekday") {
      flags.weekday = value(i);
      i += 2;
    } else if (arg === "--totp-secret") {
      flags.totpSecret = value(i);
      i += 2;
    } else if (arg === "--output") {
      flags.output = value(i);
      i += 2;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}". See wilma --help.`);
    } else {
      positionals.push(arg);
      i += 1;
    }
  }
  const resourceAction = command === "news" && subcommand === "resource"
    ? positionals[0]
    : undefined;
  if (resourceAction) {
    flags.id = positionals[1];
    flags.resourceId = positionals[2];
  } else {
    flags.id = positionals[0];
  }
  return { command, subcommand, resourceAction, flags };
}

function parseReadId(raw: string | undefined, entity: string): number {
  if (!raw) {
    throw new Error(`Missing ${entity} id. See wilma --help.`);
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${entity} id "${raw}". Expected a positive integer.`);
  }
  return id;
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

async function outputNews(
  client: WilmaClient,
  opts: { limit: number; older?: boolean; json?: boolean; label?: string }
) {
  const news = await client.news.list();
  const slice = selectNews(news, { limit: opts.limit, includeOlder: opts.older });
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  console.log(`\nNews (${news.length})`);
  slice.forEach((item) => {
    const prefix = opts.label ? `[${opts.label}] ` : "";
    console.log(`- ${prefix}${newsLine(item)}`);
  });
  if (!opts.older && news.some((item) => item.archived)) {
    console.log("  Older bulletins: add --older.");
  }
}

/** "2026-09-27 Title (id:1)", marking pinned and older bulletins. */
function newsLine(item: NewsItem): string {
  const date = item.published ? `${finnishDate(item.published)} ` : "";
  const mark = item.pinned ? " [pinned]" : item.archived ? " [older]" : "";
  return `${date}${compactText(item.title)}${mark} (id:${item.wilmaId})`;
}

async function outputNewsItem(
  client: WilmaClient,
  id: number,
  json?: boolean,
  opts?: { studentNumber?: string | null; suppressDownloadHint?: boolean }
) {
  const item = await client.news.get(id);
  if (json) {
    console.log(JSON.stringify(item, null, 2));
    return item;
  }
  console.log(`\n${item.title}`);
  if (item.subtitle) console.log(item.subtitle);
  if (item.published) console.log(finnishDateTime(item.published));
  if (item.content) console.log(`\n${formatContent(item.content)}`);
  if (item.resources?.length) {
    console.log(`\nResources (${item.resources.length})`);
    for (const resource of item.resources) {
      const origin = resource.authContext === "wilma" ? "Wilma" : new URL(resource.url).host;
      console.log(`\n[${resource.id}] ${resource.label} (${origin})`);
      console.log(`    ${resource.url}`);
    }
    if (!opts?.suppressDownloadHint) {
      const student = opts?.studentNumber ?? "<id|name>";
      console.log(
        `\nDownload any resource with:\n  wilma news resource download ${item.wilmaId} <resource-id> --student ${student} --output <directory>`
      );
    }
  }
  return item;
}


/** Save a downloaded file in the output folder (default: the current one), never overwriting. */
async function saveResponseToFile(
  response: {
    headers: { get(name: string): string | null };
    body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> }; cancel(): Promise<void> } | null;
  },
  resource: { id: string; label: string; url: string; fileName?: string | null },
  outputOption?: string
): Promise<{ path: string; contentType: string | null; sizeBytes: number }> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null;
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_NEWS_RESOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error("The file exceeds the 50 MB download limit");
  }

  // "~/Downloads" typed at the interactive prompt (no shell to expand it).
  const output = outputOption?.replace(/^~(?=$|[\\/])/, homedir());
  const outputDirectory = resolve(output ?? process.cwd());
  await mkdir(outputDirectory, { recursive: true });
  const preferredName = fileNameFromResponse(resource as never, response.headers.get("content-disposition"), contentType);
  const { path, handle } = await createUniqueDownloadFile(outputDirectory, preferredName);
  let sizeBytes = 0;
  try {
    if (!response.body) {
      throw new Error("The download had no content");
    }
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_NEWS_RESOURCE_BYTES) {
        await reader.cancel();
        throw new Error("The file exceeds the 50 MB download limit");
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
        if (bytesWritten === 0) {
          throw new Error("Could not write the file to disk");
        }
        offset += bytesWritten;
      }
    }
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true });
    throw error;
  }
  return { path, contentType, sizeBytes };
}

async function outputNewsResourceDownload(
  client: WilmaClient,
  newsId: number,
  resourceId: string,
  opts: { output?: string; json?: boolean }
) {
  const item = await client.news.get(newsId);
  const resource = item.resources?.find((candidate) => candidate.id === resourceId);
  if (!resource) {
    const known = (item.resources ?? []).map((r) => r.id).join(", ") || "none";
    throw new Error(
      `News resource "${resourceId}" not found in news item ${newsId} (available: ${known})`
    );
  }

  const fetched = await client.news.fetchResource(newsId, resourceId, { item });
  if (fetched.status === "not_a_file" || !fetched.response) {
    const result = {
      status: "not_a_file",
      newsId,
      resource,
      availableActions: ["open_in_browser"],
      message:
        "The link answered with a web page instead of a file. It may require signing in — open the URL in a browser instead.",
    };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n${resource.label}`);
      console.log(result.message);
      console.log(resource.url);
    }
    return result;
  }
  const { response } = fetched;
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`News resource download failed with HTTP ${response.status}`);
  }
  const { path, contentType, sizeBytes } = await saveResponseToFile(response, resource, opts.output);

  const result = {
    status: "downloaded",
    newsId,
    resourceId,
    path,
    contentType,
    sizeBytes,
  };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Downloaded ${resource.label} to ${path}`);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Overview-powered output functions                                  */
/* ------------------------------------------------------------------ */

const DAY_NAMES = ["Su", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function outputSchedule(
  client: WilmaClient,
  opts: { when: string; date?: string; weekday?: string; json?: boolean; label?: string }
) {
  const selection = resolveScheduleDateSelection(opts);
  const { when, startDate, endDate } = selection;
  const lessons = await client.schedule.list({ from: startDate, to: endDate });

  if (opts.json) {
    const result = !opts.date && !opts.weekday && when === "week"
      ? { when, weekStart: startDate, weekEnd: endDate, lessons }
      : { when: selection.outputWhen, date: startDate, lessons };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const prefix = opts.label ? `[${opts.label}] ` : "";
  if (opts.date || opts.weekday) {
    console.log(`\n${prefix}Schedule for ${startDate}`);
  } else if (when === "today") {
    console.log(`\n${prefix}Schedule for today (${startDate})`);
  } else if (when === "tomorrow") {
    console.log(`\n${prefix}Schedule for tomorrow (${startDate})`);
  } else {
    console.log(`\n${prefix}Schedule for ${startDate} – ${endDate}`);
  }

  if (!lessons.length) {
    console.log("  No lessons found.");
    return;
  }

  let currentDate = "";
  for (const l of lessons) {
    if (l.date !== currentDate) {
      currentDate = l.date;
      const d = new Date(l.date + "T12:00:00");
      console.log(`  ${DAY_NAMES[d.getDay()]} ${l.date}`);
    }
    const teacher = l.teacherCode ? ` - ${l.teacher}` : "";
    const room = l.room ? `, ${l.room}` : "";
    console.log(`    ${l.start}-${l.end}  ${l.subject}${teacher}${room}`);
  }
}

async function outputHomework(
  client: WilmaClient,
  opts: { limit: number; json?: boolean; label?: string }
) {
  const overview = await client.overview.get();
  const slice = overview.homework.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  const prefix = opts.label ? `[${opts.label}] ` : "";
  console.log(`\n${prefix}Homework (${overview.homework.length})`);
  slice.forEach((hw) => {
    const text = compactText(hw.homework);
    console.log(`- ${hw.date}  ${hw.subject}: ${text}`);
  });
}

async function outputUpcomingExams(
  client: WilmaClient,
  opts: { limit: number; json?: boolean; label?: string }
) {
  const overview = await client.overview.get();
  const slice = overview.upcomingExams.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  const prefix = opts.label ? `[${opts.label}] ` : "";
  console.log(`\n${prefix}Upcoming exams (${overview.upcomingExams.length})`);
  slice.forEach((exam) => {
    const topic = exam.topic ? ` — ${compactText(exam.topic)}` : "";
    console.log(`- ${exam.date}  ${exam.subject}: ${exam.name}${topic}`);
  });
}

async function outputAttendance(
  client: WilmaClient,
  opts: { date?: string; from?: string; to?: string; json?: boolean; label?: string }
) {
  const notes = await client.attendance.list({ date: opts.date, from: opts.from, to: opts.to });
  if (opts.json) {
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  const prefix = opts.label ? `[${opts.label}] ` : "";
  const period = opts.from ? `${opts.from} – ${opts.to}` : (opts.date ?? finnishDate());
  console.log(`\n${prefix}Lesson notes for ${period} (${notes.length})`);
  if (!notes.length) {
    console.log("  No lesson notes found.");
    return;
  }
  notes.forEach((note) => console.log(lessonNoteLine(note, Boolean(opts.from))));
}

/** "- 2026-09-30 (09:00-09:45) [Hyvä!] Teacher [MA_71]: the teacher's words" */
function lessonNoteLine(note: LessonNote, withDate: boolean): string {
  const date = withDate ? ` ${note.date}` : "";
  const time = note.start && note.end ? ` (${note.start}-${note.end})` : "";
  const type = note.typeLabel ? ` [${note.typeLabel}]` : "";
  const teacher = note.teacher ? ` ${note.teacher}` : "";
  const subject = note.subject ? ` [${note.subject}]` : "";
  const words = note.note ? `: ${compactText(note.note)}` : "";
  return `-${date}${time}${type}${teacher}${subject}${words}`;
}

async function outputLessonNoteSummary(
  client: WilmaClient,
  opts: { from?: string; to?: string; json?: boolean; label?: string }
) {
  const summary = await client.attendance.summary({ from: opts.from, to: opts.to });
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(opts.label ? `\n[${opts.label}]` : "");
  printLessonNoteSummary(summary);
}

function printLessonNoteSummary(summary: LessonNoteSummary): void {
  const period = summary.from ? `${summary.from} – ${summary.to}` : "this school year";
  console.log(`Lesson notes, ${period}: ${summary.total} in total`);
  if (!summary.byType.length) console.log("  None.");
  for (const { type, count } of summary.byType) console.log(`  ${type}: ${count}`);
}

function printGradebook(entries: GradebookEntry[], depth = 0): void {
  if (!entries.length && depth === 0) {
    console.log("  No graded courses yet.");
    return;
  }
  for (const entry of entries) {
    const code = entry.code ? `${entry.code} ` : "";
    const grade = entry.grade ? `  ${entry.grade}` : "";
    const credits = entry.credits ? `  (${entry.credits})` : "";
    const date = entry.date ? `  ${entry.date}` : "";
    console.log(`${"  ".repeat(depth + 1)}${code}${compactText(entry.name)}${grade}${credits}${date}`);
    printGradebook(entry.children, depth + 1);
  }
}

function printPrintouts(printouts: Printout[]): void {
  if (!printouts.length) {
    console.log("  No printouts.");
    return;
  }
  for (const p of printouts) console.log(`- ${compactText(p.title)} (id:${p.id})`);
  console.log("Download one with: wilma printouts download <id> [--output <directory>]");
}

/** Run one per-student query for every child and print or return it as JSON. */
async function outputForEachStudent<T>(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  onMfa: MfaCallback | undefined,
  json: boolean | undefined,
  key: string,
  fetch: (client: WilmaClient) => Promise<T>,
  print: (data: T) => void
) {
  const students = await getStudentsForCommand(profile, config);
  const results: { student: StudentInfo; data: T }[] = [];
  for (const student of students) {
    const client = await loginForStudent(student, profile, onMfa);
    results.push({ student, data: await fetch(client) });
  }
  if (json) {
    console.log(JSON.stringify({ students: results.map((r) => ({ student: r.student, [key]: r.data })) }, null, 2));
    return;
  }
  for (const r of results) {
    console.log(`\n[${r.student.name}]`);
    print(r.data);
  }
}

async function outputGrades(
  client: WilmaClient,
  opts: { limit: number; json?: boolean; label?: string }
) {
  const overview = await client.overview.get();
  const slice = overview.grades.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  const prefix = opts.label ? `[${opts.label}] ` : "";
  console.log(`\n${prefix}Grades (${overview.grades.length})`);
  slice.forEach((g) => {
    console.log(`- ${g.date}  ${g.subject}: ${g.name} — ${g.grade}`);
  });
}

async function outputSummary(
  client: WilmaClient,
  opts: { days: number; json?: boolean; label?: string }
) {
  const [overview, news, messages] = await Promise.all([
    client.overview.get(),
    client.news.list(),
    client.messages.list("inbox"),
  ]);

  const summary = buildSummaryData(overview, news, messages, opts.days, opts.label);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const label = summary.student ? ` for ${summary.student}` : "";
  console.log(`\nSummary${label} (${summary.today})`);

  console.log(`\nTODAY (${summary.today})`);
  if (summary.todaySchedule.length) {
    summary.todaySchedule.forEach((l) => {
      console.log(`  ${l.start}-${l.end}  ${l.subject} (${l.subjectCode})`);
    });
  } else {
    console.log("  No lessons today.");
  }

  console.log(`\nTOMORROW (${summary.tomorrow})`);
  if (summary.tomorrowSchedule.length) {
    summary.tomorrowSchedule.forEach((l) => {
      console.log(`  ${l.start}-${l.end}  ${l.subject} (${l.subjectCode})`);
    });
  } else {
    console.log("  No lessons tomorrow.");
  }

  if (summary.upcomingExams.length) {
    console.log("\nUPCOMING EXAMS");
    summary.upcomingExams.forEach((exam) => {
      const topic = exam.topic ? ` — ${compactText(exam.topic)}` : "";
      console.log(`  ${exam.date}  ${exam.subject}: ${exam.name}${topic}`);
    });
  }

  if (summary.recentHomework.length) {
    console.log("\nRECENT HOMEWORK");
    summary.recentHomework.forEach((hw) => {
      console.log(`  ${hw.date}  ${hw.subject}: ${compactText(hw.homework)}`);
    });
  }

  if (summary.recentNews.length) {
    console.log(`\nNEWS (last ${opts.days} days)`);
    summary.recentNews.forEach((n) => {
      const date = n.published ? n.published.slice(0, 10) : "";
      console.log(`  ${date}  ${compactText(n.title)} (id:${n.wilmaId})`);
    });
  }

  if (summary.recentMessages.length) {
    console.log(`\nMESSAGES (last ${opts.days} days)`);
    summary.recentMessages.forEach((m) => {
      const date = m.sentAt.slice(0, 10);
      console.log(`  ${date}  ${compactText(m.subject)} (id:${m.wilmaId})`);
    });
  }
}

async function outputMessages(
  client: WilmaClient,
  opts: { folder: MessageFolder; limit: number; json?: boolean; label?: string }
) {
  const messages = await client.messages.list(opts.folder);
  const slice = messages.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  console.log(`\nMessages (${messages.length})`);
  slice.forEach((msg) => {
    const date = finnishDate(msg.sentAt);
    const prefix = opts.label ? `[${opts.label}] ` : "";
    const sender = msg.senderName ? ` — ${compactText(msg.senderName)}` : "";
    const replies = msg.replyCount ? ` [${msg.replyCount} ${msg.replyCount === 1 ? "reply" : "replies"}]` : "";
    console.log(`- ${prefix}${date} ${compactText(msg.subject)}${sender}${msg.unread ? " [new]" : ""}${replies} (id:${msg.wilmaId})`);
  });
}

async function outputMessageItem(client: WilmaClient, id: number, json?: boolean) {
  const msg = await client.messages.get(id);
  if (json) {
    console.log(JSON.stringify(msg, null, 2));
    return;
  }
  console.log(`\n${msg.subject}`);
  if (msg.senderName) console.log(`From: ${msg.senderName}`);
  if (msg.recipients?.length) console.log(`To: ${msg.recipients.join(", ")}`);
  console.log(`Sent: ${finnishDateTime(msg.sentAt)}`);
  if (msg.content) console.log(`\n${formatContent(msg.content)}`);
  for (const reply of msg.replies ?? []) {
    console.log(`\n--- Reply from ${reply.senderName ?? "unknown"}, ${finnishDateTime(reply.sentAt)}`);
    if (reply.content) console.log(formatContent(reply.content));
  }
}

async function selectNewsToRead(client: WilmaClient) {
  const news = await client.news.list();
  if (!news.length) return;
  const choices = news.slice(0, 30).map((item) => {
    const date = item.published ? finnishDate(item.published) : "";
    return {
      value: String(item.wilmaId),
      name: `${date} ${compactText(item.title)}`.trim(),
    };
  });
  choices.unshift({ value: "back", name: "Back" });
  const selected = await selectOrCancel({
    message: "Read which news item?",
    choices,
  });
  if (!selected || selected === "back") return;
  const item = await outputNewsItem(client, Number(selected), false, { suppressDownloadHint: true });
  if (item?.resources?.length) {
    await offerResourceDownloads(client, item);
  }
}

async function offerResourceDownloads(client: WilmaClient, item: NewsItem) {
  while (true) {
    const resources = item.resources ?? [];
    const choices = [
      { value: "back", name: "Continue" },
      ...resources.map((resource) => ({
        value: resource.id,
        name: `Download "${compactText(resource.label)}"`,
      })),
    ];
    const selected = await selectOrCancel<string>(
      { message: "Resources", choices },
      false
    );
    if (!selected || selected === "back") return;

    const outputDirectory = await inputOrCancel({
      message: "Save to directory",
      default: resolve(homedir(), "Downloads"),
    });
    if (outputDirectory === null) continue;

    try {
      await outputNewsResourceDownload(client, item.wilmaId, selected, {
        output: outputDirectory,
        json: false,
      });
    } catch (error) {
      console.error(
        "Download failed:",
        error instanceof Error ? error.message : error
      );
    }
  }
}

async function selectMessageToRead(client: WilmaClient, folder: MessageFolder) {
  const messages = await client.messages.list(folder);
  if (!messages.length) {
    console.log(`\nNo messages found in ${folder}.`);
    return;
  }
  const choices = messages.slice(0, 30).map((msg) => {
    const date = finnishDate(msg.sentAt);
    return {
      value: String(msg.wilmaId),
      name: `${date} ${compactText(msg.subject)}`.trim(),
    };
  });
  choices.unshift({ value: "back", name: "Back" });
  const selected = await selectOrCancel({
    message: "Read which message?",
    choices,
  });
  if (!selected || selected === "back") return;
  await outputMessageItem(client, Number(selected), false);
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

/** Date and time in Finnish time, e.g. "2026-02-05 14:00". */
function finnishDateTime(d: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${finnishDate(d)} ${time}`;
}

/** One line of text from Wilma, safe for the terminal (prompts don't go through the console filter). */
function compactText(value: string | null | undefined): string {
  return terminalSafe(value ?? "").replace(/\s+/g, " ").trim();
}

function formatContent(value: string): string {
  const lines = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => {
      if (line !== "") return true;
      // Keep a single blank line between blocks
      return arr[index - 1] !== "";
    });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// MFA callback for the current non-interactive command, so student lookups
// (--student, --all-students) also work on two-step-verification accounts.
let commandMfa: MfaCallback | undefined;

// Every saved Wilma login for the current command, and which login each
// listed student came from (children can be on different Wilmas).
let commandAccounts: { profile: WilmaProfile; mfa?: MfaCallback; stored?: StoredProfile }[] = [];
const studentAccount = new WeakMap<StudentInfo, number>();

// One logged-in session per Wilma login for the whole command: listing the
// children and fetching each child's data reuse it instead of logging in again.
const sessions = new Map<string, Promise<WilmaClient>>();
function sessionFor(profile: WilmaProfile, mfa?: MfaCallback): Promise<WilmaClient> {
  const key = `${profile.baseUrl}|${profile.username.toLowerCase()}`;
  let session = sessions.get(key);
  if (!session) {
    session = WilmaClient.login({ ...profile, studentNumber: null }, mfa);
    sessions.set(key, session);
    session.catch(() => sessions.delete(key));
  }
  return session;
}

async function getStudentsForCommand(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null }
): Promise<StudentInfo[]> {
  if (commandAccounts.length > 1) {
    const all: StudentInfo[] = [];
    const seen = new Set<string>();
    const refreshed = new Map<string, { studentNumber: string; name: string }[]>();
    let failures = 0;
    // Different Wilma logins can't cancel each other, so log in to all at once.
    const fetched = await Promise.all(
      commandAccounts.map(async (account) => {
        try {
          return { list: await (await sessionFor(account.profile, account.mfa)).students() };
        } catch (error) {
          return { error };
        }
      })
    );
    for (const [index, account] of commandAccounts.entries()) {
      const result = fetched[index];
      if (!("list" in result) || !result.list) {
        failures += 1;
        const wilma = account.stored?.tenantName ?? account.profile.baseUrl;
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        console.error(`Warning: could not log in to ${wilma}: ${message}`);
        continue;
      }
      let fresh: StudentInfo[] = result.list;
      const stored = config.profiles.find((p) => p.id === account.stored?.id);
      if (stored && fresh.length > 0) {
        refreshed.set(stored.id, fresh.map((s) => ({ studentNumber: s.studentNumber, name: s.name })));
      } else if (!fresh.length) {
        // An empty refresh keeps the saved child list.
        fresh = (stored?.students ?? []).map((st) => ({ ...st, href: `/!${st.studentNumber}/` }));
      }
      for (const student of fresh) {
        const key = `${account.profile.baseUrl}|${student.studentNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tagged = { ...student, wilma: account.stored?.tenantName ?? account.profile.baseUrl };
        studentAccount.set(tagged, index);
        all.push(tagged);
      }
    }
    if (failures === commandAccounts.length) throw new Error("Could not log in to any saved Wilma.");
    await saveStudentLists(refreshed);
    return all;
  }
  const stored = config.profiles.find((p) => p.id === config.lastProfileId);
  const fresh = await (await sessionFor(profile, commandMfa)).students();
  if (stored && fresh.length > 0) {
    stored.students = fresh.map((s) => ({ studentNumber: s.studentNumber, name: s.name }));
    await saveStudentLists(new Map([[stored.id, stored.students]]));
  }
  if (fresh.length > 0) {
    return fresh;
  }
  return (stored?.students ?? []).map((student) => ({
    ...student,
    href: `/!${student.studentNumber}/`,
  }));
}

/**
 * Save refreshed child lists into the config as it is now on disk — logins can
 * take seconds (longer with two-step verification), and a login added in the
 * meantime (e.g. through the MCP login page) must not be overwritten.
 */
async function saveStudentLists(lists: Map<string, { studentNumber: string; name: string }[]>) {
  if (!lists.size) return;
  const latest = await loadConfig();
  let changed = false;
  for (const profile of latest.profiles) {
    const students = lists.get(profile.id);
    if (students) {
      profile.students = students;
      changed = true;
    }
  }
  if (changed) await saveConfig(latest);
}

/** A client for one student, on the session of the Wilma login that student was listed under. */
async function loginForStudent(student: StudentInfo | null | undefined, profile: WilmaProfile, mfa?: MfaCallback) {
  const index = student ? studentAccount.get(student) : undefined;
  if (student && index !== undefined) {
    const account = commandAccounts[index];
    return (await sessionFor(account.profile, account.mfa)).forStudent(student.studentNumber);
  }
  return (await sessionFor(profile, mfa)).forStudent(student?.studentNumber ?? profile.studentNumber ?? null);
}

async function resolveStudentForFlags(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  student?: string
): Promise<StudentInfo | null> {
  if (student) {
    const normalized = student.trim();
    if (/^\d+$/.test(normalized)) {
      // With several Wilmas, use the login whose saved children include this number.
      const accountIndex = commandAccounts.findIndex((a) =>
        a.stored?.students?.some((item) => item.studentNumber === normalized)
      );
      if (commandAccounts.length > 1 && accountIndex >= 0) {
        const account = commandAccounts[accountIndex];
        const cached = account.stored!.students!.find((item) => item.studentNumber === normalized)!;
        const tagged = { studentNumber: normalized, name: cached.name, href: `/!${normalized}/`, wilma: account.stored?.tenantName ?? account.profile.baseUrl };
        studentAccount.set(tagged, accountIndex);
        return tagged;
      }
      const stored = config.profiles.find((p) => p.id === config.lastProfileId);
      const cached = stored?.students?.find((item) => item.studentNumber === normalized);
      return {
        studentNumber: normalized,
        name: cached?.name ?? normalized,
        href: `/!${normalized}/`,
      };
    }
    // Strict, like the agent tools: "Ella" must not pick "Daniella".
    return matchStudents(await getStudentsForCommand(profile, config), normalized)[0];
  }
  const stored = config.profiles.find((p) => p.id === config.lastProfileId);
  if (stored?.lastStudentNumber) {
    return {
      studentNumber: stored.lastStudentNumber,
      name: stored.lastStudentName ?? stored.lastStudentNumber,
      href: `/!${stored.lastStudentNumber}/`,
    };
  }
  const students = await getStudentsForCommand(profile, config);
  return students[0] ?? null;
}

async function outputAllNews(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  limit: number,
  json?: boolean,
  onMfa?: MfaCallback,
  older?: boolean
) {
  const students = await getStudentsForCommand(profile, config);
  const results = [];
  for (const student of students) {
    const client = await loginForStudent(student, profile, onMfa);
    const news = await client.news.list();
    results.push({ student, items: selectNews(news, { limit, includeOlder: older }) });
  }
  if (json) {
    console.log(JSON.stringify({ students: results }, null, 2));
    return;
  }
  results.forEach((entry) => {
    console.log(`\n[${entry.student.name}]`);
    entry.items.forEach((item) => {
      console.log(`- ${newsLine(item)}`);
    });
  });
}

async function outputAllMessages(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  opts: { folder: MessageFolder; limit: number; json?: boolean },
  onMfa?: MfaCallback
) {
  const students = await getStudentsForCommand(profile, config);
  const results = [];
  for (const student of students) {
    const client = await loginForStudent(student, profile, onMfa);
    const messages = await client.messages.list(opts.folder);
    results.push({ student, items: messages.slice(0, opts.limit) });
  }
  if (opts.json) {
    console.log(JSON.stringify({ students: results }, null, 2));
    return;
  }
  results.forEach((entry) => {
    console.log(`\n[${entry.student.name}]`);
    entry.items.forEach((msg) => {
      const date = finnishDate(msg.sentAt);
      console.log(`- ${date} ${msg.subject} (id:${msg.wilmaId})`);
    });
  });
}

async function outputAllExams(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  limit: number,
  json?: boolean,
  onMfa?: MfaCallback
) {
  const students = await getStudentsForCommand(profile, config);
  const results = [];
  for (const student of students) {
    const client = await loginForStudent(student, profile, onMfa);
    const overview = await client.overview.get();
    results.push({ student, items: overview.upcomingExams.slice(0, limit) });
  }
  if (json) {
    console.log(JSON.stringify({ students: results }, null, 2));
    return;
  }
  results.forEach((entry) => {
    console.log(`\n[${entry.student.name}]`);
    entry.items.forEach((exam) => {
      const topic = exam.topic ? ` — ${compactText(exam.topic)}` : "";
      console.log(`- ${exam.date} ${exam.subject}: ${exam.name}${topic}`);
    });
  });
}

async function outputAllAttendance(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  opts: { date?: string; from?: string; to?: string; summary?: boolean; json?: boolean },
  onMfa?: MfaCallback
) {
  if (opts.summary) {
    await outputForEachStudent(profile, config, onMfa, opts.json, "summary", (client) => client.attendance.summary({ from: opts.from, to: opts.to }), printLessonNoteSummary);
    return;
  }
  const students = await getStudentsForCommand(profile, config);
  const results: { student: StudentInfo; notes: LessonNote[] }[] = [];
  for (const student of students) {
    const client = await loginForStudent(student, profile, onMfa);
    const notes = await client.attendance.list({ date: opts.date, from: opts.from, to: opts.to });
    results.push({ student, notes });
  }
  if (opts.json) {
    console.log(JSON.stringify({ students: results.map((r) => ({ student: r.student, items: r.notes })) }, null, 2));
    return;
  }
  for (const r of results) {
    if (!r.notes.length) {
      console.log(`\n[${r.student.name}]  No lesson notes found.`);
      continue;
    }
    console.log(`\n[${r.student.name}]`);
    r.notes.forEach((note) => console.log(lessonNoteLine(note, Boolean(opts.from))));
  }
}

async function outputAllOverviewCommand(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  command: "schedule" | "homework" | "grades" | "summary",
  flags: { json?: boolean; limit?: number; when?: string; date?: string; weekday?: string; days?: number },
  onMfa?: MfaCallback
) {
  const students = await getStudentsForCommand(profile, config);
  if (command === "summary") {
    if (flags.json) {
      const summaries = [];
      for (const student of students) {
        const client = await loginForStudent(student, profile, onMfa);
        const [overview, news, messages] = await Promise.all([
          client.overview.get(),
          client.news.list(),
          client.messages.list("inbox"),
        ]);
        summaries.push({
          student,
          summary: buildSummaryData(overview, news, messages, flags.days ?? 7, student.name),
        });
      }
      console.log(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            students: summaries,
          },
          null,
          2
        )
      );
      return;
    }

    // Human-readable summary output per student
    for (const student of students) {
      const client = await loginForStudent(student, profile, onMfa);
      await outputSummary(client, {
        days: flags.days ?? 7,
        json: false,
        label: student.name,
      });
    }
    return;
  }

  const scheduleSelection = command === "schedule"
    ? resolveScheduleDateSelection(flags)
    : null;
  const results: { student: StudentInfo; data: unknown }[] = [];
  for (const student of students) {
    const client = await loginForStudent(student, profile, onMfa);
    if (command === "schedule" && scheduleSelection) {
      results.push({
        student,
        data: await client.schedule.list({ from: scheduleSelection.startDate, to: scheduleSelection.endDate }),
      });
    } else if (command === "homework") {
      const overview = await client.overview.get();
      results.push({ student, data: overview.homework.slice(0, flags.limit ?? 10) });
    } else if (command === "grades") {
      const overview = await client.overview.get();
      results.push({ student, data: overview.grades.slice(0, flags.limit ?? 20) });
    }
  }

  if (flags.json) {
    console.log(JSON.stringify({ students: results.map((r) => ({ student: r.student, items: r.data })) }, null, 2));
    return;
  }
  for (const r of results) {
    console.log(`\n[${r.student.name}]`);
    const items = r.data as any[];
    if (!items.length) {
      console.log("  (none)");
      continue;
    }
    if (command === "schedule") {
      for (const l of items) {
        console.log(`  ${l.date} ${l.start}-${l.end}  ${l.subject} - ${l.teacher}${l.room ? `, ${l.room}` : ""}`);
      }
    } else if (command === "homework") {
      for (const hw of items) {
        console.log(`  ${hw.date}  ${hw.subject}: ${compactText(hw.homework)}`);
      }
    } else if (command === "grades") {
      for (const g of items) {
        console.log(`  ${g.date}  ${g.subject}: ${g.name} — ${g.grade}`);
      }
    }
  }
}

/** The error for a command that needs one student when the login has several (or none). */
async function studentChoiceError(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null }
): Promise<Error> {
  const students = await getStudentsForCommand(profile, config);
  if (!students.length) return new Error("No students found on this Wilma login.");
  const list = students.map((s) => `${s.studentNumber} ${s.name}`).join(", ");
  return new Error(`Several students on this login (${list}). Use --student <number|name> or --all-students.`);
}

/** Reading one item needs the right student: refuse to guess when there are several. */
async function requireOneStudent(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null }
): Promise<void> {
  const students = await getStudentsForCommand(profile, config);
  if (students.length > 1) {
    const list = students.map((s) => `${s.studentNumber} ${s.name}`).join(", ");
    throw new Error(`Several students on this login (${list}). Use --student <number|name> to say whose item this is.`);
  }
}

main().catch((err) => {
  if (isPromptCancel(err)) {
    process.exit(0);
  }
  if (err instanceof MfaRequiredError && !process.argv.includes("--json")) {
    console.error("Two-step verification is on for this Wilma account.");
    console.error("Run `wilma login` and give the authenticator setup key on the login page,");
    console.error(`or set ${ENV_VARS.totpSecret} to the key (base32 or otpauth:// URI).`);
    console.error("For interactive use, run 'wilma' without arguments.");
    process.exit(1);
  }
  const message = err instanceof MfaRequiredError
    ? `Two-step verification is on for this Wilma account. Run \`wilma login\` and give the authenticator setup key, or set ${ENV_VARS.totpSecret}.`
    : err instanceof Error ? err.message : String(err);
  const isNetwork = err instanceof NetworkError;
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          status: "error",
          message,
          ...(isNetwork && err.code ? { code: err.code } : {}),
          ...(isNetwork && err.hint ? { hint: err.hint } : {}),
        },
        null,
        2
      )
    );
  } else {
    console.error("CLI error:", message);
    if (isNetwork && err.hint) {
      console.error("");
      console.error(err.hint);
    }
  }
  process.exit(1);
});
