import { IngestSuccessPayload } from '../types';

export const buildIngestPrompt = (payload: IngestSuccessPayload): string => {
  return [
    `以下是通过 AiGithubIngest 解析自 ${payload.repoUrl} 的项目结构与代码：`,
    '',
    '```',
    payload.content.trim(),
    '```',
    '',
    '请通读上述代码库：',
    '1. 梳理核心职责、架构分层与核心模块间依赖关系；',
    '2. 识别关键数据流与对外契约接口；',
    '3. 检查代码的可维护性与潜在风险边界。',
  ].join('\n');
};

export const buildLoadingPlaceholder = (owner: string, repo: string): string => {
  return `[已识别目标代码库 ${owner}/${repo}，正在请求 AiGithubIngest 结构化代码树...]`;
};
