# 14 - Skills 运行时环境

Skills 如何在 Docker 容器内访问 Python、Node.js 和系统工具。涵盖预装包、运行时安装和安全约束。

---

## 1. 架构概述

```
┌─────────────────────────────────────────────────────────┐
│  Docker Container (Alpine 3.22, read_only: true)        │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │  Pre-installed   │  │  Writable Runtime Dir        │  │
│  │  (image layer)   │  │  /app/data/.runtime/         │  │
│  │                  │  │                              │  │
│  │  python3, node   │  │  pip/        ← PIP_TARGET   │  │
│  │  gh, pandoc      │  │  pip-cache/  ← PIP_CACHE    │  │
│  │  pypdf, openpyxl │  │  npm-global/ ← NPM_PREFIX   │  │
│  │  pandas, etc.    │  │                              │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│                                                         │
│  Volumes (read-write):                                  │
│    /app/data      ← goclaw-data volume                  │
│    /app/workspace ← goclaw-workspace volume             │
│                                                         │
│  tmpfs (noexec):                                        │
│    /tmp           ← 256MB, no executables               │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 预装包（选项 A）

在 Dockerfile 中构建时安装，当 `ENABLE_PYTHON=true`。

### Python 包

| 包 | 版本 | 使用者 |
|------|------|--------|
| `pypdf` | latest | pdf skill |
| `openpyxl` | latest | xlsx skill |
| `pandas` | latest | xlsx skill（数据分析） |
| `python-pptx` | latest | pptx skill |
| `markitdown` | latest | pptx skill（内容提取） |

### Node.js 包（全局）

| 包 | 使用者 |
|------|--------|
| `docx` | docx skill（文档创建） |
| `pptxgenjs` | pptx skill（演示文稿创建） |

### 系统工具

| 工具 | 用途 |
|------|------|
| `python3` + `py3-pip` | Python 运行时 + 包管理器 |
| `nodejs` + `npm` | Node.js 运行时 + 包管理器 |
| `pandoc` | 文档格式转换 |
| `github-cli` (`gh`) | GitHub API 操作 |

---

## 3. 运行时包安装（选项 B）

入口点（`docker-entrypoint.sh`）配置可写目录，以便 Agent 可以在运行时安装额外包而无需 `sudo`。

### 环境变量（由入口点设置）

```sh
# Python
PYTHONPATH=/app/data/.runtime/pip
PIP_TARGET=/app/data/.runtime/pip
PIP_BREAK_SYSTEM_PACKAGES=1
PIP_CACHE_DIR=/app/data/.runtime/pip-cache

# Node.js
NPM_CONFIG_PREFIX=/app/data/.runtime/npm-global
NODE_PATH=/usr/local/lib/node_modules:/app/data/.runtime/npm-global/lib/node_modules
PATH=/app/data/.runtime/npm-global/bin:/app/data/.runtime/pip/bin:$PATH
```

### 工作原理

1. **Python**：`pip3 install <package>` 安装到 `/app/data/.runtime/pip/`（可写卷）。`PYTHONPATH` 确保 Python 能在那里找到包。
2. **Node.js**：`npm install -g <package>` 安装到 `/app/data/.runtime/npm-global/`。`NODE_PATH` 包括系统全局（`/usr/local/lib/node_modules`）和运行时全局。
3. **持久性**：运行时安装的包在同一容器生命周期内的工具调用之间持久存在（卷支持）。

### Agent 指导

系统提示包含此部分，以便 Agent 知道有哪些可用：

```
Pre-installed: python3, node, gh, pypdf, openpyxl, pandas, python-pptx,
markitdown, docx (npm), pptxgenjs (npm), pandoc.
To install additional packages: pip3 install <pkg> or npm install -g <pkg>
```

---

## 4. 安全约束

| 约束 | 详情 |
|------|------|
| `read_only: true` | 容器根文件系统不可变；只有卷可写 |
| `/tmp` 是 `noexec` | 无法从 tmpfs 执行二进制文件 |
| `cap_drop: ALL` | 无权限提升 |
| `no-new-privileges` | 阻止 setuid/setgid |
| 执行拒绝模式 | 阻止 `curl \| sh`、反向 shell、加密矿工等（见 `shell.go`） |
| `.goclaw/` 被拒绝 | Exec 工具阻止访问 `.goclaw/`，除了 `.goclaw/skills-store/` |

### Agent 可以做什么

- 通过 exec 工具运行 Python/Node 脚本
- 通过 `pip3 install` / `npm install -g` 安装包
- 访问 `/app/workspace/` 中的文件，包括 `.media/` 子目录
- 从 `.goclaw/skills-store/` 读取 skill 文件

### Agent 不能做什么

- 写入系统路径（根文件系统只读）
- 从 `/tmp` 执行二进制文件（noexec）
- 访问 `.goclaw/`（除了 skills-store）
- 运行被拒绝的 shell 模式（网络工具、反向 shell 等）

---

## 5. 媒体文件访问

上传的文件（来自 web 聊天、Telegram、Discord 等）持久化到：

```
/app/workspace/.media/{sessionHash}/{uuid}.{ext}
```

`enrichDocumentPaths()` 函数将完整路径注入 `<media:document>` 标签：

```
<media:document name="report.pdf" path="/app/workspace/.media/abc123/uuid.pdf">
```

Agent 可以通过 exec 直接读取这些文件——无需复制到 `/tmp`。

---

## 6. 捆绑 Skills

随 Docker 镜像一起提供的 Skills，位于 `/app/bundled-skills/`。在加载器层次结构中优先级最低——用户上传的 skills（managed/skills-store）会覆盖它们。

### 捆绑 Skills 列表

| Skill | 用途 |
|------|------|
| `pdf` | 读取、创建、合并、拆分 PDF |
| `xlsx` | 读取、创建、编辑电子表格 |
| `docx` | 读取、创建、编辑 Word 文档 |
| `pptx` | 读取、创建、编辑演示文稿 |
| `skill-creator` | 创建新 skills |
| `ai-multimodal` | AI 驱动的媒体分析和生成 |

### 工作原理

1. Skills 源文件位于仓库的 `skills/` 目录
2. Dockerfile 将它们复制到镜像中的 `/app/bundled-skills/`
3. `gateway.go` 将此路径作为 `builtinSkills` 传递给 `skills.NewLoader()`
4. 加载器优先级：workspace > project-agents > personal-agents > global > **builtin** > managed

当用户通过 UI 上传同名的 skill 时，托管版本优先。

### 添加新的捆绑 Skill

1. 将 skill 目录放在 `skills/<name>/` 下，根目录有 `SKILL.md`
2. 重建：`docker compose ... up -d --build`

---

## 7. 添加新的预装包

要向 Docker 镜像添加新包：

1. **Python**：添加到 `Dockerfile` 中的 `pip3 install` 行
2. **Node.js**：添加到 `Dockerfile` 中的 `npm install -g` 行
3. **系统工具**：添加到 `Dockerfile` 中的 `apk add` 行
4. **系统提示**：更新 `systemprompt.go`（`buildToolSection`）中的预装列表
5. **重建**：`docker compose ... up -d --build`

对于只有特定 skills 需要的包，优先使用运行时安装（选项 B）以保持镜像精简。