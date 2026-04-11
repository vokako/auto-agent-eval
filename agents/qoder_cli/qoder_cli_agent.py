"""Qoder CLI agent adapter for Terminal-Bench."""

import os
import shlex
from pathlib import Path

from terminal_bench.agents.installed_agents.abstract_installed_agent import (
    AbstractInstalledAgent,
)
from terminal_bench.terminal.models import TerminalCommand

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


class QoderCliAgent(AbstractInstalledAgent):

    def __init__(self, model_name: str | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._model_name = model_name
        self._version = kwargs.get("version")
        self._system_prompt = kwargs.get("system_prompt", "").replace("\\n", "\n")

    @staticmethod
    def name() -> str:
        return "qoder-cli"

    @property
    def _env(self) -> dict[str, str]:
        env = {}
        if "QODER_PERSONAL_ACCESS_TOKEN" in os.environ:
            env["QODER_PERSONAL_ACCESS_TOKEN"] = os.environ["QODER_PERSONAL_ACCESS_TOKEN"]
        return env

    @property
    def _install_agent_script_path(self) -> Path:
        return self._get_templated_script_path("setup.sh.j2")

    def _get_template_variables(self) -> dict[str, str]:
        return {}

    def perform_task(self, instruction, session, logging_dir=None):
        bin_dir = _find_bin_dir(self._version)
        bin_path = bin_dir / "qodercli"
        if not bin_path.exists():
            raise FileNotFoundError(f"qodercli not found in {bin_dir}")
        session.copy_to_container(
            bin_path,
            container_dir="/installed-agent/bin",
            container_filename="qodercli",
        )
        session.container.exec_run(["chmod", "+x", "/installed-agent/bin/qodercli"])

        return super().perform_task(instruction, session, logging_dir)

    def _run_agent_commands(self, instruction: str) -> list[TerminalCommand]:
        if self._system_prompt:
            instruction = self._system_prompt.strip() + "\n\n" + instruction

        escaped = shlex.quote(instruction)
        model_flag = ""
        if self._model_name:
            model_flag = f" --model {shlex.quote(self._model_name)}"
        return [
            TerminalCommand(
                command=(
                    f"qodercli -p {escaped} --yolo -q{model_flag}"
                ),
                min_timeout_sec=0.0,
                max_timeout_sec=float("inf"),
                block=True,
                append_enter=True,
            ),
        ]
