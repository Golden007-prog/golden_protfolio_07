/** Every Lottie the site plays, by name. Files live in /public/lottie. */
export const LOTTIE = {
  dots: '/lottie/dots.json',
  scroll: '/lottie/scroll.json',
  success: '/lottie/success.json',
  error: '/lottie/error.json',
  send: '/lottie/send.json',
  wave: '/lottie/wave.json',
  copyCheck: '/lottie/copy-check.json',
  download: '/lottie/download.json',
  rocket: '/lottie/rocket.json',
  emptySearch: '/lottie/empty-search.json',
  typing: '/lottie/typing.json',
  sparkle: '/lottie/sparkle.json',
  calendar: '/lottie/calendar.json',
} as const;

export type LottieName = keyof typeof LOTTIE;
