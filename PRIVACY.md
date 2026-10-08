# Privacy Policy

**AI GitHub Ingest Engine**

Effective date: 2026-10-08

This Privacy Policy describes how AI GitHub Ingest Engine ("the Extension") handles information when you use the browser extension.

The Extension's single purpose is to obtain GitHub repository or code content requested by the user, organize that content into structured context, and deliver it to the user's selected AI chat interface.

## 1. Data the Extension Handles

The Extension may handle the following categories of information because they are required for its user-facing functionality:

### Authentication information

The Extension can optionally store a GitHub Personal Access Token (PAT) when the user enters one in the Extension settings.

The PAT is used only to authenticate requests to GitHub so the Extension can access private repositories or authenticated GitHub resources and use the associated API rate limits.

The PAT is stored through Chrome's `chrome.storage.sync`. The Extension does not operate a server that receives, stores, or processes the PAT.

Users should use a least-privileged GitHub token and remove the token from the Extension when it is no longer needed.

### Website content and user-provided content

When the user pastes text into a supported AI website, the Extension examines the plain-text paste event to determine whether it contains a GitHub repository, directory, branch, or file URL.

When a valid GitHub target is detected, the Extension retrieves the requested repository content and processes it in the browser.

The Extension does not intentionally read or collect unrelated chat history, page content, screenshots, keystrokes, or other unrelated information from the page.

### Web browsing activity

The Extension reads the hostname of the current web page so it can determine whether the Extension is enabled for that site and whether the site is allowed or blocked by the user's site policy.

The current hostname is processed for this user-facing feature on supported AI sites. The Extension does not maintain a remote browsing-history database or send browsing history to the developer.

## 2. How Information Is Used

Information handled by the Extension is used only to provide and support its single purpose:

- identify GitHub links pasted into supported AI chat interfaces;
- fetch the GitHub repository or requested repository path;
- filter unnecessary files and binary content;
- construct a structured repository tree and code digest;
- split large digests when required by configured limits;
- deliver the resulting context as a Markdown attachment or through the Extension's pseudo-file delivery mode;
- remember user-selected settings such as site policies, language, theme, delivery mode, and file-size limits.

The Extension does not use this information for advertising, profiling, credit evaluation, or unrelated purposes.

## 3. Where Information Goes

The Extension does not operate a third-party ingestion or analytics server.

### GitHub

When ingesting a repository, the browser connects directly to GitHub endpoints. The requested GitHub URL and repository data are therefore handled by GitHub as part of fulfilling the user's request.

When a GitHub PAT is configured, the browser sends that credential directly to GitHub using HTTPS authentication. The developer of this Extension does not receive the PAT.

### User-selected AI services

After the repository digest has been prepared, the Extension delivers it to the AI website in the user's active browser session.

The selected AI service may therefore receive and process the repository content or generated digest according to that service's own privacy policy and terms.

The developer of this Extension does not receive the repository content or the user's AI conversation through a developer-operated relay server.

### Chrome Sync

Extension settings are stored using Chrome's `chrome.storage.sync`. Depending on the user's Chrome account and sync configuration, these settings may be synchronized by Chrome across the user's signed-in browser instances.

The Extension developer does not operate or control Chrome Sync infrastructure.

## 4. Local Processing and Temporary Data

Repository archives, parsed file contents, generated digests, and pseudo-file payloads are processed in browser memory.

Pseudo-file payloads are intentionally kept outside the host page's DOM and are released when the pseudo-file lifecycle ends or the message is flushed.

The Extension does not maintain a developer-controlled server-side copy of repository contents, pasted content, or PATs.

User configuration stored by Chrome remains available until the user changes or clears it.

A GitHub PAT remains stored in Chrome Sync until the user removes or clears it through the Extension settings.

## 5. Data Sharing

The Extension does not sell user data.

The Extension does not share user data with advertisers or data brokers.

Data is transferred only when necessary to provide the Extension's disclosed functionality, including:

1. direct requests to GitHub to retrieve the repository content requested by the user;
2. delivery of the resulting digest to the AI service selected by the user;
3. synchronization of Extension settings through Chrome's own storage synchronization service.

The Extension developer does not receive the above data through its own servers.

## 6. Security

Network requests to GitHub use HTTPS.

The Extension does not include remote JavaScript or WebAssembly code downloaded at runtime for its core processing.

Because GitHub PATs are authentication credentials, users should create tokens with the minimum permissions required for their intended repositories, avoid sharing them with other people, and clear them from the Extension when they are no longer required.

The Extension cannot control the security, privacy practices, retention, or breach response of GitHub, Chrome Sync, or third-party AI services.

## 7. User Controls

You can:

- add, remove, or clear the GitHub PAT from the Extension settings;
- enable or disable the Extension's integration for supported AI websites;
- manage the supported site's blacklist state;
- choose the digest delivery mode;
- configure per-site and default file-size limits;
- change the Extension language and theme.

Removing a PAT from the Extension stops future authenticated GitHub requests using that stored credential. Existing copies held by GitHub or other third-party services are governed by their respective policies.

## 8. Third-Party Services

The Extension currently interacts with:

- GitHub, for repository retrieval and optional PAT authentication;
- the AI website chosen by the user, for receiving the generated repository context;
- Chrome's storage synchronization infrastructure, when Chrome Sync is enabled.

Please review the privacy policies and terms of those services for information about their independent data practices.

## 9. Children's Privacy

The Extension is not specifically directed at children and does not intentionally collect children's personal information.

## 10. Changes to This Policy

This Privacy Policy may be updated when the Extension's data-handling practices change or when necessary to reflect applicable policy requirements.

Material changes will be reflected in the published policy and, where appropriate, disclosed in the Extension's user interface and store listing.

## 11. Contact

For privacy questions, concerns, or requests related to this Extension, please open an issue in the public repository:

https://github.com/CYoJkoY/AiGithubIngest/issues

## 12. Chrome Web Store User Data Policy

AI GitHub Ingest Engine is designed to comply with the Chrome Web Store User Data Policy and Limited Use requirements.

User data is handled only to provide or support the Extension's single purpose. The Extension does not sell user data, use user data for advertising or creditworthiness decisions, or transfer user data for unrelated purposes.

This policy should be read together with the Extension's Chrome Web Store listing and privacy disclosures.
