# 离线模式功能清单

范围已锁定的三项决策：

| 决策 | 结论 |
|---|---|
| 数据来源 | 导入 Bitwarden / Vaultwarden 导出文件；无账户体系、无登录页 |
| 数据格式 | 与 Bitwarden 100% 兼容，导出文件可直接导回 Vaultwarden |
| 技术栈 | Vite + TypeScript + Svelte 5，MV3 |

首次使用流程：`选择导出文件 → 输入该文件的解密口令（若加密）→ 设置本插件的本地主密码 → 落盘`。
导入后密码库**本地可读写**，可随时再导出。

---

## 格式兼容性（不可自由发挥的部分）

| 项 | 锁定值 |
|---|---|
| 对称密文 | `2.{iv_b64}\|{ct_b64}\|{mac_b64}` = AES-256-CBC + HMAC-SHA256（encrypt-then-MAC） |
| UserKey | 64 字节 = 32B encKey ‖ 32B macKey |
| 主密钥派生 | PBKDF2-SHA256（默认 600,000 迭代）或 Argon2id（默认 iter=6, mem=32MiB, par=4） |
| 密钥拉伸 | HKDF-Expand(masterKey, info=`"enc"` / `"mac"`, SHA-256) → 64B |
| 条目密钥 | 可选 per-cipher key（`cipher.key`），存在时项内字段用它加密 |
| 密码保护导出 | `{encrypted, passwordProtected, salt, kdfType, kdfIterations, kdfMemory?, kdfParallelism?, encKeyValidation_DO_NOT_EDIT, data}` |
| 本地库 salt | 随机 16B（离线场景无 email 可用；不影响导出互通，导出文件自带 salt） |

---

## P0 — MVP

### 加密核心（Phase 1）
- `EncString` 编解码（type 0 / 2）、AES-CBC-HMAC 加解密、恒定时间 MAC 比对
- PBKDF2-SHA256（WebCrypto 原生）+ Argon2id（WASM 内联，不走网络加载）
- HKDF 拉伸、UserKey 包裹/解包、per-cipher key
- CSPRNG 封装

### 保险库与存储（Phase 2）
- 8 种条目类型：Login / SecureNote / Card / Identity / SshKey / BankAccount / DriversLicense / Passport
- 条目字段全集：多 URI + 匹配策略、TOTP、自定义字段（text/hidden/boolean/linked）、附注、收藏、密码历史、reprompt、创建/修改时间
- 文件夹、回收站（软删除 / 恢复 / 永久删除）
- `chrome.storage.local` 密文落盘；`chrome.storage.session` 托管运行期 UserKey
- 本地搜索索引

### 解锁与锁定（Phase 2）
- 主密码解锁、失败递增延迟
- 超时锁定：立即 / N 分钟 / 浏览器重启 / 空闲 / 永不
- 超时动作：锁定（保留密文）/ 清空（销毁本地库）
- 条目级主密码复验（reprompt）

### 导入导出（Phase 3）
- 导入：Bitwarden/Vaultwarden JSON（明文 + 密码保护）、CSV
- 导出：JSON 明文 / JSON 密码保护 / CSV
- 导入合并策略：跳过重复 / 覆盖 / 全部新增
- 组织条目降级：`organizationId` / `collectionIds` 转为文件夹标签保留，不丢数据

### 界面（Phase 4）
- Popup：当前站点匹配项 → 全部条目 → 文件夹
- 8 种类型的查看/编辑表单
- popout 独立窗口、明暗主题、`zh_CN` + `en`
- 站点图标本地生成（首字母色块），零请求

### 自动填充（Phase 5，移植 Bitwarden 引擎）
- 表单采集 + 字段资格判定 + 填充脚本执行（含 iframe / shadow DOM）
- 输入框内联菜单浮层
- 保存 / 更新凭据提示条
- 右键菜单填充、快捷键（`Ctrl+Shift+L` 填充、`Ctrl+Shift+9` 生成密码）
- URI 匹配 6 策略 + 内置静态等价域名表
- 卡片有效期多格式合成、身份姓名/地址拆分

### 生成器与 TOTP（Phase 6）
- 密码、密码短语（内置 EFF 词表）、用户名（单词 / catchall / 子地址）
- 生成历史（本地加密）
- TOTP：otpauth 解析、SHA1/256/512、Steam Guard、倒计时环

### 零网络硬保证（Phase 0 已落地）
- manifest CSP `connect-src 'none'`
- 构建期扫描打包产物，命中网络 API 即失败
- 无远程资源，词表与 WASM 全部内联

---

## P1 — 第二阶段

附件本地加密存储（IndexedDB）· 本地密码健康检查（弱/重复/过期）· 侧边栏模式 ·
第三方导入器（Chrome / Firefox / KeePass2 / 1Password / LastPass / NordPass / ProtonPass）·
修改主密码与 UserKey 轮换 · 剪贴板自动清除 · 页面加载自动填充

## P2 — 可选

Passkeys（FIDO2 创建 / 断言）· 生物识别解锁（需 native messaging 伴生程序）·
TOTP 二维码识别导入 · 加密备份自动导出提醒

---

## 明确不做（强依赖服务端）

账户注册登录 · 2FA / SSO · 同步 · Bitwarden Send · 组织与集合共享 ·
HIBP 泄露查询 · 钓鱼检测 · 事件审计日志 · 遥测 · 计费 · 转发邮箱别名生成
