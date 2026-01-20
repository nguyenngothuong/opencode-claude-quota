#!/usr/bin/env node
/**
 * Claude Quota CLI - Check your Claude.ai subscription quota
 * 
 * Usage: npx opencode-claude-quota
 *        or after global install: claude-quota
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

// ============================================================================
// Auth File Path
// ============================================================================

function getAuthFilePath() {
  const possiblePaths = [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json") : null,
    path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "opencode", "auth.json") : null,
    path.join(os.homedir(), "AppData", "Local", "opencode", "auth.json"),
  ].filter(Boolean)

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }
  return possiblePaths[0]
}

// ============================================================================
// Display Helpers
// ============================================================================

function progressBar(percent, width = 20) {
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * width)
  const empty = width - filled
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`
}

function formatTime(resetTime) {
  if (!resetTime) return 'unknown'
  const reset = new Date(resetTime)
  const now = new Date()
  const diffMs = reset.getTime() - now.getTime()
  
  if (diffMs <= 0) return 'resetting...'
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return `${days}d ${remainingHours}h`
  }
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function colorize(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`
}

const colors = {
  green: (t) => colorize(t, 32),
  yellow: (t) => colorize(t, 33),
  red: (t) => colorize(t, 31),
  cyan: (t) => colorize(t, 36),
  bold: (t) => colorize(t, 1),
  dim: (t) => colorize(t, 2),
}

function getStatusColor(percent) {
  if (percent < 50) return colors.green
  if (percent < 80) return colors.yellow
  return colors.red
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(colors.bold('\n╔════════════════════════════════════════╗'))
  console.log(colors.bold('║      CLAUDE CODE QUOTA STATUS          ║'))
  console.log(colors.bold('╚════════════════════════════════════════╝\n'))

  // Read auth
  const authPath = getAuthFilePath()
  if (!fs.existsSync(authPath)) {
    console.log(colors.red('❌ Auth file not found: ' + authPath))
    console.log(colors.dim('   Run OpenCode and login with Claude OAuth first.'))
    process.exit(1)
  }

  const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
  const auth = authData['anthropic']
  
  if (!auth || auth.type !== 'oauth') {
    console.log(colors.red('❌ No OAuth credentials found for Anthropic'))
    console.log(colors.dim('   Login with Claude Pro/Max in OpenCode.'))
    process.exit(1)
  }

  // Fetch quota
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${auth.access}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
    },
  })

  if (!response.ok) {
    console.log(colors.red(`❌ API Error: ${response.status}`))
    if (response.status === 401) {
      console.log(colors.dim('   Token expired. Restart OpenCode to refresh.'))
    }
    process.exit(1)
  }

  const data = await response.json()

  // Session quota
  const sessionUsed = Math.round(data.five_hour?.utilization || 0)
  const sessionRemaining = 100 - sessionUsed
  const sessionReset = formatTime(data.five_hour?.resets_at)
  const sessionColor = getStatusColor(sessionUsed)

  console.log(colors.cyan('📊 SESSION (5-hour window)'))
  console.log(`   ${progressBar(sessionUsed)} ${sessionColor(`${sessionUsed}%`)} used`)
  console.log(`   ${colors.dim('Remaining:')} ${sessionRemaining}%  ${colors.dim('Resets in:')} ${sessionReset}`)
  console.log()

  // Weekly quota
  const weeklyUsed = Math.round(data.seven_day?.utilization || 0)
  const weeklyRemaining = 100 - weeklyUsed
  const weeklyReset = formatTime(data.seven_day?.resets_at)
  const weeklyColor = getStatusColor(weeklyUsed)

  console.log(colors.cyan('📈 WEEKLY (7-day rolling)'))
  console.log(`   ${progressBar(weeklyUsed)} ${weeklyColor(`${weeklyUsed}%`)} used`)
  console.log(`   ${colors.dim('Remaining:')} ${weeklyRemaining}%  ${colors.dim('Resets in:')} ${weeklyReset}`)
  console.log()

  // Per-model breakdown
  if (data.seven_day_sonnet || data.seven_day_opus) {
    console.log(colors.cyan('🔤 PER-MODEL WEEKLY'))
    if (data.seven_day_sonnet?.utilization !== undefined) {
      const sonnetUsed = Math.round(data.seven_day_sonnet.utilization)
      console.log(`   Sonnet: ${progressBar(sonnetUsed, 15)} ${sonnetUsed}%`)
    }
    if (data.seven_day_opus?.utilization !== undefined) {
      const opusUsed = Math.round(data.seven_day_opus.utilization)
      console.log(`   Opus:   ${progressBar(opusUsed, 15)} ${opusUsed}%`)
    }
    console.log()
  }

  // Extra usage info
  if (data.extra_usage?.is_enabled) {
    console.log(colors.cyan('💰 EXTRA USAGE'))
    console.log(`   ${colors.dim('Monthly limit:')} $${data.extra_usage.monthly_limit || 'N/A'}`)
    console.log(`   ${colors.dim('Used credits:')} $${data.extra_usage.used_credits || 0}`)
    console.log()
  }

  console.log(colors.dim('─'.repeat(42)))
  console.log(colors.dim(`   Fetched at: ${new Date().toLocaleTimeString()}`))
  console.log()
}

main().catch(err => {
  console.error(colors.red('Error:'), err.message)
  process.exit(1)
})
