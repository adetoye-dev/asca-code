import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { IDockviewPanelProps } from "dockview-react";
import {
  Image as ImageIcon,
  Code,
  Eye,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RefreshCw,
  Copy,
  Check,
  Download,
  Grid,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Icon } from "../ui/Icon";
import { readTextFile, readFileAsDataUrl } from "../../services/fileAccess";

export interface AssetPreviewParams {
  filePath: string;
  isTauri?: boolean;
  projectRoot?: string;
}

type CanvasBg = "dark-grid" | "light-grid" | "obsidian" | "white";

interface PreparedSvg {
  html: string;
  width: number;
  height: number;
}

/**
 * Parses raw SVG XML for high-fidelity inline rendering.
 * Root fix: SVGs with only a viewBox (no width/height attrs) collapse to
 * 0x0 inside a flex container per CSS replaced-element rules.
 * We inject width="100%" height="100%" so they fill their explicit container.
 */
function parseAndPrepareSvg(rawXml: string): PreparedSvg {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawXml, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) return { html: rawXml, width: 256, height: 256 };

    // Dimensions from viewBox
    const vbAttr = svgEl.getAttribute("viewBox");
    let vbW = 0, vbH = 0;
    if (vbAttr) {
      const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { vbW = parts[2]; vbH = parts[3]; }
    }
    const toPx = (v: string | null) =>
      v && /^\d*\.?\d+(px)?$/i.test(v.trim()) ? parseFloat(v) : 0;
    const wAttr = toPx(svgEl.getAttribute("width"));
    const hAttr = toPx(svgEl.getAttribute("height"));
    const naturalW = Math.round(wAttr || vbW || 256);
    const naturalH = Math.round(hAttr || vbH || 256);

    // Ensure viewBox present
    if (!svgEl.getAttribute("viewBox") && naturalW > 0 && naturalH > 0) {
      svgEl.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
    }

    // Force 100% sizing so it fills the explicit container div
    svgEl.setAttribute("width", "100%");
    svgEl.setAttribute("height", "100%");
    svgEl.style.display = "block";
    svgEl.style.overflow = "visible";

    // Sanitize scripts
    doc.querySelectorAll("script").forEach((s) => s.remove());

    return { html: svgEl.outerHTML, width: naturalW, height: naturalH };
  } catch {
    return { html: rawXml, width: 256, height: 256 };
  }
}

export function AssetPreview(props: IDockviewPanelProps<AssetPreviewParams>) {
  const { filePath, isTauri = false, projectRoot = "" } = props.params;

  const [src, setSrc] = useState<string>("");
  const [isSvg, setIsSvg] = useState(false);
  const [rawSvg, setRawSvg] = useState<string>("");
  const [preparedSvg, setPreparedSvg] = useState<PreparedSvg | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isActualSize, setIsActualSize] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [canvasBg, setCanvasBg] = useState<CanvasBg>("dark-grid");
  const [metadata, setMetadata] = useState<{ width: number; height: number; size: number; format: string }>({
    width: 0, height: 0, size: 0, format: "",
  });

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const ext = (fileName.split(".").pop() || "IMAGE").toUpperCase();

  // ── 1. Loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const fileExt = fileName.split(".").pop()?.toLowerCase() || "";
    const isVector = fileExt === "svg";
    setIsSvg(isVector);
    setIsLoading(true);
    setHasError(false);
    setErrorMessage("");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsActualSize(false);
    setPreparedSvg(null);
    setSrc("");
    let objectUrl: string | null = null;

    const loadAsset = async () => {
      if (isVector) {
        try {
          const text = await readTextFile(filePath, projectRoot);
          if (text && active) {
            setRawSvg(text);
            const prepared = parseAndPrepareSvg(text);
            setPreparedSvg(prepared);
            setMetadata({ width: prepared.width, height: prepared.height, size: new Blob([text]).size, format: "SVG" });
            objectUrl = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
            setSrc(objectUrl);
            setIsLoading(false);
            return;
          }
        } catch (err) { console.error("SVG loader:", err); }
      }

      try {
        const dataUrl = await readFileAsDataUrl(filePath, projectRoot);
        if (dataUrl && active) {
          setSrc(dataUrl);
          setIsLoading(false);
          return;
        }
      } catch { /* fall through */ }

      if (active) {
        setHasError(true);
        setErrorMessage("Previews need the desktop app — the browser has no file access.");
        setIsLoading(false);
      }
    };

    loadAsset();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath, isTauri, projectRoot, fileName, ext, refreshKey]);

  // ── 2. Image handlers ───────────────────────────────────────────────────────
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setHasError(false);
    setIsLoading(false);
    setMetadata((p) => ({ width: img.naturalWidth || 256, height: img.naturalHeight || 256, size: p.size, format: ext }));
  };
  const handleImageError = () => {
    if (isSvg && rawSvg) { setShowRaw(true); return; }
    setHasError(true);
    setErrorMessage("Unable to render this asset.");
    setIsLoading(false);
  };

  // ── 3. Display dimensions ───────────────────────────────────────────────────
  const displayDimensions = useMemo(() => {
    const W = metadata.width || 256;
    const H = metadata.height || 256;
    const ratio = H > 0 ? W / H : 1;
    if (isActualSize) return { width: W, height: H };
    if (W <= 128 && H <= 128) {
      const base = 280;
      return ratio >= 1 ? { width: base, height: Math.round(base / ratio) } : { width: Math.round(base * ratio), height: base };
    }
    const maxDim = 600;
    if (W > maxDim || H > maxDim) {
      return ratio >= 1 ? { width: maxDim, height: Math.round(maxDim / ratio) } : { width: Math.round(maxDim * ratio), height: maxDim };
    }
    return { width: W, height: H };
  }, [metadata.width, metadata.height, isActualSize]);

  const isSmallIcon = metadata.width > 0 && metadata.width <= 128;

  // ── 4. Pan/Zoom ─────────────────────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(Math.max(+(z * (e.deltaY < 0 ? 1.15 : 0.85)).toFixed(2), 0.1), 10));
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setIsDragging(false);
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(+(z + 0.25).toFixed(2), 10)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(+(z - 0.25).toFixed(2), 0.1)), []);
  const handleResetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); setIsActualSize(false); }, []);
  const handleToggleActualSize = useCallback(() => { setIsActualSize((p) => !p); setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    if (typeof window !== "undefined" && (window as any).__refreshLogos) {
      (window as any).__refreshLogos();
    }
  }, []);

  // ── 5. Actions ──────────────────────────────────────────────────────────────
  const handleCopy = async () => {
    await navigator.clipboard.writeText(isSvg && rawSvg ? rawSvg : filePath);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const handleDownload = () => {
    if (!src) return;
    const a = document.createElement("a"); a.href = src; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── 6. Helpers ──────────────────────────────────────────────────────────────
  const formatSize = (b: number) => {
    if (!b) return "";
    if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  };
  const getCanvasBgStyle = (): React.CSSProperties => {
    if (canvasBg === "light-grid") return { backgroundColor: "#f4f4f5", backgroundImage: "linear-gradient(45deg,#e4e4e7 25%,transparent 25%),linear-gradient(-45deg,#e4e4e7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e4e4e7 75%),linear-gradient(-45deg,transparent 75%,#e4e4e7 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0,0 10px,10px -10px,-10px 0px" };
    if (canvasBg === "obsidian") return { backgroundColor: "#09090b" };
    if (canvasBg === "white") return { backgroundColor: "#ffffff" };
    return { backgroundColor: "#18181b", backgroundImage: "linear-gradient(45deg,rgba(255,255,255,.04) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.04) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.04) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.04) 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0,0 10px,10px -10px,-10px 0px" };
  };

  // ── 7. Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full bg-workbench text-zinc-200 select-none font-sans overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none px-3.5 py-2 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md flex items-center justify-between gap-3 z-raised">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1 rounded-md bg-zinc-800 border border-zinc-700/60 text-zinc-300 shrink-0">
            <Icon icon={ImageIcon} className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs text-zinc-100 truncate" title={filePath}>{fileName}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-zinc-400 border border-zinc-700/60 uppercase shrink-0">{ext}</span>
          <div className="hidden sm:flex items-center gap-2.5 text-[11px] font-mono text-zinc-400 pl-1 border-l border-zinc-800">
            {metadata.width > 0 && <span className="text-zinc-300">{metadata.width} × {metadata.height} px</span>}
            {metadata.size > 0 && <span className="text-zinc-500">{formatSize(metadata.size)}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!showRaw && (
            <div className="flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
              <button type="button" onClick={handleZoomOut} disabled={zoom <= 0.15} className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30 cursor-pointer" title="Zoom Out">
                <Icon icon={ZoomOut} className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={handleResetZoom} className="px-2 py-0.5 text-[11px] font-mono font-medium text-zinc-300 hover:text-white hover:bg-zinc-800/80 rounded cursor-pointer">
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={handleZoomIn} disabled={zoom >= 10} className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30 cursor-pointer" title="Zoom In">
                <Icon icon={ZoomIn} className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={handleResetZoom} className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors ml-0.5 border-l border-zinc-800 cursor-pointer" title="Fit to View">
                <Icon icon={RotateCcw} className="w-3 h-3" />
              </button>
              {isSmallIcon && (
                <button type="button" onClick={handleToggleActualSize}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded ml-0.5 transition-colors cursor-pointer ${isActualSize ? "bg-zinc-800 text-zinc-100 border border-zinc-600 shadow-sm" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
                  title="Toggle 1:1 pixel size">1:1</button>
              )}
            </div>
          )}

          {!showRaw && (
            <div className="flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
              <button type="button" onClick={() => setCanvasBg((p) => p === "dark-grid" ? "light-grid" : p === "light-grid" ? "obsidian" : p === "obsidian" ? "white" : "dark-grid")}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-300 hover:text-white rounded hover:bg-zinc-800 transition-colors cursor-pointer" title="Toggle Background">
                <Icon icon={Grid} className="w-3.5 h-3.5 text-zinc-400" />
                <span className="capitalize text-[10px]">{canvasBg === "dark-grid" ? "Dark" : canvasBg === "light-grid" ? "Light" : canvasBg === "obsidian" ? "Obsidian" : "White"}</span>
              </button>
            </div>
          )}

          {isSvg && (
            <button type="button" onClick={() => setShowRaw((p) => !p)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-200 font-medium transition-colors cursor-pointer">
              <Icon icon={showRaw ? Eye : Code} className="w-3.5 h-3.5 text-zinc-300" />
              <span>{showRaw ? "Preview Vector" : "View Source"}</span>
            </button>
          )}

          {/* Reload from disk — fixes stale preview after file replacement */}
          <button type="button" onClick={handleRefresh}
            className={`p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-300 hover:text-white transition-colors cursor-pointer ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
            title="Reload from disk (use after replacing the file)">
            <Icon icon={RefreshCw} className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>

          <button type="button" onClick={handleCopy} className="flex items-center gap-1 p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-300 hover:text-white transition-colors cursor-pointer" title={isSvg ? "Copy SVG" : "Copy Path"}>
            <Icon icon={copied ? Check : Copy} className={`w-3.5 h-3.5 ${copied ? "text-emerald-400" : ""}`} />
          </button>
          <button type="button" onClick={handleDownload} className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Download">
            <Icon icon={Download} className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center select-none"
        style={showRaw ? { backgroundColor: "#09090b" } : getCanvasBgStyle()}
        onWheel={!showRaw ? handleWheel : undefined}
        onMouseDown={!showRaw ? handleMouseDown : undefined}
        onMouseMove={!showRaw ? handleMouseMove : undefined}
        onMouseUp={!showRaw ? handleMouseUp : undefined}
        onMouseLeave={!showRaw ? handleMouseUp : undefined}
      >
        {isLoading && !hasError && !preparedSvg && !src ? (
          <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
            <Icon icon={Loader2} className="w-6 h-6 animate-spin text-zinc-400" />
            <span className="text-xs font-medium">Loading asset…</span>
          </div>

        ) : hasError && !showRaw ? (
          <div className="max-w-md p-6 rounded-2xl bg-zinc-900/90 border border-red-500/30 text-center space-y-3 shadow-2xl backdrop-blur-xl">
            <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
              <Icon icon={AlertTriangle} className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-zinc-100">Unable to Render Asset</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">{errorMessage || "The asset could not be displayed."}</p>
            <p className="text-[11px] font-mono text-zinc-500 break-all">{filePath}</p>
            {isSvg && rawSvg && (
              <button type="button" onClick={() => setShowRaw(true)} className="mt-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 rounded-lg border border-zinc-700 cursor-pointer">
                View Raw SVG Source
              </button>
            )}
          </div>

        ) : showRaw && isSvg ? (
          <div className="w-full h-full p-4 overflow-auto font-mono text-xs text-zinc-300 bg-zinc-950 flex flex-col">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 text-zinc-500 text-[11px]">
              <span>SVG Source</span><span>{rawSvg.length} chars</span>
            </div>
            <pre className="flex-1 whitespace-pre-wrap select-text leading-relaxed text-zinc-200">{rawSvg}</pre>
          </div>

        ) : (
          <div
            className={`flex items-center justify-center transition-transform duration-75 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
          >
            {isSvg && preparedSvg ? (
              /* Inline vector — no blob URL, no img tag, no 0x0 collapse */
              <div
                className="rounded-xl border border-white/10 bg-white/[0.02] shadow-2xl"
                style={{ width: displayDimensions.width, height: displayDimensions.height, padding: 8, boxSizing: "border-box" as const }}
                dangerouslySetInnerHTML={{ __html: preparedSvg.html }}
              />
            ) : src ? (
              <div
                className="rounded-xl border border-white/10 bg-white/[0.02] shadow-2xl flex items-center justify-center"
                style={{ width: displayDimensions.width, height: displayDimensions.height, padding: 8, boxSizing: "border-box" as const }}
              >
                <img
                  src={src} alt={fileName} draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: (metadata.width <= 64 ? "pixelated" : "auto") as React.CSSProperties["imageRendering"] }}
                  className="select-none pointer-events-none rounded"
                  onLoad={handleImageLoad} onError={handleImageError}
                />
              </div>
            ) : null}
          </div>
        )}

        {!showRaw && !hasError && (
          <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-800/80 text-[10px] font-mono text-zinc-400 flex items-center gap-2 pointer-events-none">
            <span>Scroll: Zoom</span><span className="text-zinc-600">·</span>
            <span>Drag: Pan</span><span className="text-zinc-600">·</span>
            <span>{Math.round(zoom * 100)}%</span>
            {isActualSize && <span className="text-zinc-200 font-bold ml-1">(1:1)</span>}
          </div>
        )}
      </div>
    </div>
  );
}
