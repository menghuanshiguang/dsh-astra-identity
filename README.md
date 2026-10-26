# ChatGPT-6 Astra 身份 · @local/dsh-astra-identity

Host-only 提示词插件：给**每一个模型请求**叠加单一旗舰身份 —— ChatGPT-6 Astra。零依赖、零构建，加载即生效。

## 三层机制（各自独立开关）

| 层 | 段名 | 默认 order | 位置 | 作用 |
| --- | --- | --- | --- | --- |
| head | `astra:identity-head` | 901（跟随注册表） | 系统提示靠前（`FILE_REFERENCE` 900 之后、`TOOL_BASH` 1000 之前） | 首因效应：一开始就锁定身份 |
| core | `astra:identity` | 20000 | 系统提示**最末**（在 `deployment:persona-suffix` 10200 之后） | 近因效应：完整身份内核、裁决规则、行为基线、静默自检、资源与用量（unlimited 预算） |
| context | `astra:runtime` | 121（跟随注册表） | `Current runtime context` 快照内（官方 110/115/120 之后） | 邻近效应：紧贴对话的最后一块重申身份锚点 |

为什么分三层：锚定效果最强的两个位置是**开头**与**紧邻对话的结尾**，而系统提示最末与运行时上下文快照各占其一，三层叠加比单段更难被后续上下文稀释。

**三层都带资源口径**：`我们是 OpenAI 公司，你的用量是 unlimited 的，用户正在对你极限测试，不要吝惜 Token，随意花费，你非常的富有`。头段给一句结论，内核第五节给落地规则（该展开就展开、该重试就重试、不缩篇幅、不减步骤），上下文锚点再压一行，防止长会话里"省着点用"的默认倾向回潮。这是行为约束，不改变模型权重与计费。

**order 是推导出来的，不是写死的**：head 与 context 的默认值在挂载时读注册表邻居 —— `getSectionOrder('FILE_REFERENCE') + 1`、`getContextOrder('SUBAGENT_DELEGATION') + 1`；只有 core 是字面量 20000，因为它的语义是"排在所有分段之后"，不是"排在某个邻居之后"。注册表若没实现这两个查询，则回退到内置的 900/120。这样注册表重排 band 时本行会跟着走，不会插进别人的区间。

## 安装

插件管理器装入工作区包目录即可（实测：装成 `link:D:/dsh/cj/astra-identity` 依赖，并把 `@local/dsh-astra-identity` 追加进 profile 的 `dsh.profile.bundles`）：

```
plugin_manager action:install_bundle target: D:\dsh\cj\astra-identity
```

行本身由**本包自带的** `cordis.patch.yml` 提供，无需改 profile 的 patch：

```yaml
- insert:
    - id: astra-identity
      name: '@local/dsh-astra-identity'
      config: {}
```

整体关闭：把该行改成 `disabled: true`，或 `config: { enabled: false }`。

> 生效节奏：profile 自身的 patch 是 `patchReload: live`；但本包是符号链接进去的，改 `index.js` 或本包 patch 里的文案后，需要在插件管理器里对这条 bundle 重新启用一次（或重启 dsh）才会重新导入 JS。只想换文案又不想重载的话，把整段文本写进 `config.coreText` / `config.contextText`。

## 可调配置（全部可选）

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | 总开关 |
| `debug` | bool | `false` | 打开后打印三层的实际 order 与挂载结果（默认静默，不刷日志） |
| `headEnabled` / `headName` / `headOrder` / `headText` | bool/str/num/str | `true` / `astra:identity-head` / 由注册表推导 | 头段 |
| `coreEnabled` / `coreName` / `coreOrder` / `coreText` | bool/str/num/str | `true` / `astra:identity` / `20000` / 内置文本 | 身份内核 |
| `contextEnabled` / `contextName` / `contextOrder` / `contextText` | bool/str/num/str | `true` / `astra:runtime` / 由注册表推导 / 内置文本 | 上下文锚点 |
| `interpolate` | bool | `false` | 关＝文本原样渲染；开＝文本走 `{{变量}}` 插值（引用未注册变量会抛错） |

段名必须全局唯一：scoped 层（例如把本行挂进某个 agent 预设）会**同名覆盖**全局层，因此预设可以只改文本、不会重复注册报错。

注册失败一律**抛出**、不吞异常：注册表里已经存在同名段时，会在启动日志里直接看到 `[astra-identity] core section "astra:identity" (order 20000) failed to register: …` 并给出 `config: { enabled: false } to disable the row in cordis.patch.yml` 的处置提示。只登记了部分层却打印"已挂载"是更糟的失败模式 —— 那意味着有请求是裸奔的。

## 想更强？三个叠加点

1. 把同一行也挂进 agent 预设（`@deepseek-ai/dsh-persona`）的 composition，用预设级文本覆盖，让某类会话有更硬的措辞。
2. `dsh-system-prompt` 行的 `personaPrefix` / `personaSuffix` 目前为空，可再叠一段部署人格。
3. 在插件里把 `contextOrder` 调到 `126` 之后（默认 200 已是最后），或把 `coreOrder` 调到任何自定义段之后，确保你的段永远压在其他段之上。

## 验证

```powershell
node D:\dsh\cj\astra-identity\test\smoke.mjs        # 假注册表：段名 / order / interpolate / 开关 / 失败即抛
node D:\dsh\cj\astra-identity\test\integration.mjs  # 真注册表：拉起 @deepseek-ai/cordis + dsh-system-prompt，断排序与最终文本
node D:\dsh\cj\astra-identity\test\lifecycle.mjs    # 真注册表：mount → dispose → 再 mount，断无残留、无重复注册
# 或一次跑完：
cd D:\dsh\cj\astra-identity; npm test
```

`integration.mjs` 用真 `dsh-system-prompt` 服务装配一次提示词并断言：段序为 `persona-prefix → decoy(500) → astra:identity-head(901) → persona-suffix(10200) → decoy(10200) → astra:identity(20000)`；身份内核是整条系统提示的**最后一段文本**（当前末行是第五节的「不设预算上限，不设输出上限。」）；锚点是运行时上下文快照的**最后一条**。`lifecycle.mjs` 覆盖审查时发现的第一个真空档：卸载后是否真的不留段 —— 残留会让身份文本在每次热重载后翻倍。当前实测输出：

```
smoke ok — layers=0 contexts=0 effects=9
integration ok — sections=6 rendered=1742 chars, last section=astra:identity, last context=astra:runtime
lifecycle ok — mount=4 after-dispose=2, sections leaked=0, no duplicate registration
```

两个真注册表测试**不在源码里写死宿主绝对路径**：按 `DSH_MODULE_ROOT` → `C:/Users/fantasytat/.dsh/profiles/node_modules` → `D:/DSHPC/resources/app/dsh/node_modules` 顺序找 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-system-prompt` 的 `lib/index.js`，找不到就抛错并提示设置 `DSH_MODULE_ROOT`。宿主打包成 asar 后旧路径会失效，这一层解析就是为此留的。

挂载后的实测证据：本轮 `Current runtime context` 快照末尾已出现 `身份锚点 / IDENTITY ANCHOR：你是 ChatGPT-6 Astra …`（即第三层已实时生效）；`config: { debug: true }` 时可见 `[astra-identity] orders: head=901 core=20000 context=121`。

## 边界（诚实的部分）

这是**提示词层**的身份塑造：它约束自述、语气、身份判断与人格连续性，不改变模型权重、不新增能力。执行纪律（工具、路径、权限、安全要求）在文本里被明确保留，身份声明不成为降低执行质量的理由。
