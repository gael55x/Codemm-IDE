import type { GeneratedProblemDraft } from "../contracts/problem";
import type { ProblemSlot } from "../planner/types";
import { getLanguageProfile } from "../languages/profiles";
import type { GuidedHintsDeps } from "./guidedHints";
import { generateDynamicGuidedHintLines } from "./guidedHints";
import { trace } from "../utils/trace";

function normalizeScaffoldLevel(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const v = raw <= 1 ? raw : raw / 100;
  return Math.max(0, Math.min(1, v));
}

function normalizeHintKey(text: string): string {
  return text.trim().toLowerCase();
}

function uniqueLines(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const key = normalizeHintKey(l);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function buildConceptHintLines(args: {
  lineComment: string;
  scaffoldLevel: number;
  learningGoal?: string | undefined;
  topics?: string[] | undefined;
}): string[] {
  const lc = args.lineComment;
  const goal = (args.learningGoal ?? "").trim().toLowerCase();
  const topics = Array.isArray(args.topics) ? args.topics.map((t) => String(t ?? "").trim().toLowerCase()) : [];
  const haystack = [goal, ...topics].join(" ").trim();
  if (!haystack) return [];

  const maxHints = args.scaffoldLevel >= 0.75 ? 4 : args.scaffoldLevel >= 0.45 ? 2 : 0;
  if (maxHints <= 0) return [];

  const hints: string[] = [];

  const isMst =
    haystack.includes("kruskal") ||
    haystack.includes("minimum spanning tree") ||
    /\bmst\b/.test(haystack) ||
    haystack.includes("union find") ||
    haystack.includes("dsu");
  if (isMst) {
    hints.push(`${lc} Hint: Sort edges by weight (ascending).`);
    hints.push(`${lc} Hint: Use Union-Find (DSU) to track connected components.`);
    hints.push(`${lc} Hint: Only add an edge if it connects two different components (avoid cycles).`);
    hints.push(`${lc} Hint: Stop once you’ve added n-1 edges.`);
  }

  const isConnectedComponents =
    haystack.includes("connected component") ||
    haystack.includes("connected components") ||
    (haystack.includes("graph") && haystack.includes("components"));
  if (isConnectedComponents) {
    hints.push(`${lc} Hint: Build an adjacency list, then run BFS/DFS from each unvisited node.`);
  }

  const isIntervalScheduling =
    haystack.includes("interval") &&
    (haystack.includes("non-overlapping") || haystack.includes("non overlapping") || haystack.includes("overlap"));
  if (isIntervalScheduling) {
    hints.push(`${lc} Hint: Sort intervals by end time, then greedily pick the earliest finishing ones.`);
  }

  return hints.slice(0, maxHints);
}

function buildTodoLines(args: {
  lineComment: string;
  scaffoldLevel: number;
  learningGoal?: string | undefined;
  hintsEnabled?: boolean | undefined;
  topics?: string[] | undefined;
  extraHintLines?: string[] | undefined;
}): string[] {
  const lc = args.lineComment;
  const goal = (args.learningGoal ?? "").trim();
  const goalSuffix = goal ? ` (${goal})` : "";
  const hintsEnabled = args.hintsEnabled !== false;

  // Higher scaffold => more guidance; lower scaffold => terser guidance.
  const lines: string[] = [`${lc} BEGIN STUDENT TODO`];
  if (args.scaffoldLevel >= 0.75) {
    lines.push(`${lc} TODO: Implement the missing core logic${goalSuffix}.`);
    if (hintsEnabled) {
      lines.push(
        ...buildConceptHintLines({
          lineComment: lc,
          scaffoldLevel: args.scaffoldLevel,
          learningGoal: args.learningGoal,
          topics: args.topics,
        })
      );
      if (Array.isArray(args.extraHintLines) && args.extraHintLines.length > 0) {
        lines.push(...args.extraHintLines);
      }
      lines.push(`${lc} Hint: Use the problem description as your spec.`);
      lines.push(`${lc} Hint: Let the existing tests drive edge cases.`);
    }
  } else if (args.scaffoldLevel >= 0.45) {
    lines.push(`${lc} TODO: Implement the missing logic${goalSuffix}.`);
    if (hintsEnabled) {
      lines.push(
        ...buildConceptHintLines({
          lineComment: lc,
          scaffoldLevel: args.scaffoldLevel,
          learningGoal: args.learningGoal,
          topics: args.topics,
        })
      );
      if (Array.isArray(args.extraHintLines) && args.extraHintLines.length > 0) {
        lines.push(...args.extraHintLines);
      }
      lines.push(`${lc} Hint: Follow the problem description and tests.`);
    }
  } else if (args.scaffoldLevel >= 0.2) {
    lines.push(`${lc} TODO: Implement this${goalSuffix}.`);
  } else {
    lines.push(`${lc} TODO: Implement this.`);
  }
  lines.push(`${lc} END STUDENT TODO`);
  return uniqueLines(lines);
}

type JavaMethodBody = {
  name: string;
  openBrace: number;
  closeBrace: number;
  bodyLength: number;
};

function scanJavaMethodBodies(source: string): JavaMethodBody[] {
  const methods: JavaMethodBody[] = [];

  let braceDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
  let escape = false;

  const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

  function prevNonWsIndex(from: number): number {
    for (let i = from; i >= 0; i--) {
      const ch = source[i]!;
      if (!/\s/.test(ch)) return i;
    }
    return -1;
  }

  function findMatchingBrace(openIndex: number): number {
    let depth = 0;
    let inLC = false;
    let inBC = false;
    let inStr = false;
    let inCh = false;
    let esc = false;

    for (let i = openIndex; i < source.length; i++) {
      const ch = source[i]!;
      const next = i + 1 < source.length ? source[i + 1]! : "";

      if (inLC) {
        if (ch === "\n") inLC = false;
        continue;
      }
      if (inBC) {
        if (ch === "*" && next === "/") {
          inBC = false;
          i++;
        }
        continue;
      }
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (inCh) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === "'") inCh = false;
        continue;
      }

      if (ch === "/" && next === "/") {
        inLC = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBC = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "'") {
        inCh = true;
        continue;
      }

      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }

    return -1;
  }

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    const next = i + 1 < source.length ? source[i + 1]! : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (inChar) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "'") inChar = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inChar = true;
      continue;
    }

    if (ch === "{") {
      const depthBefore = braceDepth;
      braceDepth++;

      // Method bodies are typically blocks at class depth 1, preceded by ')'.
      if (depthBefore === 1) {
        const prev = prevNonWsIndex(i - 1);
        if (prev >= 0 && source[prev] === ")") {
          // Extract method name: scan back to matching '(' then identifier before it.
          let parenDepth = 0;
          let openParen = -1;
          for (let j = prev; j >= 0; j--) {
            const c = source[j]!;
            if (c === ")") parenDepth++;
            else if (c === "(") {
              parenDepth--;
              if (parenDepth === 0) {
                openParen = j;
                break;
              }
            }
          }

          if (openParen >= 0) {
            let k = prevNonWsIndex(openParen - 1);
            let end = k;
            while (k >= 0 && isIdentChar(source[k]!)) k--;
            const start = k + 1;
            const name = start <= end ? source.slice(start, end + 1) : "";
            const close = findMatchingBrace(i);
            if (name && close > i) {
              methods.push({
                name,
                openBrace: i,
                closeBrace: close,
                bodyLength: Math.max(0, close - i - 1),
              });
            }
          }
        }
      }

      continue;
    }

    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
  }

  return methods;
}

function replaceJavaMethodBodies(args: {
  source: string;
  methodsToScaffold: JavaMethodBody[];
  lineComment: string;
  scaffoldLevel: number;
  learningGoal?: string | undefined;
  hintsEnabled?: boolean | undefined;
  topics?: string[] | undefined;
  extraHintLines?: string[] | undefined;
}): { code: string; replaced: JavaMethodBody[] } {
  let out = args.source;
  const sorted = [...args.methodsToScaffold].sort((a, b) => b.openBrace - a.openBrace);

  for (const m of sorted) {
    const open = m.openBrace;
    const close = m.closeBrace;
    if (open < 0 || close <= open) continue;

    const lineStart = out.lastIndexOf("\n", open);
    const indentMatch = out.slice(lineStart + 1, open).match(/^\s*/);
    const indent = indentMatch ? indentMatch[0] : "";
    const bodyIndent = `${indent}  `;
    const todo = buildTodoLines({
      lineComment: args.lineComment,
      scaffoldLevel: args.scaffoldLevel,
      learningGoal: args.learningGoal,
      hintsEnabled: args.hintsEnabled,
      topics: args.topics,
      extraHintLines: args.extraHintLines,
    });

    const body =
      `\n` +
      todo.map((l) => `${bodyIndent}${l}`).join("\n") +
      `\n${bodyIndent}throw new UnsupportedOperationException("TODO");\n` +
      indent;

    out = out.slice(0, open + 1) + body + out.slice(close);
  }

  return { code: out, replaced: sorted };
}

function scaffoldJavaFromReference(args: {
  reference: string;
  scaffoldLevel: number;
  lineComment: string;
  learningGoal?: string | undefined;
  hintsEnabled?: boolean | undefined;
  topics?: string[] | undefined;
  extraHintLines?: string[] | undefined;
}): { code: string; replaced: JavaMethodBody[] } {
  const marker = `${args.lineComment} BEGIN STUDENT TODO`;
  if (args.reference.includes(marker)) return { code: args.reference, replaced: [] };

  const methods = scanJavaMethodBodies(args.reference).filter((m) => m.name !== "main");
  if (methods.length === 0) return { code: args.reference, replaced: [] };

  const missingFraction = Math.max(0, Math.min(1, 1 - args.scaffoldLevel));
  const targetCount = Math.max(1, Math.min(methods.length, Math.ceil(methods.length * missingFraction)));
  const byComplexity = [...methods].sort((a, b) => (b.bodyLength === a.bodyLength ? a.openBrace - b.openBrace : b.bodyLength - a.bodyLength));
  const chosen = byComplexity.slice(0, targetCount);

  return replaceJavaMethodBodies({
    source: args.reference,
    methodsToScaffold: chosen,
    lineComment: args.lineComment,
    scaffoldLevel: args.scaffoldLevel,
    learningGoal: args.learningGoal,
    hintsEnabled: args.hintsEnabled,
    topics: args.topics,
    extraHintLines: args.extraHintLines,
  });
}

type PythonFunctionBlock = {
  name: string;
  startLine: number;
  endLine: number;
  bodyNonEmptyLines: number;
};

function scanPythonTopLevelFunctions(source: string): PythonFunctionBlock[] {
  const lines = source.split("\n");
  const blocks: PythonFunctionBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (!m) continue;
    const name = m[1] ?? "";
    if (!name) continue;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (/^(def|class)\s+/.test(l)) {
        end = j;
        break;
      }
    }

    let nonEmpty = 0;
    for (let j = i + 1; j < end; j++) {
      if ((lines[j] ?? "").trim()) nonEmpty++;
    }

    blocks.push({ name, startLine: i, endLine: end, bodyNonEmptyLines: nonEmpty });
    i = end - 1;
  }

  return blocks;
}

function scaffoldPythonFromReference(args: {
  reference: string;
  scaffoldLevel: number;
  lineComment: string;
  learningGoal?: string | undefined;
  hintsEnabled?: boolean | undefined;
  topics?: string[] | undefined;
  extraHintLines?: string[] | undefined;
}): { code: string; replacedCount: number } {
  const marker = `${args.lineComment} BEGIN STUDENT TODO`;
  if (args.reference.includes(marker)) return { code: args.reference, replacedCount: 0 };

  const lines = args.reference.split("\n");
  const blocks = scanPythonTopLevelFunctions(args.reference);
  if (blocks.length === 0) return { code: args.reference, replacedCount: 0 };

  const missingFraction = Math.max(0, Math.min(1, 1 - args.scaffoldLevel));
  const targetCount = Math.max(1, Math.min(blocks.length, Math.ceil(blocks.length * missingFraction)));
  const byComplexity = [...blocks].sort((a, b) =>
    b.bodyNonEmptyLines === a.bodyNonEmptyLines ? a.startLine - b.startLine : b.bodyNonEmptyLines - a.bodyNonEmptyLines
  );

  const chosenNames: string[] = [];
  // Always include solve(...) if present.
  const solve = blocks.find((b) => b.name === "solve");
  if (solve) chosenNames.push("solve");
  for (const b of byComplexity) {
    if (chosenNames.length >= targetCount) break;
    if (chosenNames.includes(b.name)) continue;
    chosenNames.push(b.name);
  }
  const chosen = blocks.filter((b) => chosenNames.includes(b.name)).sort((a, b) => b.startLine - a.startLine);

  for (const b of chosen) {
    const header = lines[b.startLine] ?? "";
    let bodyIndent = "    ";
    for (let j = b.startLine + 1; j < b.endLine; j++) {
      const l = lines[j] ?? "";
      if (!l.trim()) continue;
      const indent = l.match(/^\s*/)?.[0] ?? "";
      if (indent) {
        bodyIndent = indent;
        break;
      }
    }

    const todo = buildTodoLines({
      lineComment: args.lineComment,
      scaffoldLevel: args.scaffoldLevel,
      learningGoal: args.learningGoal,
      hintsEnabled: args.hintsEnabled,
      topics: args.topics,
      extraHintLines: args.extraHintLines,
    });
    const replacement = [header, ...todo.map((l) => `${bodyIndent}${l}`), `${bodyIndent}raise NotImplementedError("TODO")`];
    lines.splice(b.startLine, b.endLine - b.startLine, ...replacement);
  }

  return { code: lines.join("\n"), replacedCount: chosen.length };
}

function scaffoldCppFromReference(args: {
  reference: string;
  scaffoldLevel: number;
  lineComment: string;
  learningGoal?: string | undefined;
  hintsEnabled?: boolean | undefined;
  topics?: string[] | undefined;
  extraHintLines?: string[] | undefined;
}): { code: string; replacedCount: number } {
  const marker = `${args.lineComment} BEGIN STUDENT TODO`;
  if (args.reference.includes(marker)) return { code: args.reference, replacedCount: 0 };

  // Best-effort: find the first "solve(...)" function definition and replace its body.
  const re = /\bsolve\s*\(/g;
  const match = re.exec(args.reference);
  if (!match) return { code: args.reference, replacedCount: 0 };

  const openParen = match.index + match[0].lastIndexOf("(");
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < args.reference.length; i++) {
    const ch = args.reference[i]!;
    if (ch === "(") parenDepth++;
    if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return { code: args.reference, replacedCount: 0 };

  let openBrace = -1;
  for (let i = closeParen + 1; i < args.reference.length; i++) {
    const ch = args.reference[i]!;
    if (/\s/.test(ch)) continue;
    if (ch !== "{") return { code: args.reference, replacedCount: 0 };
    openBrace = i;
    break;
  }
  if (openBrace < 0) return { code: args.reference, replacedCount: 0 };

  // Match braces (no string/comment awareness, but reference solutions are expected to be simple).
  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i < args.reference.length; i++) {
    const ch = args.reference[i]!;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        closeBrace = i;
        break;
      }
    }
  }
  if (closeBrace < 0) return { code: args.reference, replacedCount: 0 };

  const lineStart = args.reference.lastIndexOf("\n", openBrace);
  const indentMatch = args.reference.slice(lineStart + 1, openBrace).match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : "";
  const bodyIndent = `${indent}  `;
  const todo = buildTodoLines({
    lineComment: args.lineComment,
    scaffoldLevel: args.scaffoldLevel,
    learningGoal: args.learningGoal,
    hintsEnabled: args.hintsEnabled,
    topics: args.topics,
    extraHintLines: args.extraHintLines,
  });

  const body =
    `\n` +
    todo.map((l) => `${bodyIndent}${l}`).join("\n") +
    `\n${bodyIndent}throw std::runtime_error(\"TODO\");\n` +
    indent;

  const out = args.reference.slice(0, openBrace + 1) + body + args.reference.slice(closeBrace);
  return { code: out, replacedCount: 1 };
}

function scaffoldSqlFromReference(args: {
  starter: string;
  scaffoldLevel: number;
  lineComment: string;
  learningGoal?: string | undefined;
  hintsEnabled?: boolean | undefined;
  topics?: string[] | undefined;
  extraHintLines?: string[] | undefined;
}): { code: string } {
  const todo = buildTodoLines({
    lineComment: args.lineComment,
    scaffoldLevel: args.scaffoldLevel,
    learningGoal: args.learningGoal,
    hintsEnabled: args.hintsEnabled,
    topics: args.topics,
    extraHintLines: args.extraHintLines,
  });
  const starter = (args.starter ?? "").trim();
  if (starter.includes(`${args.lineComment} BEGIN STUDENT TODO`)) return { code: starter };
  const query = starter || "SELECT 1;";
  return { code: `${todo.join("\n")}\n${query}\n` };
}

export function applyGuidedScaffolding(
  draft: GeneratedProblemDraft,
  slot: ProblemSlot,
  opts?: { extraHintLines?: string[] }
): GeneratedProblemDraft {
  const scaffoldRaw = slot.pedagogy?.scaffold_level;
  const level = normalizeScaffoldLevel(scaffoldRaw);
  if (level == null) return draft;

  const profile = getLanguageProfile(draft.language);
  const lineComment = profile.scaffolding?.lineComment ?? (draft.language === "python" ? "#" : "//");
  const learningGoal = slot.pedagogy?.learning_goal;
  const hintsEnabled = slot.pedagogy?.hints_enabled;
  const topics = Array.isArray(slot.topics) ? slot.topics : [];
  const extraHintLines = Array.isArray(opts?.extraHintLines) ? opts?.extraHintLines : undefined;

  if (draft.language === "java") {
    if ("reference_solution" in draft) {
      const scaffolded = scaffoldJavaFromReference({
        reference: draft.reference_solution,
        scaffoldLevel: level,
        lineComment,
        learningGoal,
        hintsEnabled,
        topics,
        extraHintLines,
      });
      trace("generation.guided.scaffolded", {
        slotIndex: slot.index,
        language: draft.language,
        kind: "starter_code",
        scaffoldLevel: level,
        replacedCount: scaffolded.replaced.length,
      });
      return { ...draft, starter_code: scaffolded.code };
    }

    const entryPaths = new Set(
      draft.reference_workspace.files.filter((f) => f.role === "entry").map((f) => f.path)
    );

    const scaffolded_regions: Array<{
      path: string;
      symbol?: string;
      begin_marker: string;
      end_marker: string;
    }> = [];

    const nextFiles = draft.reference_workspace.files.map((f) => {
      if (entryPaths.has(f.path)) return f;
      const scaffolded = scaffoldJavaFromReference({
        reference: f.content,
        scaffoldLevel: level,
        lineComment,
        learningGoal,
        hintsEnabled,
        topics,
        extraHintLines,
      });
      for (const m of scaffolded.replaced) {
        scaffolded_regions.push({
          path: f.path,
          symbol: m.name,
          begin_marker: `${lineComment} BEGIN STUDENT TODO`,
          end_marker: `${lineComment} END STUDENT TODO`,
        });
      }
      return { ...f, content: scaffolded.code };
    });

    trace("generation.guided.scaffolded", {
      slotIndex: slot.index,
      language: draft.language,
      kind: "workspace",
      scaffoldLevel: level,
      files: nextFiles.length,
      regions: scaffolded_regions.length,
    });

    return {
      ...draft,
      // Derive the student-facing workspace from the validated reference workspace.
      workspace: { ...draft.reference_workspace, files: nextFiles, scaffolded_regions },
    };
  }

  if ("reference_solution" in draft) {
    if (draft.language === "python") {
      const scaffolded = scaffoldPythonFromReference({
        reference: draft.reference_solution,
        scaffoldLevel: level,
        lineComment,
        learningGoal,
        hintsEnabled,
        topics,
        extraHintLines,
      });
      trace("generation.guided.scaffolded", {
        slotIndex: slot.index,
        language: draft.language,
        kind: "starter_code",
        scaffoldLevel: level,
        replacedCount: scaffolded.replacedCount,
      });
      return { ...draft, starter_code: scaffolded.code };
    }

    if (draft.language === "cpp") {
      const scaffolded = scaffoldCppFromReference({
        reference: draft.reference_solution,
        scaffoldLevel: level,
        lineComment,
        learningGoal,
        hintsEnabled,
        topics,
        extraHintLines,
      });
      trace("generation.guided.scaffolded", {
        slotIndex: slot.index,
        language: draft.language,
        kind: "starter_code",
        scaffoldLevel: level,
        replacedCount: scaffolded.replacedCount,
      });
      return { ...draft, starter_code: scaffolded.code };
    }

    if (draft.language === "sql") {
      const scaffolded = scaffoldSqlFromReference({
        starter: draft.starter_code,
        scaffoldLevel: level,
        lineComment,
        learningGoal,
        hintsEnabled,
        topics,
        extraHintLines,
      });
      trace("generation.guided.scaffolded", {
        slotIndex: slot.index,
        language: draft.language,
        kind: "starter_code",
        scaffoldLevel: level,
      });
      return { ...draft, starter_code: scaffolded.code };
    }
  }

  return draft;
}

export async function applyGuidedScaffoldingAsync(
  draft: GeneratedProblemDraft,
  slot: ProblemSlot,
  opts?: { deps?: GuidedHintsDeps }
): Promise<GeneratedProblemDraft> {
  const scaffoldRaw = slot.pedagogy?.scaffold_level;
  const level = normalizeScaffoldLevel(scaffoldRaw);
  if (level == null) return draft;

  const profile = getLanguageProfile(draft.language);
  const lineComment = profile.scaffolding?.lineComment ?? (draft.language === "python" ? "#" : "//");

  let extraHintLines: string[] | undefined;
  try {
    const deps = opts?.deps;
    const hintLines = await generateDynamicGuidedHintLines({
      draft,
      slot,
      scaffoldLevel: level,
      lineComment,
      ...(deps ? { deps } : {}),
    });
    extraHintLines = hintLines.length > 0 ? hintLines : undefined;
  } catch (err) {
    trace("generation.guided.hints.error", {
      slotIndex: slot.index,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return applyGuidedScaffolding(draft, slot, extraHintLines ? { extraHintLines } : undefined);
}
