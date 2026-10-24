# 待拼图纸分层 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Update checkboxes after verification.

**Goal:** 导入后显示可照着拼的色号图纸，实际珠子从零开始。

**Architecture:** server reference schema 2 持久保存只读 code/null 图纸；board.cells 仅保存玩家放置；客户端按层渲染，导出图纸读取目标层。

**Tech Stack:** 原生 JS、Canvas、Node.js 24+，无新依赖。

**Spec:** ../specs/2026-10-24-pattern-guide-design.md

## Constraints and review focus

- 原作品、schema 1 引用、房间密钥保留；实际数据不用于测试。
- 目标颜色不能占格；放豆、擦除、连线、平移缩放沿用现有规则。
- 扩展后目标行列不漂移，清盘和备份不丢目标，重连和伙伴一致。
- 普通画布导出实际豆子，待拼画布导出完整目标图纸，导出快照不能被后续编辑改变。

## Tasks

- [x] Server TDD: 更新导入、schema 校验、生命周期/重启/房间隔离测试，确认红灯；实现 schema 2 与空 board；旧格式兼容，验证目标计数一致和实际可放擦。
- [x] Client TDD: 测试目标坐标、渲染与占格独立、图纸导出、空画布提示、当前计数；实现目标色块/色号与实际珠子分层，修改导入文案。
- [x] Run full npm.cmd test / npm.cmd run check / diff check；临时房间浏览器实测导入0豆、可放可擦、刷新与目标图纸导出；独立复查重要边界。
- [x] 更新 README/AGENTS/设计说明，接回用户本地项目，保留数据；不推送 GitHub。
