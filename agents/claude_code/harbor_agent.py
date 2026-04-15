"""Claude Code agent for Harbor — pre-upload binary, matching built-in behavior.

Uploads the bundled CC binary instead of curl|bash to avoid OOM in
memory-constrained containers. Runs via exec_as_agent like the built-in adapter.
"""

import json
import os
import re
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
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths


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

    def __init__(self, *args, system_prompt: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._system_prompt = system_prompt.replace("\\n", "\n")

    @staticmethod
    def name() -> str:
        return "claude-code"

    def get_version_command(self) -> str | None:
        return 'export PATH="$HOME/.local/bin:$PATH"; claude --version'

    def parse_version(self, stdout: str) -> str:
        match = re.search(r"(\d+\.\d+\.\d+)", stdout.strip())
        return match.group(1) if match else stdout.strip()

    async def install(self, environment: BaseEnvironment) -> None:
        # Install system deps (root) — same as built-in
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apk &> /dev/null; then"
                "  apk add --no-cache curl bash nodejs npm;"
                " elif command -v apt-get &> /dev/null; then"
                "  apt-get update && apt-get install -y curl;"
                " elif command -v yum &> /dev/null; then"
                "  yum install -y curl;"
                " else"
                '  echo "Warning: No known package manager found" >&2;'
                " fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

        # Install CC via curl|bash — same as built-in, gets latest version
        version_flag = f" {self._version}" if self._version else ""
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "if command -v apk &> /dev/null; then"
                f"  npm install -g @anthropic-ai/claude-code{'@' + self._version if self._version else ''};"
                " else"
                f"  curl -fsSL https://claude.ai/install.sh | bash -s --{version_flag};"
                " fi && "
                'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.bashrc && '
                'export PATH="$HOME/.local/bin:$PATH" && '
                "claude --version"
            ),
        )

    def _build_env(self) -> dict[str, str]:
        use_bedrock = os.environ.get("CLAUDE_CODE_USE_BEDROCK", "") == "1"
        env = {
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY") or "not-used",
            "CLAUDE_CODE_OAUTH_TOKEN": os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", ""),
            "FORCE_AUTO_BACKGROUND_TASKS": "1",
            "ENABLE_BACKGROUND_TASKS": "1",
        }
        if use_bedrock:
            env["CLAUDE_CODE_USE_BEDROCK"] = "1"
            for var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                        "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_REGION",
                        "AWS_BEARER_TOKEN_BEDROCK"):
                val = os.environ.get(var, "")
                if val:
                    env[var] = val
            if "AWS_ACCESS_KEY_ID" not in env:
                env.update(_get_ec2_credentials())
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
        if self._system_prompt:
            instruction = self._system_prompt.strip() + "\n\n" + instruction

        escaped = shlex.quote(instruction)
        env = self._build_env()
        env.update(self._extra_env)

        # Set model via env var (same as built-in CC)
        if self.model_name:
            if env.get("CLAUDE_CODE_USE_BEDROCK") == "1" and "/" in self.model_name:
                env["ANTHROPIC_MODEL"] = self.model_name.split("/", 1)[-1]
            else:
                env["ANTHROPIC_MODEL"] = self.model_name

        env["CLAUDE_CONFIG_DIR"] = (EnvironmentPaths.agent_dir / "sessions").as_posix()

        cli_flags = self.build_cli_flags()
        extra = (cli_flags + " ") if cli_flags else ""

        # Setup config dirs (same as built-in)
        await self.exec_as_agent(
            environment,
            command=(
                "mkdir -p $CLAUDE_CONFIG_DIR/debug $CLAUDE_CONFIG_DIR/projects/-app "
                "$CLAUDE_CONFIG_DIR/shell-snapshots $CLAUDE_CONFIG_DIR/statsig "
                "$CLAUDE_CONFIG_DIR/todos $CLAUDE_CONFIG_DIR/skills"
            ),
            env=env,
        )

        # Run CC directly via exec_as_agent (same as built-in, no su)
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$PATH"; '
                f"claude --verbose --output-format=stream-json "
                f"--permission-mode=bypassPermissions "
                f"{extra}"
                f"--print -- {escaped} 2>&1 </dev/null | tee "
                f"/logs/agent/claude-code.txt"
            ),
            env=env,
        )
