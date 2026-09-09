/*
 * Shared MPD streak engine.
 * Rules:
 * - First active day = 1
 * - Consecutive active day = +1
 * - Repeated activity on the same day = no change
 * - A gap of one or more calendar days resets the streak to 1
 * - Login itself counts as activity
 *
 * The engine stores only the current streak count and the last active date.
 * The date is stored as YYYY-MM-DD in the user's local timezone.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'mpd_streak';

  function localDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return null;
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function calendarDayDifference(fromKey, toKey) {
    const from = parseDateKey(fromKey);
    const to = parseDateKey(toKey);
    if (!from || !to) return null;

    const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((toUtc - fromUtc) / 86400000);
  }

  function read() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { count: 0, lastActiveDate: null };

      const parsed = JSON.parse(raw);
      const count = Number.isInteger(parsed.count) && parsed.count > 0 ? parsed.count : 0;
      const lastActiveDate = typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : null;
      return { count, lastActiveDate };
    } catch (error) {
      return { count: 0, lastActiveDate: null };
    }
  }

  function write(state) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  function recordActivity(date) {
    const today = localDateKey(date || new Date());
    const current = read();

    if (!current.lastActiveDate || current.count < 1) {
      return write({ count: 1, lastActiveDate: today });
    }

    const difference = calendarDayDifference(current.lastActiveDate, today);

    // Same calendar day: repeated login/activity does not increase streak.
    if (difference === 0) {
      return current;
    }

    // Exactly the next calendar day: continue the streak.
    if (difference === 1) {
      return write({ count: current.count + 1, lastActiveDate: today });
    }

    // Any gap (including a clock/date anomaly) starts a new streak.
    return write({ count: 1, lastActiveDate: today });
  }

  function reset() {
    global.localStorage.removeItem(STORAGE_KEY);
  }

  function getState() {
    return read();
  }

  global.StreakEngine = {
    load: getState,
    recordActivity,
    reset,
    localDateKey,
    calendarDayDifference
  };
})(window);
