import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// White/black alphas (bg-white/5, border-black/10 ...) read as glass in dark mode
// and vanish or turn muddy in light mode. Components must use theme tokens.
// esquery regex literals cannot contain '/', hence \x2F.
const THEME_ALPHA = String.raw`/\b(bg|border|text|ring|from|via|to|divide|placeholder)-(white|black)\x2F/`
const THEME_ALPHA_MESSAGE =
  'White/black alpha utilities break the light theme. Use tokens instead (bg-glass-fill, border-glass-border, border-hairline, bg-surface-tint, text-text-*).'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    ignores: ['eslint.config.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${THEME_ALPHA}]`, message: THEME_ALPHA_MESSAGE },
        { selector: `TemplateElement[value.raw=${THEME_ALPHA}]`, message: THEME_ALPHA_MESSAGE },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'next-env.d.ts',
    '.venv/**',
    'meshy/**',
    'linkedin-mcp/**',
    'cv/**',
    'img/**',
    '.claude-flow/**',
    'test-results/**',
    'playwright-report/**',
  ]),
])
