import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Overlay } from "./Overlay";
import { Pin } from "./Pin";
import { Card } from "./Card";
import "./styles/theme.css";
import "./styles/shell.css";
import "./styles/shot.css";
import "./styles/account.css";

// One bundle, four kinds of window: the app, capture overlays, pins and the
// quick-capture card.
const label = getCurrentWindow().label;
const overlay = label.startsWith("overlay-");
const pin = label.startsWith("pin-");
const card = label === "card";
if (overlay || pin || card) document.documentElement.classList.add("overlay-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{overlay ? <Overlay /> : pin ? <Pin /> : card ? <Card /> : <App />}</React.StrictMode>,
);
