/**
 * 依赖边界规则 —— AGENTS.md §2.5 / plan.md §2.5 强制
 */
module.exports = {
  forbidden: [
    {
      name: 'tools-only-allowed-deps',
      comment: '工具包只可依赖 plugin-api/shared/ui/node-kit/ocr-kit（铁律 2）',
      severity: 'error',
      from: { path: '^packages/tools/[^/]+' },
      to: {
        path: '^packages/',
        pathNot: '^packages/(plugin-api|shared|ui|node-kit|ocr-kit)/|^packages/tools/'
      }
    },
    {
      name: 'no-tool-to-tool',
      comment: '工具之间禁止互相 import（铁律 2；group matching 排除同工具内部）',
      severity: 'error',
      from: { path: '^packages/tools/([^/]+)/.+' },
      to: {
        path: '^packages/tools/[^/]+/.+',
        pathNot: '^packages/tools/$1/'
      }
    },
    {
      name: 'no-tool-to-apps',
      comment: '工具禁止依赖应用壳（铁律 6）',
      severity: 'error',
      from: { path: '^packages/tools/' },
      to: { path: '^apps/' }
    },
    {
      name: 'no-renderer-to-main',
      comment: 'renderer 禁止 import main（铁律 6）',
      severity: 'error',
      from: { path: '^apps/desktop/src/renderer/' },
      to: { path: '^apps/desktop/src/main/' }
    },
    {
      name: 'no-circular',
      comment: '禁止循环依赖',
      severity: 'error',
      from: { pathNot: '^node_modules' },
      to: { circular: true }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    exclude: {
      path: '(^|/)(node_modules|dist|out|coverage|release|binaries|userData|\\.turbo|playwright-report|test-results|\\.project-rules|docs|\\.gitee)(/|$)'
    }
  }
}
