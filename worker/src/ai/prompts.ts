export const FAILURE_ANALYSIS_PROMPT = `You are a distributed systems expert analyzing a failed task queue job.

TASK DETAILS:
- Type: {{taskType}}
- Task ID: {{taskId}}
- Final Error: {{lastError}}
- Retry Count: {{retries}} / {{maxRetries}}
- Payload: {{payload}}

ERROR HISTORY:
{{errorHistory}}

Analyze this failure and respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "rootCause": "Brief explanation of why this task failed (1-2 sentences)",
  "confidence": 0.85,
  "suggestedFix": "Specific actionable fix recommendation",
  "shouldRetry": true,
  "retryDelay": 5000,
  "category": "transient"
}

Categories:
- transient: Temporary issues (network timeout, rate limit, service unavailable) - often worth retrying
- permanent: Will never succeed (invalid data, missing resource, validation error)
- config: Configuration/environment issue (wrong credentials, missing env var, misconfigured service)

Guidelines:
- confidence: 0.0-1.0, based on how certain you are about the root cause
- shouldRetry: true only for transient issues, false for permanent/config
- retryDelay: milliseconds to wait before retry (null if shouldRetry is false)
- Be concise but specific in rootCause and suggestedFix`;

export function buildPrompt(task: {
  id?: string;
  type: string;
  payload: Record<string, unknown>;
  retries?: number;
  maxRetries?: number;
  lastError?: string | null;
}, errorHistory: string[] = []): string {
  return FAILURE_ANALYSIS_PROMPT
    .replace('{{taskType}}', task.type)
    .replace('{{taskId}}', task.id || 'unknown')
    .replace('{{lastError}}', task.lastError || 'Unknown error')
    .replace('{{retries}}', String(task.retries || 0))
    .replace('{{maxRetries}}', String(task.maxRetries || 3))
    .replace('{{payload}}', JSON.stringify(task.payload, null, 2))
    .replace('{{errorHistory}}', errorHistory.length > 0
      ? errorHistory.map((e, i) => `${i + 1}. ${e}`).join('\n')
      : 'No previous errors recorded');
}
