/* 设置视图：模型 API 配置、外观（主题/语言）、记忆、数据管理 */
import React, { useEffect, useState } from "react";
import { toast, confirmDialog, setState } from "../lib/store.js";
import { api } from "../lib/api.js";
import { t, setLang, useLang } from "../lib/i18n.js";
import { setTheme, useTheme } from "../lib/theme.js";
import MemorySection from "./MemorySection.jsx";

const THEMES = [
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
  { key: "system", label: "跟随系统" },
];
const LANGS = [
  { key: "zh", label: "中文" },
  { key: "en", label: "English" },
];

export default function SettingsView() {
  const lang = useLang();
  const theme = useTheme();
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api.get("/api/settings").then(setSettings).catch((e) => toast(e.message, "error"));
  }, []);

  if (!settings) return <section className="view"><header className="view-head"><h1>{t("设置")}</h1></header></section>;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/settings", {
        model: settings.model,
        api_base: settings.api_base,
        api_key: apiKey || "***",
        system_prompt: settings.system_prompt,
      });
      toast(t("设置已保存"));
      setApiKey("");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    const yes = await confirmDialog(
      t("清空会话数据"),
      t("将删除全部会话与消息记录，且不可恢复。MCP、技能、助手等配置不受影响。确定继续？"),
      { danger: true, confirmText: t("全部清空") }
    );
    if (!yes) return;
    setClearing(true);
    try {
      const r = await api.post("/api/sessions/clear-all");
      setState({ sessions: [], sessionId: null, sessionDetail: null, messages: [], view: "settings" });
      toast(t("已清空 {n} 个会话", { n: r.removed }));
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setClearing(false);
    }
  };

  const upd = (k) => (e) => setSettings({ ...settings, [k]: e.target.value });

  return (
    <section className="view">
      <header className="view-head">
        <div>
          <h1>{t("设置")}</h1>
          <p className="subline">{t("模型设为 mock 使用内置模拟回复；配置 OpenAI 兼容接口后走真实模型。")}</p>
        </div>
      </header>

      <div className="settings-grid">
        <div className="card settings-card">
          <div className="card-head"><span className="c-name">{t("外观")}</span></div>
          <div className="field">
            <label>{t("主题")}</label>
            <div className="seg-strip" role="radiogroup" aria-label={t("主题")}>
              {THEMES.map((x) => (
                <button key={x.key}
                  className={`seg-item ${theme === x.key ? "on" : ""}`}
                  role="radio" aria-checked={theme === x.key}
                  onClick={() => setTheme(x.key)}>
                  {t(x.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>{t("语言")}</label>
            <div className="seg-strip" role="radiogroup" aria-label={t("语言")}>
              {LANGS.map((x) => (
                <button key={x.key}
                  className={`seg-item ${lang === x.key ? "on" : ""}`}
                  role="radio" aria-checked={lang === x.key}
                  onClick={() => setLang(x.key)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card settings-card">
          <div className="card-head"><span className="c-name">{t("模型服务")}</span></div>
          <div className="ast-form-row">
            <div className="field">
              <label>{t("模型")}</label>
              <input value={settings.model} onChange={upd("model")} placeholder={t("mock 或 gpt-4o-mini")} />
            </div>
            <div className="field">
              <label>{t("API 地址")}</label>
              <input value={settings.api_base} onChange={upd("api_base")} placeholder="https://api.openai.com/v1" />
            </div>
          </div>
          <div className="field">
            <label>{t("API Key")} {settings.has_api_key ? t("（已配置，留空保持不变）") : ""}</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.has_api_key ? t("留空保持不变") : "sk-…"} />
          </div>
          <div className="field">
            <label>{t("系统提示词")}</label>
            <textarea rows={4} value={settings.system_prompt} onChange={upd("system_prompt")} />
          </div>
          <div className="settings-foot">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? t("保存中…") : t("保存设置")}
            </button>
          </div>
        </div>

        <MemorySection />

        <div className="card settings-card danger-zone">
          <div className="card-head">
            <span className="c-name">{t("数据管理")}</span>
          </div>
          <div className="card-desc">{t("清空全部会话与消息记录。此操作不可恢复。")}</div>
          <div className="card-foot">
            <span className="spacer" />
            <button className="btn btn-danger" onClick={clearAll} disabled={clearing}>
              {clearing ? t("清空中…") : t("清空会话数据")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
