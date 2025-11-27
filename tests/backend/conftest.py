import os
import sys
from pathlib import Path

# Ensure project root is on the path so "backend" imports resolve
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Optionally ensure env file in repo root is loaded by tests if needed
dotenv_path = ROOT / ".env"
if dotenv_path.exists():
    _ = os.environ.setdefault("DOTENV_PATH", str(dotenv_path))
