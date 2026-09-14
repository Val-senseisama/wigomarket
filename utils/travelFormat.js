/**
 * Human-readable travel distances and durations, shared by the Mapbox service
 * and anything that derives its own figures (e.g. a multi-leg ETA) so every
 * `*Text` field the client renders reads the same way.
 */

/**
 * Format a distance in metres the way Google's Distance Matrix used to,
 * so downstream consumers rendering `distanceText` keep working unchanged.
 */
function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format a duration in seconds as "1 hour 5 mins" / "12 mins".
 */
function formatDuration(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min${totalMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  if (minutes === 0) return hourPart;
  return `${hourPart} ${minutes} min${minutes === 1 ? "" : "s"}`;
}

module.exports = { formatDistance, formatDuration };
