const test = require("node:test");
const assert = require("node:assert/strict");

const CalendarReminderScheduler = require("../../src/helpers/calendarReminderScheduler.js");

function activeEvent(provider, id) {
  const now = Date.now();
  return {
    id,
    provider,
    summary: `${provider} meeting`,
    start_time: new Date(now - 1000).toISOString(),
    end_time: new Date(now + 60_000).toISOString(),
    attendees_count: 2,
    attendees: JSON.stringify([
      { email: "me@example.com", self: true },
      { email: "them@example.com", self: false },
    ]),
  };
}

test("resetting one provider preserves reminders delivered by another provider", () => {
  const googleEvent = activeEvent("google", "meeting-1");
  const databaseManager = {
    getUpcomingEvents: () => [googleEvent],
    getActiveEvents: () => [googleEvent],
  };
  const scheduler = new CalendarReminderScheduler(databaseManager);
  let promptCount = 0;
  scheduler.meetingDetectionEngine = {
    handleCalendarReminder: () => {
      promptCount += 1;
    },
  };

  scheduler.scheduleNextMeeting();
  scheduler.reset("apple");
  scheduler.scheduleNextMeeting();

  assert.equal(promptCount, 1);
  assert.equal(scheduler.activeMeeting, googleEvent);
  scheduler.stop();
});

test("resetting a provider lets that provider's remaining event be re-armed", () => {
  const appleEvent = activeEvent("apple", "meeting-1");
  const databaseManager = {
    getUpcomingEvents: () => [appleEvent],
    getActiveEvents: () => [appleEvent],
  };
  const scheduler = new CalendarReminderScheduler(databaseManager);
  let promptCount = 0;
  scheduler.meetingDetectionEngine = {
    handleCalendarReminder: () => {
      promptCount += 1;
    },
  };

  scheduler.scheduleNextMeeting();
  scheduler.reset("apple");
  scheduler.scheduleNextMeeting();

  assert.equal(promptCount, 2);
  scheduler.stop();
});

test("solo holds without attendees or a link never fire reminders", () => {
  const hold = {
    ...activeEvent("google", "hold-1"),
    summary: "Hold",
    attendees_count: 0,
    attendees: null,
    hangout_link: null,
    conference_data: null,
  };
  const realMeeting = activeEvent("google", "meeting-1");
  const databaseManager = {
    getUpcomingEvents: () => [hold, realMeeting],
    getActiveEvents: () => [hold, realMeeting],
  };
  const scheduler = new CalendarReminderScheduler(databaseManager);
  const prompted = [];
  scheduler.meetingDetectionEngine = {
    handleCalendarReminder: (event) => {
      prompted.push(event.id);
    },
  };

  scheduler.scheduleNextMeeting();

  assert.deepEqual(prompted, ["meeting-1"], "the hold must be skipped, not the meeting");
  scheduler.stop();
});

test("waking from sleep does not prompt for an active solo hold", () => {
  const hold = {
    ...activeEvent("google", "hold-1"),
    attendees_count: 0,
    attendees: null,
  };
  const databaseManager = {
    getUpcomingEvents: () => [hold],
    getActiveEvents: () => [hold],
  };
  const scheduler = new CalendarReminderScheduler(databaseManager);
  let promptCount = 0;
  scheduler.meetingDetectionEngine = {
    handleCalendarReminder: () => {
      promptCount += 1;
    },
  };

  scheduler.onWakeFromSleep();

  assert.equal(promptCount, 0);
  scheduler.stop();
});

test("reconciling a provider clears an active event removed by a snapshot", () => {
  const appleEvent = activeEvent("apple", "meeting-1");
  let activeEvents = [appleEvent];
  const databaseManager = {
    getUpcomingEvents: () => activeEvents,
    getActiveEvents: () => activeEvents,
  };
  const scheduler = new CalendarReminderScheduler(databaseManager);
  let promptCount = 0;
  scheduler.meetingDetectionEngine = {
    handleCalendarReminder: () => {
      promptCount += 1;
    },
  };

  scheduler.scheduleNextMeeting();
  activeEvents = [];
  scheduler.reconcileProvider("apple");

  assert.equal(promptCount, 1);
  assert.equal(scheduler.activeMeeting, null);

  activeEvents = [appleEvent];
  scheduler.scheduleNextMeeting();
  assert.equal(promptCount, 1, "a periodic snapshot must not re-fire an old reminder");
  scheduler.stop();
});
