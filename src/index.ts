/**
 * Claude Quota Plugin
 *
 * Displays Claude Code subscription quota (Session & Weekly usage).
 * Reads OAuth credentials from OpenCode auth.json and fetches real quota from Claude.ai API.
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
  five_hour?: QuotaUsage // Session quota (5-hour window)
  seven_day?: QuotaUsage // Weekly quota (all models combined)
  seven_day_sonnet?: QuotaUsage
  seven_day_opus?: QuotaUsage
  seven_day_oauth_apps?: QuotaUsage | null
  iguana_necktie?: unknown | null
  extra_usage?: {
    is_enabled: boolean
    monthly_limit?: number | null
    used_credits?: number | null
    utilization?: number | null
  }
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
// Auth File Path (XDG Base Directory)
// ============================================================================

function getAuthFilePath(): string {
  // Try multiple possible locations
  const possiblePaths = [
    // XDG_DATA_HOME if set
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json") : null,
    // Linux/macOS/Windows with .local
    path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
    // Windows AppData/Local
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "opencode", "auth.json") : null,
    // Windows fallback
    path.join(os.homedir(), "AppData", "Local", "opencode", "auth.json"),
  ].filter(Boolean) as string[]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }

  // Return default path for error message
  return possiblePaths[0] || path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
}

async function getAnthropicAuth(): Promise<OAuthAuth | null> {
  try {
    const authPath = getAuthFilePath()
    console.log(`[claude-quota] Reading auth from: ${authPath}`)

    if (!fs.existsSync(authPath)) {
      console.log("[claude-quota] Auth file not found")
      return null
    }

    const content = fs.readFileSync(authPath, "utf-8")
    const authData = JSON.parse(content)

    const anthropicAuth = authData["anthropic"]
    if (!anthropicAuth || anthropicAuth.type !== "oauth") {
      console.log("[claude-quota] No OAuth auth for anthropic")
      return null
    }

    return anthropicAuth as OAuthAuth
  } catch (error) {
    console.log(`[claude-quota] Error reading auth: ${error}`)
    return null
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatProgressBar(percentage: number, width: number = 20): string {
  const clampedPercent = Math.min(100, Math.max(0, percentage))
  const filled = Math.round((clampedPercent / 100) * width)
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
    console.log("[claude-quota] Refreshing access token...")
    const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: CLIENT_ID,
      }),
    })

    if (!response.ok) {
      console.log(`[claude-quota] Token refresh failed: ${response.status}`)
      return null
    }

    const json = await response.json()
    console.log("[claude-quota] Token refreshed successfully")
    return json.access_token
  } catch (error) {
    console.log(`[claude-quota] Token refresh error: ${error}`)
    return null
  }
}

async function fetchClaudeUsage(accessToken: string): Promise<ClaudeUsageResponse | null> {
  try {
    // Try OAuth usage endpoint first
    console.log("[claude-quota] Fetching usage from OAuth endpoint...")
    const oauthResponse = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
    })

    if (oauthResponse.ok) {
      const data = await oauthResponse.json()
      console.log("[claude-quota] Got usage data from OAuth endpoint")
      return data
    }
    console.log(`[claude-quota] OAuth usage API: ${oauthResponse.status}`)

    // Fallback: Try claude.ai organizations endpoint
    console.log("[claude-quota] Trying claude.ai organizations endpoint...")
    const orgsResponse = await fetch("https://claude.ai/api/organizations", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!orgsResponse.ok) {
      console.log(`[claude-quota] Orgs API: ${orgsResponse.status}`)
      return null
    }

    const orgs = await orgsResponse.json()
    if (!Array.isArray(orgs) || orgs.length === 0) {
      console.log("[claude-quota] No organizations found")
      return null
    }

    const orgId = orgs[0].uuid
    console.log(`[claude-quota] Using org: ${orgId}`)

    const usageResponse = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!usageResponse.ok) {
      console.log(`[claude-quota] Usage API: ${usageResponse.status}`)
      return null
    }

    return await usageResponse.json()
  } catch (error) {
    console.log(`[claude-quota] Error fetching usage: ${error}`)
    return null
  }
}

// ============================================================================
// Local State (fallback tracking)
// ============================================================================

const localState: LocalState = {
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  cost: 0,
  requests: 0,
  sessionStart: Date.now(),
}

function getTotalTokens(): number {
  return localState.inputTokens + localState.outputTokens + localState.cacheTokens
}

// ============================================================================
// Plugin Export
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

      const total = getTotalTokens()
      console.log(
        `[claude-quota] #${localState.requests}: +${(tokens.input || 0) + (tokens.output || 0)} (total: ${total.toLocaleString()})`
      )
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
      console.log("[claude-quota] State reset")
    },

    /**
     * Custom tools
     */
    tool: {
      quota: {
        description:
          "Check your Claude Code subscription quota. Shows session (5-hour) and weekly usage with progress bars from Claude.ai. Also displays local session token tracking.",
        parameters: {},
        execute: async () => {
          let claudeUsage: ClaudeUsageResponse | null = null
          let quotaSection = ""

          // Try to get auth and fetch real quota
          const auth = await getAnthropicAuth()
          if (auth) {
            // Check if token is expired
            let accessToken = auth.access
            if (auth.expires < Date.now()) {
              const newToken = await refreshAccessToken(auth)
              if (newToken) {
                accessToken = newToken
              }
            }

            if (accessToken) {
              claudeUsage = await fetchClaudeUsage(accessToken)
            }
          }

          if (claudeUsage) {
            // Session (5-hour) quota
            // Note: API returns utilization as percentage (0-100), not decimal (0-1)
            const sessionUsed = Math.round(claudeUsage.five_hour?.utilization || 0)
            const sessionRemaining = 100 - sessionUsed
            const sessionResetIn = formatTimeRemaining(claudeUsage.five_hour?.resets_at)
            const sessionBar = formatProgressBar(sessionUsed)

            // Weekly quota
            const weeklyUsed = Math.round(claudeUsage.seven_day?.utilization || 0)
            const weeklyRemaining = 100 - weeklyUsed
            const weeklyResetIn = formatTimeRemaining(claudeUsage.seven_day?.resets_at)
            const weeklyBar = formatProgressBar(weeklyUsed)

            quotaSection = `
## Claude Code Quota (from Claude.ai)

### Session (5-hour window)
${sessionBar} **${sessionUsed}%** used | **${sessionRemaining}%** remaining
Resets in: ${sessionResetIn}

### Weekly (All Models)
${weeklyBar} **${weeklyUsed}%** used | **${weeklyRemaining}%** remaining
Resets in: ${weeklyResetIn}
`

            // Add per-model breakdown if available
            if (claudeUsage.seven_day_sonnet || claudeUsage.seven_day_opus) {
              quotaSection += `
### Per-Model Weekly Usage
| Model | Used |
|-------|------|`
              if (claudeUsage.seven_day_sonnet?.utilization !== undefined) {
                quotaSection += `
| Sonnet | ${Math.round(claudeUsage.seven_day_sonnet.utilization)}% |`
              }
              if (claudeUsage.seven_day_opus?.utilization !== undefined) {
                quotaSection += `
| Opus | ${Math.round(claudeUsage.seven_day_opus.utilization)}% |`
              }
            }
          } else {
            quotaSection = `
## Claude Code Quota

Could not fetch quota from Claude.ai

Possible reasons:
- Not logged in with Claude Pro/Max (OAuth)
- Access token expired and refresh failed
- API endpoint changed

To see your actual quota:
1. Visit https://claude.ai/settings
2. Check "Usage summary" section
`
          }

          // Local session tracking
          const total = getTotalTokens()
          const sessionMinutes = Math.floor((Date.now() - localState.sessionStart) / 60000)

          const localSection = `
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

          return (quotaSection + localSection).trim()
        },
      },

      quotaReset: {
        description: "Reset the local quota tracking counters",
        parameters: {},
        execute: async () => {
          const oldTotal = getTotalTokens()
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
