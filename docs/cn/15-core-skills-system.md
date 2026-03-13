# 15 - Core Skills 系统

捆绑（系统）skills 如何加载、存储、注入到 Agent 并在整个生命周期中管理——包括依赖检查、开关控制和热重载。

---

## 1. 概述

GoClaw 附带一组 **核心 skills**——基于 SKILL.md 的模块，打包在二进制文件的嵌入文件系统中。与用户上传的自定义 skills 不同，核心 skills：

- 在每次网关启动时自动种子化
- 通过内容哈希跟踪（文件未更改则不重新导入）
- 在数据库中标记 `is_system = true`
- 始终 `visibility = 'public'`（所有 Agent 可访问）
- 需进行依赖检查（如缺少必需依赖则归档）

当前捆绑的核心 skills：

| Slug | 用途 |
|------|------|
| `read-pdf` | 通过 pypdf 从 PDF 文件提取文本 |
| `read-docx` | 通过 python-docx 从 Word 文档提取文本 |
| `read-pptx` | 通过 python-pptx 从 PowerPoint 文件提取文本 |
| `read-xlsx` | 通过 openpyxl 读取/分析 Excel 电子表格 |
| `skill-creator` | 用于创建新 skills 的元 skill |

共享辅助模块位于 `skills/_shared/`，随每个 skill 一起复制，但不作为独立 skill 注册。

---

## 2. 启动流程

```
cmd/gateway.go  NewSkillLoader()
       │
       ▼
internal/skills/loader.go  NewLoader(baseDir, db)
       │  ── scans filesystem skill dirs
       │  ── wires managed DB directory
       │  ── calls BumpVersion() → invalidates list cache
       │
       ▼
internal/skills/seeder.go  Seed(ctx, db, embedFS, baseDir)
       │
       ├─ For each bundled skill in embed.FS (skills/*/SKILL.md):
       │     1. Read SKILL.md → parse YAML frontmatter (name, slug, description, author, ...)
       │     2. Compute SHA-256 of content → FileHash
       │     3. Call GetNextVersion(slug) → next DB version number
       │     4. UpsertSystemSkill(ctx, params) ──► 见 §4
       │     5. Copy skill files to baseDir/<slug>/<version>/
       │
       ├─ CheckDepsAsync(ctx, seededSlugs, baseDir, skillStore, broadcaster)
       │     └─ goroutine (non-blocking):
       │           for each slug:
       │             broadcast EventSkillDepsChecking {slug}
       │             ScanSkillDeps(skillDir) → manifest
       │             CheckSkillDeps(manifest) → (ok, missing[])
       │             StoreMissingDeps(id, missing) → UPDATE skills SET deps=...
       │             if !ok: UpdateSkill(id, {status: "archived"})
       │             else:   UpdateSkill(id, {status: "active"})
       │             broadcast EventSkillDepsChecked {slug, ok, missing}
       │
       └─ Register file watcher (500ms debounce) → on SKILL.md change: re-seed + BumpVersion
```

**关键不变量：** 启动是非阻塞的。依赖检查在后台 goroutine 中运行，并通过 WebSocket 事件通知客户端。Agent 循环在检查窗口期间不受影响。

---

## 3. Skill 目录布局

```
skills/
├── _shared/               # Shared Python helpers (not standalone skills)
│   ├── office_helpers.py
│   └── ...
├── pdf/
│   ├── SKILL.md           # Frontmatter + instructions
│   └── scripts/
│       └── read_pdf.py
├── docx/
│   ├── SKILL.md
│   └── scripts/
│       └── read_docx.py
├── pptx/
│   └── ...
├── xlsx/
│   └── ...
└── skill-creator/
    └── SKILL.md
```

每个版本复制到：`<baseDir>/<slug>/<version>/`
示例：`/app/data/skills/read-pdf/3/`

---

## 4. SKILL.md Frontmatter 格式

```yaml
---
name: Read PDF
slug: read-pdf
description: Extract and analyze text content from PDF files
author: GoClaw Team
tags: [pdf, document, extraction]
---

## Instructions

(Skill body used as system prompt injection)
```

支持的 frontmatter 字段：

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | 是 | 显示名称 |
| `slug` | 是 | 唯一标识符，kebab-case 格式 |
| `description` | 是 | Agent 搜索用的简短摘要 |
| `author` | 否 | 在 UI 自定义 skills 标签页显示 |
| `tags` | 否 | 数组，用于过滤 |

---

## 5. 基于哈希的变更检测（UpsertSystemSkill）

`UpsertSystemSkill`（`internal/store/pg/skills.go:410`）防止不必要的 DB 版本递增：

```
SELECT id, file_hash, file_path FROM skills WHERE slug = $1

Case 1: No row found
  → INSERT new skill (version = GetNextVersion())
  → BumpVersion() (cache invalidation)

Case 2: Row found, existingHash == incomingHash
  → Return unchanged (no DB write)

Case 3: Row found, existingHash IS NULL (old record, no hash stored)
  → UPDATE skills SET file_hash = $1 WHERE id = $2  (backfill only)
  → Return unchanged (no version bump)

Case 4: Row found, hash changed
  → Full UPDATE (name, description, version, file_path, file_hash, status, ...)
  → BumpVersion()
```

**为什么 Case 3 重要：** 在添加哈希跟踪之前，现有行的 `file_hash = NULL`。如果没有这个保护，每次启动都会失败于哈希相等检查并执行完整 UPDATE——即使 skill 内容没有更改也会增加 DB `version` 列。

---

## 6. 数据库 Schema

```sql
-- Core columns added for system skills (migration 017)
ALTER TABLE skills ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE skills ADD COLUMN deps     JSONB    NOT NULL DEFAULT '{}';
ALTER TABLE skills ADD COLUMN enabled  BOOLEAN  NOT NULL DEFAULT true;

-- Indexes
CREATE INDEX idx_skills_system  ON skills(is_system) WHERE is_system = true;
CREATE INDEX idx_skills_enabled ON skills(enabled)   WHERE enabled = false;
```

`deps` JSONB 结构：`{"missing": ["pip:openpyxl", "npm:marked"]}`

与核心 skills 相关的完整 `skills` 表列：

| 列 | 类型 | 用途 |
|------|------|------|
| `id` | UUID | 主键 |
| `slug` | TEXT | 唯一 skill 标识符 |
| `name` | TEXT | 显示名称 |
| `description` | TEXT | Agent 面向的摘要 |
| `version` | INT | 内容更改时递增 |
| `is_system` | BOOL | 捆绑 skills 为 true |
| `status` | TEXT | `active` / `archived` |
| `enabled` | BOOL | 用户开关（与 status 独立） |
| `file_path` | TEXT | 磁盘上版本化副本的路径 |
| `file_hash` | TEXT | SKILL.md 内容的 SHA-256 |
| `frontmatter` | JSONB | 解析的 YAML 键值对 |
| `deps` | JSONB | 依赖扫描的 `{"missing": [...]}` |
| `embedding` | vector | pgvector 用于语义搜索的嵌入 |

---

## 7. 依赖系统

### 7a. 扫描器（`internal/skills/dep_scanner.go`）

静态分析 `scripts/` 子目录的 Python 和 Node.js 导入：

**Python 检测：**
- 正则匹配：`import X`、`from X import ...`
- 运行子进程检查时设置 `PYTHONPATH=scriptsDir`——这使得本地辅助模块（如 `office_helpers`）成功解析，无误报

**Node.js 检测：**
- 匹配 `require('X')` 和 `import ... from 'X'`
- 跳过相对导入（`./`、`../`）
- 跳过 Node.js 内置模块（`fs`、`path`、`os`...）

**Shebang 检测：**
- `#!/usr/bin/env python3` 或 `#!/usr/bin/env node` 设置运行时要求

结果：`SkillManifest{RequiresPython [], RequiresNode [], ScriptsDir}`

### 7b. 检查器（`internal/skills/dep_checker.go`）

通过子进程验证每个导入在运行时是否能解析：

**Python 检查：**
```python
# One-liner per import, run with PYTHONPATH=scriptsDir
python3 -c "import openpyxl"   # success = installed
python3 -c "import missing_pkg" # exit 1 = missing
```
- `importToPip` 映射将导入名转换为 pip 包名（如 `PIL` → `Pillow`）
- 缺失 → `"pip:openpyxl"`

**Node.js 检查：**
```js
// cmd.Dir = scriptsDir
node -e "require.resolve('marked')"  // success = installed
```
- 缺失 → `"npm:marked"`

返回：`(allOk bool, missing []string)`

### 7c. 安装器（`internal/skills/dep_installer.go`）

按前缀安装单个依赖：

| 前缀 | 命令 |
|------|------|
| `pip:name` | `pip3 install --target $PIP_TARGET name` |
| `npm:name` | `npm install -g name` |
| `apk:name` | `doas apk add --no-cache name` |
| （无前缀） | 视为 `apk:` |

安装后：重新运行扫描以更新 `deps` 列和 skill `status`。

### 7d. 运行时检查器（`internal/skills/runtime_check.go`）

在依赖检查之前调用，检测可用的运行时：

```go
type RuntimeInfo struct {
    PythonAvailable bool
    PipAvailable    bool
    NodeAvailable   bool
    NpmAvailable    bool
    DoasAvailable   bool
}
```

探测：`python3 --version`、`pip3 --version`、`node --version`、`npm --version`、`doas --version`

结果通过 `GET /v1/skills/runtimes` 暴露，并在核心运行时缺失时显示在 UI `MissingDepsPanel` 中。

---

## 8. Agent 注入

文件：`internal/agent/loop_history.go` — `resolveSkillsSummary()`

### 阈值

```go
const (
    skillInlineMaxCount  = 40   // max skills to inline
    skillInlineMaxTokens = 5000 // max estimated token budget
)
```

### 决策逻辑

```
skillFilter = agent.AllowedSkills  (nil = all enabled skills)

FilterSkills(skillFilter)
  └── excludes disabled skills (enabled = false)
  └── if allowList != nil: also filters by slug

Count skills → if > 40 OR estimated tokens > 5000:
  → return "" (agent uses skill_search tool instead)

Count ≤ 40 AND tokens ≤ 5000:
  → build XML block injected into system prompt:

<available_skills>
  <skill name="read-pdf" slug="read-pdf">Extract text from PDF files</skill>
  <skill name="read-docx" slug="read-docx">Extract text from Word documents</skill>
  ...
</available_skills>
```

**Token 估算：** 每个 skill `(len(Name) + len(Description) + 10) / 4` ≈ 每个 100-150 token。

### 搜索回退（BM25）

当 skills 超过阈值时，改为注入 `skill_search` 工具。Agent 用查询调用它；结果按 BM25 分数排序（`internal/skills/search.go`）。

---

## 9. 开关系统（enabled 列）

`enabled` 列将**用户意图**与**依赖可用性**（`status`）解耦：

| enabled | status | 效果 |
|---------|--------|------|
| true | active | 完全可用，注入到提示中 |
| true | archived | 缺少依赖；注入但警告 Agent |
| false | active | 隐藏——不注入，不可搜索 |
| false | archived | 隐藏——不注入，跳过依赖检查 |

**开启流程**（`POST /v1/skills/{id}/toggle` 且 `{enabled: true}`）：
1. `ToggleSkill(id, true)` → `UPDATE skills SET enabled = true`
2. 重新运行此 skill 的 `ScanSkillDeps` + `CheckSkillDeps`
3. `StoreMissingDeps` + `UpdateSkill({status: "active"|"archived"})`
4. `BumpVersion()` → 使列表缓存失效
5. 返回 `{ok, enabled, status}`

**关闭流程**（`{enabled: false}`）：
1. `ToggleSkill(id, false)` → `UPDATE skills SET enabled = false`
2. `BumpVersion()` → 列表缓存失效
3. Skill 在下次请求时从所有 Agent 提示中消失

**存储层强制执行：**

| 方法 | 禁用 skills 的行为 |
|------|-------------------|
| `ListSkills()` | 返回禁用的 skills（管理 UI 需要） |
| `FilterSkills()` | **排除**禁用的（Agent 注入门控） |
| `ListAllSkills()` | 排除禁用的（依赖重扫描跳过它们） |
| `ListSystemSkillDirs()` | 排除禁用的（启动依赖扫描跳过它们） |
| `SearchByEmbedding()` | 排除禁用的 |
| `BackfillEmbeddings()` | 排除禁用的 |

---

## 10. 缓存失效（BumpVersion）

`BumpVersion()` 更新内存中的原子 `int64`（Unix 纳秒时间戳）。它**不**触及 DB `version` 列。

`ListSkills()` 使用此版本 + TTL 安全网缓存结果。BumpVersion 时，下次调用 `ListSkills()` 会重新查询 DB。

触发条件：
- 插入新 skill
- Skill 内容哈希更改 → 完整 UPDATE
- Skill 启用/禁用切换
- 存储缺失依赖

---

## 11. WebSocket 事件

在依赖操作期间广播给所有连接的客户端：

| 事件 | 负载 | 触发 |
|------|------|------|
| `skill.deps.checking` | `{slug}` | 即将检查 skill 的依赖 |
| `skill.deps.checked` | `{slug, ok, missing[]}` | 依赖检查完成 |
| `skill.deps.installing` | `{deps[]}` | 批量安装开始 |
| `skill.deps.installed` | `{system[], pip[], npm[], errors[]}` | 批量安装完成 |
| `skill.dep.item.installing` | `{dep}` | 单个依赖安装开始 |
| `skill.dep.item.installed` | `{dep, ok, error?}` | 单个依赖安装完成 |

前端通过 `use-query-invalidation.ts` 监听这些事件以自动刷新 skills 列表。

---

## 12. HTTP API 端点

`/v1/skills/` 下的所有端点需要认证（`authMiddleware`）。

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/v1/skills` | 列出所有 skills（管理员） |
| `POST` | `/v1/skills/upload` | 上传自定义 skill ZIP |
| `POST` | `/v1/skills/rescan-deps` | 重新扫描所有启用的 skills 的缺失依赖 |
| `POST` | `/v1/skills/install-deps` | 安装所有缺失依赖（批量） |
| `POST` | `/v1/skills/install-dep` | 安装单个依赖，广播事件 |
| `GET` | `/v1/skills/runtimes` | 检查 python3/node/pip/npm 可用性 |
| `GET` | `/v1/skills/{id}` | 获取单个 skill |
| `PUT` | `/v1/skills/{id}` | 更新 skill 元数据（name、description、visibility、tags） |
| `DELETE` | `/v1/skills/{id}` | 删除自定义 skill |
| `POST` | `/v1/skills/{id}/toggle` | 启用/禁用 skill |
| `GET` | `/v1/skills/{id}/versions` | 列出可用版本 |
| `GET` | `/v1/skills/{id}/files` | 列出版本中的文件 |
| `GET` | `/v1/skills/{id}/files/{path}` | 获取文件内容 |

**注意：** `PUT /v1/skills/{id}` 明确忽略 `enabled` 字段——切换必须通过专用端点以触发依赖重新检查。

---

## 13. WebSocket RPC 方法

| 方法 | 描述 |
|------|------|
| `skills.list` | 返回所有 skills，含 enabled/status/missing_deps |
| `skills.get` | 返回完整 skill 详情，包括 SKILL.md 内容 |
| `skills.update` | 更新 skill 元数据（visibility、tags、description） |

---

## 14. 文件监视器（热重载）

`internal/skills/watcher.go` 使用 `fsnotify` 监视托管的 skills 目录：

- **防抖：** 500ms——快速保存不会触发多次重新种子化
- **变更时：** 调用 `Seed()` → `CheckDepsAsync()` → `BumpVersion()`
- **范围：** 递归监视 `<baseDir>/` 的 `SKILL.md` 修改

这允许在生产环境中编辑核心 skill 指令而无需重启网关。

---

## 15. 数据流摘要

```
Embed FS (skills/)
      │
      ▼  startup
  Seeder.Seed()
      │  UpsertSystemSkill (hash check)
      │  Copy files to baseDir/<slug>/<version>/
      ▼
PostgreSQL skills table
  is_system=true, status=active|archived, enabled=true|false
      │
      ├──► ListSkills() [cached, version-gated]
      │         │
      │         └──► FilterSkills(allowList) ──► agent system prompt
      │                  (excludes disabled)       (inline XML or search)
      │
      ├──► SearchByEmbedding() ──► skill_search tool results
      │
      └──► HTTP/WS API ──► UI (skills-page.tsx)
                               toggle, rescan, install deps
```