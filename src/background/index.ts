import { ingestRepository } from '../core/ingest';
import { DomainError } from '../core/errors';
import { ExtensionResponse, StorageSchema } from '../types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'INGEST_REPO') return false;

  const targetUrl = message.payload?.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    sendResponse({
      success: false,
      error: { code: 'INVALID_URL', message: 'Target repository URL is required.' },
    } as ExtensionResponse);
    return false;
  }

  chrome.storage.sync.get(['githubToken', 'lang'], (items) => {
    const config = items as StorageSchema;
    const token = config.githubToken;
    const lang = config.lang || 'zh-CN';

    ingestRepository(targetUrl, { token, lang })
      .then((summary) => {
        sendResponse({ success: true, payload: summary } as ExtensionResponse);
      })
      .catch((err: unknown) => {
        const domainErr = DomainError.from(err);
        sendResponse({
          success: false,
          error: { code: domainErr.code, message: domainErr.message },
        } as ExtensionResponse);
      });
  });

  return true;
});
