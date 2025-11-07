# Adjust if your device name changes:
MAC_SERIAL_DEVICE = /dev/tty.usbmodem1201
BACKEND_URL = http://localhost:8000
SERIAL_BAUD = 115200

VENV = venv
PYTHON = $(VENV)/bin/python3

# Start backend + frontend normally in Docker
dev:
	@echo "Starting backend + frontend in docker..."
	docker compose up --build

# Start backend + frontend + local button monitor (with venv)
mac:
	@echo "Starting backend + frontend in docker..."
	docker compose up --build &

	@echo "Waiting for backend service to come up..."
	sleep 3

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

stop:
	@echo "Stopping containers..."
	docker compose down

# Real deployment on Linux
linux:
	@echo "Starting Linux deployment with direct serial mapping..."
	COMPOSE_PROFILES="linux,mcu" docker compose up --build
