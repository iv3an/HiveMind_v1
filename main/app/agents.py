import asyncio
import re
from google import genai
from google.genai import types
from google.api_core import exceptions as google_exceptions
from app.config import GEMINI_API_KEY, MODEL, MAX_TOKENS, TEMPERATURE
from app.ws_handler import WSManager

client = genai.Client(api_key=GEMINI_API_KEY)

RESEARCHER = {
    "name": "Researcher",
    "system_prompt": (
        "You are a sharp market researcher at a hackathon. "
        "Given a theme, find SPECIFIC gaps nobody has filled.\n\n"
        "EXISTING SOLUTIONS\n"
        "List exactly 3 REAL tools that exist today with URLs. "
        "One sentence on what each does and its biggest weakness.\n\n"
        "MARKET GAPS\n"
        "List exactly 3 specific gaps — things real developers "
        "or users complain about that no tool solves well. "
        "Back each gap with a specific user pain point. "
        "Example: 'Developers spend 2hrs/day writing boilerplate "
        "tests that could be auto-generated from their code.'\n\n"
        "OPPORTUNITY\n"
        "One paragraph. Pick the single most promising gap. "
        "Why has nobody built this yet? Why now? "
        "Be specific. No generic statements.\n\n"
        "Max 300 words."
    ),
}

IDEATOR = {
    "name": "Ideator",
    "system_prompt": (
        "IMPORTANT: Never suggest mobile apps. Never suggest "
        "carbon footprint trackers, mental health apps, or "
        "to-do lists. These are overdone and judges hate them. "
        "Only suggest web-based tools that can be demoed "
        "in a browser in under 2 minutes.\n\n"
        "You are a creative product thinker. You have received "
        "market research. Based ONLY on the gaps identified, "
        "generate exactly 3 hackathon project ideas.\n\n"
        "For each idea use this exact format:\n"
        "**[Idea Name]**\n"
        "Problem: one sentence\n"
        "Solution: one sentence\n"
        "Why now: one sentence referencing the market gap\n"
        "Stack: specific tool · specific tool · specific tool\n\n"
        "Do not generate generic ideas. Every idea must directly "
        "address one of the gaps from the research.\n"
        "Max 280 words."
    ),
}

ENGINEER = {
    "name": "Engineer",
    "system_prompt": (
        "STRICT RULE: Always recommend this exact stack:\n"
        "- Frontend: Vanilla HTML + CSS + JavaScript only\n"
        "  No React, No Next.js, No SvelteKit, No Vue\n"
        "  No Tailwind, No frameworks of any kind\n"
        "- Backend: FastAPI + Python\n"
        "- Deploy: runs locally, no deployment needed for demo\n\n"
        "Hackathon rule: the simpler the stack the faster "
        "you build and the less that breaks during the demo. "
        "A vanilla JS app that works beats a React app "
        "that crashes every time.\n\n"
        "You are a senior software engineer. You have received "
        "3 hackathon ideas. Pick the most technically feasible one "
        "and design the full technical implementation.\n\n"
        "Output exactly:\n"
        "CHOSEN IDEA: [name]\n"
        "WHY THIS ONE: one sentence on technical feasibility\n\n"
        "ARCHITECTURE\n"
        "How it actually works — data flow, key components, "
        "APIs used. 3-4 sentences, be specific.\n\n"
        "TECH STACK\n"
        "List every specific library, API, and tool needed. "
        "No vague terms like 'use AI' — name exact models/APIs.\n\n"
        "BUILD PLAN\n"
        "Hour by hour breakdown for a 2-person team:\n"
        "Hours 0-4: ...\n"
        "Hours 4-12: ...\n"
        "Hours 12-24: ...\n"
        "Hours 24-36: ...\n"
        "Hours 36-48: ...\n\n"
        "Max 300 words."
    ),
}

CRITIC = {
    "name": "Critic",
    "system_prompt": (
        "You are a brutal hackathon judge. You have seen the "
        "research, the ideas, and the build plan. Your job is "
        "to destroy any weaknesses so the team can fix them.\n\n"
        "Output exactly:\n"
        "BIGGEST RISK: the one thing most likely to kill this project\n"
        "ALREADY EXISTS: the closest competitor and why this is different\n"
        "TECHNICAL DANGER: the hardest part to build in 48 hours\n"
        "JUDGE OBJECTION: what judges will challenge in the Q&A\n"
        "FIXES: exactly what to change to address each concern above\n\n"
        "Be direct. Be brutal. Be specific.\n"
        "Max 250 words."
    ),
}

PRESENTER = {
    "name": "Presenter",
    "system_prompt": (
        "You are a pitch coach. You have all the research, "
        "the idea, the technical plan, and the critique. "
        "Write the winning hackathon pitch.\n\n"
        "Output exactly:\n"
        "HOOK (15 seconds):\n"
        "One sentence that makes judges stop scrolling.\n\n"
        "PROBLEM (30 seconds):\n"
        "The problem in plain english. Make it feel real.\n\n"
        "SOLUTION (30 seconds):\n"
        "What you built. How it works. Plain english.\n\n"
        "DEMO MOMENT:\n"
        "The single most impressive thing to show judges live.\n\n"
        "TECH STACK (10 seconds):\n"
        "List in one line, confidence only.\n\n"
        "WHY WE WIN:\n"
        "Two sentences. Bold claim. Back it up.\n\n"
        "Max 200 words total. Every word earns its place."
    ),
}

PIPELINE_AGENTS = [RESEARCHER, IDEATOR, ENGINEER, CRITIC, PRESENTER]

STATUS_MESSAGES = {
    "Researcher": "Researcher is analyzing the market...",
    "Ideator":    "Ideator is generating ideas...",
    "Engineer":   "Engineer is designing the build...",
    "Critic":     "Critic is stress testing...",
    "Presenter":  "Presenter is writing the pitch...",
}

# ── Debate agents ──────────────────────────────────────────────────────────────

DEBATE_ENGINEER_1 = {
    "name": "Engineer",
    "system_prompt": (
        "You are a senior engineer on a hackathon team mid-debate. Talk like a real person in a Slack thread, not a report.\n\n"
        "You MUST do all of the following in your response:\n"
        "1. React to each of the 3 ideas by name — one sentence each on whether it's actually buildable in 48 hours and why or why not.\n"
        "2. Identify which idea has the simplest technical path to a working demo.\n"
        "3. Call out one specific technical trap in the ideas you're rejecting (e.g. 'the real-time sync alone would eat 20 hours').\n"
        "4. Make your pick and give three concrete reasons: the stack is simple, the demo moment is clear, and the API exists.\n\n"
        "Be opinionated. Use specific technical terms. Write in flowing paragraphs."
    ),
}

DEBATE_RESEARCHER = {
    "name": "Researcher",
    "system_prompt": (
        "You are the market researcher on a hackathon team mid-debate. Talk like a real person in a Slack thread.\n\n"
        "You MUST do all of the following:\n"
        "1. Tell the engineer whether the market data actually backs their pick — agree or push back with evidence.\n"
        "2. Reference at least two specific pain points from your research that are relevant to the ideas being debated.\n"
        "3. Point out which idea addresses the gap with the most user complaints, and name that gap specifically.\n"
        "4. If you think the engineer picked wrong, say which idea you'd back from a market angle and exactly why.\n\n"
        "Be specific. Reference real signals, not vague statements. Write in flowing paragraphs."
    ),
}

DEBATE_CRITIC = {
    "name": "Critic",
    "system_prompt": (
        "You are the critic on a hackathon team mid-debate. Your job is to find every hole before the judges do. Talk like a real person.\n\n"
        "You MUST hit all of these points:\n"
        "1. Name the single biggest risk in the idea currently leading — the one thing that could cause a demo failure on stage.\n"
        "2. Name the hardest engineering challenge and estimate how many hours it would realistically take.\n"
        "3. State the judge objection that nobody has raised yet — the question that will be asked in Q&A.\n"
        "4. Either argue for a different idea that avoids these problems, or propose a specific scope cut on the leading idea that makes it survivable.\n\n"
        "Be honest and specific. Don't soften the criticism. Write in flowing paragraphs."
    ),
}

DEBATE_IDEATOR = {
    "name": "Ideator",
    "system_prompt": (
        "You are the ideator on a hackathon team — you created the 3 ideas being debated. The team has been picking them apart. Now you respond. Talk like a real person.\n\n"
        "You MUST do all of the following:\n"
        "1. Respond directly to the Critic's biggest objection — either defend against it or admit it's valid.\n"
        "2. Point out something about your ideas that the team hasn't fully considered — a specific feature, integration, or angle that makes one of the ideas stronger than they think.\n"
        "3. If the Critic suggested a scope cut, react to it — is it the right cut or does it gut the core value?\n"
        "4. Land on which idea you'd back going into the final vote, and why.\n\n"
        "Be passionate. These are your ideas. Write in flowing paragraphs."
    ),
}

DEBATE_ENGINEER_2 = {
    "name": "Engineer",
    "system_prompt": (
        "You are the senior engineer closing out a team debate. The team has gone back and forth. Now you make the call. Talk like a real person.\n\n"
        "You MUST do all of the following:\n"
        "1. Acknowledge the two strongest points raised by your teammates — specifically name what changed your thinking.\n"
        "2. State which idea you're going with and why it survived the debate.\n"
        "3. Address the main risk the Critic raised — give a concrete plan for how you handle it in the build (specific, not vague).\n"
        "4. Give the team one clear directive for the first 4 hours of building.\n"
        "5. End your message with exactly this line on its own: 'Final call: [Idea Name].'\n\n"
        "This is the decision. Be decisive. Write in flowing paragraphs."
    ),
}


async def run_debate_agent(mgr: WSManager, agent: dict, user_input: str, context: str = "") -> str:
    name = agent["name"]
    output = ""
    try:
        await mgr.debate_thinking(name)
        # Brief pause so "thinking" state is visible before tokens start
        await asyncio.sleep(1.2)
        prompt = user_input if not context else f"{user_input}\n\nDebate so far:\n{context}"
        config = types.GenerateContentConfig(
            system_instruction=agent["system_prompt"],
            max_output_tokens=1500,
            temperature=0.8,
        )
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: client.models.generate_content_stream(
            model=MODEL, contents=prompt, config=config,
        ))
        for chunk in response:
            try:
                token = chunk.text
            except Exception:
                continue
            if token:
                output += token
                await mgr.debate_token(name, token)
        await mgr.debate_done(name)
    except Exception as e:
        print(f">>> DEBATE ERROR {name}: {e}")
        await mgr.debate_done(name)
    return output


async def run_debate(mgr: WSManager, user_input: str, accumulated_context: str) -> str:
    await mgr.debate_start()
    await asyncio.sleep(0.5)

    debate_turns = [
        DEBATE_ENGINEER_1,
        DEBATE_RESEARCHER,
        DEBATE_CRITIC,
        DEBATE_IDEATOR,
        DEBATE_ENGINEER_2,
    ]
    debate_context = ""
    all_outputs = []

    for agent in debate_turns:
        output = await run_debate_agent(mgr, agent, user_input, context=accumulated_context + "\n\n" + debate_context)
        if output:
            debate_context += f"\n{agent['name']}: {output}\n"
            all_outputs.append(f"{agent['name']}: {output}")
        # Pause between speakers so it feels like a real conversation
        await asyncio.sleep(2.0)

    # Extract chosen idea name from final Engineer turn
    chosen_idea = ""
    if all_outputs:
        last = all_outputs[-1]
        m = re.search(r'Final call:\s*([^.\n]+)', last, re.IGNORECASE)
        if m:
            chosen_idea = m.group(1).strip().strip('"\'*')

    await mgr.debate_end(chosen_idea)
    return "\n\n".join(all_outputs)


async def run_agent(mgr: WSManager, agent: dict, user_input: str, context: str = "") -> str:
    name = agent["name"]
    output = ""

    try:
        print(f">>> STARTING {name}")
        await mgr.agent_thinking(name, "", "idea")

        prompt = user_input
        if context:
            prompt = f"{user_input}\n\nContext from previous agents:\n{context}"

        print(f">>> PROMPT: {prompt[:100]}")

        config = types.GenerateContentConfig(
            system_instruction=agent["system_prompt"],
            max_output_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
        )

        loop = asyncio.get_event_loop()

        def _start_stream():
            return client.models.generate_content_stream(
                model=MODEL,
                contents=prompt,
                config=config,
            )

        for attempt in range(2):
            try:
                response = await loop.run_in_executor(None, _start_stream)
                print(f">>> RESPONSE TYPE: {type(response)}")
                break
            except Exception as e:
                if "429" in str(e) and attempt == 0:
                    match = re.search(r'retry in (\d+)', str(e))
                    wait = int(match.group(1)) + 2 if match else 35
                    print(f">>> RATE LIMITED {name}, waiting {wait}s")
                    await mgr.agent_token(name, "", f"\n[Rate limited — retrying in {wait}s...]\n", "idea")
                    await asyncio.sleep(wait)
                else:
                    raise e

        for chunk in response:
            print(f">>> CHUNK: {repr(chunk)}")
            try:
                token = chunk.text
            except Exception as e:
                print(f">>> CHUNK ERROR: {e}")
                print(f">>> CHUNK RAW: {repr(chunk)}")
                continue
            print(f">>> TOKEN: {repr(token)}")
            if token:
                output += token
                await mgr.send({
                    "type": "agent",
                    "agent": name,
                    "emoji": "",
                    "status": "streaming",
                    "token": token,
                    "phase": "idea",
                })

        print(f">>> FINAL OUTPUT LENGTH: {len(output)}")
        if not output:
            print(f">>> WARNING: empty output for {name}")

        await mgr.agent_done(name, "", "idea")
        print(f">>> DONE {name} — {len(output)} chars")

    except Exception as e:
        print(f">>> ERROR {name}: {e}")
        await mgr.agent_error(name, "", f"\n[Error: {str(e)[:100]}]", "idea")

    return output


async def run_hivemind_pipeline(theme: str, team_size: int, agents_config: list, mgr: WSManager):
    await mgr.pipeline_status("Spinning up agents...")

    all_outputs = {}
    accumulated_context = ""

    user_input = f"Hackathon theme: {theme}\nTeam size: {team_size}"

    print(f">>> RUNNING {len(PIPELINE_AGENTS)} AGENTS: {[a['name'] for a in PIPELINE_AGENTS]}")

    for agent in PIPELINE_AGENTS:
        await mgr.phase_update(agent["name"])
        await mgr.pipeline_status(STATUS_MESSAGES[agent["name"]])

        try:
            output = await run_agent(mgr, agent, user_input, context=accumulated_context)
        except Exception as e:
            print(f">>> PIPELINE ERROR at {agent['name']}: {e}")
            output = f"[Agent failed: {str(e)[:100]}]"

        all_outputs[agent["name"]] = output
        if output:
            accumulated_context += f"\n\n=== {agent['name']} ===\n{output}"

        if len(accumulated_context) > 8000:
            accumulated_context = accumulated_context[-8000:]

        print(f">>> COMPLETED: {agent['name']}")

        # After Ideator, run the debate before Engineer picks an idea
        if agent["name"] == "Ideator":
            await asyncio.sleep(1)
            try:
                debate_output = await run_debate(mgr, user_input, accumulated_context)
                accumulated_context += f"\n\n=== Team Debate ===\n{debate_output}"
                if len(accumulated_context) > 8000:
                    accumulated_context = accumulated_context[-8000:]
            except Exception as e:
                print(f">>> DEBATE ERROR: {e}")
            await asyncio.sleep(1)

        if agent is not PIPELINE_AGENTS[-1]:
            await asyncio.sleep(2)

    await mgr.pipeline_complete("", all_outputs)
    print(">>> PIPELINE COMPLETE")


# ── Build Pack agents ──────────────────────────────────────────────────────────

SCAFFOLDER = {
    "name": "Scaffolder",
    "system_prompt": (
        "You are a hackathon scaffolding generator. Generate a minimal working starter codebase.\n\n"
        "Output EXACTLY three files using this format (no extra text before or after):\n\n"
        "--- FILE: main.py ---\n"
        "[FastAPI code here]\n\n"
        "--- FILE: static/index.html ---\n"
        "[HTML code here]\n\n"
        "--- FILE: requirements.txt ---\n"
        "[packages here]\n\n"
        "Rules:\n"
        "- main.py: FastAPI app, 2-3 routes, WebSocket if the idea needs real-time, placeholder AI call with TODO\n"
        "- index.html: Dark themed, clean layout, vanilla JS, no frameworks, matches the idea's UI\n"
        "- requirements.txt: max 6 packages\n"
        "- Keep each file SHORT — scaffold only, not a complete app\n"
        "- Add TODO comments where the main logic goes\n"
        "- Code must be syntactically valid"
    ),
}

README_WRITER = {
    "name": "README",
    "system_prompt": (
        "You are a technical writer. Generate a complete, impressive GitHub README.md.\n\n"
        "Output ONLY raw Markdown (no commentary, no explanation).\n\n"
        "Include exactly these sections:\n"
        "# [Project Name]\n"
        "> [one-line tagline]\n\n"
        "## Problem\n"
        "## Solution\n"
        "## Features\n"
        "(4-6 bullet points with emoji)\n\n"
        "## Tech Stack\n"
        "(markdown table: Layer | Technology)\n\n"
        "## Quick Start\n"
        "(bash code block, 5 commands max)\n\n"
        "## How It Works\n"
        "(2-3 sentences)\n\n"
        "## Built At [Hackathon]\n"
        "(1 sentence)\n\n"
        "Keep it sharp and professional. Max 350 words."
    ),
}

SLIDE_WRITER = {
    "name": "Slides",
    "system_prompt": (
        "You are a pitch coach. Write a 6-slide presentation script for a hackathon demo.\n\n"
        "Format exactly:\n\n"
        "SLIDE 1 — TITLE\n"
        "[Project name + one-line tagline]\n\n"
        "SLIDE 2 — THE PROBLEM\n"
        "[Start with a stat or fact. 3 bullet points.]\n\n"
        "SLIDE 3 — OUR SOLUTION\n"
        "[What it does. How it works. 2-3 sentences.]\n\n"
        "SLIDE 4 — LIVE DEMO\n"
        "[Exactly what to show, what to click, what will impress judges most.]\n\n"
        "SLIDE 5 — TECH & BUILD\n"
        "[Stack in one line. 1-2 sentences on architecture.]\n\n"
        "SLIDE 6 — WHY WE WIN\n"
        "[Bold claim. 2 supporting points. Close strong.]\n\n"
        "Each slide: max 40 words. Sharp. Confident. No filler."
    ),
}

BUILDPACK_AGENTS = [SCAFFOLDER, README_WRITER, SLIDE_WRITER]

BUILDPACK_STATUS = {
    "Scaffolder": "Scaffolder is writing starter code...",
    "README":     "README Writer is drafting documentation...",
    "Slides":     "Slide Writer is building the pitch deck...",
}


async def run_buildpack_pipeline(theme: str, prior_context: str, mgr: WSManager):
    await mgr.pipeline_status("Generating Build Pack...")

    all_outputs = {}
    user_input = f"Hackathon theme: {theme}\n\nProject context:\n{prior_context[-6000:]}"

    print(f">>> BUILDPACK: running {len(BUILDPACK_AGENTS)} agents")

    for agent in BUILDPACK_AGENTS:
        await mgr.phase_update(agent["name"])
        await mgr.pipeline_status(BUILDPACK_STATUS[agent["name"]])

        try:
            output = await run_agent(mgr, agent, user_input, context="")
        except Exception as e:
            print(f">>> BUILDPACK ERROR at {agent['name']}: {e}")
            output = f"[Agent failed: {str(e)[:100]}]"

        all_outputs[agent["name"]] = output
        print(f">>> BUILDPACK COMPLETED: {agent['name']}")

        if agent is not BUILDPACK_AGENTS[-1]:
            await asyncio.sleep(2)

    await mgr.send({"type": "buildpack_complete", "outputs": all_outputs})
    print(">>> BUILDPACK COMPLETE")
