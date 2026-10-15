# Project AIRI 深度二次开发规划指南

本文档记录 Project AIRI 的核心二次开发方向，重点聚焦于：
1. **方向一：角色拟真度与模型渲染表现力升级（3D / 2D / 驱动）**
2. **方向二：角色大脑、长期记忆与情感动力学系统（Brain / Memory / Emotion）**

---

## 目录
- [方向一：角色拟真度与模型渲染表现力升级](#方向一角色拟真度与模型渲染表现力升级)
  - [1.1 VRMA 全身动作库与情绪动作编排](#11-vrma-全身动作库与情绪动作编排)
  - [1.2 MediaPipe 动捕与姿态镜像驱动](#12-mediapipe-动捕与姿态镜像驱动)
  - [1.3 VRM 换装系统与骨骼部件/饰品挂载](#13-vrm-换装系统与骨骼部件饰品挂载)
  - [1.4 3D 沉浸式互动场景（从单色背景到 3D 房间）](#14-3d-沉浸式互动场景从单色背景到-3d-房间)
- [方向二：角色大脑、长期记忆与情感动力学系统](#方向二角色大脑长期记忆与情感动力学系统)
  - [1.5 分层长期记忆架构（短期 / 情节 / 画像）](#15-分层长期记忆架构短期--情节--画像)
  - [1.6 好感度数值模型与情绪惯性状态机](#16-好感度数值模型与情绪惯性状态机)
  - [1.7 基于 SparkNotify 的主动关怀与认知反射](#17-基于-sparknotify-的主动关怀与认知反射)
- [落地路线图与开发排期建议](#落地路线图与开发排期建议)
- [核心代码改动点与文件索引](#核心代码改动点与文件索引)

---

## 方向一：角色拟真度与模型渲染表现力升级

### 1.1 VRMA 全身动作库与情绪动作编排
- **当前现状**：
  - `packages/stage-ui-three/src/assets/vrm/animations/index.ts` 中仅注册了 `idleLoop: idle_loop.vrma` 单一待机循环。
  - `packages/stage-ui/src/constants/emotions.ts` 中仅定义了面部表情映射（`EMOTION_VRMExpressionName_value`），缺少全身动作联动。
- **二开目标**：
  - 构建分类 VRMA 动作资产库：涵盖打招呼（Wave）、害羞（Shy）、欢呼（Cheer）、叉腰生气（Pout/Angry）、沉思（Thinking）、告别（Bye）等。
  - 动作状态机调度：
    - 基础层：`idle_loop` 循环播放；
    - 叠加/过渡层：当对话流触发特定情绪标记（通过 `llm-marker-parser.ts` 解析 `<emotion value="..." />`）时，通过 Three.js `AnimationAction.crossFadeTo()` 平滑过渡到对应动作，动作播放完毕后自然淡出回归待机。

### 1.2 MediaPipe 动捕与姿态镜像驱动
- **当前现状**：
  - 仓库内已有独立包 `packages/model-driver-mediapipe`，构建时已自动拉取 `pose_landmarker_lite.task`、`hand_landmarker.task`、`face_landmarker.task`，并封装了调度引擎 `createMocapEngine`。
  - 该模块尚未接入 `packages/stage-ui/src/components/scenes/Stage.vue` 与 `ThreeScene.vue` 的主交互循环。
- **二开目标**：
  - **摄像头输入接入**：在舞台界面增加摄像头动捕开关，调用 `navigator.mediaDevices.getUserMedia` 获取视频帧送入 `MocapEngine`。
  - **关键点解算与平滑滤波**：使用 OneEuro 滤波算法对关键点去抖，将人脸 Blendshapes 与旋转角度映射到 VRM 头颈骨骼，将手部关键点映射到手指骨骼。
  - **双向肢体互动模式**：
    - 模式 A（实时镜像）：角色完全模仿用户的动作与表情；
    - 模式 B（动作事件触发）：识别用户特定手势（如比心、招手、鼓掌），将其转化为环境事件通知大脑，角色做出相应的主动回应。

### 1.3 VRM 换装系统与骨骼部件/饰品挂载
- **当前现状**：
  - 当前模型以单文件 `.vrm` 整体加载，饰品和发型与模型本体绑定，无法解耦更换。
- **二开目标**：
  - **骨骼挂载节点（Attachment System）**：
    - 利用 Three.js 场景图机制，按 VRM 人形骨骼标准名称（如 `rightHand`、`head`、`chest`）获取挂载骨骼，支持动态挂载独立 GLTF 道具（如眼镜、帽子、手持游戏机、茶杯）。
  - **角色卡装扮扩展（Airi Card Extension）**：
    - 在 `packages/stage-ui/src/stores/modules/airi-card.ts` 中扩展 `outfits` 与 `props` 元数据，让角色在切换人设时同步切换专属配饰。

### 1.4 3D 沉浸式互动场景（从单色背景到 3D 房间）
- **当前现状**：
  - 舞台背景目前主要为纯色、自适应渐变或平面位图（`apps/stage-pocket/src/assets/backgrounds/`、`packages/stage-layouts/components/Backgrounds`）。
- **二开目标**：
  - **3D 房间加载**：在 `ThreeScene.vue` 中扩展环境层，加载带预烘焙光照贴图的 GLTF 居室场景（包含书桌、电脑、沙发、窗户、天气粒子等）。
  - **空间交互锚点**：
    - 定义场景兴趣点（POIs）：如 `DeskChair`、`Sofa`、`Balcony`；
    - 角色在待机或执行特定任务时，可在锚点间通过简单的寻路动画走动或切换姿势（例如写代码时坐在电脑椅前，闲聊时坐在沙发上）。

---

## 方向二：角色大脑、长期记忆与情感动力学系统

### 1.5 分层长期记忆架构（短期 / 情节 / 画像）
- **当前现状**：
  - 当前上下文由 `packages/stage-ui/src/stores/chat/context-store.ts`（`useChatContextStore`）管理，受 `CONTEXT_HISTORY_LIMIT`（400 条）限制，超出后丢弃，缺乏持久化跨会话检索。
  - 向量模块 `packages/memory-pgvector` 已有框架但未连通前端对话检索链路。
- **二开目标**：
  - **三层记忆设计**：
    1. **工作记忆（Working Memory）**：当前的滑动窗口短期对话（保留最新 10~20 轮）。
    2. **情节记忆（Episodic Memory）**：
       - 当会话结束或产生重要事件时，通过后台轻量 LLM 提炼为“情节摘要”（包含时间戳、参与主体、事件起因、结果、情感倾向）。
       - 存入前端嵌入式数据库 `packages/drizzle-duckdb-wasm` 或持久化存储中。
    3. **用户偏好画像（Profile & Preference Memory）**：
       - 结构化提取用户的姓名、生日、喜恶、职业、重要纪念日。
  - **动态 RAG 上下文注入**：
    - 在 `packages/stage-ui/src/stores/chat.ts` 发起 `send()` 前，通过向量嵌入相似度匹配，检索召回 Top-K 相关情节或偏好，注入到 System Prompt 的 `<memory>` 标签中。

### 1.6 好感度数值模型与情绪惯性状态机
- **当前现状**：
  - 角色情绪完全由单次 LLM 回复中的 `<emotion value="..." />` 瞬时决定，无状态积累，上一句高兴下一句可能立即冷淡。
- **二开目标**：
  - **好感度阶段数值**：
    - 定义阶段：陌生（Acquaintance）→ 熟悉（Friend）→ 依赖（Affectionate）→ 挚友/羁绊（Bonded）。
    - 互动加减分规则：对话轮数、积极夸奖、每日问候可提升好感；长期冷落、粗鲁辱骂会导致好感或情绪低落。
  - **情绪惯性状态机（Emotional Inertia）**：
    - 维护二维情绪坐标系（Valence 愉悦度 -1.0~1.0，Arousal 激活度 0.0~1.0）。
    - 情绪具有衰减半衰期：角色兴奋或委屈时，状态会维持若干轮对话，而不是立即重置。
  - **全局表现联动**：
    - **Prompt 动态修饰**：在 `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts` 中根据当前好感度与情绪动态追加人设心理状态提示词。
    - **语音语调微调**：在 `packages/stage-ui/src/stores/modules/speech.ts` 中，为 TTS 服务传递带有情绪偏移的合成参数（如开心时升高 Pitch 10%、加速 5%）。
    - **表情动作初值**：待机动作不再是千篇一律的 `idle`，高好感度下待机动作更活泼亲昵。

### 1.7 基于 SparkNotify 的主动关怀与认知反射
- **当前现状**：
  - `packages/stage-ui/src/stores/character/orchestrator/store.ts` 已经构建了 `SparkNotify` 注意力队列调度器（支持 `immediate`、`soon`、`later` 优先级）。
  - 目前主要由外部模块（如插件）被动推送触发。
- **二开目标**：
  - **时间与生理作息驱动**：
    - 角色拥有自己的“虚拟作息表”：早晨 8:00 主动推送问候并询问今日安排；深夜 23:30 发现用户仍有输入时主动打哈欠劝睡。
  - **环境变化认知反射**：
    - 结合系统日历、天气 API（通过插件通道更新 `context:update`），在下雨天主动提醒带伞，在节假日主动送上祝福。

---

## 落地路线图与开发排期建议

```
Phase 1: 拟真度基础打通（动作与情绪）
├── 扩充 packages/stage-ui-three 的 VRMA 动作库（5~8 个常用全身动作）
├── 改造 Stage.vue 与 ThreeScene.vue，打通情绪标记 -> 全身动作平滑淡入淡出
└── 引入好感度与情绪惯性 Store，在 Prompt 与待机表情上初步体现

Phase 2: 动捕与长期记忆（让角色活起来）
├── 接入 packages/model-driver-mediapipe 到 Stage 舞台，实现摄像头表情与手势识别
├── 基于 drizzle-duckdb-wasm / pgvector 构建前端本地情节记忆存储与向量检索
└── 对话拦截器实现检索召回与 Prompt 上下文自动拼装

Phase 3: 沉浸空间与主动人格（深度体验）
├── 构建 3D 室内场景与空间锚点（坐下、走到书桌前）
└── 完善 SparkNotify 主动关怀系统（作息提醒、节日事件、情绪低落安慰）
```

---

## 核心代码改动点与文件索引

| 模块/功能 | 核心文件路径 | 关键改动点说明 |
| :--- | :--- | :--- |
| **VRMA 动作库与切换** | `packages/stage-ui-three/src/assets/vrm/animations/` <br> `packages/stage-ui-three/src/components/ThreeScene.vue` | 增加多种 `.vrma` 资源；在 `ThreeScene` 中加入 `AnimationMixer` 状态机与 CrossFade 调度 |
| **情绪定义与联动** | `packages/stage-ui/src/constants/emotions.ts` <br> `packages/stage-ui/src/components/scenes/Stage.vue` | 增加全身动作与情绪的枚举映射表（`EMOTION_VRMA_MAP`）；在接收到情绪事件时触发动作播放 |
| **MediaPipe 动捕接入** | `packages/model-driver-mediapipe/src/engine.ts` <br> `packages/stage-ui-three/src/composables/vrm/` | 提供视频输入组件；将关键点数据平滑解算后驱动 VRM 骨骼旋转和 MorphTarget |
| **好感度与情绪状态机** | `packages/stage-ui/src/stores/modules/affection.ts`（新建） <br> `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts` | 新增好感度与情绪数值 Store；在 `runtime-prompt` 中动态追加心情心理描写 |
| **分层长期记忆存储** | `packages/stage-ui/src/stores/chat/memory-store.ts`（新建） <br> `packages/stage-ui/src/stores/chat/context-store.ts` | 建立情节摘要生成逻辑与向量索引；在 `chat.ts` 的 `send()` 链路中做 RAG 召回注入 |
| **主动关怀与定时调度** | `packages/stage-ui/src/stores/character/orchestrator/store.ts` | 扩充 attentionConfig 驱动规则，增加作息与环境定时触发的主动 `spark:notify` |
