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

/* =========================================================
   MPD HOME INTEGRATION
   =========================================================
   The existing app state/functions are declared in script.js, which is
   loaded before this file in index.html. Classic scripts share the same
   global lexical environment, so we intentionally use those existing
   bindings directly instead of duplicating Firebase state.
   ========================================================= */
(function () {
  'use strict';

  const dailyMessages = [
    'Semangat jaga pola makan hari ini!',
    'Pelan-pelan, yang penting konsisten.',
    'Satu pilihan sehat tetap berarti.',
    'Tidak harus sempurna, cukup konsisten.',
    'Hari ini, pilih yang baik untuk tubuh Anda.',
    'Rawat tubuh Anda, satu kebiasaan kecil setiap hari.',
    'Langkah kecil tetap membawa perubahan.',
    'Makan dengan lebih sadar hari ini.',
    'Tubuh Anda layak dirawat dengan baik.',
    'Tetap tenang, tetap konsisten.',
    'Jaga pola makan, jaga kesehatan.',
    'Kebiasaan baik dimulai dari pilihan kecil.',
    'Hari ini juga bisa jadi hari yang lebih sehat.',
    'Dengarkan tubuh Anda, rawat dengan baik.',
    'Tetap jaga diri, tetap jaga pola makan.'
  ];

  function setDailyMessage() {
    const messageElement = document.querySelector('.top-header p');
    if (!messageElement || !dailyMessages.length) return;

    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((today - startOfYear) / 86400000);
    const messageIndex = dayOfYear % dailyMessages.length;

    messageElement.textContent = dailyMessages[messageIndex];
  }

  function setSummaryValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Preserve the existing unit <span> by changing only the leading text node.
    const firstTextNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE
    );

    if (firstTextNode) {
      firstTextNode.nodeValue = String(value);
    } else {
      element.insertBefore(
        document.createTextNode(String(value)),
        element.firstChild
      );
    }
  }

  function clearSummaryValue(elementId) {
    setSummaryValue(elementId, '—');
  }

  function updateStreakUI(state) {
    const element = document.getElementById('streak-count');
    if (!element) return;
    element.textContent = String(state && Number.isInteger(state.count) ? state.count : 0);
  }

  function updateBloodSugarSummary() {
    const dateElement = document.getElementById('summary-blood-sugar-date');
    const subElement = document.getElementById('summary-blood-sugar-sub');
    const records = Array.isArray(bloodSugarRecords) ? bloodSugarRecords : [];

    if (!records.length) {
      if (dateElement) dateElement.textContent = 'Belum ada catatan';
      clearSummaryValue('summary-blood-sugar-value');
      if (subElement) subElement.textContent = 'Belum ada catatan';
      return;
    }

    const latest = records[0];
    if (dateElement) dateElement.textContent = formatDate(latest.recorded_at);
    setSummaryValue(
      'summary-blood-sugar-value',
      latest.blood_sugar == null ? '—' : latest.blood_sugar
    );

    // Medical thresholds are intentionally not hardcoded until confirmed.
    if (subElement) subElement.textContent = 'Terakhir dicatat';
  }

  function updateWeightSummary() {
    const dateElement = document.getElementById('summary-weight-date');
    const subElement = document.getElementById('summary-weight-sub');
    const records = Array.isArray(weightRecords) ? weightRecords : [];

    if (!records.length) {
      if (dateElement) dateElement.textContent = 'Belum ada catatan';
      clearSummaryValue('summary-weight-value');
      if (subElement) subElement.textContent = 'Belum ada catatan';
      return;
    }

    const latest = records[0];
    const latestDate = getRecordDate(latest.recorded_at);

    if (dateElement) dateElement.textContent = formatDate(latest.recorded_at);
    setSummaryValue(
      'summary-weight-value',
      latest.weight == null ? '—' : latest.weight
    );

    if (!subElement) return;

    if (!latestDate) {
      subElement.textContent = '';
      return;
    }

    const targetDate = new Date(latestDate);
    targetDate.setDate(targetDate.getDate() - 7);

    let comparison = null;
    let smallestDistance = Infinity;

    records.slice(1).forEach((record) => {
      const recordDate = getRecordDate(record.recorded_at);
      if (!recordDate || recordDate >= latestDate) return;

      const distance = Math.abs(recordDate.getTime() - targetDate.getTime());
      if (distance <= 7 * 86400000 && distance < smallestDistance) {
        smallestDistance = distance;
        comparison = record;
      }
    });

    if (!comparison) {
      subElement.textContent = records.length === 1 ? 'Data pertama' : '';
      return;
    }

    const latestValue = Number(latest.weight);
    const previousValue = Number(comparison.weight);

    if (!Number.isFinite(latestValue) || !Number.isFinite(previousValue)) {
      subElement.textContent = '';
      return;
    }

    const difference = latestValue - previousValue;
    const amount = Math.abs(difference);

    if (difference > 0) {
      subElement.textContent = `↑ ${formatNumber(amount)} kg minggu ini`;
    } else if (difference < 0) {
      subElement.textContent = `↓ ${formatNumber(amount)} kg minggu ini`;
    } else {
      subElement.textContent = '→ 0 kg minggu ini';
    }
  }

  function updateHomeSummary() {
    updateBloodSugarSummary();
    updateWeightSummary();
  }

  function installLoadHooks() {
    if (typeof loadBloodSugarRecords === 'function' && !window.__mpdBloodSugarSummaryHooked) {
      const original = loadBloodSugarRecords;
      window.loadBloodSugarRecords = async function () {
        await original.apply(this, arguments);
        updateHomeSummary();
      };
      window.__mpdBloodSugarSummaryHooked = true;
    }

    if (typeof loadWeightRecords === 'function' && !window.__mpdWeightSummaryHooked) {
      const original = loadWeightRecords;
      window.loadWeightRecords = async function () {
        await original.apply(this, arguments);
        updateHomeSummary();
      };
      window.__mpdWeightSummaryHooked = true;
    }
  }

  function initializeHomeIntegration() {
    installLoadHooks();
    setDailyMessage();

    updateStreakUI(StreakEngine.load());

    firebaseAuth.onAuthStateChanged(async (user) => {
      if (!user) {
        updateStreakUI({ count: 0 });
        return;
      }

      const state = StreakEngine.recordActivity();
      updateStreakUI(state);

      // The main auth listener in script.js also loads these arrays. Awaiting
      // the existing loaders here guarantees the summary reflects the latest records.
      try {
        await loadBloodSugarRecords();
        await loadWeightRecords();
      } catch (error) {
        console.error('Home summary load error:', error);
      }

      updateHomeSummary();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHomeIntegration, { once: true });
  } else {
    initializeHomeIntegration();
  }
})();

/* =========================================================
   MINOR HOME UI OVERRIDE
   =========================================================
   Keep the summary-card dates consistent with the teal unit text
   (mg/dL / kg), without changing the main stylesheet.
   ========================================================= */
(function () {
  const style = document.createElement('style');
  style.textContent = '.summary-card-date { color: #2B7A78; }';
  document.head.appendChild(style);
})();
