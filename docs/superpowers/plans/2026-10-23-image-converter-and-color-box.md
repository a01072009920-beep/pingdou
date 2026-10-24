# 图片转拼豆与颜色盒子 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成图片本地转换、房间整图导入、共享/个人颜色盒及可读色号图纸的完整闭环。

**Architecture:** 原生 ESM 纯算法与 Worker 本地处理图片；专用 HTTP 事务复用房间保存队列，一次创建新画布。转换工作区与颜色盒独立模块，主绘制模块只接线。

**Tech Stack:** Node.js 24+、原生 JavaScript、Canvas/Worker、现有 ws，无新增运行依赖。

**Spec:** docs/superpowers/specs/2026-10-23-image-converter-and-color-box-design.md（用户 2026-10-23 已确认并要求开始实现与测试）

## Global Constraints

- 不复制没有明确授权的 sP 源码，自行实现；只使用现有 MARD 291 色，隐藏 legacy 不参与匹配。
- 画布 8–256 行列；PNG/JPEG 10 MiB、1600 万像素；图片本地处理。
- 原图用色随画布共享，手动颜色按本浏览器/房间/画布隔离。
- 整图作为新画布一次原子保存；保留旧作品；现有逐格放豆和先擦后换色规则不变。
- 原有 4096×4096 导出保留；新增最多64×64格、每格32px的色号分块 PNG。
- 测试使用临时目录；实际 data/、房间索引与凭据不修改、不输出、不提交。

## Review Focus

- 透明边缘和白色主体：空格与白豆不能混淆，半透明按照 alpha 权重处理。
- 导入响应乱序、重复和失败：不产生半作品、不重复建画布、不回退当前快照。
- 画布生命周期：扩展、清盘备份和切换后参考清单保持其语义。
- 颜色盒本地存储失败或跨房间切换：仍能选色，不影响伙伴，不串盒子。
- 最大图案与过期转换结果：不漏格，旧 Worker 结果不能覆盖新设置，分块边界只出现一次。

---

### Task 1: 纯转换与统计模块

Files: 新增 public/color-science.mjs、pattern-data.mjs、convert-core.mjs、convert-worker.mjs；test/conversion.test.mjs。

Interfaces:
- rgbToLab(rgb)、deltaE2000(lab1,lab2)、contrastText(hex)。
- paletteFingerprint(palette) → deterministic string（有序 code/hex，排除 legacy，非认证用途）；colorCodeCompare(a,b)、patternStats(cells) → {total,colors,items:[{code,count}]}。
- convertImage(image, settings, palette, progress=()=>{}) → {width,height,cells,settings,stats}；image={width,height,data:RGBA}，settings={width,height,mode:'nearest'|'smooth'|'cartoon',coverage:.5,matte:'#FFFFFF',maxColors:0,lockedCodes:[],candidateCodes:null,crop:null}。
- Worker 输入 {id,image,settings,palette}，输出 {id,type:'progress',progress} 或 {id,type:'result',result} 或 {id,type:'error',message}。

- [x] 先编写算法参考值、精确色回配、透明/白色/居中留白、三模式、限色/锁定/候选色、尺寸边界与确定性测试，运行并看到缺失模块失败。
- [x] 实现独立颜色科学公式、采样和减色；Worker 使用同一核心。输入验证与强制上限不依赖 UI。
- [x] 运行 node --test test/conversion.test.mjs，通过后记录结果。

### Task 2: 批量导入事务

Files: 新增 src/import-pattern.mjs、test/import-pattern.test.mjs；修改 src/server.mjs、src/canvases.mjs。

Interfaces:
- POST /api/import：Bearer 当前 key，同源，body <=1MiB。payload={requestId,name,width,height,cells,paletteFingerprint,canvasId,epoch,settings}，cells 为 code/null；返回 {ok:true,canvasId,duplicate}。
- 导入画布 reference={schema:1,requestId,payloadHash,paletteFingerprint,settings,items,total,colors}；服务端重新统计与映射，不相信客户端 HEX/用量。
- 快照增加 reference: 当前画布.reference 或 null；canvas catalog 不必携带清单。
- 辅助纯数据接口直接从 public/pattern-data.mjs 导入；与 Task1 的实现并行时可先写测试并等待模块。

- [x] 先写临时目录服务测试：一批保存、隔离、失败零副作用、重试/重启去重、不同摘要拒绝、生命周期过期拒绝、普通 revision 更新保留、1MiB/同源/色表/色号拒绝，运行红灯。
- [x] 实现 HTTP 有界读取、认证、参数白名单、房间队列、原子保存与广播。保存的 requestId/摘要去重，重试不重新切换画布。拒绝关闭中新增事务。
- [x] 扩展画布校验以兼容可选 reference；新建为空、清盘/扩展/备份保留 reference，旧文件无需迁移。
- [x] 运行对应测试与既有 rooms/canvases/store 测试。

### Task 3: 转换工作区、颜色盒与图纸导出

Files: 新增 public/converter-ui.mjs、image-input.mjs、color-box.mjs、pattern-sheet.mjs、converter.css；test/color-box.test.mjs、image-input.test.mjs、pattern-sheet.test.mjs。

Interfaces:
- createConverter({getContext,getManualCodes,onImported,notify}) → {open(),close(),roomChanged(),isBusy()}；context={roomId,key,canvasId,epoch,board,ready,canImport}。
- onImported({canvasId,manualCodes,roomId}) 只通知主模块，不向其安装旧 HTTP 快照；主模块请求 WS sync。
- createColorBox({root,onSelect,notify}) → {update({roomId,canvasId,palette,cells,reference}),getManualCodes(),setManualCodes(roomId,canvasId,codes),isModalOpen()}。
- openSheetExport({pattern,palette,name,notify}) 弹出分块列表，各块点击才绘制与下载；pattern={width,height,cells:code/null}。
- color-box root 由主模块在 index.html 新建 #color-box-panel；各模块可自行追加 dialog；所有外观放 converter.css。

- [x] 先测试 PNG/JPEG 文件头和大小边界、色盒本地隔离/去重/排序/失效存储、分块坐标/统计/空格与长色号，运行红灯。
- [x] 实现读图/裁剪矩形（拖动与数值）/模式/alpha底色/减色锁定/候选色/Worker取消及过期结果丢弃/滚动缩放色号预览/导入重试。
- [x] 实现个人颜色选择器、多选、共享参考/个人来源合并、原图数量与当前用量区分、紧凑收起布局。
- [x] 实现固定32px格的分块图纸与逐块下载，导出当前不可变数据。
- [x] 运行模块测试，交接界面 DOM 与 context 接口供主模块接线。

### Task 4: 接线、整体验证与交付

Files: public/app.mjs、index.html、styles.css；package.json；README.md；必要 UI 集成测试。

- [x] 先写集成测试：导入时不再画豆、快照 reference 更新盒子、切房间丢弃旧导入回调、个人色不串、已保存状态与色号导出一致。
- [x] 接入 #image-convert/#sheet-export 按钮与盒子；getContext 包括是否有未保存操作。控制禁止导入时机但不冻结转换草稿；新快照仍是唯一权威。
- [x] 在静态资源白名单加入新增模块和 CSS（server 文件由 Task2 负责，主模块仅在其完成后追加）；更新 run check 覆盖新增模块。
- [x] npm.cmd test、npm.cmd run check 与 git diff --check；临时房间浏览器完成上传→转换→导入→第二浏览器同步→个人盒隔离→导出全过程，测量80/128/256转换。
- [x] 新鲜上下文全分支审查，处理重要缺陷并补回归测试，更新 README/设计状态与本计划完成记录。合并到用户常用本地工作区；本轮不推送 GitHub（尚无本功能的发布请求）。

## 执行记录

工作区：C:/Users/35115/.codex/worktrees/image-converter/pingdou，分支 codex/image-converter。
Ruling: 用户已明确“好的，开始”，据此直接执行已确认设计，不再增加计划审批轮。使用原生受管理 worktree 隔离实际 data/，并行实现不重叠文件；主会话负责集成和最终独立审查。


2026-10-24 验证：136/136 测试、28 模块语法检查及 diff 检查通过；新鲜上下文复查后修复多触点裁剪旧结果可导入问题，两项回归先红后绿。浏览器完整流程与三个尺寸、算法耗时见 ../validation/2026-10-24-image-converter.md。按已批准的本地完整实现范围接回原项目，原目录只有本会话创建的未跟踪设计稿，整合前另存该版本；不增加发布步骤。
