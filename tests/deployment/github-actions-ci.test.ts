import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github/workflows/ci.yml");

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: string;
  env?: Record<string, unknown>;
};

type Job = {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  services?: Record<string, Record<string, unknown>>;
  steps?: Step[];
};

type Workflow = {
  name?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: Record<string, unknown>;
  jobs?: Record<string, Job>;
};

async function readWorkflow(): Promise<Workflow> {
  return parse(await readFile(workflowPath, "utf8")) as Workflow;
}

function steps(job: Job): Step[] {
  return job.steps ?? [];
}

function commands(job: Job): string {
  return steps(job)
    .map((step) => `${Object.values(step.env ?? {}).join("\n")}\n${step.run ?? ""}`)
    .join("\n");
}

describe("GitHub Actions CI policy", () => {
  it("runs the two required gates for integration changes and manual requests", async () => {
    const workflow = await readWorkflow();

    expect(workflow.on).toEqual({
      pull_request: { branches: ["feat/warehouse-system"] },
      push: { branches: ["feat/warehouse-system"] },
      workflow_dispatch: null,
    });
    expect(Object.keys(workflow.jobs ?? {})).toEqual(["quality", "e2e"]);
    expect(workflow.jobs?.quality?.name).toBe("quality");
    expect(workflow.jobs?.e2e?.name).toBe("e2e");
  });

  it("pins permissions, concurrency, runtimes, services, and every action", async () => {
    const workflow = await readWorkflow();
    const jobs = Object.values(workflow.jobs ?? {});

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toMatchObject({
      "cancel-in-progress": true,
    });
    expect(String(workflow.concurrency?.group)).toContain("github.workflow");
    expect(String(workflow.concurrency?.group)).toContain("github.event.pull_request.number");
    expect(String(workflow.concurrency?.group)).toContain("github.ref");

    expect(workflow.jobs?.quality?.["timeout-minutes"]).toBe(30);
    expect(workflow.jobs?.e2e?.["timeout-minutes"]).toBe(45);
    for (const job of jobs) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job.permissions).toEqual({ contents: "read" });
      expect(job.services?.postgres?.image).toBe("postgres:16-alpine");
      expect(String(job.services?.postgres?.options)).toContain("pg_isready");
      expect(steps(job).find((step) => step.uses?.startsWith("actions/checkout@"))?.with)
        .toMatchObject({ "persist-credentials": false });
      expect(steps(job).find((step) => step.uses?.startsWith("actions/setup-node@"))?.with)
        .toMatchObject({ "node-version": "24.19.0", cache: "pnpm", "cache-dependency-path": "pnpm-lock.yaml" });
      expect(steps(job).find((step) => step.uses?.startsWith("pnpm/action-setup@"))?.with)
        .toMatchObject({ version: "11.20.0" });
    }

    const actionReferences = jobs.flatMap((job) => steps(job)).flatMap((step) => step.uses ?? []);
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });

  it("runs the complete serial quality gate and checks the submitted commit range", async () => {
    const quality = (await readWorkflow()).jobs?.quality;
    expect(quality).toBeDefined();
    const run = commands(quality!);

    expect(run).toContain("pnpm install --frozen-lockfile");
    expect(run).toContain("prisma generate");
    expect(run).toContain("prisma migrate deploy");
    expect(run).toContain("docker pull postgres:16-alpine");
    expect(run).toContain("docker pull node:24-alpine");
    expect(run).toContain("docker pull caddy:2.10-alpine");
    expect(run).toContain("pnpm test --no-file-parallelism --maxWorkers=1");
    expect(run).not.toMatch(/--exclude|deployment.*exclude|integration.*exclude|database.*exclude/i);
    expect(run).toContain("pnpm typecheck");
    expect(run).toContain("pnpm build");
    expect(run).toContain("git diff --check");
    expect(run).toContain("github.event.pull_request.base.sha");
    expect(run).toContain("github.event.pull_request.head.sha");
    expect(run).toContain("github.event.before");
    expect(run).toContain("github.sha");
    expect(run).toContain("git hash-object -t tree /dev/null");
  });

  it("runs the complete Chromium E2E gate and retains bounded failure evidence", async () => {
    const e2e = (await readWorkflow()).jobs?.e2e;
    expect(e2e).toBeDefined();
    const run = commands(e2e!);

    expect(run).toContain("pnpm install --frozen-lockfile");
    expect(run).toContain("prisma generate");
    expect(run).toContain("prisma migrate deploy");
    expect(run).toContain("playwright install --with-deps chromium");
    expect(run).toContain("pnpm test:e2e -- --project=chromium");
    expect(run).not.toMatch(/tests\/e2e\/[\w/-]+\.spec/);

    const artifact = steps(e2e!).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(artifact?.if).toBe("failure()");
    expect(artifact?.with).toMatchObject({
      path: "playwright-report\ntest-results",
      "retention-days": 7,
      "if-no-files-found": "ignore",
    });
  });
});
