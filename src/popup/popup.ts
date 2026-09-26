import { evaluateSitePolicy, normalizeHostname } from "../core/policy";
import { StorageSchema, SupportedLang } from "../types";
import { t } from "../core/i18n";

const getCurrentTabHostname = async (): Promise<string | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
};

const getStorage = (): Promise<StorageSchema> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["userWhitelist", "userBlacklist", "githubToken", "lang"],
      (res) => {
        resolve(res as StorageSchema);
      },
    );
  });
};

const render = async (): Promise<void> => {
  const storage = await getStorage();
  const currentLang: SupportedLang = storage.lang || "zh-CN";
  const whitelist = storage.userWhitelist ?? [];
  const blacklist = storage.userBlacklist ?? [];

  // 1. 设置语言选择器
  const langSelect = document.getElementById(
    "lang-select",
  ) as HTMLSelectElement;
  langSelect.value = currentLang;

  // 2. 国际化静态文本节点
  document.getElementById("lbl-language")!.textContent = t(
    "language",
    currentLang,
  );
  document.getElementById("lbl-title")!.textContent = t(
    "popupTitle",
    currentLang,
  );
  document.getElementById("lbl-token-title")!.textContent = t(
    "tokenSectionTitle",
    currentLang,
  );
  document.getElementById("lbl-token-hint")!.textContent = t(
    "tokenHint",
    currentLang,
  );
  document.getElementById("save-token-btn")!.textContent = t(
    "tokenSave",
    currentLang,
  );
  document.getElementById("clear-token-btn")!.textContent = t(
    "tokenClear",
    currentLang,
  );

  const tokenInput = document.getElementById("token-input") as HTMLInputElement;
  tokenInput.placeholder = t("tokenPlaceholder", currentLang);
  if (storage.githubToken && !tokenInput.dataset.dirty) {
    tokenInput.value = storage.githubToken;
  }

  // 3. 站点策略状态渲染
  const domainEl = document.getElementById("current-domain")!;
  const badgeEl = document.getElementById("site-badge")!;
  const btnEl = document.getElementById("toggle-btn") as HTMLButtonElement;

  const hostname = await getCurrentTabHostname();
  if (!hostname) {
    domainEl.textContent = t("cantGetDomain", currentLang);
    btnEl.disabled = true;
    return;
  }

  const cleanHost = normalizeHostname(hostname);
  domainEl.textContent = cleanHost;

  const policy = evaluateSitePolicy(cleanHost, whitelist, blacklist);
  btnEl.disabled = false;

  if (policy === "ENABLED_BUILTIN") {
    // 内置且处于启用状态：允许用户将其停用（加入黑名单）
    badgeEl.textContent = t("builtin", currentLang);
    badgeEl.className = "badge badge--builtin";
    btnEl.textContent = t("disableBuiltinBtn", currentLang);
    btnEl.className = "btn btn-secondary";
    btnEl.onclick = async () => {
      await chrome.storage.sync.set({
        userBlacklist: [...blacklist, cleanHost],
      });
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  } else if (policy === "DISABLED_BLACKLIST") {
    // 已被用户加入黑名单的内置或自定义站点：允许恢复启用
    badgeEl.textContent = t("builtinDisabled", currentLang);
    badgeEl.className = "badge badge--disabled";
    btnEl.textContent = t("enableBuiltinBtn", currentLang);
    btnEl.className = "btn btn-primary";
    btnEl.onclick = async () => {
      await chrome.storage.sync.set({
        userBlacklist: blacklist.filter((d) => d !== cleanHost),
      });
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  } else if (policy === "ENABLED_WHITELIST") {
    // 自定义白名单站点
    badgeEl.textContent = t("whitelisted", currentLang);
    badgeEl.className = "badge badge--whitelist";
    btnEl.textContent = t("removeWhitelist", currentLang);
    btnEl.className = "btn btn-secondary";
    btnEl.onclick = async () => {
      await chrome.storage.sync.set({
        userWhitelist: whitelist.filter((d) => d !== cleanHost),
      });
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  } else {
    // 未启用普通站点
    badgeEl.textContent = t("disabled", currentLang);
    badgeEl.className = "badge badge--disabled";
    btnEl.textContent = t("addWhitelist", currentLang);
    btnEl.className = "btn btn-primary";
    btnEl.onclick = async () => {
      await chrome.storage.sync.set({
        userWhitelist: [...whitelist, cleanHost],
      });
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  }
};

// 绑定事件
document.addEventListener("DOMContentLoaded", () => {
  const langSelect = document.getElementById(
    "lang-select",
  ) as HTMLSelectElement;
  const tokenInput = document.getElementById("token-input") as HTMLInputElement;
  const toggleVisibilityBtn = document.getElementById(
    "toggle-token-visibility",
  ) as HTMLButtonElement;
  const saveTokenBtn = document.getElementById(
    "save-token-btn",
  ) as HTMLButtonElement;
  const clearTokenBtn = document.getElementById(
    "clear-token-btn",
  ) as HTMLButtonElement;
  const statusEl = document.getElementById("token-status") as HTMLDivElement;

  langSelect.addEventListener("change", async () => {
    const newLang = langSelect.value as SupportedLang;
    await chrome.storage.sync.set({ lang: newLang });
    await render();
  });

  tokenInput.addEventListener("input", () => {
    tokenInput.dataset.dirty = "true";
  });

  toggleVisibilityBtn.addEventListener("click", () => {
    tokenInput.type = tokenInput.type === "password" ? "text" : "password";
  });

  saveTokenBtn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    await chrome.storage.sync.set({ githubToken: token });
    tokenInput.dataset.dirty = "";
    const storage = await getStorage();
    const currentLang = storage.lang || "zh-CN";
    statusEl.textContent = t("tokenSaved", currentLang);
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  });

  clearTokenBtn.addEventListener("click", async () => {
    tokenInput.value = "";
    tokenInput.dataset.dirty = "";
    await chrome.storage.sync.set({ githubToken: "" });
    const storage = await getStorage();
    const currentLang = storage.lang || "zh-CN";
    statusEl.textContent = t("tokenCleared", currentLang);
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  });

  void render();
});
