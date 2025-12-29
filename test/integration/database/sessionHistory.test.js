require("../../helpers/setupDb");

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { userDb, sessionDb, sessionMessageDb } = require("../../../src/database");
const { createSession } = require("../../../src/services/sessionService");

test("sessionDb.listSummariesByUserId returns recent sessions with message counts", async () => {
  const userId = userDb.create("history_user", "history_user@example.com", "hash");

  const s1 = createSession(userId, "practice");
  sessionMessageDb.create(crypto.randomUUID(), s1.sessionId, "user", "first session message");

  await new Promise((r) => setTimeout(r, 1100));

  const s2 = createSession(userId, "guided");
  sessionMessageDb.create(crypto.randomUUID(), s2.sessionId, "user", "second session message");

  const res = sessionDb.listSummariesByUserId(userId, 10);
  assert.equal(res.length, 2);

  assert.equal(res[0].id, s2.sessionId);
  assert.equal(res[0].message_count, 1);
  assert.equal(res[0].last_message, "second session message");

  assert.equal(res[1].id, s1.sessionId);
  assert.equal(res[1].message_count, 1);
  assert.equal(res[1].last_message, "first session message");
});
