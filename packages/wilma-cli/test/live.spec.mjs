import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const cli = ["node", "dist/index.js"];
// The CLI's own default (~/.config/wilmai/config.json), unless overridden.
const env = process.env.WILMAI_CONFIG_PATH
  ? { ...process.env, WILMAI_CONFIG_PATH: resolve(process.env.WILMAI_CONFIG_PATH) }
  : process.env;

function run(args) {
  const result = execFileSync(cli[0], [...cli.slice(1), ...args], {
    encoding: "utf-8",
    env,
  });
  return result.trim();
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (err) {
    console.error(`Failed to parse JSON for ${label}:`, output.slice(0, 500));
    throw err;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasProfileError(output) {
  return output.includes("No saved profile found") || output.includes("Saved profile not found");
}

console.log("Running live CLI test...");

const kidsOut = run(["kids", "list", "--json"]);
if (hasProfileError(kidsOut)) {
  console.error("Live CLI test requires a saved profile. Run the interactive CLI first.");
  process.exit(1);
}
const kids = parseJson(kidsOut, "kids list");
assert(Array.isArray(kids), "kids list should return array");
assert(kids.length >= 1, "expected at least 1 student");

const first = kids[0];
assert(first.studentNumber, "studentNumber missing");

const examsOut = run(["exams", "list", "--student", first.studentNumber, "--json"]);
const exams = parseJson(examsOut, "exams list");
assert(Array.isArray(exams), "exams list should return array");

const messagesOut = run([
  "messages",
  "list",
  "--student",
  first.studentNumber,
  "--folder",
  "inbox",
  "--json",
]);
const messages = parseJson(messagesOut, "messages list");
assert(Array.isArray(messages), "messages list should return array");

const newsOut = run(["news", "list", "--student", first.studentNumber, "--json"]);
const news = parseJson(newsOut, "news list");
assert(Array.isArray(news), "news list should return array");

console.log("✅ Live CLI test passed");
