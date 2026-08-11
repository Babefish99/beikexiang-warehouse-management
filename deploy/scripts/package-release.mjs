#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
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
const result = spawnSync(
  "git",
  [
    "-c",
    "core.autocrlf=false",
    "archive",
    "--format=tar.gz",
    `--output=${outputPath}`,
    revision,
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);

if (result.error || result.status !== 0) {
  rmSync(outputPath, { force: true });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const archiveSize = statSync(outputPath).size;
if (archiveSize === 0) {
  rmSync(outputPath, { force: true });
  console.error("Git produced an empty release archive.");
  process.exit(1);
}

console.log(`Created ${outputPath} (${archiveSize} bytes) from ${revision}.`);
