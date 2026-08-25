import assert from "node:assert/strict";
import {
  parseStudentsFromHome,
  parseStudentFromUrl,
  parseStudentsFromRolesIndex,
  parseStudentsFromAccountsRoles,
} from "../dist/parsers/students.js";

const relative = parseStudentsFromHome(`
  <a href="/!12345678/"><span>Ada Example</span><small>3J</small></a>
  <a href="/!12345678/messages">Viestit</a>
`);
assert.equal(relative.length, 1);
assert.equal(relative[0].studentNumber, "12345678");
assert.equal(relative[0].name, "Ada Example");

const absolute = parseStudentsFromHome(`
  <a href="https://example.inschool.fi/!12345678/">Ada Example</a>
`);
assert.equal(absolute.length, 1);
assert.equal(absolute[0].studentNumber, "12345678");

const navOnly = parseStudentsFromHome(`
  <a href="/!12345678/messages">Viestit</a>
  <a href="/!12345678/schedule">Lukujärjestys</a>
`);
assert.equal(navOnly.length, 1);
assert.equal(navOnly[0].studentNumber, "12345678");

const fromUrl = parseStudentsFromHome("<html></html>", "https://example.inschool.fi/!12345678/");
assert.equal(fromUrl.length, 1);
assert.equal(fromUrl[0].studentNumber, "12345678");

assert.equal(parseStudentFromUrl("https://example.inschool.fi/!12345678/")?.studentNumber, "12345678");

const roles = parseStudentsFromRolesIndex({
  Roles: [{ Name: "Ada Example", Type: 1, Slug: "!12345678" }],
});
assert.equal(roles.length, 1);
assert.equal(roles[0].studentNumber, "12345678");
assert.equal(roles[0].name, "Ada Example");

const noTrailingSlash = parseStudentsFromHome(`
  <a href="/!12345678">Ada Example</a>
`);
assert.equal(noTrailingSlash.length, 1);
assert.equal(noTrailingSlash[0].studentNumber, "12345678");
assert.equal(noTrailingSlash[0].name, "Ada Example");

const accountsRoles = parseStudentsFromAccountsRoles({
  statusCode: 200,
  payload: [
    { name: "Account", type: "passwd", primusId: 1, formKey: "x", slug: "", schools: [] },
    { name: "Ada Example", type: "guardian", primusId: 12345678, formKey: "y", slug: "/!12345678", schools: [] },
  ],
});
assert.equal(accountsRoles.length, 1);
assert.equal(accountsRoles[0].studentNumber, "12345678");
assert.equal(accountsRoles[0].name, "Ada Example");
assert.equal(accountsRoles[0].href, "/!12345678/");

const accountsRolesRaw = parseStudentsFromAccountsRoles([
  { name: "Account", type: "passwd", slug: "" },
  { name: "Ada Example", type: "guardian", slug: "!12345678" },
]);
assert.equal(accountsRolesRaw.length, 1);
assert.equal(accountsRolesRaw[0].studentNumber, "12345678");
assert.equal(accountsRolesRaw[0].name, "Ada Example");

const accountsRolesType7 = parseStudentsFromAccountsRoles({
  payload: [
    { name: "Account", type: 7, slug: "/!00000000" },
    { name: "Ada Example", type: "guardian", slug: "/!12345678" },
  ],
});
assert.equal(accountsRolesType7.length, 1);
assert.equal(accountsRolesType7[0].studentNumber, "12345678");

console.log("student parser tests passed");
