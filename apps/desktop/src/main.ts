import { app, BrowserWindow, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";
import waitOn from "wait-on";

// Align defaults with typical Next/Nest dev ports.
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 8080);
const APP_USER_MODEL_ID = "com.weehawk.desktop";

/** Same-origin URLs for the embedded Next app (not opened in the system browser). */
function isAppContentUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return false;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return port === String(WEB_PORT);
  } catch {
    return false;
  }
}

function attachExternalLinkHandlers(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("weehawk://")) {
      return { action: "deny" };
    }
    try {
      const u = new URL(url);
      if (u.protocol === "mailto:" || u.protocol === "tel:") {
        void shell.openExternal(url);
        return { action: "deny" };
      }
      if (u.protocol === "http:" || u.protocol === "https:") {
        if (isAppContentUrl(url)) {
          void win.loadURL(url);
          return { action: "deny" };
        }
        void shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("weehawk://")) {
      return;
    }
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        if (!isAppContentUrl(url)) {
          event.preventDefault();
          void shell.openExternal(url);
        }
      }
    } catch {
      // ignore invalid URL
    }
  });
}

function resolveRepoRoot() {
  if (app.isPackaged) {
    return path.resolve(process.resourcesPath, "..", "..");
  }
  // In dev, app path points to apps/desktop.
  return path.resolve(app.getAppPath(), "..", "..");
}

function loadEnv() {
  const repoRoot = resolveRepoRoot();
  dotenv.config({ path: path.join(repoRoot, ".env") });
  dotenv.config({ path: path.join(repoRoot, ".env.local") });
}

function resourceRoot() {
  if (app.isPackaged) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath: string })
      .resourcesPath;
    return path.join(resourcesPath, "app-resources");
  }
  return path.join(resolveRepoRoot(), "apps", "desktop", ".dist-resources");
}

function windowIconPath() {
  if (app.isPackaged) return path.join(app.getAppPath(), "assets", "icon.png");
  return path.join(resolveRepoRoot(), "apps", "desktop", "assets", "icon.png");
}

function spawnPnpm(args: string[], cwd: string) {
  const env = {
    ...process.env,
    WEB_PORT: String(WEB_PORT),
    API_PORT: String(API_PORT),
  };
  if (process.platform === "win32") {
    const cmdline = ["pnpm", ...args].join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", cmdline], {
      cwd,
      stdio: "inherit",
      env,
    });
  }
  return spawn("pnpm", args, { cwd, stdio: "inherit", env });
}

function spawnPnpmWithEnv(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv) {
  const env = {
    ...process.env,
    WEB_PORT: String(WEB_PORT),
    API_PORT: String(API_PORT),
    ...extraEnv,
  };
  if (process.platform === "win32") {
    const cmdline = ["pnpm", ...args].join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", cmdline], {
      cwd,
      stdio: "inherit",
      env,
    });
  }
  return spawn("pnpm", args, { cwd, stdio: "inherit", env });
}

function spawnNode(scriptPath: string, args: string[] = [], cwd?: string, env?: NodeJS.ProcessEnv) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    frame: false,
    icon: windowIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachExternalLinkHandlers(win);
  win.maximize();
  await win.loadURL(`http://localhost:${WEB_PORT}`);
  // Inject after load so the script runs on the real document (not about:blank).
  injectOptionalAuthChrome(win);
}

function injectOptionalAuthChrome(win: BrowserWindow) {
  const js = `
    (() => {
      if (document.getElementById('weehawk-desktop-auth-chrome')) return;
      document.documentElement.classList.add('weehawk-desktop');
      const host = document.createElement('div');
      host.id = 'weehawk-desktop-auth-chrome';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.right = '0';
      host.style.zIndex = '2147483647';
      host.style.fontFamily = "Inter, Segoe UI, system-ui, -apple-system, sans-serif";
      host.innerHTML = \`
        <div class="weehawk-titlebar">
          <div class="weehawk-titlebar-brand">
            <div class="weehawk-titlebar-logo">
              <img src="/weehawk-logo.png" alt="Weehawk" width="26" height="26" />
            </div>
            <span class="weehawk-titlebar-text">WEEHAWK <span class="weehawk-titlebar-accent">DESKTOP</span></span>
          </div>
          <div class="weehawk-titlebar-spacer" aria-hidden="true"></div>
          <div class="weehawk-titlebar-controls">
            <div class="weehawk-titlebar-sep" aria-hidden="true"></div>
            <button type="button" data-weehawk-win="min" title="Minimize" class="weehawk-winbtn weehawk-winbtn-min">−</button>
            <button type="button" data-weehawk-win="max" title="Maximize" class="weehawk-winbtn weehawk-winbtn-max">▢</button>
            <button type="button" data-weehawk-win="close" title="Close" class="weehawk-winbtn weehawk-winbtn-close">✕</button>
          </div>
        </div>
      \`;
      document.body.appendChild(host);
      let style = document.getElementById('weehawk-desktop-auth-chrome-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'weehawk-desktop-auth-chrome-style';
        document.head.appendChild(style);
      }
      style.textContent = \`
        /* No document-level scroll: scrollbar lives in <main> only, below the title bar */
        html.weehawk-desktop {
          height: 100%;
          overflow: hidden !important;
          /* Thin scrollbar — dark palette (night) */
          --weehawk-sb-size: 6px;
          --weehawk-sb-track: #000000;
          --weehawk-sb-thumb: #1f1f1f;
          --weehawk-sb-thumb-hover: #2e2e2e;
          --weehawk-sb-thumb-active: #3a3a3a;
        }
        /* Light theme: visible gray rail (black rail/thumb vanish on light UI / color-scheme) */
        html.weehawk-desktop.light {
          --weehawk-sb-track: #e4e4e7;
          --weehawk-sb-thumb: #9ca3af;
          --weehawk-sb-thumb-hover: #71717a;
          --weehawk-sb-thumb-active: #52525b;
        }
        /*
         * Chromium 121+: scrollbar-color / scrollbar-width take precedence and disable
         * ::-webkit-scrollbar styling (falls back to OS / Fluent scrollbars on Windows).
         * Do not set standard scrollbar properties here; use webkit pseudos only.
         */
        html.weehawk-desktop body {
          height: 100% !important;
          max-height: 100% !important;
          min-height: 0 !important;
          overflow: hidden !important;
          box-sizing: border-box !important;
        }
        /* Only the app root (first child); portals appended to body must stay unaffected */
        html.weehawk-desktop body > *:first-child:not(#weehawk-desktop-auth-chrome) {
          flex: 1 1 0% !important;
          min-height: 0 !important;
          min-width: 0 !important;
          max-height: 100% !important;
          overflow: hidden !important;
        }
        #weehawk-desktop-auth-chrome {
          flex: none !important;
        }
        /* Frameless title bar — dark (default) */
        #weehawk-desktop-auth-chrome .weehawk-titlebar {
          -webkit-app-region: drag;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          background: #151515;
          color: #f5f5f5;
          border-bottom: 1px solid #2b2b2b;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.35px;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-brand {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-logo {
          width: 28px;
          height: 28px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: transparent;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-logo img {
          width: 26px;
          height: 26px;
          object-fit: contain;
          border-radius: 8px;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-text {
          white-space: nowrap;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-accent {
          color: #9ca3af;
          font-weight: 700;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-spacer {
          flex: 1;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-controls {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }
        #weehawk-desktop-auth-chrome .weehawk-titlebar-sep {
          width: 1px;
          height: 14px;
          background: #3f3f46;
          margin-left: 3px;
          margin-right: 1px;
        }
        #weehawk-desktop-auth-chrome .weehawk-winbtn {
          width: 30px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
          padding: 0;
          border: 1px solid #475569;
          background: #27272a;
          color: #e5e7eb;
        }
        #weehawk-desktop-auth-chrome .weehawk-winbtn-max {
          font-size: 11px;
        }
        #weehawk-desktop-auth-chrome .weehawk-winbtn-min:hover,
        #weehawk-desktop-auth-chrome .weehawk-winbtn-max:hover {
          background: #3f3f46;
          border-color: #64748b;
        }
        #weehawk-desktop-auth-chrome .weehawk-winbtn-close {
          border-color: #7f1d1d;
          background: #3f1515;
          color: #fee2e2;
        }
        #weehawk-desktop-auth-chrome .weehawk-winbtn-close:hover {
          background: #5c1f1f;
          border-color: #991b1b;
        }
        /* Frameless title bar — light (matches next-themes html.light) */
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-titlebar {
          background: #fafafa;
          color: #18181b;
          border-bottom-color: #e4e4e7;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
        }
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-titlebar-accent {
          color: #71717a;
        }
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-titlebar-sep {
          background: #d4d4d8;
        }
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-winbtn-min,
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-winbtn-max {
          border-color: #d4d4d8;
          background: #f4f4f5;
          color: #3f3f46;
        }
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-winbtn-min:hover,
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-winbtn-max:hover {
          background: #e4e4e7;
          border-color: #a1a1aa;
        }
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-winbtn-close {
          border-color: #fca5a5;
          background: #fef2f2;
          color: #b91c1c;
        }
        html.weehawk-desktop.light #weehawk-desktop-auth-chrome .weehawk-winbtn-close:hover {
          background: #fee2e2;
          border-color: #f87171;
        }
        html.weehawk-desktop div:has(> aside.fixed) {
          min-height: 0 !important;
          height: 100% !important;
          max-height: 100% !important;
        }
        html.weehawk-desktop main.overflow-y-auto {
          min-height: 0 !important;
        }
        /* Custom scrollbars — thin black rail */
        html.weehawk-desktop *::-webkit-scrollbar-button {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        html.weehawk-desktop *::-webkit-scrollbar {
          width: var(--weehawk-sb-size);
          height: var(--weehawk-sb-size);
        }
        html.weehawk-desktop *::-webkit-scrollbar:vertical {
          width: var(--weehawk-sb-size);
        }
        html.weehawk-desktop *::-webkit-scrollbar:horizontal {
          height: var(--weehawk-sb-size);
        }
        html.weehawk-desktop *::-webkit-scrollbar-track {
          background: var(--weehawk-sb-track);
          border-radius: 999px;
        }
        html.weehawk-desktop *::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: var(--weehawk-sb-thumb);
          border: 1px solid var(--weehawk-sb-track);
          background-clip: padding-box;
        }
        html.weehawk-desktop *::-webkit-scrollbar-thumb:hover {
          background: var(--weehawk-sb-thumb-hover);
        }
        html.weehawk-desktop *::-webkit-scrollbar-thumb:active {
          background: var(--weehawk-sb-thumb-active);
        }
        html.weehawk-desktop *::-webkit-scrollbar-corner {
          background: var(--weehawk-sb-track);
        }
        /* Shift app fixed shell below custom desktop top bar */
        html.weehawk-desktop aside.fixed.top-0 {
          top: var(--weehawk-desktop-topbar-offset) !important;
          height: calc(100vh - var(--weehawk-desktop-topbar-offset) - var(--weehawk-desktop-bottombar-offset)) !important;
        }
        html.weehawk-desktop main {
          padding-bottom: var(--weehawk-desktop-bottombar-offset) !important;
        }
      \`;
      const attach = (k) => {
        const el = host.querySelector('[data-weehawk-win="' + k + '"]');
        if (!el) return;
        el.addEventListener('click', () => {
          window.location.href = 'weehawk://window/' + k;
        });
      };
      attach('min');
      attach('max');
      attach('close');
      const topPad = 40;
      const bottomPad = 0;
      document.documentElement.style.setProperty('--weehawk-desktop-topbar-offset', topPad + 'px');
      document.documentElement.style.setProperty('--weehawk-desktop-bottombar-offset', bottomPad + 'px');
      document.body.style.paddingTop = 'var(--weehawk-desktop-topbar-offset)';
      document.body.style.paddingBottom = 'var(--weehawk-desktop-bottombar-offset)';
    })();
  `;
  const runInject = () => {
    void win.webContents.executeJavaScript(js);
  };
  win.webContents.on("did-finish-load", runInject);
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("weehawk://window/")) return;
    event.preventDefault();
    const action = url.replace("weehawk://window/", "").toLowerCase();
    if (action === "min") {
      win.minimize();
      return;
    }
    if (action === "max") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return;
    }
    if (action === "close") {
      win.close();
    }
  });
  // Also try immediately in case caller attached after first load.
  runInject();
}

let webProc: ChildProcess | undefined;
let apiProc: ChildProcess | undefined;

async function startDevServers() {
  const repoRoot = resolveRepoRoot();
  // Nest reads PORT
  apiProc = spawnPnpmWithEnv(["--filter", "api", "dev"], repoRoot, {
    PORT: String(API_PORT),
    NODE_ENV: "development",
  });
  // Use pnpm exec so Next doesn't receive a literal "--" arg.
  webProc = spawnPnpmWithEnv(
    ["--filter", "web", "exec", "next", "dev", "--hostname", "localhost", "-p", String(WEB_PORT)],
    repoRoot,
    { NODE_ENV: "development" },
  );
}

async function startProdServers() {
  const base = resourceRoot();
  const apiMain = path.join(base, "api", "dist", "main.js");
  const webServer = path.join(base, "web", "server.js");

  apiProc = spawnNode(apiMain, [], path.dirname(apiMain), {
    NODE_ENV: "production",
    PORT: String(API_PORT),
  });

  webProc = spawnNode(webServer, [], path.dirname(webServer), {
    NODE_ENV: "production",
    PORT: String(WEB_PORT),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
  });
}

async function waitForDevReady() {
  await waitOn({
    // Open the window as soon as web is reachable; API can continue booting.
    resources: [`http://localhost:${WEB_PORT}`],
    timeout: 180_000,
    interval: 250,
    validateStatus: (status: number) => status >= 200 && status < 500,
  });
}

async function waitForProdReady() {
  await waitOn({
    resources: [`http://localhost:${WEB_PORT}`],
    timeout: 180_000,
    interval: 250,
    validateStatus: (status: number) => status >= 200 && status < 500,
  });
}

function stopProc(p?: ChildProcess) {
  if (!p || p.killed) return;
  try {
    p.kill();
  } catch {
    // ignore
  }
}

app.on("window-all-closed", () => {
  stopProc(webProc);
  stopProc(apiProc);
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(async () => {
  loadEnv();
  app.setAppUserModelId(APP_USER_MODEL_ID);
  Menu.setApplicationMenu(null);
  if (app.isPackaged) {
    await startProdServers();
    await waitForProdReady();
  } else {
    await startDevServers();
    await waitForDevReady();
  }
  await createWindow();
});

