import assert from "node:assert/strict";
import { parseMessageDetailHtml } from "../dist/parsers/messages.js";

function assertDateParts(date, expected) {
  assert.equal(date.getFullYear(), expected.year);
  assert.equal(date.getMonth(), expected.month - 1);
  assert.equal(date.getDate(), expected.day);
  assert.equal(date.getHours(), expected.hour);
  assert.equal(date.getMinutes(), expected.minute);
}

const threadedReplyWithPlainSender = parseMessageDetailHtml(
  `
  <div id="page-content-area" class="panel-body">
    <h1>Threaded reply</h1>
    <table class="proptable">
      <tr><th>Lähettäjä</th><td>Original Sender</td></tr>
      <tr><th>Lähetetty</th><td>01.02.2026 08:00</td></tr>
    </table>
    <div class="ckeditor hidden">Original parent message</div>
    <div class="m-replybox hidden">
      <h2>Reply Sender, 8A vastasi 04.02.2026 12:33</h2>
      <div class="inner hidden">Latest reply from someone else</div>
    </div>
  </div>
`,
  123
);

assert.equal(threadedReplyWithPlainSender.content, "Latest reply from someone else");
assert.equal(threadedReplyWithPlainSender.senderName, "Reply Sender, 8A");
assert.deepEqual(threadedReplyWithPlainSender.sendersJson, {
  senders: [{ Name: "Reply Sender, 8A" }],
});
assertDateParts(threadedReplyWithPlainSender.sentAt, {
  year: 2026,
  month: 2,
  day: 4,
  hour: 12,
  minute: 33,
});

const threadedReplyWithLinkedSender = parseMessageDetailHtml(
  `
  <div id="page-content-area" class="panel-body">
    <h1>Multiple replies</h1>
    <table class="proptable">
      <tr><th>Sender</th><td>Original Sender</td></tr>
      <tr><th>Sent</th><td>01.02.2026 08:00</td></tr>
    </table>
    <div class="ckeditor hidden">Original parent message</div>
    <div class="m-replybox hidden">
      <h2><a class="profile-link" href="/profiles/1">First Sender</a> vastasi 03.02.2026 09:15</h2>
      <div class="inner hidden">Earlier reply</div>
    </div>
    <div class="m-replybox hidden m-replybox-me">
      <h2>Me vastasi 03.02.2026 10:00</h2>
      <div class="inner hidden">Own reply</div>
    </div>
    <div class="m-replybox hidden">
      <h2><a class="profile-link" href="/profiles/2">Latest Sender</a> vastasi 05.02.2026 14:05</h2>
      <div class="inner hidden">Latest reply</div>
    </div>
  </div>
`,
  456
);

assert.equal(threadedReplyWithLinkedSender.content, "Latest reply");
assert.equal(threadedReplyWithLinkedSender.senderName, "Latest Sender");
assert.deepEqual(threadedReplyWithLinkedSender.sendersJson, {
  senders: [{ Name: "Latest Sender", Href: "/profiles/2" }],
});
assertDateParts(threadedReplyWithLinkedSender.sentAt, {
  year: 2026,
  month: 2,
  day: 5,
  hour: 14,
  minute: 5,
});

const selfOnlyThread = parseMessageDetailHtml(
  `
  <div id="page-content-area" class="panel-body">
    <h1>Self-only thread</h1>
    <table class="proptable">
      <tr><th>Sender</th><td>Original Sender</td></tr>
      <tr><th>Sent</th><td>01.02.2026 08:00</td></tr>
    </table>
    <div class="ckeditor hidden">Original parent message</div>
    <div class="m-replybox hidden m-replybox-me">
      <h2>Me vastasi 02.02.2026 10:00</h2>
      <div class="inner hidden">Own reply</div>
    </div>
  </div>
`,
  789
);

assert.equal(selfOnlyThread.content, "Original parent message");
assert.equal(selfOnlyThread.senderName, "Original Sender");
assertDateParts(selfOnlyThread.sentAt, {
  year: 2026,
  month: 2,
  day: 1,
  hour: 8,
  minute: 0,
});

console.log("message parser tests passed");
