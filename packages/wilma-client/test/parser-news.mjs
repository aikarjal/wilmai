import assert from "node:assert/strict";
import { parseNewsDetailHtml } from "../dist/parsers/news.js";

// Regression: link-only bulletins (e.g. a SharePoint PDF loaded into the
// #content-wrapper iframe) previously lost their payload because cheerio's
// .text() drops href URLs, leaving only header/footer. The parser must inline
// anchor URLs so the actionable link survives.
const linkOnly = parseNewsDetailHtml(
  `
  <html><head><title>Lukuvuositiedote 2026-27 - Wilma</title></head><body>
    <main id="main-content">
      <div class="panel">
        <div class="panel-body">
          <h2>Lukuvuositiedote 2026-27</h2>
          <div class="margin-bottom hidden" id="news-content">
            <p><a href="https://example.sharepoint.com/doc.pdf">Lukuvuositiedote 2026-27</a></p>
          </div>
          <div class="panel-body-padding-remover">
            <iframe id="content-wrapper"></iframe>
          </div>
          <hr>
          <div class="margin-bottom">Opettajille, huoltajille ja johtokunnalle</div>
        </div>
      </div>
    </main>
  </body></html>
`,
  72486
);

assert.equal(linkOnly.title, "Lukuvuositiedote 2026-27");
assert.ok(
  linkOnly.content?.includes("https://example.sharepoint.com/doc.pdf"),
  `expected content to contain the SharePoint URL, got: ${linkOnly.content}`
);
assert.ok(
  linkOnly.content?.includes("Lukuvuositiedote 2026-27 (https://example.sharepoint.com/doc.pdf)"),
  `expected inlined "label (url)" form, got: ${linkOnly.content}`
);

// Prose bulletins must be unaffected: normal text still extracted cleanly,
// and a link whose visible text already equals its URL is not duplicated.
const prose = parseNewsDetailHtml(
  `
  <html><head><title>Lukuvuosi alkaa - Wilma</title></head><body>
    <div class="panel-body">
      <h2>Lukuvuosi alkaa</h2>
      <p>Koulutyo alkaa keskiviikkona 12.8.2026. Tervetuloa kouluun!</p>
      <p>Lisatietoa: <a href="https://kruna.fi">https://kruna.fi</a></p>
    </div>
  </body></html>
`,
  72456
);

assert.ok(prose.content?.includes("Koulutyo alkaa keskiviikkona 12.8.2026"));
assert.ok(prose.content?.includes("https://kruna.fi"));
// No duplication when label === href.
assert.equal(
  (prose.content?.match(/https:\/\/kruna\.fi/g) ?? []).length,
  1,
  `expected the bare-URL link to appear exactly once, got: ${prose.content}`
);

// Anchors with empty/anchor/js hrefs are left alone (no "(#)" noise).
const skipHrefs = parseNewsDetailHtml(
  `
  <div class="panel-body">
    <p>See <a href="#top">top</a> or <a href="javascript:void(0)">action</a>.</p>
  </div>
`,
  1
);
assert.ok(!skipHrefs.content?.includes("(#top)"));
assert.ok(!skipHrefs.content?.includes("javascript:"));
assert.ok(skipHrefs.content?.includes("top"));

console.log("parser-news: all assertions passed");
