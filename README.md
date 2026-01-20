# OpenCode Claude Quota Plugin

A lightweight plugin for [OpenCode](https://github.com/sst/opencode) that tracks your Claude token usage in real-time with visual progress bars.

## Features

- **Real-time token tracking** - Monitors input/output/cache/reasoning tokens
- **Progress bar display** - Visual usage indicator shown after each response
- **Custom tools** - `quota` for details, `quotaReset` to reset counters
- **Configurable limits** - Set your own daily token budget

## Installation

### Option A: Local plugin (Recommended)

Copy the plugin file to your project:

```bash
# Clone this repo
git clone https://github.com/nguyenngothuong/opencode-claude-quota.git

# Copy to your project's plugin directory
mkdir -p .opencode/plugin
cp opencode-claude-quota/src/index.ts .opencode/plugin/claude-quota.ts
```

### Option B: Global plugin

Install globally for all OpenCode projects:

```bash
# Linux/macOS
mkdir -p ~/.config/opencode/plugin
cp src/index.ts ~/.config/opencode/plugin/claude-quota.ts

# Windows (PowerShell)
mkdir -Force "$env:USERPROFILE\.config\opencode\plugin"
copy src\index.ts "$env:USERPROFILE\.config\opencode\plugin\claude-quota.ts"
```

### Option C: npm install

```bash
npm install opencode-claude-quota
```

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-claude-quota"]
}
```

## Usage

Once installed, the plugin works automatically:

1. **Automatic tracking** - Every Claude response is tracked
2. **Toast notifications** - Progress bar appears after each completed response
3. **Custom tools** - Agent can use `quota` tool to check usage

### Example Output

**Toast notification (after each response):**
```
Claude Quota
[████████████░░░░░░░░] 38% remaining | 620K used | $0.45
```

**Detailed breakdown (quota tool):**
```markdown
## Claude Code Quota Usage

### Session Stats
| Metric | Value |
|--------|-------|
| Duration | 45 min |
| Requests | 12 |
| Total Cost | $0.4523 |

### Token Breakdown
| Type | Count |
|------|-------|
| Input Tokens | 125,432 |
| Output Tokens | 45,678 |
| Reasoning Tokens | 0 |
| Cache Read | 89,234 |
| Cache Write | 12,000 |
| **Total** | **272,344** |

### Usage Progress
[█████████░░░░░░░░░░░░░░░░░░░░░] 27.2% used

- **Used**: 272K tokens
- **Limit**: 1M tokens  
- **Remaining**: ~728K tokens (73%)
```

## Configuration

Customize in your `opencode.json`:

```json
{
  "plugins": {
    "claude-quota": {
      "dailyTokenLimit": 1000000,
      "showToastOnIdle": true,
      "toastDuration": 5000,
      "progressBarWidth": 20
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dailyTokenLimit` | number | `1000000` | Your daily token budget |
| `showToastOnIdle` | boolean | `true` | Show toast after each response |
| `toastDuration` | number | `5000` | Toast display time (ms) |
| `progressBarWidth` | number | `20` | Width of progress bar |

## Claude Code Plans Reference

Estimated daily token limits by plan:

| Plan | Estimated Daily Limit | Suggested Config |
|------|----------------------|------------------|
| Pro | ~500K - 1M tokens | `1000000` |
| Max | ~2M - 5M tokens | `3000000` |

> **Note:** Actual limits vary based on usage patterns and Anthropic's fair use policies. Check your [Anthropic Console](https://console.anthropic.com) for accurate quota information.

## Available Tools

| Tool | Description |
|------|-------------|
| `quota` | Check current usage with detailed breakdown |
| `quotaReset` | Reset all counters to zero |

## Limitations

- **Local tracking only** - Tracks usage within OpenCode session, not actual Anthropic API quota
- **Session-based** - Counters reset when OpenCode restarts
- **Self-configured limits** - You must set limits based on your plan

## How It Works

The plugin hooks into OpenCode's event system:

1. `message.updated` - Captures token counts from each assistant response
2. `session.idle` - Displays toast notification with progress bar
3. `session.created` - Resets counters for new session

## Contributing

```bash
# Clone the repo
git clone https://github.com/nguyenngothuong/opencode-claude-quota.git
cd opencode-claude-quota

# Make changes to src/index.ts
# Test by copying to .opencode/plugin/
```

## License

MIT
