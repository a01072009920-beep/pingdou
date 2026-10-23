# 多房间与画布优先工作区 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已确认直接开始，本轮在当前会话依次实施。

**Goal:** 创建独立房间、自定义邀请码加入，以及可收起色盘的画布优先界面。

**Architecture:** 房间目录负责身份和存储位置，每个房间拥有独立保存队列和连接范围。HTTP 创建 / 加入换取随机凭据，WebSocket 绑定房间。布局偏好仅保存在本设备。

**Tech Stack:** Node.js 24+、原生 JavaScript/CSS/Canvas、现有 ws，无新增依赖。

**Spec:** ../specs/2026-10-23-rooms-and-canvas-workspace-design.md

## Global Constraints

- 8–256 行列；先擦除再换色；4096 × 4096 导出；保存成功再广播。
- 邀请码 8–32 位字母、数字、短横线或下划线，统一大写；房间名称 1–40 字符。
- 真实 data/ 作品不用于测试；新房间保存在 data/rooms/<uuid>/room.json。
- 保留本机监听和旧密钥兼容，不启动公网穿透，不推送 GitHub。

## Review Focus

- 并发创建相同邀请码只能成功一次，失败不能覆盖已有房间。
- 重启缺失索引密钥或文件损坏时保护原文件，不重新生成导致邀请码全部失效。
- 房间切换时旧连接、未发送笔画、下载结果不能污染新房间。
- 穿透代理共享地址时不能把所有正常参与者当作同一个用户封锁。
- 色盘折叠后工具、焦点、手动缩放中心仍可用；横屏不会把画布挤扁。

## Task 1: 房间目录与持久化

Files: 新增 src/rooms.mjs、test/rooms.test.mjs。

Interfaces: openRooms(dataDir, {save}) 返回 {legacy, entries, byKey(key), join(code), create({name,code}), setLegacyCode(key,code), idle()}。entry 包含 id、name、room、dataDir、inviteDigest、queue、queued。

- [x] 写测试：大小写归一、重复和并发冲突、重启、真实保存失败、旧文件字节不变、损坏文件保护。
- [x] 运行 node --test test/rooms.test.mjs，确认新增接口缺失导致失败。
- [x] 实现 HMAC 邀请码索引、目录扫描和原子元信息保存；创建先落盘再发布。
- [x] 运行目录与既有存储测试。

## Task 2: HTTP 与实时房间隔离

Files: 修改 src/server.mjs；新增 test/rooms-server.test.mjs。

Interfaces: POST /api/rooms {name,code}、POST /api/rooms/join {code}、POST /api/rooms/invite {code} + Bearer；返回 {key,room:{id,name,hasInvite}}。WS auth {key} 绑定目录 entry。

- [x] 写测试：多个房间的快照/在线人数/放豆/画布库隔离；一个房间保存暂停不阻塞另一个；导出凭据选择与重启。
- [x] 确认新增 API 测试先失败。
- [x] 实现限定请求体、同源检查、有限速的 API；验证凭据后固定房间，广播与队列分离。
- [x] 运行服务、导出与目录测试，保持既有旧密钥行为。

## Task 3: 房间进入与工作区

Files: 新增 public/rooms.mjs、public/workspace.mjs 及对应测试；修改 public/app.mjs、public/index.html、public/styles.css、test/drawing-ui.test.mjs。

Interfaces: 房间 UI 注入 canSwitch()/onEnter(session) 回调；工作区 UI 注入 beforeLayout() 回调。app.mjs 保留绘制和连接，收到房间快照后更新房间 UI。

- [x] 写前端行为测试：失败不切换、保存时不能切换、会话恢复、折叠偏好、存储不可用和迟到连接保护。
- [x] 实现创建/加入/邀请、旧链接兼容、会话和错误处理。
- [x] 常用工具移出色盘，增加折叠、专注、更多和帮助入口。
- [x] 重做尺寸分配为动态视口剩余空间，先验证手机收起，再验证展开与桌面。
- [x] 浏览器临时房间验证 360×619、390×844、768×1024、1024×768、844×390、1280×720，以及真实放豆和另一房间隔离。

## Task 4: 启动入口与收尾

Files: scripts/tunnel.mjs、src/cli.mjs、test/tunnel.test.mjs、README.md、AGENTS.md、package.json。

- [x] 更新穿透期望测试为不含房间凭据的网站入口，确认失败后修改脚本。
- [x] 更新使用说明与校验命令覆盖新增模块。
- [x] npm.cmd test、npm.cmd run check、git diff --check。
- [x] 检查全部变更、记录浏览器结果和真机验证限制；交付本地可运行项目。

## 完成记录 · 2026-10-23

- 所有四项任务完成，当前分支 codex/rooms-workspace。按用户“开始吧”“继续，然后发布到github上面”的授权实施并发布，不再增加审批步骤。
- 保持当前项目工作目录可直接使用，在功能分支修改；真实 data/ 未用于验证。新目录和旧房间兼容均在临时目录验证。
- 自动化：89/89 测试通过；npm.cmd run check、git diff --check 通过。
- 独立代码审查发现“触屏保存先完成、再抬手，房间按钮仍禁用”，已用失败回归测试确认并修复；同时修复输入框原生约束阻止 trim 的问题。
- 浏览器通过实际表单用两端空格的邀请码创建和加入，两个独立页面同步放豆、互相擦除；另建房间的画布与在线人数独立。
- 80×80 工作区：360×619 收起色盘为338×366；390×844 为369×590；768×1024 为746×770；1024×768 展开侧栏为784×524；844×390 为589×206；1280×720 为1002×476（CSS像素）。这些视口未出现页面横向溢出。
- 专注模式、色盘展开/收起及筛选通过浏览器操作检查。控制台错误与警告为空；预览见 docs/rooms-mobile.png、docs/rooms-desktop.png。
- 本轮没有真实手机/平板、软键盘及公网触控延迟实测，也未启动公网穿透。连续绘制节奏和渲染清晰度沿用原实现。
