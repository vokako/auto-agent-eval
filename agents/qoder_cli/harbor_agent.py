"""Qoder CLI agent for Harbor."""

import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

AGENT_DIR = Path(__file__).parent


def _find_bin_dir(version: str | None = None) -> Path:
    bin_dir = AGENT_DIR / "bin"
    if version:
        versioned = bin_dir / version
        if versioned.exists():
            return versioned
    if (bin_dir / "qodercli").exists():
        return bin_dir
    versions = sorted([d for d in bin_dir.iterdir() if d.is_dir()], reverse=True)
    if versions:
        return versions[0]
    raise FileNotFoundError(f"No qodercli binaries found in {bin_dir}")


class QoderCliAgent(BaseInstalledAgent):

    @staticmethod
    def name() -> str:
        return "qoder-cli"

    def __init__(self, *args, system_prompt: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._system_prompt = system_prompt.replace("\\n", "\n")

    def get_version_command(self) -> str | None:
        return 'export PATH="/installed-agent/bin:$PATH"; qodercli --version'

    async def install(self, environment: BaseEnvironment) -> None:
        bin_dir = _find_bin_dir(self._version)
        bin_path = bin_dir / "qodercli"
        if not bin_path.exists():
            raise FileNotFoundError(f"qodercli not found in {bin_dir}")

        await self.exec_as_root(environment, "mkdir -p /installed-agent/bin")
        await environment.upload_file(str(bin_path), "/installed-agent/bin/qodercli")
        await self.exec_as_root(environment, "chmod +x /installed-agent/bin/qodercli")

    def populate_context_post_run(self, context: AgentContext) -> None:
        pass

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

        env = {}
        token = os.environ.get("QODER_PERSONAL_ACCESS_TOKEN", "")
        if token:
            env["QODER_PERSONAL_ACCESS_TOKEN"] = token

        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="/installed-agent/bin:$PATH"; '
                f"qodercli -p {escaped} --yolo -q{model_flag}"
                f" 2>&1 | tee /logs/agent/qodercli.txt"
            ),
            env=env,
        )
