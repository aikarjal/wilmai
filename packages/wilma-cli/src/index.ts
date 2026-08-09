#!/usr/bin/env node
import { emitKeypressEvents } from "node:readline";
import { select, input, password } from "@inquirer/prompts";
import { createHmac } from "node:crypto";
import { readFile, writeFile, mkdir, open, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import {
  WilmaClient,
  MfaRequiredError,
  listTenants,
  type MfaCallback,
  type MessageFolder,
  type NewsResource,
  type OverviewData,
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
  { value: "news", name: "List news" },
  { value: "messages", name: "List messages" },
  { value: "exit", name: "Exit" },
];

async function main() {
  const args = process.argv.slice(2);

  // Fire version check early (non-blocking)
  const updateCheck = checkForUpdate();

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

  await runInteractive(config);
  await showUpdateNotice(updateCheck);
}

async function chooseProfile(
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  onMfa?: MfaCallback,
  onStoredProfileResolved?: (sp: StoredProfile) => void
): Promise<WilmaProfile | null> {
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
      onStoredProfileResolved?.(stored);
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

  const profileBase: WilmaProfile = {
    baseUrl: tenant.url,
    username,
    password: passwordValue,
  };

  const students = await WilmaClient.listStudents(profileBase, onMfa);
  const student = await chooseStudent(students);
  if (!student) return null;

  const finalProfile: WilmaProfile = {
    ...profileBase,
    studentNumber: student?.studentNumber ?? undefined,
  };

  const stored: StoredProfile = {
    id: `${tenant.url}|${username}`,
    tenantUrl: tenant.url,
    tenantName: tenant.name,
    username,
    passwordObfuscated: obfuscateSecret(passwordValue),
    students: students.map((s) => ({ studentNumber: s.studentNumber, name: s.name })),
    lastStudentNumber: student?.studentNumber ?? null,
    lastStudentName: student?.name ?? null,
    lastUsedAt: new Date().toISOString(),
  };

  config.profiles = config.profiles.filter((p) => p.id !== stored.id).concat(stored);
  config.lastProfileId = stored.id;
  onStoredProfileResolved?.(stored);
  await saveConfig(config);

  return finalProfile;
}

async function runInteractive(config: { profiles: StoredProfile[]; lastProfileId?: string | null }) {
  const mfaState = { storedProfile: undefined as StoredProfile | undefined };
  const interactiveMfa = createInteractiveMfaCallback(
    () => mfaState.storedProfile,
    () => saveConfig(config)
  );
  while (true) {
    const profile = await chooseProfile(config, interactiveMfa, (sp) => { mfaState.storedProfile = sp; });
    if (!profile) {
      return;
    }
    const client = await WilmaClient.login(profile, interactiveMfa);

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

    let filtered = tenants;
    if (query.trim()) {
      const search = query.trim().toLowerCase();
      filtered = tenants.filter((t) => tenantMatches(search, t));
    }

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

function tenantMatches(search: string, tenant: TenantInfo): boolean {
  const needle = (search ?? "").toLowerCase();
  if (fuzzyIncludes(tenant.name ?? "", needle)) {
    return true;
  }
  if (fuzzyIncludes(tenant.url ?? "", needle)) {
    return true;
  }
  const municipalities = Array.isArray(tenant.municipalities) ? tenant.municipalities : [];
  for (const m of municipalities) {
    if (!m) continue;
    if (fuzzyIncludes(m.nameFi ?? "", needle)) return true;
    if (fuzzyIncludes(m.nameSv ?? "", needle)) return true;
  }
  return false;
}

function fuzzyIncludes(target: string, needle: string): boolean {
  const hay = (target ?? "").toLowerCase();
  const search = (needle ?? "").toLowerCase();
  if (!search) return true;
  if (hay.includes(search)) return true;
  let i = 0;
  for (const ch of hay) {
    if (ch === search[i]) {
      i += 1;
      if (i >= search.length) return true;
    }
  }
  return false;
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
      name: `${s.name} (${s.studentNumber})`,
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
      name: `${s.name} (${s.studentNumber})`,
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
  if (command === "config" && subcommand === "clear") {
    await clearConfig();
    console.log(`Cleared config at ${getConfigPath()}`);
    return;
  }

  const profile = await getProfileForCommandNonInteractive(config, flags);
  if (!profile) return;
  // Use --totp-secret flag, or fall back to stored TOTP secret from config
  let totpSecret = flags.totpSecret;
  if (!totpSecret) {
    const stored = config.profiles.find((p) => p.id === config.lastProfileId);
    if (stored?.totpSecretObfuscated) {
      totpSecret = revealSecret(stored.totpSecretObfuscated) ?? undefined;
    }
  }
  const mfaCallback = createNonInteractiveMfaCallback(totpSecret);
  const client = await WilmaClient.login(profile, mfaCallback);

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
      const resourceId = flags.resourceId;
      if (!resourceId) {
        throw new Error("Missing news resource id (for example, resource-1)");
      }
      if (!flags.student) {
        const students = await getStudentsForCommand(profile, config);
        if (students.length > 1) {
          console.error("Multiple students found. Use --student <id> to specify which one:");
          students.forEach((s) => console.error(`  ${s.studentNumber}  ${s.name}`));
          process.exit(1);
        }
      }
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      if (!studentInfo && !profile.studentNumber) {
        await printStudentSelectionHelp(profile, config);
        return;
      }
      const perStudentClient = await WilmaClient.login({
        ...profile,
        studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
      }, mfaCallback);
      await outputNewsResourceDownload(perStudentClient, newsId, resourceId, {
        output: flags.output,
        json: flags.json,
      });
      return;
    }
    if (subcommand === "read" && flags.id) {
      const newsId = parseReadId(flags.id, "news");
      if (!flags.student) {
        const students = await getStudentsForCommand(profile, config);
        if (students.length > 1) {
          console.error("Multiple students found. Use --student <id> to specify which one:");
          students.forEach((s) => console.error(`  ${s.studentNumber}  ${s.name}`));
          process.exit(1);
        }
      }
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      if (!studentInfo && !profile.studentNumber) {
        await printStudentSelectionHelp(profile, config);
        return;
      }
      const perStudentClient = await WilmaClient.login({
        ...profile,
        studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
      }, mfaCallback);
      await outputNewsItem(perStudentClient, newsId, flags.json);
      return;
    }
    if (flags.allStudents) {
      await outputAllNews(profile, config, flags.limit ?? 20, flags.json, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
    await outputNews(perStudentClient, {
      limit: flags.limit ?? 20,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "messages") {
    if (subcommand === "read" && flags.id) {
      const messageId = parseReadId(flags.id, "message");
      if (!flags.student) {
        const students = await getStudentsForCommand(profile, config);
        if (students.length > 1) {
          console.error("Multiple students found. Use --student <id> to specify which one:");
          students.forEach((s) => console.error(`  ${s.studentNumber}  ${s.name}`));
          process.exit(1);
        }
      }
      const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
      if (!studentInfo && !profile.studentNumber) {
        await printStudentSelectionHelp(profile, config);
        return;
      }
      const perStudentClient = await WilmaClient.login({
        ...profile,
        studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
      }, mfaCallback);
      await outputMessageItem(perStudentClient, messageId, flags.json);
      return;
    }
    if (flags.allStudents) {
      await outputAllMessages(profile, config, {
        folder: (flags.folder as MessageFolder | undefined) ?? "inbox",
        limit: flags.limit ?? 20,
        json: flags.json,
      }, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
    await outputMessages(perStudentClient, {
      folder: (flags.folder as MessageFolder | undefined) ?? "inbox",
      limit: flags.limit ?? 20,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "attendance") {
    if (flags.allStudents) {
      await outputAllAttendance(profile, config, { date: flags.date, json: flags.json }, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
    await outputAttendance(perStudentClient, {
      date: flags.date,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  if (command === "exams") {
    if (flags.allStudents) {
      await outputAllExams(profile, config, flags.limit ?? 20, flags.json, mfaCallback);
      return;
    }
    const studentInfo = await resolveStudentForFlags(profile, config, flags.student);
    if (!studentInfo && !profile.studentNumber) {
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
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
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
    await outputSchedule(perStudentClient, {
      when: (flags.when as "today" | "tomorrow" | "week") ?? "week",
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
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
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
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
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
      await printStudentSelectionHelp(profile, config);
      return;
    }
    const perStudentClient = await WilmaClient.login({
      ...profile,
      studentNumber: studentInfo?.studentNumber ?? profile.studentNumber,
    }, mfaCallback);
    await outputSummary(perStudentClient, {
      days: flags.days ?? 7,
      json: flags.json,
      label: studentInfo?.name ?? undefined,
    });
    return;
  }

  printUsage();
}

function printUsage() {
  console.log("Usage:");
  console.log("  wilma summary [--days 7] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma schedule list [--when today|tomorrow|week] [--date YYYY-MM-DD] [--weekday mon|tue|wed|thu|fri|sat|sun] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma homework list [--limit 10] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma exams list [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma grades list [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma kids list [--json]");
  console.log("  wilma news list [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma news read <id> [--student <id|name>] [--json]");
  console.log("  wilma news resource download <news-id> <resource-id> --student <id|name> --output <directory> [--json]");
  console.log("  wilma messages list [--folder inbox] [--limit 20] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma messages read <id> [--student <id|name>] [--json]");
  console.log("  wilma attendance list [--date YYYY-MM-DD] [--student <id|name>] [--all-students] [--json]");
  console.log("  wilma update");
  console.log("  wilma config clear");
  console.log("  wilma --help | -h");
  console.log("  wilma --version | -v");
  console.log("");
  console.log("MFA: --totp-secret <base32-key|otpauth://...>");
}

async function getProfileForCommandNonInteractive(
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  flags: { debug?: boolean }
): Promise<WilmaProfile | null> {
  if (!config.lastProfileId) {
    console.error("No saved profile found. Run the interactive CLI first.");
    return null;
  }
  const stored = config.profiles.find((p) => p.id === config.lastProfileId);
  if (!stored) {
    console.error("Saved profile not found. Run the interactive CLI first.");
    return null;
  }
  const secret = revealSecret(stored.passwordObfuscated);
  if (!secret) {
    console.error("Stored password could not be decoded. Re-login interactively.");
    return null;
  }
  return {
    baseUrl: stored.tenantUrl,
    username: stored.username,
    password: secret,
    studentNumber: stored.lastStudentNumber ?? undefined,
    debug: Boolean(flags.debug),
  };
}

function parseArgs(args: string[]) {
  const [command, rawSubcommand, ...rawRest] = args;
  // If "subcommand" is actually a flag, push it back into rest
  const subcommand = rawSubcommand?.startsWith("--") ? undefined : rawSubcommand;
  const rest = rawSubcommand?.startsWith("--") ? [rawSubcommand, ...rawRest] : rawRest;
  const flags: {
    json?: boolean;
    limit?: number;
    folder?: string;
    id?: string;
    student?: string;
    allStudents?: boolean;
    debug?: boolean;
    when?: string;
    date?: string;
    weekday?: string;
    totpSecret?: string;
    days?: number;
    resourceId?: string;
    output?: string;
  } = {};
  const positionals: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === "--json") {
      flags.json = true;
      i += 1;
      continue;
    }
    if (arg === "--all-students" || arg === "--all") {
      flags.allStudents = true;
      i += 1;
      continue;
    }
    if (arg === "--debug") {
      flags.debug = true;
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(rest[i + 1]);
      if (!Number.isNaN(value)) {
        flags.limit = value;
      }
      i += 2;
      continue;
    }
    if (arg === "--student") {
      flags.student = rest[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--folder") {
      flags.folder = rest[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--when") {
      flags.when = rest[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--days") {
      const value = Number(rest[i + 1]);
      if (!Number.isNaN(value)) {
        flags.days = value;
      }
      i += 2;
      continue;
    }
    if (arg === "--date") {
      flags.date = rest[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--weekday") {
      flags.weekday = rest[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--totp-secret") {
      flags.totpSecret = rest[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--output") {
      flags.output = rest[i + 1];
      i += 2;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
    i += 1;
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
    console.error(`Missing ${entity} id.`);
    process.exit(1);
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    console.error(`Invalid ${entity} id "${raw}". Expected a positive integer.`);
    process.exit(1);
  }
  return id;
}

function parseIsoDateOrExit(raw: string): string {
  const value = (raw ?? "").trim();
  // Accept YYYY-MM-DD only.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error(`Invalid date "${raw}". Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  // Validate date is real.
  const d = new Date(value + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) {
    console.error(`Invalid date "${raw}". Expected a real calendar date.`);
    process.exit(1);
  }
  const iso = d.toISOString().slice(0, 10);
  if (iso !== value) {
    console.error(`Invalid date "${raw}". Expected a real calendar date.`);
    process.exit(1);
  }
  return value;
}

function normalizeWeekdayOrExit(raw: string): number {
  const v = (raw ?? "").trim().toLowerCase();
  const map: Record<string, number> = {
    sun: 0,
    su: 0,
    sunday: 0,
    mon: 1,
    ma: 1,
    monday: 1,
    tue: 2,
    ti: 2,
    tuesday: 2,
    wed: 3,
    ke: 3,
    wednesday: 3,
    thu: 4,
    to: 4,
    thursday: 4,
    fri: 5,
    pe: 5,
    friday: 5,
    sat: 6,
    la: 6,
    saturday: 6,
  };
  const day = map[v];
  if (day === undefined) {
    console.error(
      `Invalid weekday "${raw}". Use mon|tue|wed|thu|fri|sat|sun (also accepts fi: ma|ti|ke|to|pe|la|su).`
    );
    process.exit(1);
  }
  return day;
}

function nextDateForWeekday(rawWeekday: string): string {
  const target = normalizeWeekdayOrExit(rawWeekday);
  const now = new Date();
  // Use local time.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const current = today.getDay();
  let delta = (target - current + 7) % 7;
  // If you ask for e.g. "thu" on a Saturday, you'll get next Thursday.
  // If you ask for today's weekday, you'll get today.
  const d = new Date(today);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readPackageVersion(): Promise<string> {
  const pkgPath = resolve(dirname(new URL(import.meta.url).pathname), "..", "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const data = JSON.parse(raw) as { version?: string };
  return data.version ?? "unknown";
}

async function handleUpdate(): Promise<void> {
  const currentVersion = await readPackageVersion();
  console.log(`Current version: ${currentVersion}`);
  console.log("Updating @wilm-ai/wilma-cli...\n");

  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "-g", "@wilm-ai/wilma-cli@latest"], {
      stdio: "inherit",
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error("Error: npm not found. Please install npm and try again.");
      } else {
        console.error("Update failed:", err.message);
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("\nUpdate complete.");
        resolve();
      } else {
        console.error(`\nnpm exited with code ${code}`);
        reject(new Error(`npm exited with code ${code}`));
      }
    });
  });
}

// --- Version check / update notification ---

const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getVersionCachePath(): string {
  return resolve(dirname(getConfigPath()), "version-check.json");
}

interface VersionCache {
  latestVersion: string;
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
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache), "utf-8");
}

async function checkForUpdate(): Promise<string | null> {
  try {
    const cache = await readVersionCache();
    if (cache && Date.now() - cache.checkedAt < VERSION_CHECK_INTERVAL_MS) {
      return cache.latestVersion;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(
        "https://registry.npmjs.org/@wilm-ai/wilma-cli/latest",
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (!response.ok) return cache?.latestVersion ?? null;

      const data = (await response.json()) as { version?: string };
      const latestVersion = data.version ?? null;

      if (latestVersion) {
        await writeVersionCache({ latestVersion, checkedAt: Date.now() });
      }

      return latestVersion;
    } catch {
      clearTimeout(timeout);
      return cache?.latestVersion ?? null;
    }
  } catch {
    return null;
  }
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

async function showUpdateNotice(
  versionCheckPromise: Promise<string | null>
): Promise<void> {
  try {
    const latestVersion = await Promise.race([
      versionCheckPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
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
  }
}

async function outputNews(
  client: WilmaClient,
  opts: { limit: number; json?: boolean; label?: string }
) {
  const news = await client.news.list();
  const slice = news.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  console.log(`\nNews (${news.length})`);
  slice.forEach((item) => {
    const date = item.published ? item.published.toISOString().slice(0, 10) : "";
    const prefix = opts.label ? `[${opts.label}] ` : "";
    console.log(`- ${prefix}${date} ${compactText(item.title)} (id:${item.wilmaId})`.trim());
  });
}

async function outputNewsItem(client: WilmaClient, id: number, json?: boolean) {
  const item = await client.news.get(id);
  if (json) {
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  console.log(`\n${item.title}`);
  if (item.subtitle) console.log(item.subtitle);
  if (item.published) console.log(item.published.toISOString());
  if (item.content) console.log(`\n${formatContent(item.content)}`);
  if (item.resources?.length) {
    console.log(`\nResources (${item.resources.length})`);
    item.resources.forEach((resource, index) => {
      const type = resource.kind === "wilma_attachment"
        ? "Wilma attachment"
        : resource.kind === "external_attachment"
          ? "External attachment"
          : "External link";
      console.log(`\n[${index + 1}] ${resource.label}`);
      console.log(`    Type: ${type}`);
      console.log(`    Open: ${resource.url}`);
      if (resource.availableActions.includes("download")) {
        console.log(
          `    Download: wilma news resource download ${item.wilmaId} ${resource.id} --student <id|name> --output <directory>`
        );
      } else if (resource.authContext === "external") {
        console.log("    Note: External authentication may be required.");
      }
    });
  }
}

const MAX_NEWS_RESOURCE_BYTES = 50 * 1024 * 1024;

async function outputNewsResourceDownload(
  client: WilmaClient,
  newsId: number,
  resourceId: string,
  opts: { output?: string; json?: boolean }
) {
  const item = await client.news.get(newsId);
  const resource = item.resources?.find((candidate) => candidate.id === resourceId);
  if (!resource) {
    throw new Error(`News resource "${resourceId}" not found in news item ${newsId}`);
  }

  if (!resource.availableActions.includes("download")) {
    const result = {
      status: "external_access_required",
      newsId,
      resource,
      availableActions: ["open_in_authenticated_browser"],
      message: "This resource is an external link and cannot be downloaded with the Wilma session.",
    };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n${resource.label}`);
      console.log("This resource must be opened with its external authentication context:");
      console.log(resource.url);
    }
    return;
  }

  if (!opts.output) {
    throw new Error("Missing --output <directory> for resource download");
  }

  const fetched = await client.news.fetchResource(newsId, resourceId);
  if (fetched.status === "external_access_required" || !fetched.response) {
    const result = {
      status: "external_access_required",
      newsId,
      resource,
      availableActions: ["open_in_authenticated_browser"],
      message: "The external provider requires authentication that is not available to the CLI.",
    };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.message);
      console.log(resource.url);
    }
    return;
  }
  const { response } = fetched;
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`News resource download failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null;
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_NEWS_RESOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error("News resource exceeds the 50 MB download limit");
  }
  if (contentType === "text/html") {
    const result = {
      status: "not_a_file",
      newsId,
      resource,
      contentType,
      message: "The resource returned an HTML page instead of a downloadable file.",
    };
    await response.body?.cancel();
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.message);
    }
    return;
  }

  const outputDirectory = resolve(opts.output);
  await mkdir(outputDirectory, { recursive: true });
  const preferredName = fileNameFromResponse(resource, response.headers.get("content-disposition"), contentType);
  const { path, handle } = await createUniqueDownloadFile(outputDirectory, preferredName);
  let sizeBytes = 0;
  try {
    if (!response.body) {
      throw new Error("News resource response had no body");
    }
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_NEWS_RESOURCE_BYTES) {
        await reader.cancel();
        throw new Error("News resource exceeds the 50 MB download limit");
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
        if (bytesWritten === 0) {
          throw new Error("Could not write news resource to disk");
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
}

function fileNameFromResponse(
  resource: NewsResource,
  contentDisposition: string | null,
  contentType: string | null
): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition ?? "")?.[1];
  const quoted = /filename="([^"]+)"/i.exec(contentDisposition ?? "")?.[1];
  const plain = /filename=([^;]+)/i.exec(contentDisposition ?? "")?.[1]?.trim();
  let name = encoded ? decodeURIComponentSafely(encoded) : quoted ?? plain ?? resource.fileName ?? resource.label;
  name = sanitizeFileName(name);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    const extension = extensionForContentType(contentType);
    if (extension) name += extension;
  }
  return name || "wilma-resource";
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 180);
}

function extensionForContentType(contentType: string | null): string {
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "text/plain": ".txt",
    "text/csv": ".csv",
  };
  return contentType ? extensions[contentType] ?? "" : "";
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function createUniqueDownloadFile(directory: string, preferredName: string) {
  const dot = preferredName.lastIndexOf(".");
  const hasExtension = dot > 0;
  const stem = hasExtension ? preferredName.slice(0, dot) : preferredName;
  const extension = hasExtension ? preferredName.slice(dot) : "";
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? preferredName : `${stem}-${index}${extension}`;
    const path = resolve(directory, candidate);
    try {
      const handle = await open(path, "wx", 0o600);
      return { path, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error("Could not choose a unique output filename");
}

async function outputExams(
  client: WilmaClient,
  opts: { limit: number; json?: boolean; label?: string }
) {
  const exams = await client.exams.list();
  const slice = exams.slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(slice, null, 2));
    return;
  }
  console.log(`\nExams (${exams.length})`);
  slice.forEach((exam) => {
    const date = exam.examDate.toISOString().slice(0, 10);
    const prefix = opts.label ? `[${opts.label}] ` : "";
    console.log(`- ${prefix}${date} ${compactText(exam.subject)}`);
  });
}

/* ------------------------------------------------------------------ */
/*  Overview-powered output functions                                  */
/* ------------------------------------------------------------------ */

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextSchoolDay(from?: string): string {
  const d = from ? new Date(from + "T12:00:00") : new Date();
  d.setDate(d.getDate() + 1);
  // Skip Saturday (6) and Sunday (0)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentWeekBounds(): [string, string] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [fmt(monday), fmt(friday)];
}

const DAY_NAMES = ["Su", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ScheduleDateSelection = {
  when: string;
  startDate: string;
  endDate: string;
  queryDate?: string;
  outputWhen: string;
};

function resolveScheduleDateSelection(opts: { when?: string; date?: string; weekday?: string }): ScheduleDateSelection {
  const when = opts.when || "week";

  if (opts.date && opts.weekday) {
    console.error("Use either --date or --weekday, not both.");
    process.exit(1);
  }

  if (opts.date) {
    const parsed = parseIsoDateOrExit(opts.date);
    return {
      when,
      startDate: parsed,
      endDate: parsed,
      queryDate: parsed,
      outputWhen: "date",
    };
  }

  if (opts.weekday) {
    const parsed = nextDateForWeekday(opts.weekday);
    return {
      when,
      startDate: parsed,
      endDate: parsed,
      queryDate: parsed,
      outputWhen: "weekday",
    };
  }

  if (when === "today") {
    const date = todayString();
    return { when, startDate: date, endDate: date, outputWhen: when };
  }

  if (when === "tomorrow") {
    const date = nextSchoolDay();
    return { when, startDate: date, endDate: date, outputWhen: when };
  }

  const [startDate, endDate] = currentWeekBounds();
  return { when, startDate, endDate, outputWhen: when };
}

async function outputSchedule(
  client: WilmaClient,
  opts: { when: string; date?: string; weekday?: string; json?: boolean; label?: string }
) {
  const selection = resolveScheduleDateSelection(opts);
  const { when, startDate, endDate } = selection;
  const schedule = await client.schedule.list(
    selection.queryDate ? { date: selection.queryDate } : undefined
  );

  const lessons = schedule.filter(
    (l) => l.date >= startDate && l.date <= endDate
  );

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
    console.log(`    ${l.start}-${l.end}  ${l.subject}${teacher}`);
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
  opts: { date?: string; json?: boolean; label?: string }
) {
  const notes = await client.attendance.list({ date: opts.date });
  if (opts.json) {
    console.log(JSON.stringify(notes, null, 2));
    return;
  }
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const prefix = opts.label ? `[${opts.label}] ` : "";
  console.log(`\n${prefix}Lesson notes for ${date} (${notes.length})`);
  if (!notes.length) {
    console.log("  No lesson notes found.");
    return;
  }
  notes.forEach((note) => {
    const time = note.start && note.end ? ` (${note.start}-${note.end})` : "";
    const type = note.typeLabel ? ` [${note.typeLabel}]` : "";
    const teacher = note.teacher ? ` ${note.teacher}` : "";
    const subject = note.subject ? ` [${note.subject}]` : "";
    console.log(`-${time}${type}${teacher}${subject}`);
  });
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

function buildSummaryData(
  overview: OverviewData,
  news: Awaited<ReturnType<WilmaClient["news"]["list"]>>,
  messages: Awaited<ReturnType<WilmaClient["messages"]["list"]>>,
  days: number,
  studentLabel?: string
) {
  const today = todayString();
  const tomorrow = nextSchoolDay();
  const cutoffDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const homeworkCutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const todaySchedule = overview.schedule.filter((l) => l.date === today);
  const tomorrowSchedule = overview.schedule.filter((l) => l.date === tomorrow);
  const upcomingExams = overview.upcomingExams;
  const recentHomework = overview.homework.filter((h) => h.date >= homeworkCutoff);
  const recentNews = news
    .filter((n) => n.published && n.published.toISOString().slice(0, 10) >= cutoffDate)
    .slice(0, 5)
    .map((n) => ({
      wilmaId: n.wilmaId,
      title: n.title,
      published: n.published?.toISOString() ?? null,
    }));
  const recentMessages = messages
    .filter((m) => m.sentAt.toISOString().slice(0, 10) >= cutoffDate)
    .slice(0, 5)
    .map((m) => ({
      wilmaId: m.wilmaId,
      subject: m.subject,
      sentAt: m.sentAt.toISOString(),
      senderName: m.senderName ?? null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    student: studentLabel ?? null,
    today,
    tomorrow,
    todaySchedule,
    tomorrowSchedule,
    upcomingExams,
    recentHomework,
    recentNews,
    recentMessages,
  };
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
    const date = msg.sentAt.toISOString().slice(0, 10);
    const prefix = opts.label ? `[${opts.label}] ` : "";
    console.log(`- ${prefix}${date} ${compactText(msg.subject)} (id:${msg.wilmaId})`);
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
  console.log(`Sent: ${msg.sentAt.toISOString()}`);
  if (msg.content) console.log(`\n${formatContent(msg.content)}`);
}

async function selectNewsToRead(client: WilmaClient) {
  const news = await client.news.list();
  if (!news.length) return;
  const choices = news.slice(0, 30).map((item) => {
    const date = item.published ? item.published.toISOString().slice(0, 10) : "";
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
  await outputNewsItem(client, Number(selected), false);
}

async function selectMessageToRead(client: WilmaClient, folder: MessageFolder) {
  const messages = await client.messages.list(folder);
  if (!messages.length) {
    console.log(`\nNo messages found in ${folder}.`);
    return;
  }
  const choices = messages.slice(0, 30).map((msg) => {
    const date = msg.sentAt.toISOString().slice(0, 10);
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

function createInteractiveMfaCallback(
  getStoredProfile?: () => StoredProfile | undefined,
  saveProfile?: () => Promise<void>
): MfaCallback {
  let lastCode: string | null = null;
  let lastCodeTime = 0;
  return async (_formkey: string): Promise<string> => {
    // TOTP codes are valid for 30s; reuse if within the same window
    const now = Math.floor(Date.now() / 30000);
    if (lastCode && now === lastCodeTime) {
      return lastCode;
    }

    // If a TOTP secret is stored, auto-generate
    const stored = getStoredProfile?.();
    if (stored?.totpSecretObfuscated) {
      const secret = revealSecret(stored.totpSecretObfuscated);
      if (secret) {
        const code = generateTOTP(parseTotpSecret(secret));
        lastCode = code;
        lastCodeTime = now;
        return code;
      }
    }

    const choice = await select({
      message: "MFA required. Choose how to authenticate:",
      choices: [
        { value: "code", name: "Enter one-time code from authenticator app" },
        { value: "secret", name: "Save TOTP secret for automatic login" },
      ],
    });

    if (choice === "secret") {
      const secretInput = await input({
        message: "Paste TOTP secret (base32 key or otpauth:// URI)",
      });
      if (!secretInput) throw new Error("MFA cancelled");
      const secret = parseTotpSecret(secretInput.trim());
      // Save to config
      if (stored && saveProfile) {
        stored.totpSecretObfuscated = obfuscateSecret(secretInput.trim());
        await saveProfile();
      }
      const code = generateTOTP(secret);
      lastCode = code;
      lastCodeTime = now;
      return code;
    }

    const code = await input({ message: "Enter MFA code from authenticator app" });
    if (!code) throw new Error("MFA cancelled");
    lastCode = code.trim();
    lastCodeTime = now;
    return lastCode;
  };
}

function createNonInteractiveMfaCallback(totpSecret?: string): MfaCallback | undefined {
  if (!totpSecret) return undefined;
  const secret = parseTotpSecret(totpSecret);
  return async (_formkey: string): Promise<string> => {
    const code = generateTOTP(secret);
    return code;
  };
}

function parseTotpSecret(raw: string): string {
  // Accept either a bare base32 key or an otpauth:// URI
  if (raw.startsWith("otpauth://")) {
    const url = new URL(raw);
    const secret = url.searchParams.get("secret");
    if (!secret) {
      console.error("No 'secret' parameter found in otpauth:// URI.");
      process.exit(1);
    }
    return secret;
  }
  return raw.replace(/[\s-]/g, "");
}

function generateTOTP(secret: string): string {
  // TOTP: RFC 6238 — HMAC-SHA1 based, 6-digit, 30-second period
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  // Decode base32 secret
  const cleanSecret = secret.replace(/[\s=-]+/g, "").toUpperCase();
  let bits = "";
  for (const c of cleanSecret) {
    const val = base32Chars.indexOf(c);
    if (val === -1) throw new Error(`Invalid base32 character: ${c}`);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }

  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", Buffer.from(bytes));
  hmac.update(counterBuf);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, "0");
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

function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

async function getStudentsForCommand(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null }
): Promise<StudentInfo[]> {
  const stored = config.profiles.find((p) => p.id === config.lastProfileId);
  const fresh = await WilmaClient.listStudents(profile);
  if (stored) {
    stored.students = fresh.map((s) => ({ studentNumber: s.studentNumber, name: s.name }));
    await saveConfig(config);
  }
  return fresh;
}

async function resolveStudentForFlags(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null },
  student?: string
): Promise<StudentInfo | null> {
  if (student) {
    const students = await getStudentsForCommand(profile, config);
    const exact = students.find((s) => s.studentNumber === student);
    if (exact) return exact;
    const needle = student.toLowerCase();
    const substring = students.find((s) => s.name.toLowerCase().includes(needle));
    if (substring) return substring;
    const match = students.find((s) => fuzzyIncludes(s.name, student));
    if (match) return match;
    // No match found - show available students and exit
    console.error(`Error: No student matching "${student}" found.`);
    if (students.length > 0) {
      console.error("Available students:");
      students.forEach((s) => console.error(`  ${s.studentNumber}  ${s.name}`));
    }
    process.exit(1);
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
  onMfa?: MfaCallback
) {
  const students = await getStudentsForCommand(profile, config);
  const results = [];
  for (const student of students) {
    const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
    const news = await client.news.list();
    results.push({ student, items: news.slice(0, limit) });
  }
  if (json) {
    console.log(JSON.stringify({ students: results }, null, 2));
    return;
  }
  results.forEach((entry) => {
    console.log(`\n[${entry.student.name}]`);
    entry.items.forEach((item) => {
      const date = item.published ? item.published.toISOString().slice(0, 10) : "";
      console.log(`- ${date} ${item.title} (id:${item.wilmaId})`.trim());
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
    const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
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
      const date = msg.sentAt.toISOString().slice(0, 10);
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
    const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
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
  opts: { date?: string; json?: boolean },
  onMfa?: MfaCallback
) {
  const students = await getStudentsForCommand(profile, config);
  const results: { student: StudentInfo; notes: Awaited<ReturnType<WilmaClient["attendance"]["list"]>> }[] = [];
  for (const student of students) {
    const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
    const notes = await client.attendance.list({ date: opts.date });
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
    r.notes.forEach((note) => {
      const time = note.start && note.end ? ` (${note.start}-${note.end})` : "";
      const type = note.typeLabel ? ` [${note.typeLabel}]` : "";
      const teacher = note.teacher ? ` ${note.teacher}` : "";
      const subject = note.subject ? ` [${note.subject}]` : "";
      console.log(`-${time}${type}${teacher}${subject}`);
    });
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
        const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
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
      const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
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
    const client = await WilmaClient.login({ ...profile, studentNumber: student.studentNumber }, onMfa);
    if (command === "schedule" && scheduleSelection) {
      const schedule = await client.schedule.list(
        scheduleSelection.queryDate ? { date: scheduleSelection.queryDate } : undefined
      );
      results.push({
        student,
        data: schedule.filter(
          (l) => l.date >= scheduleSelection.startDate && l.date <= scheduleSelection.endDate
        ),
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
        console.log(`  ${l.date} ${l.start}-${l.end}  ${l.subject} - ${l.teacher}`);
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

async function printStudentSelectionHelp(
  profile: WilmaProfile,
  config: { profiles: StoredProfile[]; lastProfileId?: string | null }
) {
  const students = await getStudentsForCommand(profile, config);
  console.error("Multiple students found. Use --student <id|name> or --all-students.");
  students.forEach((s) => {
    console.error(`- ${s.studentNumber} ${s.name}`);
  });
}

main().catch((err) => {
  if (isPromptCancel(err)) {
    process.exit(0);
  }
  if (err instanceof MfaRequiredError) {
    console.error("MFA is enabled on this Wilma account.");
    console.error("For non-interactive use, provide your TOTP secret:");
    console.error("  --totp-secret <base32-key>");
    console.error("  --totp-secret 'otpauth://totp/...'");
    console.error("Tip: export the key from your authenticator app (base32 string or otpauth:// URI).");
    console.error("For interactive use, run 'wilma' without arguments.");
    process.exit(1);
  }
  console.error("CLI error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
