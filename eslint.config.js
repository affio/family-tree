import js from '@eslint/js'
import globals from 'globals'

import prettier from 'eslint-plugin-prettier/recommended'

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.commonjs },
    },
  },
]
