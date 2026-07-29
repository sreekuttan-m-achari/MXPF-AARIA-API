---
name: K8s context connectivity sweep
description: "Check kubectl availability, enumerate contexts, test each for reachability/auth, and return a concise status summary."
author: AARIA
---

## Goal
Assess Kubernetes access across all configured kubeconfig contexts.

## Steps
1. Verify CLI access:
   - `kubectl version --client`
2. List contexts:
   - `kubectl config get-contexts -o name`
3. For each context, test API reachability and auth:
   - `kubectl --context <ctx> cluster-info`
   - `kubectl --context <ctx> get ns --request-timeout=10s`
4. Classify result per context:
   - **Reachable**: command succeeds
   - **Auth issue**: unauthorized/forbidden/credentials errors
   - **Unreachable**: timeout/DNS/network/refused
5. Summarize with totals:
   - Total checked
   - Reachable count
   - Problem count
   - Lists of reachable and problem contexts

## Output format
- Short bullet summary with counts first
- Then grouped context lists by status
- Mention if checks are still running before final report
