# Adjust if your device name changes:
MAC_SERIAL_DEVICE = /dev/tty.usbmodem1201
BACKEND_URL = http://localhost:8000
SERIAL_BAUD = 115200
BROWSER_URL ?= http://localhost:5173

VENV = venv
PYTHON = $(VENV)/bin/python3

# Prefer a Chrome/Chromium/Arc/Firefox kiosk-style launch; fall back to open/xdg-open.
BROWSER_CMD ?= $(shell \
	if command -v google-chrome >/dev/null 2>&1; then \
		echo "google-chrome --start-fullscreen --app=$(BROWSER_URL)"; \
	elif command -v chromium-browser >/dev/null 2>&1; then \
		echo "chromium-browser --start-fullscreen --app=$(BROWSER_URL)"; \
	elif command -v chromium >/dev/null 2>&1; then \
		echo "chromium --start-fullscreen --app=$(BROWSER_URL)"; \
	elif command -v firefox >/dev/null 2>&1; then \
		echo "firefox --kiosk $(BROWSER_URL)"; \
	elif command -v open >/dev/null 2>&1; then \
		if [ -x "/Applications/Safari.app/Contents/MacOS/Safari" ]; then \
			echo "open -a \"Safari\" $(BROWSER_URL)"; \
		elif [ -x \"/Applications/Arc.app/Contents/MacOS/Arc\" ]; then \
			echo "open -a \"Arc\" --args --start-fullscreen $(BROWSER_URL)"; \
		else \
			echo "open -a \"Google Chrome\" --args --start-fullscreen $(BROWSER_URL)"; \
		fi; \
	elif command -v xdg-open >/dev/null 2>&1; then \
		echo "xdg-open $(BROWSER_URL)"; \
	fi \
)

open-browser:
	@if [ -n "$(BROWSER_CMD)" ]; then \
		echo "🌐 Opening browser: $(BROWSER_CMD)"; \
		eval $(BROWSER_CMD) >/dev/null 2>&1 & \
	else \
		echo "No browser opener found (tried chrome/chromium/open/xdg-open)"; \
	fi

# Start backend + frontend normally in Docker
dev:
	@echo "Starting dev stack (frontend=dev)..."
	FRONTEND_MODE=dev NODE_ENV=development docker compose up --build -d
	@echo "Waiting for backend service to come up..."
	sleep 3
	@$(MAKE) --no-print-directory open-browser
	@if [ ! -d "$(VENV)" ]; then \
	    echo "❗ No virtual environment found at $(VENV)"; \
	    echo "Run this first:"; \
	    echo "  python3 -m venv $(VENV)"; \
	    echo "  $(VENV)/bin/pip install -r backend/requirements.txt"; \
	    exit 1; \
	fi
	@echo "✅ Activating virtual environment: $(VENV)"
	@echo "🔌 Starting LOCAL button monitor on $(MAC_SERIAL_DEVICE)"
	@BACKEND_URL=$(BACKEND_URL) \
	 SERIAL_PORT=$(MAC_SERIAL_DEVICE) \
	 SERIAL_BAUD=$(SERIAL_BAUD) \
	 /bin/bash -c "source $(VENV)/bin/activate && python3 -u backend/button_forwarder.py"
	@$(MAKE) --no-print-directory open-browser

prod:
	@echo "Starting prod stack (frontend=prod)..."
	FRONTEND_MODE=prod NODE_ENV=production docker compose up --build -d
	@echo "Waiting for backend service to come up..."
	sleep 3
	@$(MAKE) --no-print-directory open-browser
	@if [ ! -d "$(VENV)" ]; then \
	    echo "❗ No virtual environment found at $(VENV)"; \
	    echo "Run this first:"; \
	    echo "  python3 -m venv $(VENV)"; \
	    echo "  $(VENV)/bin/pip install -r backend/requirements.txt"; \
	    exit 1; \
	fi
	@echo "✅ Activating virtual environment: $(VENV)"
	@echo "🔌 Starting LOCAL button monitor on $(MAC_SERIAL_DEVICE)"
	@BACKEND_URL=$(BACKEND_URL) \
	 SERIAL_PORT=$(MAC_SERIAL_DEVICE) \
	 SERIAL_BAUD=$(SERIAL_BAUD) \
	 /bin/bash -c "source $(VENV)/bin/activate && python3 -u backend/button_forwarder.py"
	@$(MAKE) --no-print-directory open-browser

stop:
	@echo "Stopping containers..."
	docker compose down

test:
	@echo "Running backend tests..."
	@if [ ! -d "$(VENV)" ]; then \
	    echo "Creating virtualenv at $(VENV)"; \
	    python3 -m venv $(VENV); \
	fi
	@$(VENV)/bin/pip install -q -r backend/requirements.txt
	cd backend && ../$(PYTHON) -m pytest ../tests/backend
	@echo "Running frontend tests..."
	cd frontend && npm run test
