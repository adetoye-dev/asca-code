/**
 * App.tsx — ACSA Code Desktop IDE
 *
 * Mounts the complete VS Code workbench layout (IdeLayout) powered by
 * DockviewReact, Monaco Editor with Copilot ghost text autocomplete,
 * and the physical filesystem verification pipeline.
 */

import { usePipeline } from "./hooks/usePipeline";
import { IdeLayout } from "./components/layout/IdeLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";

export function App() {
  const pipeline = usePipeline();
  return (
    <ErrorBoundary fallbackTitle="ACSA Code Workbench Error">
      <IdeLayout {...pipeline} />
    </ErrorBoundary>
  );
}

export default App;
