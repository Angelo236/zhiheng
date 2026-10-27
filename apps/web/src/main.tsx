import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { setRuntime } from "./api";
import "./styles.css";

async function boot() {
  if (window.zhiheng?.getConfig) {
    const config = await window.zhiheng.getConfig();
    setRuntime(config);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void boot();
