/**
 * SurfaceFallback — what paints while a lazily-loaded surface chunk arrives.
 *
 * Monaco, the terminal and the graph stacks dominate the bundle but are not
 * needed to paint the workbench, so those surfaces are split and mounted behind
 * Suspense. This is the gap-filler they share.
 */
export const SurfaceFallback = ({ label }: { label: string }) => (
  <div className="h-full w-full flex items-center justify-center text-zinc-500 text-xs bg-[var(--vscode-editor-bg)]">
    Loading {label}…
  </div>
);

export default SurfaceFallback;
