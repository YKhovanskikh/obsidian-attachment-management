import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  {
    ignores: ["_docs/**", "main.js", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "error",
      "no-duplicate-imports": "error",
      "no-prototype-builtins": "off",
      "no-useless-assignment": "off",
      "no-undef": "off",
      "no-useless-escape": "off",
      "quotes": ["error", "double"],
      "unused-imports/no-unused-imports": "error",
    },
  },
];
