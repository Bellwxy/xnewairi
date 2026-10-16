# 账号隔离持久化清单

本文配合 [阶段 0 SPEC](./account-data-isolation-spec.md) 使用。
状态：初步静态清单。命名基础已实现，运行时隔离尚未启用。
本轮未迁移、删除或重命名用户数据。

第二批增加 `account-startup` 与 `account-migration` 服务，尚未接入应用入口。
迁移测试使用独立测试浏览器，覆盖 localStorage、IndexedDB、localforage 和 OPFS。
原 `unstorage` 的 base 不是数据库名，实际旧库为 `keyval-store/keyval`，迁移从该库读取。

## 第一批实施

已实现 `packages/stage-shared/src/account-scope/index.ts`：

- 按账号生成 localStorage 键、IndexedDB 数据库名和 Web Lock 名称。
- 使用精确的设备键白名单。未知键默认属于账号，不按宽泛前缀放行。
- 只有缺失的指针选择 `local`。空值和非法指针报错。
- 作用域实例不可切换身份。旧实例始终保留原账号的名称。
- 模块无导入副作用，不读取认证状态，也不自动启动迁移。

第三批已修改 `useLocalStorageManualReset` 与 `useVersionedLocalStorage`，并新增 `useAccountLocalStorage`。
第四至第六批已接入认证切换、桌面主进程与删除账号数据，见 SPEC 的实施进度。

## 第三批接入

| 存储 | 接入方式 |
| --- | --- |
| `@vueuse/core` 的 `useLocalStorage`，25 个文件 | 改为 `useAccountLocalStorage` |
| 直接读写 localStorage，13 个文件 | 键名经过 `accountStorageKey` |
| `database/storage.ts` 的两个挂载 | 显式设置 `airi-local@<account>` 与 `airi-sync-queue@<account>` |
| `airi-chat-assets`、`airi-stickers` | `createAccountLocalForage`，写锁名称加账号后缀 |
| 默认 localforage：显示模型、两个背景 store、MMD 动作 | `accountDefaultLocalForage` |
| Live2D 与 MMD 的 OPFS 缓存 | `getAccountOpfsRoot`，`clearAll` 不再清除公共模型缓存 |
| 启动屏读取语言 | 读取当前账号的 `settings/language` |
| `testing-audio` 与 Electron 场景 | Node 侧计算账号键名后传入页面 |

`apps/component-calling` 与 `apps/ui-server-auth` 没有账号，保持原样。
BroadcastChannel 不落盘。切换账号时所有窗口重新加载，所以通道名不加账号后缀。

## 分类与遗漏补充

| 存储位置 | 目标作用域 | 后续处理 |
| --- | --- | --- |
| `airi/account/current` | 设备 | 启动时读取，切换完成前不得更新 |
| `auth/v1/*` 的现有令牌与 OIDC 流程键 | 设备 | 当前命名模块仅放行已检查的精确键 |
| `settings/audio/input` | 设备 | 仅设备选择共用，`enabled` 按账号隔离 |
| `airi:debug:pinia-tracing`、`airi:openpanel-device-id` | 设备 | 保持现有名称 |
| 角色卡、供应商密钥、引导、语言、模块配置 | 账号 | 同时处理 composable 与直接读写 |
| `packages/ui` 的 `useColorMode` | 设备 | 模块加载时读取，无账号的应用也使用。已列入设备白名单 |
| `keyval-store/keyval` 中的 `airi-local:`、`airi-sync-queue:` 键 | 账号 | 显式指定新数据库名，旧聊天按索引和记录归属迁移 |
| `airi-chat-assets`、`airi-stickers` | 账号 | 资源与引用一起迁移，不能只移动聊天索引 |
| 默认 localforage 中的显示模型、背景、MMD 动作 | 账号 | 三类数据使用同一默认实例，需统一替换 |
| Live2D 与 MMD 的 OPFS 解压目录 | 账号 | 属于导入的用户资源，不是公共模型缓存 |
| `airi-model-assets`、`transformers-cache` | 设备 | 公共推理模型缓存保持共享 |
| `artistry-options.json`、`home-assistant-v1.json` | 账号 | 包含供应商密钥与家庭服务令牌 |
| `server-channel-config.json` 与 WebSocket PEM 文件 | 账号 | 配置之外还有证书和私钥文件 |
| `mcp.json` | 账号 | 直接通过文件 API 写入，绕过 createConfig |
| `extensions-v1.json` 与托管插件目录 | 账号 | 插件配置和导入文件需一起处理 |
| `godot-stage/models` | 账号 | 导入模型在主进程物化，需同步切换与清理 |
| `app-options.json` | 账号 | 含语言、快捷键，不能因名称含 app 就设备共用。已迁入账号目录 |
| `app-config.json`、`chat-window-config.json`、字幕和 widgets 窗口位置 | 设备 | 逐字段复核，仅窗口布局共用 |
| IO 跟踪、更新日志、公共模型下载 | 设备 | 共用不代表日志不含隐私内容，删除范围需告知用户 |

账号命名不能隔离内存中的跨窗口通信。
Pinia 同步、背景 BroadcastChannel 和模型广播也必须在切换协议中停止或按账号划分。
Electron 主进程长期存活，不能只重载渲染窗口而保留旧账号的服务实例。

## 静态候选文件

以下表格逐项列出本轮搜索命中的 108 个文件。
它包括存储封装、读写者和部分仅引用存储 API 的文件，不代表 108 个数据库。
“账号”表示目标归属，不表示隔离已生效。
主进程直接文件写入和 OPFS 的补充位置见前表。
此搜索不能证明动态键、第三方内部缓存和原生插件存储全部覆盖。

| 文件 | 目标作用域 |
| --- | --- |
| `apps/stage-pocket/src/components/permissions/permissions-panel.vue` | 原生权限为设备，存储调用需复核 |
| `apps/stage-pocket/src/modules/i18n.ts` | 账号 |
| `apps/stage-pocket/src/pages/devtools/notifications.vue` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/components/InteractiveArea.vue` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/composables/use-language.ts` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/host-context/locale.ts` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/modules/i18n.ts` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/pages/notice/fade-on-hover.vue` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/stores/controls-island.ts` | 账号 |
| `apps/stage-tamagotchi-kirie/src-web/src/renderer/stores/settings/server-channel.ts` | 账号 |
| `apps/stage-tamagotchi/src/main/configs/artistry.ts` | 账号 |
| `apps/stage-tamagotchi/src/main/configs/global.ts` | 账号 |
| `apps/stage-tamagotchi/src/main/configs/io-trace-recording.ts` | 设备 |
| `apps/stage-tamagotchi/src/main/libs/electron/persistence.ts` | 按配置分类 |
| `apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts` | 账号 |
| `apps/stage-tamagotchi/src/main/services/airi/home-assistant/index.ts` | 账号 |
| `apps/stage-tamagotchi/src/main/services/airi/plugins/host/config.ts` | 账号 |
| `apps/stage-tamagotchi/src/main/windows/caption/index.ts` | 窗口布局为设备，其他字段复核 |
| `apps/stage-tamagotchi/src/main/windows/chat/index.ts` | 窗口布局为设备，其他字段复核 |
| `apps/stage-tamagotchi/src/main/windows/dashboard/index.ts` | 窗口布局为设备，其他字段复核 |
| `apps/stage-tamagotchi/src/main/windows/main/index.ts` | 窗口布局为设备，其他字段复核 |
| `apps/stage-tamagotchi/src/main/windows/widgets/index.ts` | 窗口布局为设备，其他字段复核 |
| `apps/stage-tamagotchi/src/renderer/App.vue` | 账号 |
| `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` | 账号 |
| `apps/stage-tamagotchi/src/renderer/composables/use-danmaku-feed-settings.ts` | 账号 |
| `apps/stage-tamagotchi/src/renderer/composables/use-language.ts` | 账号 |
| `apps/stage-tamagotchi/src/renderer/composables/use-push-to-talk-shortcut.ts` | 账号 |
| `apps/stage-tamagotchi/src/renderer/modules/i18n.ts` | 账号 |
| `apps/stage-tamagotchi/src/renderer/pages/chat-floating.vue` | 账号 |
| `apps/stage-tamagotchi/src/renderer/pages/notice/fade-on-hover.vue` | 账号 |
| `apps/stage-tamagotchi/src/renderer/stores/controls-island.ts` | 账号 |
| `apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts` | 账号 |
| `apps/stage-web/src/modules/i18n.ts` | 账号 |
| `packages/stage-layouts/src/components/Widgets/ChatActionButtons.vue` | 账号 |
| `packages/stage-layouts/src/components/Widgets/ChatArea.vue` | 账号 |
| `packages/stage-layouts/src/stores/background.ts` | 账号 |
| `packages/stage-shared/src/account-scope/index.ts` | 统一命名入口 |
| `packages/stage-shared/src/composables/use-local-storage-manual-reset/index.ts` | 统一转换入口 |
| `packages/stage-shared/src/composables/use-versioned-local-storage-manual-reset/index.ts` | 统一转换入口 |
| `packages/stage-shared/src/composables/use-versioned-local-storage/index.ts` | 统一转换入口 |
| `packages/stage-shared/src/stores/screen-ambient-light.ts` | 账号 |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` | 账号 |
| `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` | 账号 |
| `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` | 账号 |
| `packages/stage-ui-live2d/src/stores/expression-store.ts` | 账号 |
| `packages/stage-ui-live2d/src/stores/model-parameters.ts` | 账号 |
| `packages/stage-ui-live2d/src/stores/view-control.ts` | 账号 |
| `packages/stage-ui-live2d/src/utils/opfs-loader.ts` | 账号 |
| `packages/stage-ui-mmd/src/stores/mmd.ts` | 账号 |
| `packages/stage-ui-mmd/src/stores/view-control.ts` | 账号 |
| `packages/stage-ui-mmd/src/utils/opfs-loader.ts` | 账号 |
| `packages/stage-ui-spine/src/stores/spine.ts` | 账号 |
| `packages/stage-ui-spine/src/stores/view-control.ts` | 账号 |
| `packages/stage-ui-tachie/src/stores/tachie.ts` | 账号 |
| `packages/stage-ui-three/src/stores/camera.ts` | 账号 |
| `packages/stage-ui-three/src/stores/model-store.ts` | 账号 |
| `packages/stage-ui-three/src/stores/view-control.ts` | 账号 |
| `packages/stage-ui/src/components/modules/WebSearch.vue` | 账号 |
| `packages/stage-ui/src/components/scenarios/chat/components/voice-composer.vue` | 账号 |
| `packages/stage-ui/src/components/scenarios/chat/components/voice-input-button.vue` | 账号 |
| `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` | 账号 |
| `packages/stage-ui/src/database/repos/chat-assets.repo.ts` | 账号 |
| `packages/stage-ui/src/database/repos/stickers.repo.ts` | 账号 |
| `packages/stage-ui/src/database/storage.ts` | 账号 |
| `packages/stage-ui/src/features/motions/live2d/settings.ts` | 账号 |
| `packages/stage-ui/src/libs/auth-client.ts` | 设备 |
| `packages/stage-ui/src/libs/auth-oidc.ts` | 设备 |
| `packages/stage-ui/src/libs/home-assistant/exposure.ts` | 账号 |
| `packages/stage-ui/src/libs/inference/model-assets-opfs.ts` | 设备 |
| `packages/stage-ui/src/libs/inference/transformers-cache.ts` | 设备 |
| `packages/stage-ui/src/libs/pinia/pinia-plugin-tracing.ts` | 设备 |
| `packages/stage-ui/src/libs/product-signals/openpanel.ts` | 设备 |
| `packages/stage-ui/src/libs/providers/providers/sherpaw/index.ts` | 账号 |
| `packages/stage-ui/src/stores/auth.ts` | 设备 |
| `packages/stage-ui/src/stores/background.ts` | 账号 |
| `packages/stage-ui/src/stores/display-models.ts` | 账号 |
| `packages/stage-ui/src/stores/feature-flags.ts` | 账号 |
| `packages/stage-ui/src/stores/mcp.ts` | 账号 |
| `packages/stage-ui/src/stores/mods/api/channel-server.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/airi-card.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/artistry.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/consciousness-settings.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/consciousness.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/discord.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/gaming-module-factory.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/hearing.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/home-assistant.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/speech.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/stickers.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/twitter.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/vision/processing-store.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/vision/store.ts` | 账号 |
| `packages/stage-ui/src/stores/modules/web-search.ts` | 账号 |
| `packages/stage-ui/src/stores/onboarding.ts` | 账号 |
| `packages/stage-ui/src/stores/providers/config.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/analytics.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/audio-device.ts` | 设备选择为设备，启用状态为账号 |
| `packages/stage-ui/src/stores/settings/beat-sync.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/controls-island.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/developer.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/general.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/spine.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/stage-model.ts` | 账号 |
| `packages/stage-ui/src/stores/settings/theme.ts` | 账号 |
| `packages/stage-ui/src/stores/speech-output-control.ts` | 账号 |
| `packages/stage-ui/src/stores/wake-words.ts` | 账号 |
| `packages/stage-ui/stories/modules/i18n.ts` | 账号 |
| `packages/ui/src/composables/use-theme.ts` | 设备 |

## 角色大脑新增入口

角色大脑 SPEC v3.2 的 2.1 至 2.3 新增以下持久化入口，全部属于账号作用域。

| 文件 | 存储 | 目标作用域 |
| --- | --- | --- |
| `packages/stage-ui/src/database/repos/character-memory.repo.ts` | IndexedDB `airi-character-memory` 与 `airi-character-memory-vectors`，已登记在 `ACCOUNT_DATABASE_NAMES` | 账号 |
| `packages/stage-ui/src/stores/memory/memory-settings.ts` | localStorage `settings/memory/*` | 账号 |
| `packages/stage-ui/src/stores/character/state.ts` | localStorage `character-state/*` | 账号 |
| `packages/stage-ui/src/stores/character/proactive.ts` | localStorage `settings/proactive-care/*` 与 `proactive-care/*` | 账号 |

锁名称与 BroadcastChannel 名称都通过 `lockName` 带上账号 ID。

## 启用前的检查点

1. 完成动态键、默认实例、OPFS 与主进程文件的实际写入审计。
2. 给迁移增加中断恢复测试，保留原数据直至目标写入完成。
3. 在应用模块求值前固定作用域，避免顶层 composable 提前读取旧键。
4. 将全部写入入口接入停止与排空流程，包括主进程节流保存。
5. 区分认证失败与主动退出，离线时保留账号指针。
6. 完成桌面全窗口重载与安卓重载验证。
7. 增加持久化入口清单检查，新增入口未声明归属时使测试失败。

本批次测试只覆盖命名与身份快照，不覆盖以上运行时行为。


## 第五批：主进程

| 位置 | 作用域 | 接入方式 |
| --- | --- | --- |
| `app-options.json`、`artistry-options.json`、`home-assistant-v1.json`、`server-channel-config.json`、`extensions-v1.json` | 账号 | `createConfig` 声明 `owner: 'account'` |
| `mcp.json`、`extensions/v1`、`godot-stage`、`computer-use`、WebSocket PEM 文件 | 账号 | 改用 `accountDataPath` |
| `app-config.json`、`chat-window-config.json`、字幕与 widgets 窗口配置、`io-trace-recording-options.json` | 设备 | `createConfig` 声明 `owner: 'device'` |
| `logs`、`io-traces`、`model-assets` | 设备 | 保持原路径 |
| `account-current.json`、`account-migration-v1.json` | 设备 | 新增。记录当前账号与迁移完成状态 |

macOS 上，每个账号的 WebSocket 根证书会分别加入钥匙串。
