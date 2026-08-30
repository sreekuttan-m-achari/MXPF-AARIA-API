# Web console MQTT (aaria.maximprof.com)

Enable the desk console bridge so the static PWA can discover this AARIA instance and chat over HiveMQ.

## Env (desk)

```bash
AARIA_CONSOLE_ENABLED=1
AARIA_CONSOLE_ID=desk-home
AARIA_CONSOLE_NAME=AARIA · home desk
AARIA_CONSOLE_LABELS=env=home
```

Requires existing fleet MQTT (`AARIA_MQTT_*`). Console reuses that connection.

## HiveMQ ACL

| Client | Needs |
|--------|--------|
| Desk (`mxpfaaria`) | PUB `mxpf/v1/aria/#` (or at least announce, `{id}/status`, `{id}/web/out/#`) · SUB `mxpf/v1/aria/{id}/web/in` |
| Browser (`web-console`) | SUB `mxpf/v1/aria/#` · PUB `mxpf/v1/aria/+/web/in` · DENY `mxpf/v1/agents/#` |

If the desk appears in `GET /console` but **not** in the web roster, HiveMQ almost always lacks **publish** permission on `mxpf/v1/aria/#` for the desk user. After fixing ACL, restart API or:

```bash
curl -X POST http://127.0.0.1:8788/console/announce
```

Announce/status are published with **retain** so late-connecting browsers still see the desk.

## Operator flow

1. Restart API → log line `[console] enabled ariaId=…`
2. Open https://aaria.maximprof.com → MQTT login → desk appears in Instances
3. Pair: web shows 6-digit code → TUI `/console pair ######`
4. Chat as usual; revoke with `/console revoke <deviceId|all>`

Empty roster usually means console disabled, MQTT down, or ACL missing announce publish.

See plan: `docs/superpowers/plans/2026-08-30-web-console-mqtt-bridge.md`
