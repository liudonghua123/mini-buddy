/* 主题：light / dark / system，持久化到 localStorage，写 data-theme 到 <html> */
import { useSyncExternalStore } from "react";

const THEME_KEY = "mb_theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");

let theme = "light";
try { theme = localStorage.getItem(THEME_KEY) || "light"; } catch { /* ignore */ }

const listeners = new Set();

function effective(t) { return t === "system" ? (mq.matches ? "dark" : "light") : t; }

function apply() {
  document.documentElement.dataset.theme = effective(theme);
}

export function setTheme(t) {
  theme = t === "dark" || t === "system" ? t : "light";
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  apply();
  for (const fn of listeners) fn();
}

export function getTheme() { return theme; }

mq.addEventListener("change", () => { if (theme === "system") apply(); });

// 启动即应用，避免闪烁（main.jsx import 顺序最早）
apply();

export function useTheme() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => theme
  );
}
