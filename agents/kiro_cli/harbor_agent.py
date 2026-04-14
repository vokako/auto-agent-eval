"""Kiro CLI agent for Harbor."""

import json
import os
import shlex
import urllib.request
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


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


AGENT_DIR = Path(__file__).parent


def _find_bin_dir(version: str | None = None) -> Path:
    bin_dir = AGENT_DIR / "bin"
    if version:
        versioned = bin_dir / version
        if versioned.exists():
            return versioned
    if (bin_dir / "kiro-cli-chat").exists():
        return bin_dir
    versions = sorted([d for d in bin_dir.iterdir() if d.is_dir()], reverse=True)
    if versions:
        return versions[0]
    raise FileNotFoundError(f"No kiro-cli-chat binaries found in {bin_dir}")


_AUTH_PATHS = [
    Path("~/.local/share/kiro-cli/data.sqlite3"),
    Path("~/Library/Application Support/kiro-cli/data.sqlite3"),
]


def _find_auth_db() -> Path | None:
    for p in _AUTH_PATHS:
        expanded = p.expanduser()
        if expanded.exists():
            return expanded
    return None


class KiroCliAgent(BaseInstalledAgent):

    @staticmethod
    def name() -> str:
        return "kiro-cli"

    def __init__(self, *args, system_prompt: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._system_prompt = system_prompt.replace("\\n", "\n")

    def get_version_command(self) -> str | None:
        return 'export PATH="/installed-agent/bin:$PATH"; kiro-cli-chat --version'

    async def install(self, environment: BaseEnvironment) -> None:
        bin_dir = _find_bin_dir(self._version)
        bin_path = bin_dir / "kiro-cli-chat"
        if not bin_path.exists():
            raise FileNotFoundError(f"kiro-cli-chat not found in {bin_dir}")

        await self.exec_as_root(environment, "mkdir -p /installed-agent/bin")
        await environment.upload_file(str(bin_path), "/installed-agent/bin/kiro-cli-chat")
        await self.exec_as_root(environment, "chmod +x /installed-agent/bin/kiro-cli-chat")

        # Auth: prefer KIRO_API_KEY env var, fall back to sqlite DB copy
        api_key = os.environ.get("KIRO_API_KEY", "")
        if not api_key:
            auth_db = _find_auth_db()
            if auth_db:
                await self.exec_as_agent(environment, "mkdir -p $HOME/.local/share/kiro-cli")
                await environment.upload_file(str(auth_db), "/tmp/kiro-auth.sqlite3")
                await self.exec_as_agent(
                    environment,
                    "mv /tmp/kiro-auth.sqlite3 $HOME/.local/share/kiro-cli/data.sqlite3",
                )

        # Copy agent config for --agent benchmark (allows tools in non-interactive)
        agent_config = AGENT_DIR / "config" / "benchmark.json"
        if agent_config.exists():
            await self.exec_as_agent(environment, "mkdir -p $HOME/.kiro/agents")
            await environment.upload_file(str(agent_config), "/tmp/benchmark.json")
            await self.exec_as_agent(environment, "mv /tmp/benchmark.json $HOME/.kiro/agents/benchmark.json")

    def populate_context_post_run(self, context: AgentContext) -> None:
        # Parse credits from agent output if available
        agent_log = self.logs_dir / "kiro-cli.txt"
        if agent_log.exists():
            import re
            text = agent_log.read_text(errors="ignore")
            credits = sum(float(m) for m in re.findall(r"Credits:\s*([\d.]+)", text))
            if credits:
                context.cost_usd = credits  # approximate

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        if self._system_prompt:
            instruction = self._system_prompt.strip() + "\n\n" + instruction

        escaped = shlex.quote(instruction)
        model_flag = ""
        if self.model_name:
            model_flag = f" --model {shlex.quote(self.model_name)}"

        # Use --agent benchmark for 2.0+ (allows tools in non-interactive mode)
        agent_flag = ""
        agent_config = AGENT_DIR / "config" / "benchmark.json"
        if agent_config.exists():
            agent_flag = " --agent benchmark"

        env = {}
        api_key = os.environ.get("KIRO_API_KEY", "")
        if api_key:
            env["KIRO_API_KEY"] = api_key

        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="/installed-agent/bin:$PATH"; '
                f"kiro-cli-chat chat --no-interactive --trust-all-tools"
                f" --wrap never{agent_flag}{model_flag} {escaped}"
                f" 2>&1 | tee /logs/agent/kiro-cli.txt"
            ),
            env=env,
        )
