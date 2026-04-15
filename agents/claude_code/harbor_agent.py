"""Claude Code agent — thin wrapper around Harbor's built-in for system_prompt support."""

import shlex
from harbor.agents.installed.claude_code import ClaudeCode
from harbor.agents.installed.base import with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class ClaudeCodeAgent(ClaudeCode):
    """Extends built-in CC with system_prompt kwarg."""

    def __init__(self, *args, system_prompt: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._system_prompt = system_prompt.replace("\\n", "\n")

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if self._system_prompt:
            instruction = self._system_prompt.strip() + "\n\n" + instruction
        # Call the parent's run but skip its @with_prompt_template by calling the unwrapped method
        # We need to replicate the parent's run logic since super().run() would double-apply the decorator
        await ClaudeCode.run.__wrapped__(self, instruction, environment, context)
