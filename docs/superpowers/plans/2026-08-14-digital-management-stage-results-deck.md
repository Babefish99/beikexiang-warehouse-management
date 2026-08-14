# 集团数字化管理系统阶段成果汇报 PPT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a polished 10-slide, 16:9 Chinese PowerPoint that presents the warehouse and fixed-asset systems across desktop and mobile as stage-level achievements.

**Architecture:** Keep the existing two application repositories unchanged. Collect rendered screenshots from the warehouse and fixed-asset apps into a conversation-specific build directory, then author one local `.mjs` deck builder with `@oai/artifact-tool`; render the exported `.pptx`, inspect every slide, fix layout issues, and deliver only the final deck as the artifact.

**Tech Stack:** `@oai/artifact-tool` ES modules, bundled workspace Node runtime, existing local app builds, Playwright or the presentation rendering helpers, PowerPoint output, `render_slides.py`, `create_montage.py`, `slides_test.py`.

## Global Constraints

- Use the exact existing Beikexiang Group logo asset from the two projects.
- Use project page screenshots as the primary visual evidence; do not invent metrics, savings, adoption, or production-acceptance claims.
- Present the warehouse project as a deployment/integration-stage result; unfinished items belong only in the next-steps slide.
- Include both systems' home-page screenshots and independently show desktop and mobile outcomes.
- Use a 16:9 deck with 10 slides, Chinese copy, presenter `张信哲`, date `2026年8月`.
- Use `@oai/artifact-tool` from a JavaScript ES module; do not use `python-pptx` or the old Python artifact API.
- Before authoring, run `mark_artifact_operation_started.mjs` exactly once with one PPTX output.
- Add `[Sources]` blocks to speaker notes for every screenshot asset and every non-trivial project claim.
- Render every final slide and fix all unintended overlap, clipping, wrapping, broken connectors, and overflow before delivery.

---

### Task 1: Prepare the presentation workspace and source ledger

**Files:**
- Create: `D:\桌面\仓库\.tmp_ppt\source-notes.txt`
- Create: `D:\桌面\仓库\.tmp_ppt\asset-manifest.txt`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\`

**Interfaces:**
- Consumes: project logo files, source UI files, design spec `docs/superpowers/specs/2026-08-14-digital-management-stage-results-deck-design.md`, presentation skill resources.
- Produces: a clean writable build directory, fixed absolute paths for logo/screenshots, and a source ledger used by deck speaker notes.

- [ ] **Step 1: Load workspace dependency paths**

Run `codex_app__load_workspace_dependencies` and store the returned absolute paths as the command-scoped `RUNTIME_NODE`, `RUNTIME_NODE_MODULES`, and `RUNTIME_BIN_DIR` values for all subsequent presentation commands.

- [ ] **Step 2: Create the temporary build folders**

Create only the conversation-specific folders under `D:\桌面\仓库\.tmp_ppt\`; keep the final output outside the temporary folder.

- [ ] **Step 3: Copy logo assets into the build folder**

Use the existing files `D:\桌面\仓库\apps\web\public\beikexiang-logo.png` and `D:\桌面\固定资产\public\beikexiang-logo.png`; record both source paths and their identical/variant status in `source-notes.txt`.

- [ ] **Step 4: Review the source ledger for sensitive content**

Record that screenshots use local demo/seed data and exclude secrets, passwords, server credentials, and production configuration values.

---

### Task 2: Capture desktop and mobile system screenshots

**Files:**
- Create: `D:\桌面\仓库\.tmp_ppt\assets\warehouse-home-desktop.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\warehouse-home-mobile.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\warehouse-operations-desktop.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\warehouse-search-mobile.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\assets-home-desktop.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\assets-home-mobile.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\assets-ledger-desktop.png`
- Create: `D:\桌面\仓库\.tmp_ppt\assets\assets-detail-mobile.png`
- Create: `D:\桌面\仓库\.tmp_ppt\capture-screens.mjs`

**Interfaces:**
- Consumes: local web apps at their configured dev/preview URLs, seed/demo data, responsive CSS breakpoints.
- Produces: legible screenshot assets at desktop and mobile viewport sizes with source URLs and capture timestamps recorded in `source-notes.txt`.

- [ ] **Step 1: Start the warehouse web/API dev process**

Run the existing warehouse dev command from `D:\桌面\仓库` with its documented local configuration; confirm the web page and API health endpoint respond before capturing.

- [ ] **Step 2: Start the fixed-asset web/auth dev process**

Run the existing fixed-asset dev command from `D:\桌面\固定资产`; confirm the Vite page and local auth bypass/demo path respond before capturing.

- [ ] **Step 3: Capture both desktop home pages**

Use a desktop viewport wide enough to show the full sidebar/topbar hierarchy. Capture the warehouse home and fixed-asset home without browser chrome, preserving the existing Logo and page state.

- [ ] **Step 4: Capture mobile home and detail states**

Use a phone-sized viewport such as 390×844. Capture responsive home/navigation states plus warehouse search or notification and fixed-asset detail/photo/status states where the app supports them.

- [ ] **Step 5: Inspect every screenshot asset**

Open each PNG at full resolution, crop only browser or empty margins, and reject any image that is blurry, stretched, or missing the page title/system identity. Record final asset dimensions and source URLs in `asset-manifest.txt`.

---

### Task 3: Author the 10-slide PowerPoint deck

**Files:**
- Create: `D:\桌面\仓库\.tmp_ppt\build-deck.mjs`
- Create: `D:\桌面\仓库\.tmp_ppt\deck-copy.txt`
- Create: `D:\桌面\仓库\.tmp_ppt\qa-ledger.txt`
- Create: `D:\桌面\仓库\集团数字化管理系统阶段成果汇报.pptx`

**Interfaces:**
- Consumes: the screenshot assets and source ledger from Tasks 1–2; `@oai/artifact-tool`; exact deck design spec.
- Produces: a 10-slide PowerPoint with speaker notes, unified theme, page numbers, and no unsupported claims.

- [ ] **Step 1: Write the audience-facing slide copy**

Use these slide claims: `两个系统、四个终端，统一管理体验`; `首页与页面语言统一`; `仓库电脑端把库存、出入库和报表收进同一工作台`; `仓库手机端支持移动查询与轻量确认`; `固定资产电脑端形成统一资产台账`; `固定资产手机端让资产信息随时可查`; `统一入口、统一检索、统一台账、统一留痕`; `下一步进入业务验收、数据完善、联调上线和推广阶段`.

- [ ] **Step 2: Define deck theme constants**

Use the project palette: navy `#202840`, deep navy `#182038`, orange `#E85010`, canvas `#F5F7FA`, border `#E4E8EF`, muted text `#6F7B8F`, white `#FFFFFF`. Set title text at or above 50pt on the cover, slide titles at or above 35pt, section headers at or above 24pt, and body text at or above 16pt.

- [ ] **Step 3: Build the slide compositions**

Create: minimal cover; four-terminal overview; visual language/home-page comparison; warehouse desktop; warehouse mobile; fixed-asset desktop; fixed-asset mobile; shared-value synthesis; next-step roadmap; closing statement. Use screenshots as the primary content and flat composition with restrained annotations rather than dense card grids.

- [ ] **Step 4: Add speaker notes with source blocks**

For each slide containing a screenshot or project claim, include a `[Sources]` note naming the local source path, page/route, and relevant project documentation path. For original deck copy, note `Source: project design spec and project status documents`.

- [ ] **Step 5: Export the deck**

Run `mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format pptx` exactly once immediately before the first artifact-tool authoring operation, then run the `.mjs` builder with `RUNTIME_NODE` and export to `D:\桌面\仓库\集团数字化管理系统阶段成果汇报.pptx`.

---

### Task 4: Render, inspect, and iterate

**Files:**
- Create: `D:\桌面\仓库\.tmp_ppt\rendered\slide-*.png`
- Create: `D:\桌面\仓库\.tmp_ppt\montage.png`
- Modify: `D:\桌面\仓库\.tmp_ppt\build-deck.mjs`
- Modify: `D:\桌面\仓库\.tmp_ppt\qa-ledger.txt`

**Interfaces:**
- Consumes: the exported PPTX from Task 3 and the presentation container tools.
- Produces: a visually verified deck with all unintended layout issues fixed and QA evidence recorded.

- [ ] **Step 1: Render all slides to PNG**

Run `render_slides.py` against the final PPTX and confirm one image exists for each of the 10 slides.

- [ ] **Step 2: Inspect slides individually and as a montage**

Use `view_image` on each slide PNG at full size and `create_montage.py` for deck-level rhythm. Check the cover, both home-page screenshot slides, four endpoint slides, roadmap, and closing page specifically.

- [ ] **Step 3: Run overflow and overlap checks**

Run `slides_test.py` and fix every reported overflow. Inspect any intentional annotation overlap manually; do not leave warnings unexplained.

- [ ] **Step 4: Iterate on copy, crops, and spacing**

Shorten copy before reducing font size, preserve screenshot aspect ratios, and keep title/banner text on one line. Re-run rendering after each meaningful layout change.

- [ ] **Step 5: Record final QA evidence**

Write the final render command, slide count, overflow result, screenshot asset list, and any intentional design choices to `qa-ledger.txt`.

---

### Task 5: Final verification and handoff

**Files:**
- Verify: `D:\桌面\仓库\集团数字化管理系统阶段成果汇报.pptx`
- Verify: `D:\桌面\仓库\.tmp_ppt\qa-ledger.txt`

**Interfaces:**
- Consumes: the rendered deck and QA ledger from Task 4.
- Produces: a single verified final PPTX ready for leadership presentation.

- [ ] **Step 1: Confirm required content**

Verify the deck contains the presenter `张信哲`, date `2026年8月`, both system home-page screenshots, all four desktop/mobile deliverables, and a clearly separated next-steps slide.

- [ ] **Step 2: Confirm factual boundaries**

Verify no slide says the warehouse system is formally accepted or that the enterprise-WeChat full chain is complete; ensure unresolved items appear only as planned next work.

- [ ] **Step 3: Confirm output path and artifact health**

Verify the PPTX exists at the absolute final path, opens/rendered successfully, and contains exactly 10 slides.

- [ ] **Step 4: Preserve unrelated worktree changes**

Run `git status --short` and confirm only the plan/spec commits and intended presentation artifacts are attributable to this task; do not reset, clean, or overwrite unrelated project changes.
