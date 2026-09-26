import { RepoTarget, ParseError } from "../types";
import { Result, ok, err } from "./result";

export const extractGitHubRepo = (
  rawText: string | null | undefined,
): Result<RepoTarget, ParseError> => {
  if (!rawText || typeof rawText !== "string" || rawText.trim() === "") {
    return err({ code: "EMPTY_INPUT", message: "输入内容为空" });
  }

  const cleanText = rawText.trim();
  const urlPattern =
    /^(?:https?:\/\/github\.com\/)?([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)(?:\/(tree|blob)\/([^/]+)(?:\/(.*))?)?/;

  const match = cleanText.match(urlPattern);
  if (!match) {
    return err({
      code: "NOT_GITHUB_URL",
      message: "未匹配到有效的 GitHub 仓库链接或 slug (例如 owner/repo)",
    });
  }

  const [, owner, rawRepo, rawType, ref, subpath] = match;
  const repo = rawRepo.replace(/\.git$/, "");
  const targetType =
    rawType === "blob" ? "blob" : rawType === "tree" ? "tree" : undefined;

  let canonicalUrl = `https://github.com/${owner}/${repo}`;
  if (ref) {
    canonicalUrl += `/${targetType ?? "tree"}/${ref}${subpath ? `/${subpath}` : ""}`;
  }

  return ok({
    owner,
    repo,
    ref: ref || undefined,
    type: targetType,
    subpath: subpath ? `/${subpath.replace(/^\/+|\/+$/g, "")}` : "/",
    canonicalUrl,
  });
};
