import { RepoTarget, ParseError } from "../types";
import { Result, ok, err } from "./result";

const GITHUB_REPO_PATTERN =
  /https?:\/\/github\.com\/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)/;

export const extractGitHubRepo = (
  rawText: string | null | undefined,
): Result<RepoTarget, ParseError> => {
  if (!rawText || typeof rawText !== "string" || rawText.trim() === "") {
    return err({ code: "EMPTY_INPUT", message: "输入内容为空" });
  }

  const match = rawText.match(GITHUB_REPO_PATTERN);
  if (!match) {
    return err({
      code: "NOT_GITHUB_URL",
      message: "未匹配到有效的 GitHub 仓库链接",
    });
  }

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, "");

  return ok({
    owner,
    repo: cleanRepo,
    canonicalUrl: `https://github.com/${owner}/${cleanRepo}`,
  });
};
