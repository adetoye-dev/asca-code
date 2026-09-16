# ACSA Code UI Design System & Architecture Rules

This document establishes the mandatory visual, geometric, and architectural standards for ACSA Code. All future UI modifications and component implementations MUST adhere to these rules without exception.

---

## 1. Design Token Architecture (3-Tier Hierarchy)

ACSA Code strictly enforces a 3-tier CSS token system located in `src/styles/tokens/`:

1. **Tier 1: Primitives (`src/styles/tokens/primitives.css`)**
   - **Apple Obsidian Dark Slate Palette**: Deep dark neutral foundations (`--obsidian-950` down to `--obsidian-50`) with specular highlights and zero muddy gray casts.
   - **4px Grid Spacing Scale**: All padding, margins, and gaps must use a scale token (`--space-1`: 4px, `--space-2`: 8px, `--space-3`: 12px, `--space-4`: 16px, `--space-6`: 24px, `--space-8`: 32px). Half-step tokens (`--space-0-5`: 2px, `--space-1-5`: 6px, `--space-2-5`: 10px) are permitted for optical alignment only.
   - **Concentric Radii Tokens**: `--radius-xs` (4px), `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (10px), `--radius-xl` (12px), `--radius-2xl` (16px), `--radius-3xl` (20px), `--radius-full` (9999px).
   - **Dual-Layer Elevation Shadows**: Specular white rim highlight (`rgba(255, 255, 255, 0.05-0.1)`) paired with diffuse dark ambient occlusion (`--shadow-elevation-1`, `--shadow-elevation-2`, `--shadow-elevation-3`).

2. **Tier 2: Semantics (`src/styles/tokens/semantics.css`)**
   - **Surface Roles**: `--surface-canvas`, `--surface-workbench`, `--surface-panel`, `--surface-overlay`, `--surface-modal`, `--surface-elevated`, `--surface-hover`, `--surface-active`.
   - **Border Roles**: `--border-hairline` (subtle 1px specular boundary), `--border-subtle`, `--border-strong`, `--border-accent`.
   - **Text Roles**: `--text-primary`, `--text-secondary`, `--text-muted`, `--text-accent`.
   - **Dynamic Theme Integration**: Semantic tokens map to dynamic CSS variables injected by `src/services/themeManager.ts`.

3. **Tier 3: Components (`src/styles/tokens/components.css`)**
   - Composite dimensions for Titlebar Pills, Dropdowns, Preferences Modal, and Omnibar.

---

## 2. The Law of Concentric Geometry

The visual radius of an inner item nestled within a padded container MUST be mathematically concentric:

$$R_{\text{outer}} = R_{\text{inner}} + \text{Padding}$$

- **Dropdowns**: Container has $R_{\text{outer}} = 12\text{px}$ (`rounded-dropdown`), padding $P = 4\text{px}$ (`p-1`). Every menu item MUST have $R_{\text{inner}} = 8\text{px}$ (`rounded-[8px]`):
  $$8\text{px} + 4\text{px} = 12\text{px}$$
- **Modals**: Container has $R_{\text{outer}} = 16\text{px}$ (`rounded-modal`). Child cards with 6px gap/padding must have $R_{\text{inner}} = 10\text{px}$ (`rounded-lg`).
- **Never nest dissimilar curvatures**: Placing an 8px radius inside a 4px radius, or sharp squares directly against round containers, is strictly prohibited.
- **Active State Highlighting Standard**: NEVER use one-sided borders (`border-l-`, `border-r-`, `border-t-`, `border-b-`) to indicate an active, selected, or highlighted item. Active and selected states must ALWAYS use a subtle surface background fill (e.g., `bg-white/[0.08]`, `bg-sky-500/15`) with proper rounded corners (`rounded-md`, `rounded-lg`).

---

## 3. Iconography Standard (Lucide React Exclusively)

- All UI icons MUST use **lucide-react** with standardized **1.5px stroke weight**.
- Standardized size tokens MUST be used via `src/components/ui/Icon.tsx`:
  - `"xs"`: 12px
  - `"sm"`: 14px
  - `"md"`: 16px (default)
  - `"lg"`: 20px
  - `"xl"`: 24px
  - `number`: raw pixel value
- Always import from `lucide-react` directly in `Icon.tsx` and use standard `LucideIcon` types.
- `hugeicons-react` and `@vscode/codicons` have been uninstalled and must NOT be used.

---

## 4. Official Brand Assets (AI Providers, Programming Languages & Tech Tools)

- **AI Providers**: Official unaltered vector SVG assets are permanently stored in `public/logos/<provider>.svg` (e.g., `openai.svg`, `anthropic.svg`, `deepseek.svg`, `google.svg`, `meta.svg`, `mistral.svg`, `groq.svg`, `ollama.svg`, `cohere.svg`, `perplexity.svg`, `huggingface.svg`, `together.svg`, etc.). Use `src/components/ui/BrandLogos.tsx` (`<BrandLogoImg providerId="..." />`, `<ProviderLogo providerId="..." />`).
- **Programming Languages & Tech Tools**: Authentic unaltered official assets from the source of truth (`bablubambal/All_logo_and_pictures`) are stored in `public/logos/tech/` and `public/logos/languages/` (78+ tech marks: TypeScript, Python, Rust, Go, C++, React, Vue, Docker, Kubernetes, Linux, etc.). Use `src/components/ui/TechLogos.tsx` (`<TechLogo techId="..." size="sm" />`) or `src/components/ui/FileIcon.tsx`.
- **Zero Custom Redraw Policy**: Never hand-approximate proprietary brand marks or modify vectors into crude custom SVGs. Always preserve byte-for-byte official brand assets directly from source-of-truth repositories.

---

## 5. Universal 5-Glyph Lifecycle Taxonomy

All asynchronous jobs, agent statuses, git branch states, and test results MUST map to the universal 5-glyph taxonomy implemented in `src/components/ui/StatusGlyph.tsx`:

| State | Glyph | Primary Color | Semantic Meaning |
| :--- | :--- | :--- | :--- |
| **Success** | Emerald Checkmark | `#10b981` | Completed, healthy, passed, synced |
| **In-Progress** | Sky Clock (Spinning) | `#0284c7` | Active, running, building, pulling |
| **Needs Action** | Magenta Pie Wedge | `#d946ef` | Requires user action, review, conflict |
| **Pending** | Amber Crescent | `#f59e0b` | Queued, behind remote, waiting |
| **Open** | Gray Dashed Ring | `#71717a` | Idle, empty, unassigned, clean |

Use `<StatusGlyph status="success" size="sm" />` or `<StatusChip status="in-progress" label="Syncing..." size="sm" />`.

---

## 6. Build & Linting Verification

Before finalizing any changes:
1. Ensure TypeScript compiles without errors: `npx tsc --noEmit`.
2. Ensure Vite production build succeeds: `npm run build`.
3. Ensure brand logo verification passes: `npm run test:logos`.
