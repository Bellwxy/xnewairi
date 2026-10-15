# 账号数据隔离 SPEC

日期：2026-10-14。源码基线：`8bb0b4a` 加当前工作区改动。状态：提案，尚未实施。版本：v1。

本文定义客户端按账号隔离数据的规则。它是 [角色表现力与角色大脑 SPEC](./character-expressiveness-and-brain-spec.md) 的前置阶段。

## 一 目标与已确认的决定

**目标**：每个账号拥有独立的角色、记忆、设置、密钥与本地资源。一个账号不能读取或修改另一个账号的数据。

以下决定已由用户确认：

| 事项 | 决定 |
| --- | --- |
| 使用场景 | 每个客户使用自己的设备。同一设备切换账号是低频操作 |
| 未登录数据 | `local` 是一个独立身份。登录后看不到它的数据，也不迁移 |
| 供应商配置与密钥 | 按账号隔离 |
| 跨设备 | 首版数据只保存在本设备。不新增服务端存储 |

**不在范围内**：

- 同一系统用户下的安全隔离。能访问设备文件的人仍能读取 IndexedDB、localStorage 与配置文件。
- 密钥加密。密钥仍以明文保存，与现状相同。加密属于后续独立功能。
- 新增跨设备同步。现有的角色卡云同步与聊天云同步保持现状，它们已按账号运行。

## 二 现状核实

| 主题 | 源码事实 | 依据 |
| --- | --- | --- |
| 账号身份 | `userId` 来自联网取回的 `user`，未登录或未取回时为 `local` | `packages/stage-ui/src/stores/auth.ts:86` |
| 启动顺序 | 先读本地令牌，再联网取会话。取回前 `userId` 一直是 `local` | `auth.ts:246-309` |
| 取会话失败 | `requestAuthSession` 返回空值时调用 `clearAuthState`，清空全部令牌 | `auth.ts:301-307` |
| 聊天会话 | 已按账号分区，键为 `local:chat/index/${userId}` | `database/repos/chat-sessions.repo.ts:47` |
| 角色卡 | 整台设备共用，键为 `airi-cards` 与 `airi-card-active-id` | `stores/modules/airi-card.ts:96-97` |
| 供应商密钥 | 整台设备共用，键为 `settings/credentials/providers` 等 | `stores/providers/config.ts` |
| 模块设置 | 约 200 个 `useLocalStorage` 键，分布在 12 个工作区 | `stage-ui` 占 31 个文件 |
| 统一入口 | 36 个文件使用 `useLocalStorageManualReset` | `packages/stage-shared/src/composables/use-local-storage-manual-reset/` |
| 直接读写 | 部分代码直接调用 `localStorage`，例如认证、引导与意识模块设置 | `auth.ts:16-53`、`stores/onboarding.ts`、`stores/modules/consciousness-settings.ts` |
| IndexedDB | `unstorage` 挂载 `airi-local` 与 `airi-sync-queue`。`localforage` 保存聊天资源、贴纸、显示模型与背景 | `database/storage.ts`、`chat-assets.repo.ts`、`stickers.repo.ts`、`stores/display-models.ts`、`stores/background.ts` |
| 主进程配置 | `createConfig` 在 `userData` 下写 JSON 文件，共 10 个 | `apps/stage-tamagotchi/src/main/libs/electron/persistence.ts:36` |
| 主进程密钥 | `artistry-options.json` 保存 Replicate 与 Nano Banana 密钥。`home-assistant-v1.json` 保存令牌 | `main/configs/artistry.ts`、`main/services/airi/home-assistant/index.ts` |
| 跨窗口状态 | 桌面端多个渲染窗口通过同步的 Pinia 共享状态，由 leader 执行写入命令 | `stores/chat.ts:266`、`apps/stage-tamagotchi/src/renderer/App.vue:135` |

## 三 设计

### 3.1 默认按账号隔离

所有持久化数据默认属于账号作用域。只有下表列出的数据属于设备作用域。
新增持久化数据时，如果未列入设备作用域，就必须使用账号作用域。

| 设备作用域 | 原因 |
| --- | --- |
| 当前账号指针 `airi/account/current` | 启动时需要先读取它，才能确定账号作用域 |
| 认证令牌 `auth/v1/*` 与 OIDC 流程状态 | 令牌决定当前账号，不能放在账号作用域内 |
| 窗口位置、尺寸、置顶与工作区可见性 | 与设备显示器相关 |
| 音频输入设备选择 | 与设备硬件相关 |
| 下载的公共模型权重与推理缓存，例如 `model-assets` | 内容与账号无关，共享可节省空间 |
| 日志、IO 跟踪与更新通道 | 用于诊断设备问题 |
| 产品统计的设备标识 | 描述设备，不描述账号 |

界面语言与主题暂定为账号作用域。实现时如果用户反馈切换不便，再调整。

### 3.2 当前账号指针

- 新增设备作用域的键 `airi/account/current`，值为账号 ID 或 `local`。它不是密钥。
- 渲染进程在创建 Pinia 之前同步读取它，并确定账号作用域。此后整个页面生命周期内，作用域不再变化。
- 登录成功并取回 `user` 后，写入新的账号 ID，然后执行 3.5 的重新加载流程。
- 用户主动退出后，写入 `local`，然后重新加载。
- 离线启动或取会话失败时，保持指针不变。界面显示"需要重新登录"，不切换到 `local`。
- 只有用户主动退出或确认切换账号时，指针才会变化。令牌被服务端拒绝不会改变指针。

上一条需要修改 `clearAuthState` 的调用方式。凭证被拒绝时清空令牌，但保留指针与账号数据。

### 3.3 存储命名规则

账号 ID 先经 `encodeURIComponent` 编码，下文记为 `<account>`。

| 存储 | 账号作用域的写法 |
| --- | --- |
| localStorage | 键加前缀 `account/<account>/`。例如 `account/u123/settings/speech/rate` |
| unstorage 的 IndexedDB 挂载 | 数据库名加后缀。例如 `airi-local@<account>` |
| localforage 实例 | `name` 加后缀。例如 `airi-stickers@<account>` |
| 主进程 `createConfig` | 账号作用域的文件放到 `userData/accounts/<account>/` 下 |
| Web Lock 名称 | 加账号后缀，避免不同账号的锁互相等待 |

实现方式：

- 在 `packages/stage-shared` 中新增账号作用域模块。它提供当前作用域和键名转换函数。
- `useLocalStorageManualReset` 在内部转换键名，调用方不改。
- 直接调用 `localStorage` 的代码改用同一个键名转换函数。
- 设备作用域的键在模块中集中声明。转换函数遇到这些键时不加前缀。
- 主进程通过 eventa 合约接收当前账号。合约放在 `apps/stage-tamagotchi/src/shared`。
- 主进程的 `createConfig` 增加作用域参数。设备作用域的配置文件保持原路径。

### 3.4 `local` 身份与旧数据

- `local` 使用与其他账号相同的命名规则，前缀为 `account/local/`。
- 升级后首次启动时，把现有的无前缀数据视为 `local` 的数据，移动到 `local` 作用域。
- 旧版聊天索引已按账号 ID 保存。属于真实账号的聊天记录移动到该账号的作用域。
- 迁移只执行一次，完成后写入设备作用域的迁移标记。迁移代码用 `// NOTICE:` 标明删除条件。
- 迁移中断时，下次启动从头重做。每一步按"先复制，后删除"执行，重复执行不会丢数据。

### 3.5 切换账号的流程

1. 认证流程确定新的账号 ID。
2. 停止当前账号的后台任务，例如记忆提炼、主动关怀、角色卡同步与聊天云同步。
3. 等待本地写入队列完成。超过 5 秒仍未完成时，提示用户，并由用户选择等待或强制切换。
4. 写入 `airi/account/current`。
5. 通知主进程切换账号作用域。
6. 重新加载全部渲染窗口。安卓重新加载 WebView 页面。
7. 新页面按新作用域启动。首次进入的账号显示引导流程。

切换期间不允许发送消息。重新加载前的请求按现有取消逻辑处理。

### 3.6 删除账号的本地数据

账号设置页提供"删除此设备上的账号数据"。它删除该账号作用域下的全部本地数据，包括 IndexedDB、localStorage 前缀键和主进程目录。
它不删除服务端数据，不删除设备作用域的数据，也不能删除当前正在使用的账号。

## 四 改动边界

| 位置 | 改动 |
| --- | --- |
| `packages/stage-shared` | 新增账号作用域模块、设备作用域清单与键名转换。修改 `useLocalStorageManualReset` |
| `packages/stage-ui/src/database/` | `storage.ts` 与各 repo 按作用域打开数据库 |
| `packages/stage-ui/src/stores/` | 直接读写 `localStorage` 的 store 改用键名转换。`auth.ts` 维护账号指针 |
| `packages/stage-ui-*` | 各渲染器设置使用统一入口，通常无需改动 |
| `apps/stage-tamagotchi/src/main` | `createConfig` 增加作用域。切换账号时重新加载窗口 |
| `apps/stage-tamagotchi/src/shared` | 新增账号作用域的 eventa 合约 |
| `apps/stage-pocket` | 启动顺序与重新加载流程 |
| `packages/stage-pages` | 账号设置页增加"删除此设备上的账号数据" |

实施前必须完整列出现有的持久化位置，并逐项标记作用域。本文第二节的数字来自静态搜索，可能有遗漏。

## 五 验收

- 账号 A 创建角色、配置密钥并聊天。退出后登录账号 B，看不到 A 的角色、密钥、聊天、记忆与设置。
- 切换回 A 后，A 的数据完整保留。
- 未登录时创建的数据只在 `local` 下可见。登录任何账号后都看不到它。
- 升级前已有的数据在升级后归入 `local`，旧账号的聊天归入对应账号。迁移重复执行不丢数据。
- 账号 A 登录后离线启动，界面仍显示 A 的数据，并提示重新登录。不会切换到 `local`。
- 桌面端多个窗口同时打开时切换账号，所有窗口都重新加载到新账号。
- 切换账号时如果提炼任务正在执行，旧账号的结果不会写入新账号。
- 删除账号 B 的本地数据后，账号 A 的数据不变。
- 新增一个未声明作用域的持久化键时，单元测试能检测到。
- 键名转换、设备作用域清单与迁移步骤有单元测试。

## 六 待决策事项

1. 界面语言与主题的作用域。本文暂定为账号作用域。
2. 迁移是否保留。当前没有外部客户。如果确认没有需要保留的本地数据，可以跳过迁移，直接从空状态开始。
3. 第 3.5 节第 3 步的等待时间。本文暂定 5 秒。

## 七 未验证内容

- 没有运行测试或类型检查。持久化位置的数量来自静态搜索。
- `better-auth` 的 `getSession` 在网络错误时的返回值未核实。第 3.2 节的离线规则依赖这个行为。
- 安卓 WebView 重新加载页面后，同步 Pinia 与 Capacitor 插件的初始化顺序未验证。
- 桌面端重新加载全部窗口时，leader 选举与窗口恢复的顺序未验证。
