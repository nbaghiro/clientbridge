#!/usr/bin/env bash
# Warns, without failing, when a walkthrough in Maestro's output took over 3 times its usual time.
set -euo pipefail

baseline="$(dirname "$0")/../../../../backend/e2e/seconds.json"
[ -f "$1" ] || exit 0
{ grep -oE '\[Passed\] .+ \(([0-9]+m|[0-9]+s|[0-9]+m [0-9]+s)\)' "$1" || true; } | while IFS= read -r line; do
    name=$(sed -E 's/^\[Passed\] (.+) \([0-9ms ]+\)$/\1/' <<< "$line")
    minutes=$(sed -nE 's/.*\(([0-9]+)m( [0-9]+s)?\)$/\1/p' <<< "$line")
    seconds=$(sed -nE 's/.*[( ]([0-9]+)s\)$/\1/p' <<< "$line")
    took=$(( ${minutes:-0} * 60 + ${seconds:-0} ))
    usual=$(jq -r --arg name "$name" '.mobile[$name] // empty' "$baseline")
    if [ -z "$usual" ]; then
        echo "::warning::$name has no usual time in backend/e2e/seconds.json"
    elif [ "$took" -gt $(( usual * 3 )) ]; then
        echo "::warning::$name took ${took}s, more than 3 times its usual ${usual}s"
    fi
done
