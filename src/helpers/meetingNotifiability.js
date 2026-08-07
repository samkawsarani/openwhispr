// Decides whether a calendar event is worth a meeting reminder. Solo blocks
// ("hold", focus time, reminders-to-self) have no other attendees and no
// conference link — prompting to record those is noise.

function hasConferenceLink(event) {
  if (event.hangout_link) return true;
  if (!event.conference_data) return false;
  try {
    const data = JSON.parse(event.conference_data);
    return Boolean(data?.entryPoints?.some((ep) => ep.entryPointType === "video"));
  } catch {
    return false;
  }
}

function isNotifiableMeetingEvent(event) {
  if (!event) return false;
  if (hasConferenceLink(event)) return true;

  if (event.attendees) {
    try {
      const attendees = JSON.parse(event.attendees);
      if (Array.isArray(attendees)) {
        return attendees.some((a) => a && !a.self);
      }
    } catch {
      // fall through to attendees_count
    }
  }

  // No attendee detail — more than one attendee implies someone besides self.
  return (event.attendees_count || 0) > 1;
}

module.exports = { isNotifiableMeetingEvent };
