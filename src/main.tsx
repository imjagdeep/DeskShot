import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Overlay } from "./Overlay";
import "./styles/theme.css";
import "./styles/shell.css";
import "./styles/shot.css";

// One bundle, two kinds of window: the app and the capture overlays.
const overlay = getCurrentWindow().label.startsWith("overlay-");
if (overlay) document.documentElement.classList.add("overlay-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{overlay ? <Overlay /> : <App />}</React.StrictMode>,
);
