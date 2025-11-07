FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates xz-utils udev coreutils bash \
 && rm -rf /var/lib/apt/lists/*

# Install arduino-cli
RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | \
    BINDIR=/usr/local/bin sh && arduino-cli version

WORKDIR /workspace
COPY upload-if-present.sh /usr/local/bin/upload-if-present.sh
RUN chmod +x /usr/local/bin/upload-if-present.sh

# Optional global CLI config (improves first-run speed)
RUN mkdir -p /root/.arduino15 \
 && printf "board_manager:\n  additional_urls: []\n" > /root/.arduino15/arduino-cli.yaml

# Default command: opportunistically upload
CMD ["upload-if-present.sh"]
