#!/bin/sh
# Shared check: reads text on stdin, exits 1 if it contains AI-assistant attribution.
# Repo rule: Claude/AI is never listed as author, co-author or contributor.
# Real human co-authors (Co-authored-by: Name <email>) remain allowed.
PATTERN='(co-authored-by:.*(claude|anthropic|openai|chatgpt|copilot))|(noreply@anthropic\.com)|(generated with \[?claude)|(claude-session:)|(🤖 generated)'
if grep -Eiq "$PATTERN"; then
  exit 1
fi
exit 0
