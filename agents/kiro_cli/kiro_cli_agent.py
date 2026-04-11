"""Kiro CLI agent adapter for Terminal-Bench.

Auth is handled by copying the host's sqlite3 auth DB into the container.
Binaries are copied from agents/kiro_cli/bin/ into the container.
"""

import shlex
from pathlib import Path

from terminal_bench.agents.installed_agents.abstract_installed_agent import (
    AbstractInstalledAgent,
)
from terminal_bench.terminal.models import TerminalCommand

AGENT_DIR = Path(__file__).parent

_AUTH_PATHS = [
    Path("~/.local/share/kiro-cli/data.sqlite3"),
    Path("~/Library/Application Support/kiro-cli/data.sqlite3"),
]

CONTAINER_AUTH_DIR = "/root/.local/share/kiro-cli"


def _find_auth_db() -> Path | None:
    for p in _AUTH_PATHS:
        expanded = p.expanduser()
        if expanded.exists():
            return expanded
    return None


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
    raise FileNotFoundError(f"No kiro-cli binaries found in {bin_dir}")


class KiroCliAgent(AbstractInstalledAgent):

    def __init__(self, model_name: str | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._model_name = model_name
        self._version = kwargs.get("version")
        self._system_prompt = kwargs.get("system_prompt", "").replace("\\n", "\n")

    @staticmethod
    def name() -> str:
        return "kiro-cli"

    @property
    def _env(self) -> dict[str, str]:
        return {}

    @property
    def _install_agent_script_path(self) -> Path:
        return self._get_templated_script_path("setup.sh.j2")

    def _get_template_variables(self) -> dict[str, str]:
        return {"auth_dir": CONTAINER_AUTH_DIR}

    def perform_task(self, instruction, session, logging_dir=None):
        bin_dir = _find_bin_dir(self._version)
        bin_path = bin_dir / "kiro-cli-chat"
        if not bin_path.exists():
            raise FileNotFoundError(f"kiro-cli-chat not found in {bin_dir}")
        session.copy_to_container(
            bin_path,
            container_dir="/installed-agent/bin",
            container_filename="kiro-cli-chat",
        )
        session.container.exec_run(["chmod", "+x", "/installed-agent/bin/kiro-cli-chat"])

        auth_db = _find_auth_db()
        if not auth_db:
            raise FileNotFoundError(
                "Kiro CLI auth DB not found. Run 'kiro-cli login' first."
            )
        session.copy_to_container(
            auth_db,
            container_dir=CONTAINER_AUTH_DIR,
            container_filename="data.sqlite3",
        )

        return super().perform_task(instruction, session, logging_dir)

    def _run_agent_commands(self, instruction: str) -> list[TerminalCommand]:
        if self._system_prompt:
            instruction = self._system_prompt.strip() + "\n\n" + instruction

        escaped = shlex.quote(instruction)
        model_flag = ""
        if self._model_name:
            model_flag = " --model " + shlex.quote(self._model_name)
        return [
            TerminalCommand(
                command=(
                    f"kiro-cli-chat chat --no-interactive --trust-all-tools"
                    f" --wrap never{model_flag} {escaped}"
                ),
                min_timeout_sec=0.0,
                max_timeout_sec=float("inf"),
                block=True,
                append_enter=True,
            ),
        ]
