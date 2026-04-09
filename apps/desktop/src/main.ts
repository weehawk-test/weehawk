import { app, BrowserWindow, Menu } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";
import waitOn from "wait-on";

// Align defaults with typical Next/Nest dev ports.
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 8080);
const APP_USER_MODEL_ID = "com.weehawk.desktop";

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

  win.maximize();
  injectOptionalAuthChrome(win);
  await win.loadURL(`http://localhost:${WEB_PORT}`);
}

function injectOptionalAuthChrome(win: BrowserWindow) {
  const js = `
    (() => {
      if (document.getElementById('weehawk-desktop-auth-chrome')) return;
      const host = document.createElement('div');
      host.id = 'weehawk-desktop-auth-chrome';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.right = '0';
      host.style.zIndex = '2147483647';
      host.style.fontFamily = "Inter, Segoe UI, system-ui, -apple-system, sans-serif";
      host.innerHTML = \`
        <div style="-webkit-app-region:drag;background:#151515;color:#f5f5f5;border-bottom:1px solid #2b2b2b;padding:7px 10px;display:flex;align-items:center;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <div style="width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:transparent;">
              <img src="/weehawk-logo.png" alt="Weehawk" style="width:26px;height:26px;object-fit:contain;border-radius:8px;" />
            </div>
            <span style="font-size:13px;font-weight:700;letter-spacing:.35px;white-space:nowrap;">WEEHAWK <span style="color:#9ca3af;">DESKTOP</span></span>
          </div>
          <div style="flex:1;"></div>
          <div style="-webkit-app-region:no-drag;display:flex;align-items:center;gap:6px;white-space:nowrap;">
            <div style="width:1px;height:14px;background:#3f3f46;margin-left:3px;margin-right:1px;"></div>
            <button data-weehawk-win="min" title="Minimize" style="width:30px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid #475569;background:#27272a;color:#e5e7eb;border-radius:6px;cursor:pointer;font-size:12px;line-height:1;padding:0;">−</button>
            <button data-weehawk-win="max" title="Maximize" style="width:30px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid #475569;background:#27272a;color:#e5e7eb;border-radius:6px;cursor:pointer;font-size:11px;line-height:1;padding:0;">▢</button>
            <button data-weehawk-win="close" title="Close" style="width:30px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid #7f1d1d;background:#3f1515;color:#fee2e2;border-radius:6px;cursor:pointer;font-size:12px;line-height:1;padding:0;">✕</button>
          </div>
        </div>
        <div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#151515;color:#f5f5f5;padding:5px 10px;text-align:left;font-size:10px;border-top:1px solid #2b2b2b;-webkit-app-region:no-drag;">
          You are using local desktop mode. Authentication is disabled.
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
        /* Shift app fixed shell below custom desktop top bar */
        aside.fixed.top-0 {
          top: var(--weehawk-desktop-topbar-offset) !important;
          height: calc(100vh - var(--weehawk-desktop-topbar-offset) - var(--weehawk-desktop-bottombar-offset)) !important;
        }
        main {
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
      const bottomPad = 24;
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

