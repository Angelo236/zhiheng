const { app, BrowserWindow, Notification, ipcMain, safeStorage } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const http = require("node:http");

const token = "zhiheng-dev";
let port = Number(process.env.ZHIHENG_PORT ?? 8787);

function nodeBinary() {
  for (const candidate of [process.env.ZHIHENG_NODE, "/usr/local/bin/node", "/opt/homebrew/bin/node"]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

function health(targetPort) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${targetPort}/health`, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(response.statusCode === 200 && JSON.parse(body).service === "zhiheng");
        } catch {
          resolve(false);
        }
      });
    });
    request.on("error", () => resolve(false));
    request.setTimeout(400, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function choosePort() {
  for (let candidate = port; candidate < port + 10; candidate += 1) {
    if (await health(candidate)) return { port: candidate, started: false };
    const taken = await new Promise((resolve) => {
      const request = http.get(`http://127.0.0.1:${candidate}/health`, (response) => {
        response.resume();
        resolve(true);
      });
      request.on("error", () => resolve(false));
      request.setTimeout(300, () => {
        request.destroy();
        resolve(false);
      });
    });
    if (!taken) return { port: candidate, started: true };
  }
  return { port, started: true };
}

function webUp() {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:5173", (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode < 500);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(400, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function startApi() {
  const packagedServer = join(process.resourcesPath, "api", "server.js");
  const devServer = join(__dirname, "../../services/api/src/server.ts");
  const data = join(app.getPath("userData"), "zhiheng.db");
  mkdirSync(app.getPath("userData"), { recursive: true });
  const web = existsSync(join(process.resourcesPath, "web", "index.html")) ? join(process.resourcesPath, "web") : "";
  const env = {
    ...process.env,
    ZHIHENG_PORT: String(port),
    ZHIHENG_TOKEN: token,
    ZHIHENG_DATA: data,
    ZHIHENG_WEB: web,
    ELECTRON_RUN_AS_NODE: "1",
  };
  const keyFile = join(app.getPath("userData"), "key.bin");
  if (existsSync(keyFile) && safeStorage.isEncryptionAvailable()) {
    const key = safeStorage.decryptString(readFileSync(keyFile));
    writeFileSync(`${data}.secret`, key, { mode: 0o600 });
  }
  if (existsSync(packagedServer)) {
    return spawn(process.execPath, [packagedServer], { env, stdio: "inherit" });
  }
  const tsx = join(__dirname, "../../node_modules/tsx/dist/cli.mjs");
  const node = nodeBinary();
  if (node === process.execPath) env.ELECTRON_RUN_AS_NODE = "1";
  else delete env.ELECTRON_RUN_AS_NODE;
  return spawn(node, [tsx, devServer], { env, cwd: join(__dirname, "../../services/api"), stdio: "inherit" });
}

async function createWindow() {
  const choice = await choosePort();
  port = choice.port;
  let child = null;
  if (choice.started) child = startApi();
  for (let i = 0; i < 40 && !(await health(port)); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const dev = await webUp();
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "知衡",
    backgroundColor: "#f3f1ec",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  if (dev) await win.loadURL("http://127.0.0.1:5173");
  else await win.loadURL(`http://127.0.0.1:${port}`);
  win.on("closed", () => child?.kill());
  app.on("before-quit", () => child?.kill());
}

ipcMain.handle("config", () => ({ token, apiBase: `http://127.0.0.1:${port}` }));

ipcMain.handle("save-key", (_event, apiKey) => {
  const data = join(app.getPath("userData"), "zhiheng.db");
  const secretFile = `${data}.secret`;
  if (!apiKey) {
    if (existsSync(secretFile)) require("node:fs").unlinkSync(secretFile);
    const keyFile = join(app.getPath("userData"), "key.bin");
    if (existsSync(keyFile)) require("node:fs").unlinkSync(keyFile);
    return { hasKey: false };
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(join(app.getPath("userData"), "key.bin"), safeStorage.encryptString(apiKey));
  }
  writeFileSync(secretFile, apiKey, { mode: 0o600 });
  return { hasKey: true };
});

ipcMain.on("notify", (_event, title, body) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
