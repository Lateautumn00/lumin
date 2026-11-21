# M40 图片增强 — 实施任务单

> 依据 `Lumin 功能清单差距审计与后续路线图.md` §M40；字段级清单见 `docs/spec/image-toolbox.md` §2.4/§2.5 与 `docs/spec/image-stitch.md` §3.6。
> 用户拍板（2026-11-21）：长图分割放 `image-stitch` 新页签；黑白化 = 二值化 + 阈值可调；GIF 生成放 `image-toolbox` 新页签；分割支持固定高度 + 按份数。
> 约束：零新增依赖（复用 `ffmpeg.exe` 与 `@napi-rs/canvas`）；不新建工具包；沿用 R2/R5/R8/R9。

## 0. 范围

| 包 | 增量 |
| --- | --- |
| `@lumin/tool-image-toolbox` | 「调整」Tab（灰度/反色/黑白二值，`process` 增 `effect` 模式）+「GIF」Tab（`image-toolbox:make-gif` 任务） |
| `@lumin/tool-image-stitch` | 「长图分割」Tab（`image-stitch:split` 任务 + `split.worker.ts`） |

不做：图片去背景、自由画布、GIF 反向拆帧、长图分割的自动检测空白分隔（按固定高度/份数足够）。

## 1. image-toolbox 纯函数与契约

- [x] `src/encode.ts`：`EffectKind = 'grayscale' | 'invert' | 'binary'`；`buildEffectFilter(effect, threshold)`（灰度 `hue=s=0`、反色 `negate`、二值 `format=gray,lut=y='if(gt(val,T),255,0)'`，阈值钳制 0–255）
- [x] `src/gif.ts`（新）：`GIF_MAX_EDGE=4096`、`GIF_MAX_PIXELS=16_777_216`、`MAX_GIF_FRAMES=100`、`GIF_MIN_FRAME_MS=50`、`GIF_MAX_FRAME_MS=5000`；`fpsFromFrameMs(ms)`；`planGifCanvas(sizes, width)`（width=0 用首图宽；高取缩放后最大值；超限 → null）；`buildGifFilterGraph(count, canvas)`；`gifLoopArg(loop)`；`gifOutputName(date)`
- [x] `src/naming.ts`：`buildOutputName` 增 `effect` 模式（`.gray` / `.invert` / `.bw{T}`）
- [x] `src/schema.ts`：`effectOptionsSchema`（effect + threshold）、`gifOptionsSchema`（durationMs 50–5000、loop -1/0/2..10、width 0 或 64–4096）、`makeGifPayloadSchema`、`gifResultSchema`；`processPayloadSchema` 增 `effect` 分支
- [x] `src/errors.ts`：新增 `IT_GIF_TOO_LARGE`（GIF 画布超 4096px / 1600 万像素）
- [x] `src/node.ts`：`processOne` 支持 `effect`；注册 `make-gif` 任务（逐张 probe 尺寸 → `planGifCanvas` → 单进程 `filter_complex` 编码 → 冲突命名 → done `{outputPath,width,height,frames,sizeBytes}`）
- [x] `src/renderer/client.ts`：`makeGif(payload)`

## 2. image-toolbox 界面

- [x] `renderer/ToolView.vue`：「调整」页签（效果单选 + 阈值滑杆 + 质量滑杆）与「GIF」页签（帧时长、循环、宽度、自动高度、行内 ↑/↓ 与按文件名排序）；文件列表与输出目录跨页签共享
- [x] 三态：空态引导不变、GIF 编码期间进度可取消、调整沿用批量结果区；新增 `data-testid`：`effect-kind`、`effect-threshold`、`gif-duration`、`gif-loop`、`gif-width`、`gif-height`、`gif-run`、`gif-result`、`row-up`、`row-down`、`sort-by-name`

## 3. image-stitch 长图分割

- [x] `src/contract.ts`：`planSplit(height, mode, param)`（fixed height / parts，余数摊到前几段；份数>图高或段数>100 → null）、`splitFileName(inputName, index, total, ext)`
- [x] `src/schema.ts`：`splitPayloadSchema`、`SplitRequest`、`SplitResult`
- [x] `src/errors.ts`：新增 `IS_SPLIT_INVALID`
- [x] `src/split.worker.ts`（新）：`runSplit` 读图 → `planSplit` → 逐段 canvas 绘制 → 编码 → `.tmp` + rename；progress `切分 i/n`；done `{outputs,sourceWidth,sourceHeight}`
- [x] `src/node.ts`：第二个 `?modulePath` + `split` 任务通道（单张预检 + 输出目录解析）
- [x] `renderer/ToolView.vue`：`NTabs`「拼接 / 长图分割」，分割页签（单图 DropZone、切分方式、高度/份数、质量、结果列表）；`data-testid`：`split-mode`、`split-height`、`split-parts`、`split-run`、`split-result`
- [x] `src/renderer/client.ts`：`split(payload)`

## 4. 测试

- [x] `image-toolbox`：`encode.test.ts`（buildEffectFilter 三效果 + 阈值钳制）、`gif.test.ts`（fps / planGifCanvas 含 0 宽与超限 / filter graph / loop / 命名）、`naming.test.ts`（effect 命名）、`schema.test.ts`（effect + make-gif 边界）、`node.test.ts`（effect 任务、make-gif 成功与超限/取消）、`renderer/client.test.ts`（makeGif 通道名）
- [x] `image-stitch`：`contract.test.ts`（planSplit 固定高度/按份数/余数/非法、splitFileName 补零）、`schema.test.ts`（split payload 边界）、`node.test.ts`（split 通道预检与错误映射）、`split.worker.test.ts`（真实 canvas 切片尺寸/原子写/冲突递增）、`renderer/client.test.ts`
- [x] e2e `image-toolbox-smoke.spec.ts`：+2 用例（调整像素断言：灰度三通道近似、反色取反、黑白仅 0/255；GIF 3 帧 → GIF89a + NETSCAPE2.0 + 尺寸）；页签回归补 `effect`/`gif`
- [x] e2e `image-stitch-smoke.spec.ts`：+1 用例（200×900 固定高度 300 → 3 段、按份数 2 → 2 段；中文空格路径；冲突 `(1)`；页签可见）

## 5. 文档与登记

- [x] `docs/smoke/image-toolbox.md` / `docs/smoke/image-stitch.md` 增量记录（R2 八类映射 + chunk 实测）
- [x] `docs/opencode/plan.md`：§1 标题 Q1–Q40 + Q40 行、§4.40、§6 M40 里程碑行
- [x] `CHANGELOG.md` M40 条目；`README.md` / `README.en.md` 工具描述同步

## 6. 验收命令

```powershell
pnpm coverage
pnpm --filter @lumin/desktop build
pnpm --filter @lumin/desktop exec playwright test e2e/image-toolbox-smoke.spec.ts e2e/image-stitch-smoke.spec.ts
pnpm gate
```

## 7. 提交（feature/m40-image-enhance，不推送）

1. `feat(image-toolbox): 新增图像调整与 GIF 生成页签`
2. `feat(image-stitch): 新增长图分割页签`
3. `test(image-toolbox,image-stitch): M40 纯函数/worker/e2e 覆盖`
4. `docs(m40): 登记规格、冒烟、plan 与 CHANGELOG`
