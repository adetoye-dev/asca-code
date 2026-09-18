/** @type {import('tailwindcss').Config} */
/**
 * A design token as a Tailwind colour that honours the `/opacity` modifier.
 *
 * The tokens are hex — `var(--surface-workbench)` is `#0f0f12` — and Tailwind
 * cannot apply an alpha modifier to a `var()`. It does not emit a wrong rule, it
 * emits *no* rule: `bg-workbench/60` was silently dropped, so the element fell
 * back to the browser's white and a text field rendered white-on-white. This
 * keeps each token single-sourced and computes the alpha at use instead.
 */
const token = (variable) => ({ opacityValue }) =>
  opacityValue === undefined || opacityValue === null
    ? `var(${variable})`
    : `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#09090b",
        surface: "#18181b",
        border: "#27272a",
        canvas: token("--surface-canvas"),
        workbench: token("--surface-workbench"),
        panel: token("--surface-panel"),
        overlay: token("--surface-overlay"),
        modal: token("--surface-modal"),
        elevated: token("--surface-elevated"),
        "surface-subtle": token("--surface-subtle"),
        "surface-hover": token("--surface-hover"),
        "surface-active": token("--surface-active"),
        "surface-selected": token("--surface-selected"),
        "border-hairline": token("--border-hairline"),
        "border-accent": token("--border-accent"),
        "border-focus": token("--border-focus"),
        // `bg-hairline/80` (a 1px divider) and `bg-primary-action/90` (a pressed
        // button) were both dead: `hairline` existed only as a borderColor and
        // `primary-action` only as a backgroundColor, where the `/alpha` form is
        // not resolved.
        hairline: token("--border-hairline"),
        "primary-action": token("--action-primary"),
      },
      borderColor: {
        hairline: token("--border-hairline"),
        subtle: token("--border-subtle"),
        strong: token("--border-strong"),
        accent: token("--border-accent"),
        focus: token("--border-focus"),
      },
      textColor: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        accent: "var(--text-accent)",
        "primary-icon": "var(--text-primary-icon)",
      },
      borderRadius: {
        pill: "var(--radius-xl)",
        dropdown: "var(--dropdown-radius-outer)",
        modal: "var(--radius-2xl)",
        card: "var(--radius-lg)",
        panel: "var(--radius-xl)",
      },
      boxShadow: {
        "elevation-1": "var(--shadow-elevation-1)",
        "elevation-2": "var(--shadow-elevation-2)",
        "elevation-3": "var(--shadow-elevation-3)",
      },
      fontFamily: {
        sans: [
          "var(--ide-ui-font)",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--ide-mono-font)",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
}
