"""Claude Code agent for Harbor — pre-upload binary instead of curl|bash install.

Avoids OOM kills in memory-constrained containers by uploading the bundled
CC binary directly, instead of downloading+installing inside the container.
"""

import json
import os
import shlex
import urllib.request
from pathlib import Path

from harbor.agents.installed.base import (
    BaseInstalledAgent,
    CliFlag,
    EnvVar,
    with_prompt_template,
)
from harbor.agents.installed.claude_code import ClaudeCode as _BuiltinCC


def _get_ec2_credentials() -> dict[str, str]:
    try:
        req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            method="PUT",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
        )
        token = urllib.request.urlopen(req, timeout=2).read().decode()
        headers = {"X-aws-ec2-metadata-token": token}
        req = urllib.request.Request(
            "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
            headers=headers,
        )
        role = urllib.request.urlopen(req, timeout=2).read().decode().strip()
        req = urllib.request.Request(
            f"http://169.254.169.254/latest/meta-data/iam/security-credentials/{role}",
            headers=headers,
        )
        creds = json.loads(urllib.request.urlopen(req, timeout=2).read())
        return {
            "AWS_ACCESS_KEY_ID": creds["AccessKeyId"],
            "AWS_SECRET_ACCESS_KEY": creds["SecretAccessKey"],
            "AWS_SESSION_TOKEN": creds["Token"],
        }
    except Exception:
        return {}
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


def _find_bundled_binary() -> Path:
    try:
        import claude_agent_sdk
        bundled = Path(claude_agent_sdk.__file__).parent / "_bundled" / "claude"
        if bundled.exists():
            return bundled
    except ImportError:
        pass
    raise FileNotFoundError("No bundled claude binary found in claude_agent_sdk")


class ClaudeCodeAgent(BaseInstalledAgent):
    SUPPORTS_ATIF: bool = True
    CLI_FLAGS = _BuiltinCC.CLI_FLAGS
    ENV_VARS = _BuiltinCC.ENV_VARS

    @staticmethod
    def name() -> str:
        return "claude-code"

    def get_version_command(self) -> str | None:
        return 'export PATH="/installed-agent/bin:$PATH"; claude --version'

    def parse_version(self, stdout: str) -> str:
        import re
        match = re.search(r"(\d+\.\d+\.\d+)", stdout.strip())
        return match.group(1) if match else stdout.strip()

    async def install(self, environment: BaseEnvironment) -> None:
        binary = _find_bundled_binary()
        await self.exec_as_root(environment, "mkdir -p /installed-agent/bin")
        await environment.upload_file(str(binary), "/installed-agent/bin/claude")
        await self.exec_as_root(
            environment,
            command=(
                "chmod +x /installed-agent/bin/claude && "
                # CC refuses bypassPermissions as root — create non-root user
                "id -u agent &>/dev/null 2>&1 || useradd -m -s /bin/bash agent; "
                "mkdir -p /home/agent/.local/bin; "
                "ln -sf /installed-agent/bin/claude /home/agent/.local/bin/claude; "
                "chown -R agent:agent /home/agent; "
                "chown -R agent:agent /app 2>/dev/null || true; "
                "chown -R agent:agent /logs 2>/dev/null || true"
            ),
        )

    def _build_env(self) -> dict[str, str]:
        use_bedrock = os.environ.get("CLAUDE_CODE_USE_BEDROCK", "") == "1"
        env = {
            "CLAUDE_CODE_OAUTH_TOKEN": os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", ""),
            "FORCE_AUTO_BACKGROUND_TASKS": "1",
            "ENABLE_BACKGROUND_TASKS": "1",
        }
        if use_bedrock:
            env["CLAUDE_CODE_USE_BEDROCK"] = "1"
            env["ANTHROPIC_API_KEY"] = "not-used"
            for var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                        "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_REGION",
                        "AWS_BEARER_TOKEN_BEDROCK"):
                val = os.environ.get(var, "")
                if val:
                    env[var] = val
            # Fetch EC2 IAM credentials if not already set
            if "AWS_ACCESS_KEY_ID" not in env:
                env.update(_get_ec2_credentials())
        else:
            env["ANTHROPIC_API_KEY"] = os.environ.get("ANTHROPIC_API_KEY") or ""
        return {k: v for k, v in env.items() if v is not None}

    def populate_context_post_run(self, context: AgentContext) -> None:
        log = self.logs_dir / "claude-code.txt"
        if not log.exists():
            return
        for line in log.read_text(errors="ignore").splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("type") == "result":
                context.cost_usd = d.get("total_cost_usd", 0)
                usage = d.get("usage", {})
                context.n_input_tokens = usage.get("input_tokens", 0)
                context.n_output_tokens = usage.get("output_tokens", 0)
                context.n_cache_tokens = usage.get("cache_read_input_tokens", 0)

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped = shlex.quote(instruction)
        env = self._build_env()
        # Merge _extra_env (from --ae flags) so Bedrock creds are available
        env.update(self._extra_env)
        # Set model via env var (same as built-in CC)
        if self.model_name:
            use_bedrock = env.get("CLAUDE_CODE_USE_BEDROCK") == "1"
            if use_bedrock and "/" in self.model_name:
                env["ANTHROPIC_MODEL"] = self.model_name.split("/", 1)[-1]
            else:
                env["ANTHROPIC_MODEL"] = self.model_name
        from harbor.models.trial.paths import EnvironmentPaths
        env["CLAUDE_CONFIG_DIR"] = (EnvironmentPaths.agent_dir / "sessions").as_posix()

        cli_flags = self.build_cli_flags()
        extra = (cli_flags + " ") if cli_flags else ""

        # Build env export string for su -c
        env_exports = " ".join(f"{k}={shlex.quote(v)}" for k, v in env.items())

        # Run as 'agent' user to avoid CC's root check
        cmd = (
            f"export {env_exports} PATH=/home/agent/.local/bin:/installed-agent/bin:$PATH; "
            f"cd /app && "
            f"mkdir -p $CLAUDE_CONFIG_DIR/debug $CLAUDE_CONFIG_DIR/projects/-app "
            f"$CLAUDE_CONFIG_DIR/shell-snapshots $CLAUDE_CONFIG_DIR/statsig "
            f"$CLAUDE_CONFIG_DIR/todos $CLAUDE_CONFIG_DIR/skills && "
            f"claude --verbose --output-format=stream-json "
            f"--permission-mode=bypassPermissions "
            f"{extra}"
            f"--print -- {escaped} 2>&1 </dev/null | tee "
            f"/logs/agent/claude-code.txt"
        )

        await self.exec_as_root(
            environment,
            command=f"su - agent -c {shlex.quote(cmd)}",
        )
