// Live check against your own Wilma (needs a saved login: `wilma login`).
// Read-only; prints counts, not content.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cliPath = new URL("../dist/index.js", import.meta.url).pathname;
// The CLI's own default (~/.config/wilmai/config.json), unless overridden.
const env = process.env.WILMAI_CONFIG_PATH
  ? { ...process.env, WILMAI_CONFIG_PATH: resolve(process.env.WILMAI_CONFIG_PATH) }
  : process.env;

let logins = 0;
function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--debug"], { encoding: "utf-8", env });
  logins += (result.stderr.match(/POST \/login/g) ?? []).length;
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${args.join(" ")}: not JSON: ${result.stdout.slice(0, 300)}`);
  }
  if (result.status === 3) {
    console.error("The live test needs a saved login. Run `wilma login` first.");
    process.exit(1);
  }
  if (result.status !== 0) throw new Error(`${args.join(" ")}: ${body.code}: ${body.message}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const perChild = (body, key) => {
  assert(Array.isArray(body.students) && body.students.length >= 1, "expected results per child");
  for (const entry of body.students) assert(entry.student?.studentNumber && key in entry, `missing ${key}`);
  return body.students.map((entry) => entry[key]);
};

console.log("Running live CLI test...");
const { students } = run(["students"]);
assert(students.length >= 1, "expected at least 1 student");

const summary = perChild(run(["summary"]), "summary");
assert(summary.every((s) => Array.isArray(s.lessonNotes) && typeof s.unreadMessages === "number"), "summary sections");
const exams = perChild(run(["exams"]), "exams");
const messages = perChild(run(["messages"]), "messages");
const sentAt = messages.flat()[0]?.sentAt;
assert(!sentAt || /T\d{2}:\d{2}:\d{2}\+0[23]:00$/.test(sentAt), `Finnish time with offset: ${sentAt}`);
const news = perChild(run(["news"]), "news");
const notes = perChild(run(["notes", "--days", "14"]), "notes");
const lessons = perChild(run(["schedule", "week"]), "lessons");
const gradebook = perChild(run(["gradebook"]), "gradebook");

console.log(
  `children ${students.length}; exams ${exams.map((e) => e.length)}; messages ${messages.map((m) => m.length)}; ` +
    `news ${news.map((n) => n.length)}; notes (14 d) ${notes.map((n) => n.length)}; lessons this week ${lessons.map((l) => l.length)}; ` +
    `gradebook subjects ${gradebook.map((g) => g.length)}; logins ${logins}`
);
assert(logins <= 1, `expected at most one login for the whole run, got ${logins}`);
console.log("✅ Live CLI test passed");
