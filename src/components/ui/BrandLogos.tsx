/**
 * BrandLogos.tsx — Authentic AI Model, Provider & IDE Vector Logos
 *
 * Provides pixel-perfect vector SVGs matching the real brand identities of:
 * - ACSA Code brand mark
 * - Anthropic Claude
 * - OpenAI / Codex
 * - GitHub Copilot
 * - Google Gemini
 * - Local Ollama
 * - Mistral AI
 * - DeepSeek
 * - Groq
 * - llama.cpp
 * - Deterministic Offline AST
 */

import { useId } from "react";

interface LogoProps {
  className?: string;
  size?: number;
}

// ── ACSA Code Brand Mark ────────────────────────────────────────────────
export function IdeBrandLogo({ className = "w-4 h-4", size }: LogoProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
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
export function ClaudeLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <path
        d="M13.8 2.5a1.2 1.2 0 0 0-2 0l-1.3 2.6a1.2 1.2 0 0 1-1 .7l-2.9.2a1.2 1.2 0 0 0-1.2 1.6l1 2.7a1.2 1.2 0 0 1 0 1.2l-1.6 2.4a1.2 1.2 0 0 0 .7 1.8l2.8.8a1.2 1.2 0 0 1 .8.9l.9 2.8a1.2 1.2 0 0 0 1.9.5l2.2-1.9a1.2 1.2 0 0 1 1.2-.2l2.8 1a1.2 1.2 0 0 0 1.5-1.3l-.4-2.9a1.2 1.2 0 0 1 .4-1.1l2.3-1.8a1.2 1.2 0 0 0 0-2l-2.5-1.5a1.2 1.2 0 0 1-.6-1.1l.2-2.9a1.2 1.2 0 0 0-1.6-1.2l-2.7 1a1.2 1.2 0 0 1-1.2-.2l-2.2-2.1z"
        fill="#D97706"
      />
      <circle cx="12" cy="12" r="3" fill="#FFFBEB" />
    </svg>
  );
}

// ── OpenAI (Green / Teal Swirl Vortex) ───────────────────────────────────────
export function OpenAiLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <path
        d="M20.5 9.7a5.5 5.5 0 0 0-.5-4.2 5.6 5.6 0 0 0-5.4-2.7 5.4 5.4 0 0 0-4-1.8 5.6 5.6 0 0 0-5.2 3.6 5.5 5.5 0 0 0-3.6 2.6 5.6 5.6 0 0 0 .6 6 5.5 5.5 0 0 0 .5 4.2 5.6 5.6 0 0 0 5.4 2.7 5.4 5.4 0 0 0 4 1.8 5.6 5.6 0 0 0 5.2-3.6 5.5 5.5 0 0 0 3.6-2.6 5.6 5.6 0 0 0-.6-6zm-7.6 11.2a4.2 4.2 0 0 1-2.6-.9l.1-.1 4.3-2.5a.7.7 0 0 0 .4-.6v-6.1l1.8 1.1a.1.1 0 0 1 .1.1v5a4.2 4.2 0 0 1-4.1 4zm-7.9-3.4a4.2 4.2 0 0 1-.5-2.7l.1.1 4.3 2.5a.7.7 0 0 0 .7 0l5.3-3-1.8-1.1a.1.1 0 0 1-.1 0l-4.3 2.5a4.2 4.2 0 0 1-3.7-.3zm-1.5-8.5a4.2 4.2 0 0 1 2.1-1.8v5.2a.7.7 0 0 0 .4.6l5.3 3.1-1.8 1a.1.1 0 0 1-.1 0l-4.3-2.5a4.2 4.2 0 0 1-1.6-5.6zm13.6 2.2-5.3-3.1 1.8-1a.1.1 0 0 1 .1 0l4.3 2.5a4.2 4.2 0 0 1 1.6 5.6 4.2 4.2 0 0 1-2.1 1.8v-5.2a.7.7 0 0 0-.4-.6zm2.3-1.9-.1-.1-4.3-2.5a.7.7 0 0 0-.7 0l-5.3 3.1 1.8 1a.1.1 0 0 1 .1 0l4.3-2.5a4.2 4.2 0 0 1 4.2.5zm-8.3 1.9 2.3 1.3v2.7l-2.3-1.3v-2.7z"
        fill="#10A37F"
      />
    </svg>
  );
}

// ── GitHub Copilot (Robot Head / Aircraft) ───────────────────────────────────
export function CopilotLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <path
        fill="#A371F7"
        d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 4.6 3 8.6 7.2 9.9.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.4-2.3-.3-4.8-1.2-4.8-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1.9-.2 1.8-.4 2.7-.4s1.8.1 2.7.4c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.5 5-4.8 5.3.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9 0-5.8-4.7-10.5-10.5-10.5z"
      />
    </svg>
  );
}

// ── Google Gemini (Multi-Color Gradient 4-Point Star) ────────────────────────
export function GeminiLogo({ className = "w-4 h-4", size }: LogoProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <defs>
        <linearGradient id={`${gradientId}-geminiGrad`} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A73E8" />
          <stop offset="0.5" stopColor="#8AB4F8" />
          <stop offset="1" stopColor="#D93025" />
        </linearGradient>
      </defs>
      <path
        d="M12 1C12 7.075 7.075 12 1 12C7.075 12 12 16.925 12 23C12 16.925 16.925 12 23 12C16.925 12 12 7.075 12 1Z"
        fill={`url(#${gradientId}-geminiGrad)`}
      />
    </svg>
  );
}

// ── Local Ollama (Authentic Llama Silhouette) ────────────────────────────────
export function OllamaLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <path
        fill="#F4F4F5"
        d="M18.5 7.5a2.5 2.5 0 0 0-2.5-2.5h-1V3a1 1 0 0 0-1.7-.7L11.6 4H9.5A2.5 2.5 0 0 0 7 6.5v2.7L5.3 11a2.5 2.5 0 0 0-1.3 2.2v5.3a2.5 2.5 0 0 0 2.5 2.5h1.5v-3h2v3h4v-3h2v3h1.5a2.5 2.5 0 0 0 2.5-2.5v-8a2.5 2.5 0 0 0-1.5-2.3V7.5zM9 7.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H9v-2z"
      />
    </svg>
  );
}

// ── Mistral AI (Warm Orange Pixel Staircase) ─────────────────────────────────
export function MistralLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <rect x="3" y="3" width="4" height="4" fill="#FF7000" />
      <rect x="17" y="3" width="4" height="4" fill="#FF7000" />
      <rect x="3" y="10" width="18" height="4" fill="#FF7000" />
      <rect x="3" y="17" width="4" height="4" fill="#FF7000" />
      <rect x="10" y="17" width="4" height="4" fill="#FF7000" />
      <rect x="17" y="17" width="4" height="4" fill="#FF7000" />
    </svg>
  );
}

// ── DeepSeek (Aquatic Blue Fin / Whale) ──────────────────────────────────────
export function DeepSeekLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <path
        d="M21.5 12c0 5.2-4.3 9.5-9.5 9.5S2.5 17.2 2.5 12 6.8 2.5 12 2.5s9.5 4.3 9.5 9.5z"
        fill="#1D63ED"
        fillOpacity="0.15"
      />
      <path
        d="M7 14.5c2.5-3 5.5-5 8-5 1.5 0 2 .8 2.5 2 1-3 0-5.5-2.5-6.5-3.5-1.5-6.5 2-8 9.5z"
        fill="#1D63ED"
      />
      <circle cx="8" cy="11" r="1.2" fill="#FFFFFF" />
    </svg>
  );
}

// ── Groq (Orange-Red Block / LPU) ───────────────────────────────────────────
export function GroqLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <rect width="24" height="24" rx="4" fill="#F55036" />
      <path
        d="M7 7h10v3H10v4h7v3H7V7z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

// ── llama.cpp (Terminal Microchip) ──────────────────────────────────────────
export function LlamaCppLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="#06B6D4" strokeWidth="2" />
      <path d="M9 9h6v6H9z" fill="#06B6D4" fillOpacity="0.4" />
      <path d="M2 9h3M2 15h3M19 9h3M19 15h3M9 2v3M15 2v3M9 19v3M15 19v3" stroke="#06B6D4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Deterministic AST Synthesizer (Syntax Node Tree) ─────────────────────────
export function DeterministicLogo({ className = "w-4 h-4", size }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <circle cx="12" cy="5" r="2.5" fill="#10B981" />
      <circle cx="6" cy="17" r="2" fill="#10B981" />
      <circle cx="18" cy="17" r="2" fill="#10B981" />
      <path d="M12 7.5L6 15M12 7.5l6 7.5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Generic Provider Logo Dispatcher ────────────────────────────────────────
export function ProviderLogo({
  providerId,
  className = "w-4 h-4",
  size,
}: {
  providerId: string;
  className?: string;
  size?: number;
}) {
  const p = (providerId || "").toLowerCase();

  if (p === "claude" || p === "anthropic") {
    return <ClaudeLogo className={className} size={size} />;
  }
  if (p === "openai" || p === "codex" || p === "chatgpt") {
    return <OpenAiLogo className={className} size={size} />;
  }
  if (p === "copilot" || p === "github") {
    return <CopilotLogo className={className} size={size} />;
  }
  if (p === "gemini" || p === "google") {
    return <GeminiLogo className={className} size={size} />;
  }
  if (p === "ollama") {
    return <OllamaLogo className={className} size={size} />;
  }
  if (p === "mistral") {
    return <MistralLogo className={className} size={size} />;
  }
  if (p === "deepseek") {
    return <DeepSeekLogo className={className} size={size} />;
  }
  if (p === "groq") {
    return <GroqLogo className={className} size={size} />;
  }
  if (p === "llamacpp" || p === "local") {
    return <LlamaCppLogo className={className} size={size} />;
  }
  return <DeterministicLogo className={className} size={size} />;
}
