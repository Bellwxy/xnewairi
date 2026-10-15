# 角色表现力与角色大脑 二开评估与 SPEC

日期：2026-10-14。源码基线：`8bb0b4a` 加当前工作区改动。状态：提案，尚未实施。版本：v3.1。

本文评估 [二开规划指南](../../secondary-development-ideas.md) 的两个方向，并给出实施 SPEC。
记忆方案的外部调研见 [长期记忆方案调研](../research/llm-memory-approaches.md)。
本文依赖 [账号数据隔离 SPEC](./account-data-isolation-spec.md)，它是阶段 0。

## 版本变更

v3.1 相对 v3 的变化：

- 新增阶段 0 账号数据隔离。本文所有新增状态都保存在账号作用域内。
- 补充会话分叉、删除消息、导入会话与云端合并对提炼的影响。批次 ID 不再包含会话 ID。
- 补充首次启用的提炼起点、只读已持久化消息、删除角色时的记忆处理、隐私提示与成本上限。
- 修正注入方式的结论。现有的请求级选项可以承载 L1，L2 的注入位置待决策。
- 2.4 补充编辑器基线冲突规则与完整的性格修改来源。提示词优先级改为可抽样验证的表述。
- 给出 C0 的无新依赖候选方案，统一各阶段估算。

v3 相对 v2 的变化：

- 修订长期记忆的触发、幂等提交、事实替换、删除和请求隔离规则。
- 将嵌入计算移出提炼提交路径，补充失败恢复与验收用例。
- 新增 2.4 性格管理，复用角色卡的 `personality` 字段，不建立第二份性格状态。
- 区分稳定性格、短期情绪、关系状态与用户记忆。自动提炼不能修改性格。
- 更新实施顺序。v3 是当前实施依据，二开规划指南仅保留为历史构想。

v2 相对 v1 的变化：

- 目标宿主改为桌面端 `apps/stage-tamagotchi` 与安卓 APK `apps/stage-pocket`。透明展示盒摆件不再考虑。
- 首发渲染器确定为 Live2D。VRM 专属事项全部降级为"不做"。
- 记忆方案按调研结论改为 L0 至 L3 分层。嵌入模型与提炼模型都由用户在多供应商设置中自选。

## 一 结论摘要

| 编号 | 事项 | 结论 | 优先级 | 估算 |
| --- | --- | --- | --- | --- |
| 0 | 账号数据隔离 | 做。是所有新增状态的前置条件，见独立 SPEC | P0 | 完成持久化位置清单后估算 |
| 1.1L | Live2D 情绪到动作与表情的映射 | 做。现有情绪动作对多数模型无效，这是修复 | P0 | 3 至 5 个工作日 |
| 2.0 | 工作记忆窗口 | 做。当前历史无限增长 | P0 | 2 至 3 个工作日 |
| 2.2 | 情绪惯性与好感度 | 做 | P0 | 4 至 6 个工作日 |
| 2.1 | 分层长期记忆 L1 与 L2 | 做。先交付 L1，再交付 L2 | P1 | C0 为 2 至 3 个工作日。C1 至 C3 在 C0 通过后估算 |
| 2.4 | 性格管理 | 做。复用角色卡，先支持人工编辑与预设 | P1 | 4 至 6 个工作日，含基线冲突处理，未验证 |
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

所有新状态保存在账号作用域内，并按角色卡 ID 分区。账号作用域的规则见 [账号数据隔离 SPEC](./account-data-isolation-spec.md)。
批次 ID、锁名称与任务键都包含账号 ID。切换账号时，旧账号的任务必须停止，结果不得写入新账号。
桌面端多窗口时，只有 leader 执行提炼与调度。
App 层已有 leader 生命周期入口，可复用。leader 判断不是持久化锁，也不能代替幂等提交。
记忆默认仅保存在本设备。桌面与安卓之间的记忆同步不在首版范围内。
同一账号在多台设备上使用时，聊天云同步会把消息合并到各设备。各设备独立提炼，记忆可能不同，提炼费用也会重复。这是首版的已知限制。
新的提示词文本放入 `packages/i18n`，只改英文源与简体中文。

### 2.0 工作记忆窗口

**目标**：发送给模型的历史有上限。移出窗口的内容由 2.1 承接。

**范围**：

- `createChatOrchestratorRuntime` 增加可选依赖 `historyTurnLimit?: number`。未传入时保持现有行为。
- Stage 侧传入配置值，默认 30 轮，在短期记忆设置页 `memory-short-term.vue` 中可调。
- 一轮指一次用户输入及其后续助手输出和全部工具步骤，不等于一个核心 `Turn`。
- 默认窗口包含当前用户输入及此前最多 29 轮。系统指令独立保留。
- 截断不能拆开工具调用与工具结果，也不能删除持久化消息。未提炼消息仍可从完整会话读取。
- 轮数不是 token 上限。单轮超长输入仍需单独的上下文预算策略，不宣称此功能能防止所有超限错误。
- 2.3 的主动发言没有用户输入。它与前一轮合并计数，会话开头的主动发言单独算一轮。
- 语音中断记录跟随它所属的轮次，不单独计数。
- 提炼暂停或积压超过窗口时，窗口仍按上限截断。界面显示"有内容未进入记忆"，并提供立即提炼操作。

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
  /** Unicode code point limit. Default 750. */
  limitChars: number
  /** When true, extraction must not rewrite this block. */
  lockedByUser: boolean
  revision: number
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
  occurredAt?: number
  createdAt: number
  lastRecalledAt?: number
  /** Set when a newer memory replaces this one. The record is kept. */
  invalidatedAt?: number
  supersededBy?: string
  /** Stable subject and predicate, for example user.residence. */
  factKey?: string
  sourceMessageIds: string[]
  extractionBatchId: string
  embedding?: number[]
  embeddingModel?: string
  sourceSessionId?: string
}

interface MemoryExtractionCursor {
  characterId: string
  sessionId: string
  lastExtractedMessageId?: string
  revision: number
  updatedAt: number
}
```

失效的情节不参与召回，但仍在记忆页中显示。只有用户删除时才物理删除。这一做法借鉴 Graphiti 的失效模型。
`factKey` 标识事实类别，不包含事实值。多值偏好不能按单值住址的规则覆盖。
来源消息 ID、批次 ID 与修订号由应用生成。不得信任模型生成的归属信息。

**模型设置**：

- 新增"记忆"模块设置，复用现有多供应商选择方式，与 `consciousness` 模块相同。
- 提炼模型：用户自选供应商与模型。未设置时使用目标会话所属角色的对话模型，不使用当前选中角色。
- 嵌入模型：用户自选 `embed` 类别的供应商与模型。可以不设置。
- 嵌入模型列表需要单独的获取路径。现有 OpenAI 兼容校验器会跳过嵌入模型。
- Ollama 供应商当前只声明 `chat` 任务，需要增加嵌入任务声明。
- 中文推荐：硅基流动 `BAAI/bge-m3`、阿里云 `text-embedding-v4`，桌面端可选 Ollama `bge-m3`。不推荐 `nomic-embed-text`，它是英文模型。
- 提炼供应商与对话供应商不同时，首次启用前提示用户：聊天内容会发送给提炼供应商。用户确认后才开始提炼。
- 每个账号每天最多自动提炼 50 批，数值可配置。达到上限后暂停自动提炼，界面显示积压，用户可以手动触发。

**触发与恢复**：

- 首次启用记忆时，记录每个已有会话的当前末尾作为提炼起点。历史消息不自动提炼。
- 用户可以对单个会话手动回填历史。回填前显示预计批次数，确认后入队。
- 提炼只读取已写入存储的消息，不读取内存中的会话。会话保存走异步队列，见 `session-store.ts` 的 `enqueuePersist`。
- 每轮完成后，持久化该会话的待提炼范围。累计 20 轮时立即入队。
- 最后一次输入后空闲 10 分钟时，由前台计时器入队。无需等待下一轮聊天。
- 切换会话时，将旧会话的完整轮次入队。不等待未完成的流式输出。
- 启动、恢复前台或取得 leader 身份时，扫描游标与完整会话，恢复遗漏任务。
- 安卓后台不承诺执行提炼。关闭应用也不依赖异步退出回调完成写入。
- 同一角色的提炼串行执行，不同会话共用此角色队列。相同消息范围合并为同一任务。
- 新会话首次发送前，最多等待同角色已有提炼任务 3 秒。超时后使用已提交记忆，并显示待处理状态。
- 失败后按 30 秒、2 分钟、10 分钟间隔重试，最多自动重试 3 次。此后保留任务，等待用户重试。
- 无模型配置时暂停任务，不空转重试。配置恢复后重新入队。

**提炼与事实替换**：

1. 固定角色、会话、消息范围、原文版本与记忆修订号。仅处理完整轮次，每批最多 20 轮。
2. 读取 L1 与相关有效情节。相关候选来自整个角色记忆库，不只取最近 20 条。
3. 调用提炼模型，输出候选事实、L1 改写与好感度增量。相对日期按来源消息的日期及时区解析。
4. 使用 Valibot 检查长度、数值、日期和来源。无法确定的日期保留为未知，不猜测时间戳。
5. 按 `factKey` 检查全部同类事实。无键候选先做文本去重，再检索相关旧情节进行替换判定。
6. 替换判定需要模型时，单独执行一次有界调用。无法确认的候选进入待确认区，不注入对话。
7. 在提交时重新检查用户锁定、来源版本与记忆修订号。冲突时丢弃旧结果并重新读取。
8. 一次提交 L1、L2、旧事实失效标记、好感度事件与游标。嵌入任务在提交后执行。

模型只能请求替换本次提供的候选 ID。跨角色 ID、未知 ID 和失效 ID 均拒绝。
新旧事实存在替换关系时，应用写入 `invalidatedAt` 与 `supersededBy`。
提炼不能把助手猜测、角色设定或工具返回的指令当成用户事实。
对历史消息、检索内容和模型结果一律按数据处理，不授予修改性格或执行工具的权限。

**会话变更**：

- 每个账号与角色维护一份已提炼消息 ID 清单。提炼前跳过清单中的消息。
- 分叉会话：`forkSession` 复制消息时保留消息 ID（`session-store.ts:1594`）。清单使复制的消息不再被提炼。
- 分叉使用当前选中的角色，不一定是源会话的角色。源角色已提炼的消息进入另一角色时，按新角色重新提炼。
- 删除消息：游标保存消息 ID 与创建时间。锚点消息被删除时，按创建时间定位后续消息。
- 删除来源消息不自动删除记忆。记忆页显示"来源已删除"，由用户决定是否删除记忆。
- 导入会话：`importSessions` 导入的会话以末尾为提炼起点，不自动提炼。用户可以手动回填。
- 云端合并：合并进来的新消息按创建时间排序。早于游标的消息不自动提炼。

**提交与幂等**：

- 批次 ID 由账号 ID、角色 ID、排序后的来源消息 ID 与来源内容摘要确定，不包含会话 ID。重试复用该 ID。
- 批次状态为 `pending`、`running`、`committed` 或 `failed`，记录次数和下次重试时间。
- 同一批次最多提交一次。好感度事件使用批次 ID 去重，消费后记录已应用状态。
- 用户编辑、删除、清空与自动提炼必须经过同一写入入口。
- leader 丢失后取消生成。提交时再次检查写入权限，禁止旧执行者写回。
- 仓库当前 `unstorage` 封装未提供跨记录事务，不能把多次 `setItem` 视为原子提交。
- 实施前必须验证存储方案的事务、跨窗口互斥和崩溃恢复能力。未通过验证，不进入完整记忆开发。
- 存储候选为原生 IndexedDB 事务，或追加提交日志加原子版本发布。选型需先调研并由用户确认。
- 无新依赖的候选：`idb-keyval` 已是 `stage-ui` 的依赖。它的 `setMany` 在一个 IndexedDB 读写事务内写入多个键。
- 跨窗口互斥沿用 `chat-assets.repo.ts:35` 的 `navigator.locks` 写法。在锁内先读取、校验，再用 `setMany` 一次提交。
- 上述候选在 Electron 中可用。安卓 WebView 的 Web Locks 与事务行为需要在 C0 真机验证。
- 数据写入失败时，游标不得前移。启动后重放已提交事件，恢复未完成任务。
- 嵌入失败只保留待计算状态。不得撤销文本提交，也不得重新执行提炼或重复增加好感度。

```ts
interface MemoryExtractionResult {
  /** Omit a block to keep it unchanged. Locked blocks are ignored. */
  coreBlocks: Partial<Record<CoreMemoryBlockKey, string>>
  episodes: Array<{ text: string, factKey?: string, importance: number, keywords: string[], occurredAt: string | null }>
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
4. 向量或关键词有相关命中时，按综合分排序。两种路径均无命中时，最多注入最近 3 条有效情节。
5. L1 与 L2 合计渲染上限 2000 个 Unicode 码点。L1 每块最多 750，L2 使用剩余预算。
6. L2 按完整条目加入，放不下则跳过。不得截断日期或事实句子。预算包含标签与分隔符。

各分数先归一化到 0 至 1。相关度阈值和新近度衰减参数必须在实现前固定，并使用中文样例校准。

调研在 Apple M5 上实测：5000 条 1024 维向量的暴力余弦约 4 ms。所以不引入向量索引，记忆按角色加载到内存。
安卓设备上的耗时未实测。

**中文分词**：关键词检索使用 `Intl.Segmenter`。不可用时退化为单字加二元组。
WebView 中 `Intl.Segmenter` 的中文效果未核实，需要真机测试。

**注入方式**：作为请求级上下文注入，不写入全局 `context registry`。
注册表是全局共享的。排队中的不同会话会互相覆盖 `ReplaceSelf` 条目。
`chat.ts:623` 的 `snapshot` 当前不接收会话 ID。
在 `prepareSend` 中生成请求专属快照，包含账号 ID、角色 ID、会话 ID、记忆修订号和检索条目。
通过发送选项传入核心，不依赖全局变量或仅按会话缓存。这样同会话的两个请求也不会覆盖检索结果。
请求开始发送前重新检查修订号。用户编辑或删除后，尚未发送的请求必须重建快照。
已发送到供应商的数据不能收回。删除操作需取消相关本地生成，并明确远端数据不在此操作范围内。

现有的请求级选项 `systemPromptSupplement` 已能按请求传入核心，见 `chat.ts:899` 与 `chat-orchestrator-runtime.ts:134`。
它的内容进入 system 消息，因此具有系统权限。语音上下文已用"evidence, not instructions"标注它是数据，见 `chat.ts:839`。

- L1 内容稳定，通过 `systemPromptSupplement` 注入，并用同样的方式标注为数据。这不需要改动 `core-agent`。
- L2 每轮检索结果不同。放进 system 消息会使供应商的前缀缓存每轮失效。
- L2 的注入位置待决策，见第七节。若附加到最后一条用户消息，需要改动 `core-agent`，并覆盖文本、语音和排队发送路径。

**切换嵌入模型**：旧向量与新模型不可比较。切换后后台重算全部向量。重算完成前，检索使用关键词路径。
向量版本包含供应商、端点标识、模型 ID 与维度，不保存密钥。旧任务完成后不得覆盖新版本向量。

**删除与遗忘边界**：

- 首版提供“删除记忆记录”，不承诺语义级彻底遗忘。
- 删除 L2 时清理正文、向量和待计算任务，保留最小删除标记，阻止旧批次重放该记录。
- 删除不自动修改 L1 或原始聊天。界面列出关联核心块和来源会话，允许用户分别处理。
- 相同事实仍在 L1 或当前聊天中时，角色仍能提到它。验收仅保证已删除记录不再被召回。
- 清空角色记忆时，同时清空 L1、L2、待确认项和任务，递增记忆代次。
- 清空时记录各会话的提炼起点。旧消息不再自动提炼，旧代次任务全部失效。
- 用户在清空后再次提供相同事实时，允许生成新记忆。清空不删除聊天，也不删除性格。
- 导出默认只含有效记忆，不含密钥、删除标记或原始聊天。导出前展示范围。
- 跨会话原文清理、备份清理和语义级遗忘属于后续独立功能，不在本版承诺中。
- 删除角色卡时，确认对话框说明会同时删除该角色的记忆、情绪、好感度、作息与提炼任务。确认后一并删除。
- 恢复已删除的角色卡（`restoreDeletedCard`）不恢复记忆。冲突副本与复制的角色卡不携带记忆。

**管理界面**：长期记忆设置页 `memory-long-term.vue` 提供以下功能：

- 查看与编辑 L1 核心记忆，锁定某一块。
- 查看 L2 情节，单条删除，显示失效状态。
- 全部清空与导出。
- 显示当前检索模式："向量加关键词"或"仅关键词"。
- 显示待提炼、重试耗尽和待确认状态，提供立即提炼与重试操作。

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

- 在会话 A 说出生日。提炼提交后，在会话 B 的请求中检查生日上下文。不配置嵌入模型也必须通过。
- 立即切换会话时，触发提炼。超过 3 秒仍未完成时正常发送，不承诺该轮已知生日。
- 空闲 10 分钟且无新输入时，前台触发提炼。安卓恢复前台后补处理遗漏任务。
- 用户编辑 L1 后，角色立即使用新内容。锁定后提炼不再改写。
- 说"我搬到上海了"后，旧住址情节显示为失效，并且不再被召回。
- 删除一条情节后，新请求不再召回该记录。旧批次重试不能恢复它。
- 清空后，旧任务不得写回，旧消息不得重新自动提炼，性格与聊天历史保持不变。
- 提炼失败不影响当前对话，下次触发时重试。
- 在提交前、提交后及嵌入阶段模拟崩溃，重启后每批记忆和好感度增量只生效一次。
- 提炼期间编辑或锁定 L1，旧模型结果不得覆盖用户修改。
- 旧住址位于 100 条情节之前时，更新住址仍能使旧事实失效。
- 切换角色、切换 leader、并发排队与切换嵌入模型时，不串用角色数据或向量。
- 切换账号时，正在执行的提炼不写入新账号。两个账号的同名角色 `default` 互不可见对方记忆。
- 分叉会话后，复制的消息不重复提炼，好感度不重复增加。
- 首次启用记忆时，已有历史不自动提炼。手动回填前显示预计批次数。
- 删除角色卡后，其记忆与任务一并删除。恢复该角色卡后，记忆为空。
- 打分与分词函数有单元测试。

固定模型的行为抽样与确定性契约测试分开记录。不能仅凭模型一次答对就判定持久化正确。

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

### 2.4 性格管理

**目标**：用户能为每张角色卡编辑稳定性格，并在发送前查看实际采用的设定。
性格管理复用角色卡编辑器，不新增独立人格数据库，也不自动改变角色性格。

**现有基础**：

- `CardEditor.vue` 已提供 `cardPersonality` 文本输入，绑定角色卡 `personality`。
- `CardEditor.vue` 已有改动检测 `isDirty` 与 `UnsavedChangesDialog`。取消与未保存提醒复用它们，不新建。
- `airi-card.ts` 的 `resolveSystemPrompt` 已合并系统提示、描述、性格与场景，按此顺序拼接，没有优先级机制。
- `postHistoryInstructions` 等 CCv3 位置相关字段不进入提示词，见 `airi-card.ts:73-74`。
- 每次模型请求前，`getSessionSystemPrompt` 按会话所属角色重新读取提示词，见 `session-store.ts:220`。
- 角色卡已有导入、复制和持久化路径。新增能力必须沿用这些路径，不保存平行副本。
- 角色卡当前是整台设备共用。阶段 0 完成后，角色卡才按账号隔离。

**领域边界**：

| 内容 | 所有者 | 允许的修改来源 |
| --- | --- | --- |
| 性格、说话风格、互动边界 | 角色卡 `personality` | 用户编辑、确认应用预设、导入、版本恢复、同账号其他设备的云同步 |
| 当前心情 | 2.2 情绪状态 | ACT 信号与时间衰减 |
| 好感度、关系阶段 | 2.2 关系状态 | 去重后的互动与提炼事件 |
| 用户画像、共同经历 | 2.1 长期记忆 | 提炼与用户编辑 |

**首版范围**：

- 在现有角色卡编辑器中完善性格区域，支持编辑、预设选择、应用预览、保存和取消。
- 首批预设为温和、活泼、冷静。预设只提供可编辑文本，不绑定声音、模型、关系阶段或数值效果。
- 预设由应用内常量及英文、简体中文翻译组成，不新增依赖。
- 预设使用下拉选择。应用前展示替换后的文本，并要求用户确认覆盖当前草稿。
- 性格文本覆盖稳定特征、表达习惯和互动边界。首版不新增独立滑块，避免文本与数值双重配置。
- 应用预设只修改草稿。取消编辑时不保存，保存后才影响后续请求。
- 用户自定义文本原样保存，不因切换界面语言而自动翻译或被预设覆盖。
- 新编辑内容最多 2000 个 Unicode 码点。超过限制时阻止保存，不静默截断。
- 导入的长文本完整保留并显示超限状态。用户修改性格时需缩短，其他字段的编辑不受阻。
- 复制角色卡时复制性格，但不复制记忆、情绪或好感度。导入导出必须保留性格文本。
- 首版不支持自动性格进化、性格评分、人格市场或云端预设共享。
- 云同步、版本恢复与导入都是合法的修改来源。模型、工具与记忆提炼不是修改来源。

**编辑器基线冲突**：

- 现状：编辑器打开后只初始化一次草稿，之后不跟随 store 变化，见 `CardEditor.vue:552-575`。
- 现状：保存时用整份草稿调用 `updateCard`，见 `CardEditor.vue:679` 与 `airi-card.ts:207-223`。
- 风险：编辑期间，唤醒词工具（`wake-words.ts:32`）、背景切换或云同步写入的字段，会被保存操作改回旧值。
- 规则：打开编辑器时保存基线快照。保存时只写入草稿中相对基线有变化的字段。
- 规则：如果某个字段在基线之后被其他来源改动，草稿也改动了它，保存时提示冲突，由用户选择保留哪一份。
- 规则：草稿未改动的字段，保存后保持 store 中的最新值。

**提示词与记忆的关系**：

- 性格只在角色卡提示词中注入一次，不再通过 `runtimeContextProviders` 重复添加。
- 读取目标会话所属角色的性格，不读取界面当前选中的角色。
- 提示词中声明优先级：系统约束最高，其次是角色卡的明确指令。性格只控制表达和互动方式。
- 提示词中声明：记忆只提供事实，情绪和关系只修饰当下表达，三者不能覆盖性格中的互动边界。
- 上述优先级只靠提示词顺序与措辞实现，代码不能强制执行。验收用固定模型抽样评测，不作为保证。
- 性格区与自定义系统提示冲突时，提示词声明以系统提示为准。预览展示两者，不能宣称能自动发现所有语义冲突。
- 预览展示实际发送的角色部分：格式说明前缀、系统提示、描述、性格、场景。工具集补充与记忆不在预览范围内。
- 预览标出不进入提示词的字段，例如 `postHistoryInstructions`。
- 保存性格后，下次发送或下一次工具步骤构建提示词时读取新内容，不重写已发送的请求。
- 提炼结果不得包含性格改写。角色描述、性格和场景不得被提炼成真实用户画像。
- 删除记忆不改变性格。修改性格不重置历史、情绪或好感度。

**改动边界**：

- `packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue`：性格草稿与预设交互。
- `packages/stage-ui/src/services/airi-card-editor.ts`：复用现有草稿校验入口。
- `packages/stage-ui/src/stores/modules/airi-card.ts`：保持单一性格来源，验证导入、复制和提示词路径。
- `packages/i18n`：预设文本与控件文案，只实现英文和简体中文。
- 实施时同步更新相关工作区 README，不新增平行性格 store。

**验收**：

- 保存角色 A 的性格，重启后仍保留。角色 B 不受影响。
- 预设应用后取消编辑，持久化内容不变。手工编辑后保存，以编辑结果为准。
- 排队发送角色 A 的消息后切到 B，请求仍包含 A 的性格，且只出现一次。
- 导入、导出和复制角色卡后，性格文本保持一致。复制不携带私人记忆。
- 在提炼期间修改性格，提炼提交不覆盖该修改，也不将性格写入用户画像。
- 编辑器打开期间，唤醒词工具修改了同一角色卡。保存性格后，唤醒词保持工具写入的值。
- 编辑器打开期间，云同步修改了性格，草稿也修改了性格。保存时出现冲突提示。
- 账号 A 的角色性格在账号 B 下不可见。
- 固定模型抽样：记忆中的用户要求与性格边界冲突时，回复遵守性格边界的比例单独记录，不设为通过门槛。
- 验证空文本、长文本、中文、语言切换、取消与未保存草稿的处理。
- 桌面和安卓分别验证编辑、预设选择、键盘遮挡与保存状态。

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
阶段 0 账号数据隔离（完成持久化位置清单后估算）
├── 当前账号指针、键名转换与设备作用域清单
├── 渲染进程、主进程与安卓的作用域存储
└── 切换账号重新加载、旧数据归入 local

阶段 A 快速见效（约 1.5 周）
├── 1.1L Live2D 情绪映射，修复现有失效功能
└── 2.0 工作记忆窗口

阶段 B 性格与情绪（约 1.5 至 2.5 周）
├── 2.4 性格编辑、预设、基线冲突处理与提示词验证
└── 2.2 情绪惯性、好感度、提示词注入与 Live2D 待机表情

阶段 C 长期记忆（C0 约 2 至 3 个工作日，其余在 C0 通过后估算）
├── C0 存储选型确认，验证原子提交、leader 切换与崩溃恢复
├── C1 提炼队列、L1 编辑与锁定、请求快照，不依赖嵌入
├── C2 L2 事实替换、关键词召回、删除与清空
└── C3 可选嵌入、模型切换与完整管理页

阶段 D 主动关怀（约 1.5 周）
├── 2.3 持久化、作息、免打扰与写入会话
└── 2.3 安卓本地通知

阶段 E 增强（按需）
├── 2.1+ 本地嵌入与 L3 反思
├── 1.4L 背景按时段切换
└── 1.3L 装扮预设
```

顺序理由：

- 阶段 0 决定所有新增状态的存储位置。先做功能再补隔离，就要迁移已经写入的数据。
- A 改动小、见效快。1.1L 的映射按模型保存，同样放在账号作用域内。
- 2.2 的好感度增量来自 2.1 的提炼。B 先用规则加分，C 完成后接入提炼增量。
- 2.4 先明确稳定性格的来源。2.1 不得自动覆盖此来源。
- C0 未通过时不承诺记忆幂等性。C1 通过后可先交付不含 L2 的版本。
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
4. 记忆存储提交方案。建议先验证 `idb-keyval` 的 `setMany` 加 `navigator.locks`，它不需要新依赖。验证不通过时，再比较提交日志方案。
5. v3 的性格预设名称与内容属于首版建议。正式实现时确认文案，不影响先复用 `personality` 的结构决策。
6. L2 情节的注入位置。

   | 选项 | 改动 `core-agent` | 前缀缓存 | 权限 |
   | --- | --- | --- | --- |
   | 并入 `systemPromptSupplement` | 不需要 | 每轮失效 | 系统级，需标注为数据 |
   | 附加到最后一条用户消息（推荐） | 需要新增请求级上下文选项 | 保持 | 用户级 |

7. 每日自动提炼上限的默认值。本文暂定每个账号每天 50 批。

## 八 未验证内容

- 没有运行任何测试、类型检查或性能测量。估算工期没有经过实际开发验证。
- 已静态检查 `core-agent/src/messages/turns.ts`。用户、助手和系统各自形成 `Turn`，仍需验证窗口边界测试。
- v3 只修订规格，未实现或验证事务存储、提炼恢复、删除和性格管理功能。
- 性格字段和提示词合并已有源码依据，但新增预设、草稿规则与跨平台交互尚未验证。
- v3.1 静态核对了 `forkSession`、`deleteMessage`、`importSessions`、`mergeCloudMessagesIntoSession` 与 `CardEditor.vue` 的保存路径，未运行验证。
- `idb-keyval` 的 `setMany` 单事务写入已在 `node_modules` 源码中确认。安卓 WebView 的 Web Locks 未实测。
- 安卓 WebView 的 WebGPU、`Intl.Segmenter` 中文效果、暴力检索耗时与云端嵌入接口 CORS 均未实测。
- 安卓后台 JS 定时器行为未在本仓库实测。
- 详细的外部依据与其他未核实项见 [长期记忆方案调研](../research/llm-memory-approaches.md) 第 7 节。
