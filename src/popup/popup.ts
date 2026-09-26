import { evaluateSitePolicy, normalizeHostname } from "../core/policy";
import { StorageSchema } from "../types";

const getCurrentTabHostname = async (): Promise<string | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
};

const getWhitelist = (): Promise<readonly string[]> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      "userWhitelist",
      (res: { [key: string]: unknown }) => {
        const data = res as Partial<StorageSchema>;
        resolve(data.userWhitelist ?? []);
      },
    );
  });
};

const updateWhitelist = (list: readonly string[]): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ userWhitelist: list }, resolve);
  });
};

const render = async (): Promise<void> => {
  const domainEl = document.getElementById("current-domain")!;
  const badgeEl = document.getElementById("site-badge")!;
  const btnEl = document.getElementById("toggle-btn") as HTMLButtonElement;

  const hostname = await getCurrentTabHostname();
  if (!hostname) {
    domainEl.textContent = "无法获取当前站点";
    return;
  }

  const cleanHost = normalizeHostname(hostname);
  domainEl.textContent = cleanHost;

  const whitelist = await getWhitelist();
  const policy = evaluateSitePolicy(cleanHost, whitelist);

  btnEl.disabled = false;

  if (policy === "ENABLED_BUILTIN") {
    badgeEl.textContent = "内置支持";
    badgeEl.className = "badge badge--builtin";
    btnEl.textContent = "内置 AI 站点（始终生效）";
    btnEl.disabled = true;
  } else if (policy === "ENABLED_WHITELIST") {
    badgeEl.textContent = "已加白名单";
    badgeEl.className = "badge badge--whitelist";
    btnEl.textContent = "从白名单中移除";
    btnEl.onclick = async () => {
      await updateWhitelist(whitelist.filter((d) => d !== cleanHost));
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  } else {
    badgeEl.textContent = "未启用";
    badgeEl.className = "badge badge--disabled";
    btnEl.textContent = "将本站加入白名单并启用";
    btnEl.onclick = async () => {
      await updateWhitelist([...whitelist, cleanHost]);
      await render();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id);
    };
  }
};

void render();
