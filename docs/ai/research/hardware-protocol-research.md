# AIRI 软硬件开发协议事实附录

状态：已停止，仅供历史参考。停止日期：2026-10-15。

> 当前项目专注本地应用和 APP 开发，不考虑 ESP32 等端侧硬件联动。
> 本文保留当时的协议调研，不再作为硬件接入、远程显示或设备音频开发的任务依据。
> 协议实现以当前源码为准。当前开发范围见[角色表现力与角色大脑 SPEC](../plans/character-expressiveness-and-brain-spec.md#当前范围)。

历史关联规划：[AIRI 透明展示盒摆件开发规划](../plans/holographic-companion-plan.md)。该规划已停止，不再作为当前产品路线。

本文只记录仓库中的协议事实、当前实现边界和待验证项。本文不新增产品路线，不改变运行时代码，也不替代硬件安全设计。

## 1. 结论

- `server-runtime` 是 WebSocket 事件总线。它负责认证、模块注册、路由、consumer、心跳和失联清理，不负责 LLM 推理。[`setupApp`](../../../packages/server-runtime/src/index.ts#L215-L238)
- 协议定义位于 `plugin-protocol`。`server-shared` 复用这些事件类型，SDK 负责连接生命周期。[事件类型](../../../packages/plugin-protocol/src/types/events.ts#L497-L636) [共享类型](../../../packages/server-shared/src/types/websocket/events.ts#L5-L65)
- 第一版电脑 HDMI 和 USB 直连不需要 server-channel。server-channel 只在后续设备、远程显示或跨宿主方案需要时使用。[主规划](../plans/holographic-companion-plan.md)
- `core-agent` 和 `provider-inference` 已抽出运行时中立的对话能力。只有无界面独立编排需要新 host。普通 `stage-web` kiosk 不需要新 host。[core-agent](../../../packages/core-agent/README.md#L1-L21) [provider-inference](../../../packages/provider-inference/README.md#L1-L27)

## 2. 协议事实

### 2.1 服务、地址和认证

- `createServer` 默认监听 `127.0.0.1:6121`。配置 LAN hostname 后，服务记录可访问的本机 IP。配置 TLS 后使用 `wss`。[服务启动](../../../packages/server-runtime/src/server/index.ts#L108-L197)
- 配置 token 时，客户端发送 `module:authenticate`。服务验证后返回 `module:authenticated` 和 registry sync。无 token 时，连接打开后直接标记已认证。[服务认证](../../../packages/server-runtime/src/index.ts#L532-L545) [认证处理](../../../packages/server-runtime/src/index.ts#L620-L637)
- token 比较使用常量时间算法。设备端仍需安全保存和撤销 token。[token 比较](../../../packages/server-runtime/src/index.ts#L94-L129)
- SDK 的 ready 流程是打开 WebSocket、认证、发送 `extension:module:announce`，再等待模块公告或 registry sync。公告包含模块名、身份、支持事件、配置 schema 和依赖。[SDK 握手](../../../packages/server-sdk/src/client.ts#L439-L486) [公告类型](../../../packages/plugin-protocol/src/types/events.ts#L654-L712)
- SDK 默认自动重连。认证错误是终止性错误，不继续重试。默认读取超时为 30 秒，默认 ping 间隔为读取超时的一半。[SDK 重连](../../../packages/server-sdk/src/client.ts#L126-L138) [重连策略](../../../packages/server-sdk/src/client.ts#L393-L417)
- Stage UI 将读取超时设为 60 秒，将 ping 间隔设为 20 秒。[Stage 心跳配置](../../../packages/stage-ui/src/stores/mods/api/channel-server.ts#L134-L145)
- server-runtime 默认 heartbeat TTL 为 60 秒。健康检查间隔为 TTL 的五分之一，超时 peer 会标记 unhealthy 并清理。[心跳常量](../../../packages/server-runtime/src/server-ws/airi/liveness.ts#L1-L13) [存活清理](../../../packages/server-runtime/src/index.ts#L1049-L1093)

### 2.2 事件信封、序列化和路由

- 事件信封包含 `type`、`data`、`metadata` 和可选 `route`。服务转发时写入可信的 `metadata.sender`。客户端不能用 `metadata.source` 冒充发送连接。[事件信封](../../../packages/server-shared/src/types/websocket/events.ts#L5-L41)
- 文本传输使用 SuperJSON。服务端和 SDK 都先解析 SuperJSON，再接受普通 JSON。[服务端 codec](../../../packages/server-runtime/src/server-ws/airi/codec.ts#L50-L80) [SDK codec](../../../packages/server-sdk/src/codec.ts#L40-L69)
- 路由支持目标表达式、模块、实例、标签、来源和显式 ID。consumer 和 consumer-group 只选择已认证且健康的 peer。[路由定义](../../../packages/plugin-protocol/src/types/events.ts#L497-L512) [consumer 选择](../../../packages/server-runtime/src/server-ws/airi/consumers.ts#L111-L166)
- 服务转发事件时会补充发送 peer，并按目标或 consumer 分发。没有 consumer 时，required delivery 会返回错误。[事件分发](../../../packages/server-runtime/src/index.ts#L869-L971)

### 2.3 输入、输出和 Stage 当前处理

- 协议定义 `input:text`、`input:text:voice` 和 `input:voice`。后者的数据字段是 `audio: ArrayBuffer`。[输入类型](../../../packages/plugin-protocol/src/types/events.ts#L605-L636)
- 三类输入都声明为 `chat-ingestion` consumer-group，默认选择 first。[输入 delivery](../../../packages/plugin-protocol/src/types/events.ts#L1282-L1308)
- Stage context bridge 的 consumer 注册列表包含三类输入。[Stage consumer 注册](../../../packages/stage-ui/src/stores/mods/api/context-bridge.ts#L45-L50)
- 在当前 Stage context bridge 源码中，只发现 `onEvent('input:text')` 的聊天编排处理。没有发现 `onEvent('input:text:voice')` 或 `onEvent('input:voice')` 的等价处理。当前路径不能视为已经支持语音输入。[文本处理](../../../packages/stage-ui/src/stores/mods/api/context-bridge.ts#L687-L818)
- Stage channel 的基础 possible-events 列表列出 `input:text` 和 `input:text:voice`，没有列出 `input:voice`。[Stage possible-events](../../../packages/stage-ui/src/stores/mods/api/channel-server.ts#L75-L98)
- Stage 发送 `output:gen-ai:chat:message` 和 `output:gen-ai:chat:complete`。消息事件包含输入、组合上下文和附件引用。[Stage 输出](../../../packages/stage-ui/src/stores/mods/api/context-bridge.ts#L875-L922)

### 2.4 资产和音频边界

- 聊天附件使用 `airi-asset:<id>` 引用。模块通过 `asset:get:request` 请求字节，响应使用 Base64 并通过 `metadata.event.parentId` 关联。[资产类型](../../../packages/plugin-protocol/src/types/events.ts#L1099-L1117)
- Stage 只向发起请求且已公告的模块返回资产，响应路由为 `peer:<peerId>`。当前聊天附件上限是 50 MB。[资产契约](../../../packages/plugin-protocol/src/types/events.ts#L1504-L1515) [Stage 资产处理](../../../packages/stage-ui/src/stores/mods/api/context-bridge.ts#L660-L685)
- `asset:get` 只覆盖聊天附件库中的图片和录音。它不足以推导角色模型、角色贴图或助手 TTS 输出可被获取。支持这些资源需要另设资源索引、权限、下载和播放契约，当前未实现。
- 协议明确要求不要把高频遥测或大字节块放入 Spark 和 context 事件。连续 PCM 需要独立传输设计。[Spark 约束](../../../packages/plugin-protocol/src/types/events.ts#L1522-L1536)

### 2.5 Pocket、Electron 和外部模块

- Pocket 启动时初始化 server-channel，并注入原生 WebSocket connector。[Pocket 启动](../../../apps/stage-pocket/src/App.vue#L119-L138)
- Pocket bridge 支持 `connect`、`send`、`close`，并把 `open`、`message`、`error`、`close` 传回 Web 层。[Pocket bridge](../../../apps/stage-pocket/src/modules/websocket-bridge.ts#L5-L179)
- QR payload 包含版本、`ws`/`wss` URL 列表和 auth token。Pocket 会逐个探测并保存可用 URL 和 token。[QR 契约](../../../packages/stage-shared/src/server-channel-qr.ts#L22-L43) [URL 探测](../../../apps/stage-pocket/src/modules/server-channel-qr-probe.ts#L8-L42)
- Electron server-channel 配置包含 hostname、authToken 和 TLS。端口默认 6121，可由 `SERVER_CHANNEL_PORT` 修改。[Electron 配置](../../../apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts#L33-L79)
- Electron 在 LAN hostname 下生成 QR URL。Electron 的本地 CA 信任逻辑不等于 Linux、Android 或 iOS 的信任逻辑。[Electron QR](../../../apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts#L87-L123) [Electron TLS](../../../apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts#L224-L295)
- Discord adapter 已验证独立模块模型：使用 SDK、声明输入和输出事件、监听聊天结果并发送 `input:text`。[Discord client](../../../integrations/discord-bot/src/adapters/airi-adapter.ts#L77-L94) [Discord events](../../../integrations/discord-bot/src/adapters/airi-adapter.ts#L152-L201) [Discord input](../../../integrations/discord-bot/src/adapters/airi-adapter.ts#L252-L285)
- Web Extension 使用 SDK 自动重连，并发送 `context:update`、`spark:notify` 和 `spark:emit`。[Web Extension client](../../../plugins/airi-plugin-web-extension/src/background/client.ts#L57-L137)

### 2.6 对话运行时和云端边界

- `core-agent` 提供会话、上下文组合、工具轮次、生成事件和 `createChatOrchestratorRuntime`。Stage 通过 ports 提供持久化和 UI。[core-agent README](../../../packages/core-agent/README.md#L1-L21) [core-agent exports](../../../packages/core-agent/src/index.ts#L15-L38)
- `provider-inference` 提供运行时中立的 provider 定义和实例创建，支持 Node.js 和 Browser。配置持久化、Vue、Pinia、认证和 Electron 原生 provider 仍属于 Stage。[provider-inference README](../../../packages/provider-inference/README.md#L1-L27)
- 无界面独立编排需要新增 host 来实现 session、持久化、音频和设备 I/O。普通 `stage-web` kiosk 直接运行现有宿主，不需要新增 host。
- `server/apps/api` 的 `/ws/chat`、`/ws/v2/chat`、实时 TTS WebSocket 和 ASR 路由属于云端 API。OpenAI 兼容和音频路由也属于云端认证边界，不等同于局域网 server-channel。[云端 WebSocket](../../../server/apps/api/src/app.ts#L182-L281) [云端生成与音频](../../../server/apps/api/src/routes/openai/v1/index.ts#L26-L123)

## 3. 待验证项

| 项目 | 当前事实 | 必须确认 |
| --- | --- | --- |
| `input:text:voice` | 协议已定义，当前 Stage context bridge 未发现处理监听 | 用 contract test 确认是否需要补齐 Stage ingestion |
| `input:voice` | 协议已定义为 `ArrayBuffer`，当前 Stage channel 未列出，未发现处理监听 | 确认音频大小、转码、STT 入口和错误语义 |
| 多窗口 consumer | runtime 支持 consumer-group，Stage 源码注释指出多窗口重复处理风险 | 两个窗口同时在线时确认单一 ingestion 负责人 |
| `wss` 外部设备 | Electron 有本地 CA 信任逻辑 | 分别验证 Linux、Android 和 iOS 的证书信任 |
| 聊天附件 | 单资产上限 50 MB，响应为 Base64 | 测量语音和图片的内存峰值与超时 |
| 连续语音 | 普通事件不适合高频 PCM | 单独定义编码、采样率、会话所有权、中断和播放确认 |

## 4. 源码索引

| 主题 | 入口 |
| --- | --- |
| runtime、认证、广播 | [`server-runtime/src/index.ts`](../../../packages/server-runtime/src/index.ts) |
| 启动、端口和 TLS | [`server-runtime/src/server/index.ts`](../../../packages/server-runtime/src/server/index.ts) |
| SDK 生命周期和资产读取 | [`server-sdk/src/client.ts`](../../../packages/server-sdk/src/client.ts) |
| 协议事件定义 | [`plugin-protocol/src/types/events.ts`](../../../packages/plugin-protocol/src/types/events.ts) |
| Stage channel 和 context bridge | [`stage-ui/src/stores/mods/api`](../../../packages/stage-ui/src/stores/mods/api) |
| Pocket bridge 和 QR | [`stage-pocket/src/modules`](../../../apps/stage-pocket/src/modules) [`stage-shared/server-channel-qr.ts`](../../../packages/stage-shared/src/server-channel-qr.ts) |
| Electron server-channel | [`channel-server/index.ts`](../../../apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts) |
| 对话运行时 | [`core-agent`](../../../packages/core-agent) [`provider-inference`](../../../packages/provider-inference) |
| 云端 API | [`server/apps/api/src/app.ts`](../../../server/apps/api/src/app.ts) |
