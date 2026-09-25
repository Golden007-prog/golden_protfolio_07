import { defineConfig, devices, type Project } from '@playwright/test';
import { EXPECTED_THIRD_PARTY_FAILURES } from './tests/e2e/helpers';

const PORT = Number(process.env.PW_PORT ?? 3100);
// PW_BASE_URL points the suite at an already running server (or a preview deploy).
const BASE_URL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const VIEWPORTS: { width: number; height: number; coarse?: boolean }[] = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768, coarse: true },
  { width: 1440, height: 900 },
];
const THEMES = ['dark', 'light'] as const;
const MOTION = [
  { name: 'motion', reducedMotion: 'no-preference' },
  { name: 'reduced', reducedMotion: 'reduce' },
] as const;

// The site defaults to dark whatever the OS says, so the theme is seeded through
// the same localStorage key the head bootstrap reads.
const projects: Project[] = VIEWPORTS.flatMap((vp) =>
  THEMES.flatMap((theme) =>
    MOTION.map(
      (motion): Project => ({
        name: `${vp.width}x${vp.height}${vp.coarse ? '-touch' : ''}-${theme}-${motion.name}`,
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: vp.width, height: vp.height },
          ...(vp.coarse ? { hasTouch: true, isMobile: true } : {}),
          colorScheme: theme,
          reducedMotion: motion.reducedMotion,
          storageState: {
            cookies: [],
            origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: 'theme', value: theme }] }],
          },
        },
      }),
    ),
  ),
);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  metadata: { expectedThirdPartyFailures: EXPECTED_THIRD_PARTY_FAILURES.map(String) },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Headless Chromium falls back to SwiftShader unless told to use the GPU, and the
    // site treats software WebGL as "no heavy 3D". D3D11 is desktop Chrome's own
    // backend on Windows, so the 3D paths get tested there; Linux CI tests the stills.
    launchOptions: process.platform === 'win32' ? { args: ['--use-angle=d3d11'] } : {},
  },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        // Serves the build the orchestrator made; run `next build` first.
        command: `npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects,
});
