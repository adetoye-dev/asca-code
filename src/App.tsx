/**
 * App.tsx — ACSA Code Desktop IDE
 *
 * Mounts the complete VS Code workbench layout (IdeLayout) powered by
 * DockviewReact, Monaco Editor with Copilot ghost text autocomplete,
 * and the physical filesystem verification pipeline.
 *
 * Startup behaviour:
 * - On first launch: silently checks for Ollama; shows setup wizard if absent.
 * - On subsequent launches: shows a small banner if Ollama is not running.
 */

import { useState, useEffect } from "react";
import { usePipeline } from "./hooks/usePipeline";
import { IdeLayout } from "./components/layout/IdeLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  OllamaSetupWizard,
  OllamaNotRunningBanner,
} from "./components/ui/OllamaSetupWizard";
import {
  checkOllamaStatus,
  isFirstLaunchSetup,
  markSetupComplete,
} from "./services/ollamaSetup";
import { loadAllProviders, syncOllamaModels } from "./services/aiModelManager";

export function App() {
  const pipeline = usePipeline();

  const [showWizard, setShowWizard] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  // Startup Ollama probe — runs once after mount
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      // Small delay so the IDE paints first
      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;

      // Skip check entirely if user already has a non-ollama default configured
      const providers = loadAllProviders();
      const defaultP = Object.values(providers).find((p) => p.isDefault);
      if (defaultP && defaultP.id !== "ollama") return;

      const s = await checkOllamaStatus();
      if (cancelled) return;

      if (s.running) {
        // All good — mark setup done silently and sync installed models
        markSetupComplete();
        if (s.models.length > 0) {
          syncOllamaModels(s.models);
        }
        return;
      }

      if (isFirstLaunchSetup()) {
        // First time — show full wizard
        setShowWizard(true);
      } else {
        // Repeat launch without Ollama running — show non-intrusive banner
        setShowBanner(true);
      }
    }
    void probe();
    return () => { cancelled = true; };
  }, []);

  // Listen for explicit requests to open the wizard from Titlebar, Command Palette, etc.
  useEffect(() => {
    const handleOpen = () => {
      setShowBanner(false);
      setShowWizard(true);
    };
    window.addEventListener("acsa:open-ollama-wizard", handleOpen);
    return () => window.removeEventListener("acsa:open-ollama-wizard", handleOpen);
  }, []);

  return (
    <ErrorBoundary fallbackTitle="ACSA Code Workbench Error">
      <IdeLayout {...pipeline} />

      {showWizard && (
        <OllamaSetupWizard
          onClose={() => setShowWizard(false)}
          onComplete={() => setShowWizard(false)}
        />
      )}

      {!showWizard && showBanner && (
        <OllamaNotRunningBanner
          onOpenWizard={() => { setShowBanner(false); setShowWizard(true); }}
          onDismiss={() => setShowBanner(false)}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
