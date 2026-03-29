import asyncio
import json
from fastapi import WebSocket


class WSManager:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self._lock = asyncio.Lock()

    async def send(self, payload: dict):
        async with self._lock:
            await self.ws.send_json(payload)

    async def agent_thinking(self, name: str, emoji: str, phase: str = "idea"):
        await self.send({"type": "agent", "agent": name, "emoji": emoji, "status": "thinking", "token": "", "phase": phase})

    async def agent_token(self, name: str, emoji: str, token: str, phase: str = "idea"):
        await self.send({"type": "agent", "agent": name, "emoji": emoji, "status": "streaming", "token": token, "phase": phase})

    async def agent_done(self, name: str, emoji: str, phase: str = "idea"):
        await self.send({"type": "agent", "agent": name, "emoji": emoji, "status": "done", "token": "", "phase": phase})

    async def agent_error(self, name: str, emoji: str, error: str, phase: str = "idea"):
        await self.send({"type": "agent", "agent": name, "emoji": emoji, "status": "error", "token": error, "phase": phase})

    async def pipeline_status(self, message: str):
        await self.send({"type": "status", "message": message})

    async def phase_update(self, phase_name: str):
        await self.send({"type": "phase_update", "phase": phase_name})

    async def pipeline_complete(self, report: str, outputs: dict):
        payload = {"type": "complete", "report": report, "outputs": outputs}
        await self.send(payload)

    async def pipeline_error(self, message: str):
        await self.send({"type": "error", "message": message})

    async def debate_start(self):
        await self.send({"type": "debate_start"})

    async def debate_thinking(self, name: str):
        await self.send({"type": "debate", "agent": name, "status": "thinking", "token": ""})

    async def debate_token(self, name: str, token: str):
        await self.send({"type": "debate", "agent": name, "status": "streaming", "token": token})

    async def debate_done(self, name: str):
        await self.send({"type": "debate", "agent": name, "status": "done", "token": ""})

    async def debate_end(self, idea: str = ""):
        await self.send({"type": "debate_end", "idea": idea})
