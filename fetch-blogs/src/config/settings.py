import os
from pathlib import Path
from dotenv import load_dotenv

# Find .env.local in the parent directories
parent_env = Path(__file__).resolve().parents[3] / ".env.local"
local_env = Path(__file__).resolve().parents[2] / ".env"

if parent_env.exists():
    load_dotenv(parent_env)
elif local_env.exists():
    load_dotenv(local_env)
else:
    load_dotenv()  # Fallback to system env or local directory .env

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
PORT = int(os.getenv("PORT", "8000"))
