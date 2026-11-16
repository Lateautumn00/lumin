/** electron-vite node worker 入口（`?modulePath` → 绝对路径字符串） */
declare module '*?modulePath' {
  const src: string
  export default src
}

/** vite 资产 URL（pdfjs worker 文件等；工具包内不可解析 vite/client 类型） */
declare module '*?url' {
  const src: string
  export default src
}
