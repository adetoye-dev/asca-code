/**
 * BrandLogos.tsx — Authentic AI Model, Provider & IDE Vector Logos
 *
 * Provides standardized, pixel-perfect vector SVGs matching authentic brand identities
 * from the logo.dev AI companies directory and official brand kits:
 * - ACSA Code IDE Brand Mark
 * - OpenAI (ChatGPT, Codex, o1, o3, GPT-4o)
 * - Anthropic Claude (Terracotta Starburst)
 * - Google Gemini (DeepMind Multimodal Spark)
 * - DeepSeek (Aquatic Whale Fin)
 * - Meta / Llama (Meta Infinity Ribbon)
 * - Mistral AI (Warm Orange Pixel Staircase)
 * - Groq (LPU Speed Engine)
 * - Local Ollama (Authentic Llama Silhouette)
 * - Cohere (Coral & Slate Pebble Cells)
 * - Perplexity AI (Intertwined Asterisk Knot)
 * - Hugging Face (Collaboration Face & Hugging Hands)
 * - xAI / Grok (Geometric Monogram X)
 * - Moonshot AI / Kimi (Lunar Orbit & Crescent)
 * - Qwen / Alibaba Cloud (Faceted Hexagonal Prism)
 * - Together AI (Interconnected Hex-Rings)
 * - Replicate (3-Tier Geometric Stencil)
 * - Scale AI (Geometric Chevron S-Mark)
 * - ElevenLabs (Twin Vertical Acoustic Slashes)
 * - Stability AI (Diffusion Swirl Helix)
 * - Midjourney (Sailboat Emblem)
 * - Runway (Geometric Studio R with Inner Counter)
 * - Databricks (4-Layer Isometric Tiered Planes)
 * - GitHub Copilot (Authentic Pilot Robot Helmet)
 * - GitHub (Authentic Octocat Silhouette)
 * - llama.cpp (Cyan Terminal Microchip)
 * - OpenRouter (Connected Routing Gateway)
 * - Cognition AI / Devin (Geometric Diamond Monogram)
 * - AI21 Labs (Magenta & Violet Dual-Hex Bracket)
 * - Pinecone (Vector Database Node Grid)
 * - Character.AI (Speech Avatar Node)
 * - Inflection AI / Pi (Curved Inflection Loop)
 * - Poolside (Cyan Wave Ripple Code Engine)
 * - Luma AI (Dream Machine Luminous Aperture)
 * - Deterministic Offline AST (Syntax Node Tree)
 *
 * Conforms to ACSA Code design system token standards:
 * - `size?: "xs" | "sm" | "md" | "lg" | number`
 *   - "xs": 12px
 *   - "sm": 16px
 *   - "md": 20px
 *   - "lg": 24px
 *   - number: raw pixel dimension
 * - `className?: string` (Tailwind sizing classes work seamlessly when size is omitted)
 * - Clean SVG vectors with current/proper brand fills and accessible ARIA attributes
 */

import React, { useId } from "react";
import {
  computeLogoStyle,
  resolveLogoSize,
  type LogoSize,
} from "./logoSizing";

export { computeLogoStyle, LOGO_SIZE_MAP, resolveLogoSize } from "./logoSizing";
export type { LogoSize } from "./logoSizing";

// ── Design System Size Tokens ──────────────────────────────────────────────
export interface LogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: LogoSize;
  title?: string;
}

/**
 * Checks whether target string contains token bounded by start/end or non-alphanumeric separators.
 * Prevents false positives like "meshflow" matching "hf" or "custom-provider" matching "ide".
 */
function hasToken(target: string, token: string): boolean {
  const pattern = new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`, "i");
  return pattern.test(target);
}

// ── ACSA Code Brand Mark ────────────────────────────────────────────────
export function IdeBrandLogo({ className = "w-4 h-4 shrink-0", size, style, title = "ACSA Code", ...rest }: LogoProps) {
  const rawId = useId();
  const gradientId = rawId.replace(/:/g, "_");
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${gradientId}-ideGrad`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="0.5" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="#18181b" stroke="#27272a" strokeWidth="1.5" />
      <path
        d="M9 22L16 8L23 22M11.5 17H20.5"
        stroke={`url(#${gradientId}-ideGrad)`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="8" r="1.5" fill="#38bdf8" />
    </svg>
  );
}

// ── Anthropic Claude (Terracotta Starburst) ──────────────────────────────────
export function ClaudeLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Anthropic Claude", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="m4.714 15.956 4.718-2.648.079-.23-.079-.128h-.23l-.79-.049-2.695-.073-2.338-.097-2.265-.121-.57-.122-.535-.704.055-.352.48-.322.686.06 1.517.104 2.277.158 1.652.097 2.446.255h.389l.055-.158-.134-.097-.103-.097-2.513-1.68-2.55-1.688-1.336-.971-.722-.492-.365-.461-.158-1.008.656-.723.88.061.225.061.892.686 1.907 1.475 2.489 1.834.364.303.146-.103.018-.073-.164-.273-1.354-2.447-1.445-2.49-.643-1.031-.17-.62a2.8 2.8 0 0 1-.104-.728L6.287.134 6.7 0l.995.134.42.364.618 1.415 1.002 2.228 1.555 3.03.455.898.243.832.09.255h.159v-.146l.127-1.706.237-2.095.23-2.695.08-.759.376-.911.747-.492.583.28.48.685-.067.444-.285 1.851-.559 2.902-.364 1.943h.212l.243-.243.984-1.305 1.651-2.065.729-.819.85-.905.546-.431h1.032l.76 1.13-.34 1.165-1.063 1.348-.88 1.141-1.263 1.7-.79 1.36.073.11.189-.019 2.853-.607 1.542-.28 1.84-.315.832.388.09.395-.327.807-1.967.486-2.307.461-3.437.814-.042.03.048.061 1.549.146.661.036h1.621l3.018.225.79.522.473.638-.079.485-1.214.62-1.64-.389-3.824-.91-1.312-.328h-.182v.109l1.093 1.069 2.003 1.809 2.508 2.331.127.577-.322.455-.34-.048-2.204-1.658-.85-.747-1.925-1.62h-.127v.17l.443.65 2.344 3.52.121 1.081-.17.352-.607.213-.668-.122-1.372-1.924-1.205-1.894-1.141-1.943-.14.079-.674 7.255-.316.37-.728.28-.607-.462-.322-.746.322-1.476.388-1.924.316-1.53.285-1.9.17-.632-.012-.042-.14.018-1.432 1.967-2.18 2.945-1.724 1.846-.413.164-.716-.37.066-.662.401-.589 2.386-3.036 1.439-1.882.93-1.087-.007-.158h-.054l-6.339 4.116-1.13.146-.485-.455.06-.747.231-.243 1.907-1.311Z"
        fill="#D97757"
      />
    </svg>
  );
}
export const AnthropicLogo = ClaudeLogo;

// ── OpenAI (Green / Teal Swirl Vortex) ───────────────────────────────────────
export function OpenAiLogo({ className = "w-4 h-4 shrink-0", size, style, title = "OpenAI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="M20.5 9.7a5.5 5.5 0 0 0-.5-4.2 5.6 5.6 0 0 0-5.4-2.7 5.4 5.4 0 0 0-4-1.8 5.6 5.6 0 0 0-5.2 3.6 5.5 5.5 0 0 0-3.6 2.6 5.6 5.6 0 0 0 .6 6 5.5 5.5 0 0 0 .5 4.2 5.6 5.6 0 0 0 5.4 2.7 5.4 5.4 0 0 0 4 1.8 5.6 5.6 0 0 0 5.2-3.6 5.5 5.5 0 0 0 3.6-2.6 5.6 5.6 0 0 0-.6-6zm-7.6 11.2a4.2 4.2 0 0 1-2.6-.9l.1-.1 4.3-2.5a.7.7 0 0 0 .4-.6v-6.1l1.8 1.1a.1.1 0 0 1 .1.1v5a4.2 4.2 0 0 1-4.1 4zm-7.9-3.4a4.2 4.2 0 0 1-.5-2.7l.1.1 4.3 2.5a.7.7 0 0 0 .7 0l5.3-3-1.8-1.1a.1.1 0 0 1-.1 0l-4.3 2.5a4.2 4.2 0 0 1-3.7-.3zm-1.5-8.5a4.2 4.2 0 0 1 2.1-1.8v5.2a.7.7 0 0 0 .4.6l5.3 3.1-1.8 1a.1.1 0 0 1-.1 0l-4.3-2.5a4.2 4.2 0 0 1-1.6-5.6zm13.6 2.2-5.3-3.1 1.8-1a.1.1 0 0 1 .1 0l4.3 2.5a4.2 4.2 0 0 1 1.6 5.6 4.2 4.2 0 0 1-2.1 1.8v-5.2a.7.7 0 0 0-.4-.6zm2.3-1.9-.1-.1-4.3-2.5a.7.7 0 0 0-.7 0l-5.3 3.1 1.8 1a.1.1 0 0 1 .1 0l4.3-2.5a4.2 4.2 0 0 1 4.2.5zm-8.3 1.9 2.3 1.3v2.7l-2.3-1.3v-2.7z"
        fill="#10A37F"
      />
    </svg>
  );
}

// ── GitHub Copilot (Robot Head / Pilot Visor Helmet) ─────────────────────────
function LegacyCopilotLogo({ className = "w-4 h-4 shrink-0", size, style, title = "GitHub Copilot", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      {/* GitHub Copilot Pilot Helmet with Ear Cups and Visor Eyes */}
      <path
        fill="#A371F7"
        d="M12 3c-4.97 0-9 3.8-9 8.5 0 2.37 1.05 4.52 2.76 6.06l-.26 2.04c-.07.56.41 1.03.96.95l2.42-.37c.97.45 2.02.72 3.12.72s2.15-.27 3.12-.72l2.42.37c.55.08 1.03-.39.96-.95l-.26-2.04C20.95 16.02 22 13.87 22 11.5 22 6.8 17.97 3 12 3zm0 2c4.07 0 7.35 3.03 7.35 6.75 0 1.95-.88 3.7-2.3 4.93l-.47.4.22 1.7-1.46-.22-.57.27c-.85.4-1.78.62-2.77.62s-1.92-.22-2.77-.62l-.57-.27-1.46.22.22-1.7-.47-.4C8.53 15.45 7.65 13.7 7.65 11.75 7.65 8.03 10.93 5 12 5zm-3.5 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
      />
    </svg>
  );
}

// ── GitHub (Authentic Octocat Silhouette) ────────────────────────────────────
export function GithubLogo({ className = "w-4 h-4 shrink-0", size, style, title = "GitHub", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        fill="#A371F7"
        d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 4.6 3 8.6 7.2 9.9.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.4-2.3-.3-4.8-1.2-4.8-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1.9-.2 1.8-.4 2.7-.4s1.8.1 2.7.4c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.5 5-4.8 5.3.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9 0-5.8-4.7-10.5-10.5-10.5z"
      />
    </svg>
  );
}

// ── Google Gemini (Multi-Color Gradient 4-Point Spark) ───────────────────────
export function GeminiLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Google Gemini", ...rest }: LogoProps) {
  const rawId = useId();
  const gradientId = rawId.replace(/:/g, "_");
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${gradientId}-geminiGrad`} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A73E8" />
          <stop offset="0.4" stopColor="#8AB4F8" />
          <stop offset="0.75" stopColor="#D93025" />
          <stop offset="1" stopColor="#F29900" />
        </linearGradient>
      </defs>
      <path
        d="M12 1C12 7.075 7.075 12 1 12C7.075 12 12 16.925 12 23C12 16.925 16.925 12 23 12C16.925 12 12 7.075 12 1Z"
        fill={`url(#${gradientId}-geminiGrad)`}
      />
    </svg>
  );
}

// ── Google Official Brand Mark (Authentic 4-Color 'G') ──────────────────────
export function GoogleLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Google", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
        fill="#34A853"
      />
      <path
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ── Local Ollama (Authentic Llama Silhouette) ────────────────────────────────
export function OllamaLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Ollama", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        fill="#E4E4E7"
        d="M18.5 7.5a2.5 2.5 0 0 0-2.5-2.5h-1V3a1 1 0 0 0-1.7-.7L11.6 4H9.5A2.5 2.5 0 0 0 7 6.5v2.7L5.3 11a2.5 2.5 0 0 0-1.3 2.2v5.3a2.5 2.5 0 0 0 2.5 2.5h1.5v-3h2v3h4v-3h2v3h1.5a2.5 2.5 0 0 0 2.5-2.5v-8a2.5 2.5 0 0 0-1.5-2.3V7.5zM9 7.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H9v-2z"
      />
    </svg>
  );
}

// ── Mistral AI (Warm Orange Pixel Staircase) ─────────────────────────────────
export function MistralLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Mistral AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect x="3" y="3" width="4" height="4" fill="#FF7000" />
      <rect x="17" y="3" width="4" height="4" fill="#FF7000" />
      <rect x="3" y="10" width="18" height="4" fill="#FF7000" />
      <rect x="3" y="17" width="4" height="4" fill="#FF7000" />
      <rect x="10" y="17" width="4" height="4" fill="#FF7000" />
      <rect x="17" y="17" width="4" height="4" fill="#FF7000" />
    </svg>
  );
}

// ── DeepSeek (Aquatic Whale Fin) ─────────────────────────────────────────────
export function DeepSeekLogo({ className = "w-4 h-4 shrink-0", size, style, title = "DeepSeek", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        fill="#4D6BFE"
        d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-1.077-.546l.006-.002.396-.763.003-.004c.154-.265.503-.311.782-.122a.485.485 0 0 1 .184.664.453.453 0 0 1-.294.273z"
      />
    </svg>
  );
}

// ── Meta / Llama (Infinity Ribbon) ───────────────────────────────────────────
function LegacyMetaLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Meta Llama", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        fill="#0866FF"
        d="M6.88 4.05c-1.15 0-2.24.46-3.05 1.28C2.2 6.95 1.5 8.9 1.5 11.23c0 2.87 1.13 5.3 3.01 6.87 1.25 1.05 2.76 1.62 4.37 1.62 2.37 0 4.54-1.24 5.92-3.15 1.38 1.91 3.55 3.15 5.92 3.15 1.61 0 3.12-.57 4.37-1.62 1.88-1.57 3.01-4 3.01-6.87 0-2.33-.7-4.28-2.33-5.9-.81-.82-1.9-1.28-3.05-1.28-2.03 0-3.9 1.11-5.06 2.84C10.78 5.16 8.91 4.05 6.88 4.05zm0 2.4c1.47 0 2.85.95 3.63 2.35l.8 1.43.8-1.43c.78-1.4 2.16-2.35 3.63-2.35.79 0 1.53.31 2.08.87 1.15 1.15 1.68 2.68 1.68 4.88 0 2.1-.81 3.86-2.12 4.96-.86.72-1.89 1.11-2.99 1.11-1.8 0-3.41-1.07-4.14-2.73l-.9-2.06-.9 2.06c-.73 1.66-2.34 2.73-4.14 2.73-1.1 0-2.13-.39-2.99-1.11C3.81 16.06 3 14.3 3 12.2c0-2.2.53-3.73 1.68-4.88.55-.56 1.29-.87 2.08-.87z"
      />
    </svg>
  );
}
export const LlamaLogo = MetaLogo;

// ── Groq (Speed LPU Engine) ─────────────────────────────────────────────────
export function GroqLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Groq", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#F55036" />
      <path
        d="M12 5.5a6.5 6.5 0 1 0 6.17 8.5h-2.58A4.2 4.2 0 1 1 12 7.8c1.65 0 3.08.97 3.75 2.37H12v2.33h6.35c.1-.5.15-1.02.15-1.55 0-4.11-3.34-5.45-6.5-5.45z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

// ── Cohere (Coral & Slate Pebble Cells) ──────────────────────────────────────
export function CohereLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Cohere", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="M8.128 14.1c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0 0 18.1 1H7.55A6.55 6.55 0 0 0 1 7.55c0 3.617 2.745 6.55 7.128 6.55z"
        fill="#FF7759"
      />
      <path
        d="M15.872 9.9c-.592 0-1.77.033-3.398.703-1.897.781-5.672 2.2-8.395 3.656-1.905 1.018-2.74 2.366-2.74 4.18A4.56 4.56 0 0 0 5.9 23h10.551A6.55 6.55 0 0 0 23 16.45c0-3.617-2.745-6.55-7.128-6.55z"
        fill="#39594D"
      />
    </svg>
  );
}

// ── Perplexity AI (Intertwined Asterisk Knot - 1:1 Square Normalized) ────────
export function PerplexityLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Perplexity AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <g transform="translate(4, 0)">
        <path
          d="m23.566 1.398-9.495 9.504h9.495V1.398Zm-9.496 9.504L4.574 1.398v9.504h9.496Zm-.021-10.902v36m9.517-15.596-9.495-9.504v13.625l9.495 9.504v-13.625Zm-18.991 0 9.496-9.504v13.625l-9.496 9.504v-13.625ZM.5 10.9v13.57h4.074v-4.066l9.496-9.504H.5Zm13.57 0 9.495 9.504v4.066h4.075v-13.57h-13.57Z"
          fill="none"
          stroke="#20B8CD"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

// ── Hugging Face (Collaboration Face & Hugging Hands) ────────────────────────
export function HuggingFaceLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Hugging Face", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="10" fill="#FFD21E" />
      <path d="M7.5 9.5c.5-1 1.5-1 2 0M14.5 9.5c.5-1 1.5-1 2 0" stroke="#1F2937" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="12.5" r="1.5" fill="#F87171" fillOpacity="0.7" />
      <circle cx="18" cy="12.5" r="1.5" fill="#F87171" fillOpacity="0.7" />
      <path d="M8.5 13.5c.8 1.8 2.2 2.5 3.5 2.5s2.7-.7 3.5-2.5" stroke="#1F2937" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 14c1.5 2 3.5 2 4.5.5M21.5 14c-1.5 2-3.5 2-4.5.5" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ── xAI / Grok (Geometric Monogram) ─────────────────────────────────────────
export function XAiLogo({ className = "w-4 h-4 shrink-0", size, style, title = "xAI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993l-9.508-13.838zm-2.837 3.3-.929-1.33L3.076 1.56h3.182l5.96 8.528.929 1.33 7.747 11.082h-3.182l-6.315-9.038z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
export const GrokLogo = XAiLogo;

// ── Moonshot AI / Kimi (Lunar Orbit & Crescent) ──────────────────────────────
export function MoonshotLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Moonshot AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" stroke="#6366F1" strokeWidth="2" />
      <path
        d="M12 3a9 9 0 0 0 0 18c2.5 0 4.8-.9 6.5-2.5A9.5 9.5 0 0 1 9.5 5.5c.8-.9 1.6-1.7 2.5-2.5z"
        fill="#6366F1"
      />
      <circle cx="17.5" cy="8.5" r="2" fill="#38BDF8" />
    </svg>
  );
}
export const KimiLogo = MoonshotLogo;

// ── Qwen / Alibaba Cloud (Faceted Hexagonal Prism) ──────────────────────────
export function QwenLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Qwen", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="M12 2L20.5 7V17L12 22L3.5 17V7L12 2Z"
        stroke="#615CED"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 2V12M12 12L20.5 17M12 12L3.5 17"
        stroke="#818CF8"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.5" fill="#615CED" />
    </svg>
  );
}
export const AlibabaLogo = QwenLogo;

// ── Together AI (Interconnected Hex-Rings) ──────────────────────────────────
export function TogetherLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Together AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <circle cx="8" cy="8" r="4.5" stroke="#3B82F6" strokeWidth="2" fill="#3B82F6" fillOpacity="0.2" />
      <circle cx="16" cy="8" r="4.5" stroke="#6366F1" strokeWidth="2" fill="#6366F1" fillOpacity="0.2" />
      <circle cx="12" cy="15" r="4.5" stroke="#A855F7" strokeWidth="2" fill="#A855F7" fillOpacity="0.2" />
    </svg>
  );
}

// ── Replicate (3-Tier Geometric Stencil) ─────────────────────────────────────
export function ReplicateLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Replicate", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d="M24 10.262v2.712h-9.518V24h-3.034V10.262zm0-5.131v2.717H8.755V24H5.722V5.131zM24 0v2.715H2.992V24H0V0z" fill="#F4F4F5" />
    </svg>
  );
}

// ── Scale AI (Geometric Chevron S-Mark) ──────────────────────────────────────
function LegacyScaleLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Scale AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      {/* Authentic Scale AI Interlocking Geometric Block */}
      <path
        d="M3 4h11v4.5H8v3H3V4zm18 16H10v-4.5h6v-3h5V20z"
        fill="#D1D5DB"
      />
      <path
        d="M17 4l4 4.5M3 15.5l4 4.5"
        stroke="#9CA3AF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── ElevenLabs (Twin Vertical Acoustic Slashes) ──────────────────────────────
export function ElevenLabsLogo({ className = "w-4 h-4 shrink-0", size, style, title = "ElevenLabs", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d="M5.5 2v20h4V2zm9 0v20h4V2z" fill="#F4F4F5" />
    </svg>
  );
}

// ── Stability AI (Diffusion Swirl Helix) ─────────────────────────────────────
export function StabilityLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Stability AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      {/* Stability AI Diffusion Helix Segments */}
      <circle cx="12" cy="7" r="3.5" fill="#A855F7" />
      <circle cx="12" cy="17" r="3.5" fill="#EC4899" />
      <circle cx="7" cy="12" r="2.8" fill="#8B5CF6" />
      <circle cx="17" cy="12" r="2.8" fill="#F43F5E" />
      <path
        d="M8.5 8.5C9.5 7.5 14.5 7.5 15.5 8.5M8.5 15.5C9.5 16.5 14.5 16.5 15.5 15.5"
        stroke="#C084FC"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Midjourney (Sailboat Emblem) ─────────────────────────────────────────────
function LegacyMidjourneyLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Midjourney", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d="M4 18c4 2.5 12 2.5 16 0-1 3-5 4-8 4s-7-1-8-4z" fill="#38BDF8" fillOpacity="0.4" stroke="#38BDF8" strokeWidth="1.2" />
      <path d="M12 3c1 5 4 10 7 13-4 1-8 1-11-2 2-3 3-7 4-11z" fill="#38BDF8" stroke="#38BDF8" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// ── Runway (Geometric Studio R with Inner Counter) ──────────────────────────
export function RunwayLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Runway", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#141416" stroke="#27272A" strokeWidth="1" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 6h6a3.5 3.5 0 0 1 0 7H7V6zm2.5 2.5v2h3.5a1 1 0 0 0 0-2H9.5zm-.5 6.5h3.5l3.5 5h-2.8l-2.7-4H9v4H7v-5z"
        fill="#E2F952"
      />
    </svg>
  );
}

// ── Databricks (4-Layer Isometric Tiered Planes) ─────────────────────────────
export function DatabricksLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Databricks", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d="M1 14.2 12 20.4l9.9-5.5v2.2L12 22.7l-10.5-6-.5.3v.8L12 24l11-6.2v-4.3l-.5-.3L12 19.1l-9.9-5.7v-2.2L12 16.8l11-6.2V6.3l-.5-.3L12 11.7 2.1 6.1V3.9L12 9.5 22.5 3.6 23 3.9v-.8L12 0 1 6.2v4.3l.5.3L12 5.1l9.9 5.7v2.2L12 7.4 1.5 13.3l-.5.3v.6z" fill="#FF3621" />
    </svg>
  );
}

// ── llama.cpp (Terminal Microchip) ──────────────────────────────────────────
export function LlamaCppLogo({ className = "w-4 h-4 shrink-0", size, style, title = "llama.cpp", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="#06B6D4" strokeWidth="2" />
      <path d="M9 9h6v6H9z" fill="#06B6D4" fillOpacity="0.4" />
      <path d="M2 9h3M2 15h3M19 9h3M19 15h3M9 2v3M15 2v3M9 19v3M15 19v3" stroke="#06B6D4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── OpenRouter (Connected Routing Gateway) ──────────────────────────────────
export function OpenRouterLogo({ className = "w-4 h-4 shrink-0", size, style, title = "OpenRouter", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <circle cx="6" cy="12" r="3" stroke="#6366F1" strokeWidth="2" fill="#6366F1" fillOpacity="0.2" />
      <circle cx="18" cy="6" r="3" stroke="#38BDF8" strokeWidth="2" fill="#38BDF8" fillOpacity="0.2" />
      <circle cx="18" cy="18" r="3" stroke="#A855F7" strokeWidth="2" fill="#A855F7" fillOpacity="0.2" />
      <path d="M9 12h3m0 0l3-4.5m-3 4.5l3 4.5" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// ── Cognition AI / Devin (Geometric Diamond Monogram) ───────────────────────
function LegacyCognitionLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Cognition AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#0F172A" stroke="#1E293B" strokeWidth="1" />
      <path
        d="M12 4L19 12L12 20L5 12L12 4Z"
        stroke="#38BDF8"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" fill="#0284C7" />
      <path d="M12 4V9.5M12 14.5V20M5 12H9.5M14.5 12H19" stroke="#38BDF8" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ── AI21 Labs (Magenta & Violet Dual-Hex Bracket) ───────────────────────────
export function Ai21Logo({ className = "w-4 h-4 shrink-0", size, style, title = "AI21 Labs", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path
        d="M7 4H4v16h3M17 4h3v16h-3"
        stroke="#8B5CF6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 9l2-3 2 3v6l-2 3-2-3V9z"
        fill="#C084FC"
        fillOpacity="0.3"
        stroke="#C084FC"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="1.5" fill="#EC4899" />
    </svg>
  );
}

// ── Pinecone (Vector Database Node Grid) ────────────────────────────────────
function LegacyPineconeLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Pinecone", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect x="4" y="4" width="4.5" height="4.5" rx="1" fill="#10B981" />
      <rect x="10" y="4" width="4.5" height="4.5" rx="1" fill="#10B981" />
      <rect x="15.5" y="4" width="4.5" height="4.5" rx="1" fill="#10B981" fillOpacity="0.4" />
      <rect x="4" y="10" width="4.5" height="4.5" rx="1" fill="#10B981" />
      <rect x="10" y="10" width="4.5" height="4.5" rx="1" fill="#059669" />
      <rect x="15.5" y="10" width="4.5" height="4.5" rx="1" fill="#10B981" />
      <rect x="4" y="15.5" width="4.5" height="4.5" rx="1" fill="#10B981" fillOpacity="0.4" />
      <rect x="10" y="15.5" width="4.5" height="4.5" rx="1" fill="#10B981" />
      <rect x="15.5" y="15.5" width="4.5" height="4.5" rx="1" fill="#10B981" />
    </svg>
  );
}

// ── Character.AI (Speech Avatar Node) ───────────────────────────────────────
function LegacyCharacterAiLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Character.AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#3B82F6" />
      <path
        d="M6 8a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-1l-3 3v-3H10a4 4 0 0 1-4-4V8z"
        fill="#FFFFFF"
      />
      <circle cx="10" cy="10" r="1.2" fill="#3B82F6" />
      <circle cx="14" cy="10" r="1.2" fill="#3B82F6" />
    </svg>
  );
}

// ── Inflection AI / Pi (Curved Inflection Loop) ──────────────────────────────
function LegacyInflectionLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Inflection AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#0D2818" stroke="#1B4332" strokeWidth="1" />
      <path
        d="M7 17V8c0-1.5 1-2.5 2.5-2.5S12 6.5 12 8v9M17 17V8c0-1.5-.8-2.5-2-2.5"
        stroke="#52B788"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M5 8h14" stroke="#52B788" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Poolside (Cyan Wave Ripple Code Engine) ─────────────────────────────────
function LegacyPoolsideLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Poolside", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#082F49" stroke="#0C4A6E" strokeWidth="1" />
      <path
        d="M4 10c2.5 0 3-2 5.5-2s3 2 5.5 2 3-2 5-2M4 14c2.5 0 3-2 5.5-2s3 2 5.5 2 3-2 5-2M4 18c2.5 0 3-2 5.5-2s3 2 5.5 2 3-2 5-2"
        stroke="#38BDF8"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Luma AI (Dream Machine Luminous Aperture) ────────────────────────────────
function LegacyLumaLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Luma AI", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#18181B" stroke="#27272A" strokeWidth="1" />
      <circle cx="12" cy="12" r="7" stroke="#F43F5E" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.5" fill="#FB7185" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#F43F5E" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ── Deterministic AST Synthesizer (Syntax Node Tree) ─────────────────────────
export function DeterministicLogo({ className = "w-4 h-4 shrink-0", size, style, title = "Deterministic AST", ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={computeLogoStyle(size, style)}
      role="img"
      aria-label={title}
      {...rest}
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="5" r="2.5" fill="#10B981" />
      <circle cx="6" cy="17" r="2" fill="#10B981" />
      <circle cx="18" cy="17" r="2" fill="#10B981" />
      <path d="M12 7.5L6 15M12 7.5l6 7.5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── AI Company & Provider Registry ──────────────────────────────────────────
export interface AIBrandMetadata {
  id: string;
  name: string;
  domain: string;
  category: "frontier" | "cloud" | "local" | "open-source" | "platform" | "specialized";
  primaryColor: string;
  description: string;
  component: React.ComponentType<LogoProps>;
  aliases: string[];
}

export const AI_BRAND_REGISTRY: Record<string, AIBrandMetadata> = {
  acsa: {
    id: "acsa",
    name: "ACSA Code",
    domain: "acsa.internal",
    category: "local",
    primaryColor: "#38BDF8",
    description: "ACSA Code IDE native brand mark and system runtime.",
    component: IdeBrandLogo,
    aliases: ["acsa", "acsa-code", "ide", "workbench"],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    domain: "openai.com",
    category: "frontier",
    primaryColor: "#10A37F",
    description: "Frontier research lab behind GPT-5.5, GPT-5.4, o3, and Codex.",
    component: OpenAiLogo,
    aliases: ["openai", "chatgpt", "gpt", "codex", "dall-e", "o1", "o3", "whisper"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    domain: "anthropic.com",
    category: "frontier",
    primaryColor: "#D97757",
    description: "AI safety and frontier research lab, creators of Claude Fable 5.1 & Opus 5.",
    component: ClaudeLogo,
    aliases: ["anthropic", "claude", "sonnet", "haiku", "opus"],
  },
  google: {
    id: "google",
    name: "Google Gemini",
    domain: "google.com",
    category: "frontier",
    primaryColor: "#1A73E8",
    description: "Google DeepMind frontier multimodal models (Gemini 3.8 Flash & Pro).",
    component: GeminiLogo,
    aliases: ["google", "gemini", "deepmind", "gemma", "bard"],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    domain: "deepseek.com",
    category: "open-source",
    primaryColor: "#4D6BFE",
    description: "Open-weights frontier reasoning models (DeepSeek-V4-Pro & Flash).",
    component: DeepSeekLogo,
    aliases: ["deepseek", "deepseek-chat", "deepseek-reasoner", "deepseek-coder", "deepseek-r1", "r1"],
  },
  meta: {
    id: "meta",
    name: "Meta / Llama",
    domain: "meta.com",
    category: "open-source",
    primaryColor: "#0866FF",
    description: "Open-weights frontier model family (Llama 3.1, 3.2, 3.3).",
    component: MetaLogo,
    aliases: ["meta", "llama", "llama2", "llama3", "llama-3", "facebook"],
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    domain: "mistral.ai",
    category: "frontier",
    primaryColor: "#FF7000",
    description: "European frontier lab, creators of Mistral Large 3 & Devstral.",
    component: MistralLogo,
    aliases: ["mistral", "codestral", "mixtral", "pixtral", "ministral"],
  },
  groq: {
    id: "groq",
    name: "Groq",
    domain: "groq.com",
    category: "cloud",
    primaryColor: "#F55036",
    description: "Ultra-high-speed LPU inference engine for instant tokens.",
    component: GroqLogo,
    aliases: ["groq", "groq-cloud"],
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    domain: "ollama.com",
    category: "local",
    primaryColor: "#E4E4E7",
    description: "Private on-device local runtime for open-weights models.",
    component: OllamaLogo,
    aliases: ["ollama", "local-ollama"],
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    domain: "cohere.com",
    category: "cloud",
    primaryColor: "#FF7759",
    description: "Enterprise language models including Command R+ and multilingual Aya.",
    component: CohereLogo,
    aliases: ["cohere", "command", "command-r", "command-r-plus", "aya"],
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity AI",
    domain: "perplexity.ai",
    category: "cloud",
    primaryColor: "#20B8CD",
    description: "Conversational answer engine powered by live-indexed Sonar models.",
    component: PerplexityLogo,
    aliases: ["perplexity", "sonar", "sonar-pro", "pplx"],
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    domain: "huggingface.co",
    category: "platform",
    primaryColor: "#FFD21E",
    description: "Open AI collaboration ecosystem and community model repository.",
    component: HuggingFaceLogo,
    aliases: ["huggingface", "hugging_face", "hugging-face", "hf"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    domain: "x.ai",
    category: "frontier",
    primaryColor: "#FFFFFF",
    description: "Frontier lab creators of Grok 2 & Grok 3.",
    component: XAiLogo,
    aliases: ["xai", "x-ai", "grok", "grok-2", "x.ai"],
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot AI",
    domain: "moonshot.cn",
    category: "cloud",
    primaryColor: "#6366F1",
    description: "Frontier AI lab behind Kimi ultra-long context models.",
    component: MoonshotLogo,
    aliases: ["moonshot", "kimi", "moonshot-ai", "moonshotai"],
  },
  qwen: {
    id: "qwen",
    name: "Qwen (Alibaba)",
    domain: "alibabacloud.com",
    category: "open-source",
    primaryColor: "#615CED",
    description: "Alibaba Cloud open frontier code and reasoner models (Qwen 2.5 Coder).",
    component: QwenLogo,
    aliases: ["qwen", "alibaba", "aliyun", "tongyi", "qwen2.5"],
  },
  together: {
    id: "together",
    name: "Together AI",
    domain: "together.ai",
    category: "cloud",
    primaryColor: "#3B82F6",
    description: "Cloud compute platform for high-throughput open-source model inference.",
    component: TogetherLogo,
    aliases: ["together", "together-ai", "togetherai"],
  },
  replicate: {
    id: "replicate",
    name: "Replicate",
    domain: "replicate.com",
    category: "cloud",
    primaryColor: "#F4F4F5",
    description: "Cloud infrastructure for running open-source models with simple APIs.",
    component: ReplicateLogo,
    aliases: ["replicate"],
  },
  scale: {
    id: "scale",
    name: "Scale AI",
    domain: "scale.com",
    category: "specialized",
    primaryColor: "#D1D5DB",
    description: "Enterprise data annotation and model evaluation platform.",
    component: ScaleLogo,
    aliases: ["scale", "scale-ai", "scaleai"],
  },
  elevenlabs: {
    id: "elevenlabs",
    name: "ElevenLabs",
    domain: "elevenlabs.io",
    category: "specialized",
    primaryColor: "#F4F4F5",
    description: "Voice synthesis, text-to-speech, and audio generative AI.",
    component: ElevenLabsLogo,
    aliases: ["elevenlabs", "eleven-labs"],
  },
  stability: {
    id: "stability",
    name: "Stability AI",
    domain: "stability.ai",
    category: "specialized",
    primaryColor: "#A855F7",
    description: "Generative media pioneers behind Stable Diffusion.",
    component: StabilityLogo,
    aliases: ["stability", "stabilityai", "stable-diffusion"],
  },
  midjourney: {
    id: "midjourney",
    name: "Midjourney",
    domain: "midjourney.com",
    category: "specialized",
    primaryColor: "#38BDF8",
    description: "Leading creative visual and image synthesis generative AI.",
    component: MidjourneyLogo,
    aliases: ["midjourney"],
  },
  runway: {
    id: "runway",
    name: "Runway",
    domain: "runwayml.com",
    category: "specialized",
    primaryColor: "#E2F952",
    description: "Generative video and creative media research lab (Gen-2, Gen-3).",
    component: RunwayLogo,
    aliases: ["runway", "runwayml"],
  },
  databricks: {
    id: "databricks",
    name: "Databricks",
    domain: "databricks.com",
    category: "platform",
    primaryColor: "#FF3621",
    description: "Data and AI platform, creators of DBRX and MosaicML.",
    component: DatabricksLogo,
    aliases: ["databricks", "dbrx", "mosaicml"],
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    domain: "copilot.github.com",
    category: "platform",
    primaryColor: "#A371F7",
    description: "GitHub Copilot code completion and workspace assistant.",
    component: CopilotLogo,
    aliases: ["copilot", "gh-copilot", "github-copilot"],
  },
  github: {
    id: "github",
    name: "GitHub",
    domain: "github.com",
    category: "platform",
    primaryColor: "#A371F7",
    description: "GitHub developer platform and code hosting ecosystem.",
    component: GithubLogo,
    aliases: ["github", "octocat"],
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp (Local GGUF)",
    domain: "github.com/ggerganov/llama.cpp",
    category: "local",
    primaryColor: "#06B6D4",
    description: "Fast local GGUF model execution with CPU/Metal hardware acceleration.",
    component: LlamaCppLogo,
    aliases: ["llamacpp", "llama.cpp", "gguf", "local"],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    domain: "openrouter.ai",
    category: "platform",
    primaryColor: "#6366F1",
    description: "Unified gateway routing to hundreds of frontier and open-weights models.",
    component: OpenRouterLogo,
    aliases: ["openrouter", "open-router"],
  },
  cognition: {
    id: "cognition",
    name: "Cognition AI",
    domain: "cognition.ai",
    category: "frontier",
    primaryColor: "#38BDF8",
    description: "Applied AI lab and creators of Devin, the autonomous AI software engineer.",
    component: CognitionLogo,
    aliases: ["cognition", "cognition-ai", "devin", "cognition.ai"],
  },
  ai21: {
    id: "ai21",
    name: "AI21 Labs",
    domain: "ai21.com",
    category: "frontier",
    primaryColor: "#8B5CF6",
    description: "Frontier enterprise models and creators of the Jamba hybrid SSM-transformer architecture.",
    component: Ai21Logo,
    aliases: ["ai21", "ai21-labs", "jamba", "ai21.com"],
  },
  pinecone: {
    id: "pinecone",
    name: "Pinecone",
    domain: "pinecone.io",
    category: "platform",
    primaryColor: "#10B981",
    description: "Specialized cloud vector database for fast similarity search and AI memory.",
    component: PineconeLogo,
    aliases: ["pinecone", "pinecone-io", "pinecone.io"],
  },
  character: {
    id: "character",
    name: "Character.AI",
    domain: "character.ai",
    category: "cloud",
    primaryColor: "#3B82F6",
    description: "Conversational open-ended dialogue and personalized interactive agents.",
    component: CharacterAiLogo,
    aliases: ["character", "character-ai", "characterai", "c.ai", "character.ai"],
  },
  inflection: {
    id: "inflection",
    name: "Inflection AI",
    domain: "inflection.ai",
    category: "frontier",
    primaryColor: "#10B981",
    description: "Empathetic conversational intelligence studio and creators of Pi.",
    component: InflectionLogo,
    aliases: ["inflection", "inflection-ai", "pi", "pi-ai", "inflection.ai"],
  },
  poolside: {
    id: "poolside",
    name: "Poolside",
    domain: "poolside.ai",
    category: "frontier",
    primaryColor: "#06B6D4",
    description: "Foundation models purpose-built for software engineering and code intelligence.",
    component: PoolsideLogo,
    aliases: ["poolside", "poolside-ai", "poolside.ai"],
  },
  luma: {
    id: "luma",
    name: "Luma AI",
    domain: "luma.ai",
    category: "specialized",
    primaryColor: "#F43F5E",
    description: "Multimodal generative video and 3D visual intelligence (Dream Machine).",
    component: LumaLogo,
    aliases: ["luma", "luma-ai", "dream-machine", "lumalabs", "luma.ai"],
  },
  deterministic: {
    id: "deterministic",
    name: "Deterministic AST",
    domain: "offline.internal",
    category: "local",
    primaryColor: "#10B981",
    description: "Zero-latency offline AST synthesis and rule-based code transformations.",
    component: DeterministicLogo,
    aliases: ["deterministic", "ast", "offline"],
  },
};

/**
 * Resolves any provider ID, model identifier, custom endpoint URL, or alias
 * into a canonical brand key registered in AI_BRAND_REGISTRY and BRAND_LOGO_URLS.
 */
export function resolveBrandId(providerOrModel: string): string {
  const p = (providerOrModel || "").toLowerCase().trim();
  if (!p) return "deterministic";

  // 1. Exact match in registry by ID or exact domain/alias
  if (AI_BRAND_REGISTRY[p]) return p;
  for (const item of Object.values(AI_BRAND_REGISTRY)) {
    if (
      item.domain.toLowerCase() === p ||
      item.aliases.some((a) => a.toLowerCase() === p)
    ) {
      return item.id;
    }
  }

  // 2. URL / Domain Normalization
  let lookup = p;
  if (lookup.includes("://") || lookup.includes("/")) {
    try {
      const urlStr = lookup.includes("://") ? lookup : `https://${lookup}`;
      const parsed = new URL(urlStr);
      lookup = parsed.hostname.toLowerCase();
      if (AI_BRAND_REGISTRY[lookup]) return lookup;
      for (const item of Object.values(AI_BRAND_REGISTRY)) {
        if (
          item.domain.toLowerCase() === lookup ||
          lookup.endsWith("." + item.domain.toLowerCase()) ||
          item.aliases.some((a) => a.toLowerCase() === lookup)
        ) {
          return item.id;
        }
      }
    } catch {}
  }

  // 3. Subdomain match (e.g. "api.groq.com" -> groq)
  for (const item of Object.values(AI_BRAND_REGISTRY)) {
    const itemDomain = item.domain.toLowerCase();
    if (lookup.endsWith("." + itemDomain)) {
      return item.id;
    }
  }

  // 4. Gateway/hub namespace prefix resolution
  if (p.startsWith("hf/") || p.startsWith("huggingface/") || p.startsWith("hf:") || p.startsWith("hf.co/")) {
    return "huggingface";
  }
  if (p.startsWith("openrouter/")) {
    return "openrouter";
  }
  if (p.startsWith("together/")) {
    return "together";
  }

  // 5. Token-bounded model identifier and vendor prefix heuristic resolution
  if (
    p.includes("claude") ||
    p.includes("anthropic") ||
    hasToken(p, "sonnet") ||
    hasToken(p, "haiku") ||
    hasToken(p, "opus")
  ) {
    return "anthropic";
  }
  if (
    p.includes("openai") ||
    p.includes("chatgpt") ||
    p.includes("codex") ||
    p.includes("dall-e") ||
    p.includes("whisper") ||
    hasToken(p, "gpt") ||
    hasToken(p, "gpt-4") ||
    hasToken(p, "gpt-4o") ||
    hasToken(p, "gpt-3") ||
    hasToken(p, "gpt-5") ||
    /(?:^|[-_/.:])o[134](?:-mini|-preview|[-_/.:]|$)/i.test(p)
  ) {
    return "openai";
  }
  if (p.includes("gemini") || p.includes("google") || p.includes("gemma") || p.includes("deepmind") || p.includes("bard")) {
    return "google";
  }
  if (p.includes("deepseek")) {
    return "deepseek";
  }
  if (p.includes("llama") || p.includes("meta")) {
    return "meta";
  }
  if (p.includes("mistral") || p.includes("codestral") || p.includes("mixtral") || p.includes("pixtral") || p.includes("ministral")) {
    return "mistral";
  }
  if (p.includes("groq")) {
    return "groq";
  }
  if (p.includes("ollama")) {
    return "ollama";
  }
  if (p.includes("cohere") || p.includes("command-r") || p.includes("command") || hasToken(p, "aya")) {
    return "cohere";
  }
  if (p.includes("perplexity") || p.includes("sonar") || hasToken(p, "pplx")) {
    return "perplexity";
  }
  if (p.includes("huggingface") || p.includes("hugging_face") || hasToken(p, "hf")) {
    return "huggingface";
  }
  if (p.includes("xai") || p.includes("grok") || p.includes("x.ai")) {
    return "xai";
  }
  if (p.includes("moonshot") || p.includes("kimi")) {
    return "moonshot";
  }
  if (p.includes("qwen") || p.includes("alibaba") || p.includes("aliyun") || p.includes("tongyi")) {
    return "qwen";
  }
  if (p.includes("together")) {
    return "together";
  }
  if (p.includes("replicate")) {
    return "replicate";
  }
  if (hasToken(p, "scale") || p.includes("scale-ai") || p.includes("scaleai")) {
    return "scale";
  }
  if (p.includes("elevenlabs") || p.includes("eleven-labs")) {
    return "elevenlabs";
  }
  if (p.includes("stability") || p.includes("stable-diffusion")) {
    return "stability";
  }
  if (p.includes("midjourney")) {
    return "midjourney";
  }
  if (p.includes("runway") || p.includes("runwayml")) {
    return "runway";
  }
  if (p.includes("databricks") || p.includes("dbrx") || p.includes("mosaicml")) {
    return "databricks";
  }
  if (p.includes("copilot")) {
    return "copilot";
  }
  if (p.includes("github") || p.includes("octocat")) {
    return "github";
  }
  if (p.includes("llamacpp") || p.includes("gguf") || p === "local") {
    return "llamacpp";
  }
  if (p.includes("openrouter")) {
    return "openrouter";
  }
  if (p.includes("cognition") || p.includes("devin")) {
    return "cognition";
  }
  if (p.includes("ai21") || p.includes("jamba")) {
    return "ai21";
  }
  if (p.includes("pinecone")) {
    return "pinecone";
  }
  if (p.includes("character.ai") || p.includes("characterai") || hasToken(p, "character")) {
    return "character";
  }
  if (p.includes("inflection") || hasToken(p, "pi")) {
    return "inflection";
  }
  if (p.includes("poolside")) {
    return "poolside";
  }
  if (p.includes("luma") || p.includes("dream-machine")) {
    return "luma";
  }
  if (p.includes("acsa") || hasToken(p, "ide") || hasToken(p, "workbench")) {
    return "acsa";
  }

  return "deterministic";
}

/**
 * Retrieve metadata for a recognized AI brand by ID, alias, endpoint URL, or model identifier.
 */
export function getBrandMetadata(idOrAliasOrUrl: string): AIBrandMetadata | undefined {
  if (!idOrAliasOrUrl) return undefined;
  const p = idOrAliasOrUrl.toLowerCase().trim();

  // 1. Direct registry lookup by ID or alias or exact domain
  if (AI_BRAND_REGISTRY[p]) return AI_BRAND_REGISTRY[p];
  for (const item of Object.values(AI_BRAND_REGISTRY)) {
    if (
      item.domain.toLowerCase() === p ||
      item.aliases.some((a) => a.toLowerCase() === p)
    ) {
      return item;
    }
  }

  // 2. URL parsing & domain lookup
  if (p.includes("://") || p.includes("/")) {
    try {
      const urlStr = p.includes("://") ? p : `https://${p}`;
      const parsed = new URL(urlStr);
      const hostname = parsed.hostname.toLowerCase();
      if (AI_BRAND_REGISTRY[hostname]) return AI_BRAND_REGISTRY[hostname];
      for (const item of Object.values(AI_BRAND_REGISTRY)) {
        if (
          item.domain.toLowerCase() === hostname ||
          hostname.endsWith("." + item.domain.toLowerCase()) ||
          item.aliases.some((a) => a.toLowerCase() === hostname)
        ) {
          return item;
        }
      }
    } catch {}
  }

  // 3. Subdomain lookup (e.g. api.groq.com)
  for (const item of Object.values(AI_BRAND_REGISTRY)) {
    if (p.endsWith("." + item.domain.toLowerCase())) {
      return item;
    }
  }

  return undefined;
}

/**
 * Retrieve the React Logo component for an AI brand by ID, alias, or domain.
 */
export function getBrandLogo(idOrAlias: string): React.ComponentType<LogoProps> {
  const meta = getBrandMetadata(idOrAlias);
  return meta ? meta.component : DeterministicLogo;
}

// ── Official SVG Asset Paths & Image Loader ─────────────────────────────────
export const BRAND_LOGO_URLS: Record<string, string> = {
  acsa: "/logos/acsa.svg",
  openai: "/logos/openai.svg",
  anthropic: "/logos/anthropic.svg",
  claude: "/logos/claude.svg",
  google: "/logos/google.svg",
  gemini: "/logos/gemini.svg",
  deepseek: "/logos/deepseek.svg",
  meta: "/logos/meta.svg",
  llama: "/logos/llama.svg",
  mistral: "/logos/mistral.svg",
  groq: "/logos/groq.svg",
  ollama: "/logos/ollama.svg",
  cohere: "/logos/cohere.svg",
  perplexity: "/logos/perplexity.svg",
  huggingface: "/logos/huggingface.svg",
  xai: "/logos/xai.svg",
  grok: "/logos/grok.svg",
  moonshot: "/logos/moonshot.svg",
  kimi: "/logos/kimi.svg",
  qwen: "/logos/qwen.svg",
  alibaba: "/logos/alibaba.svg",
  together: "/logos/together.svg",
  replicate: "/logos/replicate.svg",
  scale: "/logos/scale.svg",
  elevenlabs: "/logos/elevenlabs.svg",
  stability: "/logos/stability.svg",
  midjourney: "/logos/midjourney.svg",
  runway: "/logos/runway.svg",
  databricks: "/logos/databricks.svg",
  copilot: "/logos/copilot.svg",
  github: "/logos/github.svg",
  llamacpp: "/logos/llamacpp.svg",
  openrouter: "/logos/openrouter.svg",
  cognition: "/logos/cognition.svg",
  devin: "/logos/devin.svg",
  ai21: "/logos/ai21.svg",
  pinecone: "/logos/pinecone.svg",
  character: "/logos/character.svg",
  inflection: "/logos/inflection.svg",
  pi: "/logos/pi.svg",
  poolside: "/logos/poolside.svg",
  luma: "/logos/luma.svg",
  deterministic: "/logos/deterministic.svg",
};

export function getBrandLogoUrl(providerOrModel: string): string {
  const brandId = resolveBrandId(providerOrModel);
  return BRAND_LOGO_URLS[brandId] ?? BRAND_LOGO_URLS.deterministic;
}

export interface BrandLogoImgProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "size"> {
  providerId: string;
  size?: LogoSize;
  className?: string;
  title?: string;
}

export function BrandLogoImg({
  providerId,
  size,
  className = "w-4 h-4 shrink-0",
  style,
  alt,
  title,
  ...rest
}: BrandLogoImgProps) {
  const resolvedProviderId = resolveBrandId(providerId);
  const src = BRAND_LOGO_URLS[resolvedProviderId] ?? BRAND_LOGO_URLS.deterministic;
  const px = resolveLogoSize(size);
  const computedStyle = computeLogoStyle(size, style);
  const meta = getBrandMetadata(resolvedProviderId);
  const brandTitle = title || meta?.name || providerId;

  return (
    <img
      src={src}
      alt={alt || brandTitle || `${providerId} logo`}
      title={brandTitle}
      className={className}
      style={computedStyle}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      {...rest}
    />
  );
}

void [
  LegacyCopilotLogo,
  LegacyMetaLogo,
  LegacyScaleLogo,
  LegacyMidjourneyLogo,
  LegacyCognitionLogo,
  LegacyPineconeLogo,
  LegacyCharacterAiLogo,
  LegacyInflectionLogo,
  LegacyPoolsideLogo,
  LegacyLumaLogo,
];

export function CopilotLogo({ className, size, style, title = "GitHub Copilot", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="copilot" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function MetaLogo({ className, size, style, title = "Meta Llama", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="meta" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function ScaleLogo({ className, size, style, title = "Scale AI", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="scale" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function MidjourneyLogo({ className, size, style, title = "Midjourney", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="midjourney" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function CognitionLogo({ className, size, style, title = "Cognition AI", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="cognition" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export const DevinLogo = CognitionLogo;

export function PineconeLogo({ className, size, style, title = "Pinecone", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="pinecone" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function CharacterAiLogo({ className, size, style, title = "Character.AI", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="character" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function InflectionLogo({ className, size, style, title = "Inflection AI", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="inflection" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export const PiLogo = InflectionLogo;

export function PoolsideLogo({ className, size, style, title = "Poolside", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="poolside" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

export function LumaLogo({ className, size, style, title = "Luma AI", ...rest }: LogoProps) {
  return <BrandLogoImg providerId="luma" className={className} size={size} style={style} title={title} {...(rest as any)} />;
}

// ── Generic Provider Logo Dispatcher ────────────────────────────────────────
export interface ProviderLogoProps extends LogoProps {
  providerId: string;
  useImg?: boolean;
}

export function ProviderLogo({
  providerId,
  className = "w-4 h-4 shrink-0",
  size,
  style,
  useImg = false,
  ...rest
}: ProviderLogoProps) {
  if (useImg) {
    return (
      <BrandLogoImg
        providerId={providerId}
        size={size}
        className={className}
        style={style}
        {...(rest as any)}
      />
    );
  }

  const brandId = resolveBrandId(providerId);
  const meta = AI_BRAND_REGISTRY[brandId];
  if (meta) {
    const Component = meta.component;
    return <Component className={className} size={size} style={style} {...rest} />;
  }

  return <DeterministicLogo className={className} size={size} style={style} {...rest} />;
}
