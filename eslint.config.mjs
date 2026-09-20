/**
 * eslint.config.mjs — lint, and specifically accessibility.
 *
 * There was no linter here at all, so "is this accessible?" had no answer
 * beyond reading the JSX. That is how the settings navigation ended up as
 * clickable `<div>`s: in the accessibility tree it is a single run of text, so
 * VoiceOver cannot reach it and neither can a keyboard.
 *
 * `jsx-a11y`'s recommended set is the floor, not a style preference — every
 * rule in it is a bug class, not a matter of taste. Type-aware rules are
 * deliberately off: this runs on every save, and type-checking the whole
 * project to lint one file is not worth the wait.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".tauri/**",
      "core-engine/**",
      "src/components/ui/TechLogos.tsx",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Rules of hooks are a correctness rule, not a preference: a conditional
      // hook is a crash waiting for the right render order.
      "react-hooks/rules-of-hooks": "error",
      // Exhaustive deps has real false positives, and this app leans on stable
      // refs and module-level functions. A warning keeps it visible without
      // blocking a change on a judgement call.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "vite*.ts", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Empty catch blocks are a deliberate idiom here — "this is best-effort,
      // and the comment above says why" — so only bare empty blocks are an
      // error. Unused-var checking is already a hard error in `tsc`.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // The app uses `any` at its IPC boundary on purpose.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
