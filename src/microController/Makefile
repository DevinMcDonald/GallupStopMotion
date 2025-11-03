# Makefile using arduino-cli (no IDE or arduino-mk required)

# Adjust if you target a different board
FQBN := arduino:avr:uno
CORE := arduino:avr

# Auto-detect a likely serial port on macOS/Linux
PORT ?= $(shell arduino-cli board list | awk '/usbmodem|usbserial|ttyACM/ {print $$1; exit}')

# The sketch is the current directory (Arduino CLI uses the folder as the sketch)
SKETCH := $(CURDIR)

# Default baud rate for Serial Monitor (matches Serial.begin in your sketch)
BAUD ?= 115200

.PHONY: compile setup detect  upload monitor run clean

compile:
	@clear
	arduino-cli compile --fqbn $(FQBN) $(SKETCH)

setup:
	arduino-cli core install $(CORE)

detect:
	@arduino-cli board list

upload: compile
ifndef PORT
	$(error Could not auto-detect a serial PORT. Run `make detect` and pass PORT=/dev/tty.usbmodemXXXX)
endif
	arduino-cli upload -p $(PORT) --fqbn $(FQBN) $(SKETCH)

monitor:
ifndef PORT
	$(error Could not auto-detect a serial PORT. Run `make detect` and pass PORT=/dev/tty.usbmodemXXXX)
endif
	arduino-cli monitor -p $(PORT) -b $(FQBN) --config baudrate=$(BAUD)

# Convenience: build + upload + monitor
run: upload
	$(MAKE) monitor PORT=$(PORT) BAUD=$(BAUD)

clean:
	@# Arduino CLI writes to ./build by default for local sketches
	rm -rf build
