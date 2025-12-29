require("../../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { coerceSqlTestSuiteToJsonString, isValidSqlTestSuite } = require("../../../../src/languages/sql/rules");

test("sql test_suite coercion: object with test_case_1..8 becomes valid canonical JSON string", () => {
  const raw = {
    schema_sql: "CREATE TABLE t (id INTEGER, v TEXT);",
    test_case_1: { seed_sql: "INSERT INTO t VALUES (1,'a');", expected: { columns: ["id"], rows: [[1]] } },
    test_case_2: { seed_sql: "INSERT INTO t VALUES (2,'b');", expected: { columns: ["id"], rows: [[2]] } },
    test_case_3: { seed_sql: "INSERT INTO t VALUES (3,'c');", expected: { columns: ["id"], rows: [[3]] } },
    test_case_4: { seed_sql: "INSERT INTO t VALUES (4,'d');", expected: { columns: ["id"], rows: [[4]] } },
    test_case_5: { seed_sql: "INSERT INTO t VALUES (5,'e');", expected: { columns: ["id"], rows: [[5]] } },
    test_case_6: { seed_sql: "INSERT INTO t VALUES (6,'f');", expected: { columns: ["id"], rows: [[6]] } },
    test_case_7: { seed_sql: "INSERT INTO t VALUES (7,'g');", expected: { columns: ["id"], rows: [[7]] } },
    test_case_8: { seed_sql: "INSERT INTO t VALUES (8,'h');", expected: { columns: ["id"], rows: [[8]] } },
  };

  const s = coerceSqlTestSuiteToJsonString(raw, 8);
  assert.ok(typeof s === "string" && s.length > 0);
  assert.equal(isValidSqlTestSuite(s, 8), true);
});
