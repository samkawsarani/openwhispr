const test = require("node:test");
const assert = require("node:assert/strict");

const AudioActivityDetector = require("../../src/helpers/audioActivityDetector.js");

const SUSTAINED_EVENT_DRIVEN_MS = 2 * 1000;
const REEVAL_SUSTAINED_MS = 5 * 1000;
const COOLDOWN_MS = 5 * 60 * 1000;

// Puts the detector in event-driven mode without spawning a native listener,
// so tests can drive _onMicStateChanged directly.
function eventDrivenDetector() {
  const detector = new AudioActivityDetector();
  detector._running = true;
  detector._eventDriven = true;
  const emitted = [];
  detector.on("sustained-audio-detected", (data) => emitted.push(data));
  return { detector, emitted };
}

test("mic activity emits after the sustained window (event-driven baseline)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { detector, emitted } = eventDrivenDetector();

  detector._onMicStateChanged(true);
  t.mock.timers.tick(SUSTAINED_EVENT_DRIVEN_MS);

  assert.equal(emitted.length, 1);
  detector.stop();
});

test("a call started during dictation is detected once recording ends", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { detector, emitted } = eventDrivenDetector();

  detector.setUserRecording(true);
  detector._onMicStateChanged(true);
  t.mock.timers.tick(10_000);
  assert.equal(emitted.length, 0, "no prompt while the user is recording");

  detector.setUserRecording(false);
  t.mock.timers.tick(REEVAL_SUSTAINED_MS);

  assert.equal(emitted.length, 1, "gated mic activity must be re-evaluated");
  detector.stop();
});

test("own-mic tail after dictation does not cause a false prompt", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { detector, emitted } = eventDrivenDetector();

  detector.setUserRecording(true);
  detector._onMicStateChanged(true);
  detector.setUserRecording(false);
  // Our own mic releases shortly after the recording stops.
  t.mock.timers.tick(1000);
  detector._onMicStateChanged(false);
  t.mock.timers.tick(REEVAL_SUSTAINED_MS + 1000);

  assert.equal(emitted.length, 0);
  detector.stop();
});

test("a call started during the dismissal cooldown is detected once it expires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { detector, emitted } = eventDrivenDetector();

  detector.dismiss();
  t.mock.timers.tick(60_000);
  detector._onMicStateChanged(true);
  t.mock.timers.tick(30_000);
  assert.equal(emitted.length, 0, "no prompt during cooldown");

  // Two ticks: the first fires the cooldown re-evaluation (which schedules the
  // sustained window), the second fires the sustained window itself.
  t.mock.timers.tick(COOLDOWN_MS);
  t.mock.timers.tick(REEVAL_SUSTAINED_MS + 1000);
  assert.equal(emitted.length, 1, "the ongoing call must be detected after cooldown");
  detector.stop();
});

test("a dismissed call is not re-prompted when no new mic event fires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { detector, emitted } = eventDrivenDetector();

  detector._onMicStateChanged(true);
  t.mock.timers.tick(SUSTAINED_EVENT_DRIVEN_MS);
  assert.equal(emitted.length, 1);

  detector.dismiss();
  t.mock.timers.tick(COOLDOWN_MS + REEVAL_SUSTAINED_MS + 60_000);

  assert.equal(emitted.length, 1, "dismissing a call silences it for good");
  detector.stop();
});

test("mic released during cooldown cancels the pending re-evaluation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const { detector, emitted } = eventDrivenDetector();

  detector.dismiss();
  detector._onMicStateChanged(true);
  t.mock.timers.tick(30_000);
  detector._onMicStateChanged(false);
  t.mock.timers.tick(COOLDOWN_MS + REEVAL_SUSTAINED_MS);

  assert.equal(emitted.length, 0);
  detector.stop();
});
