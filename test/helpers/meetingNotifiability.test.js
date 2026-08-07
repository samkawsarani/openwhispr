const test = require("node:test");
const assert = require("node:assert/strict");

const { isNotifiableMeetingEvent } = require("../../src/helpers/meetingNotifiability.js");

test("solo hold with no attendees and no link is not notifiable", () => {
  assert.equal(
    isNotifiableMeetingEvent({
      summary: "Hold",
      attendees_count: 0,
      attendees: null,
      hangout_link: null,
      conference_data: null,
    }),
    false
  );
});

test("event whose only attendee is self is not notifiable", () => {
  assert.equal(
    isNotifiableMeetingEvent({
      summary: "Focus time",
      attendees_count: 1,
      attendees: JSON.stringify([{ email: "me@example.com", self: true }]),
    }),
    false
  );
});

test("event with a non-self attendee is notifiable", () => {
  assert.equal(
    isNotifiableMeetingEvent({
      attendees_count: 2,
      attendees: JSON.stringify([
        { email: "me@example.com", self: true },
        { email: "them@example.com", self: false },
      ]),
    }),
    true
  );
});

test("solo event with a hangout link is notifiable", () => {
  assert.equal(
    isNotifiableMeetingEvent({
      attendees_count: 0,
      attendees: null,
      hangout_link: "https://meet.google.com/abc-defg-hij",
    }),
    true
  );
});

test("solo event with a video conference entry point is notifiable", () => {
  assert.equal(
    isNotifiableMeetingEvent({
      attendees_count: 0,
      conference_data: JSON.stringify({
        entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/123" }],
      }),
    }),
    true
  );
});

test("phone-only conference data does not make an event notifiable", () => {
  assert.equal(
    isNotifiableMeetingEvent({
      attendees_count: 0,
      conference_data: JSON.stringify({
        entryPoints: [{ entryPointType: "phone", uri: "tel:+15551234567" }],
      }),
    }),
    false
  );
});

test("falls back to attendees_count when attendee detail is missing", () => {
  assert.equal(isNotifiableMeetingEvent({ attendees_count: 2, attendees: null }), true);
  assert.equal(isNotifiableMeetingEvent({ attendees_count: 1, attendees: null }), false);
});

test("malformed attendees JSON falls back to attendees_count", () => {
  assert.equal(isNotifiableMeetingEvent({ attendees_count: 3, attendees: "not-json" }), true);
});

test("null event is not notifiable", () => {
  assert.equal(isNotifiableMeetingEvent(null), false);
});
