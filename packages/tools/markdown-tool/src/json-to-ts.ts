/**
 * @file JSON → TypeScript 类型生成纯函数（零依赖自写）
 * @author cuilanchao
 * @date 2026-11-21
 * @description spec §3.2：对象/数组/联合推断，数组元素对象形状合并且缺省键转可选，
 *              嵌套对象按「根名 + PascalCase(键路径)」命名并自动去重。
 */
import { failure, type ToolFailure } from './errors'

/** 单次输入字符上限（与 Markdown 页签一致） */
export const JSON_LIMIT = 2_000_000

/** 嵌套深度上限 */
export const MAX_DEPTH = 64

export type DeclarationStyle = 'interface' | 'type' | 'json-schema'

export interface GenerateOptions {
  /** 根类型名（须为合法 TS 标识符且非保留字） */
  rootName: string
  /** 声明方式：interface / type */
  style: DeclarationStyle
}

export type GenerateOutcome =
  | { ok: true; value: { code: string } }
  | ToolFailure

type PrimitiveName = 'string' | 'number' | 'boolean' | 'null' | 'unknown'

interface Field {
  key: string
  optional: boolean
  shape: Shape
}

type Shape =
  | { kind: 'primitive'; name: PrimitiveName }
  | { kind: 'array'; element: Shape }
  | { kind: 'union'; members: Shape[] }
  | { kind: 'object'; fields: Field[] }

/** 嵌套过深哨兵（转结构化错误） */
class DepthError extends Error {}

/** TS 保留字（根类型名拒绝） */
const RESERVED = new Set([
  'any',
  'boolean',
  'number',
  'string',
  'symbol',
  'object',
  'undefined',
  'never',
  'unknown',
  'void',
  'null',
  'bigint',
  'interface',
  'type',
  'class',
  'function',
  'enum',
  'export',
  'import',
  'default',
  'extends',
  'implements',
  'constructor',
  'this',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'return',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'do',
  'try',
  'catch',
  'finally',
  'throw',
  'async',
  'await',
  'yield',
  'static',
  'public',
  'private',
  'protected',
  'readonly',
  'abstract',
  'declare',
  'namespace',
  'module',
  'require',
  'global'
])

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * 根类型名是否可作 TS 声明名
 * @param name 用户输入
 */
export function isValidRootName(name: string): boolean {
  return IDENTIFIER_RE.test(name) && !RESERVED.has(name)
}

/**
 * 推断 JSON 值的类型形状
 * @param value 已解析 JSON 值
 * @param depth 当前嵌套深度
 */
function infer(value: unknown, depth: number): Shape {
  if (depth > MAX_DEPTH) throw new DepthError()
  if (value === null) return { kind: 'primitive', name: 'null' }
  if (typeof value === 'string') return { kind: 'primitive', name: 'string' }
  if (typeof value === 'number') return { kind: 'primitive', name: 'number' }
  if (typeof value === 'boolean') return { kind: 'primitive', name: 'boolean' }
  if (Array.isArray(value)) {
    let element: Shape | undefined
    for (const item of value) {
      const shape = infer(item, depth + 1)
      element = element === undefined ? shape : mergeShapes(element, shape)
    }
    return { kind: 'array', element: element ?? { kind: 'primitive', name: 'unknown' } }
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record).map<Field>((key) => ({
      key,
      optional: false,
      shape: infer(record[key], depth + 1)
    }))
    return { kind: 'object', fields }
  }
  return { kind: 'primitive', name: 'unknown' }
}

/**
 * 形状指纹（联合去重）
 * @param shape 形状
 */
function shapeKey(shape: Shape): string {
  switch (shape.kind) {
    case 'primitive':
      return `p:${shape.name}`
    case 'array':
      return `a:${shapeKey(shape.element)}`
    case 'union':
      return `u:${shape.members.map(shapeKey).sort().join('|')}`
    case 'object':
      return `o:${shape.fields
        .map((field) => `${field.key}${field.optional ? '?' : ''}:${shapeKey(field.shape)}`)
        .sort()
        .join(',')}`
  }
}

/**
 * 合并为联合并去除重复成员
 * @param members 待合并形状
 */
function toUnion(members: Shape[]): Shape {
  const flat: Shape[] = []
  for (const member of members) {
    if (member.kind === 'union') flat.push(...member.members)
    else flat.push(member)
  }
  const seen = new Set<string>()
  const unique: Shape[] = []
  for (const member of flat) {
    const key = shapeKey(member)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(member)
    }
  }
  if (unique.length === 1) {
    const only = unique[0]
    if (only !== undefined) return only
  }
  return { kind: 'union', members: unique }
}

/**
 * 合并对象形状：键并集；仅部分出现 → 可选；同名键类型取联合
 * @param a 形状 A
 * @param b 形状 B
 */
function mergeObjects(a: Shape & { kind: 'object' }, b: Shape & { kind: 'object' }): Shape {
  const keys: string[] = a.fields.map((field) => field.key)
  for (const field of b.fields) {
    if (!keys.includes(field.key)) keys.push(field.key)
  }
  const fields = keys.map<Field>((key) => {
    const left = a.fields.find((field) => field.key === key)
    const right = b.fields.find((field) => field.key === key)
    if (left !== undefined && right !== undefined) {
      return {
        key,
        optional: left.optional || right.optional,
        shape: mergeShapes(left.shape, right.shape)
      }
    }
    const only = left ?? right
    if (only === undefined) {
      return { key, optional: true, shape: { kind: 'primitive', name: 'unknown' } }
    }
    return { key, optional: true, shape: only.shape }
  })
  return { kind: 'object', fields }
}

/**
 * 合并两个形状（数组元素累积、对象键合并）
 * @param a 形状 A
 * @param b 形状 B
 */
function mergeShapes(a: Shape, b: Shape): Shape {
  if (a.kind === 'union' && b.kind === 'union') return toUnion([...a.members, ...b.members])
  if (a.kind === 'union') return toUnion([...a.members, b])
  if (b.kind === 'union') return toUnion([a, ...b.members])
  if (a.kind === 'primitive' && b.kind === 'primitive') {
    return a.name === b.name ? a : { kind: 'union', members: [a, b] }
  }
  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', element: mergeShapes(a.element, b.element) }
  }
  if (a.kind === 'object' && b.kind === 'object') return mergeObjects(a, b)
  return toUnion([a, b])
}

/**
 * 键 → PascalCase 片段（非字母数字视为分隔符；无法转换回退 Field）
 * @param key JSON 键
 */
function pascalCase(key: string): string {
  const parts = key.split(/[^A-Za-z0-9]+/).filter((part) => part !== '')
  if (parts.length === 0) return 'Field'
  const joined = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
  return /^[A-Za-z_$]/.test(joined) ? joined : `T${joined}`
}

/**
 * 字段名渲染：合法标识符原样，否则单引号包裹并转义
 * @param key JSON 键
 */
function propertyName(key: string): string {
  if (IDENTIFIER_RE.test(key)) return key
  return `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

interface Declaration {
  name: string
  /** 对象体（每行一个字段）；alias 声明时为 null */
  body: string | null
  /** 类型别名表达式；对象声明时为 null */
  alias: string | null
}

/** 声明收集器：保证根声明在前，嵌套对象按访问顺序追加 */
class Emitter {
  private readonly declarations: Declaration[] = []
  private readonly usedNames = new Set<string>()

  constructor(
    private readonly rootName: string,
    private readonly style: DeclarationStyle
  ) {}

  /**
   * 类型表达式（对象会登记声明并返回名字）
   * @param shape 形状
   * @param pathName 当前命名路径
   */
  typeExpr(shape: Shape, pathName: string): string {
    switch (shape.kind) {
      case 'primitive':
        return shape.name
      case 'array': {
        const element = this.typeExpr(shape.element, `${pathName}Item`)
        return shape.element.kind === 'union' ? `(${element})[]` : `${element}[]`
      }
      case 'union': {
        const parts: string[] = []
        for (const member of shape.members) {
          const expr = this.typeExpr(member, pathName)
          if (!parts.includes(expr)) parts.push(expr)
        }
        return parts.join(' | ')
      }
      case 'object': {
        if (shape.fields.length === 0) return 'Record<string, never>'
        const name = this.uniqueName(pathName)
        const declaration: Declaration = { name, body: '', alias: null }
        this.declarations.push(declaration)
        const lines = shape.fields.map((field) => {
          const expr = this.typeExpr(field.shape, `${pathName}${pascalCase(field.key)}`)
          return `  ${propertyName(field.key)}${field.optional ? '?' : ''}: ${expr}`
        })
        declaration.body = lines.join('\n')
        return name
      }
    }
  }

  /**
   * 生成最终代码
   * @param root 根形状
   */
  render(root: Shape): string {
    if (root.kind === 'object' && root.fields.length > 0) {
      this.typeExpr(root, this.rootName)
    } else {
      const alias = this.typeExpr(root, this.rootName)
      this.declarations.unshift({ name: this.rootName, body: null, alias })
    }
    const blocks = this.declarations.map((declaration) => this.renderDeclaration(declaration))
    return `${blocks.join('\n\n')}\n`
  }

  /**
   * 单条声明文本
   * @param declaration 声明
   */
  private renderDeclaration(declaration: Declaration): string {
    if (declaration.alias !== null) {
      return `export type ${declaration.name} = ${declaration.alias}`
    }
    const keyword = this.style === 'interface' ? 'interface' : 'type'
    const head = `export ${keyword} ${declaration.name}`
    if (this.style === 'type') return `${head} = {\n${declaration.body ?? ''}\n}`
    return `${head} {\n${declaration.body ?? ''}\n}`
  }

  /**
   * 名字去重（冲突追加 2/3…）
   * @param base 期望名字
   */
  private uniqueName(base: string): string {
    const fallback = base === '' ? 'Type' : base
    let candidate = fallback
    let index = 2
    while (this.usedNames.has(candidate)) {
      candidate = `${fallback}${index}`
      index += 1
    }
    this.usedNames.add(candidate)
    return candidate
  }
}

/**
 * 错误对象 → 可读文本
 * @param err 捕获的异常
 */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : ''
}

/** JSON Schema 节点（draft-07 子集） */
type SchemaNode = Record<string, unknown>

/** 嵌套对象定义收集器：根对象内联，其余对象抽到 $defs */
class SchemaBuilder {
  private readonly defs: Record<string, SchemaNode> = {}
  private readonly usedNames = new Set<string>()

  constructor(private readonly rootName: string) {}

  /**
   * 构建根 schema
   * @param value 已解析 JSON 值
   */
  build(value: unknown): SchemaNode {
    return this.value(value, this.rootName, 0, false)
  }

  /** 已收集的 $defs */
  definitions(): Record<string, SchemaNode> {
    return this.defs
  }

  /**
   * 单值 → schema；嵌套对象登记到 $defs 并返回 $ref
   * @param value JSON 值
   * @param pathName 当前命名路径
   * @param depth 嵌套深度
   * @param hoistObject 是否把对象抽到 $defs
   */
  private value(
    value: unknown,
    pathName: string,
    depth: number,
    hoistObject: boolean
  ): SchemaNode {
    if (depth > MAX_DEPTH) throw new DepthError()
    if (value === null) return { type: ['string', 'null'] }
    if (typeof value === 'string') return { type: 'string' }
    if (typeof value === 'number') {
      return { type: Number.isInteger(value) ? 'integer' : 'number' }
    }
    if (typeof value === 'boolean') return { type: 'boolean' }
    if (Array.isArray(value)) {
      const schema: SchemaNode = { type: 'array' }
      const first = value[0]
      if (first !== undefined) {
        schema.items = this.value(first, `${pathName}Item`, depth + 1, true)
      }
      return schema
    }
    if (typeof value === 'object') {
      return this.object(value as Record<string, unknown>, pathName, depth, hoistObject)
    }
    return {}
  }

  /**
   * 对象 → type/properties/required；可选抽到 $defs
   * @param record JSON 对象
   * @param pathName 当前命名路径
   * @param depth 嵌套深度
   * @param hoist 是否抽到 $defs
   */
  private object(
    record: Record<string, unknown>,
    pathName: string,
    depth: number,
    hoist: boolean
  ): SchemaNode {
    if (depth > MAX_DEPTH) throw new DepthError()
    const keys = Object.keys(record)
    const schema: SchemaNode = { type: 'object' }
    if (keys.length > 0) {
      const properties: Record<string, SchemaNode> = {}
      for (const key of keys) {
        properties[key] = this.value(record[key], `${pathName}${pascalCase(key)}`, depth + 1, true)
      }
      schema.properties = properties
      schema.required = keys
    }
    if (!hoist) return schema
    const name = this.uniqueName(pathName)
    this.defs[name] = schema
    return { $ref: `#/$defs/${name}` }
  }

  /**
   * $defs 名称去重（冲突追加 2/3…）
   * @param base 期望名字
   */
  private uniqueName(base: string): string {
    const fallback = base === '' ? 'Schema' : base
    let candidate = fallback
    let index = 2
    while (this.usedNames.has(candidate)) {
      candidate = `${fallback}${index}`
      index += 1
    }
    this.usedNames.add(candidate)
    return candidate
  }
}

/**
 * JSON 值 → JSON Schema（draft-07 子集）
 * 规则：对象 → object/properties/required；嵌套对象 → $defs/$ref；
 * 数组取首个元素为 items；整数 → integer；null → string|null union；
 * 字符串不猜 format；空容器只输出 type。
 * @param value 已解析 JSON 值
 * @param rootName 根标题与 $defs 命名前缀
 */
export function jsonToSchema(value: unknown, rootName = 'Root'): SchemaNode {
  const builder = new SchemaBuilder(rootName)
  const root = builder.build(value)
  const schema: SchemaNode = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: rootName,
    ...root
  }
  const defs = builder.definitions()
  if (Object.keys(defs).length > 0) schema.$defs = defs
  return schema
}

/**
 * JSON 文本 → TypeScript 类型代码
 * @param input JSON 文本
 * @param options 根类型名与声明方式
 */
export function generateTypes(input: string, options: GenerateOptions): GenerateOutcome {
  if (input.length > JSON_LIMIT) return failure('MD_INPUT_TOO_LONG')
  if (!isValidRootName(options.rootName)) return failure('MD_TS_NAME_INVALID')
  if (input.trim() === '') return { ok: true, value: { code: '' } }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (err) {
    return failure('MD_JSON_INVALID', errorText(err))
  }

  try {
    if (options.style === 'json-schema') {
      const schema = jsonToSchema(parsed, options.rootName)
      return { ok: true, value: { code: `${JSON.stringify(schema, null, 2)}\n` } }
    }
    const shape = infer(parsed, 0)
    const emitter = new Emitter(options.rootName, options.style)
    return { ok: true, value: { code: emitter.render(shape) } }
  } catch (err) {
    if (err instanceof DepthError) return failure('MD_JSON_INVALID', '嵌套过深（上限 64 层）')
    return failure('MD_JSON_INVALID', errorText(err))
  }
}
