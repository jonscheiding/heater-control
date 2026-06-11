import { fileURLToPath } from "node:url";

import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import * as pluginImportResolverTypescript from "eslint-import-resolver-typescript";
import pluginImport from "eslint-plugin-import";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  includeIgnoreFile(
    fileURLToPath(new URL(".gitignore", import.meta.url)),
    ".gitignore files",
  ),
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [
      // eslint-disable-next-line import/no-named-as-default-member
      tseslint.configs.recommended,
      // eslint-disable-next-line import/no-named-as-default-member
      tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },
  {
    files: ["{infra,api}/**/*.{ts,mts,cts}", "*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["web/**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: globals.browser,
    },
    extends: [
      pluginReact.configs.flat.recommended!,
      pluginReact.configs.flat["jsx-runtime"]!,
      pluginReactHooks.configs.flat["recommended-latest"],
    ],
    settings: {
      react: { version: "18" },
    },
  },
  {
    files: ["**/*.{ts,mts,cts}"],
    extends: [
      pluginImport.flatConfigs.recommended,
      pluginImport.flatConfigs.typescript,
    ],
    settings: {
      "import/internal-regex": "^@heater-control/",
      "import/resolver": {
        node: { extensions: [".js", ".jsx", ".ts", ".tsx"] },
        typescript: pluginImportResolverTypescript,
      },
    },
    rules: {
      "import/order": [
        "error",
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
        },
      ],
    },
  },
]);
