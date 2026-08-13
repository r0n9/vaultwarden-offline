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
- [ ] **Phase 5** 自动填充引擎
- [ ] **Phase 6** 生成器 / TOTP

完整功能范围见 [docs/FEATURES.md](docs/FEATURES.md)。

---

## 安全提示

明文导出文件（`bitwarden_export_*.json`）含真实密码，已在 `.gitignore` 中排除，
**不要提交进版本库**，用完请安全删除。
