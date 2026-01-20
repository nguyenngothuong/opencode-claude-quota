/**
 * Claude Quota Plugin
 *
 * Displays Claude Code subscription quota (Session & Weekly usage).
 * Provides `quota` tool for checking real quota from Claude.ai API.
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// ============================================================================
// Types
// ============================================================================

interface OAuthAuth {
  type: "oauth"
  refresh: string
  access: string
  expires: number
}

interface QuotaUsage {
  utilization?: number // Percentage (0-100)
  resets_at?: string // ISO 8601 timestamp
}

interface ClaudeUsageResponse {
  five_hour?: QuotaUsage
  seven_day?: QuotaUsage
  seven_day_sonnet?: QuotaUsage
  seven_day_opus?: QuotaUsage
}

interface LocalState {
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  cost: number
  requests: number
  sessionStart: number
}

// ============================================================================
// Global State
// ============================================================================

const localState: LocalState = {
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  cost: 0,
  requests: 0,
  sessionStart: Date.now(),
}

// ============================================================================
// Auth File Path
// ============================================================================

function getAuthFilePath(): string {
  const possiblePaths = [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json") : null,
    path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "opencode", "auth.json") : null,
    path.join(os.homedir(), "AppData", "Local", "opencode", "auth.json"),
  ].filter(Boolean) as string[]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p
  }
  return possiblePaths[0] || path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
}

async function getAnthropicAuth(): Promise<OAuthAuth | null> {
  try {
    const authPath = getAuthFilePath()
    if (!fs.existsSync(authPath)) return null

    const content = fs.readFileSync(authPath, "utf-8")
    const authData = JSON.parse(content)
    const anthropicAuth = authData["anthropic"]

    if (!anthropicAuth || anthropicAuth.type !== "oauth") return null
    return anthropicAuth as OAuthAuth
  } catch {
    return null
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatProgressBar(percentage: number, width: number = 20): string {
  const clamped = Math.min(100, Math.max(0, percentage))
  const filled = Math.round((clamped / 100) * width)
  const empty = width - filled
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`
}

function formatTimeRemaining(resetTime: string | undefined): string {
  if (!resetTime) return "unknown"
  try {
    const reset = new Date(resetTime)
    const now = new Date()
    const diffMs = reset.getTime() - now.getTime()

    if (diffMs <= 0) return "resetting..."

    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    if (hours >= 24) {
      const days = Math.floor(hours / 24)
      return `${days}d ${hours % 24}h`
    }
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  } catch {
    return "unknown"
  }
}

// ============================================================================
// Claude.ai API
// ============================================================================

async function refreshAccessToken(auth: OAuthAuth): Promise<string | null> {
  const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
  try {
    const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: CLIENT_ID,
      }),
    })
    if (!response.ok) return null
    const json = await response.json()
    return json.access_token
  } catch {
    return null
  }
}

async function fetchClaudeUsage(accessToken: string): Promise<ClaudeUsageResponse | null> {
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function getQuotaData(): Promise<ClaudeUsageResponse | null> {
  const auth = await getAnthropicAuth()
  if (!auth) return null

  let accessToken = auth.access
  if (auth.expires < Date.now()) {
    const newToken = await refreshAccessToken(auth)
    if (newToken) accessToken = newToken
  }

  return accessToken ? await fetchClaudeUsage(accessToken) : null
}

// ============================================================================
// Plugin Export (Simple format - no client dependency)
// ============================================================================

export const ClaudeQuotaPlugin = async () => {
  console.log("[claude-quota] Plugin initialized")

  return {
    /**
     * Track tokens from assistant messages
     */
    "message.updated": async (input: { message: any }) => {
      const message = input.message
      if (message.role !== "assistant") return
      if (!message.tokens) return

      const tokens = message.tokens
      localState.inputTokens += tokens.input || 0
      localState.outputTokens += tokens.output || 0
      localState.cacheTokens += (tokens.cache?.read || 0) + (tokens.cache?.write || 0)
      localState.cost += message.cost || 0
      localState.requests += 1

      console.log(`[claude-quota] Request #${localState.requests}: +${(tokens.input || 0) + (tokens.output || 0)} tokens`)
    },

    /**
     * Reset on new session
     */
    "session.created": async () => {
      localState.inputTokens = 0
      localState.outputTokens = 0
      localState.cacheTokens = 0
      localState.cost = 0
      localState.requests = 0
      localState.sessionStart = Date.now()
      console.log("[claude-quota] State reset for new session")
    },

    /**
     * Custom Tools
     */
    tool: {
      quota: {
        description: "Check your Claude Code subscription quota. Shows session (5-hour) and weekly usage with progress bars from Claude.ai API.",
        parameters: {},
        execute: async () => {
          const quota = await getQuotaData()

          if (quota) {
            const sessionUsed = Math.round(quota.five_hour?.utilization || 0)
            const weeklyUsed = Math.round(quota.seven_day?.utilization || 0)
            const sessionBar = formatProgressBar(sessionUsed)
            const weeklyBar = formatProgressBar(weeklyUsed)
            const sessionReset = formatTimeRemaining(quota.five_hour?.resets_at)
            const weeklyReset = formatTimeRemaining(quota.seven_day?.resets_at)

            let output = `
## Claude Code Quota (from Claude.ai)

### Session (5-hour window)
${sessionBar} **${sessionUsed}%** used | **${100 - sessionUsed}%** remaining
Resets in: ${sessionReset}

### Weekly (All Models)
${weeklyBar} **${weeklyUsed}%** used | **${100 - weeklyUsed}%** remaining
Resets in: ${weeklyReset}
`

            const total = localState.inputTokens + localState.outputTokens + localState.cacheTokens
            const sessionMinutes = Math.floor((Date.now() - localState.sessionStart) / 60000)

            output += `

---

## Local Session Tracking

| Metric | Value |
|--------|-------|
| Tokens Used | ${total.toLocaleString()} |
| Input | ${localState.inputTokens.toLocaleString()} |
| Output | ${localState.outputTokens.toLocaleString()} |
| Cache | ${localState.cacheTokens.toLocaleString()} |
| Requests | ${localState.requests} |
| Session Time | ${sessionMinutes} min |
| Est. Cost | $${localState.cost.toFixed(4)} |
`

            return output.trim()
          }

          return `
## Claude Code Quota

Could not fetch quota from Claude.ai

Possible reasons:
- Not logged in with Claude Pro/Max (OAuth)
- Access token expired and refresh failed
- API endpoint changed

To see your actual quota:
1. Visit https://claude.ai/settings
2. Check "Usage summary" section

Or run in terminal: quota
`.trim()
        },
      },

      quotaReset: {
        description: "Reset the local quota tracking counters",
        parameters: {},
        execute: async () => {
          const oldTotal = localState.inputTokens + localState.outputTokens + localState.cacheTokens
          const oldCost = localState.cost

          localState.inputTokens = 0
          localState.outputTokens = 0
          localState.cacheTokens = 0
          localState.cost = 0
          localState.requests = 0
          localState.sessionStart = Date.now()

          return `Local counters reset. Previous: ${oldTotal.toLocaleString()} tokens, $${oldCost.toFixed(4)}`
        },
      },
    },
  }
}
