"use strict";
const assert = require("assert");
const BASE = "http://127.0.0.1:8799";

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

(async () => {
  const health = await req("/api/health");
  assert.strictEqual(health.status, 200);
  assert.ok(health.data.ok);
  console.log("health", health.data);

  const bad = await req("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "wrong", name: "bad" })
  });
  assert.strictEqual(bad.status, 403);

  const join = await req("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "TEST-CODE", name: "接收手机" })
  });
  assert.strictEqual(join.status, 200);
  assert.ok(join.data.token);
  const deviceId = join.data.device.id;
  const token = join.data.token;
  console.log("joined", deviceId, "latestSeq", join.data.latestSeq);

  const devices = await req("/api/devices", { headers: { "X-Admin-Code": "TEST-ADMIN" } });
  assert.strictEqual(devices.status, 200);
  assert.strictEqual(devices.data.devices.length, 1);

  const book = {
    meta: { title: "共享测试", author: "风页", format: "TXT", chars: 4 },
    chapters: [{ title: "第一章", blocks: [{ t: "p", x: "共享正文" }] }],
    targets: [deviceId],
    sender: "测试发送端"
  };
  const push = await req("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Code": "TEST-ADMIN" },
    body: JSON.stringify(book)
  });
  assert.strictEqual(push.status, 200);
  assert.deepStrictEqual(push.data.delivered, [deviceId]);
  console.log("pushed", push.data);

  const poll = await req("/api/poll?since=" + join.data.latestSeq, {
    headers: { Authorization: "Bearer " + token }
  });
  assert.strictEqual(poll.status, 200);
  assert.strictEqual(poll.data.messages.length, 1);
  assert.strictEqual(poll.data.messages[0].book.title, "共享测试");
  console.log("poll", poll.data);

  const download = await req("/api/books/" + poll.data.messages[0].book.id, {
    headers: { Authorization: "Bearer " + token }
  });
  assert.strictEqual(download.status, 200);
  assert.strictEqual(download.data.chapters[0].blocks[0].x, "共享正文");

  const poll2 = await req("/api/poll?since=" + poll.data.cursor, {
    headers: { Authorization: "Bearer " + token }
  });
  assert.strictEqual(poll2.data.messages.length, 0);
  console.log("SERVER TEST OK");
})().catch((e) => { console.error(e); process.exit(1); });
