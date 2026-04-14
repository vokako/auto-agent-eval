# Unresolved Issues

## Medium Priority

- **Credit/token tracking**: Kiro credits parsed from terminal text (fragile). Qoder has no usage stats. Need structured output or API-level tracking.
- **Kiro 1.29.8 compatibility**: `execute_bash` rejected in `--no-interactive` mode. Pinned to 1.29.6. Monitor future releases.
- **CC adapter performance**: 14/51 timeouts on lite set vs Kiro's 7. CC is slower per turn due to Bedrock latency + more turns. Not an adapter bug.
- **Docker Hub rate limit**: Pre-pull images after login. Don't run `docker system prune`. Consider mirroring images to ECR.

## Low Priority

- **Agent judge on Harbor results**: `aae judge` command works but not integrated with web dashboard yet.
- **pass@k support**: Harbor supports `-k 5` for multiple attempts. AAE doesn't aggregate multi-attempt results yet.
- **Legacy cleanup**: `runs/` directory (TB format), `aae/tb.py`, old task configs (`*-tb-core.yaml`) can be removed.
