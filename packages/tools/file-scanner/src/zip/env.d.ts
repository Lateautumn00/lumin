/** electron-vite node worker 入口（`?modulePath` → 绝对路径字符串） */
declare module '*?modulePath' {
  const modulePath: string
  export default modulePath
}
