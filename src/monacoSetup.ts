/**
 * monacoSetup.ts — point @monaco-editor/react at our locally bundled Monaco.
 *
 * By default @monaco-editor/loader fetches Monaco from
 * `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs` at runtime. That
 * makes the editor — the core surface of this app — depend on the public
 * internet, so an offline or packaged desktop build shows an empty editor.
 * Register the `monaco-editor` package we ship instead, and take the web
 * workers from the same bundle so there is no second CDN fetch.
 *
 * Imported from the lazily-loaded editor components, so Monaco stays out of the
 * initial bundle and is only paid for once a file is actually opened.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
// Paths follow monaco-editor's `exports` map (`"./*": "./esm/vs/*.js"`), so the
// `esm/vs/` prefix must be omitted here.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

export { monaco };
