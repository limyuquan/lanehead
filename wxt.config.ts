import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * Public half of the key that fixes the unpacked extension ID (EXTENSION_ID in src/shared/ids.ts).
 * The private half was discarded; the store assigns its own ID to the `store` build.
 */
const PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmwJCtaQVtjLh6UqJHldCHkkGDScS0lQBusCJJFN3e2hp9vVLFjfqSA88JqMM/sNvm34Mlbphvs6XHFvtwq4StUA8Plg0Abid0Z2C1kQSBm4cldYqv7BbG2jKatTWZr0lLwSyX/G9GgWTj77ujbVQvWblGR3b+EJPxjxqVkBWBmffTO+//Ly/n+RS3JHnrtSAeVPc2Ig+HYRYaU/tpKBSJiXkR2jxYaG4KYhMa7mOdZnncyHImzF73aF1j/H5gMR3p8G4fBnoaiVW2aGUlFiwW2MEaM9ibOfhMTV24rMhGfakLkyDmKl5yhZti/7o+ijIdFA1wS1zo7qFdSS8N4hcZwIDAQAB';

/**
 * Lanehead build config. The manifest is generated from here.
 *
 * Modes:
 * - `production` (`pnpm build`, `pnpm zip`): the build people load unpacked, fixed ID via `key`.
 * - `store` (`pnpm zip:store`): Chrome Web Store upload, no `key` (the store rejects it).
 * - `development` (`pnpm dev`): WXT dev runner, fixed ID via `key`.
 * - `e2e` (`pnpm build:e2e`): outputs to `.output/chrome-mv3-e2e`, fixed ID via `key`.
 */
export default defineConfig({
  srcDir: 'src',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  // Explicit imports everywhere (`wxt/browser`, `wxt/utils/define-background`, ...).
  imports: false,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ mode }) => ({
    name: 'Lanehead',
    description:
      'Per-tab request headers. Give every tab its own lane; let your coding agent switch them.',
    minimum_chrome_version: '120',
    ...(mode !== 'store' && { key: PUBLIC_KEY }),
    permissions: [
      'declarativeNetRequest',
      'storage',
      'tabs',
      'webNavigation',
      'alarms',
      'nativeMessaging',
    ],
    host_permissions: ['<all_urls>'],
    // `default_popup` comes from the `popup` entrypoint. `icons` is discovered from public/icon/
    // (rendered from assets/icon.svg by `pnpm icons`).
    action: {
      default_title: 'Lanehead',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png' },
    },
    // The manage page is an unlisted WXT page (src/entrypoints/manage), used as the options page.
    options_ui: { page: 'manage.html', open_in_tab: true },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+H' },
        description: 'Open Lanehead',
      },
    },
  }),
});
