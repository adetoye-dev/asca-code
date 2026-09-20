/**
 * useDialogA11y — the three things a dialog owes a keyboard user.
 *
 * There was no focus trap anywhere in the app. A dialog that looks modal but lets
 * Tab walk out into the page behind it is worse than no dialog styling at all:
 * the user cannot see where they are, and the thing they just opened is invisible
 * to the accessibility tree. Two dialogs had no Escape handling either, so the
 * only way out was the mouse.
 *
 * 1. **Tab stays inside.** Wraps at both ends, and pulls focus back in if it ever
 *    leaves (a stray click, or a control that removes itself).
 * 2. **Escape closes.** On the document, so it works wherever focus happens to be.
 * 3. **Focus comes back.** Restores the element that had focus before it opened,
 *    which is what lets a keyboard user carry on where they were.
 *
 * `role="dialog"` and `aria-modal="true"` are the caller's job: this hook cannot
 * know whether a dialog is modal, and claiming so falsely hides the page behind
 * it from a screen reader.
 */

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogA11y(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  isOpen = true,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Every focusable descendant, with no visibility test. An earlier version
    // filtered on `offsetParent`, which is a trap of its own: it is null for a
    // `position: fixed` ancestor and for every element under jsdom, so the filter
    // silently emptied the list. Collapsible panes here are not rendered rather
    // than hidden, so there is nothing to filter.
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));

    const onKeyDown = (event: KeyboardEvent) => {
      // Only the dialog that actually holds focus answers. Otherwise Escape would
      // close every dialog stacked on the screen at once.
      if (!node.contains(event.target as Node) && !node.contains(document.activeElement)) return;

      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!node.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture, so a handler inside the dialog cannot swallow Tab or Escape first.
    document.addEventListener("keydown", onKeyDown, true);

    // Move focus in, unless the caller already did it (ProjectModal auto-focuses
    // its name field, which is a better landing spot than the container).
    if (!node.contains(document.activeElement)) {
      const items = focusable();
      (items[0] ?? node).focus();
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only if focus is still inside: otherwise something else has deliberately
      // moved it, and stealing it back would be the bug rather than the fix.
      if (previouslyFocused && node.contains(document.activeElement)) {
        previouslyFocused.focus?.();
      }
    };
  }, [ref, onClose, isOpen]);
}
