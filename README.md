# ⓗ HiveMind

> Five AI agents. One winning hackathon idea.

[![Python](https://img.shields.io/badge/Python-3.11+-blue?style=flat-square&logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-green?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Gemini_2.5_Flash-orange?style=flat-square&logo=google)](https://aistudio.google.com)

---

## What is HiveMind?

HiveMind is a multi-agent AI system that uses deep research
, and pitches hackathon ideas in real time.

Type your hackathon theme. Five AI agents work in
sequence — each feeding context to the next — until
you have a battle-tested idea and a winning pitch.

---

## Features

- Real-time streaming — watch agents think live
- Sequential pipeline — each agent builds on the last
- Results page — full structured report + pitch
- Clean dark UI built for demos
- Powered by Google Gemini 

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + Python |
| Frontend | Vanilla HTML / CSS / JS |
| AI | Google Gemini 2.5 Flash |
| Realtime | WebSockets |

---

## Getting Started
```bash
# Clone the repo
git clone https://github.com/iv3an/hivemind.git
cd hivemind/main

# Install dependencies
pip install -r requirements.txt

# Add your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > .env

# Run
uvicorn app.main:app --reload --port 8000
```


## The Agents

| Agent | Job |
|-------|-----|
| 🔍 Researcher | Scans market, finds gaps, names real competitors |
| 💡 Ideator | Generates 3 ideas based only on validated gaps |
| ⚙️ Engineer | Picks most feasible idea, writes full build plan |
| 💀 Critic | Destroys weak ideas so only the strongest survive |
| 🎤 Presenter | Writes the pitch that wins the room |

---

## Built at HackUSF 2026 @ USF

*Because one AI agent is never enough.*
