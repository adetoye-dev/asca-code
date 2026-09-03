/**
 * vite-fs-bridge.ts — Local Filesystem & Process API Bridge for Vite Dev Server
 *
 * Provides real filesystem operations and real Python manager process execution
 * when developing or running in the browser:
 * - Native OS folder picker (via osascript on macOS or direct path resolution)
 * - Real directory tree traversal (list_project_files)
 * - Real file reading and writing on physical disk
 * - Real project scaffolding on physical disk
 * - Real child_process spawning of `python3 core-engine/manager.py` with SSE streaming
 */

import type { Plugin, ViteDevServer } from "vite";
import fs from "fs";
import path from "path";
import os from "os";
import { exec, spawn } from "child_process";

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes?: number;
  children?: FileNode[];
}

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "dist",
  ".DS_Store",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
]);

function buildFileTree(dirPath: string, depth = 0, maxDepth = 6): FileNode[] {
  if (depth > maxDepth || !fs.existsSync(dirPath)) return [];

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const nodes: FileNode[] = [];

  // Sort directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const isDir = entry.isDirectory();

    if (isDir) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        is_dir: true,
        children: buildFileTree(fullPath, depth + 1, maxDepth),
      });
    } else {
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(fullPath).size;
      } catch {}

      nodes.push({
        name: entry.name,
        path: fullPath,
        is_dir: false,
        size_bytes: sizeBytes,
      });
    }
  }

  return nodes;
}

function expandHome(p: string): string {
  if (!p) return "";
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

function resolveProjectRoot(projectRoot: string): string {
  const resolved = expandHome(projectRoot || process.cwd());
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  return fs.realpathSync(resolved);
}

function resolveProjectPath(projectRoot: string, targetPath: string): string {
  const root = resolveProjectRoot(projectRoot);
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(root, targetPath);
  const resolved = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path is outside the active project root");
  }
  return resolved;
}

function isLocalRequest(req: any): boolean {
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : "";
  const host = typeof req.headers?.host === "string" ? req.headers.host : "";
  const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;
  if (!localHost.test(host)) return false;
  if (!origin) return true;
  try {
    return new URL(origin).protocol === "http:" && localHost.test(new URL(origin).host);
  } catch {
    return false;
  }
}

function parseJsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export function realFilesystemPlugin(): Plugin {
  return {
    name: "vite-plugin-real-filesystem",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        const pathname = new URL(url, "http://127.0.0.1").pathname;

        if (!pathname.startsWith("/api/")) {
          return next();
        }

        if (!isLocalRequest(req)) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "Local development requests only" }));
          return;
        }

        res.setHeader("Content-Type", "application/json");

        try {
          // ── POST /api/fs/pick-folder ────────────────────────────────────────
          if (pathname === "/api/fs/pick-folder" && req.method === "POST") {
            if (process.platform === "darwin") {
              const script = 'POSIX path of (choose folder with prompt "Select Project Directory:")';
              exec(`osascript -e '${script}'`, (err, stdout) => {
                if (err) {
                  // User clicked Cancel or dismissed
                  res.end(JSON.stringify({ path: null, canceled: true }));
                } else {
                  const selectedPath = stdout.trim().replace(/\/$/, "");
                  res.end(JSON.stringify({ path: selectedPath, canceled: false }));
                }
              });
            } else {
              // Non-mac fallback: return current working directory
              res.end(JSON.stringify({ path: process.cwd(), canceled: false }));
            }
            return;
          }

          // ── POST /api/fs/list ───────────────────────────────────────────────
          if (pathname === "/api/fs/list" && req.method === "POST") {
            const { projectPath } = await parseJsonBody(req);
            const resolvedPath = resolveProjectRoot(projectPath || process.cwd());

            if (!fs.existsSync(resolvedPath)) {
              fs.mkdirSync(resolvedPath, { recursive: true });
            }

            const tree = buildFileTree(resolvedPath);
            res.end(JSON.stringify({ nodes: tree, resolvedPath }));
            return;
          }

          // ── POST /api/fs/read ───────────────────────────────────────────────
          if (pathname === "/api/fs/read" && req.method === "POST") {
            const { filePath, projectRoot } = await parseJsonBody(req);
            const resolved = resolveProjectPath(projectRoot, filePath);

            if (!fs.existsSync(resolved)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: `File not found: ${filePath}` }));
              return;
            }

            const content = fs.readFileSync(resolved, "utf-8");
            res.end(JSON.stringify({ content }));
            return;
          }

          // ── POST /api/fs/write ──────────────────────────────────────────────
          if (pathname === "/api/fs/write" && req.method === "POST") {
            const { filePath, content, projectRoot } = await parseJsonBody(req);
            const resolved = resolveProjectPath(projectRoot, filePath);

            const parentDir = path.dirname(resolved);
            if (!fs.existsSync(parentDir)) {
              fs.mkdirSync(parentDir, { recursive: true });
            }

            fs.writeFileSync(resolved, content, "utf-8");
            res.end(JSON.stringify({ success: true, path: resolved }));
            return;
          }

          // ── POST /api/fs/create ─────────────────────────────────────────────
          if (pathname === "/api/fs/create" && req.method === "POST") {
            const { itemPath, isDir, projectRoot } = await parseJsonBody(req);
            const resolved = resolveProjectPath(projectRoot, itemPath);

            if (isDir) {
              fs.mkdirSync(resolved, { recursive: true });
            } else {
              const parent = path.dirname(resolved);
              if (!fs.existsSync(parent)) {
                fs.mkdirSync(parent, { recursive: true });
              }
              if (!fs.existsSync(resolved)) {
                fs.writeFileSync(resolved, "", "utf-8");
              }
            }

            res.end(JSON.stringify({ success: true, path: resolved }));
            return;
          }

          // ── POST /api/fs/delete ─────────────────────────────────────────────
          if (pathname === "/api/fs/delete" && req.method === "POST") {
            const { targetPath, projectRoot } = await parseJsonBody(req);
            const resolved = resolveProjectPath(projectRoot, targetPath);

            if (fs.existsSync(resolved)) {
              fs.rmSync(resolved, { recursive: true, force: true });
            }

            res.end(JSON.stringify({ success: true }));
            return;
          }

          // ── POST /api/fs/create-project ─────────────────────────────────────
          if (pathname === "/api/fs/create-project" && req.method === "POST") {
            const { name, template, parentDir } = await parseJsonBody(req);
            const targetBase = parentDir
              ? expandHome(parentDir)
              : path.join(os.homedir(), "AutonomousProjects");

            const projectPath = path.join(targetBase, name);
            fs.mkdirSync(projectPath, { recursive: true });

            if (template === "fastapi") {
              fs.writeFileSync(
                path.join(projectPath, "main.py"),
                `from fastapi import FastAPI\nfrom models import Item\n\napp = FastAPI(title="${name}")\n\n@app.get("/")\ndef read_root():\n    return {"service": "${name}", "status": "active"}\n\n@app.post("/items")\ndef create_item(item: Item):\n    return {"item": item.name, "created": True}\n`,
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "models.py"),
                `from pydantic import BaseModel\n\nclass Item(BaseModel):\n    name: str\n    description: str | None = None\n    price: float\n`,
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "requirements.txt"),
                `fastapi>=0.110.0\nuvicorn>=0.28.0\npydantic>=2.0.0\n`,
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "README.md"),
                `# ${name}\n\nPython FastAPI service generated by Autonomous IDE.\n`,
                "utf-8"
              );
            } else if (template === "express") {
              fs.writeFileSync(
                path.join(projectPath, "server.js"),
                `const express = require("express");\nconst app = express();\n\napp.use(express.json());\n\napp.get("/", (req, res) => {\n  res.json({ service: "${name}", status: "online" });\n});\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n`,
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "package.json"),
                JSON.stringify(
                  {
                    name,
                    version: "1.0.0",
                    main: "server.js",
                    scripts: { start: "node server.js" },
                    dependencies: { express: "^4.18.2" },
                  },
                  null,
                  2
                ),
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "README.md"),
                `# ${name}\n\nNode.js Express API scaffolded by Autonomous IDE.\n`,
                "utf-8"
              );
            } else if (template === "typescript") {
              const srcDir = path.join(projectPath, "src");
              fs.mkdirSync(srcDir, { recursive: true });
              fs.writeFileSync(
                path.join(srcDir, "index.ts"),
                `export interface ServiceConfig {\n  name: string;\n  version: string;\n}\n\nexport function startService(config: ServiceConfig) {\n  console.log(\`Service \${config.name} v\${config.version} initialized.\`);\n}\n\nstartService({ name: "${name}", version: "1.0.0" });\n`,
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "tsconfig.json"),
                JSON.stringify(
                  {
                    compilerOptions: {
                      target: "ES2022",
                      module: "NodeNext",
                      strict: true,
                      esModuleInterop: true,
                    },
                    include: ["src/**/*"],
                  },
                  null,
                  2
                ),
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "package.json"),
                JSON.stringify(
                  {
                    name,
                    version: "1.0.0",
                    scripts: { build: "tsc" },
                    devDependencies: { typescript: "^5.0.0" },
                  },
                  null,
                  2
                ),
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "README.md"),
                `# ${name}\n\nTypeScript project scaffolded by Autonomous IDE.\n`,
                "utf-8"
              );
            } else {
              // Minimal
              fs.writeFileSync(
                path.join(projectPath, "main.py"),
                `def main():\n    print("Hello from ${name}!")\n\nif __name__ == "__main__":\n    main()\n`,
                "utf-8"
              );
              fs.writeFileSync(
                path.join(projectPath, "README.md"),
                `# ${name}\n\nStarter project scaffolded by Autonomous IDE.\n`,
                "utf-8"
              );
            }

            res.end(JSON.stringify({ projectPath, name }));
            return;
          }

          // ── GET /api/system/metrics ─────────────────────────────────────────
          if (pathname === "/api/system/metrics" && req.method === "GET") {
            const cpus = os.cpus();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const loadAvg = os.loadavg()[0] || 0;
            const cpuPercent = Math.min(100, Math.round((loadAvg / cpus.length) * 100));

            res.end(
              JSON.stringify({
                cpu_usage_percent: cpuPercent,
                memory_used_mb: Math.round(usedMem / (1024 * 1024)),
                memory_total_mb: Math.round(totalMem / (1024 * 1024)),
                memory_usage_percent: Math.round((usedMem / totalMem) * 100),
                is_thermal_risk: cpuPercent > 90,
                thermal_warning: cpuPercent > 90 ? "High host CPU load" : "",
              })
            );
            return;
          }

          // ── POST /api/pipeline/run (Real Server-Sent Events child process) ──
          if (pathname === "/api/pipeline/run" && req.method === "POST") {
            const body = await parseJsonBody(req);
            const {
              prompt,
              sliders,
              projectRoot,
              language = "python",
              provider = "deterministic",
              model = "",
              apiKey = "",
              baseUrl = "",
            } = body;

            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");

            const sendEvent = (event: string, data: any) => {
              res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            };

            const rootDir = resolveProjectRoot(projectRoot || process.cwd());
            const managerScript = path.resolve("core-engine/manager.py");

            const args = [
              managerScript,
              "--task",
              prompt,
              "--project-root",
              rootDir,
              "--scale",
              sliders?.budget_vs_scale || "medium",
              "--speed",
              sliders?.speed_vs_precision || "medium",
              "--modularity",
              sliders?.simplicity_vs_futureproof || "medium",
              "--language",
              language,
              "--provider",
              provider,
              "--json",
            ];

            if (model) args.push("--model", model);
            if (baseUrl) args.push("--base-url", baseUrl);

            sendEvent("output", {
              line_number: 1,
              content: `Spawning Python Engine: python3 core-engine/manager.py on ${rootDir}`,
              stream: "stdout",
            });

            const pyProc = spawn("python3", args, {
              cwd: process.cwd(),
              env: {
                ...process.env,
                PYTHONUNBUFFERED: "1",
                ...(apiKey ? { AIDE_API_KEY: apiKey } : {}),
              },
            });

            const killChild = () => {
              if (pyProc.exitCode === null) pyProc.kill("SIGTERM");
            };
            req.on("close", killChild);
            pyProc.on("close", () => req.off("close", killChild));

            let lineNum = 2;
            let stdoutBuffer = "";

            pyProc.stdout.on("data", (chunk) => {
              const text = chunk.toString();
              stdoutBuffer += text;
              const lines = text.split("\n");
              for (const line of lines) {
                if (!line.trim()) continue;
                sendEvent("output", {
                  line_number: lineNum++,
                  content: line,
                  stream: "stdout",
                });
              }
            });

            pyProc.stderr.on("data", (chunk) => {
              const text = chunk.toString();
              const lines = text.split("\n");
              for (const line of lines) {
                if (!line.trim()) continue;
                sendEvent("output", {
                  line_number: lineNum++,
                  content: line,
                  stream: "stderr",
                });
              }
            });

            pyProc.on("close", (code) => {
              sendEvent("output", {
                line_number: lineNum++,
                content: `Pipeline process exited with code ${code}`,
                stream: code === 0 ? "stdout" : "stderr",
              });

              // Try to find JSON summary in stdout
              let parsedResult = null;
              try {
                const jsonMatches = stdoutBuffer.match(/\{[\s\S]*"outcome"[\s\S]*\}/);
                if (jsonMatches) {
                  parsedResult = JSON.parse(jsonMatches[0]);
                }
              } catch {}

              sendEvent("complete", {
                success: code === 0,
                exit_code: code,
                parsed_result: parsedResult,
              });

              res.end();
            });

            pyProc.on("error", (procErr) => {
              sendEvent("output", {
                line_number: lineNum++,
                content: `Failed to spawn Python orchestrator: ${procErr.message}`,
                stream: "stderr",
              });
              sendEvent("complete", {
                success: false,
                exit_code: -1,
                error: procErr.message,
              });
              res.end();
            });

            return;
          }

          next();
        } catch (err: any) {
          console.error("Vite FS bridge error:", err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
      });
    },
  };
}

export default realFilesystemPlugin;
