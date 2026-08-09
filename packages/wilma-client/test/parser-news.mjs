import assert from "node:assert/strict";
import { parseNewsDetailHtml, parseNewsDetailJson } from "../dist/parsers/news.js";

// Regression: link-only bulletins can hide their real payload in #news-content
// while Wilma renders an empty iframe. Preserve the link as a structured
// resource and do not mistake the surrounding panel metadata for body prose.
const linkOnly = parseNewsDetailHtml(
  `
  <html><head><title>Lukuvuositiedote 2026-27 - Wilma</title></head><body>
    <main id="main-content">
      <div class="panel">
        <div class="panel-body">
          <h2>Lukuvuositiedote 2026-27</h2>
          <div class="margin-bottom hidden" id="news-content">
            <p><a href="https://files.example.com/share/token?e=abc">Lukuvuositiedote 2026-27</a></p>
          </div>
          <div class="panel-body-padding-remover">
            <iframe id="content-wrapper"></iframe>
          </div>
          <hr>
          <div class="margin-bottom">Opettajille, huoltajille ja johtokunnalle</div>
          <a href="/news/999">Unrelated surrounding news link</a>
        </div>
      </div>
    </main>
  </body></html>
`,
  72486,
  "https://helsinki.inschool.fi/!123/news/72486"
);

assert.equal(linkOnly.title, "Lukuvuositiedote 2026-27");
assert.equal(linkOnly.content, null);
assert.deepEqual(linkOnly.resources, [
  {
    id: "resource-1",
    label: "Lukuvuositiedote 2026-27",
    url: "https://files.example.com/share/token?e=abc",
    authContext: "external",
    fileName: null,
  },
]);

// Prose remains prose, while its external link is also available to agents as
// a structured resource. Bare URL labels are not duplicated in content.
const prose = parseNewsDetailHtml(
  `
  <html><head><title>Lukuvuosi alkaa - Wilma</title></head><body>
    <div id="news-content">
      <p>Koulutyo alkaa keskiviikkona 12.8.2026. Tervetuloa kouluun!</p>
      <p>Lisatietoa: <a href="https://kruna.fi">https://kruna.fi</a></p>
    </div>
  </body></html>
`,
  72456,
  "https://helsinki.inschool.fi/!123/news/72456"
);

assert.ok(prose.content?.includes("Koulutyo alkaa keskiviikkona 12.8.2026"));
assert.equal((prose.content?.match(/https:\/\/kruna\.fi/g) ?? []).length, 1);
assert.equal(prose.resources?.length, 1);
assert.equal(prose.resources?.[0]?.url, "https://kruna.fi/");
assert.equal(prose.resources?.[0]?.authContext, "external");
assert.equal(prose.resources?.[0]?.fileName, null);

// Wilma-hosted links use the Wilma session for downloads. Relative links are
// resolved so JSON consumers receive an actionable absolute URL, duplicates
// collapse, and file-looking paths yield a naming hint.
const attachment = parseNewsDetailHtml(
  `
  <div id="news-content">
    <p>Tayta lupa ennen perjantaita.</p>
    <a href="/files/123/retkilupa.pdf" download>Retkilupa</a>
    <a href="/files/123/retkilupa.pdf">Duplicate</a>
  </div>
`,
  42,
  "https://helsinki.inschool.fi/!123/news/42"
);

assert.equal(attachment.resources?.length, 1);
assert.deepEqual(attachment.resources?.[0], {
  id: "resource-1",
  label: "Retkilupa",
  url: "https://helsinki.inschool.fi/files/123/retkilupa.pdf",
  authContext: "wilma",
  fileName: "retkilupa.pdf",
});

// The file-name hint applies to external hosts too — it is only a hint for
// naming, never a gate on whether a download may be attempted.
const externalFile = parseNewsDetailHtml(
  `
  <div id="news-content">
    <a href="https://cdn.example.net/docs/erityisruokavaliokuvaus.pdf">Koulujen erityisruokavaliot</a>
  </div>
`,
  72470,
  "https://helsinki.inschool.fi/!123/news/72470"
);
assert.equal(externalFile.resources?.[0]?.authContext, "external");
assert.equal(externalFile.resources?.[0]?.fileName, "erityisruokavaliokuvaus.pdf");

// Fragment, JavaScript, data, and mail links remain ordinary visible text but
// never become actions exposed to an agent.
const unsafeHrefs = parseNewsDetailHtml(
  `
  <div id="news-content">
    <p>See <a href="#top">top</a>, <a href="JaVaScRiPt:void(0)">action</a>,
    <a href="data:text/plain,nope">data</a>, or <a href="mailto:test@example.com">email</a>.</p>
  </div>
`,
  1,
  "https://helsinki.inschool.fi/!123/news/1"
);
assert.deepEqual(unsafeHrefs.resources, []);
assert.ok(unsafeHrefs.content?.includes("top"));
assert.ok(!unsafeHrefs.content?.includes("javascript:"));

// Tenants that serve news detail as JSON still expose resources when the
// content payload is HTML with anchors.
const jsonDetail = parseNewsDetailJson(
  7,
  {
    title: "JSON-tiedote",
    content: '<p>Katso <a href="/files/7/liite.pdf">liite</a>.</p>',
  },
  "https://helsinki.inschool.fi/!123/news/7"
);
assert.equal(jsonDetail.resources?.length, 1);
assert.equal(jsonDetail.resources?.[0]?.url, "https://helsinki.inschool.fi/files/7/liite.pdf");
assert.equal(jsonDetail.resources?.[0]?.authContext, "wilma");
assert.equal(jsonDetail.resources?.[0]?.fileName, "liite.pdf");

console.log("parser-news: all assertions passed");
