import uvicorn
import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.main import app

if __name__ == "__main__":
    print("Starting Predictive Maintenance Agent...")
    port = int(os.environ.get("PORT", "8000"))
    reload_enabled = os.environ.get("RELOAD", "true").lower() in {"1", "true", "yes"}
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=reload_enabled)
