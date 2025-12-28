require("ts-node/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const { editDraftProblemWithAi } = require("../src/services/activityProblemEditService");

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

