# 16 - Skill 发布系统

Agent 如何通过 `publish_skill` 内置工具以编程方式创建、注册和管理 skills，与 `skill-creator` 核心 skill 协同工作。

---

## 1. 概述

Skill 发布系统连接了 **skill 创建**（文件系统）和 **skill 管理**（数据库）。它由两个组件组成：

| 组件 | 类型 | 用途 |
|------|------|------|
| `skill-creator` | 核心 skill（捆绑） | 指导 Agent 完成 skill 设计、实现、测试和优化 |
| `publish_skill` | 内置工具 | 在数据库中注册 skill 目录，将文件复制到托管存储，自动授权给创建 Agent |

没有 `publish_skill`，Agent 创建的 skills 仅存在于文件系统，对数据库支持的 skill 管理系统不可见（无搜索、无授权、无 UI 可见性）。

---

## 2. 端到端流程

```
Agent receives request to create a skill
    │
    ▼
┌─────────────────────────────────────┐
│  1. skill-creator skill activated   │
│     Agent reads SKILL.md guidance   │
│     Creates files via write_file:   │
│       skills/my-skill/SKILL.md      │
│       skills/my-skill/scripts/      │
│       skills/my-skill/references/   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  2. publish_skill tool called       │
│     publish_skill(path: "skills/    │
│       my-skill")                    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  3. Tool executes:                                  │
│     a. Validate SKILL.md + parse frontmatter        │
│     b. Derive slug, validate format                 │
│     c. Check system skill conflict                  │
│     d. Compute SHA-256 hash                         │
│     e. Copy dir → skills-store/{slug}/{version}/    │
│     f. INSERT/UPSERT into skills table              │
│     g. Auto-grant to calling agent                  │
│     h. Scan + report missing dependencies           │
│     i. Bump loader cache version                    │
│     j. Generate embedding (async)                   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  4. Result returned to agent:       │
│     - Skill ID, slug, version       │
│     - Grant confirmation            │
│     - Dep warnings (if any)         │
└─────────────────────────────────────┘
```

---

## 3. publish_skill 工具

### 参数

| 参数 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `path` | string | 是 | - | 包含 SKILL.md 的 skill 目录路径（绝对路径或相对于工作空间） |

### 激活条件

工具在网关启动时注册，当：
1. `pgStores.Skills` 可用（PostgreSQL skill 存储已初始化）
2. `PGSkillStore` 至少有一个托管目录（`skills-store/`）
3. Skills 加载器已初始化

工具出现在每个 Agent 的工具集中——无需按 Agent 配置。可通过内置工具管理 UI 切换。

### 使用的上下文值

| 上下文键 | 来源 | 用途 |
|------|------|------|
| `store.UserIDFromContext(ctx)` | WS connect / HTTP header | Skill 所有者 + 授权来源 |
| `store.AgentIDFromContext(ctx)` | Agent 循环 | 要自动授权访问的 Agent |
| `ToolWorkspaceFromCtx(ctx)` | 工具注册表 | 解析相对路径 |

### SKILL.md Frontmatter 要求

```yaml
---
name: my-skill-name          # 必需 — 显示名称
description: What it does     # 推荐 — 用于搜索 + 自动激活
slug: my-skill-name           # 可选 — 如缺失则从 name 派生
---
```

- `name` 是必需的；如缺失工具返回错误
- 如未指定，`slug` 通过 `Slugify(name)` 自动派生
- Slug 必须匹配 `^[a-z0-9][a-z0-9-]*[a-z0-9]$`

---

## 4. 核心逻辑详情

### 4.1 Slug 验证

```
name: "My Awesome Skill"
  → Slugify → "my-awesome-skill"
  → SlugRegexp check → ✓ valid
```

拒绝：前导/尾随连字符、大写、特殊字符、空格。

### 4.2 系统 Skill 冲突检查

防止覆盖捆绑 skills（pdf、xlsx、docx、pptx、skill-creator 等）：

```go
if t.skills.IsSystemSkill(slug) {
    return ErrorResult("slug conflicts with a system skill")
}
```

### 4.3 版本化存储

Skills 存储在版本化目录中。重新发布相同 slug 会递增版本：

```
skills-store/
├── my-skill/
│   ├── 1/
│   │   ├── SKILL.md
│   │   └── scripts/
│   └── 2/          ← re-publish creates new version
│       ├── SKILL.md
│       └── scripts/
```

`GetNextVersion(slug)` 从 skills 表查询 `MAX(version)`（包括已归档的 skills）。

### 4.4 数据库 Upsert

使用 `CreateSkillManaged()` 配合 `ON CONFLICT(slug) DO UPDATE`：
- 新 slug → INSERT，`visibility = 'private'`
- 已有 slug → UPDATE name、description、version、file_path、file_hash
- 重新发布已归档 skill → 状态重置为 `'active'`
- 插入/更新后异步生成 embedding

### 4.5 自动授权

当调用 Agent 在上下文中有有效 `AgentID` 时：

```go
GrantToAgent(ctx, skillID, agentID, version, userID)
```

这也会**自动提升** skill 可见性从 `private` → `internal`，使其通过 `ListAccessible()` 对被授权 Agent 可访问。

### 4.6 依赖扫描

发布后，工具对 skill 的 `scripts/` 目录运行静态分析：

1. **ScanSkillDeps** — 检测所需的二进制文件、Python 导入、Node 包
2. **CheckSkillDeps** — 验证每个依赖在系统上是否可用
3. 如发现缺失依赖：
   - 通过 `StoreMissingDeps()` 存储在 `deps` JSONB 列
   - 返回警告给 Agent，列出具体缺失包
   - 引导 Agent 通过 `exec`（pip/npm）安装或通知用户

与 HTTP 上传处理器不同，工具在缺少依赖时**不**归档 skill——它发出警告并让 Agent 决定。

### 4.7 目录复制安全

| 检查 | 操作 |
|------|------|
| 相对路径中的 `..` | 跳过（防止路径遍历） |
| 符号链接 | 跳过（防止逃逸） |
| 系统文件 | 跳过（`.DS_Store`、`__MACOSX`、`Thumbs.db` 等） |
| 总目录大小 > 20 MB | 拒绝并返回错误 |

---

## 5. skill-creator Skill

### 激活触发器

skill-creator 是捆绑的系统 skill，具有"激进"的描述，会在以下情况触发：
- 创建新 skills 或扩展 Agent 能力
- Skill 脚本、参考文档、基准优化
- 描述优化和评估测试

### 创建工作流程

1. **捕获意图** — 做什么、何时、输出
2. **研究** — 通过 docs-seeker 了解最佳实践
3. **规划** — 确定脚本、参考文档、资源
4. **初始化** — `scripts/init_skill.py <name> --path <dir>`
5. **编写** — 实现 SKILL.md + 资源
6. **测试与评估** — 并行运行的评估套件
7. **优化描述** — AI 驱动的触发器优化
8. **发布** — `publish_skill(path: "skills/<name>")`
9. **打包**（可选）— ZIP 用于外部分发
10. **迭代** — 根据反馈改进

### Skill 文件结构

```
skills/<skill-name>/
├── SKILL.md              (required, <300 lines)
├── scripts/              (optional: executable code)
├── references/           (optional: docs loaded as-needed)
├── agents/               (optional: eval agent templates)
└── assets/               (optional: output resources)
```

### 关键约束

| 资源 | 限制 |
|------|------|
| Description | ≤1024 字符 |
| SKILL.md | <300 行 |
| 每个参考文档 | <300 行 |
| Scripts | 无限制（执行，不加载到上下文） |

---

## 6. 数据库 Schema

### skills 表（相关列）

| 列 | 类型 | 用途 |
|------|------|------|
| `id` | UUID | 主键 |
| `slug` | VARCHAR(255) UNIQUE | 规范标识符 |
| `name` | VARCHAR(255) | 显示名称 |
| `description` | TEXT | 自动激活触发文本 |
| `owner_id` | VARCHAR(255) | 创建用户（或 "system"） |
| `visibility` | VARCHAR(10) | `private` → `internal`（授权时）→ `public` |
| `version` | INT | 重新发布时递增 |
| `status` | VARCHAR(20) | `active` 或 `archived` |
| `is_system` | BOOLEAN | 捆绑 skills 为 true |
| `enabled` | BOOLEAN | 管理员开关 |
| `file_path` | TEXT | 版本化目录的文件系统路径 |
| `file_hash` | VARCHAR(64) | SKILL.md 的 SHA-256 |
| `deps` | JSONB | `{"missing": ["pip:opencv", "python3"]}` |
| `frontmatter` | JSONB | 解析的 YAML 元数据 |
| `embedding` | vector(1536) | pgvector 用于相似性搜索 |

### skill_agent_grants 表

| 列 | 类型 | 用途 |
|------|------|------|
| `skill_id` | UUID FK | 引用 skills |
| `agent_id` | UUID FK | 引用 agents |
| `pinned_version` | INT | 已存储但未使用——Agent 始终使用最新版本 |
| `granted_by` | VARCHAR | 授权用户 |

---

## 7. 可见性与访问模型

```
publish_skill creates with visibility = "private"
        │
        ▼
GrantToAgent auto-promotes → "internal"
        │
        ▼
ListAccessible query includes:
  - is_system = true          (all system skills)
  - visibility = 'public'     (anyone)
  - visibility = 'private'    (owner only)
  - visibility = 'internal'   (agents/users with grants)
```

撤销最后一个授权会自动降级 `internal` → `private`（原子 SQL）。

---

## 8. 缓存失效

发布后，两个缓存被刷新：

1. **PGSkillStore 缓存** — `BumpVersion()` 设置 `version = time.Now().UnixMilli()`，使 `ListSkills()` 缓存失效（TTL 5 分钟 + 版本检查）
2. **Skills Loader 缓存** — `loader.BumpVersion()` 使用于系统提示注入的基于文件系统的 skill 索引失效

下一次 Agent 轮次会在其工具集中获取新 skill。

---

## 9. 相关文件

| 文件 | 用途 |
|------|------|
| `internal/tools/publish_skill.go` | 工具实现 |
| `internal/skills/helpers.go` | 共享辅助函数：ParseSkillFrontmatter、Slugify、IsSystemArtifact、SlugRegexp |
| `internal/store/pg/skills.go` | DB 操作：CreateSkillManaged、GetNextVersion、IsSystemSkill、StoreMissingDeps |
| `internal/store/pg/skills_grants.go` | GrantToAgent、RevokeFromAgent、ListAccessible |
| `internal/skills/loader.go` | 带优先级层次结构的文件系统 skill 加载器 |
| `internal/skills/seeder.go` | 系统 skill 种子化器（捆绑 → DB） |
| `internal/skills/dep_scanner.go` | Skill 依赖的静态分析 |
| `internal/skills/dep_checker.go` | 运行时依赖验证 |
| `internal/http/skills_upload.go` | HTTP ZIP 上传处理器（publish_skill 的替代方案） |
| `cmd/gateway.go` | 工具注册 |
| `cmd/gateway_builtin_tools.go` | 内置工具种子数据 |
| `skills/skill-creator/SKILL.md` | 核心 skill 指令 |