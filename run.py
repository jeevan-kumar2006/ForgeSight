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
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
