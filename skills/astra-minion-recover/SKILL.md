---
name: astra-minion-recover
description: "Recover a down ASTRA minion after pull: install deps/tsx, reset-failed, restart user unit astra-agent, verify active."
author: AARIA
---

# ASTRA minion recover

On-box (SSH or host console) as the agent user:

```bash
cd ~/MXPF-ASTRA   # or the minion’s agent checkout
npm install --omit=dev
test -x node_modules/.bin/tsx || npm install tsx
systemctl --user reset-failed astra-agent
systemctl --user restart astra-agent
systemctl --user is-active astra-agent
```

Then from desk: confirm fleet presence/heartbeat and live `fs.list` (disk tip ≠ running process).

**Notes:** Unit is user systemd `astra-agent`. ironss needs Contabo console as `maximprof` (desk SSH denied). Skip demo minion on rolls.
