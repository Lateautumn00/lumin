# 二维码工具（qr-code）实施任务清单

> 规格：`docs/spec/qr-code.md` · 里程碑：M16 · 分支：`feature/m16-qr-code`
> 完成定义：`pnpm coverage` 与 `pnpm gate` 全绿、e2e 全过、smoke 八类记录完整、3 个提交完成。

- [x] 1. 建包骨架：`packages/tools/qr-code/{package.json,tsconfig.json}` + `src/manifest.ts`，依赖钉版 `qrcode@1.5.4` / `jsqr@1.4.0` / `@types/qrcode@1.5.6`（dev）
- [x] 2. 契约与纯函数：`schema.ts` / `errors.ts` / `payload.ts` / `save.ts` + 单测（WiFi/vCard 转义、文件名清洗、base64、writeAtomic 失败清理）
- [x] 3. 主进程：`node.ts`（config / set-output-dir / save 原子写盘 + 冲突命名）+ 假 ctx 单测
- [x] 4. 渲染层：`client.ts` / `generate.ts` / `decode.ts` / `ToolView.vue`（两 Tab、三态、预览防抖、识别重试）+ 单测（矩阵→RGBA→jsQR 闭环）
- [x] 5. 壳注册 5 处：desktop 依赖、vite 别名、tool-manifests、tool-mains、`tools/qr-code.vue`、AppSidebar `QrCode` 图标；`pnpm install`
- [x] 6. 门禁配置：`vitest.config.ts` 加 `packages/tools/qr-code/src/**/*.ts` 四项 80；执行 `pnpm lint` / `typecheck` / `coverage`
- [x] 7. e2e：`apps/desktop/e2e/qr-code-smoke.spec.ts` 5 用例（加载/保存/识别/边界/ACL 不可写/超大图/并发），跑通
- [x] 8. 文档登记：`docs/smoke/qr-code.md`、plan §1 Q20 + §4.16 + §6 M16、CHANGELOG、README 中英
- [x] 9. 提交（3 个）：工具包 / 壳注册 / e2e+文档；`pnpm gate` 全绿后交付，暂不推送
