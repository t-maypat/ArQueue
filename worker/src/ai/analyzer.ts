import { Redis } from 'ioredis';
import { getAIClient, isAIEnabled, type AnalysisResult } from './index.js';
import { buildPrompt } from './prompts.js';
import { logger } from '../logger.js';

interface Task {
  id?: string;
  type: string;
  payload: Record<string, unknown>;
  retries?: number;
  maxRetries?: number;
  lastError?: string | null;
}

export async function analyzeFailure(
  redis: Redis,
  task: Task
): Promise<AnalysisResult | null> {
  if (!isAIEnabled()) {
    logger.debug({ taskId: task.id }, 'ai_analysis_skipped_not_enabled');
    return null;
  }

  const client = getAIClient();
  if (!client) {
    logger.warn({ taskId: task.id }, 'ai_client_unavailable');
    return null;
  }

  try {
    // Get error history from task hash
    const taskKey = `task:${task.id}`;
    const errorHistory: string[] = [];

    // Build prompt
    const prompt = buildPrompt(task, errorHistory);

    // Call AI
    const startTime = Date.now();
    const response = await client.chat(prompt);
    const aiLatencyMs = Date.now() - startTime;

    // Parse JSON response
    let analysis: AnalysisResult;
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      analysis = JSON.parse(jsonStr);
    } catch (parseErr) {
      logger.error({ taskId: task.id, response, parseErr }, 'ai_response_parse_error');
      // Return a fallback analysis
      analysis = {
        rootCause: 'Unable to parse AI response',
        confidence: 0.1,
        suggestedFix: 'Review task manually',
        shouldRetry: false,
        retryDelay: null,
        category: 'permanent'
      };
    }

    // Store analysis in Redis
    await redis.hset(`ai:analysis:${task.id}`, {
      rootCause: analysis.rootCause,
      confidence: String(analysis.confidence),
      suggestedFix: analysis.suggestedFix,
      shouldRetry: analysis.shouldRetry ? '1' : '0',
      retryDelay: analysis.retryDelay ? String(analysis.retryDelay) : '',
      category: analysis.category,
      provider: client.provider,
      analyzedAt: String(Date.now()),
      aiLatencyMs: String(aiLatencyMs)
    });
    await redis.expire(`ai:analysis:${task.id}`, 7 * 24 * 60 * 60); // 7 days

    // Update pattern database for analytics
    await redis.lpush(`ai:patterns:${analysis.category}`, JSON.stringify({
      taskType: task.type,
      error: task.lastError,
      rootCause: analysis.rootCause,
      timestamp: Date.now()
    }));
    await redis.ltrim(`ai:patterns:${analysis.category}`, 0, 999);

    logger.info({
      taskId: task.id,
      category: analysis.category,
      confidence: analysis.confidence,
      shouldRetry: analysis.shouldRetry,
      aiLatencyMs
    }, 'ai_analysis_completed');

    return analysis;
  } catch (err) {
    logger.error({ taskId: task.id, err }, 'ai_analysis_error');
    return null;
  }
}
