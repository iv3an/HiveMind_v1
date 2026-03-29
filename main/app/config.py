import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MODEL = "gemini-2.5-flash"
MAX_TOKENS = 2500
TEMPERATURE = 0.7
UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
MAX_PDFS = 6
MAX_FILE_SIZE_MB = 50
