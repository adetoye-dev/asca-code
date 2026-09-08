import { useState, useEffect } from "react";
import { IDockviewPanelProps } from "dockview-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Image as ImageIcon } from "lucide-react";

export function AssetPreview(props: IDockviewPanelProps<{ filePath: string; isTauri: boolean }>) {
  const { filePath, isTauri } = props.params;
  const [src, setSrc] = useState<string>("");
  const [isSvg, setIsSvg] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rawSvg, setRawSvg] = useState<string>("");
  const [metadata, setMetadata] = useState<{ width: number; height: number; size: number; format: string } | null>(null);

  useEffect(() => {
    const ext = filePath.split(".").pop()?.toLowerCase();
    setIsSvg(ext === "svg");
    
    if (isTauri) {
      setSrc(convertFileSrc(filePath));
    } else {
      setSrc(`/api/fs/raw?path=${encodeURIComponent(filePath)}`);
    }
  }, [filePath, isTauri]);

  useEffect(() => {
    if (isSvg && showRaw) {
      const readSvg = isTauri
        ? invoke<string>("plugin:fs|read_text_file", { path: filePath })
        : fetch(`/api/fs/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath })
          }).then(r => r.json()).then(d => d.content)
      Promise.resolve(readSvg)
      .then(content => setRawSvg(content || ""))
      .catch(console.error);
    }
  }, [isSvg, showRaw, filePath]);

  useEffect(() => {
    const fetchSize = async () => {
      try {
        if (!isTauri) {
          const dir = filePath.substring(0, filePath.lastIndexOf("/"));
          const res = await fetch("/api/fs/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: dir })
          });
          const data = await res.json();
          const fileName = filePath.split("/").pop();
          const fileNode = data.files?.find((f: any) => f.name === fileName);
          if (fileNode) {
            setMetadata(prev => prev ? { ...prev, size: fileNode.size_bytes } : { width: 0, height: 0, size: fileNode.size_bytes, format: filePath.split(".").pop()?.toUpperCase() || "UNKNOWN" });
          }
        }
      } catch (err) {
        console.error("Failed to fetch file size:", err);
      }
    };
    fetchSize();
  }, [filePath, isTauri]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setMetadata(prev => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
      size: prev?.size || 0,
      format: filePath.split(".").pop()?.toUpperCase() || "UNKNOWN"
    }));
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col h-full w-full bg-workbench text-primary">
      <div className="flex-none p-4 border-b border-hairline flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-secondary">
          <ImageIcon className="w-5 h-5 text-blue-400" />
          <span className="font-semibold">{filePath.split("/").pop()}</span>
        </div>
        {metadata && (
          <div className="text-xs text-muted flex space-x-4">
            <span>Dimensions: {metadata.width}x{metadata.height}</span>
            <span>Size: {formatSize(metadata.size)}</span>
            <span>Format: {metadata.format}</span>
          </div>
        )}
        {isSvg && (
          <button
            className="px-3 py-1 bg-canvas border border-hairline rounded text-xs hover:bg-white/5 transition-colors"
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? "Preview" : "Raw Source"}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-8 flex items-center justify-center bg-canvas">
        {showRaw && isSvg ? (
          <pre className="text-xs text-left w-full h-full overflow-auto text-secondary">{rawSvg}</pre>
        ) : (
          <img
            src={src}
            alt="Asset Preview"
            className="max-w-full max-h-full object-contain shadow-elevation-2"
            onLoad={handleImageLoad}
          />
        )}
      </div>
    </div>
  );
}
