#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const [revision, outputArgument] = process.argv.slice(2);

if (!revision || !outputArgument) {
  console.error("Usage: package-release.mjs <git-revision> <output.tar.gz>");
  process.exit(2);
}

const outputPath = path.resolve(outputArgument);
if (existsSync(outputPath)) {
  console.error(`Refusing to replace existing release archive: ${outputPath}`);
  process.exit(2);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
const revisionResult = spawnSync(
  "git",
  ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
  { cwd: repositoryRoot, encoding: "utf8" },
);
if (revisionResult.error || revisionResult.status !== 0) {
  if (revisionResult.stderr) process.stderr.write(revisionResult.stderr);
  if (revisionResult.error) console.error(revisionResult.error.message);
  process.exit(revisionResult.status ?? 1);
}

const resolvedRevision = revisionResult.stdout.trim();
if (!/^[0-9a-f]{40,64}$/i.test(resolvedRevision)) {
  console.error(`Git returned an invalid object ID for revision: ${revision}`);
  process.exit(1);
}

const temporaryPath = path.join(
  path.dirname(outputPath),
  `.${path.basename(outputPath)}.${process.pid}-${randomUUID()}.tmp`,
);
const temporaryFile = openSync(temporaryPath, "wx", 0o600);
closeSync(temporaryFile);

const result = spawnSync(
  "git",
  [
    "-c",
    "core.autocrlf=false",
    "archive",
    "--format=tar.gz",
    `--output=${temporaryPath}`,
    resolvedRevision,
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);

if (result.error || result.status !== 0) {
  rmSync(temporaryPath, { force: true });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const archiveSize = statSync(temporaryPath).size;
if (archiveSize === 0) {
  rmSync(temporaryPath, { force: true });
  console.error("Git produced an empty release archive.");
  process.exit(1);
}

try {
  linkSync(temporaryPath, outputPath);
} catch (error) {
  rmSync(temporaryPath, { force: true });
  if ((error).code === "EEXIST") {
    console.error(`Refusing to replace existing release archive: ${outputPath}`);
    process.exit(2);
  }
  throw error;
}
rmSync(temporaryPath, { force: true });

console.log(
  `Created ${outputPath} (${archiveSize} bytes) from ${revision} (${resolvedRevision}).`,
);
