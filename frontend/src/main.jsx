import React from "react";
import { createRoot } from "react-dom/client";
import "./lib/theme.js";   // 先于样式应用主题，防闪烁
import "./lib/i18n.js";
import App from "./App.jsx";
import "./styles/global.css";
import "./styles/components.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
