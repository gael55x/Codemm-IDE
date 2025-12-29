require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { editDraftProblemWithAi } = require("../../../src/services/activityProblemEditService");

test("activityProblemEditService: edits a draft problem and discards reference artifacts", async () => {
  const existing = {
    language: "python",
    id: "py-1",
    title: "Echo Length",
    description: "Return len(s).",
    starter_code: "def solve(s: str) -> int:\n    # TODO\n    raise NotImplementedError\n",
    test_suite: `import pytest
from solution import solve

def test_case_1(): assert solve("") == 0
def test_case_2(): assert solve("a") == 1
def test_case_3(): assert solve("abc") == 3
def test_case_4(): assert solve("hello") == 5
def test_case_5(): assert solve("  ") == 2
def test_case_6(): assert solve("🙂") == 1
def test_case_7(): assert solve("line\\nbreak") == 10
def test_case_8(): assert solve("x" * 20) == 20
`,
    constraints: "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "strings",
  };

  const draftFromLlm = {
    language: "python",
    id: "WRONG-ID",
    title: "Echo Length (edited)",
    description: "Return the length of s, but ignore spaces.",
    starter_code: "def solve(s: str) -> int:\n    # TODO\n    raise NotImplementedError\n",
    test_suite: `import pytest
from solution import solve

def test_case_1(): assert solve("") == 0
def test_case_2(): assert solve("a") == 1
def test_case_3(): assert solve("a a") == 2
def test_case_4(): assert solve("  ") == 0
def test_case_5(): assert solve("hello world") == 10
def test_case_6(): assert solve("🙂 🙂") == 2
def test_case_7(): assert solve("line\\n break") == 8
def test_case_8(): assert solve("x" * 20) == 20
`,
    reference_solution: "def solve(s: str) -> int:\n    return len(s.replace(' ', ''))\n",
    constraints: "WRONG-CONSTRAINTS",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "hard",
    topic_tag: "wrong",
  };

  const updated = await editDraftProblemWithAi({
    existing,
    instruction: "Ignore spaces when counting length.",
    deps: {
      createCompletion: async () => ({
        content: [{ type: "text", text: JSON.stringify(draftFromLlm) }],
      }),
      validateReferenceSolution: async () => {},
    },
  });

  assert.equal(updated.id, "py-1");
  assert.equal(updated.language, "python");
  assert.equal(updated.title, "Echo Length (edited)");
  assert.equal("reference_solution" in updated, false);
  assert.equal(updated.constraints, existing.constraints);
  assert.equal(updated.difficulty, existing.difficulty);
  assert.equal(updated.topic_tag, existing.topic_tag);
});

test("activityProblemEditService: refuses Java shape change (legacy -> workspace)", async () => {
  const existing = {
    language: "java",
    id: "java-1",
    title: "Sum Array",
    description: "Return sum of array.",
    starter_code: `
public class SumArray {
  public int solve(int[] a) {
    // TODO
    return 0;
  }
}
`.trim(),
    test_suite: `
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class SumArrayTest {
  @Test void test_case_1(){ assertEquals(0, new SumArray().solve(new int[]{})); }
  @Test void test_case_2(){ assertEquals(1, new SumArray().solve(new int[]{1})); }
  @Test void test_case_3(){ assertEquals(3, new SumArray().solve(new int[]{1,2})); }
  @Test void test_case_4(){ assertEquals(6, new SumArray().solve(new int[]{1,2,3})); }
  @Test void test_case_5(){ assertEquals(-3, new SumArray().solve(new int[]{-1,-2})); }
  @Test void test_case_6(){ assertEquals(0, new SumArray().solve(new int[]{-1, 1})); }
  @Test void test_case_7(){ assertEquals(10, new SumArray().solve(new int[]{2,2,2,2,2})); }
  @Test void test_case_8(){ assertEquals(7, new SumArray().solve(new int[]{7,0,0})); }
}
`.trim(),
    constraints: "Java 17, JUnit 5, no package declarations.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "arrays",
  };

  const workspaceDraft = {
    language: "java",
    id: "java-1",
    title: "Workspace Variant",
    description: "Edited as workspace.",
    test_suite: `
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class WidgetTest {
  @Test void test_case_1(){ assertEquals(3, new Widget().add(1,2)); }
  @Test void test_case_2(){ assertEquals(0, new Widget().add(0,0)); }
  @Test void test_case_3(){ assertEquals(1, new Widget().add(-1,2)); }
  @Test void test_case_4(){ assertEquals(7, new Widget().add(10,-3)); }
  @Test void test_case_5(){ assertEquals(123, new Widget().add(100,23)); }
  @Test void test_case_6(){ assertEquals(-11, new Widget().add(-5,-6)); }
  @Test void test_case_7(){ assertEquals(15, new Widget().add(7,8)); }
  @Test void test_case_8(){ assertEquals(2147483647, new Widget().add(2147483640, 7)); }
}
`.trim(),
    workspace: {
      files: [
        {
          path: "Main.java",
          role: "entry",
          content: "public class Main { public static void main(String[] args) { System.out.println(\"ok\"); } }",
        },
        {
          path: "Widget.java",
          role: "support",
          content: "public class Widget { public int add(int a, int b) { // TODO\n    return 0;\n  } }",
        },
      ],
      entrypoint: "Main",
    },
    reference_workspace: {
      files: [
        {
          path: "Main.java",
          role: "entry",
          content: "public class Main { public static void main(String[] args) { System.out.println(\"ok\"); } }",
        },
        {
          path: "Widget.java",
          role: "support",
          content: "public class Widget { public int add(int a, int b) { return a + b; } }",
        },
      ],
      entrypoint: "Main",
    },
    constraints: existing.constraints,
    sample_inputs: [],
    sample_outputs: [],
    difficulty: existing.difficulty,
    topic_tag: existing.topic_tag,
  };

  await assert.rejects(
    () =>
      editDraftProblemWithAi({
        existing,
        instruction: "Convert to workspace.",
        deps: {
          createCompletion: async () => ({
            content: [{ type: "text", text: JSON.stringify(workspaceDraft) }],
          }),
          validateReferenceSolution: async () => {},
        },
      }),
    /must use starter_code\/reference_solution/i
  );
});

test("activityProblemEditService: retries once when first attempt returns invalid JSON", async () => {
  const existing = {
    language: "python",
    id: "py-2",
    title: "Add One",
    description: "Return x+1.",
    starter_code: "def solve(x: int) -> int:\n    # TODO\n    raise NotImplementedError\n",
    test_suite: `import pytest
from solution import solve

def test_case_1(): assert solve(0) == 1
def test_case_2(): assert solve(1) == 2
def test_case_3(): assert solve(-1) == 0
def test_case_4(): assert solve(10) == 11
def test_case_5(): assert solve(100) == 101
def test_case_6(): assert solve(-10) == -9
def test_case_7(): assert solve(2147483646) == 2147483647
def test_case_8(): assert solve(5) == 6
`,
    constraints: "Python 3.11, pytest, deterministic.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "math",
  };

  let calls = 0;
  const createCompletion = async ({ user }) => {
    calls++;
    if (calls === 1) {
      return { content: [{ type: "text", text: "{not json" }] };
    }
    assert.match(user, /Previous attempt failed/i);
    const draft = {
      ...existing,
      title: "Add One (edited)",
      reference_solution: "def solve(x: int) -> int:\n    return x + 1\n",
    };
    return { content: [{ type: "text", text: JSON.stringify(draft) }] };
  };

  let validated = 0;
  const validateReferenceSolution = async () => {
    validated++;
  };

  const updated = await editDraftProblemWithAi({
    existing,
    instruction: "Keep it, just rename title.",
    deps: { createCompletion, validateReferenceSolution },
  });

  assert.equal(calls, 2);
  assert.equal(validated, 1);
  assert.equal(updated.title, "Add One (edited)");
});

test("activityProblemEditService: rejects when LLM output violates contract (after retry)", async () => {
  const existing = {
    language: "python",
    id: "py-3",
    title: "Identity",
    description: "Return x.",
    starter_code: "def solve(x: int) -> int:\n    # TODO\n    raise NotImplementedError\n",
    test_suite: `import pytest
from solution import solve

def test_case_1(): assert solve(0) == 0
def test_case_2(): assert solve(1) == 1
def test_case_3(): assert solve(-1) == -1
def test_case_4(): assert solve(10) == 10
def test_case_5(): assert solve(100) == 100
def test_case_6(): assert solve(-10) == -10
def test_case_7(): assert solve(2147483647) == 2147483647
def test_case_8(): assert solve(5) == 5
`,
    constraints: "Python 3.11, pytest, deterministic.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "math",
  };

  let calls = 0;
  const createCompletion = async () => {
    calls++;
    // Missing required fields like starter_code/test_suite/reference_solution.
    return { content: [{ type: "text", text: JSON.stringify({ language: "python" }) }] };
  };

  await assert.rejects(
    () =>
      editDraftProblemWithAi({
        existing,
        instruction: "Break it.",
        deps: { createCompletion, validateReferenceSolution: async () => {} },
      }),
    /match contract|does not match contract|invalid/i
  );
  assert.equal(calls, 2);
});

test("activityProblemEditService: edits Java workspace problem and discards reference_workspace", async () => {
  const existing = {
    language: "java",
    id: "java-ws-1",
    title: "Add Two",
    description: "Return a+b.",
    test_suite: `
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class AdderTest {
  @Test void test_case_1(){ assertEquals(3, new Adder().add(1,2)); }
  @Test void test_case_2(){ assertEquals(0, new Adder().add(0,0)); }
  @Test void test_case_3(){ assertEquals(1, new Adder().add(-1,2)); }
  @Test void test_case_4(){ assertEquals(7, new Adder().add(10,-3)); }
  @Test void test_case_5(){ assertEquals(123, new Adder().add(100,23)); }
  @Test void test_case_6(){ assertEquals(-11, new Adder().add(-5,-6)); }
  @Test void test_case_7(){ assertEquals(15, new Adder().add(7,8)); }
  @Test void test_case_8(){ assertEquals(2147483647, new Adder().add(2147483640, 7)); }
}
`.trim(),
    workspace: {
      files: [
        { path: "Main.java", role: "entry", content: "public class Main { public static void main(String[] args) {} }" },
        { path: "Adder.java", role: "support", content: "public class Adder { public int add(int a, int b) { return 0; } }" },
      ],
      entrypoint: "Main",
    },
    constraints: "Java 17, JUnit 5, no package declarations.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "math",
  };

  const draft = {
    ...existing,
    title: "Add Two (edited)",
    reference_workspace: {
      files: [
        { path: "Main.java", role: "entry", content: "public class Main { public static void main(String[] args) {} }" },
        { path: "Adder.java", role: "support", content: "public class Adder { public int add(int a, int b) { return a + b; } }" },
      ],
      entrypoint: "Main",
    },
  };

  let validated = 0;
  const updated = await editDraftProblemWithAi({
    existing,
    instruction: "Just rename title.",
    deps: {
      createCompletion: async () => ({ content: [{ type: "text", text: JSON.stringify(draft) }] }),
      validateReferenceSolution: async () => {
        validated++;
      },
    },
  });

  assert.equal(validated, 1);
  assert.equal(updated.title, "Add Two (edited)");
  assert.equal("reference_workspace" in updated, false);
  assert.ok("workspace" in updated);
});
