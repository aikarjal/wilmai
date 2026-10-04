import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { WilmaClient } from "../dist/index.js";

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, "utf-8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const envPath = process.env.WILMA_ENV_PATH
  ? resolve(process.env.WILMA_ENV_PATH)
  : resolve(new URL("./.env.local", import.meta.url).pathname);

const env = loadEnvFile(envPath);

const required = ["WILMA_BASE_URL", "WILMA_USERNAME", "WILMA_PASSWORD"];
for (const key of required) {
  if (!env[key]) {
    console.error(`Missing required env var ${key}. Provide it via test/.env.local or WILMA_ENV_PATH.`);
    process.exit(1);
  }
}

const profile = {
  baseUrl: env.WILMA_BASE_URL,
  username: env.WILMA_USERNAME,
  password: env.WILMA_PASSWORD,
  studentNumber: env.WILMA_STUDENT_ID ?? null,
};

console.log("Running live Wilma client test...");

// Read-only; prints counts, not content. One login for everything.
const client = await WilmaClient.login({ ...profile, studentNumber: null });
const students = await client.students();
assert(students.length >= 1, "expected at least one student");
for (const [i, student] of students.entries()) {
  const kid = client.forStudent(student.studentNumber);
  const [messages, news, exams, lessons, notes, gradebook] = await Promise.all([
    kid.messages.list("inbox"),
    kid.news.list(),
    kid.exams.upcoming(),
    kid.schedule.list({ from: monday(0), to: monday(4) }),
    kid.attendance.summary(),
    kid.gradebook.get(),
  ]);
  assert(Array.isArray(messages) && Array.isArray(news) && Array.isArray(exams), "lists");
  console.log(
    `student ${i + 1}: messages ${messages.length}, news ${news.length}, upcoming exams ${exams.length} ` +
      `(${exams.filter((e) => e.time).length} timed), lessons this week ${lessons.length}, lesson notes this year ${notes.total}, ` +
      `gradebook subjects ${gradebook.length}`
  );
}
console.log("✅ Live Wilma client test passed");

/** This week's Monday (+ days), YYYY-MM-DD in Finnish time. */
function monday(plus) {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Helsinki" }));
  const d = new Date(today);
  d.setDate(today.getDate() - ((today.getDay() + 6) % 7) + plus);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
