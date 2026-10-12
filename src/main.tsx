import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Overlay } from "./Overlay";
import { Pin } from "./Pin";
import "./styles/theme.css";
import "./styles/shell.css";
import "./styles/shot.css";

// One bundle, three kinds of window: the app, capture overlays and pins.
const label = getCurrentWindow().label;
const overlay = label.startsWith("overlay-");
const pin = label.startsWith("pin-");
if (overlay || pin) document.documentElement.classList.add("overlay-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{overlay ? <Overlay /> : pin ? <Pin /> : <App />}</React.StrictMode>,
);
