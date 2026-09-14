/**
 * monacoTsConfig.ts — Make Monaco's TypeScript worker behave like the project.
 *
 * Monaco runs its own TypeScript language service inside a web worker. That
 * worker knows nothing about the project's tsconfig.json, node_modules, or files
 * that are not currently open, so left unconfigured it reports a wall of bogus,
 * unfixable errors on every .tsx file:
 *
 *   - "Cannot use JSX unless the '--jsx' flag is provided. (17004)"
 *   - "Cannot find module 'react'. Did you mean to set 'moduleResolution'... (2792)"
 *
 * We mirror tsconfig.json, load the ambient declarations Monaco cannot discover
 * on its own, and suppress module-resolution diagnostics that a browser worker
 * can never satisfy. Authoritative type checking remains `npm run typecheck`.
 */

/** Declaration files Monaco cannot discover but that real code depends on. */
const EXTRA_LIBS = [
  "node_modules/vite/client.d.ts",
  "node_modules/@types/react/index.d.ts",
  "node_modules/@types/react/jsx-runtime.d.ts",
  "node_modules/@types/react/jsx-dev-runtime.d.ts",
  "node_modules/@types/react-dom/index.d.ts",
  "node_modules/@types/react-dom/client.d.ts",
  "node_modules/@types/node/index.d.ts",
];

/** 2307 = cannot find module; 2792 = cannot find module (did you mean ...). */
const DIAGNOSTIC_CODES_TO_IGNORE = [2307, 2792];

let configured = false;

export function configureMonacoTypeScript(monaco: any, projectRoot = ""): void {
  const typescript = monaco?.languages?.typescript;
  if (!typescript || configured) return;
  configured = true;

  const { ScriptTarget, ModuleKind, ModuleResolutionKind, JsxEmit } = typescript;
  const compilerOptions = {
    target: ScriptTarget?.ES2020 ?? 7,
    module: ModuleKind?.ESNext ?? 99,
    moduleResolution:
      ModuleResolutionKind?.Bundler ?? ModuleResolutionKind?.NodeJs ?? 2,
    jsx: JsxEmit?.ReactJSX ?? 4,
    jsxImportSource: "react",
    allowJs: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
    strict: true,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
  };

  typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
  typescript.javascriptDefaults.setCompilerOptions({
    ...compilerOptions,
    checkJs: false,
  });

  typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: DIAGNOSTIC_CODES_TO_IGNORE,
  });
  typescript.typescriptDefaults.setEagerModelSync(true);
  typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  // The automatic JSX runtime lives in a node_modules subpath Monaco cannot
  // resolve, so declare it just enough for type checking of .tsx files.
  for (const runtimeModule of ["react/jsx-runtime", "react/jsx-dev-runtime"]) {
    typescript.typescriptDefaults.addExtraLib(
      `declare module "${runtimeModule}" {
  export const Fragment: any;
  export const jsx: any;
  export const jsxs: any;
  export const jsxDEV: any;
}`,
      `acsa-shim-${runtimeModule.replace(/\//g, "-")}.d.ts`
    );
  }

  void loadAmbientTypes(typescript, projectRoot);
}

async function loadAmbientTypes(
  typescript: any,
  projectRoot: string
): Promise<void> {
  for (const libPath of EXTRA_LIBS) {
    try {
      const res = await fetch("/api/fs/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: libPath, projectRoot }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.content) {
        typescript.typescriptDefaults.addExtraLib(data.content, libPath);
      }
    } catch {
      // Best effort: a missing lib just means slightly less resolution.
    }
  }
}
