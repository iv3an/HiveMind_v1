from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.agents import run_hivemind_pipeline, run_buildpack_pipeline
from app.ws_handler import WSManager

app = FastAPI(title="HiveMind — Hackathon Idea Generator")

STATIC_DIR = Path(__file__).parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")



@app.get("/")
async def landing():
    return FileResponse(str(STATIC_DIR / "landing.html"))


@app.get("/app")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/about")
async def about():
    return FileResponse(str(STATIC_DIR / "about.html"))


@app.get("/results")
async def results():
    return FileResponse(str(STATIC_DIR / "results.html"))


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    mgr = WSManager(ws)

    try:
        while True:
            data = await ws.receive_json()

            if data.get("type") == "run":
                theme: str = data.get("theme", "").strip()
                team_size: int = max(1, int(data.get("team_size", 2)))
                agents_config: list = data.get("agents", [])

                if not theme:
                    await mgr.pipeline_error("Please enter a hackathon theme or focus area.")
                    continue

                if not agents_config:
                    await mgr.pipeline_error("Please select at least one agent.")
                    continue

                try:
                    await run_hivemind_pipeline(theme, team_size, agents_config, mgr)
                except Exception as e:
                    await mgr.pipeline_error(f"Pipeline failed: {e}")

            elif data.get("type") == "buildpack":
                theme: str = data.get("theme", "").strip()
                prior_context: str = data.get("prior_context", "")

                if not theme and not prior_context:
                    await mgr.pipeline_error("No project context provided for Build Pack.")
                    continue

                try:
                    await run_buildpack_pipeline(theme, prior_context, mgr)
                except Exception as e:
                    await mgr.pipeline_error(f"Build Pack failed: {e}")

            elif data.get("type") == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
