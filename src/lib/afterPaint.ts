/**
 * Runs `fn` once the next frame has painted: a task queued from requestAnimationFrame
 * runs after that frame's style, layout and paint. Work moved here stays out of the
 * interaction that scheduled it, since INP stops at the next paint. Returns a cancel
 * function. Hidden tabs run no frames, so `fn` waits until the tab is shown.
 */
export function afterNextPaint(fn: () => void): () => void {
  let task: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    task = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (task !== undefined) clearTimeout(task);
  };
}
