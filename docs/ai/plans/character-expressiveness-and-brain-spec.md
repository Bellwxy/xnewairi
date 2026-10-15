# 角色表现力与角色大脑 二开评估与 SPEC

日期：2026-10-14。源码基线：`74e67fb` 加当前未提交的精简改动。状态：提案，尚未实施。版本：v2。

本文评估 [二开规划指南](../../secondary-development-ideas.md) 的两个方向，并给出实施 SPEC。
记忆方案的外部调研见 [长期记忆方案调研](../research/llm-memory-approaches.md)。

## 版本变更

v2 相对 v1 的变化：

- 目标宿主改为桌面端 `apps/stage-tamagotchi` 与安卓 APK `apps/stage-pocket`。透明展示盒摆件不再考虑。
- 首发渲染器确定为 Live2D。VRM 专属事项全部降级为"不做"。
- 记忆方案按调研结论改为 L0 至 L3 分层。嵌入模型与提炼模型都由用户在多供应商设置中自选。

## 一 结论摘要

| 编号 | 事项 | 结论 | 优先级 | 估算 |
| --- | --- | --- | --- | --- |
| 1.1L | Live2D 情绪到动作与表情的映射 | 做。现有情绪动作对多数模型无效，这是修复 | P0 | 3 至 5 个工作日 |
| 2.0 | 工作记忆窗口 | 做。当前历史无限增长 | P0 | 2 至 3 个工作日 |
| 2.2 | 情绪惯性与好感度 | 做 | P0 | 4 至 6 个工作日 |
| 2.1 | 分层长期记忆 L1 与 L2 | 做。价值最高 | P1 | 12 至 16 个工作日 |
| 2.3 | 主动关怀，桌面端与安卓分别实现 | 做 | P1 | 6 至 9 个工作日 |
| 2.1+ | 本地嵌入模型、L3 反思摘要 | 第二阶段 | P2 | 5 至 8 个工作日 |
| 1.4L | 背景按时段切换 | 做，成本低 | P2 | 2 至 3 个工作日 |
| 1.3L | Live2D 装扮预设 | 可选 | P3 | 3 至 4 个工作日 |
| 1.1V | VRMA 全身动作库 | 不做。VRM 专属 | — | — |
| 1.2 | MediaPipe 动捕与手势 | 不做。现有驱动只支持 VRM，移动端负载高 | — | — |
| 1.4 | 3D 居室场景 | 不做。VRM 与 Three.js 专属 | — | — |

估算只计算编码与单元测试，不含美术资产与真机调试。

## 二 平台约束

| 约束 | 桌面端 Electron | 安卓 APK Capacitor |
| --- | --- | --- |
| 后台运行 | 托盘常驻，渲染进程中的定时器可以持续运行 | 应用进入后台后，WebView 中的 JS 定时器不可靠。此条是安卓平台通用行为，未在本仓库实测 |
| 系统通知 | 需要接入 Electron 通知 | `@capacitor/local-notifications` 已安装，目前只用于权限面板与开发者页 |
| 本地嵌入 | Ollama 可用，transformers.js 可用 | 只能用 transformers.js。WebView 的 WebGPU 支持未核实 |
| 云端嵌入接口 | 请求从渲染进程发出 | Pocket 没有配置 `CapacitorHttp`，请求受 WebView CORS 约束。各供应商是否允许跨域未核实 |
| 多窗口 | 多个渲染窗口共享同步状态。后台任务只能由 leader 执行 | 单窗口 |

## 三 现状核实

以下是与本文相关的源码事实。v1 已修正的条目继续有效。

| 主题 | 源码事实 | 依据 |
| --- | --- | --- |
| 对话历史 | 每次请求发送整个会话历史，没有截断 | `core-agent/src/runtime/chat-orchestrator-runtime.ts:578`、`:872` |
| 400 条上限 | 只限制上下文注入事件的观测历史，不限制对话轮数 | `core-agent/src/runtime/context-registry.ts:98` |
| 情绪标记 | 格式是 `<\|ACT {"emotion":...,"motion":...}\|>` | `packages/i18n/src/locales/en/base.yaml:27` |
| Live2D 情绪动作 | 情绪写死映射到 `Happy`、`Sad` 等动作组名。多数模型没有这些组，调用失败后只打印日志 | `constants/emotions.ts:15-34`、`stage-ui-live2d/.../Model.vue:602-616` |
| Live2D 模型动作 | 模型加载时把实际动作组写入 `availableMotions` | `stage-ui-live2d/.../Model.vue:389` |
| Live2D 表情 | `expression-store` 支持 `set(name, value, duration)`，到时自动复位。目前只作为 LLM 工具暴露，没有接到 ACT 情绪 | `stage-ui-live2d/src/stores/expression-store.ts:259`、`tools/expression-tools.ts` |
| 提示词动作列表 | 输出 "The available actions:" 标题，但后面没有动作列表 | `composables/use-airi-runtime-prompt.ts:20-26` |
| 记忆设置页 | `memory-long-term.vue` 与 `memory-short-term.vue` 只有 `WIP` 占位 | `stage-pages/src/pages/settings/modules/` |
| 嵌入依赖 | `@xsai/embed` 与 `@xsai-transformers/embed` 已是依赖，均未被调用 | `packages/stage-ui/package.json:124-126` |
| 嵌入模型列表 | OpenAI 兼容校验器列模型时跳过 ID 含 `embed` 的模型 | `provider-inference/src/validators/openai-compatible.ts:65-70` |
| 本地推理框架 | 已有 Worker 管理、加载队列、GPU 资源协调与模型缓存。Kokoro TTS 与 VAD 使用它 | `packages/stage-ui/src/libs/inference/` |
| 主动发言 | 调度器把到期任务转为通知，反应经 TTS 播报。笔记本只在内存中，反应不写入会话 | `stores/character/orchestrator/store.ts:183`、`stores/character/notebook.ts`、`stores/character/index.ts:113` |
| TTS 参数 | 音高只经 SSML 生效，仅 4 类供应商支持。`rate` 设置未传入合成调用 | `stores/modules/speech.ts:472-500` |

### 可复用的接入点

- `runtimeContextProviders`：每次发送前同步调用。返回的上下文附加到最后一条用户消息。见 `chat.ts:647`。
- `prepareSend`：每轮异步执行，已知会话 ID 与角色 ID。见 `chat.ts:819`。
- 对话钩子，例如 `onChatTurnComplete`。见 `chat.ts:1139-1148`。
- 存储层：`unstorage` 加 IndexedDB，按 repo 组织。见 `packages/stage-ui/src/database/`。
- ACT 信号：`useLlmStreamingControlStore().onSignal`。见 `Stage.vue:320`。

## 四 方向二 SPEC

所有新状态按角色卡 ID 分区。桌面端多窗口时，只有 leader 执行提炼与调度。
App 层已有 `syncedPinia.isLeader()` 判断模式，可直接沿用。
新的提示词文本放入 `packages/i18n`，只改英文源与简体中文。

### 2.0 工作记忆窗口

**目标**：发送给模型的历史有上限。移出窗口的内容由 2.1 承接。

**范围**：

- `createChatOrchestratorRuntime` 增加可选依赖 `historyTurnLimit?: number`。未传入时保持现有行为。
- Stage 侧传入配置值，默认 30 轮，在短期记忆设置页 `memory-short-term.vue` 中可调。
- 截断不能拆开工具调用与工具结果。实现前必须核实 `core-agent/src/messages/turns.ts` 的轮次划分规则。

**验收**：

- 100 轮会话的请求体只含最近 30 轮与系统提示。
- 截断边界不拆开工具调用对。
- 未设置上限的调用方行为不变，现有测试通过。

### 2.1 分层长期记忆

**方案来源**：调研结论是没有现成记忆库能在 Electron 渲染进程与 Android WebView 中运行。
mem0 的 TS SDK 依赖 `better-sqlite3`。Letta、Zep、Memobase 与 MemOS 需要服务端。
因此在 TS 中自行实现，并借鉴以下三种设计：

- Letta 的常驻核心记忆块。
- mem0 的单次 LLM 提炼、只追加与去重。
- Generative Agents 的"相关度、新近度、重要度"打分。

**分层**：

| 层 | 内容 | 写入 | 读取 | 需要嵌入 |
| --- | --- | --- | --- | --- |
| L0 工作窗口 | 最近 N 轮原文 | 现有会话 | 全量发送 | 否 |
| L1 核心记忆 | 用户画像块与关系块，每块有字符上限 | 提炼模型整块改写，用户可编辑与锁定 | 每轮常驻注入 | 否 |
| L2 情节记忆 | 一句一条，含时间、重要度与关键词 | 提炼模型只追加，带去重 | 混合检索取前 K 条 | 可选 |
| L3 反思摘要 | 周期归纳 | 第二阶段 | 视为 L2 条目 | 可选 |

L1 覆盖陪伴场景中最常用的内容：名字、生日、喜好与关系。它不依赖嵌入，所以在所有平台与配置下都可用。

**数据模型**：

```ts
type CoreMemoryBlockKey = 'user-profile' | 'relationship'

interface CoreMemoryBlock {
  characterId: string
  key: CoreMemoryBlockKey
  text: string
  /** Character limit, not token limit. Default 1500. */
  limitChars: number
  /** When true, extraction must not rewrite this block. */
  lockedByUser: boolean
  updatedAt: number
}

interface EpisodeMemory {
  id: string
  characterId: string
  /** One self-contained sentence, with absolute dates. */
  text: string
  /** 0 to 1. The extractor assigns it. */
  importance: number
  keywords: string[]
  occurredAt: number
  createdAt: number
  lastRecalledAt?: number
  /** Set when a newer memory replaces this one. The record is kept. */
  invalidatedAt?: number
  supersededBy?: string
  embedding?: number[]
  embeddingModel?: string
  sourceSessionId?: string
}

interface MemoryExtractionCursor {
  sessionId: string
  lastExtractedMessageId: string
  updatedAt: number
}
```

失效的情节不参与召回，但仍在记忆页中显示。只有用户删除时才物理删除。这一做法借鉴 Graphiti 的失效模型。

**模型设置**：

- 新增"记忆"模块设置，复用现有多供应商选择方式，与 `consciousness` 模块相同。
- 提炼模型：用户自选供应商与模型。未设置时使用当前对话模型。
- 嵌入模型：用户自选 `embed` 类别的供应商与模型。可以不设置。
- 嵌入模型列表需要单独的获取路径。现有 OpenAI 兼容校验器会跳过嵌入模型。
- Ollama 供应商当前只声明 `chat` 任务，需要增加嵌入任务声明。
- 中文推荐：硅基流动 `BAAI/bge-m3`、阿里云 `text-embedding-v4`，桌面端可选 Ollama `bge-m3`。不推荐 `nomic-embed-text`，它是英文模型。

**提炼流程**：

1. `onChatTurnComplete` 后检查触发条件：距上次输入超过 10 分钟，或未提炼轮数达到 20。
2. 取游标之后的消息，调用一次提炼模型。传入当前日期，要求把"昨天""下周"转为绝对日期。
3. 输出用 Valibot 校验。一次调用同时产出 L1 改写、L2 新条目与好感度增量。
4. 新条目与最近 20 条情节比较。重复的丢弃，替代旧事实的标记旧条目失效。
5. 写入记录。配置了嵌入模型时计算嵌入。推进游标。
6. 失败时保留游标，下次触发重试。

```ts
interface MemoryExtractionResult {
  /** Omit a block to keep it unchanged. Locked blocks are ignored. */
  coreBlocks: Partial<Record<CoreMemoryBlockKey, string>>
  episodes: Array<{ text: string, importance: number, keywords: string[], occurredAt: string }>
  /** IDs of existing episodes that the new episodes replace. */
  invalidates: string[]
  /** -10 to 10. The affection store applies it. */
  affectionDelta: number
}
```

**召回流程**：

1. L1 核心记忆每轮常驻注入。
2. 在 `prepareSend` 中对用户输入检索 L2：
   - 有嵌入时：相关度 = 0.7 × 向量余弦 + 0.3 × 关键词分数。
   - 无嵌入时：相关度 = 关键词分数。
3. 总分 = 0.6 × 相关度 + 0.2 × 新近度 + 0.2 × 重要度。取前 5 条。
4. 关键词检索没有命中时，注入最近 3 条情节。
5. L1 与 L2 合计渲染上限 2000 字。

调研在 Apple M5 上实测：5000 条 1024 维向量的暴力余弦约 4 ms。所以不引入向量索引，记忆按角色加载到内存。
安卓设备上的耗时未实测。

**中文分词**：关键词检索使用 `Intl.Segmenter`。不可用时退化为单字加二元组。
WebView 中 `Intl.Segmenter` 的中文效果未核实，需要真机测试。

**注入方式**：作为请求级上下文注入，不写入全局 `context registry`。
注册表是全局共享的。排队中的不同会话会互相覆盖 `ReplaceSelf` 条目。
`chat.ts:623` 的 `snapshot` 当前不接收会话 ID。实现时需给它增加 `sessionId` 参数，这是 `core-agent` 的接口改动。

**切换嵌入模型**：旧向量与新模型不可比较。切换后后台重算全部向量。重算完成前，检索使用关键词路径。

**管理界面**：长期记忆设置页 `memory-long-term.vue` 提供以下功能：

- 查看与编辑 L1 核心记忆，锁定某一块。
- 查看 L2 情节，单条删除，显示失效状态。
- 全部清空与导出。
- 显示当前检索模式："向量加关键词"或"仅关键词"。

**新增文件**：

| 文件 | 内容 |
| --- | --- |
| `packages/stage-ui/src/database/repos/memories.repo.ts` | 核心记忆、情节与游标的读写 |
| `packages/stage-ui/src/stores/memory/memory-store.ts` | 提炼触发、召回与嵌入调用 |
| `packages/stage-ui/src/stores/memory/memory-settings.ts` | 提炼模型、嵌入模型与窗口设置 |
| `packages/stage-ui/src/stores/memory/scoring.ts` | 余弦、关键词分数与综合打分，纯函数 |
| `packages/stage-ui/src/stores/memory/tokenize.ts` | 中文分词封装，纯函数 |
| `packages/stage-ui/src/stores/memory/extraction-schema.ts` | Valibot 结构 |
| `packages/stage-ui/src/stores/chat/context-providers/memory.ts` | 记忆上下文渲染 |

**验收**：

- 在会话 A 说出生日。新建会话 B 后询问，角色能答对。不配置嵌入模型时也能答对。
- 用户编辑 L1 后，角色立即使用新内容。锁定后提炼不再改写。
- 说"我搬到上海了"后，旧住址情节显示为失效，并且不再被召回。
- 删除一条情节后，角色不再提到它。
- 提炼失败不影响当前对话，下次触发时重试。
- 打分与分词函数有单元测试。

**第二阶段（2.1+）**：

- 本地嵌入：通过现有本地推理框架运行 `@xsai-transformers/embed`。候选模型 `bge-small-zh-v1.5`，int8 约 24 MB。默认关闭，由用户下载。
- L3 反思：重要度累计超过阈值时生成归纳条目。

### 2.2 情绪惯性与好感度

**目标**：角色情绪不再逐句跳变，关系随互动缓慢变化。两者体现在提示词与 Live2D 表现中。

**数据模型**：

```ts
type AffectionStage = 'acquaintance' | 'friend' | 'affectionate' | 'bonded'

interface CharacterMoodState {
  characterId: string
  /** -1 to 1. */
  valence: number
  /** 0 to 1. */
  arousal: number
  updatedAt: number
}

interface CharacterAffectionState {
  characterId: string
  /** 0 to 1000. Stage thresholds: 0, 200, 500, 800. */
  points: number
  lastInteractionAt: number
  lastDailyGreetingAt?: number
}
```

**情绪规则**：

- 9 种 `Emotion` 各有一个目标坐标。例如 `happy` 为 (0.7, 0.6)，`sad` 为 (-0.6, 0.3)。
- 收到 ACT 情绪时：`v ← v + 0.3 × 强度 × (目标 − v)`。0.3 是惯性系数，可配置。
- 衰减在读取时计算，不使用定时器：`v(t) = 基线 + (v₀ − 基线) × 0.5^(Δt / 半衰期)`。默认半衰期 20 分钟。
- 情绪来源是 ACT 信号。状态逻辑放在 store 中，不放在 `Stage.vue` 组件里。

**好感度规则**：

- 每完成一轮对话加 1，每天上限 20。
- 当天第一次问候加 5。
- 2.1 提炼结果提供 −10 至 10 的增量。
- 超过 3 天无互动，每天减 5，最低不低于当前阶段下限的一半。

**提示词注入**：通过 `runtimeContextProviders` 注入文字描述，不输出原始数值。
例如："Current mood: slightly happy, calm. Relationship: friend. Speak casually and recall shared topics."

**Live2D 联动**：情绪坐标映射到 1.1L 配置的待机表情。例如持续低落时保持轻度 `sad` 表情。

**TTS 联动**：只在供应商支持 SSML 时调整音高。`rate` 未传入合成调用是现有缺陷，先单独修复。

**新增文件**：`stores/character/mood.ts`、`stores/character/mood-math.ts`、`stores/chat/context-providers/character-state.ts`。

**验收**：

- 连续两条 `happy` 后收到一条 `sad`，情绪仍偏正向。
- 静置 1 小时后情绪接近基线。
- 好感度跨重启保留。阶段变化后提示词文字随之变化。
- 数学函数有单元测试，测试中注入时钟。

### 2.3 主动关怀

**目标**：角色按作息主动发言，例如早晨问候、深夜劝睡和纪念日祝福。

**现有缺口**：

1. 笔记本任务只在内存中，重启后丢失。
2. 只支持一次性 `dueAt`，没有每日或每年重复规则。
3. 主动发言不写入会话历史，角色事后不记得自己说过的话。
4. 没有免打扰时段与每日次数上限。
5. 安卓后台时 JS 调度不可靠。

**数据模型**：

```ts
type RoutineSchedule
  = | { type: 'daily', time: string }
    | { type: 'yearly', month: number, day: number, time: string }

interface CharacterRoutine {
  id: string
  characterId: string
  kind: 'morning-greeting' | 'night-reminder' | 'anniversary' | 'custom'
  schedule: RoutineSchedule
  /** Fires only if the user spoke within this window. Omit to always fire. */
  requireActivityWithinMs?: number
  enabled: boolean
  lastFiredAt?: number
}

interface ProactivePolicy {
  quietHours: { start: string, end: string }
  maxPerDay: number
}
```

**共同行为**：

- 触发时生成 `spark:notify`，`destinations` 为 `['character']`，并要求文本反应。
- 反应文本作为助手消息追加到当前会话，带 `metadata.source = 'proactive'`。
- 纪念日从 L1 核心记忆中的日期读取。
- 没有配置对话模型时静默跳过，与 `processSparkNotify` 的现有行为一致。

**桌面端**：复用调度器现有 tick，每分钟检查一次作息。应用在托盘中运行时可以准时触发。

**安卓端**：

- 保存作息时，同时用 `@capacitor/local-notifications` 注册系统通知。通知文本使用固定模板，不调用模型。
- 用户点击通知打开应用后，触发对应的 `spark:notify`，角色生成完整发言。
- 应用回到前台时，补发过去 2 小时内错过的作息，最多 1 条。
- 这种形态不需要后台服务，也不需要新增原生代码。

**验收**：

- 桌面端把系统时间设为 08:00，角色播报问候并写入会话。
- 安卓端在后台收到 08:00 通知。点击后角色发言。
- 免打扰时段内不触发。达到每日上限后不再触发。
- 重启后任务与作息仍在。
- 作息计算有单元测试，测试中注入时钟。

## 五 方向一 SPEC（Live2D）

### 1.1L 情绪到动作与表情的映射

**问题**：情绪映射写死为固定组名。大多数 Live2D 模型的动作组名不同，所以情绪动作通常不生效。
模型表情已有完整支持，但没有接到 ACT 情绪上。

**目标**：每个 Live2D 模型有自己的情绪映射。情绪可以同时触发动作与表情。

**数据模型**：

```ts
interface Live2DEmotionBinding {
  motion?: { group: string, index?: number }
  expression?: { name: string, value: number }
}

interface Live2DEmotionMapping {
  modelId: string
  bindings: Partial<Record<Emotion, Live2DEmotionBinding>>
  /** Seconds before the expression resets. Default 4. */
  expressionHoldSeconds: number
}
```

**行为**：

- 模型加载后自动生成建议映射：按名称把情绪与 `availableMotions` 的组名以及表情名做匹配。
  例如 `happy` 匹配 `happy`、`smile`、`joy`。匹配不分大小写，同义词表放在常量文件中。
- 用户在 Live2D 模型设置中逐项调整，可以预览，结果按模型持久化。
- `Stage.vue` 的 Live2D 分支改用映射：
  - 有动作时调用现有 `currentMotion`。
  - 有表情时调用 `expressionStore.set(name, value, holdSeconds)`。
- ACT 的 `motion` 字段只接受模型实际存在的动作组。不存在时忽略并记录调试日志。
- `useAiriRuntimePrompt` 在 "The available actions:" 之后列出当前模型的动作组名。没有动作组时不输出这一节。

**改动文件**：

- `packages/stage-ui/src/components/scenes/Stage.vue`
- `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`
- `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts`
- 新增 `packages/stage-ui-live2d/src/stores/emotion-mapping.ts` 与匹配纯函数

**验收**：

- 加载一个动作组不叫 `Happy` 的模型。自动建议映射后，`happy` 情绪能播放动作。
- 情绪表情在设定时间后复位，不与口型冲突。
- 提示词列出的动作名与模型实际动作组一致。
- 匹配函数有单元测试。

### 1.4L 背景按时段切换

**目标**：背景随时段变化，配合 2.3 增强"陪伴感"。

**范围**：用户为早晨、白天、傍晚与夜晚分别指定背景，背景从现有背景库中选择。
每 5 分钟检查一次时段。切换使用现有背景 store。天气联动不在本次范围内。

**验收**：手动修改系统时间后，背景在 5 分钟内切换。未配置的时段保持当前背景。

### 1.3L 装扮预设（可选）

Live2D 的装扮通常是表情文件或参数开关，不是独立网格。
预设是一组已命名的表情取值，复用 `expression-store`，并可绑定到角色卡。

## 六 实施路径

```text
阶段 A 快速见效（约 1.5 周）
├── 1.1L Live2D 情绪映射，修复现有失效功能
└── 2.0 工作记忆窗口

阶段 B 情绪底座（约 1 周）
└── 2.2 情绪惯性、好感度、提示词注入与 Live2D 待机表情

阶段 C 长期记忆（约 3 周）
├── 2.1 记忆模块设置：提炼模型与嵌入模型
├── 2.1 L1 核心记忆、L2 情节、提炼与召回
└── 2.1 长期记忆管理页

阶段 D 主动关怀（约 1.5 周）
├── 2.3 持久化、作息、免打扰与写入会话
└── 2.3 安卓本地通知

阶段 E 增强（按需）
├── 2.1+ 本地嵌入与 L3 反思
├── 1.4L 背景按时段切换
└── 1.3L 装扮预设
```

顺序理由：

- A 改动小、见效快，并且不依赖其他事项。
- 2.2 的好感度增量来自 2.1 的提炼。B 先用规则加分，C 完成后接入提炼增量。
- 2.3 的纪念日依赖 2.1 的核心记忆。

每个阶段结束时，运行涉及工作区的 typecheck 与测试，并运行 `pnpm lint`。
改动 `core-agent` 导出类型时，还需运行根目录 `pnpm typecheck`。
每个阶段都要在桌面端与安卓真机上各验证一次。

## 七 待决策事项

1. 关键词检索的实现方式。按仓库规则，新增依赖前必须由你选择。

   | 选项 | 许可证 | 中文分词 | 向量检索 | 说明 |
   | --- | --- | --- | --- | --- |
   | 自己实现（推荐） | 不适用 | 封装 `Intl.Segmenter` | 自写暴力余弦 | 无新依赖。需要自写约百行的 BM25 |
   | MiniSearch | MIT | 需自定义 `tokenize` | 无 | 体积小，只负责关键词 |
   | Orama 加 `@orama/tokenizers` | Apache-2.0 | 内置中文 | 内置，逐条余弦 | 一个库覆盖混合检索，持久化需另行处理 |

2. 安卓主动关怀是否接受"系统通知加点开后角色发言"的形态？另一种做法是原生后台服务，需要写 Kotlin 代码。
3. 本地嵌入模型是否进入第一版？建议放到第二阶段，先用云端或 Ollama 嵌入。

## 八 未验证内容

- 没有运行任何测试、类型检查或性能测量。估算工期没有经过实际开发验证。
- `core-agent/src/messages/turns.ts` 的轮次划分规则未逐行核实，2.0 实现前必须先核实。
- 安卓 WebView 的 WebGPU、`Intl.Segmenter` 中文效果、暴力检索耗时与云端嵌入接口 CORS 均未实测。
- 安卓后台 JS 定时器行为未在本仓库实测。
- 详细的外部依据与其他未核实项见 [长期记忆方案调研](../research/llm-memory-approaches.md) 第 7 节。
