#!/bin/bash
set -e

# ─── ScrapeOps AI Scraper Builder — Setup Script ─────────────────────────────
# Installs skills, agents, and MCP server for Claude Code.
# Run: git clone <repo> && cd <repo> && ./setup.sh

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

SKILLS=(generate-scraper fix-scraper scrapeops-setup generate-crawler-scraper)
AGENTS=(parser-fixer)

# ─── Uninstall ────────────────────────────────────────────────────────────────

if [ "$1" = "--uninstall" ]; then
  echo ""
  echo "  ScrapeOps AI Scraper Builder — Uninstall"
  echo "  ========================================="
  echo ""

  for skill in "${SKILLS[@]}"; do
    if [ -d "$CLAUDE_DIR/skills/$skill" ]; then
      rm -rf "$CLAUDE_DIR/skills/$skill"
      echo "  Removed skill: /$skill"
    fi
  done

  for agent in "${AGENTS[@]}"; do
    if [ -f "$CLAUDE_DIR/agents/$agent.md" ]; then
      rm "$CLAUDE_DIR/agents/$agent.md"
      echo "  Removed agent: $agent"
    fi
  done

  claude mcp remove --scope user scrapeops 2>/dev/null && echo "  Removed MCP server: scrapeops" || true

  # Kill any running MCP server processes for this plugin
  if pkill -f "$REPO_DIR/mcp-server/index.js" 2>/dev/null; then
    echo "  Stopped running MCP server processes"
  fi

  # Remove plugin cache if it exists
  if [ -d "$CLAUDE_DIR/plugins/cache/scrapeops" ]; then
    rm -rf "$CLAUDE_DIR/plugins/cache/scrapeops"
    echo "  Removed plugin cache"
  fi

  echo ""
  echo "  Uninstall complete. Restart Claude Code to apply."
  echo "  Note: Your API key in ~/.claude/settings.json was not removed."
  echo ""
  exit 0
fi

# ─── Install ──────────────────────────────────────────────────────────────────

echo ""
echo "  ScrapeOps AI Scraper Builder — Claude Code Setup"
echo "  ================================================="
echo ""

# ─── 1. Copy skills ──────────────────────────────────────────────────────────

echo "  [1/3] Installing skills..."

mkdir -p "$CLAUDE_DIR/skills"

for skill_dir in "$REPO_DIR/skills"/*/; do
  skill_name="$(basename "$skill_dir")"
  target="$CLAUDE_DIR/skills/$skill_name"

  if [ -d "$target" ]; then
    rm -rf "$target"
  fi

  cp -r "$skill_dir" "$target"
  echo "        /$skill_name"
done

# ─── 2. Copy agents ──────────────────────────────────────────────────────────

echo "  [2/3] Installing agents..."

mkdir -p "$CLAUDE_DIR/agents"

for agent_file in "$REPO_DIR/agents"/*.md; do
  agent_name="$(basename "$agent_file" .md)"
  target="$CLAUDE_DIR/agents/$agent_name.md"

  cp "$agent_file" "$target"
  echo "        $agent_name"
done

# ─── 3. Register MCP server ──────────────────────────────────────────────────

echo "  [3/3] Registering MCP server..."

# Remove existing registration if present (to update the path)
claude mcp remove --scope user scrapeops 2>/dev/null || true

claude mcp add --transport stdio --scope user scrapeops -- node "$REPO_DIR/mcp-server/index.js"

echo "        scrapeops (11 tools)"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Restart Claude Code"
echo "    2. Try /generate-scraper, /fix-scraper, or /generate-crawler-scraper"
echo "       (Claude will ask for your API key on first use)"
echo ""
