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

const renderBlacklistTags = (
  blacklist: readonly string[],
  currentLang: SupportedLang,
): void => {
  const container = document.getElementById("blacklist-tags")!;
  container.innerHTML = "";

  if (blacklist.length === 0) {
    const tip = document.createElement("div");
    tip.className = "empty-tip";
    tip.textContent = t("noBlacklistDomains", currentLang);
    container.appendChild(tip);
    return;
  }

  for (const domain of blacklist) {
    const tag = document.createElement("span");
    tag.className = "blacklist-tag";

    const text = document.createElement("span");
    text.textContent = domain;
    tag.appendChild(text);

    const delBtn = document.createElement("button");
    delBtn.className = "tag-remove-btn";
    delBtn.textContent = "×";
    delBtn.title = t("removeFromBlacklistBtn", currentLang);
    delBtn.onclick = async () => {
      const updated = blacklist.filter((d) => d !== domain);
      await chrome.storage.sync.set({ userBlacklist: updated });
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };

    tag.appendChild(delBtn);
    container.appendChild(tag);
  }
};

const render = async (): Promise<void> => {
  const storage = await getStorage();
  const currentLang: SupportedLang = storage.lang || "zh-CN";
  const whitelist = storage.userWhitelist ?? [];
  const blacklist = storage.userBlacklist ?? [];

  // 1. 设置语言选择器与静态文案
  const langSelect = document.getElementById(
    "lang-select",
  ) as HTMLSelectElement;
  langSelect.value = currentLang;

  document.getElementById("lbl-language")!.textContent = t(
    "language",
    currentLang,
  );
  const githubLink = document.getElementById(
    "github-link",
  ) as HTMLAnchorElement | null;
  if (githubLink) {
    const repoLabel = t("openGithubRepo", currentLang);
    githubLink.setAttribute("aria-label", repoLabel);
    githubLink.setAttribute("title", repoLabel);
  }
  document.getElementById("lbl-title")!.textContent = t(
    "popupTitle",
    currentLang,
  );
  document.getElementById("lbl-blacklist-title")!.textContent = t(
    "blacklistSectionTitle",
    currentLang,
  );
  document.getElementById("add-blacklist-btn")!.textContent = t(
    "addBlacklistBtn",
    currentLang,
  );
  (document.getElementById("blacklist-input") as HTMLInputElement).placeholder =
    t("blacklistInputPlaceholder", currentLang);

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

  // 2. 渲染黑名单 Tags 列表
  renderBlacklistTags(blacklist, currentLang);

  // 3. 渲染当前站点策略与操作按钮
  const domainEl = document.getElementById("current-domain")!;
  const badgeEl = document.getElementById("site-badge")!;
  const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
  const blacklistCurrentBtn = document.getElementById(
    "blacklist-current-btn",
  ) as HTMLButtonElement;

  const hostname = await getCurrentTabHostname();
  if (!hostname) {
    domainEl.textContent = t("cantGetDomain", currentLang);
    toggleBtn.disabled = true;
    blacklistCurrentBtn.classList.add("hidden");
    return;
  }

  const cleanHost = normalizeHostname(hostname);
  domainEl.textContent = cleanHost;

  const policy = evaluateSitePolicy(cleanHost, whitelist, blacklist);
  toggleBtn.disabled = false;

  if (policy === "DISABLED_BLACKLIST") {
    // 已经被黑名单拦截：展示“移出黑名单”按钮
    badgeEl.textContent = t("blacklisted", currentLang);
    badgeEl.className = "badge badge--blacklist";
    toggleBtn.textContent = t("removeFromBlacklistBtn", currentLang);
    toggleBtn.className = "btn btn-primary";
    toggleBtn.onclick = async () => {
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
    blacklistCurrentBtn.classList.add("hidden");
  } else if (policy === "ENABLED_BUILTIN") {
    badgeEl.textContent = t("builtin", currentLang);
    badgeEl.className = "badge badge--builtin";
    toggleBtn.textContent = t("disableBuiltinBtn", currentLang);
    toggleBtn.className = "btn btn-secondary";
    toggleBtn.onclick = async () => {
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
    blacklistCurrentBtn.classList.add("hidden");
  } else if (policy === "ENABLED_WHITELIST") {
    badgeEl.textContent = t("whitelisted", currentLang);
    badgeEl.className = "badge badge--whitelist";
    toggleBtn.textContent = t("removeWhitelist", currentLang);
    toggleBtn.className = "btn btn-secondary";
    toggleBtn.onclick = async () => {
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

    // 允许将白名单站点快速一键加入黑名单
    blacklistCurrentBtn.classList.remove("hidden");
    blacklistCurrentBtn.textContent = t("addToBlacklistBtn", currentLang);
    blacklistCurrentBtn.onclick = async () => {
      await chrome.storage.sync.set({
        userWhitelist: whitelist.filter((d) => d !== cleanHost),
        userBlacklist: [...blacklist, cleanHost],
      });
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  } else {
    // 未启用普通站点：同时展示“加白名单”与“加入黑名单”操作
    badgeEl.textContent = t("disabled", currentLang);
    badgeEl.className = "badge badge--disabled";
    toggleBtn.textContent = t("addWhitelist", currentLang);
    toggleBtn.className = "btn btn-primary";
    toggleBtn.onclick = async () => {
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

    blacklistCurrentBtn.classList.remove("hidden");
    blacklistCurrentBtn.textContent = t("addToBlacklistBtn", currentLang);
    blacklistCurrentBtn.onclick = async () => {
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
  }
};

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

  const blacklistInput = document.getElementById(
    "blacklist-input",
  ) as HTMLInputElement;
  const addBlacklistBtn = document.getElementById(
    "add-blacklist-btn",
  ) as HTMLButtonElement;

  langSelect.addEventListener("change", async () => {
    const newLang = langSelect.value as SupportedLang;
    await chrome.storage.sync.set({ lang: newLang });
    await render();
  });

  // 黑名单输入框添加逻辑
  const handleAddBlacklist = async () => {
    const rawVal = blacklistInput.value.trim();
    if (!rawVal) return;

    let targetDomain = rawVal;
    try {
      if (targetDomain.includes("://")) {
        targetDomain = new URL(targetDomain).hostname;
      }
    } catch {
      // 容错使用纯文本格式
    }

    const clean = normalizeHostname(targetDomain);
    if (!clean || clean.length < 3) return;

    const storage = await getStorage();
    const currentBlacklist = storage.userBlacklist ?? [];
    if (!currentBlacklist.includes(clean)) {
      await chrome.storage.sync.set({
        userBlacklist: [...currentBlacklist, clean],
        userWhitelist: (storage.userWhitelist ?? []).filter((d) => d !== clean),
      });
    }

    blacklistInput.value = "";
    await render();

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id && tab.url && tab.url.includes(clean)) {
      chrome.tabs.reload(tab.id);
    }
  };

  addBlacklistBtn.addEventListener("click", () => {
    void handleAddBlacklist();
  });

  blacklistInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAddBlacklist();
    }
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
