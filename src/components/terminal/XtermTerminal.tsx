/**
 * XtermTerminal.tsx — Interactive Terminal Emulator Component
 *
 * Integrates @xterm/xterm and @xterm/addon-fit with the local shell process bridge:
 * 1. Full ANSI color output & 256-color palette.
 * 2. Interactive keyboard input (stdin) streamed back to backend shell.
 * 3. Automatic dimension fitting on container or window resize.
 * 4. Reconnect and session restart support.
 */

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface XtermTerminalHandle {
  restart: () => void;
  clear: () => void;
  focus: () => void;
  isConnected: boolean;
}

interface XtermTerminalProps {
  cwd?: string;
  isVisible?: boolean;
  onConnectionChange?: (connected: boolean) => void;
}

export const XtermTerminal = forwardRef<XtermTerminalHandle, XtermTerminalProps>(
  ({ cwd, isVisible = true, onConnectionChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const inputBufferRef = useRef<string>("");
    const flushTimeoutRef = useRef<any>(null);

    const sendResize = useCallback((cols: number, rows: number) => {
      if (cols > 0 && rows > 0) {
        fetch("/api/terminal/resize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols, rows }),
        }).catch(() => {});
      }
    }, []);

    const safeFit = useCallback(() => {
      if (!termRef.current || !fitAddonRef.current || !containerRef.current) return;
      const container = containerRef.current;
      if (container.clientHeight < 30 || container.clientWidth < 30) return;

      try {
        fitAddonRef.current.fit();
        if (termRef.current) {
          sendResize(termRef.current.cols, termRef.current.rows);
        }
      } catch (err) {
        console.warn("FitAddon error:", err);
      }
    }, [sendResize]);

    const flushInput = useCallback(() => {
      if (!inputBufferRef.current) return;
      const dataToSend = inputBufferRef.current;
      inputBufferRef.current = "";
      fetch("/api/terminal/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataToSend }),
      }).catch(() => {});
    }, []);

    const sendInput = useCallback(
      (data: string) => {
        inputBufferRef.current += data;
        if (data.includes("\r") || data.includes("\n") || inputBufferRef.current.length >= 8) {
          if (flushTimeoutRef.current) {
            clearTimeout(flushTimeoutRef.current);
            flushTimeoutRef.current = null;
          }
          flushInput();
        } else if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(() => {
            flushTimeoutRef.current = null;
            flushInput();
          }, 10);
        }
      },
      [flushInput]
    );

    const initShell = useCallback(
      async (force = false) => {
        try {
          const res = await fetch("/api/terminal/spawn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd,
              cols: termRef.current?.cols || 80,
              rows: termRef.current?.rows || 24,
              force,
            }),
          });
          if (res.ok) {
            setIsConnected(true);
            onConnectionChangeRef.current?.(true);
          }
        } catch {
          termRef.current?.writeln("\r\n\x1b[31mFailed to connect to local shell process.\x1b[0m\r\n");
          setIsConnected(false);
          onConnectionChangeRef.current?.(false);
        }
      },
      [cwd, onConnectionChange]
    );
    const initShellRef = useRef(initShell);
    const sendInputRef = useRef(sendInput);
    const sendResizeRef = useRef(sendResize);
    const safeFitRef = useRef(safeFit);
    const onConnectionChangeRef = useRef(onConnectionChange);
    initShellRef.current = initShell;
    sendInputRef.current = sendInput;
    sendResizeRef.current = sendResize;
    safeFitRef.current = safeFit;
    onConnectionChangeRef.current = onConnectionChange;

    const handleClear = useCallback(() => {
      termRef.current?.clear();
      termRef.current?.focus();
    }, []);

    const handleRestart = useCallback(() => {
      termRef.current?.clear();
      termRef.current?.writeln("\r\n\x1b[33mRestarting interactive shell session...\x1b[0m\r\n");
      initShell(true);
      termRef.current?.focus();
    }, [initShell]);

    useImperativeHandle(
      ref,
      () => ({
        restart: handleRestart,
        clear: handleClear,
        focus: () => termRef.current?.focus(),
        isConnected,
      }),
      [handleRestart, handleClear, isConnected]
    );

    useEffect(() => {
      if (!containerRef.current) return;

      // 1. Initialize Terminal with crisp styling
      const term = new Terminal({
        theme: {
          background: "#121214",
          foreground: "#d4d4d8",
          cursor: "#38bdf8",
          selectionBackground: "rgba(56, 189, 248, 0.3)",
          black: "#18181b",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#facc15",
          blue: "#38bdf8",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#f4f4f5",
          brightBlack: "#52525b",
          brightRed: "#ef4444",
          brightGreen: "#22c55e",
          brightYellow: "#eab308",
          brightBlue: "#0ea5e9",
          brightMagenta: "#a855f7",
          brightCyan: "#06b6d4",
          brightWhite: "#ffffff",
        },
        fontFamily: "'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 1.25,
        cursorBlink: true,
        cursorStyle: "block",
        cursorInactiveStyle: "outline",
        convertEol: true,
        allowTransparency: false,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // 2. Keyboard Input with smooth batching
      const onDataDisposable = term.onData((data) => {
        sendInputRef.current(data);
      });

      // 3. Selection clipboard copy with Cmd+C / Ctrl+C
      term.attachCustomKeyEventHandler((event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        return true;
      });

      // 4. Synchronize dimensions
      const onResizeDisposable = term.onResize((size) => {
        sendResizeRef.current(size.cols, size.rows);
      });

      // 5. Connect to terminal output EventSource stream
      const es = new EventSource("/api/terminal/stream");
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        onConnectionChangeRef.current?.(true);
      };

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.data) {
            term.write(payload.data);
          }
        } catch {
          term.write(event.data);
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        onConnectionChangeRef.current?.(false);
      };

      // 6. Spawn backend shell process
      initShellRef.current(false);

      // Initial resize sync & focus
      const timer = setTimeout(() => {
        safeFitRef.current();
        term.focus();
      }, 100);

      const handleResize = () => {
        safeFitRef.current();
      };
      window.addEventListener("resize", handleResize);

      const resizeObserver = new ResizeObserver(() => {
        safeFit();
      });
      resizeObserver.observe(containerRef.current);

      if (document.fonts) {
        document.fonts.ready.then(() => {
          safeFitRef.current();
        });
      }

      return () => {
        clearTimeout(timer);
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
        onDataDisposable.dispose();
        onResizeDisposable.dispose();
        es.close();
        term.dispose();
        if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
      };
    }, []);

    // Sync dimensions and focus whenever visibility changes (e.g. tab switch)
    useEffect(() => {
      if (isVisible) {
        const timer = setTimeout(() => {
          safeFit();
          termRef.current?.focus();
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [isVisible, safeFit]);

    // Respawn shell if project directory changes
    useEffect(() => {
      if (termRef.current && cwd) {
        initShell(false);
      }
    }, [cwd, initShell]);

    return (
      <div
        onClick={() => termRef.current?.focus()}
        className="h-full w-full bg-[#121214] overflow-hidden select-none cursor-text relative"
      >
        <div
          ref={containerRef}
          className="xterm-terminal-container w-full h-full overflow-hidden"
        />
      </div>
    );
  }
);

export default XtermTerminal;
