require("../../helpers/setupDb");

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable, Writable } = require("node:stream");

const { app } = require("../../../src/server");
const { activityDb, userDb } = require("../../../src/database");
const { generateToken } = require("../../../src/auth");

async function injectJson(method, url, body, headers = {}) {
  const raw = typeof body === "undefined" ? "" : JSON.stringify(body);
  const req = new Readable({
    read() {
      this.push(raw);
      this.push(null);
    },
  });
  req.method = method;
  req.url = url;
  req.headers = {
    "content-type": "application/json",
    ...(raw ? { "content-length": String(Buffer.byteLength(raw)) } : {}),
    ...(headers || {}),
  };
  req.connection = { remoteAddress: "127.0.0.1" };

  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });

  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[String(k).toLowerCase()] = v;
  };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.removeHeader = (k) => {
    delete res.headers[String(k).toLowerCase()];
  };
  res.writeHead = (code, hdrs) => {
    res.statusCode = code;
    if (hdrs && typeof hdrs === "object") {
      for (const [k, v] of Object.entries(hdrs)) res.setHeader(k, v);
    }
    return res;
  };
  res.end = (chunk) => {
    if (typeof chunk !== "undefined") {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    Writable.prototype.end.call(res);
  };

  const done = new Promise((resolve) => res.on("finish", resolve));
  app.handle(req, res);
  await done;

  const text = Buffer.concat(chunks).toString("utf8");
  const json = text ? JSON.parse(text) : null;
  return { status: res.statusCode, json };
}

function createUserAndToken(suffix) {
  const username = `u_${suffix}`;
  const email = `u_${suffix}@example.com`;
  const userId = userDb.create(username, email, "hash", `User ${suffix}`);
  const token = generateToken(userId, username, email);
  return { userId, token };
}

test("community activities: owner can publish, and listing + detail are public", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { token, userId } = createUserAndToken(suffix);

  const activityId = `act_${crypto.randomUUID()}`;
  activityDb.create(activityId, userId, "My Activity", JSON.stringify([{ id: "p1" }, { id: "p2" }]), "Prompt", {
    status: "PUBLISHED",
    timeLimitSeconds: null,
  });

  const publish = await injectJson(
    "POST",
    `/activities/${activityId}/community/publish`,
    { summary: "A fun set of problems", tags: ["cpp", "graphs"] },
    { authorization: `Bearer ${token}` }
  );
  assert.equal(publish.status, 200);
  assert.equal(publish.json.ok, true);
  assert.ok(publish.json.communityPublishedAt);

  const stored = activityDb.findById(activityId);
  assert.ok(stored);
  assert.equal(stored.community_summary, "A fun set of problems");
  assert.equal(stored.community_tags, JSON.stringify(["cpp", "graphs"]));

  const list = await injectJson("GET", "/community/activities?limit=10&offset=0");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.activities));
  const found = list.json.activities.find((a) => a.id === activityId);
  assert.ok(found);
  assert.equal(found.title, "My Activity");
  assert.equal(found.problemCount, 2);
  assert.deepEqual(found.communityTags, ["cpp", "graphs"]);
  assert.equal(found.communitySummary, "A fun set of problems");
  assert.ok(found.author?.displayName);

  const detail = await injectJson("GET", `/community/activities/${activityId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.activity.id, activityId);
  assert.equal(detail.json.activity.prompt, "Prompt");
  assert.ok(Array.isArray(detail.json.activity.problems));
  assert.equal(detail.json.activity.problems.length, 2);
});

test("community activities: cannot publish a DRAFT activity", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { token, userId } = createUserAndToken(suffix);

  const activityId = `act_${crypto.randomUUID()}`;
  activityDb.create(activityId, userId, "Draft Activity", JSON.stringify([]), "Prompt", { status: "DRAFT" });

  const publish = await injectJson(
    "POST",
    `/activities/${activityId}/community/publish`,
    { summary: "Nope" },
    { authorization: `Bearer ${token}` }
  );
  assert.equal(publish.status, 409);
});

test("community activities: non-owner cannot unpublish", async () => {
  const suffix1 = crypto.randomUUID().slice(0, 8);
  const suffix2 = crypto.randomUUID().slice(0, 8);
  const owner = createUserAndToken(suffix1);
  const other = createUserAndToken(suffix2);

  const activityId = `act_${crypto.randomUUID()}`;
  activityDb.create(activityId, owner.userId, "My Activity", JSON.stringify([]), "Prompt", { status: "PUBLISHED" });

  const publish = await injectJson(
    "POST",
    `/activities/${activityId}/community/publish`,
    { summary: "Shared" },
    { authorization: `Bearer ${owner.token}` }
  );
  assert.equal(publish.status, 200);

  const unpublish = await injectJson(
    "POST",
    `/activities/${activityId}/community/unpublish`,
    {},
    { authorization: `Bearer ${other.token}` }
  );
  assert.equal(unpublish.status, 403);
});
