# Live2D 模型来源调研

- 日期：2026-10-14
- 状态：调研完成，待选择模型。本文不改变运行时代码。
- 付费解锁：方向已确认，暂不开发。未来方案见第 7 节。
- 范围：为 AIRI 查找可本地导入的 Live2D 角色。来源限定为 Live2D 官方网站和 Live2D 官方 GitHub 仓库。

## 1. 结论

- Live2D 官方提供免费 Cubism sample data。官方页面说明这些数据用于 Cubism Editor 学习和 Cubism SDK 集成测试。[官方样例总览](https://www.live2d.com/en/learn/sample/)
- 推荐先试四个模型：Niziiro Mao、Haru、Mark-kun 和 Rice Glassfield。Hiyori Momose 已是 AIRI 的默认角色。Ren Foster 是较新的高配置样例，放在备选列表。
- 官方页面的 `runtime` 文件集包含 `.model3.json`、`.moc3`、贴图和动作文件。AIRI 的 Live2D 导入入口接收 ZIP。导入时只打包 `runtime` 文件，不要把 `.cmo3`、`.can3` 或 PSD 当作运行时模型。[AIRI 导入格式](../../../packages/i18n/src/locales/en/settings.yaml#L118-L124)
- 官方 GitHub 样例仓库列出 `Haru`、`Hiyori`、`Mao`、`Mark`、`Ren`、`Rice`、`Wanko` 和 `Natori` 目录。下面的候选模型都可从第一方仓库取得运行时文件。[仓库许可说明](https://github.com/Live2D/CubismWebSamples/blob/develop/LICENSE.md) [运行时目录](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources)

## 2. 候选模型

| 模型 | 外观和动作特点 | 官方下载页 | 官方运行时目录 | AIRI 建议 |
| --- | --- | --- | --- | --- |
| Niziiro Mao | 正面角色。脸部活动范围大。支持 Blend Shape、颜色效果、表情和魔法效果。 | [Mao](https://www.live2d.com/en/learn/sample/niziiro-mao/) | [Mao runtime](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Mao) | 首选。适合 AI 角色和口型驱动。 |
| Haru | 支持换臂、换衣、物理、姿势、表情和动作。页面还提供语音文件。 | [Haru](https://www.live2d.com/en/learn/sample/haru/) | [Haru runtime](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Haru) | 首选。角色动作丰富。 |
| Mark-kun | 卡通男性角色。结构简单。支持眨眼、物理和动作。 | [Mark-kun](https://www.live2d.com/en/learn/sample/mark/) | [Mark runtime](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Mark) | 首选。体积和功能较容易检查。 |
| Rice Glassfield | 侧身战斗游戏风格。使用反向遮罩、扩展补间、物理和碰撞检测。 | [Rice](https://www.live2d.com/en/learn/sample/rice-glassfield/) | [Rice runtime](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Rice) | 备选。侧身构图不一定适合常驻助手。 |
| Hiyori Momose | Cubism 3.0 标准模型。头发使用 Skinning。支持物理、姿势、碰撞检测和动作。 | [Hiyori](https://www.live2d.com/en/learn/sample/momose-hiyori/) | [Hiyori runtime](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Hiyori) | 当前默认角色。适合作为基线。 |
| Ren Foster | Cubism 5.3 角色。使用透明混合、离屏绘制、Blend Shape 和多种遮罩功能。官方说明它需要较高配置。 | [Ren](https://www.live2d.com/en/learn/sample/ren-foster/) | [Ren runtime](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Ren) | 备选。先确认 AIRI 的渲染性能。 |

官方样例页面还列出 `Natori`。它属于 Collaboration Character。官方条款禁止商业使用、改动和再分发，因此不把它列入 AIRI 首选。[角色条款](https://www.live2d.com/en/learn/sample/model-terms/)

## 3. AI 和发布许可

- Live2D 官方 FAQ 明确说明，遵守各项使用条款时，AI avatar、chat-interface 和 concierge 等 AI 内容可以使用 Cubism Editor、Cubism SDK 和 sample models。[AI 内容 FAQ](https://help.live2d.com/en/other/other_33/)
- 这不是对所有用途的单独授权。官方 FAQ 同时禁止侵权训练数据，以及以损害 2D 创作者创造力为主要用途的应用、服务或其他派生作品。
- 本文列出的六个模型都在 Live2D Original Character 列表中。一般用户和最近会计年度销售额低于 1000 万日元的小规模企业，可以在同意 Free Material License Agreement 和角色条款后进行商业或非商业创作。[样例角色条款](https://www.live2d.com/en/learn/sample/model-terms/) [Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)
- 作品必须包含官方要求的版权说明。模型页面还禁止使角色表现为成人、色情、暴力或猎奇内容。AIRI 角色的回复、语音和动作必须避开这些表现。[角色条款](https://www.live2d.com/en/learn/sample/model-terms/)
- Free Material License Agreement 限制原始素材的再分发。建议用户从 Live2D 官方页面下载并在 AIRI 的设置中本地导入。不要把官方原始 ZIP 提交到 AIRI 仓库或建立公共模型下载包。

## 4. 运行时打包检查

1. 从官方页面下载模型包，或从官方 GitHub 对应目录取得文件。
2. 只保留一个角色的运行时目录。目录内必须有一个 `.model3.json`、对应的 `.moc3` 和其引用的贴图。
3. 保留 `.motion3.json`、`.exp3.json`、`.physics3.json` 和 `.pose3.json` 等被 `.model3.json` 引用的文件。
4. 将运行时目录压缩为一个 ZIP。不要把多个角色放在同一个 ZIP。
5. 在 AIRI 的角色模型选择器中导入 ZIP。AIRI 会检查模型设置文件、MOC 文件和引用路径。[Live2D ZIP 校验器](../../../packages/stage-ui-live2d/src/utils/live2d-validator.ts#L302-L386)

## 5. 预览图

- [Niziiro Mao 预览图](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-niziiromao.jpg)
- [Haru 预览图](https://www.live2d.com/wp-content/uploads/2026/06/sample-img-haru.jpg)

## 6. 未完成项

- 本次未下载或实测这些模型。渲染兼容性、内存占用和动作触发仍需在目标 AIRI 端验证。
- 官方下载按钮使用动态页面。若页面提供完整 Cubism 工程包，必须从包内选择 `runtime` 文件夹，不要直接导入只含 `.cmo3` 或 PSD 的包。

## 7. 角色付费解锁方向（暂不开发）

- 记录日期：2026-10-14。
- 决策：采用“账号购买权益 + 私有模型下载”的方向。
- 当前范围：只记录方案。不新增付费界面、接口、数据库迁移、支付配置或资源迁移。
- 启动条件：用户明确要求开发后，再确定产品规则并编写实施 ADR。本文不是实施授权。

### 当前基础

- 客户端内置 Hiyori Pro 和 Hiyori Free。默认模型是 `preset-live2d-1`。`Pro` 名称不代表付费权益。
- 内置模型 ZIP 随客户端资源发布。现有模型选择和加载流程没有购买权益检查。
- 后端已有角色数据、支付结算和私有对象存储。现有支付结算主要发放 Flux，不等于角色解锁。
- 代码入口：[模型目录](../../../packages/stage-ui/src/stores/display-models.ts)、[模型加载](../../../packages/stage-ui/src/stores/settings/stage-model.ts)、[支付结算](../../../server/apps/api/src/services/domain/payment/index.ts)、[对象存储](../../../server/apps/api/src/services/adapters/object-store.ts)。

### 未来实现边界

1. 分开管理商品、角色、模型版本、订单和用户权益。购买使用权益不改变角色的 `ownerId`。
2. 由服务端确定商品价格。支付平台通知通过验签和订单检查后，服务端在数据库事务内记录支付与权益。
3. 使用数据库唯一约束防止重复发放。支付成功页面不能直接解锁。
4. 将付费模型放入私有存储。下载接口检查账号权益后，再返回短期下载地址。
5. 角色公开详情只返回展示信息。不通过模型配置暴露付费资源的永久地址。
6. 在统一模型加载流程接入权益状态。覆盖选择器、角色卡激活和启动恢复，不只限制按钮。
7. 按账号隔离权益和缓存。退出或切换账号时，清除内存权益、下载地址和已加载的受限角色。
8. 保留本地模型导入。官方商品模型与用户导入模型使用不同来源标识。

### 限制与待定项

- 客户端渲染必须取得模型数据。加密不能保证模型不被复制，本地导入也不能构成防复制边界。
- 下载地址过期不能收回已下载文件。退款和拒付必须有权益撤销规则。
- 收费前必须检查角色素材的商业分发授权，以及 Cubism SDK 许可。仓库包含素材不代表允许收费分发。
- 首版候选方案是单角色永久解锁、绑定账号和跨设备恢复。这些产品规则尚未最终确定。
- 待确定：出售完整角色还是仅出售 Live2D 外观，首发平台、支付渠道、离线使用、退款和版本更新政策。
- 若包含移动端发行，先检查目标地区和应用商店的数字商品支付规则。
- 开发前补充测试计划。重点覆盖重复支付通知、并发购买、退款撤销、未购买下载、账号切换和跨设备恢复。
