# Vaultwarden Offline

完全离线的密码库浏览器插件。**无账户、无同步、不发起任何网络请求。**

数据来自 Bitwarden / Vaultwarden 的导出文件，导入后以 Bitwarden 同款密文格式存放在浏览器本地，
可随时导出回 Vaultwarden —— 数据不被锁死在本插件里。

---

## 构建

```bash
npm install
npm run build          # Chrome / Edge / Opera (MV3) → dist/
npm run build:firefox  # Firefox (MV3 事件页) → dist/
```

## 加载到浏览器

**Chrome / Edge**
1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择项目下的 `dist/` 目录

**Firefox**
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时载入附加组件」，选择 `dist/manifest.json`

## 其它命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 仅调试 popup UI 的热更新服务（不含扩展运行时能力） |
| `npm run check` | TypeScript 类型检查 |
| `npm run check:svelte` | Svelte 组件类型检查 |
| `npm test` | 单元测试 |
| `npm run icons` | 重新生成图标 PNG |
| `npm run verify:offline` | 对 `dist/` 单独跑零网络校验 |

## 自动填充测试页

`test/pages/` 下有一组自建页面，覆盖常见的表单排版模式（标准 label、纯 placeholder、
表格排版、Shadow DOM、iframe、动态插入、隐藏陷阱、支付表单）。

```bash
npx serve test/pages     # 或任意静态服务器
```

打开任一页面后，用插件的 **设置与数据 → 自动填充 → 检测当前页面字段** 查看采集结果。
`test/pages/index.html` 列出了每一页的预期结果。

用 `file://` 直接打开也可以，但 iframe 与 Shadow DOM 页在部分浏览器下受限，建议起本地服务器。

---

## 离线保证是怎么做到的

不是"我们不写网络请求"这种口头承诺，而是三道机制：

1. **运行时封锁** —— manifest 的 CSP 里写死 `connect-src 'none'`，扩展页面与
   service worker 发起任何 fetch/XHR/WebSocket 都会被浏览器直接拒绝。
2. **构建时校验** —— `scripts/check-no-network.mjs` 扫描**打包产物**（不是源码），
   命中 `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `importScripts` 即构建失败。
   扫产物意味着第三方依赖夹带的网络调用同样会被拦下。
3. **无远程资源** —— 站点图标本地生成（不请求 icons.bitwarden.net），词表与 WASM 全部
   打进包内，运行期不存在任何"按需下载"。

content script 运行在宿主页面的 CSP 下、不受第 1 条约束，第 2 条正是为它兜底。

### 唯一的网络例外：站点 favicon

获取站点真实图标是**用户明确豁免**的例外，不视为违反零网络承诺：

- **站点优先**：借助当前标签页 content script 做同源 fetch（同源无需 CORS），
  优先 `<link rel="icon">` 声明的地址，失败再猜 `/favicon.ico`
- **失败回退**：Google s2 favicon 服务（`www.google.com/s2/favicons`），
  带 CORS、几乎 100% 可用；代价是域名会发送给 Google
- **再回退**：DuckDuckGo icons（`icons.duckduckgo.com/ip3/{域名}.ico`，
  大陆可达性更好，无重定向）
- **失败冷却**：整条链路失败后 6 小时内不再重试（避免反复打不可达的网络），
  成功即清除冷却
- 获取时机：新增条目时、站点匹配出现时（静默获取并更新缓存）
- 缓存：storage.local，键 `vwo:favicons:{域名}`；图标显示时先查缓存，
  未缓存回退到本地首字母色块

CSP 与构建期校验对图标服务做了对应放行：`connect-src` 仅多
`www.google.com`（s2 接口）、`t1.gstatic.com`（Google favicon 重定向后的静态资源域）
与 `icons.duckduckgo.com`（DuckDuckGo 回退源）。

---

## 架构

```
src/
├── background/     背景 service worker（MV3，随时可能被回收）
├── content/        注入宿主页面的脚本，打成自包含 IIFE
├── popup/          Svelte 5 扩展页面
├── platform/       浏览器 API 抽象层 + 消息总线 + 日志
└── core/           与浏览器无关的领域逻辑
    ├── crypto/     加解密（Phase 1）
    ├── state/      存储键与状态定义
    ├── vault/      条目模型与仓储（Phase 2）
    └── ...
```

### 三条硬性纪律

1. **业务代码禁止直接调用 `chrome.*` / `browser.*`**，一律走 `src/platform/browser-api.ts`。
   唯一例外是 content script —— 它需要极小的注入体积，不引平台层。
2. **监听器必须通过 `addListener()` 注册并在销毁时注销**。Safari 不会自动回收 popup
   上下文的监听器，不注销就是内存泄漏。
3. **背景页不在模块作用域持有长期状态**。MV3 的 service worker 随时会被杀掉，
   所有需要跨事件存活的东西一律进 `storage.session`。

### 密钥层级（与 Bitwarden 一致）

```
主密码 ──KDF(PBKDF2-600k 或 Argon2id)──▶ MasterKey(32B)
                                            │
                                    HKDF-Expand(enc/mac)
                                            ▼
                                     StretchedKey(64B)
                                            │
                                   解开包裹密文得到
                                            ▼
                                       UserKey(64B = 32B enc ‖ 32B mac)
                                            │
                            AES-256-CBC + HMAC-SHA256 逐字段加密
                                            ▼
                                      条目明文
```

条目可携带自己的 `key`（per-cipher key），此时项内字段用该密钥而非 UserKey 加密。

---

## 开发进度

- [x] **Phase 0** 项目脚手架
- [x] **Phase 1** 加密核心
- [x] **Phase 2** 存储层与锁定状态机
- [x] **Phase 3** 导入导出
- [x] **Phase 4** Popup UI 与条目增删改查
- [x] **Phase 5** 自动填充引擎
  - [x] 页面字段采集（含 Shadow DOM、跨 iframe）
  - [x] 填充执行（绕过框架值追踪器）
  - [x] 字段匹配启发式（autocomplete → 关键词 → 位置兜底）
  - [x] 右键菜单填充
  - [x] 保存 / 更新凭据提示条
  - [x] 快捷键 `Ctrl+Shift+L` 填充上次使用的登录项
  - [ ] **内联菜单浮层**（输入框聚焦时的下拉选择）—— 暂缓，工作量最大的一块，
        需要时再实现（参考 Bitwarden 的 overlay 模块，约 3600 行）
- [x] **Phase 6** 生成器 / TOTP
  - [x] 密码生成（长度/字符集/最少数量/剔除歧义字符，无偏随机）
  - [x] 密码短语（内置词表，词数/分隔符/首字母大写/数字后缀可配）
  - [x] 用户名生成（形容词 + 名词 + 数字）
  - [x] TOTP 动态码（RFC 6238 官方向量验证，含 Steam 5 字符码）
  - [x] 编辑页生成按钮、详情页动态码 + 倒计时 + 复制
  - [x] 新增菜单支持「新增目录」（下拉内输入名称创建）
  - [x] 站点真实 favicon 自动获取与缓存（站点同源优先、失败回退 Google s2，
        新增/匹配时静默获取；条目图标未缓存时回退首字母色块。
        这是零网络承诺的唯一例外，见下方说明）

#### Phase 6 后续完善（参考 Bitwarden 生成器）

- [x] 生成参数面板：长度、字符集、剔除歧义字符可在生成器 tab 中调节
- [x] 密码短语参数化 UI：词数、分隔符、首字母大写、数字后缀

以下项**暂不考虑实现**（如需恢复，先评估价值与成本）：

- 熵估算与强度指示
- EFF 官方词表（当前为自制常见单词表；EFF 词表需联网获取，可构建期打包）
- 词表选择（EFF long / short）、大小写模式（每词大写 / 全小写 / 全大写）
- 用户名随机字串型
- 用户名子地址 / catchall（`user+tag@domain`，可离线实现）
- 生成历史（加密存储、可清空）
- 生成器可嵌入任意自定义字段

（转发邮箱别名 SimpleLogin / AnonAddy 等**需联网，明确不做**）

完整功能范围见 [docs/FEATURES.md](docs/FEATURES.md)。

---

## 安全提示

明文导出文件（`bitwarden_export_*.json`）含真实密码，已在 `.gitignore` 中排除，
**不要提交进版本库**，用完请安全删除。
