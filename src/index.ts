import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

// ============================================================================
// Types & Interfaces
// ============================================================================

interface QuotaState {
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalReasoningTokens: number
  totalCost: number
  requests: number
  sessionStart: number
  lastUpdated: number
}

interface QuotaConfig {
  dailyTokenLimit: number
  showToastOnIdle: boolean
  toastDuration: number
  progressBarWidth: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: QuotaConfig = {
  dailyTokenLimit: 1_000_000, // 1M tokens default
  showToastOnIdle: true,
  toastDuration: 5000,
  progressBarWidth: 20,
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats a progress bar with filled and empty segments
 * @example formatProgressBar(60, 10) => "[██████░░░░]"
 */
function formatProgressBar(percentage: number, width: number): string {
  const clampedPercent = Math.min(100, Math.max(0, percentage))
  const filled = Math.round((clampedPercent / 100) * width)
  const empty = width - filled

  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`
}

/**
 * Formats token count with K/M suffix for readability
 * @example formatTokens(1500000) => "1.5M"
 */
function formatTokens(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`
  }
  if (num >= 1_000) {
    return `${Math.round(num / 1_000)}K`
  }
  return num.toString()
}

/**
 * Formats cost as a dollar amount
 * @example formatCost(0.0523) => "$0.0523"
 */
function formatCost(num: number): string {
  if (num < 0.01) {
    return `$${num.toFixed(4)}`
  }
  if (num < 1) {
    return `$${num.toFixed(3)}`
  }
  return `$${num.toFixed(2)}`
}

/**
 * Calculates usage percentage
 */
function calculateUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, (used / limit) * 100)
}

/**
 * Formats duration in human readable format
 * @example formatDuration(3700000) => "1h 1m"
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "<1 min"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Formats a number with thousand separators
 * @example formatNumber(125432) => "125,432"
 */
function formatNumber(num: number): string {
  return num.toLocaleString("en-US")
}

// ============================================================================
// State Management
// ============================================================================

function createInitialState(): QuotaState {
  const now = Date.now()
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalReasoningTokens: 0,
    totalCost: 0,
    requests: 0,
    sessionStart: now,
    lastUpdated: now,
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

export const ClaudeQuotaPlugin: Plugin = async ({ client }) => {
  const config: QuotaConfig = { ...DEFAULT_CONFIG }
  let state: QuotaState = createInitialState()

  // Log plugin initialization
  await client.app.log({
    service: "claude-quota",
    level: "info",
    message: "Claude Quota Plugin initialized",
    extra: { dailyLimit: config.dailyTokenLimit },
  })

  return {
    // ========================================================================
    // Event Hooks
    // ========================================================================

    /**
     * Track tokens from assistant messages
     */
    "message.updated": async ({ message }) => {
      if (message.role !== "assistant") return
      if (!message.tokens) return

      const tokens = message.tokens
      const cost = message.cost || 0

      // Accumulate tokens
      state.totalInputTokens += tokens.input || 0
      state.totalOutputTokens += tokens.output || 0
      state.totalReasoningTokens += tokens.reasoning || 0
      state.totalCacheReadTokens += tokens.cache?.read || 0
      state.totalCacheWriteTokens += tokens.cache?.write || 0
      state.totalCost += cost
      state.requests += 1
      state.lastUpdated = Date.now()
    },

    /**
     * Show toast with quota summary when session becomes idle
     */
    "session.idle": async () => {
      if (!config.showToastOnIdle) return
      if (state.requests === 0) return // No activity yet

      const totalTokens =
        state.totalInputTokens +
        state.totalOutputTokens +
        state.totalCacheReadTokens +
        state.totalCacheWriteTokens +
        state.totalReasoningTokens

      const percentage = calculateUsagePercent(totalTokens, config.dailyTokenLimit)
      const remaining = Math.max(0, 100 - percentage)
      const progressBar = formatProgressBar(percentage, config.progressBarWidth)

      // Show toast notification
      await client.tui.toast.show({
        title: "Claude Quota",
        message: `${progressBar} ${remaining.toFixed(0)}% remaining | ${formatTokens(totalTokens)} used | ${formatCost(state.totalCost)}`,
        duration: config.toastDuration,
      })
    },

    /**
     * Reset state when a new session is created
     */
    "session.created": async () => {
      state = createInitialState()
      await client.app.log({
        service: "claude-quota",
        level: "debug",
        message: "Quota state reset for new session",
      })
    },

    // ========================================================================
    // Custom Tools
    // ========================================================================

    tool: {
      /**
       * Check current quota usage and remaining capacity
       */
      quota: tool({
        description: "Check current Claude Code quota usage and remaining capacity. Shows token breakdown, cost, and visual progress bar.",
        args: {},
        async execute() {
          const now = Date.now()
          const sessionDuration = now - state.sessionStart

          const totalTokens =
            state.totalInputTokens +
            state.totalOutputTokens +
            state.totalCacheReadTokens +
            state.totalCacheWriteTokens +
            state.totalReasoningTokens

          const percentage = calculateUsagePercent(totalTokens, config.dailyTokenLimit)
          const remaining = Math.max(0, config.dailyTokenLimit - totalTokens)
          const remainingPercent = Math.max(0, 100 - percentage)

          const progressBar = formatProgressBar(percentage, 30)

          return `
## Claude Code Quota Usage

### Session Stats
| Metric | Value |
|--------|-------|
| Duration | ${formatDuration(sessionDuration)} |
| Requests | ${state.requests} |
| Total Cost | ${formatCost(state.totalCost)} |

### Token Breakdown
| Type | Count |
|------|-------|
| Input Tokens | ${formatNumber(state.totalInputTokens)} |
| Output Tokens | ${formatNumber(state.totalOutputTokens)} |
| Reasoning Tokens | ${formatNumber(state.totalReasoningTokens)} |
| Cache Read | ${formatNumber(state.totalCacheReadTokens)} |
| Cache Write | ${formatNumber(state.totalCacheWriteTokens)} |
| **Total** | **${formatNumber(totalTokens)}** |

### Usage Progress
\`\`\`
${progressBar} ${percentage.toFixed(1)}% used
\`\`\`

- **Used**: ${formatTokens(totalTokens)} tokens
- **Limit**: ${formatTokens(config.dailyTokenLimit)} tokens
- **Remaining**: ~${formatTokens(remaining)} tokens (${remainingPercent.toFixed(0)}%)

---
*Note: This tracks local session usage only. Actual API quota may differ.*
*Configure limit in opencode.json: plugins.claude-quota.dailyTokenLimit*
          `.trim()
        },
      }),

      /**
       * Reset quota tracking
       */
      quotaReset: tool({
        description: "Reset the quota tracking counters to zero",
        args: {},
        async execute() {
          const oldTokens =
            state.totalInputTokens +
            state.totalOutputTokens +
            state.totalCacheReadTokens +
            state.totalCacheWriteTokens +
            state.totalReasoningTokens

          state = createInitialState()

          return `Quota counters reset. Previous usage: ${formatTokens(oldTokens)} tokens, ${formatCost(state.totalCost)}`
        },
      }),
    },
  }
}

// Default export for OpenCode
export default ClaudeQuotaPlugin
