#!/usr/bin/env bash
# compare-before-after.sh <pre-output.txt> <post-output.txt>
# Compares, line by line, the tables that script 1 predicts and script 2 reports. Reads two text files; touches no database.
set -uo pipefail
PRE="${1:?output of pre-release-checks.sql}"; POST="${2:?output of post-release-checks.sql}"
part() { sed -n "/$2/,/$3/p" "$1" | tail -n +2; }   # the table between two marker lines, without the first marker
rc=0
check() { # label, begin marker, end marker, what a difference means
  local d
  if d="$(diff <(part "$PRE" "$2" "$3") <(part "$POST" "$2" "$3") 2>&1)"; then echo "SAME       $1"
  else echo "DIFFERENT  $1   ($4)"; printf '%s\n' "$d" | sed 's/^/    /' | cut -c1-400; rc=1; fi
}
check "pay-right table (1a = B1)"  'pay-right table: one line' 'end of pay-right table' 'a role changed that was not predicted, or the other way round'
check "back-fill table (1d = B4)"  'back-fill table: every key' 'end of back-fill table' 'the release task added other keys than predicted'
check "claims in flight (9 = F)"   'claims-in-flight table' 'end of claims-in-flight' 'expected: approver_can_pay_today turns to yes for back-filled approvers; anything else is a claim that moved'
exit "$rc"
