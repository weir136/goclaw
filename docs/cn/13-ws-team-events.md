# WebSocket Team & Delegation Events

团队 Agent 操作、委派生命周期和管理 CRUD 的所有 WebSocket 事件完整参考。

所有事件通过 WebSocket 协议作为 JSON 帧发送：
```json
{"type": "event", "event": "<event_name>", "payload": { ... }}
```

事件通过 `msgBus.Broadcast(bus.Event{})` 发出，并转发给所有连接的 WS 客户端（由 `server.go` 的网关订阅者过滤）。

---

## 事件目录

### 委派生命周期事件

#### `delegation.started`
当 Lead Agent 向成员 Agent 发起委派时发出。

```json
{
  "delegation_id": "a1b2c3d4",
  "source_agent_id": "019c839b-...",
  "source_agent_key": "default",
  "source_display_name": "Default Agent",
  "target_agent_id": "019ca748-...",
  "target_agent_key": "tieu-la",
  "target_display_name": "Tieu La",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "mode": "async",
  "task": "Create Instagram image for new product",
  "team_id": "019c9503-...",
  "team_task_id": "019ca84f-...",
  "status": "running",
  "created_at": "2026-03-05T10:00:00Z"
}
```

#### `delegation.completed`
当委派成功完成时发出（质量门控通过）。

与 `delegation.started` 相同的负载，附加：
- `status`: `"completed"`
- `elapsed_ms`: 总持续时间（毫秒）

#### `delegation.failed`
当委派失败时发出（Agent 错误或质量门控拒绝）。

与 `delegation.started` 相同的负载，附加：
- `status`: `"failed"`
- `error`: 错误消息字符串
- `elapsed_ms`: 总持续时间

#### `delegation.cancelled`
当委派被取消时发出（通过 `/stopall`、团队任务取消或直接取消）。

与 `delegation.started` 相同的负载，附加：
- `status`: `"cancelled"`
- `elapsed_ms`: 总持续时间

#### `delegation.progress`
针对活跃的异步委派周期性发出（约 30 秒）。将同一源 Agent 的所有活跃委派分组。

```json
{
  "source_agent_id": "019c839b-...",
  "source_agent_key": "default",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "team_id": "019c9503-...",
  "active_delegations": [
    {
      "delegation_id": "a1b2c3d4",
      "target_agent_key": "tieu-la",
      "target_display_name": "Tieu La",
      "elapsed_ms": 45000,
      "team_task_id": "019ca84f-..."
    },
    {
      "delegation_id": "e5f6g7h8",
      "target_agent_key": "tieu-ngon",
      "target_display_name": "Tieu Ngon",
      "elapsed_ms": 30000,
      "team_task_id": "019ca850-..."
    }
  ]
}
```

#### `delegation.accumulated`
当异步委派完成但兄弟委派仍在运行时发出。结果被累积，将在所有兄弟委派完成时公告。

```json
{
  "delegation_id": "a1b2c3d4",
  "source_agent_id": "019c839b-...",
  "source_agent_key": "default",
  "target_agent_key": "tieu-la",
  "target_display_name": "Tieu La",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "team_id": "019c9503-...",
  "team_task_id": "019ca84f-...",
  "siblings_remaining": 1,
  "elapsed_ms": 45300
}
```

#### `delegation.announce`
当最后一个兄弟委派完成且所有累积的结果被发送回 Lead Agent 时发出。

```json
{
  "source_agent_id": "019c839b-...",
  "source_agent_key": "default",
  "source_display_name": "Default Agent",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "team_id": "019c9503-...",
  "results": [
    {
      "agent_key": "tieu-la",
      "display_name": "Tieu La",
      "has_media": true,
      "content_preview": "Created Instagram post image..."
    },
    {
      "agent_key": "tieu-ngon",
      "display_name": "Tieu Ngon",
      "has_media": false,
      "content_preview": "Wrote caption for you..."
    }
  ],
  "completed_task_ids": ["019ca84f-...", "019ca850-..."],
  "total_elapsed_ms": 52000,
  "has_media": true
}
```

#### `delegation.quality_gate.retry`
当质量门控拒绝委派结果并触发重试时发出。

```json
{
  "delegation_id": "a1b2c3d4",
  "target_agent_key": "tieu-la",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "team_id": "019c9503-...",
  "team_task_id": "019ca84f-...",
  "gate_type": "agent",
  "attempt": 2,
  "max_retries": 3,
  "feedback": "Image aspect ratio should be 4:5..."
}
```

---

### 团队任务事件

#### `team.task.created`
当创建新的团队任务时发出（手动或由委派自动创建）。

```json
{
  "team_id": "019c9503-...",
  "task_id": "019ca84f-...",
  "subject": "Create Instagram image",
  "status": "pending",
  "owner_agent_key": "",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "timestamp": "2026-03-05T10:00:00Z"
}
```

#### `team.task.claimed`
当 Agent 认领任务时发出（手动或委派前自动认领）。

```json
{
  "team_id": "019c9503-...",
  "task_id": "019ca84f-...",
  "status": "in_progress",
  "owner_agent_key": "tieu-la",
  "owner_display_name": "Tieu La",
  "user_id": "user123",
  "channel": "delegate",
  "chat_id": "-100123456",
  "timestamp": "2026-03-05T10:00:01Z"
}
```

#### `team.task.completed`
当任务完成时发出（手动或由委派自动完成）。

```json
{
  "team_id": "019c9503-...",
  "task_id": "019ca84f-...",
  "status": "completed",
  "owner_agent_key": "tieu-la",
  "owner_display_name": "Tieu La",
  "user_id": "user123",
  "channel": "delegate",
  "chat_id": "-100123456",
  "timestamp": "2026-03-05T10:00:45Z"
}
```

#### `team.task.cancelled`
当任务被取消时发出。与 `team.task.completed` 分开以确保语义正确。

```json
{
  "team_id": "019c9503-...",
  "task_id": "019ca84f-...",
  "status": "cancelled",
  "reason": "Task no longer needed",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456",
  "timestamp": "2026-03-05T10:01:00Z"
}
```

---

### 团队消息事件

#### `team.message.sent`
当 Agent 向另一个 Agent 发送消息或向团队广播时发出。

```json
{
  "team_id": "019c9503-...",
  "from_agent_key": "default",
  "from_display_name": "Default Agent",
  "to_agent_key": "tieu-la",
  "to_display_name": "Tieu La",
  "message_type": "chat",
  "preview": "Please create an Instagram image...",
  "task_id": "",
  "user_id": "user123",
  "channel": "telegram",
  "chat_id": "-100123456"
}
```

对于广播消息：`to_agent_key = "broadcast"`，`to_display_name = ""`。

---

### 团队 CRUD 事件（管理）

这些事件在通过 Web UI 管理团队时从 RPC 处理器发出。无路由上下文（user_id/channel/chat_id），因为这些是管理操作。

#### `team.created`
```json
{
  "team_id": "019c9503-...",
  "team_name": "Content Team",
  "lead_agent_key": "default",
  "lead_display_name": "Default Agent",
  "member_count": 3
}
```

#### `team.updated`
```json
{
  "team_id": "019c9503-...",
  "team_name": "Content Team",
  "changes": ["settings"]
}
```

#### `team.deleted`
```json
{
  "team_id": "019c9503-...",
  "team_name": "Content Team"
}
```

#### `team.member.added`
```json
{
  "team_id": "019c9503-...",
  "team_name": "Content Team",
  "agent_id": "019ca748-...",
  "agent_key": "tieu-la",
  "display_name": "Tieu La",
  "role": "member"
}
```

#### `team.member.removed`
```json
{
  "team_id": "019c9503-...",
  "team_name": "Content Team",
  "agent_id": "019ca748-...",
  "agent_key": "tieu-la",
  "display_name": "Tieu La"
}
```

---

### Agent Link 事件（管理）

在通过 Web UI 管理 Agent 链接时从 RPC 处理器发出。

#### `agent_link.created`
```json
{
  "link_id": "019cab12-...",
  "source_agent_id": "019c839b-...",
  "source_agent_key": "default",
  "target_agent_id": "019ca748-...",
  "target_agent_key": "tieu-la",
  "direction": "outbound",
  "team_id": "019c9503-...",
  "status": "active"
}
```

#### `agent_link.updated`
```json
{
  "link_id": "019cab12-...",
  "source_agent_key": "default",
  "target_agent_key": "tieu-la",
  "direction": "bidirectional",
  "status": "active",
  "changes": ["direction", "settings"]
}
```

#### `agent_link.deleted`
```json
{
  "link_id": "019cab12-...",
  "source_agent_key": "default",
  "target_agent_key": "tieu-la"
}
```

---

### Agent 事件（委派上下文）

`AgentEvent` 负载（作为 `"event": "agent"` 广播）现在包含可选的委派和路由上下文：

**`tool.call` 示例**（委派内的成员 Agent）：
```json
{
  "type": "tool.call",
  "agentId": "tieu-la",
  "runId": "delegate-a1b2c3d4",
  "delegationId": "a1b2c3d4",
  "teamId": "019c9503-...",
  "teamTaskId": "019ca84f-...",
  "parentAgentId": "default",
  "userId": "user123",
  "channel": "telegram",
  "chatId": "-100123456",
  "payload": {"name": "create_image", "id": "call_xxx"}
}
```

**`tool.result` 示例：**
```json
{
  "type": "tool.result",
  "agentId": "tieu-la",
  "runId": "delegate-a1b2c3d4",
  "delegationId": "a1b2c3d4",
  "teamId": "019c9503-...",
  "teamTaskId": "019ca84f-...",
  "parentAgentId": "default",
  "userId": "user123",
  "channel": "telegram",
  "chatId": "-100123456",
  "payload": {"name": "create_image", "id": "call_xxx", "is_error": false}
}
```

> **注意：** 工具参数和结果内容有意从负载中省略，以避免通过 WS 泄露敏感数据。只包括工具名称、调用 ID 和错误状态。

**Agent 事件子类型**（负载内的 `type` 字段）：

| 常量 | 类型 | 描述 |
|------|------|------|
| `AgentEventRunStarted` | `run.started` | Agent 运行开始 |
| `AgentEventRunCompleted` | `run.completed` | Agent 运行成功完成 |
| `AgentEventRunFailed` | `run.failed` | Agent 运行失败 |
| `AgentEventRunRetrying` | `run.retrying` | Agent 运行错误后重试 |
| `AgentEventToolCall` | `tool.call` | Agent 调用工具 |
| `AgentEventToolResult` | `tool.result` | 工具执行完成 |
| *(chat events)* | `chunk` | 流式文本块 |
| *(chat events)* | `thinking` | Extended thinking 内容 |

**注意：** 当 `Stream: true` 时，`chunk` 和 `thinking` 增量发出（每个流式片段一个事件）。当 `Stream: false`（如委派运行）时，它们在 LLM 响应接收后作为包含完整内容的单个事件发出。两种路径都携带完整的委派上下文。

仅当 Agent 在委派内运行时才存在的字段：
- `delegationId` — 此委派的关联 ID
- `teamId` — 团队范围（如果基于团队）
- `teamTaskId` — 关联的团队任务
- `parentAgentId` — 发起委派的 Lead Agent key

可用时始终存在的字段：
- `userId` — 范围用户 ID（群聊：`"group:{channel}:{chatID}"`）
- `channel` — 来源频道（telegram、discord、web 等）
- `chatId` — 来源聊天/会话 ID

客户端可区分 Lead 与成员 Agent 事件：
- `parentAgentId` 不存在 → Lead Agent 事件
- `parentAgentId` 存在 → 成员 Agent 事件（委派）

---

## 事件流时间线

```
User sends "Create Instagram post" to Default Agent (lead)
  |
  v
[agent] run.started          agentId=default
[agent] chunk                agentId=default, content="Let me assign..."
[agent] tool.call            agentId=default, tool=delegate
  |
  |-- [delegation.started]   target=tieu-la, task="Create image", mode=async
  |-- [delegation.started]   target=tieu-ngon, task="Write caption", mode=async
  |
  |   (member agents run in parallel)
  |
  |-- [agent] run.started    agentId=tieu-la, delegationId=xxx, parentAgentId=default
  |-- [agent] run.started    agentId=tieu-ngon, delegationId=yyy, parentAgentId=default
  |
  |-- [agent] tool.call      agentId=tieu-la, tool=create_image, delegationId=xxx
  |-- [agent] tool.result    agentId=tieu-la, delegationId=xxx
  |
  |-- [delegation.progress]  active=[{tieu-la, 30s}, {tieu-ngon, 30s}]
  |
  |-- [agent] run.completed  agentId=tieu-la, delegationId=xxx
  |-- [delegation.completed] target=tieu-la, elapsed_ms=35000
  |-- [delegation.accumulated] target=tieu-la, siblings_remaining=1
  |
  |-- [agent] run.completed  agentId=tieu-ngon, delegationId=yyy
  |-- [delegation.completed] target=tieu-ngon, elapsed_ms=42000
  |-- [delegation.announce]  results=[{tieu-la, has_media}, {tieu-ngon}]
  |
  |   (lead receives announce, processes results)
  |
  |-- [agent] run.started    agentId=default
  |-- [agent] chunk          agentId=default, content="Here are the results..."
  +-- [agent] run.completed  agentId=default
```

---

## 常量参考

所有事件名称常量定义在 `pkg/protocol/events.go`：

| 常量 | 事件名称 |
|------|----------|
| `EventDelegationStarted` | `delegation.started` |
| `EventDelegationCompleted` | `delegation.completed` |
| `EventDelegationFailed` | `delegation.failed` |
| `EventDelegationCancelled` | `delegation.cancelled` |
| `EventDelegationProgress` | `delegation.progress` |
| `EventDelegationAccumulated` | `delegation.accumulated` |
| `EventDelegationAnnounce` | `delegation.announce` |
| `EventQualityGateRetry` | `delegation.quality_gate.retry` |
| `EventTeamTaskCreated` | `team.task.created` |
| `EventTeamTaskClaimed` | `team.task.claimed` |
| `EventTeamTaskCompleted` | `team.task.completed` |
| `EventTeamTaskCancelled` | `team.task.cancelled` |
| `EventTeamMessageSent` | `team.message.sent` |
| `EventTeamCreated` | `team.created` |
| `EventTeamUpdated` | `team.updated` |
| `EventTeamDeleted` | `team.deleted` |
| `EventTeamMemberAdded` | `team.member.added` |
| `EventTeamMemberRemoved` | `team.member.removed` |
| `EventAgentLinkCreated` | `agent_link.created` |
| `EventAgentLinkUpdated` | `agent_link.updated` |
| `EventAgentLinkDeleted` | `agent_link.deleted` |

类型化负载结构体定义在 `pkg/protocol/team_events.go`。