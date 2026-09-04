#!/usr/bin/env python3
"""
scripts/pty_bridge.py — Native Unix Pseudo-Terminal (PTY) Bridge

Allocates a real POSIX PTY (/dev/ttysXXX) on macOS/Linux for full interactive
shell support (prompt rendering, ANSI colors, tab completion, curses/vim, signals).
Communicates with Node.js via standard I/O:
- stdin (from Node): JSON-delimited control/input messages:
    {"action": "stdin", "data": "..."}
    {"action": "resize", "cols": 80, "rows": 24}
    {"action": "kill"}
- stdout (to Node): Raw binary byte stream from the PTY master.
"""

import os
import sys
import json
import signal
import struct
import argparse
import threading

def parse_args():
    parser = argparse.ArgumentParser(description="PTY Bridge for ACSA Code")
    parser.add_argument("--cwd", default=os.getcwd(), help="Initial working directory")
    parser.add_argument("--cols", type=int, default=80, help="Initial terminal columns")
    parser.add_argument("--rows", type=int, default=24, help="Initial terminal rows")
    parser.add_argument("--shell", default="", help="Shell to execute (default: $SHELL or /bin/zsh)")
    return parser.parse_args()

def main():
    args = parse_args()
    cwd = args.cwd
    if not os.path.isdir(cwd):
        cwd = os.getcwd()

    cols = max(10, args.cols)
    rows = max(4, args.rows)

    shell = args.shell or os.environ.get("SHELL", "")
    if not shell or not os.path.exists(shell):
        for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"]:
            if os.path.exists(candidate):
                shell = candidate
                break

    # Unix PTY implementation (macOS / Linux)
    if hasattr(os, "fork") and hasattr(os, "openpty"):
        import pty
        import fcntl
        import termios

        master, slave = pty.openpty()

        # Set initial terminal dimensions
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master, termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

        pid = os.fork()
        if pid == 0:
            # Child process: configure as controlling tty
            try:
                os.close(master)
                os.login_tty(slave)
                os.chdir(cwd)

                env = os.environ.copy()
                env["TERM"] = "xterm-256color"
                env["COLORTERM"] = "truecolor"
                env["LANG"] = "en_US.UTF-8"

                # Launch shell as login shell
                shell_name = os.path.basename(shell)
                os.execvpe(shell, [f"-{shell_name}"], env)
            except Exception as e:
                sys.stderr.write(f"Failed to spawn shell: {e}\n")
                sys.exit(1)

        # Parent process: bridge I/O between Node and PTY master
        os.close(slave)

        def stdin_worker():
            """Reads JSON commands from Node stdin and dispatches to PTY master."""
            while True:
                line = sys.stdin.readline()
                if not line:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except Exception:
                        pass
                    try:
                        os.close(master)
                    except Exception:
                        pass
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    action = msg.get("action")
                    if action == "stdin":
                        data = msg.get("data", "")
                        if data:
                            os.write(master, data.encode("utf-8", errors="replace"))
                    elif action == "resize":
                        c = int(msg.get("cols", 80))
                        r = int(msg.get("rows", 24))
                        winsize = struct.pack("HHHH", r, c, 0, 0)
                        fcntl.ioctl(master, termios.TIOCSWINSZ, winsize)
                    elif action == "kill":
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except Exception:
                            pass
                        try:
                            os.close(master)
                        except Exception:
                            pass
                        break
                except Exception:
                    pass

        t = threading.Thread(target=stdin_worker, daemon=True)
        t.start()

        # Main thread pumps PTY master output directly to stdout
        try:
            while True:
                try:
                    chunk = os.read(master, 4096)
                    if not chunk:
                        break
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                except (OSError, IOError):
                    break
        finally:
            try:
                os.close(master)
            except Exception:
                pass
            try:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            except Exception:
                pass

    else:
        # Fallback for platforms without fork/openpty (e.g. native Windows without WSL)
        import subprocess

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        if not shell:
            shell = os.environ.get("COMSPEC", "cmd.exe")
        proc = subprocess.Popen(
            [shell],
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            bufsize=0,
        )

        def win_stdin_worker():
            while True:
                line = sys.stdin.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    if msg.get("action") == "stdin" and proc.stdin:
                        proc.stdin.write(msg.get("data", "").encode("utf-8"))
                        proc.stdin.flush()
                    elif msg.get("action") == "kill":
                        proc.terminate()
                        break
                except Exception:
                    pass

        t = threading.Thread(target=win_stdin_worker, daemon=True)
        t.start()

        while True:
            chunk = proc.stdout.read(1024)
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()

if __name__ == "__main__":
    main()
