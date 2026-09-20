// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectModal } from "./ProjectModal";

afterEach(cleanup);

function fillIn(name: string) {
  fireEvent.change(screen.getByPlaceholderText(/user-auth-service/i), {
    target: { value: name },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /scaffold real files/i }));
}

describe("the new-project dialog", () => {
  it("stays open with the input intact when scaffolding fails", async () => {
    // The regression this pins: the dialog used to close (and clear the name)
    // *before* the write was attempted, so a failure surfaced as a bare alert
    // with the user's work already thrown away.
    const onClose = vi.fn();
    const onCreateProject = vi
      .fn()
      .mockRejectedValue(new Error("Failed to create project directory: Permission denied"));

    render(<ProjectModal isOpen onClose={onClose} onCreateProject={onCreateProject} />);
    fillIn("my-app");
    submit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Permission denied/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Still there to fix, rather than retyped from scratch.
    expect((screen.getByPlaceholderText(/user-auth-service/i) as HTMLInputElement).value).toBe("my-app");
  });

  it("passes the name, template and destination through, then closes", async () => {
    const onClose = vi.fn();
    const onCreateProject = vi.fn().mockResolvedValue(undefined);

    render(<ProjectModal isOpen onClose={onClose} onCreateProject={onCreateProject} />);
    fillIn("My New App");
    fireEvent.change(screen.getByDisplayValue("~/AcsaProjects"), {
      target: { value: "~/Desktop/Work" },
    });
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Slugs are normalised, and the destination travels untouched (the shell
    // shorthand is expanded on the Rust side, not here).
    expect(onCreateProject).toHaveBeenCalledWith("my-new-app", "nextjs", "~/Desktop/Work");
  });

  it("will not submit an empty name", () => {
    const onCreateProject = vi.fn();
    render(<ProjectModal isOpen onClose={vi.fn()} onCreateProject={onCreateProject} />);

    const button = screen.getByRole("button", { name: /scaffold real files/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onCreateProject).not.toHaveBeenCalled();
  });
});

/**
 * The dialog's keyboard contract. There was no focus trap anywhere in the app:
 * a dialog that looks modal but lets Tab walk out into the page behind it is
 * worse than no dialog styling, because the user cannot see where they are.
 */
describe("the new-project dialog, from the keyboard", () => {
  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ProjectModal isOpen onClose={onClose} onCreateProject={vi.fn()} />);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps Tab inside the dialog", async () => {
    render(<ProjectModal isOpen onClose={vi.fn()} onCreateProject={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");

    // Enabled only: a disabled control is not a tab stop, and `last.focus()` on
    // one silently does nothing — which is what made this assertion fail first.
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBeTruthy();
    expect(last).not.toBe(first);

    // Forward from the end wraps to the start…
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // …and backwards from the start wraps to the end.
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("is announced as a modal dialog, not an anonymous box", async () => {
    render(<ProjectModal isOpen onClose={vi.fn()} onCreateProject={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
  });
});
