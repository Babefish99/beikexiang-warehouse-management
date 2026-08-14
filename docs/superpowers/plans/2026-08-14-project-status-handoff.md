# Project Status Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (when explicitly authorized) or `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Create a concise, factual project-status and production-release handoff document, with a clear entry link from the project status ledger.

**Architecture:** Keep `PROJECT_STATUS.md` as the complete, audited source of truth. Add `docs/项目状态与发布交接.md` as the day-to-day acceptance and operations summary, and link to it from the root ledger. The new document will only restate facts already verified in the ledger and release evidence.

**Tech Stack:** Markdown, Git

## Global Constraints

- Do not modify application code, production secrets, Docker data volumes, or server configuration.
- Do not push or deploy. This task is documentation-only.
- Preserve the existing, dirty `D:\桌面\仓库` worktree; work only in the production-deployment worktree.
- Clearly distinguish server-side internal health verification from the unresolved public-network TLS reset seen from the local PC.
- Do not state that Enterprise WeCom mobile access is configured or accepted; record its remaining prerequisites precisely.

---

### Task 1: Build and link the project-status handoff

**Files:**

- Create: `docs/项目状态与发布交接.md`
- Modify: `PROJECT_STATUS.md`

**Step 1: Assemble a verified fact matrix before drafting**

Use only these already-verified facts:

```text
Deployment source: fada1d6738d6ddd30db7eefb3de60e06771f7fc7
Server release: 20260814T093837Z-fada1d6738d6-8012
Server release health: api / postgres / web healthy; Caddy /health HTTP 200 internally
Validation: Node 24 Vitest 242 passed, 17 skipped; isolated E2E 121/121
Deployment boundaries: no push, no production-secret modification, no data-volume deletion
Known follow-up: public PC request to the HTTPS health endpoint reset; Enterprise WeCom acceptance remains pending
```

**Step 2: Draft the reader-facing handoff document**

Create `docs/项目状态与发布交接.md` with these exact sections:

```markdown
# 集团仓库管理系统：项目状态与发布交接

## 当前结论
## 已交付范围
## 生产发布与核验
## 企业微信接入状态
## 待办与风险
## 操作边界
## 证据与详细记录
```

Content requirements:

- Lead with the deployed release, the source revision, and the fact that formal user acceptance is still required.
- State the mobile scope honestly: query, notifications, inbound and outbound are mobile-supported; master-data and complex operations remain desktop-only.
- List the seven desktop-only mobile routes/function families: items, warehouses, opening stock, transfers, returns, stocktake, and period close.
- Record the date-generated inbound batch format as `YYYYMMDD-001` without describing it as manually editable.
- Explain the external-access and Enterprise WeCom follow-up without embedding host credentials, secrets, or private keys.
- Link back to `PROJECT_STATUS.md` for the complete chronological ledger.

**Step 3: Add the root-ledger entry point**

Near the top of `PROJECT_STATUS.md`, add one short line linking to the handoff document. Keep the ledger’s existing wording and evidence intact.

**Step 4: Verify document consistency and repository hygiene**

Run these checks after the edits:

```powershell
git diff --check
rg -n "fada1d6738d6|20260814T093837Z|企业微信|公网|未.*Push|121/121" PROJECT_STATUS.md "docs/项目状态与发布交接.md"
git status --short --branch
```

Review the rendered Markdown structure directly. Confirm that deployment, public-network, and Enterprise WeCom claims agree with the root ledger and that no secrets appear in the diff.

**Step 5: Commit the documentation change**

```powershell
git add PROJECT_STATUS.md "docs/项目状态与发布交接.md"
git commit -m "docs: add project status handoff"
```

Expected result: a clean `codex/production-deployment` worktree containing the handoff document and its root-ledger entry link, with no push and no deployment action.

