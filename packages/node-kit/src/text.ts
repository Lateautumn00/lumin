/** detail 截尾（spec §5：长文本保留尾部 ≤max 字符，超长以省略号起头） */
export function tail(text: string, max = 2000): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`
}
