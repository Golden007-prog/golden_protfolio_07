/**
 * One decode frame of `text`: the first floor(progress * length) characters are
 * settled, the rest are drawn from `charset`, and spaces stay spaces. The result is
 * always exactly text.length long; progress is clamped (NaN counts as 0) so a stray
 * value can never lengthen the line and reflow what sits around it.
 */
export function scrambleFrame(text: string, progress: number, charset: string, random: () => number = Math.random): string {
  const p = progress > 0 ? Math.min(1, progress) : 0;
  const settled = Math.floor(p * text.length);
  let out = text.slice(0, settled);
  for (let i = settled; i < text.length; i++) {
    out += text[i] === ' ' ? ' ' : charset[Math.floor(random() * charset.length)];
  }
  return out;
}

export type FrameScheduler = {
  request: (cb: (now: number) => void) => number;
  cancel: (id: number) => void;
};

const animationFrames: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * Writes a decode of `text` through `write`, one frame per animation frame, until the
 * final text is written. Returns a function that stops it.
 *
 * Elapsed time runs from the first frame's timestamp, never from a performance.now()
 * read: a frame's timestamp is when the frame began, so it can predate a read taken
 * later in that frame, and mixing the two clocks gave a negative progress.
 */
export function runScramble(
  write: (frame: string) => void,
  text: string,
  duration: number,
  charset: string,
  scheduler: FrameScheduler = animationFrames,
  random: () => number = Math.random,
): () => void {
  let id = 0;
  let start: number | undefined;
  const tick = (now: number) => {
    start ??= now;
    const progress = Math.min(1, (now - start) / duration);
    write(scrambleFrame(text, progress, charset, random));
    if (progress < 1) id = scheduler.request(tick);
  };
  id = scheduler.request(tick);
  return () => scheduler.cancel(id);
}
