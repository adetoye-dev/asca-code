/**
 * ProjectModal.tsx — New Project Creation Modal
 *
 * Scaffolds new projects with production templates (FastAPI, Express, TypeScript, Minimal)
 * into a real physical folder on disk.
 */

import React, { useState } from "react";
import { Search, Globe, FolderPlus, Zap, Database, Code2, Server, X } from "lucide-react";
import { Icon } from "./ui/Icon";

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (name: string, template: string, parentDir?: string) => void;
  onPickFolder?: () => Promise<string | null>;
}

const TEMPLATES = [
  {
    id: "nextjs",
    name: "Next.js 15 App Router",
    description: "Production fullstack React 19 app with TypeScript, Tailwind CSS, App Directory, and server components.",
    icon: Globe,
    badge: "Fullstack",
    files: ["app/page.tsx", "app/layout.tsx", "package.json"],
  },
  {
    id: "vite-react",
    name: "Vite React + TypeScript",
    description: "Ultra-fast frontend SPA with React 18, strict TypeScript, Tailwind CSS, and lightning HMR.",
    icon: Code2,
    badge: "Frontend",
    files: ["src/App.tsx", "vite.config.ts", "package.json"],
  },
  {
    id: "nestjs",
    name: "NestJS TypeScript API",
    description: "Enterprise modular TypeScript backend with controllers, services, Nest CLI configs, and REST routing.",
    icon: Server,
    badge: "Backend",
    files: ["src/main.ts", "src/app.module.ts", "nest-cli.json"],
  },
  {
    id: "supabase",
    name: "Supabase Fullstack Starter",
    description: "Express backend pre-configured with @supabase/supabase-js client, auth endpoints, and .env.example.",
    icon: Database,
    badge: "BaaS",
    files: ["src/server.js", "src/supabaseClient.js", ".env.example"],
  },
  {
    id: "fastapi",
    name: "Python FastAPI Service",
    description: "High-performance async REST API with Pydantic schemas, Uvicorn ASGI server, and requirements.txt.",
    icon: Zap,
    badge: "Python",
    files: ["main.py", "models.py", "requirements.txt"],
  },
  {
    id: "express",
    name: "Node.js / Express REST API",
    description: "Lightweight JSON HTTP microservice with Express routing, middleware, CORS, and package.json.",
    icon: Server,
    badge: "Node.js",
    files: ["server.js", "package.json", "README.md"],
  },
];

export function ProjectModal({
  isOpen,
  onClose,
  onCreateProject,
  onPickFolder,
}: ProjectModalProps) {
  const [projectName, setProjectName] = useState("");
  const [parentDir, setParentDir] = useState("~/AcsaProjects");
  const [selectedTemplate, setSelectedTemplate] = useState("nextjs");

  if (!isOpen) return null;

  const handleBrowse = async () => {
    if (onPickFolder) {
      const picked = await onPickFolder();
      if (picked) {
        setParentDir(picked);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = projectName.trim().replace(/\s+/g, "-").toLowerCase();
    if (!clean) return;
    onCreateProject(clean, selectedTemplate, parentDir.trim());
    setProjectName("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-lg bg-modal/95 backdrop-blur-xl border border-hairline rounded-modal shadow-elevation-3 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-surface-selected border border-accent flex items-center justify-center text-accent">
              <Icon icon={FolderPlus} className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Create New Project on Disk</h2>
              <p className="text-[11px] text-zinc-400">
                Scaffold a new project in a real physical directory on your machine.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg"
          >
            <Icon icon={X} className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Project Name Input */}
          <div className="space-y-1">
            <label htmlFor="projectmodal-project-name-1" className="text-xs font-semibold text-zinc-300">
              Project Name
            </label>
            <input id="projectmodal-project-name-1"
              // Focus lands in the first field of a dialog the user just opened,
              // which is what the ARIA authoring practices recommend.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              type="text"
              placeholder="e.g. user-auth-service"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/60"
            />
          </div>

          {/* Destination Folder Location */}
          <div className="space-y-1">
            <label htmlFor="projectmodal-save-inside-directory-2" className="text-xs font-semibold text-zinc-300">
              Save Inside Directory
            </label>
            <div className="flex items-center gap-2">
              <input id="projectmodal-save-inside-directory-2"
                type="text"
                placeholder="e.g. ~/Desktop or /Users/.../Projects"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500/60"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
              >
                <Icon icon={Search} className="w-3.5 h-3.5 text-primary-icon" />
                <span>Browse...</span>
              </button>
            </div>
          </div>

          {/* Template Picker */}
          <div className="space-y-1.5">
            {/* A group of template buttons, not a form control: a heading. */}
            <p className="text-xs font-semibold text-zinc-300">
              Select Architecture Template
            </p>
            <div className="grid grid-cols-1 gap-2">
              {TEMPLATES.map((tmpl) => {
                const isSelected = selectedTemplate === tmpl.id;
                const Icon = tmpl.icon;
                return (
                  <button
                    type="button"
                    key={tmpl.id}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                    className={`flex items-start gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-surface-selected border-accent text-white shadow-sm"
                        : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                        isSelected
                          ? "bg-primary-action text-white"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-200">
                          {tmpl.name}
                        </span>
                        <div className="flex gap-1">
                          {tmpl.files.map((f) => (
                            <span
                              key={f}
                              className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5 leading-normal">
                        {tmpl.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!projectName.trim()}
              className={`px-5 py-2 rounded-xl text-xs font-bold text-white shadow-lg transition-all ${
                projectName.trim()
                  ? "bg-primary-action hover:bg-primary-action cursor-pointer shadow-sm"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              }`}
            >
              Scaffold Real Files
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProjectModal;
