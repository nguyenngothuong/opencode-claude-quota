# OpenCode Claude Quota Plugin

A plugin for [OpenCode](https://github.com/sst/opencode) that displays your **real Claude.ai subscription quota** with progress bars by fetching data from the Claude API.

## Features

- **Real quota from Claude.ai** - Fetches actual session (5-hour) and weekly usage from Claude's OAuth API
- **Visual progress bars** - Shows usage at a glance
- **Local tracking fallback** - Also tracks tokens locally per session
- **Custom tools** - `quota` to check usage, `quotaReset` to reset local counters

## Requirements

- OpenCode with **Claude OAuth authentication** (Claude Pro/Max subscription)
- The plugin reads credentials from OpenCode's `auth.json` file

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

## Usage

Once installed, ask the assistant: **"check my quota"** or **"show quota"**

### Example Output

```markdown
## Claude Code Quota (from Claude.ai)

### Session (5-hour window)
[█░░░░░░░░░░░░░░░░░░░] **3%** used | **97%** remaining
Resets in: 4h 32m

### Weekly (All Models)
[█████░░░░░░░░░░░░░░░] **27%** used | **73%** remaining
Resets in: 5d 12h

### Per-Model Weekly Usage
| Model | Used |
|-------|------|
| Sonnet | 3% |

---

## Local Session Tracking

| Metric | Value |
|--------|-------|
| Tokens Used | 125,432 |
| Input | 89,234 |
| Output | 36,198 |
| Cache | 0 |
| Requests | 12 |
| Session Time | 45 min |
| Est. Cost | $0.0523 |
```

## How It Works

1. **Reads OAuth credentials** from OpenCode's `auth.json` file
2. **Calls Claude API** at `https://api.anthropic.com/api/oauth/usage`
3. **Displays real quota** with session (5-hour) and weekly (7-day) limits
4. **Falls back to local tracking** if API is unavailable

### Auth File Locations

The plugin searches for `auth.json` in these locations:

- `$XDG_DATA_HOME/opencode/auth.json`
- `~/.local/share/opencode/auth.json`
- `%LOCALAPPDATA%/opencode/auth.json` (Windows)

## Available Tools

| Tool | Description |
|------|-------------|
| `quota` | Check Claude.ai quota + local session stats |
| `quotaReset` | Reset local tracking counters |

## API Response Format

The plugin expects this response from Claude's OAuth usage API:

```json
{
  "five_hour": {
    "utilization": 3.0,
    "resets_at": "2026-01-20T16:59:59.631252+00:00"
  },
  "seven_day": {
    "utilization": 27.0,
    "resets_at": "2026-01-25T12:59:59.631274+00:00"
  },
  "seven_day_sonnet": {
    "utilization": 3.0,
    "resets_at": "2026-01-25T12:59:59.631282+00:00"
  }
}
```

Note: `utilization` is a percentage (0-100), not a decimal.

## Troubleshooting

**"Could not fetch quota from Claude.ai"**
- Make sure you're logged in with Claude Pro/Max via OAuth in OpenCode
- Check that `auth.json` exists and contains `anthropic.type: "oauth"`
- Access token might be expired - restart OpenCode to refresh

**Plugin not loading**
- Check OpenCode logs for `[claude-quota]` messages
- Ensure the file is in `.opencode/plugin/` or `~/.config/opencode/plugin/`

## Contributing

```bash
git clone https://github.com/nguyenngothuong/opencode-claude-quota.git
cd opencode-claude-quota

# Make changes to src/index.ts
# Test by copying to .opencode/plugin/
```

## License

MIT
