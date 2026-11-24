/**
 * @file CSS 文本内联导入类型声明
 * @author cuilanchao
 * @date 2026-11-24
 * @description 允许 `import cssText from '*.css?inline'`（Vite 特性）通过 TS 校验。
 */
declare module '*.css?inline' {
  const cssText: string
  export default cssText
}

/** mind-elixir 基础样式（side-effect import） */
declare module 'mind-elixir/style.css'
