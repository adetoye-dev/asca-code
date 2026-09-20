/**
 * scrollAnchor — the two bits of arithmetic behind "follow the tail".
 *
 * Both live here rather than inline in a component so they can be tested
 * directly: the behaviour they protect (never yank a reader who has scrolled up,
 * never grow an unbounded DOM) is invisible in a screenshot and easy to lose.
 */

/** How close to the bottom still counts as "following along", in px. */
export const FOLLOW_THRESHOLD_PX = 48;

/** The three numbers a scroll container needs to answer the question. */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Is the view at (or within `threshold` of) the bottom?
 *
 * Used to decide whether an append should scroll at all. A reader who has
 * scrolled up to look at something is not following the tail, and scrolling them
 * back down on every new line — which is what an unconditional
 * `scrollIntoView` does — makes a running log unreadable.
 */
export function isFollowingBottom(
  el: ScrollMetrics | null | undefined,
  threshold: number = FOLLOW_THRESHOLD_PX
): boolean {
  if (!el) return false;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
    // A container that cannot be measured (not laid out yet) is treated as
    // following, so the first line of output still lands in view.
    return true;
  }
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * The last `max` entries of a list, plus how many were left out.
 *
 * An agent run can print thousands of lines; rendering every one of them costs a
 * row per line on every append. The tail is what a person reads, so only the
 * tail is rendered — and the count of what is missing is returned so the UI can
 * say so instead of quietly pretending the log starts there.
 */
export function tailWindow<T>(
  items: readonly T[],
  max: number
): { items: readonly T[]; hidden: number } {
  if (max <= 0) return { items: [], hidden: items.length };
  if (items.length <= max) return { items, hidden: 0 };
  return { items: items.slice(items.length - max), hidden: items.length - max };
}
