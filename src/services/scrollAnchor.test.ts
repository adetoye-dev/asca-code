import { describe, expect, it } from "vitest";
import { FOLLOW_THRESHOLD_PX, isFollowingBottom, tailWindow } from "./scrollAnchor";

const box = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("isFollowingBottom", () => {
  it("treats a view scrolled to the bottom as following", () => {
    // 1000 tall, 400 visible, scrolled all the way down.
    expect(isFollowingBottom(box(600, 1000, 400))).toBe(true);
  });

  it("treats a view scrolled up to read something as NOT following", () => {
    // The reader went back to the top; an append must not drag them down.
    expect(isFollowingBottom(box(0, 1000, 400))).toBe(false);
  });

  it("still counts as following within the threshold, so a docked view keeps up", () => {
    expect(isFollowingBottom(box(600 - FOLLOW_THRESHOLD_PX, 1000, 400))).toBe(true);
    expect(isFollowingBottom(box(600 - FOLLOW_THRESHOLD_PX - 1, 1000, 400))).toBe(false);
  });

  it("assumes following when the container has not been laid out yet", () => {
    // jsdom and a pre-paint container both report 0s; the first line of output
    // should still be scrolled to.
    expect(isFollowingBottom(box(0, 0, 0))).toBe(true);
    expect(isFollowingBottom(null)).toBe(false);
  });
});

describe("tailWindow", () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);

  it("returns everything when the list fits", () => {
    expect(tailWindow(lines.slice(0, 10), 500)).toEqual({ items: lines.slice(0, 10), hidden: 0 });
  });

  it("keeps the tail, in order, and reports what it dropped", () => {
    const { items, hidden } = tailWindow(lines, 500);
    expect(hidden).toBe(500);
    expect(items.length).toBe(500);
    expect(items[0]).toBe("line 500");
    expect(items[items.length - 1]).toBe("line 999");
  });

  it("never returns more than the cap", () => {
    expect(tailWindow(lines, 0).items.length).toBe(0);
    expect(tailWindow(lines, -5).items.length).toBe(0);
    expect(tailWindow(lines, 1).items.length).toBe(1);
  });
});
