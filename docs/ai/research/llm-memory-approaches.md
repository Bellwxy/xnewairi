# AI 陪伴应用长期记忆方案调研

- 日期：2026-10-13
- 状态：调研完成，待评审。本文不改变运行时代码。
- 范围：`apps/stage-tamagotchi`（Electron）和 `apps/stage-pocket`（Capacitor Android）。记忆逻辑放在 `packages/stage-ui` 客户端代码中。
- 关联规划：[角色表现力与大脑规划 2.0 和 2.1 节](../plans/character-expressiveness-and-brain-spec.md)。本文给出方案依据，不替代该规划。

本文只使用一手来源：官方文档、仓库源码与 README、论文原文和官方定价页。查不到的项写"未核实"。

## 1. 结论

- 没有一个现成记忆库可以直接在 Electron 渲染进程和 Android WebView 中运行。mem0 TS SDK 顶层导入 `better-sqlite3`、`fs` 和 `os`，只能在 Node 中运行。其他方案是 Python 服务或云端客户端。见 [第 3 节](#3-记忆方案对比)。
- 推荐在 TS 中自己实现。借鉴三个设计：Letta 的常驻核心记忆块、mem0 的单次 LLM 提炼和去重、Generative Agents 的"相关度 + 新近度 + 重要度"打分。
- 嵌入走现有供应商体系。用户在 `embed` 类别中选择 OpenAI 兼容接口或 Ollama。`@xsai/embed` 和 `@xsai-transformers/embed` 已是依赖，可以直接调用。
- 数千条记忆规模下，JS 内存暴力余弦足够。本机实测 5000 条 1024 维约 4 ms。不需要 sqlite-vec 或 ANN 索引。见 [5.1 节](#51-暴力余弦是否足够)。
- 没有嵌入模型时，降级为"核心记忆常驻 + 关键词检索 + 最近若干条情节"。中文关键词检索必须自定义分词。

## 2. 仓库现状

| 事实 | 依据 |
| --- | --- |
| 供应商分类已含 `embed` | [`metadata.ts`](../../../packages/stage-ui/src/libs/providers/metadata.ts#L10) |
| `stage-ui` 已依赖 `@xsai/embed`、`@xsai-transformers/embed` 和 `@huggingface/transformers` | [`stage-ui/package.json`](../../../packages/stage-ui/package.json#L78-L126) |
| `@xsai-transformers/embed` 在 Worker 中运行 `feature-extraction`。检测到 WebGPU 时用 `webgpu`，否则用 `wasm` | [上游 worker 源码](https://github.com/moeru-ai/xsai-transformers/blob/main/packages/embed/src/worker/index.ts) |
| `Stage.vue` 中 `createTransformers` 和 DuckDB 的调用已注释掉 | [`Stage.vue`](../../../packages/stage-ui/src/components/scenes/Stage.vue#L25-L63) |
| 存储层是 `unstorage`，`local` 挂载 IndexedDB 驱动 | [`storage.ts`](../../../packages/stage-ui/src/database/storage.ts#L1-L11) |
| 长期记忆设置页当前只有 `WIP` 占位 | [`memory-long-term.vue`](../../../packages/stage-pages/src/pages/settings/modules/memory-long-term.vue#L1-L7) |
| `memory-pgvector` 是 Node 加 Postgres 的空壳模块，不能在 WebView 中运行 | [`memory-pgvector/src/index.ts`](../../../packages/memory-pgvector/src/index.ts) |
| OpenAI 兼容校验器列模型时会跳过 ID 含 `embed` 的模型。嵌入模型选择需要单独路径 | [`openai-compatible.ts`](../../../packages/provider-inference/src/validators/openai-compatible.ts#L66-L72) |
| Ollama 供应商默认地址是 `http://localhost:11434/v1/`，任务只声明 `chat` | [`ollama/index.ts`](../../../packages/provider-inference/src/providers/local/ollama/index.ts#L13-L15) [任务声明](../../../packages/provider-inference/src/providers/local/ollama/index.ts#L71) |
| 已有请求级上下文注入模式，例如账户上下文 | [`user-account.ts`](../../../packages/stage-ui/src/stores/chat/context-providers/user-account.ts) |

## 3. 记忆方案对比

### 3.1 总表

| 方案 | 核心机制 | TS/JS SDK | 纯客户端运行 | 许可证 | 依赖 | 用法 |
| --- | --- | --- | --- | --- | --- | --- |
| mem0 | LLM 提炼事实，向量召回 | 有，`mem0ai/oss` | 否，Node 专用 | Apache-2.0 | 默认 `better-sqlite3` | 借鉴设计 |
| Letta / MemGPT | 常驻记忆块，Agent 用工具自改。归档记忆走检索 | 有，`@letta-ai/letta-client` 是 API 客户端 | 否，需要 Letta 服务 | Apache-2.0 | V1 服务用 Postgres + pgvector，或 SQLite + sqlite-vec | 借鉴设计 |
| Zep / Graphiti | 双时间知识图谱，冲突时旧边失效不删除 | Graphiti 无 TS SDK。`@getzep/zep-cloud` 是云端客户端 | 否 | Apache-2.0 | Neo4j、FalkorDB、Neptune 或 Kuzu | 只借鉴"失效不删除" |
| LangMem | 语义、情节、程序三类记忆。对话中工具写入或后台提炼 | 无，未发现 npm 包 | 否 | MIT | LangGraph `BaseStore` | 借鉴设计 |
| Memobase | 按用户画像槽位提炼，加事件时间线。缓冲区满或空闲后批量处理 | 有，`@memobase/memobase` 是服务客户端 | 否 | Apache-2.0 | FastAPI、Postgres、Redis | 借鉴画像槽位 |
| MemOS | MemCube 统一明文、激活和参数记忆 | 本地插件是 npm 包，但依赖 `better-sqlite3` | 否 | Apache-2.0（主仓库） | 自托管需 Neo4j + Qdrant | 不建议 |
| A-MEM | Zettelkasten 笔记：关键词、标签、链接、记忆演化 | 无，Python | 否 | MIT | ChromaDB | 借鉴链接字段 |
| Generative Agents | 记忆流 + 三项打分召回 + 反思 | 无（论文） | 设计可移植 | 不适用 | 无 | 借鉴打分公式 |

### 3.2 mem0

- 定位：给 Agent 和应用的记忆层。Apache-2.0。提供 Python 和 TypeScript SDK。[README](https://github.com/mem0ai/mem0)
- 论文：先提炼候选事实，再与已有记忆比较。操作包括 ADD、UPDATE、DELETE 和 NOOP。另有图变体 Mem0g。论文报告相对全上下文 p95 延迟降低 91%，token 成本降低 90% 以上。[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)
- 当前版本：README 写明新算法是"单次 ADD-only 提炼，一次 LLM 调用，不做 UPDATE/DELETE"。[README](https://github.com/mem0ai/mem0)
- `mem0ai@3.3.1` 源码中，提炼提示词只允许 ADD。它用"最近 20 条已提炼记忆"和"相关已有记忆"去重，并用 `linked_memory_ids` 关联相关旧记忆。旧的 `ADD/UPDATE/DELETE/NONE` 结构仍保留在代码中。[npm 包](https://www.npmjs.com/package/mem0ai/v/3.3.1) 中 `dist/oss/index.mjs` 的 `ADDITIVE_EXTRACTION_PROMPT`
- 默认配置：LLM 为 `gpt-5-mini`，嵌入为 `text-embedding-3-small`，向量库为 in-memory，历史记录为 SQLite。[Node 快速开始](https://docs.mem0.ai/open-source/node-quickstart)
- 浏览器可行性：不可行。依据如下。
  - 默认 `memory` 向量库在构造时 `new Database(dbPath)`，路径默认 `~/.mem0/vector_store.db`。它在 SQLite 中存向量，再在 JS 中逐条算余弦。
  - 模块顶层静态导入 `better-sqlite3`、`fs`、`os` 和 `path`。历史记录 `SQLiteManager` 也用 `better-sqlite3`。
  - `package.json` 声明 `engines.node >= 18`，没有 `browser` 字段。
  - 来源：`mem0ai@3.3.1` 的 `package.json` 和 `dist/oss/index.mjs`，源码路径 `src/oss/src/vector_stores/memory.ts`、`src/oss/src/storage/SQLiteManager.ts`。
  - 是否能通过打包别名绕过：未实测。即使绕过，其他向量库都是服务端（Qdrant、pgvector、Redis 等）。
- 结论：只借鉴提炼提示词结构、去重输入和记忆链接。

### 3.3 Letta / MemGPT

- MemGPT 论文提出虚拟上下文管理。主上下文类似内存，外部存储分为回忆存储和归档存储。模型通过函数调用在层间移动数据。[arXiv:2310.08560](https://arxiv.org/abs/2310.08560)
- Letta 主仓库已迁移到 `letta-ai/letta-code`。V1 API 服务保留在 `archive` 分支。[README](https://github.com/letta-ai/letta)
- 记忆块字段：`label`、`value`、`limit`、`description`、`read_only`。V1 默认块上限为 100000 字符，persona 和 human 各 20000 字符。[block.py](https://github.com/letta-ai/letta/blob/archive/letta/schemas/block.py) [constants.py](https://github.com/letta-ai/letta/blob/archive/letta/constants.py)
- 记忆工具：`core_memory_append`、`core_memory_replace`、`memory_replace`、`memory_insert`、`memory_rethink`、`archival_memory_insert`、`archival_memory_search` 和 `conversation_search`。另有 sleeptime Agent 工具集，在后台改写记忆。[base.py](https://github.com/letta-ai/letta/blob/archive/letta/functions/function_sets/base.py) [constants.py](https://github.com/letta-ai/letta/blob/archive/letta/constants.py)
- 依赖：V1 服务依赖 `pgvector`、`asyncpg`。可选 `sqlite` 组使用 `aiosqlite` 和 `sqlite-vec`。[pyproject.toml](https://github.com/letta-ai/letta/blob/archive/pyproject.toml)
- TS SDK：`@letta-ai/letta-client` 描述为"Letta API 的官方 TypeScript 库"，需要 Letta 服务。[npm](https://www.npmjs.com/package/@letta-ai/letta-client)
- 官方文档 `docs.letta.com` 本次抓取失败。文档中的当前默认值未核实，以上数值来自 archive 分支源码。
- 结论：核心记忆块最适合陪伴场景。它不需要嵌入，可以在 TS 中直接实现。不建议让对话模型在主回合中调用记忆工具。工具调用能力因模型而异，且增加延迟。改为后台提炼模型统一改写，相当于 sleeptime 模式。

### 3.4 Zep / Graphiti

- Graphiti 是 Python 库，Apache-2.0。后端支持 Neo4j、FalkorDB、Amazon Neptune 和 Kuzu。README 标注 Kuzu 已弃用。[README](https://github.com/getzep/graphiti)
- 每条事实有有效期。信息变化时旧事实失效，不删除。检索组合语义嵌入、BM25 和图遍历。[README](https://github.com/getzep/graphiti)
- 论文：情节子图、语义实体子图、社区子图，加双时间模型。DMR 上 94.8%，MemGPT 为 93.4%。[arXiv:2501.13956](https://arxiv.org/abs/2501.13956)
- Zep Community Edition 已不再支持，代码移到 `legacy/`。[Zep README](https://github.com/getzep/zep)
- 结论：图数据库无法在 WebView 中落地。只借鉴"冲突时标记失效，不删除"。

### 3.5 LangMem

- Python 包，MIT。提供对话中使用的工具 `create_manage_memory_tool` 和 `create_search_memory_tool`，也提供后台记忆管理器。存储依赖 LangGraph `BaseStore`。[README](https://github.com/langchain-ai/langmem)
- npm 上没有 `langmem` 或 `@langchain/langmem` 包（`npm view` 返回 404，2026-10-13）。
- 结论：只借鉴"热路径写入"与"后台提炼"的划分。陪伴应用选后台提炼。

### 3.6 Memobase

- 以用户画像为中心。开发者定义 topic 和 subtopic 槽位。另有事件时间线回答时间相关问题。[README](https://github.com/memodb-io/memobase)
- 缓冲区约 1024 token 或空闲约 1 小时后批量处理。也可手动 `flush()`。[README](https://github.com/memodb-io/memobase)
- 服务使用 FastAPI、Postgres 和 Redis。[README](https://github.com/memodb-io/memobase)。TS 包 `@memobase/memobase` 只依赖 `zod`，是服务客户端。[npm](https://www.npmjs.com/package/@memobase/memobase)
- 结论：借鉴"画像槽位 + 批量触发"。这与现有规划的空闲 10 分钟或 20 轮触发一致。

### 3.7 MemOS

- 论文把明文、激活和参数级记忆统一管理。基本单元 MemCube 含内容和来源、版本等元数据。[arXiv:2507.03724](https://arxiv.org/abs/2507.03724)
- 自托管需要 Neo4j 和 Qdrant。本地插件使用 SQLite 和 FTS5 加向量混合检索。[README](https://github.com/MemTensor/MemOS)
- 本地插件 `@memtensor/memos-local-plugin@2.0.20` 依赖 `better-sqlite3`，要求 Node >= 20，许可证 MIT。[npm](https://www.npmjs.com/package/@memtensor/memos-local-plugin)
- 结论：体量大，面向编码 Agent。不适合本项目。

### 3.8 A-MEM

- 每条记忆是笔记，含上下文描述、关键词、标签和嵌入。新记忆会生成链接，并触发旧记忆更新。NeurIPS 2025。[arXiv:2502.12110](https://arxiv.org/abs/2502.12110)
- 系统代码是 Python，用 ChromaDB，MIT。[A-mem-sys README](https://github.com/WujiangXu/A-mem-sys)
- 结论：可借鉴 `keywords` 字段。关键词还能服务无嵌入时的检索。"记忆演化"每次要额外 LLM 调用，第一版不做。

### 3.9 Generative Agents

- 记忆流用自然语言记录经历。召回分数为新近度、重要度和相关度之和。[arXiv:2304.03442](https://arxiv.org/html/2304.03442v2)
- 新近度按"距上次召回的游戏小时数"指数衰减，衰减因子 0.995。重要度由 LLM 在写入时打 1 至 10 分。相关度是嵌入余弦相似度。三项归一化后加权，所有权重为 1。[arXiv:2304.03442](https://arxiv.org/html/2304.03442v2)
- 最近事件的重要度总和超过 150 时触发反思。[arXiv:2304.03442](https://arxiv.org/html/2304.03442v2)
- 结论：打分公式是纯函数，可以直接移植。

### 3.10 陪伴类产品做法

| 产品 | 做法 | 依据 |
| --- | --- | --- |
| ChatGPT | 两类：保存的记忆（明确条目，用户可查看、删除）和参考聊天记录（自动，不保证记住细节）。较新的版本维护一份记忆摘要 | [Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)。页面直接抓取返回 403，内容来自官方帮助页的搜索摘要。细节未核实 |
| Character.AI（2024-01） | 每个聊天可置顶 5 条消息 | [AMA Recap and January 2024 FAQ](https://blog.character.ai/ama-recap-and-january-2024-faq/) |
| Character.AI（2025-05） | 聊天记忆文本框，最多 400 字符固定信息。官方说明不保证角色一定使用 | [Helping Characters Remember What Matters Most](https://blog.character.ai/helping-characters-remember-what-matters-most/) |
| Character.AI（2026-05） | Story Memory 和置顶。Facts 自动提炼，可编辑、禁用，可复制到新聊天。后台整理旧上下文，但用户写入和置顶的内容受保护 | [Smarter Memory for Smarter Chats](https://blog.character.ai/memory/) |
| SillyTavern Summarize | 每 N 条消息或 N 个词更新摘要。摘要按位置注入，可能有幻觉，需要手动修正 | [Summarize 文档](https://docs.sillytavern.app/extensions/summarize/) |
| SillyTavern Vector Storage | 默认用最近 2 条消息作查询，400 字符分块，相似度阈值 25%，插入 3 条 | [Chat Vectorization 文档](https://docs.sillytavern.app/extensions/chat-vectorization/) |
| SillyTavern Data Bank | 全局、角色、聊天三级附件，由向量存储检索 | [Data Bank 文档](https://docs.sillytavern.app/usage/core-concepts/data-bank/) |

- SillyTavern 是 AGPL-3.0，向量计算在其 Node 服务端 `src/vectors/` 完成，依赖 `vectra`。[仓库](https://github.com/SillyTavern/SillyTavern/tree/release/src/vectors)。只借鉴设计，不复制代码。
- 共同点：用户可见、可编辑、可置顶。自动提炼的内容不能覆盖用户手写内容。

## 4. 嵌入方案对比

### 4.1 云端 OpenAI 兼容接口

| 模型 | 维度 | 最大输入 | 价格 | 依据 |
| --- | --- | --- | --- | --- |
| OpenAI `text-embedding-3-small` | 默认 1536，可用 `dimensions` 缩短 | 8192 | 0.02 美元 / 百万 token | [模型页](https://developers.openai.com/api/docs/models/text-embedding-3-small) [指南](https://developers.openai.com/api/docs/guides/embeddings) |
| 硅基流动 `BAAI/bge-m3` | 1024 | 8192 | 免费。Pro 版 0.07 元 / 百万 token | [定价](https://siliconflow.cn/pricing) [模型卡](https://huggingface.co/BAAI/bge-m3) |
| 阿里云 `text-embedding-v4` | 2048 至 64，默认 1024 | 单批次 33000 token，批次 10 条 | 0.0005 元 / 千 token。100 万 token 免费额度，90 天 | [百炼文档](https://help.aliyun.com/zh/model-studio/embedding) |
| 阿里云 `text-embedding-v3` | 1024 至 64，默认 1024 | 8192 | 0.0005 元 / 千 token。各 50 万 token 免费额度 | [百炼文档](https://help.aliyun.com/zh/model-studio/embedding) |

- 中文效果：bge-m3 支持 100 多种语言。text-embedding-v4 列出中文在内 100 多种语言。[bge-m3](https://huggingface.co/BAAI/bge-m3) [百炼文档](https://help.aliyun.com/zh/model-studio/embedding)
- OpenAI 公布的是 MTEB 平均分 62.3%。中文检索的横向对比分数未核实。
- 阿里云 OpenAI 兼容地址形如 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。[百炼文档](https://help.aliyun.com/zh/model-studio/embedding)
- 硅基流动嵌入接口的地址与参数：官方 API 文档本次返回 404，未核实。
- 各云端接口在 WebView 中是否允许跨域请求：未核实。仓库中未发现 Pocket 的 CORS 处理，这与现有聊天供应商面对的问题相同。

### 4.2 Ollama 本地嵌入

| 模型 | 体积 | 上下文 | 语言 | 依据 |
| --- | --- | --- | --- | --- |
| `bge-m3` | 1.2 GB | 8K | 100 多种 | [Ollama](https://ollama.com/library/bge-m3) |
| `nomic-embed-text` | 274 MB | 2K | 英文。HF 标签只有 `en` | [Ollama](https://ollama.com/library/nomic-embed-text) [HF](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |
| `qwen3-embedding:0.6b` | 639 MB | 32K | 100 多种 | [Ollama](https://ollama.com/library/qwen3-embedding) |

- 中文场景不要选 `nomic-embed-text`。
- Ollama 默认允许的来源包含 `http://localhost:*`、`http://127.0.0.1:*`、`app://*`、`file://*` 等。其他来源要设置 `OLLAMA_ORIGINS`。[envconfig/config.go](https://github.com/ollama/ollama/blob/main/envconfig/config.go)
- stage-tamagotchi 生产包的渲染进程来源是否在允许列表中：未核实。
- Android 上运行 Ollama 不在范围内。手机访问局域网中的桌面 Ollama 需要开放监听和来源配置，未核实。

### 4.3 transformers.js 浏览器内嵌入

| 模型 | 维度 | 最大长度 | ONNX int8 / q8 体积 | 依据 |
| --- | --- | --- | --- | --- |
| `Xenova/bge-small-zh-v1.5` | 512 | 512 | 约 24 MB | [文件列表](https://huggingface.co/Xenova/bge-small-zh-v1.5/tree/main/onnx) [config](https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/main/config.json) |
| `Xenova/multilingual-e5-small` | 384 | 512 | 约 118 MB | [文件列表](https://huggingface.co/Xenova/multilingual-e5-small/tree/main/onnx) [config](https://huggingface.co/intfloat/multilingual-e5-small/blob/main/config.json) |
| `Xenova/bge-m3` | 1024 | 8192 | 约 569 MB | [文件列表](https://huggingface.co/Xenova/bge-m3/tree/main/onnx) |

- 体积来自 Hugging Face API 的 `onnx/` 文件大小，查询日期 2026-10-13。
- 设置 `device: 'webgpu'` 启用 WebGPU。文档说 2026 年 3 月全球 WebGPU 支持约 85%。[WebGPU 指南](https://huggingface.co/docs/transformers.js/guides/webgpu)
- Chrome for Android 从 121 起支持 WebGPU。[MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json) [Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121)
- Android WebView 的 WebGPU 支持：未核实。chromestatus "WebGPU on Android" 条目中 `webview` 字段为空。[chromestatus API](https://chromestatus.com/api/v0/features/5119617865613312)。MDN BCD 只把 WebView 标为"镜像 Chrome Android"，不是单独验证。
- WASM 路径在 WebView 中可以作为兜底，`@xsai-transformers/embed` 已内置该回退。实际推理速度、内存峰值和首次下载体验：未实测。
- e5 系列要求输入加 `query: ` 或 `passage: ` 前缀。[模型卡](https://huggingface.co/intfloat/multilingual-e5-small)。bge-zh 检索查询可加指令 `为这个句子生成表示以用于检索相关文章：`。[模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)
- 结论：本地浏览器嵌入可以做，但作为可选项。中文首选 `bge-small-zh-v1.5`，体积最小。

### 4.4 不用嵌入

| 方式 | 说明 | 依据 |
| --- | --- | --- |
| MiniSearch | MIT。前缀、模糊、字段加权。默认按 Unicode 空格和标点切分，中文需要自定义 `tokenize` | [README](https://github.com/lucaong/minisearch) |
| Orama | Apache-2.0。全文、向量和混合检索。`@orama/tokenizers` 的 mandarin 分词器基于 `Intl.Segmenter('zh-CN')` | [README](https://github.com/oramasearch/orama) [mandarin.ts](https://github.com/oramasearch/orama/blob/main/packages/tokenizers/src/mandarin.ts) |
| 核心记忆常驻 | Letta 风格。画像与关系写在固定长度文本块中，每轮注入提示词 | [3.3 节](#33-letta--memgpt) |

- `Intl.Segmenter` 在 Chrome 87 起支持，WebView 为镜像标注。[MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Intl/Segmenter.json)
- 本机 Node 26 实测：`我昨天和小明去北京吃烤鸭，他喜欢猫` 切分为 `我|昨天|和|小明|去|北京|吃|烤鸭|他|喜欢|猫`。Android WebView 中的中文分词质量：未核实。分词不可用时可退化为单字加二元组切分。

## 5. 向量检索规模

### 5.1 暴力余弦是否足够

本机实测。环境为 Apple M5、Node v26.0.0。向量为预先归一化的 `Float32Array`，计算点积后取前 10。每组取 20 次平均。

| 条数 | 维度 | 平均耗时 | 向量内存 |
| --- | --- | --- | --- |
| 1000 | 1024 | 0.73 ms | 4.1 MB |
| 5000 | 1024 | 3.90 ms | 20.5 MB |
| 10000 | 1024 | 7.73 ms | 41.0 MB |
| 5000 | 1536 | 5.35 ms | 30.7 MB |
| 20000 | 1024 | 15.60 ms | 81.9 MB |

- 数千条记忆时，暴力检索远小于一次 LLM 请求的延迟。
- mem0 默认 in-memory 库和 Orama 的向量检索都是逐条计算余弦，没有 ANN 索引。[Orama vector.ts](https://github.com/oramasearch/orama/blob/main/packages/orama/src/trees/vector.ts)
- sqlite-vec 支持 WASM，但仍是 pre-v1，README 提示会有破坏性变更。[README](https://github.com/asg017/sqlite-vec)。引入它要额外打包 SQLite WASM，本规模下没有收益。
- Android 设备上的耗时：未实测。

### 5.2 存储建议

- 记忆文本和元数据存 `unstorage` IndexedDB。嵌入以 `Float32Array` 或数字数组保存，并记录 `embeddingModel` 和维度。
- 启动时加载当前角色的记忆到内存。按角色分区，避免一次加载全部角色。
- 用户切换嵌入模型后，旧向量不可比较。必须在后台用新模型重算。重算完成前，检索走关键词路径。

## 6. 推荐方案

### 6.1 分层组合

| 层 | 内容 | 写入 | 读取 | 是否需要嵌入 |
| --- | --- | --- | --- | --- |
| L0 工作窗口 | 最近 N 轮原文 | 现有会话 | 全量发送 | 否 |
| L1 核心记忆 | 用户画像和关系块。每块有字符上限，例如 1500 字 | 后台提炼模型整块改写。用户可编辑、可置顶 | 每轮常驻注入 | 否 |
| L2 情节记忆 | 一句话一条，含时间、重要度、关键词 | 后台提炼，只追加，带去重 | 混合检索后取前 K 条 | 可选 |
| L3 反思摘要 | 周期性归纳 | 重要度累计超过阈值时生成 | 视为 L2 条目 | 可选，第二阶段 |

理由：

- L1 覆盖陪伴场景中最常被问的内容，例如名字、生日、喜好和关系。它不依赖嵌入，所有平台都能用。ChatGPT 保存的记忆、Character.AI Story Memory 和 Letta 核心记忆都是这种形态。
- L2 只追加，冲突处理简单。这与 mem0 当前的 ADD-only 方向一致。旧事实加 `supersededBy` 或 `invalidatedAt` 字段，不物理删除。这借鉴 Graphiti 的失效模型。用户删除时才物理删除。
- 提炼一次 LLM 调用同时产出 L1 改写、L2 新条目和关键词。用 Valibot 校验输出。触发条件沿用现有规划：空闲 10 分钟或 20 轮未提炼。
- 召回打分用 Generative Agents 公式。相关度取向量余弦与关键词分数的融合。新近度和重要度都归一化。
- 不引入 mem0、Letta 等库。它们的运行时依赖无法进入 WebView。

### 6.2 嵌入选择顺序

1. 用户在 `embed` 类别中选择的供应商。中文推荐硅基流动 `BAAI/bge-m3`（免费）或阿里云 `text-embedding-v4`。桌面端可选 Ollama `bge-m3`。
2. 可选本地模型：transformers.js `bge-small-zh-v1.5`，约 24 MB，WebGPU 不可用时走 WASM。默认关闭，由用户开启并下载。
3. 无嵌入：进入降级方案。

### 6.3 无嵌入时的降级

- L1 核心记忆照常常驻。
- L2 用关键词检索。数据来自提炼时生成的关键词和中文分词结果。
- 关键词检索无命中时，注入最近 3 条情节。这与现有规划 2.1 节一致。
- 设置页显示当前检索模式，让用户知道配置嵌入可以提升召回。

### 6.4 中文场景注意事项

- 分词：MiniSearch 默认切分不适合中文，必须自定义 `tokenize`。`Intl.Segmenter` 不可用时用单字加二元组。
- 嵌入模型：不要用 `nomic-embed-text`。使用 e5 时必须加 `query: ` 和 `passage: ` 前缀。
- 语言一致：记忆文本用对话语言保存。跨语言检索的效果未核实。
- 时间：提炼时把"昨天""下周"转换为绝对日期。mem0 提炼提示词也传入观察日期。
- 长度：L1 上限按字符计，不按 token 计。中文一字的 token 数因分词器而异。
- 隐私：记忆页必须支持查看、编辑、单条删除、清空和导出。Character.AI 和 ChatGPT 都提供这类控制。

### 6.5 检索库选择

按 AGENTS.md，新增依赖前必须由用户选择。候选如下。

| 选项 | 许可证 | 中文分词 | 向量检索 | 说明 |
| --- | --- | --- | --- | --- |
| 自己实现 | 不适用 | 自写 `Intl.Segmenter` 封装 | 自写暴力余弦 | 无新依赖。关键词打分需要自写 BM25 |
| MiniSearch | MIT | 自定义 `tokenize` | 无 | 体积小，只负责关键词 |
| Orama + `@orama/tokenizers` | Apache-2.0 | 内置 mandarin | 内置，逐条余弦 | 一个库覆盖混合检索。持久化需另配插件或自写序列化 |

## 7. 未核实项

| 项目 | 当前事实 | 必须确认 |
| --- | --- | --- |
| Android WebView 的 WebGPU | chromestatus `webview` 字段为空。BCD 只是镜像标注 | 在目标设备的 WebView 中检查 `navigator.gpu` |
| transformers.js 在 WebView 中的性能 | 有 WASM 回退 | 测量首次下载、加载耗时、单条嵌入耗时和内存峰值 |
| Android 上暴力检索耗时 | 只有 Apple M5 数据 | 在中低端 Android 设备上复测 5.1 节脚本 |
| WebView 的中文 `Intl.Segmenter` | Node 26 结果正常 | 在 Android WebView 中复测同一句子 |
| 云端嵌入接口的 CORS | 仓库未发现 Pocket 的 CORS 处理 | 分别在 Electron 和 WebView 中请求硅基流动、阿里云和 OpenAI |
| 硅基流动嵌入 API 参数 | 定价页可查，API 文档 404 | 确认地址、单次条数和最大 token |
| Electron 渲染进程来源与 Ollama | Ollama 默认允许 `app://*`、`file://*` 和 localhost | 确认生产包实际来源 |
| ChatGPT 记忆细节 | 帮助页 403 | 人工打开帮助页核对 |
| Letta 当前文档默认值 | 文档站抓取失败，数值来自 archive 源码 | 核对 `letta-code` 中的当前默认值 |
| mem0 打包到浏览器 | 源码顶层导入 Node 模块 | 不建议投入，除非需求改变 |
| 中文检索质量横向对比 | 未收集 C-MTEB 等评测数据 | 用自建中文对话样本对比候选模型 |
