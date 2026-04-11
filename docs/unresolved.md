# Unresolved Issues

## High Priority

- **AAE CLI Harbor migration**: `aae/cli.py` still uses `tb run`. Need to update to `harbor run` and read Harbor result format (`jobs/` dir, `reward.txt`). Branch: `harbor-migration`.
- **Credit/token tracking**: Kiro credits parsed from terminal text (fragile). Qoder has no usage stats. Need structured output or API-level tracking.

## Medium Priority

- **Incremental testing (`--resume`)**: Implemented for TB but not tested with Harbor. Harbor may handle resume differently.
- **Prebuild Docker images**: Script exists (`prebuild.sh`) but not integrated into `aae run`. Would eliminate concurrent build failures.
- **Agent judge on Harbor results**: `aae/tb.py` reads TB output format. Need `aae/harbor.py` to read Harbor's `jobs/` format.

## Low Priority

- **Web dashboard**: `web/` directory has React skeleton but not connected to current data.
- **Multiple rubrics**: Only `default.yaml` exists. `coding.yaml` and `analysis.yaml` were created then removed. Add back when needed.
- **pass@k support**: Harbor supports `-k 5` for multiple attempts. AAE doesn't aggregate multi-attempt results yet.
