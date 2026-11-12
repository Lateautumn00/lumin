import pluginVue from 'eslint-plugin-vue'
import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import prettier from '@vue/eslint-config-prettier/skip-formatting'

export default withVueTs(
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/.turbo/**',
      'release/**',
      'playwright-report/**',
      'test-results/**',
      'binaries/**',
      'userData/**'
    ]
  },
  prettier
)
