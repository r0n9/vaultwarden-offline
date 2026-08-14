# Vaultwarden Offline

完全离线的密码库浏览器插件。**无账户、无同步、不发起任何网络请求。**

数据来自 Bitwarden / Vaultwarden 的导出文件，导入后以 Bitwarden 同款密文格式存放在浏览器本地，
可随时导出回 Vaultwarden —— 数据不被锁死在本插件里。

> [English](README.en.md) · 中文

---

## 特性

- **完全离线** —— 无账户、无同步、无遥测；数据只存在你的设备上
  （唯一例外：站点 favicon 获取，见[零网络保证](#零网络保证)）
- **与 Bitwarden / Vaultwarden 100% 格式互通** —— 密文格式、导出文件可直接导回
- **本地加密** —— AES-256-CBC + HMAC-SHA256（与 Bitwarden 一致），主密码 / PIN 解锁
- **自动填充全链路** —— 表单采集（含 Shadow DOM / iframe）、字段判定、填充执行、
  右键菜单、快捷键 `Ctrl+Shift+L`、保存/更新提示条、站点匹配排序
- **生成器与 TOTP** —— 密码 / 密码短语 / 用户名生成；动态验证码（RFC 6238 官方向量验证，含 Steam 码）
- **完整的条目管理** —— 8 种条目类型、文件夹、回收站、搜索与筛选、收藏、密码历史、条目级复验
- **站点真实 favicon** —— 静默获取并缓存，未缓存时回退本地首字母色块

## 适用场景

**完全离线版**适合这些情况：

- **隐私敏感**：不想让任何密码数据（哪怕加密状态）离开自己的设备，不想依赖任何云端服务
- **断网 / 弱网环境**：内网、出差、网络受限地区——插件全功能本地运行，不需要服务器
- **从 Bitwarden / Vaultwarden 迁移**：导出文件直接导入，密文格式互通，随时可导出回去
- **受监管 / 高安全要求**：不允许数据出内网的环境，或用开源方案替换商业闭源工具
- **极简主义者**：无账户、无同步、无遥测——不注册、不登录、打开即用

不适合的情况：需要在多设备间**自动同步**、需要**团队共享**、需要**在线找回密码**（忘记主密码时无法恢复，这正是离线版的代价）。

## 为什么选择开源离线版（安全与隐私）

- **代码可审计**：整个项目开源（GPL-3.0），加密、存储、网络行为全部可查——不依赖"我们很安全"的承诺
- **格式可验证**：密文格式与 Bitwarden 官方一致（AES-256-CBC + HMAC-SHA256），可与其他实现互验，不存在黑盒
- **零遥测**：无统计上报、无崩溃回传；唯一的网络调用是站点 favicon 获取（见[零网络保证](#零网络保证)），可审计、可关闭
- **密钥不出设备**：主密码、PIN、UserKey 全部在本地派生与使用，服务端（如果有）也看不到密钥
- **可移植**：随时导出回 Vaultwarden / Bitwarden，不被任何平台绑架

## 快速开始（无需构建）

1. 打开 [Releases 页](https://github.com/r0n9/vaultwarden-offline/releases)
2. 下载对应浏览器的 zip（Chrome/Edge/Opera 用 `-chrome.zip`，Firefox 用 `-firefox.zip`）
3. 解压到本地目录
4. **Chrome / Edge**：打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择解压目录
   **Firefox**：打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择解压目录下的 `manifest.json`

> Firefox 的临时加载在重启浏览器后失效，需重新加载；Chrome 的已解压模式持续有效。
> 如果你偏好手动构建，见下一节。

## 构建（开发者）

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

打开任一页面后，用插件的 **设置 → 自动填充 → 检测当前页面字段** 查看采集结果。
`test/pages/index.html` 列出了每一页的预期结果。

用 `file://` 直接打开也可以，但 iframe 与 Shadow DOM 页在部分浏览器下受限，建议起本地服务器。

---

## 零网络保证

不是"我们不写网络请求"这种口头承诺，而是三道机制：

1. **运行时封锁** —— manifest 的 CSP 写死 `connect-src 'none'`（仅放行 favicon 例外域名），
   扩展页面与 service worker 发起任何 fetch/XHR/WebSocket 都会被浏览器直接拒绝。
2. **构建时校验** —— `scripts/check-no-network.mjs` 扫描**打包产物**（不是源码），
   命中 `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `importScripts` 即构建失败。
   扫产物意味着第三方依赖夹带的网络调用同样会被拦下。
3. **无远程资源** —— 词表与 WASM 全部打进包内，运行期不存在任何"按需下载"。

content script 运行在宿主页面的 CSP 下、不受第 1 条约束，第 2 条正是为它兜底。

### 唯一的网络例外：站点 favicon

获取站点真实图标是**用户明确豁免**的例外，不视为违反零网络承诺：

- **站点优先**：借助当前标签页 content script 做同源 fetch（同源无需 CORS），
  优先 `<link rel="icon">` 声明的地址，失败再猜 `/favicon.ico`
- **失败回退**：Google s2 favicon 服务（`www.google.com/s2/favicons`），
  带 CORS、几乎 100% 可用；代价是域名会发送给 Google
- **再回退**：DuckDuckGo icons（`icons.duckduckgo.com/ip3/{域名}.ico`，
  大陆可达性更好，无重定向）
- **失败冷却**：整条链路失败后 6 小时内不再重试（避免反复打不可达的网络），成功即清除冷却
- 获取时机：新增条目时、站点匹配出现时（静默获取并更新缓存）
- 缓存：storage.local，键 `vwo:favicons:{域名}`；图标显示时先查缓存，
  未缓存回退到本地首字母色块

CSP 与构建期校验对图标服务做了对应放行：`connect-src` 仅多
`www.google.com`（s2 接口）、`*.gstatic.com`（Google favicon 重定向后的静态资源域，
重定向会落在任意 tN 子域，故通配）、`icons.duckduckgo.com`（DuckDuckGo 回退源）。

---

## 架构

```
src/
├── background/     背景 service worker（MV3，随时可能被回收）
├── content/        注入宿主页面的脚本，打成自包含 IIFE
├── popup/          Svelte 5 扩展页面
├── platform/       浏览器 API 抽象层 + 消息总线 + 日志
└── core/           与浏览器无关的领域逻辑
    ├── crypto/     加解密
    ├── state/      存储键与状态定义
    ├── vault/      条目模型与仓储
    ├── autofill/   自动填充（采集 / 判定 / 执行）
    ├── generator/  生成器
    ├── totp/       动态验证码
    └── import-export/  导入导出
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
PIN 解锁是同一 UserKey 的另一份包裹（PIN 派生密钥包裹），数据加密强度不变。

---

---

## 支持本项目

如果这个项目帮到了你，欢迎请我喝杯咖啡 ☕

| 微信赞赏 | 支付宝 |
|---|---|
| ![微信赞赏码](public/sponsor/wechat.png) | ![支付宝收款码](public/sponsor/alipay.png) |

- **爱发电**：[赞助主页](https://afdian.com)（不暴露个人收款信息，有平台背书）
- 打赏是纯粹的感谢，**不会带来任何功能特权**——本项目永久免费、无广告、无会员。

---

## 开源协议

本项目基于 **GNU GPL-3.0** 开源，见 [LICENSE](LICENSE)。

选择 GPL 的原因：项目大量移植自同为 GPL 的 Bitwarden（图标、词表、字段匹配逻辑），
GPL 保证这些贡献持续开放；对密码管理器这类需要信任的软件，代码可审计比"闭源承诺"更可靠。

