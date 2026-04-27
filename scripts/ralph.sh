#!/bin/bash
# Local wrapper for Ralph — runs the marketplace ralph.sh with our project's prd.json and progress.txt
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RALPH_DIR="$HOME/.claude/plugins/marketplaces/ralph-marketplace"

if [ ! -f "$RALPH_DIR/ralph.sh" ]; then
  echo "Error: ralph.sh not found at $RALPH_DIR/ralph.sh"
  echo "Install ralph first: /plugin marketplace add snarktank/ralph && /plugin install ralph-skills@ralph-marketplace"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/prd.json" ]; then
  echo "Error: prd.json not found in project root ($PROJECT_DIR)"
  exit 1
fi

# Symlink our project's prd.json and progress.txt into the ralph plugin directory
# so ralph.sh finds them at SCRIPT_DIR (its own directory)
ln -sf "$PROJECT_DIR/prd.json" "$RALPH_DIR/prd.json"
ln -sf "$PROJECT_DIR/progress.txt" "$RALPH_DIR/progress.txt"

# Run ralph.sh from the PROJECT directory so the agent operates on our codebase
cd "$PROJECT_DIR"
exec "$RALPH_DIR/ralph.sh" "$@"
