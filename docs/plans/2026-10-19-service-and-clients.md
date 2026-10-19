# 服务契约与客户端

- 日期：2026-10-19
- 相关：第一期（服务契约、简介卡、群项目记忆、聊天时间戳、密钥新建），第四期（随处 @）、第五期（手机端）在这份契约上继续

## 为什么

现在只有一种界面：嵌在 DSH 里的桌面界面。它直接读 `localStorage` 存已读和表情，自己算新 Bot 的默认名字和模型，聊天正文直接用 DSH 的会话接口渲染。换一台设备、换一个窗口，这些就对不上；以后加手机端和远程网页时，每加一个界面都要再实现一遍。

所以先定一条规则和一份接口：**服务端定，客户端组合**。业务逻辑、校验、权限、默认值、设置，以及换设备也要一致的数据都在服务端；界面只做显示、输入和接口组合。这样手机端、远程网页、Chrome 扩展都只是同一个 `/api/bot` 的另一个调用方。

## 规则：服务端定，客户端组合

- 服务端是 `ds-bot` 插件的 host 部分（`index.js`、`src/host/`），跑在 DSH 进程里，对外只有 `POST /api/bot`。
- 客户端是任何调用 `/api/bot` 的界面：现在的桌面界面（`src/client/`）、以后的手机端和远程网页、第三期的 Chrome 扩展。
- 判断放哪：**换一台设备打开还应该一样吗？** 一样就放服务端；只和这台设备有关（窗口宽度、这个窗口开着哪一页、草稿）才留在客户端。
- 鉴权走 DSH 的 `/api` 通道：本机是会话 cookie，远程是 DSH Web 的 token cookie 加 `DSH_TRUSTED_HOST`。插件不另做登录。
- 一个功能算做完，是服务端接口加测试通过；界面是在这之上的组合。

## 接口

### 传输和错误

- `POST /api/bot`，请求体 `{ "endpoint": "<名字>", "payload": { … } }`。
- 成功：`{ "ok": true, "value": … }`；失败：`{ "ok": false, "error": { "code": "bot/…", "message": "…", "details": {} } }`。HTTP 状态一律 200，错误在 JSON 里。
- `bot/not-found` 是未知接口；`bot/invalid` 是参数不对；`bot/read-only` 是另一个 dsh 持有团队时对写接口的拒绝；`bot/internal` 是插件自己的程序错误。

### hello

`hello` 是客户端启动时该问的第一个接口，也是接口版本的唯一来源：

```json
{
  "interfaceVersion": 1,
  "pluginVersion": "0.1.7",
  "endpoints": [{ "name": "state", "read": true }, …],
  "features": {
    "memory": true,
    "browser": false,
    "schedules": true,
    "readOnly": null,
    "dsh": { "credentials": true, "settings": true, "deepseekAccount": true, "pluginManager": true, "agentDefaultModel": true, "permissionPresets": true, "agentPresets": true, "profileContext": true, "launchEnvironment": true, "sessionProjections": true }
  }
}
```

- `interfaceVersion` 只在出现**不兼容**改动时加一：删接口、改已有参数的含义、改返回的形状。加接口、加可选参数、加返回字段都不加版本号。
- `readOnly` 不是布尔值：`null` 表示这台主机能写；字符串是这台主机只能读的原因（另一个 dsh 持有团队），客户端据此隐藏写操作。
- `features.dsh` 是第 0 步能力清单的运行时版本：某项为 false 时，对应界面不出现，而不是点了才报错。

### 只读主机

另一个 dsh 持有团队时（`state.lock`），这台主机只读。接口分两类：

- **只读接口**可以在只读主机上调用：`hello`、`state`、`chat`、`earlier`、`memory-view`、`usage`、`diagnostics*`、`update-*` 等。
- **写接口**一律返回 `bot/read-only`，消息就是原因。客户端用 `features.readOnly` 提前隐藏写操作。

`src/host/interface.js` 的 `ENDPOINTS` 是唯一名单；`READ_ENDPOINTS` 是可以在只读主机上调用的子集。测试会逐个调用名单里的接口，确认没有拼错或漏装。

### 接口清单

新接口在表尾；已有接口按用途分组。`只读` 一列表示只读主机能不能调。

| 接口 | 参数 | 返回 | 只读 |
|---|---|---|---|
| `hello` | 无 | 接口版本、插件版本、接口名单、功能开关 | 是 |
| `state` | `since?`、`models?`、`locale?` | 团队视图（含 `reads`、`reactions`、`defaults`、`prefs`） | 是 |
| `models` | 无 | `modelsKey` | 是 |
| `efforts` | `ref` | 模型的思考强度 | 是 |
| `providers` | 无 | 提供方与密钥状态 | 是 |
| `provider-key` | `provider`、`value`（null 删除） | 提供方视图 | 否 |
| `provider-add` | 提供方定义 | 提供方视图 | 否 |
| `provider-models` | `provider` 等 | 发现的模型 | 是 |
| `provider-remove` | `provider` | 提供方视图 | 否 |
| `duplicate-bot` | `id` | 新 Bot | 否 |
| `set-prefs` | `theme?`、`accent?`、`motion?`、`timeGapMinutes?` | `prefs` | 否 |
| `exchange` / `exchange-text` | 两个 Bot / `id` | Bot 间的消息 | 是 |
| `file-text` | `file` | 长消息的全文 | 是 |
| `earlier` | `sessionId`、`cursor?` | 更早的聊天页 | 是 |
| `chat` | `botId`、`cursor?` | 聊天页 | 是 |
| `run-stats` | `botId` | DSH 的回合统计 | 是 |
| `usage` | `timeZone?` | 用量 | 是 |
| `room-progress` | `roomId` | 群的实时发言状态 | 是 |
| `create-bot` | `name`、`role`、`intro?`、`instructions`、`capabilities?`、`brief?`、`avatar?`、`model?`、`effort?`、`workDir?` | 新 Bot | 否 |
| `update-bot` | `id` + 要改的字段 | Bot | 否 |
| `update-profile` | `id`、`role`、`intro`、`instructions`、`capabilities` | Bot | 否 |
| `delete-bot` | `id` | 团队视图 | 否 |
| `set-main` | `id`、`main`、`primary?`、`replace?` | 团队视图 | 否 |
| `create-room` | `members`、`name?`、`admin?`、`greet?` | 群 | 否 |
| `update-room` | `id` + 要改的字段 | 群与改动说明 | 否 |
| `delete-room` | `id` | 团队视图 | 否 |
| `folders` / `folder-pick` / `folder-list` | 路径等 | 文件夹选择 | 是 |
| `add-agent` | 无 | DSH Agent | 否 |
| `agent-session` / `agent-adopt` / `agent-archive` / `agent-rename` | `agentId`、`sessionId?`、`title?` | Session | 否 |
| `remove-agent` | `agentId` | 团队视图 | 否 |
| `set-flags` | `id`、`pinned?`、`hidden?` | 会话 | 否 |
| `approval-answer` | `id`、`choice` | `true` | 是（本机窗口作答） |
| `stop-member-work` | `roomId`、`botId` | `true` | 否 |
| `dismiss-question` | `sessionId` | `true` | 否 |
| `secret-set` | 卡片的 `requestId` 或 `name`，`value`、`scope?`、`purpose?` | 密钥视图（无值） | 否 |
| `secret-create` | `name`、`value`、`scope`、`purpose` | 密钥视图（无值） | 否 |
| `secret-allow` / `secret-cancel` | `requestId` | 密钥视图 / `true` | 否 |
| `secret-update` | `name`、`scope`、`purpose?` | 密钥视图（无值） | 否 |
| `secret-delete` | `name` | `true` | 否 |
| `connector-connect` / `connector-disconnect` / `connector-retry` | `name` 等 | 连接器视图 | 否 |
| `capability-save` / `capability-delete` / `capability-approve` | 能力定义 / `name` | 能力库 | 否 |
| `bot-capability` | `botId`、`name`、`attached` | Bot 的能力 | 否 |
| `schedules` / `schedule-create` / `schedule-delete` | `botId`/`roomId` 等 | 日程 | `schedules` 是，其余否 |
| `memory-view` | `botId`，或 `roomId` | 记忆视图 | 是 |
| `memory-ask` / `memory-forget` | `botId` 或 `roomId` + 内容 | 记忆视图 | 否 |
| `answer-question` | `sessionId`、`questionId`、`answer` | `true` | 否 |
| `send` | `sessionId`、`text` | `true` | 否 |
| `update-check` / `update-install` / `dsh-update-install` / `repo-stars` | `fresh?` | 更新状态 | 是 |
| `browser-wait` / `browser-result` | `clientId` / 结果 | 浏览器桥 | 是 |
| `diagnostics` / `diagnostics-log` / `diagnostics-clear` | 报告选项 | 诊断 | 是 |
| `mark-read` | `id`、`seen?`、`unread?`，或 `entries` | `reads` | 否 |
| `react` | `key`、`index`、`emoji`，或 `entries` | `reactions` | 否 |

`mark-read` 和 `react` 的 `entries` 形式只给客户端第一次启动时上传旧的 `localStorage` 用：服务端合并后写一个 `state.localImported` 标记，同一份旧值不会重复导入。

### 加接口的规矩

1. 业务逻辑放 `src/host/` 的模块，接口只做参数转换和调用。`channel.js` 的 `switch` 不应出现第二份逻辑。
2. 在 `src/host/interface.js` 的 `ENDPOINTS` 里加名字；只读主机能调的，再加进 `READ_ENDPOINTS`。不写进名单的接口不算契约的一部分。
3. 参数在服务端校验：类型、长度、id 是否存在、调用者有没有权限。客户端的校验只是提示。
4. 返回值只放客户端要显示或组合的数据。密钥、cookie、token 的值永远不进返回值。
5. 不确定一个操作该不该让只读主机调时，默认不放：只读主机写不了团队，能读的只是视图。
6. 加接口不改 `interfaceVersion`；删接口、改参数含义、改返回形状才改，并在本文「变更」里写一行。
7. 测试至少覆盖：正常路径、一个参数错误、只读主机被拒绝（如果它是写接口）。

## 第 0 步：DSH 能力清单

装了 `dev/harness` 的 `@deepseek-ai/dsh@0.2.1-rc.2`，逐个读类型声明。只列插件现在用到的服务。

| 服务 | 公开的读 | 公开的写 | 结论 |
|---|---|---|---|
| `llm` | `listProviders()`、`listModels(provider)`、`resolveModelInfo(provider, model)` | 无 | 模型目录只读；第二期只展示，不改 DSH 的模型 |
| `settings` | `describe(options?)` | `update(ns, patch, rev?)`、`replace(ns, section, rev?)`、`mutate(ns, ops, rev?)` | 有公开写；第二期要改设置时走它 |
| `credentials` | `resolve(ref)`、`describe(ref)`、`readRecord(key)`、`describeRecord(key)`、`listRecords()` | `set(ref, value)`、`unset(ref)`、`modifyRecord(key, mutate)`、`deleteRecord(key)` | 有公开写；本期密钥的值存这里 |
| `deepseekAccount` | `getState()`、`getProfile(client)`、`getBalance(client)`、`getUnnotifiedBonuses(client)`、`getPlatformSession()`、`getDeviceIdentity()` | `startSignIn`、`cancelSignIn`、`signOut`、`ackBonusNotified`、`rejectToken` | 能读余额；第二期用 `getBalance` |
| `pluginManager` | `listPlugins()`、`listBundles()`、`registries()`、`inspect(spec)`、`listVersionExemptions()` | `setPluginEnabled(id, enabled)`、`setBundleEnabled(name, enabled)`、`installBundle(spec)`、`removeBundle(name)`、`cancelInstall(id)`、`setVersionExemption(…)` | 有公开写；第二期控制面板可以启停和安装 |
| `agentDefaultModel` | `currentSelection()` | `saveSelection(next)` | 有公开写；第二期「设 DSH 默认模型」走它 |
| `permissionPresets` | `catalog()`、`current(session)`、`resolve(name)`、`optionOf(name)` | `set(session, name)` | 只能按会话设；预设定义本身只读 |
| `agentPresets` | `list()`、`resolve(id?)`、`readDocument(id)`、`compositionInventory()` | `register`、`select(agent, id)`、`recompose(ctx, id)` | 预设定义只读；选择是按 Agent 的 |
| `profileContext` | 只读字段：`name`、`dir`、`patchPath`、`home` 等 | 无 | 只读展示 |
| `launchEnvironment` | `get(name)`、`getFrom(name, sources)` | 无 | 只读；密钥不从这里进 shell |
| `sessionProjections` | `snapshot(session, keys)` | 无 | 只读；`run-stats` 用 |
| `connection` | — | `fetch.register(route)` | 本插件唯一的对外入口 |

结论：第二期控制面板要的操作里，余额（`deepseekAccount`）、默认模型（`agentDefaultModel`）、插件启停/安装（`pluginManager`）都有公开方法；权限预设和 Agent 预设的定义没有公开写方法，只能只读展示，并按现有方式按会话选。没有需要打补丁、改 DSH 文件的地方。

## 本期已定的行为

### 版本和功能开关

- 插件版本从 `package.json` 读，`hello` 返回；不手写第二份。
- `endpoints` 来自 `interface.js`，顺序固定，方便客户端缓存。
- 功能开关：`memory`（`config.memory !== false`）、`browser`（这台主机有没有浏览器桥）、`schedules`（DSH 有没有 `schedule` 服务）、`readOnly`、`dsh` 各项有没有注册。

### 默认值

- `state` 返回 `defaults: { name, model }`：
  - `name` 是服务端算出的第一个可用名字：`New Bot`、`New Bot 2`……（按不区分大小写比较）。
  - `model` 是 DSH 默认模型（被提供时），否则模型目录第一项；没有模型时是 `null`。
- 建 Bot 表单直接用这两个值。`bot-draft.js` 不再算名字和默认模型，只保留把表单组成请求体的部分。

### 已读和表情

- `state.json` 新增两个字段：
  - `reads: { [会话 id]: { seen: 时间戳, unread?: true } }`。`seen` 是用户最后一次离开这个会话的时间，`unread` 是手动标的未读。
  - `reactions: { [消息键]: { [气泡序号]: [emoji…] } }`。消息键的格式和现在的 `localStorage` 一致（`<sessionId>:<msgKey>`），所以旧值可以原样导入。
- `mark-read`：`{ id, seen?, unread? }` 设一个会话；`seen` 只前进不后退；不带 `unread` 时清掉手动未读。
- `react`：`{ key, index, emoji }` 切换一个表情。
- 客户端启动时如果 `localStorage` 还有 `ds-bot:unread`、`ds-bot:reactions`、`ds-bot:seen`，用 `entries` 形式上传一次；服务端合并（`seen` 取较大值、`unread` 取或、表情取并集），写 `state.localImported = true` 后客户端才删本地键。导入失败不删，下次再试。

### 简介卡

- Bot 记录新增 `intro`（最多 300 字）和已有的 `capabilities`。
- 简介写成一个短段落：这个 Bot 是谁、擅长什么、什么时候找它；不是任务清单，也不是系统提示词。
- `update-profile` 一次提交 `role`、`intro`、`instructions`、`capabilities` 四样，服务端一起校验，任何一样不合格就一样都不改。
- `create-bot`、`create_bot` 可以带 `intro` 和 `capabilities`；复制 Bot 时一起复制。
- `list_bots`、群的成员名单、身份提示词都用 `intro`（没有时退回 `instructions` 的第一行）。团队规则加一条：按介绍分派，以团队协作为主。

### 群项目记忆

- 记忆作用域第三种：`{ kind: 'room', roomId }`，文件在 `bot/memory/rooms/<roomId>/`。
- 群会话加载：自己的 `MEMORY.md` + 本群项目的 `MEMORY.md`，**不带团队记忆**。私聊不变（自己的 + 团队），看不到任何项目记忆。
- 群里默认写项目：`remember` 不带 scope 时写本群项目；记忆整理只写本群项目。私聊和别的群不能读写这个项目，Main Bot 也一样，除非它就在这个群里说话。
- `memory-view`、`memory-ask`、`memory-forget` 传 `roomId` 时作用域由服务端判定，客户端不传 kind。
- 删群时把 `bot/memory/rooms/<roomId>/` 整个移到 `bot/memory/archive/rooms/<roomId>/`。

### 聊天时间戳

- 规则：两条相邻消息隔了不到 2 分钟，不显示时间；隔了 2 分钟或以上，在后一条前面显示一条时间分隔线。
- 2 分钟是默认值，存在 `state.prefs.timeGapMinutes`（1 到 60），设置 → 通用里可调，所有客户端都按它来。
- 私聊：沿用回合之间的分隔线，把写死的 30 分钟换成这个设置。
- 群聊：一轮里成员的发言之间也按同一个间隔判断。每条群消息的时间由服务端在写群日志时记下（`room.log[].time`），一轮的回复（`round.replies[].time`）用的是同一份时间，所以两个窗口的分隔线位置一致，成员跑了个长任务也显示成它实际的那段停顿。
- 文案沿用现有的「今天 / 昨天 / 星期几 + 时间」。用户消息悬停显示时间，保持不变。

### 密钥

- 新接口 `secret-create`：`{ name, value, scope, purpose }`。用户在设置 → 密钥里自己新建，不必等 Bot 发起。值只进不出，任何接口都不返回值。
- 带值的接口（`secret-create`、`secret-set`、`secret-update`）只接受本机回环或 https 的请求；远程走明文 http 时拒绝，并说明原因。协议和 Host 由 `channel.js` 传进 `handle`。
- 存放：DSH 的 `credentials` 有公开写方法（`set` / `unset`），所以值存进 DSH 自己的凭据库，引用名就是 `DSH_SECRET_<NAME>`；`bot/secrets.json`（权限 600）只留元数据：名字、用途、范围、谁请求的、时间。`credentials` 不存在时退回旧行为，值留在 `secrets.json`，并在本文「已知限制」里写明它不加密。
- Bot 的规则不变：Bot 永远看不到值，用 `$DSH_SECRET_<名字>`，发出前一律替换。

## 不做什么

- 不在客户端做业务校验、权限判断或默认值计算。
- 不为每个客户端做一套接口；手机端、网页、扩展都调 `/api/bot`。
- 不把密钥、cookie、token 的值放进 `state`、日志、记忆或模型请求。
- 不改 DSH 的文件，不依赖 DSH 安装目录；`credentials` 不存在时退回自己的文件。
- 不做明文 http 的远程密钥写入；远程要么 https，要么先在本机设置。

## 已知限制

- 只读主机能读的东西和写主机一样多：它能看到团队、记忆、用量，只是写不了。这是 `state.lock` 的设计，不是权限系统。
- `bot/secrets.json` 退回模式不加密；只有 `credentials` 不存在时才会走到。
- 群消息的时间只从这一版起写入；旧的群日志没有 `time`，重看旧消息时不会有新的分隔线。
- 简介 300 字是硬上限，超出直接拒绝，不截断；客户端计数提示。

## 变更

- 2026-10-19：建立。第一期接口、简介卡、群项目记忆、时间戳、密钥新建。
