/**
 * @file zod schema 单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖节点/文档严格模式、草稿文件与 8 通道 payload/result 形状。
 */
import { describe, expect, it } from 'vitest'
import {
  draftFileSchema,
  loadDraftResultSchema,
  mindmapDocumentSchema,
  mindmapNodeSchema,
  mindmapStyleSchema,
  openDialogResultSchema,
  openDocumentResultSchema,
  rawDocumentSchema,
  readTextFileResultSchema,
  saveDocumentPayloadSchema,
  saveDocumentResultSchema,
  writeExportPayloadSchema,
  writeExportResultSchema
} from './schema'

/** 合法最小节点 */
const NODE = { id: 'a', topic: '根' }

/** 合法最小文档 */
const DOC = { nodeData: NODE, direction: 2 }

describe('schema', () => {
  it('节点：合法递归通过，未知字段被 strict 拒绝', () => {
    expect(
      mindmapNodeSchema.safeParse({
        ...NODE,
        children: [{ id: 'b', topic: 'B', tags: ['x'], branchColor: '#fff' }]
      }).success
    ).toBe(true)
    expect(mindmapNodeSchema.safeParse({ ...NODE, extra: 1 }).success).toBe(false)
    expect(mindmapNodeSchema.safeParse({ id: 'bad id', topic: 'x' }).success).toBe(false)
    expect(mindmapNodeSchema.safeParse({ id: 'a', topic: '' }).success).toBe(false)
    expect(mindmapNodeSchema.safeParse({ id: 'a', topic: 'x', direction: 3 }).success).toBe(false)
  })

  it('样式：白名单键与字符校验', () => {
    expect(mindmapStyleSchema.safeParse({ fontSize: '14' }).success).toBe(true)
    expect(mindmapStyleSchema.safeParse({ color: '<script>' }).success).toBe(false)
    expect(mindmapStyleSchema.safeParse({ unknown: '1' }).success).toBe(false)
  })

  it('文档：方向枚举与附加数组上限', () => {
    expect(mindmapDocumentSchema.safeParse(DOC).success).toBe(true)
    expect(mindmapDocumentSchema.safeParse({ ...DOC, direction: 4 }).success).toBe(false)
    expect(
      mindmapDocumentSchema.safeParse({ ...DOC, arrows: Array.from({ length: 201 }, () => ({})) })
        .success
    ).toBe(false)
    expect(mindmapDocumentSchema.safeParse({ ...DOC, extra: 1 }).success).toBe(false)
  })

  it('rawDocumentSchema 只要求 nodeData 为对象，允许额外字段', () => {
    expect(rawDocumentSchema.safeParse({ nodeData: {}, anything: 1 }).success).toBe(true)
    expect(rawDocumentSchema.safeParse({ nodeData: null }).success).toBe(false)
    expect(rawDocumentSchema.safeParse([]).success).toBe(false)
  })

  it('草稿文件：savedAt 必填，documentPath 可选', () => {
    expect(
      draftFileSchema.safeParse({ savedAt: '2026-11-24T00:00:00.000Z', data: DOC }).success
    ).toBe(true)
    expect(draftFileSchema.safeParse({ savedAt: '', data: DOC }).success).toBe(false)
    expect(draftFileSchema.safeParse({ data: DOC }).success).toBe(false)
  })

  it('open-dialog 允许 null，open-document 回包字段完整', () => {
    expect(openDialogResultSchema.safeParse(null).success).toBe(true)
    expect(openDialogResultSchema.safeParse({ path: 'C:/a.json' }).success).toBe(true)
    expect(openDialogResultSchema.safeParse({ path: '' }).success).toBe(false)

    const result = {
      path: 'C:/a.json',
      name: 'a.json',
      data: { nodeData: {} },
      warnings: ['w'],
      size: 10,
      mtimeMs: 1.5
    }
    expect(openDocumentResultSchema.safeParse(result).success).toBe(true)
    expect(openDocumentResultSchema.safeParse({ ...result, size: -1 }).success).toBe(false)
  })

  it('save-document：expectedMtimeMs/force 可选，回包必须含 mtime', () => {
    expect(saveDocumentPayloadSchema.safeParse({ path: 'C:/a.json', data: DOC }).success).toBe(true)
    expect(
      saveDocumentPayloadSchema.safeParse({
        path: 'C:/a.json',
        data: DOC,
        expectedMtimeMs: 1,
        force: true
      }).success
    ).toBe(true)
    expect(
      saveDocumentResultSchema.safeParse({ path: 'C:/a.json', mtimeMs: 1, warnings: [] }).success
    ).toBe(true)
    expect(saveDocumentResultSchema.safeParse({ path: 'C:/a.json', warnings: [] }).success).toBe(
      false
    )
  })

  it('read-text-file 回包与 write-export 二选一约束', () => {
    expect(readTextFileResultSchema.safeParse({ text: '', size: 0, name: 'a.md' }).success).toBe(
      true
    )
    expect(writeExportPayloadSchema.safeParse({ path: 'C:/a.md', text: 'x' }).success).toBe(true)
    expect(writeExportPayloadSchema.safeParse({ path: 'C:/a.png', base64: 'AA' }).success).toBe(
      true
    )
    expect(writeExportPayloadSchema.safeParse({ path: 'C:/a.md' }).success).toBe(false)
    expect(
      writeExportPayloadSchema.safeParse({ path: 'C:/a.md', text: 'x', base64: 'AA' }).success
    ).toBe(false)
    expect(writeExportResultSchema.safeParse({ path: 'C:/a.md', size: 1 }).success).toBe(true)
  })

  it('load-draft 为按 status 区分的联合类型', () => {
    expect(loadDraftResultSchema.safeParse({ status: 'empty' }).success).toBe(true)
    expect(loadDraftResultSchema.safeParse({ status: 'corrupt' }).success).toBe(true)
    expect(
      loadDraftResultSchema.safeParse({ status: 'ok', data: DOC, savedAt: 'now' }).success
    ).toBe(true)
    expect(loadDraftResultSchema.safeParse({ status: 'ok', data: DOC }).success).toBe(false)
    expect(loadDraftResultSchema.safeParse({ status: 'other' }).success).toBe(false)
  })
})
