# Adjust if your device name changes:
MAC_SERIAL_DEVICE = /dev/tty.usbmodem1201
BACKEND_URL = http://localhost:8000
SERIAL_BAUD = 115200
BROWSER_URL ?= http://localhost:5173
LINUX_ENV_DEV ?= .env.linux.dev
LINUX_ENV_PROD ?= .env.linux.prod

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
	@echo "Starting backend + frontend in docker..."
	docker compose up --build -d
	@sleep 2
	@$(MAKE) --no-print-directory open-browser

# Start backend + frontend + local button monitor (with venv)
mac:
	@echo "Starting backend + frontend in docker..."
	docker compose up --build -d
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

# Real deployment on Linux
linux:
	@echo "Starting Linux deployment with direct serial mapping..."
	COMPOSE_PROFILES="linux,mcu" docker compose up --build

# Detached dev stack on Linux (with MCU profile) using an env file override
linux-dev:
	@if [ ! -f "$(LINUX_ENV_DEV)" ]; then \
		echo "Missing $(LINUX_ENV_DEV). Create it with your production-like settings (e.g., R2 keys, tokens)."; \
		exit 1; \
	fi
	@echo "Starting Linux dev stack with profiles: linux,mcu"
	COMPOSE_PROFILES="linux,mcu" docker compose --env-file $(LINUX_ENV_DEV) up --build -d

# Detached production stack on Linux (no MCU profile by default) using an env file override
linux-prod:
	@if [ ! -f "$(LINUX_ENV_PROD)" ]; then \
		echo "Missing $(LINUX_ENV_PROD). Create it with your production secrets (e.g., R2 keys, tokens)."; \
		exit 1; \
	fi
	@echo "Starting Linux production stack with profiles: linux"
	COMPOSE_PROFILES="linux" docker compose --env-file $(LINUX_ENV_PROD) up --build -d
