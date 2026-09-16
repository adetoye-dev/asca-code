/**
 * TechLogos.tsx — Authentic Programming Language & Tech Tool Vector Logos
 *
 * Provides standardized, official brand marks and vectors directly preserved
 * from the source-of-truth repositories (bablubambal/All_logo_and_pictures,
 * official tool repositories, and upstream brand vectors) without hand-coded alterations.
 *
 * Preserves brand authenticity and official vectors by loading exact SVG assets
 * via <img> tags, strictly adhering to ACSA Code design system token standards:
 * - `size?: "xs" | "sm" | "md" | "lg" | "xl" | number`
 *   - "xs": 12px
 *   - "sm": 14px
 *   - "md": 16px
 *   - "lg": 20px
 *   - "xl": 24px
 *   - number: raw pixel dimension
 * - `className?: string` (Tailwind sizing classes work seamlessly when size is omitted)
 */

import type { ImgHTMLAttributes, ReactNode } from "react";
import {
  computeLogoStyle,
  resolveLogoSize,
  type LogoSize,
} from "./logoSizing";

export { computeLogoStyle, LOGO_SIZE_MAP, resolveLogoSize } from "./logoSizing";
export type { LogoSize } from "./logoSizing";

// ── Metadata & Category Definitions ────────────────────────────────────────
export type TechCategory =
  | "language"
  | "framework"
  | "database"
  | "cloud"
  | "tool"
  | "os"
  | "editor"
  | "format";

export interface TechLogoMetadata {
  id: string;
  name: string;
  fileName: string;
  assetPath: string;
  category: TechCategory;
  aliases: string[];
  extensions?: string[];
  exactFiles?: string[];
}

// ── Complete Tech Logo Registry ────────────────────────────────────────────
export const TECH_LOGO_REGISTRY: Record<string, TechLogoMetadata> = {
  // Programming Languages
  typescript: {
    id: "typescript",
    name: "TypeScript",
    fileName: "typescript.svg",
    assetPath: "/logos/tech/typescript.svg",
    category: "language",
    aliases: ["ts"],
    extensions: [".ts", ".mts", ".cts", ".d.ts"],
    exactFiles: ["tsconfig.json", "tsconfig.node.json", "tsconfig.app.json", "tsconfig.base.json"],
  },
  javascript: {
    id: "javascript",
    name: "JavaScript",
    fileName: "javascript.svg",
    assetPath: "/logos/tech/javascript.svg",
    category: "language",
    aliases: ["js", "mjs", "cjs", "es6"],
    extensions: [".js", ".mjs", ".cjs"],
    exactFiles: ["jsconfig.json"],
  },
  python: {
    id: "python",
    name: "Python",
    fileName: "python.svg",
    assetPath: "/logos/tech/python.svg",
    category: "language",
    aliases: ["py", "python3", "py3"],
    extensions: [".py", ".pyw", ".ipynb", ".pyi"],
    exactFiles: ["requirements.txt", "pyproject.toml", "pipfile", "pipfile.lock"],
  },
  rust: {
    id: "rust",
    name: "Rust",
    fileName: "rust.svg",
    assetPath: "/logos/tech/rust.svg",
    category: "language",
    aliases: ["rs", "cargo"],
    extensions: [".rs"],
    exactFiles: ["cargo.toml", "cargo.lock"],
  },
  go: {
    id: "go",
    name: "Go",
    fileName: "go.svg",
    assetPath: "/logos/tech/go.svg",
    category: "language",
    aliases: ["golang"],
    extensions: [".go"],
    exactFiles: ["go.mod", "go.sum", "go.work"],
  },
  cpp: {
    id: "cpp",
    name: "C++",
    fileName: "cpp.svg",
    assetPath: "/logos/tech/cpp.svg",
    category: "language",
    aliases: ["c++", "cplusplus", "hpp", "hxx", "cc"],
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h++"],
  },
  c: {
    id: "c",
    name: "C",
    fileName: "c.svg",
    assetPath: "/logos/tech/c.svg",
    category: "language",
    aliases: ["clang"],
    extensions: [".c", ".h"],
  },
  csharp: {
    id: "csharp",
    name: "C#",
    fileName: "csharp.svg",
    assetPath: "/logos/tech/csharp.svg",
    category: "language",
    aliases: ["c#", "cs", "dotnet"],
    extensions: [".cs", ".csx"],
  },
  java: {
    id: "java",
    name: "Java",
    fileName: "java.svg",
    assetPath: "/logos/tech/java.svg",
    category: "language",
    aliases: ["jvm"],
    extensions: [".java", ".jar", ".class"],
  },
  kotlin: {
    id: "kotlin",
    name: "Kotlin",
    fileName: "kotlin.svg",
    assetPath: "/logos/tech/kotlin.svg",
    category: "language",
    aliases: ["kt"],
    extensions: [".kt", ".kts"],
  },
  swift: {
    id: "swift",
    name: "Swift",
    fileName: "swift.svg",
    assetPath: "/logos/tech/swift.svg",
    category: "language",
    aliases: ["apple-swift"],
    extensions: [".swift"],
  },
  php: {
    id: "php",
    name: "PHP",
    fileName: "php.svg",
    assetPath: "/logos/tech/php.svg",
    category: "language",
    aliases: [],
    extensions: [".php", ".phtml"],
  },
  ruby: {
    id: "ruby",
    name: "Ruby",
    fileName: "ruby.svg",
    assetPath: "/logos/tech/ruby.svg",
    category: "language",
    aliases: ["rb", "gem"],
    extensions: [".rb", ".erb", ".rake"],
    exactFiles: ["gemfile", "gemfile.lock", "rakefile"],
  },
  dart: {
    id: "dart",
    name: "Dart",
    fileName: "dart.svg",
    assetPath: "/logos/tech/dart.svg",
    category: "language",
    aliases: [],
    extensions: [".dart"],
  },
  haskell: {
    id: "haskell",
    name: "Haskell",
    fileName: "haskell.svg",
    assetPath: "/logos/tech/haskell.svg",
    category: "language",
    aliases: ["hs"],
    extensions: [".hs", ".lhs"],
  },
  bash: {
    id: "bash",
    name: "Bash",
    fileName: "bash.svg",
    assetPath: "/logos/tech/bash.svg",
    category: "language",
    aliases: ["sh", "shell", "zsh"],
    extensions: [".sh", ".bash", ".zsh", ".fish"],
    exactFiles: [".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".profile"],
  },
  clojure: {
    id: "clojure",
    name: "Clojure",
    fileName: "clojure.svg",
    assetPath: "/logos/tech/clojure.svg",
    category: "language",
    aliases: ["clj"],
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
  },
  crystal: {
    id: "crystal",
    name: "Crystal",
    fileName: "crystal.svg",
    assetPath: "/logos/tech/crystal.svg",
    category: "language",
    aliases: ["cr"],
    extensions: [".cr"],
  },
  julia: {
    id: "julia",
    name: "Julia",
    fileName: "julia.svg",
    assetPath: "/logos/tech/julia.svg",
    category: "language",
    aliases: ["jl"],
    extensions: [".jl"],
  },
  coffeescript: {
    id: "coffeescript",
    name: "CoffeeScript",
    fileName: "coffeescript.svg",
    assetPath: "/logos/tech/coffeescript.svg",
    category: "language",
    aliases: ["coffee"],
    extensions: [".coffee"],
  },
  html: {
    id: "html",
    name: "HTML5",
    fileName: "html.svg",
    assetPath: "/logos/tech/html.svg",
    category: "language",
    aliases: ["html5", "htm"],
    extensions: [".html", ".htm"],
  },
  css: {
    id: "css",
    name: "CSS3",
    fileName: "css.svg",
    assetPath: "/logos/tech/css.svg",
    category: "language",
    aliases: ["css3"],
    extensions: [".css"],
  },
  sass: {
    id: "sass",
    name: "Sass",
    fileName: "sass.svg",
    assetPath: "/logos/tech/sass.svg",
    category: "language",
    aliases: ["scss"],
    extensions: [".scss", ".sass"],
  },
  graphql: {
    id: "graphql",
    name: "GraphQL",
    fileName: "graphql.svg",
    assetPath: "/logos/tech/graphql.svg",
    category: "language",
    aliases: ["gql"],
    extensions: [".graphql", ".gql"],
  },

  // Frameworks & Libraries
  react: {
    id: "react",
    name: "React",
    fileName: "react.svg",
    assetPath: "/logos/tech/react.svg",
    category: "framework",
    aliases: ["reactjs", "react-native", "tsx", "jsx"],
    extensions: [".tsx", ".jsx"],
  },
  vue: {
    id: "vue",
    name: "Vue.js",
    fileName: "vue.svg",
    assetPath: "/logos/tech/vue.svg",
    category: "framework",
    aliases: ["vuejs", "vue3", "vue2"],
    extensions: [".vue"],
  },
  angular: {
    id: "angular",
    name: "Angular",
    fileName: "angular.svg",
    assetPath: "/logos/tech/angular.svg",
    category: "framework",
    aliases: ["angularjs", "ng"],
  },
  svelte: {
    id: "svelte",
    name: "Svelte",
    fileName: "svelte.svg",
    assetPath: "/logos/tech/svelte.svg",
    category: "framework",
    aliases: ["sveltekit"],
    extensions: [".svelte"],
  },
  nodejs: {
    id: "nodejs",
    name: "Node.js",
    fileName: "nodejs.svg",
    assetPath: "/logos/tech/nodejs.svg",
    category: "framework",
    aliases: ["node"],
  },
  nextjs: {
    id: "nextjs",
    name: "Next.js",
    fileName: "nextjs.svg",
    assetPath: "/logos/tech/nextjs.svg",
    category: "framework",
    aliases: ["next"],
    exactFiles: ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"],
  },
  tauri: {
    id: "tauri",
    name: "Tauri",
    fileName: "tauri.svg",
    assetPath: "/logos/tech/tauri.svg",
    category: "framework",
    aliases: ["tauri-app"],
    exactFiles: ["tauri.conf.json", "tauri.conf.json5"],
  },
  tailwind: {
    id: "tailwind",
    name: "Tailwind CSS",
    fileName: "tailwind.svg",
    assetPath: "/logos/tech/tailwind.svg",
    category: "framework",
    aliases: ["tailwindcss"],
    exactFiles: ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs"],
  },
  deno: {
    id: "deno",
    name: "Deno",
    fileName: "deno.svg",
    assetPath: "/logos/tech/deno.svg",
    category: "framework",
    aliases: [],
    exactFiles: ["deno.json", "deno.jsonc", "deno.lock"],
  },
  django: {
    id: "django",
    name: "Django",
    fileName: "django.svg",
    assetPath: "/logos/tech/django.svg",
    category: "framework",
    aliases: [],
  },
  flask: {
    id: "flask",
    name: "Flask",
    fileName: "flask.svg",
    assetPath: "/logos/tech/flask.svg",
    category: "framework",
    aliases: [],
  },
  laravel: {
    id: "laravel",
    name: "Laravel",
    fileName: "laravel.svg",
    assetPath: "/logos/tech/laravel.svg",
    category: "framework",
    aliases: [],
  },
  rails: {
    id: "rails",
    name: "Ruby on Rails",
    fileName: "rails.svg",
    assetPath: "/logos/tech/rails.svg",
    category: "framework",
    aliases: ["rubyonrails"],
  },
  spring: {
    id: "spring",
    name: "Spring Boot",
    fileName: "spring.svg",
    assetPath: "/logos/tech/spring.svg",
    category: "framework",
    aliases: ["springboot"],
  },
  bootstrap: {
    id: "bootstrap",
    name: "Bootstrap",
    fileName: "bootstrap.svg",
    assetPath: "/logos/tech/bootstrap.svg",
    category: "framework",
    aliases: [],
  },
  jquery: {
    id: "jquery",
    name: "jQuery",
    fileName: "jquery.svg",
    assetPath: "/logos/tech/jquery.svg",
    category: "framework",
    aliases: [],
  },
  redux: {
    id: "redux",
    name: "Redux",
    fileName: "redux.svg",
    assetPath: "/logos/tech/redux.svg",
    category: "framework",
    aliases: [],
  },
  flutter: {
    id: "flutter",
    name: "Flutter",
    fileName: "flutter.svg",
    assetPath: "/logos/tech/flutter.svg",
    category: "framework",
    aliases: [],
  },

  // DevOps & Cloud
  docker: {
    id: "docker",
    name: "Docker",
    fileName: "docker.svg",
    assetPath: "/logos/tech/docker.svg",
    category: "cloud",
    aliases: ["container", "dockerfile"],
    exactFiles: [
      "dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      ".dockerignore",
      "compose.yml",
      "compose.yaml",
      "containerfile",
    ],
  },
  kubernetes: {
    id: "kubernetes",
    name: "Kubernetes",
    fileName: "kubernetes.svg",
    assetPath: "/logos/tech/kubernetes.svg",
    category: "cloud",
    aliases: ["k8s"],
  },
  git: {
    id: "git",
    name: "Git",
    fileName: "git.svg",
    assetPath: "/logos/tech/git.svg",
    category: "tool",
    aliases: ["vcs"],
    exactFiles: [".gitignore", ".gitattributes", ".gitmodules", ".gitconfig", ".gitkeep", ".gitmessage"],
  },
  vite: {
    id: "vite",
    name: "Vite",
    fileName: "vite.svg",
    assetPath: "/logos/tech/vite.svg",
    category: "tool",
    aliases: ["vitejs"],
    exactFiles: ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"],
  },
  npm: {
    id: "npm",
    name: "npm",
    fileName: "npm.svg",
    assetPath: "/logos/tech/npm.svg",
    category: "tool",
    aliases: ["node-package-manager"],
    exactFiles: ["package.json", "package-lock.json"],
  },
  aws: {
    id: "aws",
    name: "Amazon Web Services",
    fileName: "aws.svg",
    assetPath: "/logos/tech/aws.svg",
    category: "cloud",
    aliases: ["amazon", "amazon-web-services"],
  },
  azure: {
    id: "azure",
    name: "Microsoft Azure",
    fileName: "azure.svg",
    assetPath: "/logos/tech/azure.svg",
    category: "cloud",
    aliases: ["ms-azure"],
  },
  gcloud: {
    id: "gcloud",
    name: "Google Cloud Platform",
    fileName: "gcloud.svg",
    assetPath: "/logos/tech/gcloud.svg",
    category: "cloud",
    aliases: ["gcp", "google-cloud"],
  },
  firebase: {
    id: "firebase",
    name: "Firebase",
    fileName: "firebase.svg",
    assetPath: "/logos/tech/firebase.svg",
    category: "cloud",
    aliases: [],
    exactFiles: ["firebase.json"],
  },
  github: {
    id: "github",
    name: "GitHub",
    fileName: "github.svg",
    assetPath: "/logos/tech/github.svg",
    category: "cloud",
    aliases: [],
  },
  gitlab: {
    id: "gitlab",
    name: "GitLab",
    fileName: "gitlab.svg",
    assetPath: "/logos/tech/gitlab.svg",
    category: "cloud",
    aliases: [],
  },
  ansible: {
    id: "ansible",
    name: "Ansible",
    fileName: "ansible.svg",
    assetPath: "/logos/tech/ansible.svg",
    category: "cloud",
    aliases: [],
  },

  // Databases
  postgresql: {
    id: "postgresql",
    name: "PostgreSQL",
    fileName: "postgresql.svg",
    assetPath: "/logos/tech/postgresql.svg",
    category: "database",
    aliases: ["postgres", "pgsql"],
    extensions: [".sql"],
  },
  mysql: {
    id: "mysql",
    name: "MySQL",
    fileName: "mysql.svg",
    assetPath: "/logos/tech/mysql.svg",
    category: "database",
    aliases: [],
  },
  mongodb: {
    id: "mongodb",
    name: "MongoDB",
    fileName: "mongodb.svg",
    assetPath: "/logos/tech/mongodb.svg",
    category: "database",
    aliases: ["mongo"],
  },
  redis: {
    id: "redis",
    name: "Redis",
    fileName: "redis.svg",
    assetPath: "/logos/tech/redis.svg",
    category: "database",
    aliases: [],
  },
  oracle: {
    id: "oracle",
    name: "Oracle",
    fileName: "oracle.svg",
    assetPath: "/logos/tech/oracle.svg",
    category: "database",
    aliases: [],
  },
  cassandra: {
    id: "cassandra",
    name: "Apache Cassandra",
    fileName: "cassandra.svg",
    assetPath: "/logos/tech/cassandra.svg",
    category: "database",
    aliases: [],
  },

  // Formats
  json: {
    id: "json",
    name: "JSON",
    fileName: "json.svg",
    assetPath: "/logos/tech/json.svg",
    category: "format",
    aliases: [],
    extensions: [".json"],
  },
  markdown: {
    id: "markdown",
    name: "Markdown",
    fileName: "markdown.svg",
    assetPath: "/logos/tech/markdown.svg",
    category: "format",
    aliases: ["md"],
    extensions: [".md", ".markdown"],
  },

  // Operating Systems
  linux: {
    id: "linux",
    name: "Linux",
    fileName: "linux.svg",
    assetPath: "/logos/tech/linux.svg",
    category: "os",
    aliases: ["tux"],
  },
  ubuntu: {
    id: "ubuntu",
    name: "Ubuntu",
    fileName: "ubuntu.svg",
    assetPath: "/logos/tech/ubuntu.svg",
    category: "os",
    aliases: [],
  },
  debian: {
    id: "debian",
    name: "Debian",
    fileName: "debian.svg",
    assetPath: "/logos/tech/debian.svg",
    category: "os",
    aliases: [],
  },
  archlinux: {
    id: "archlinux",
    name: "Arch Linux",
    fileName: "archlinux.svg",
    assetPath: "/logos/tech/archlinux.svg",
    category: "os",
    aliases: ["arch"],
  },
  apple: {
    id: "apple",
    name: "macOS / iOS",
    fileName: "apple.svg",
    assetPath: "/logos/tech/apple.svg",
    category: "os",
    aliases: ["macos", "ios", "osx"],
  },
  windows: {
    id: "windows",
    name: "Windows",
    fileName: "windows.svg",
    assetPath: "/logos/tech/windows.svg",
    category: "os",
    aliases: ["win"],
  },
  android: {
    id: "android",
    name: "Android",
    fileName: "android.svg",
    assetPath: "/logos/tech/android.svg",
    category: "os",
    aliases: [],
  },

  // Editors & IDEs
  vscode: {
    id: "vscode",
    name: "Visual Studio Code",
    fileName: "vscode.svg",
    assetPath: "/logos/tech/vscode.svg",
    category: "editor",
    aliases: ["code"],
  },
  sublime: {
    id: "sublime",
    name: "Sublime Text",
    fileName: "sublime.svg",
    assetPath: "/logos/tech/sublime.svg",
    category: "editor",
    aliases: [],
  },
  atom: {
    id: "atom",
    name: "Atom",
    fileName: "atom.svg",
    assetPath: "/logos/tech/atom.svg",
    category: "editor",
    aliases: [],
  },
  intellij: {
    id: "intellij",
    name: "IntelliJ IDEA",
    fileName: "intellij.svg",
    assetPath: "/logos/tech/intellij.svg",
    category: "editor",
    aliases: [],
  },
  pycharm: {
    id: "pycharm",
    name: "PyCharm",
    fileName: "pycharm.svg",
    assetPath: "/logos/tech/pycharm.svg",
    category: "editor",
    aliases: [],
  },
};

// ── Secondary Pre-indexed Fast Lookups ──────────────────────────────────────
const ALIAS_MAP = new Map<string, string>();
const EXACT_FILE_MAP = new Map<string, string>();
const EXTENSION_MAP = new Map<string, string>();

for (const [id, meta] of Object.entries(TECH_LOGO_REGISTRY)) {
  ALIAS_MAP.set(id.toLowerCase(), id);
  for (const alias of meta.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), id);
  }
  if (meta.exactFiles) {
    for (const file of meta.exactFiles) {
      EXACT_FILE_MAP.set(file.toLowerCase(), id);
    }
  }
  if (meta.extensions) {
    for (const ext of meta.extensions) {
      const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      EXTENSION_MAP.set(normalizedExt, id);
    }
  }
}

/**
 * Resolves any tech tool, programming language, file extension, or exact filename
 * to its canonical tech ID in the registry.
 */
export function resolveTechId(query: string): string | undefined {
  if (!query || typeof query !== "string") return undefined;
  const clean = query.trim().toLowerCase();

  // 1. Exact match on canonical ID
  if (TECH_LOGO_REGISTRY[clean]) return clean;

  // 2. Exact match on alias
  const fromAlias = ALIAS_MAP.get(clean);
  if (fromAlias) return fromAlias;

  // Extract basename for path queries (e.g. "src/index.ts", "sub/Dockerfile.dev")
  const basename = clean.split(/[/\\]/).pop() || clean;

  // 3. Basename match on canonical ID or alias
  if (TECH_LOGO_REGISTRY[basename]) return basename;
  const fromBaseAlias = ALIAS_MAP.get(basename);
  if (fromBaseAlias) return fromBaseAlias;

  // 4. Exact filename match (e.g. "package.json", "Dockerfile", "Cargo.toml")
  const fromFile = EXACT_FILE_MAP.get(basename);
  if (fromFile) return fromFile;

  // 5. Prefix & Pattern-based file matching (e.g. Dockerfile.dev, docker-compose.prod.yml)
  if (
    basename === "dockerfile" ||
    basename.startsWith("dockerfile.") ||
    basename.startsWith("docker-compose") ||
    basename.startsWith("compose.") ||
    basename === "containerfile" ||
    basename.startsWith("containerfile.")
  ) {
    return "docker";
  }

  if (basename.startsWith(".git")) {
    return "git";
  }

  if (basename.startsWith("tsconfig") && basename.endsWith(".json")) {
    return "typescript";
  }

  if (basename.startsWith("jsconfig") && basename.endsWith(".json")) {
    return "javascript";
  }

  if (basename.startsWith("vite.config.")) {
    return "vite";
  }

  if (basename.startsWith("next.config.")) {
    return "nextjs";
  }

  if (basename.startsWith("tailwind.config.")) {
    return "tailwind";
  }

  if (basename.startsWith("tauri.conf.")) {
    return "tauri";
  }

  // 6. Multi-dot extension check (e.g. ".d.ts", ".spec.tsx")
  const firstDot = basename.indexOf(".");
  if (firstDot !== -1 && firstDot !== basename.lastIndexOf(".")) {
    const compoundExt = basename.slice(firstDot);
    const fromCompound = EXTENSION_MAP.get(compoundExt);
    if (fromCompound) return fromCompound;
  }

  // 7. Single file extension match (e.g. ".ts", ".py", ".vue", ".rs")
  const lastDot = basename.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = basename.slice(lastDot);
    const fromExt = EXTENSION_MAP.get(ext);
    if (fromExt) return fromExt;
  }

  // 8. Normalization checks: remove punctuation / spaces (e.g. "c++" -> "cpp", "c#" -> "csharp")
  if (clean === "c++" || clean === "cplusplus" || basename === "c++") return "cpp";
  if (clean === "c#" || clean === "csharp" || basename === "c#") return "csharp";
  if (clean === "node" || clean === "nodejs" || basename === "node") return "nodejs";
  if (clean === "k8s" || clean === "kubernetes" || basename === "k8s") return "kubernetes";
  if (clean === "vue.js" || clean === "vuejs" || basename === "vue.js") return "vue";

  return undefined;
}

/**
 * Retrieves metadata for a technology, language, or file query.
 */
export function getTechLogoMetadata(query: string): TechLogoMetadata | undefined {
  const id = resolveTechId(query);
  return id ? TECH_LOGO_REGISTRY[id] : undefined;
}

/**
 * Retrieves the exact official SVG asset URL for a given tech or language.
 */
export function getTechLogoUrl(query: string, preferLanguagePath = false): string | undefined {
  const meta = getTechLogoMetadata(query);
  if (!meta) return undefined;
  if (preferLanguagePath && meta.category === "language") {
    return `/logos/languages/${meta.fileName}`;
  }
  return meta.assetPath;
}

// ── TechLogo Component ──────────────────────────────────────────────────────
export interface TechLogoProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "size"> {
  techId?: string;
  name?: string;
  fileName?: string;
  size?: LogoSize;
  className?: string;
  useLanguagePath?: boolean;
  fallback?: ReactNode;
}

/**
 * TechLogo — Authentic Brand Asset Image Component
 *
 * Renders the exact, authentic, unaltered SVG brand mark via an <img> tag.
 * Supports ACSA Code design system size tokens (`xs`, `sm`, `md`, `lg`, number)
 * and Tailwind classes.
 */
export function TechLogo({
  techId,
  name,
  fileName,
  size,
  className = "w-4 h-4 shrink-0 object-contain",
  style,
  alt,
  title,
  useLanguagePath = false,
  fallback = null,
  ...rest
}: TechLogoProps) {
  const query = techId || name || fileName || "";
  const meta = getTechLogoMetadata(query);

  if (!meta) {
    return <>{fallback}</>;
  }

  const px = resolveLogoSize(size);
  const computedStyle = computeLogoStyle(size, style);
  const brandTitle = title || meta.name;
  const src =
    useLanguagePath && meta.category === "language"
      ? `/logos/languages/${meta.fileName}`
      : meta.assetPath;

  return (
    <img
      src={src}
      alt={alt || `${brandTitle} logo`}
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

// ── Specific Dedicated Component Exports ────────────────────────────────────
export const TypeScriptLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="typescript" {...props} />
);
export const JavaScriptLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="javascript" {...props} />
);
export const PythonLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="python" {...props} />
);
export const RustLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="rust" {...props} />
);
export const GoLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="go" {...props} />
);
export const CppLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="cpp" {...props} />
);
export const CLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="c" {...props} />
);
export const CSharpLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="csharp" {...props} />
);
export const JavaLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="java" {...props} />
);
export const KotlinLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="kotlin" {...props} />
);
export const SwiftLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="swift" {...props} />
);
export const PhpLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="php" {...props} />
);
export const RubyLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="ruby" {...props} />
);
export const HtmlLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="html" {...props} />
);
export const CssLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="css" {...props} />
);
export const ReactLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="react" {...props} />
);
export const VueLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="vue" {...props} />
);
export const AngularLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="angular" {...props} />
);
export const SvelteLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="svelte" {...props} />
);
export const NodeJsLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="nodejs" {...props} />
);
export const DockerLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="docker" {...props} />
);
export const KubernetesLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="kubernetes" {...props} />
);
export const GitLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="git" {...props} />
);
export const LinuxLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="linux" {...props} />
);
export const TauriLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="tauri" {...props} />
);
export const ViteLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="vite" {...props} />
);
export const TailwindLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="tailwind" {...props} />
);
export const NextJsLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="nextjs" {...props} />
);
export const GraphQlLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="graphql" {...props} />
);
export const DenoLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="deno" {...props} />
);
export const BashLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="bash" {...props} />
);
export const PostgreSqlLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="postgresql" {...props} />
);
export const MongoDbLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="mongodb" {...props} />
);
export const RedisLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="redis" {...props} />
);
export const NpmLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="npm" {...props} />
);
export const VsCodeLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="vscode" {...props} />
);
export const FlutterLogo = (props: Omit<TechLogoProps, "techId">) => (
  <TechLogo techId="flutter" {...props} />
);

export default TechLogo;
