// ButtonsFive.ino
// Five buttons on D2..D6 using internal pull-ups.
// Pressed = LOW; idle = HIGH. Debounced edge-detect prints one command per press.

struct Button {
  uint8_t pin;
  const char* command;
  bool stableState;        // debounced current state (true=HIGH, false=LOW)
  bool lastStableState;    // previous debounced state
  unsigned long lastChangeMs; // last time we saw a raw change
  bool lastRaw;            // last raw (immediate) read
};

constexpr uint8_t BTN_COUNT = 5;
constexpr unsigned long DEBOUNCE_MS = 25; // good starting point for typical kits

Button buttons[BTN_COUNT] = {
  {2, "capture", true, true, 0, true},
  {3, "play",    true, true, 0, true},
  {4, "undo",    true, true, 0, true},
  {5, "reset",   true, true, 0, true},
  {6, "save",    true, true, 0, true}
};

void setup() {
  Serial.begin(115200);
  // Set pins as INPUT_PULLUP and initialize states
  for (uint8_t i = 0; i < BTN_COUNT; ++i) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    bool raw = digitalRead(buttons[i].pin); // HIGH (idle) due to pull-up
    buttons[i].lastRaw = raw;
    buttons[i].stableState = raw;
    buttons[i].lastStableState = raw;
    buttons[i].lastChangeMs = millis();
  }

  // Serial.println(F("Five-button controller ready. Press buttons to print commands."));
}

void loop() {
  unsigned long now = millis();
  for (uint8_t i = 0; i < BTN_COUNT; ++i) {
    Button &b = buttons[i];
    bool raw = digitalRead(b.pin);

    if (raw != b.lastRaw) {
      // Raw change detected; reset debounce timer
      b.lastChangeMs = now;
      b.lastRaw = raw;
    }

    // If raw state has been stable long enough, accept it as debounced
    if ((now - b.lastChangeMs) >= DEBOUNCE_MS && raw != b.stableState) {
      b.lastStableState = b.stableState;
      b.stableState = raw;

      // We want a "press" event: transition from HIGH (idle) -> LOW (pressed)
      // Remember: INPUT_PULLUP -> LOW means pressed.
      if (b.lastStableState == HIGH && b.stableState == LOW) {
        Serial.println(b.command);
      }
      // If you also want a release event, check LOW->HIGH here.
    }
  }
}
