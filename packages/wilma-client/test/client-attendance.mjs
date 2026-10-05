// From Timo Taskinen's pull request #17 (2.0 already requests the exact day).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WilmaClient } from "../dist/index.js";

// Wilma ignores a `date` query parameter on /attendance/view and always
// serves the default four-week view. The page's own custom-range option is
// `range=-3&first=D.M.YYYY&last=D.M.YYYY`, which accepts a single day, so
// that is what the client must request. The server below answers only that
// exact path and 404s everything else, so a wrong request surfaces as an
// empty result rather than a silently-filtered four-week page.

// "Today" is the date in Finland, as in the client, whatever the machine's
// time zone (CI runs in UTC).
const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date());
const [year, month, day] = todayIso.split("-");
const todayFi = `${day}.${month}.${year}`;
// The page prints row dates without leading zeros.
const todayRow = `${Number(day)}.${Number(month)}.${year}`;

function attendancePage(rowDate) {
  return `
<table class="datatable first attendance-single table">
  <thead><tr>
    <th colspan="2">Päivämäärä</th>
    <th class="center">8</th>
    <th class="center">Yhteensä</th>
    <th>Huomioita</th>
  </tr></thead>
  <tbody><tr>
    <td>To</td>
    <td align="right">${rowDate} </td>
    <td class="event at-bl at-tp4" title="LI02; SAIRAUS /Anna Esimerkki">ESIA</td>
    <td class="total">1</td>
    <td>&#160;</td>
  </tr></tbody>
</table>`;
}

const requests = [];

const server = createServer((req, res) => {
  requests.push(req.url);

  if (req.method === "GET" && req.url === "/login") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<input type="hidden" name="SESSIONID" value="test-session">');
    return;
  }

  if (req.method === "POST" && req.url === "/login") {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Set-Cookie": "Wilma2SID=test-cookie; Path=/; HttpOnly",
    });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && req.url === "/attendance/view?range=-3&first=03.09.2026&last=03.09.2026") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(attendancePage("3.9.2026"));
    return;
  }

  if (req.method === "GET" && req.url === `/attendance/view?range=-3&first=${todayFi}&last=${todayFi}`) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(attendancePage(todayRow));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(`Unexpected ${req.method} ${req.url}`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert(address && typeof address === "object");

  const client = await WilmaClient.login({
    baseUrl: `http://127.0.0.1:${address.port}`,
    username: "test-user",
    password: "test-password",
  });

  // Explicit date: must use the custom-range parameters in Finnish format.
  const explicit = await client.attendance.list({ date: "2026-09-03" });
  assert(
    requests.includes("/attendance/view?range=-3&first=03.09.2026&last=03.09.2026"),
    `expected a single-day custom range request, got: ${requests.join(", ")}`
  );
  assert.equal(explicit.length, 1, "the note on the requested day must be returned");
  assert.equal(explicit[0].date, "2026-09-03");
  assert.equal(explicit[0].typeLabel, "SAIRAUS");

  // No date: must default to today's local date, not an empty string that
  // matches no row.
  const defaulted = await client.attendance.list();
  assert(
    requests.includes(`/attendance/view?range=-3&first=${todayFi}&last=${todayFi}`),
    `expected today's custom range request, got: ${requests.join(", ")}`
  );
  assert.equal(defaulted.length, 1, "the note on today's row must be returned when no date is given");
  assert.equal(defaulted[0].date, todayIso);

  // The ignored `date=` parameter must no longer be sent.
  assert(!requests.some((u) => u.includes("date=")), `stale date= request seen: ${requests.join(", ")}`);
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

console.log("client-attendance: all assertions passed");
