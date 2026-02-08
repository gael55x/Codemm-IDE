import fs from "fs";
import path from "path";

function isSubPath(rootDir: string, candidate: string): boolean {
  const root = path.resolve(rootDir);
  const full = path.resolve(candidate);
  if (process.platform === "win32") {
    const r = root.toLowerCase();
    const f = full.toLowerCase();
    return f === r || f.startsWith(r + path.sep);
  }
  return full === root || full.startsWith(root + path.sep);
}

export function writeUserFiles(rootDir: string, files: Record<string, string>) {
  if (!files || typeof files !== "object") throw new Error("files must be an object.");
  const root = path.resolve(rootDir);

  for (const [filename, source] of Object.entries(files)) {
    if (typeof filename !== "string" || !filename.trim()) throw new Error("Invalid filename.");
    if (filename.length > 256) throw new Error("Filename is too long.");
    if (path.isAbsolute(filename)) throw new Error("Absolute paths are not allowed.");
    if (filename.includes("\0")) throw new Error("Invalid filename.");

    const outPath = path.resolve(root, filename);
    if (!isSubPath(root, outPath)) {
      throw new Error(`Invalid filename (path traversal): ${filename}`);
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, String(source ?? ""), "utf8");
  }
}

