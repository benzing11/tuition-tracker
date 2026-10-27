/* ============================================================
   Tuition Tracker — app.js
   Attendance + Fees manager for admin. Offline, no login.
   Data persisted in localStorage.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Storage keys ---------- */
  const K_STUDENTS = 'tt_students_v1';
  const K_ATTENDANCE = 'tt_attendance_v1';
  const K_FEES = 'tt_fees_v1';

  /* ---------- Default seed data (only on first run) ---------- */
  const SEED_STUDENTS = [];

  /* Seed attendance for the past 2 weeks (Mon-Fri, AM/PM) */
  function seedAttendance(students) {
    const att = {};
    const today = new Date();
    // Go back 14 days
    for (let d = 14; d >= 0; d--) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      const dow = dt.getDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) continue; // skip weekends
      const iso = dt.getFullYear() + '-' +
        String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      att[iso] = {};
      students.forEach(s => {
        // ~85% present, ~10% absent, ~5% no-class
        const r = Math.random();
        let am, pm;
        if (r < 0.82) { am = 1; pm = 1; }
        else if (r < 0.92) { am = 2; pm = 1; }
        else if (r < 0.96) { am = 1; pm = 2; }
        else { am = 0; pm = 0; }
        att[iso][s.id] = { am, pm };
      });
    }
    return att;
  }

  /* Check if monthly fee reset should happen */
  function checkMonthlyReset() {
    const today = new Date();
    const currentMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const currentDay = today.getDate();
    if (appSettings.lastResetMonth !== currentMonth && currentDay >= appSettings.feeResetDay) {
      students.forEach(s => { s.feePaid = false; });
      appSettings.lastResetMonth = currentMonth;
      persistAll();
    }
  }

  /* ---------- Helpers ---------- */
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + '-' +
           String(dt.getMonth() + 1).padStart(2, '0') + '-' +
           String(dt.getDate()).padStart(2, '0');
  }

  function formatNice(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function formatShort(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function isToday(iso) { return iso === todayISO(); }

  /* ---------- State ---------- */
  let students = load(K_STUDENTS, null);
  if (!students || !Array.isArray(students)) {
    students = [];
    save(K_STUDENTS, students);
  }
  // Migrate: add new fields to existing students
  students.forEach(s => {
    if (!s.className) s.className = '';
    if (!s.school) s.school = '';
    if (!s.phone) s.phone = '';
    if (s.whatsapp === undefined) s.whatsapp = '';
  });

  let attendance = load(K_ATTENDANCE, {});
  let fees = load(K_FEES, {});
  // Global settings: feeResetDay (1-28), lastResetMonth (YYYY-MM)
  let appSettings = load('tt_settings_v1', { feeResetDay: 1, lastResetMonth: '' });
  if (!appSettings.feeResetDay) appSettings.feeResetDay = 1;
  if (!appSettings.lastResetMonth) appSettings.lastResetMonth = '';

  function persistAll() {
    save(K_STUDENTS, students);
    save(K_ATTENDANCE, attendance);
    save(K_FEES, fees);
    save('tt_settings_v1', appSettings);
  }

  /* ---------- Attendance record shape ----------
     attendance[dateISO] = { [studentId]: { am: 0|1|2, pm: 0|1|2 } }
     0 = no class (default), 1 = present, 2 = absent
  ------------------------------------------------ */
  function getDay(dateISO) {
    if (!attendance[dateISO]) attendance[dateISO] = {};
    return attendance[dateISO];
  }

  function setCell(dateISO, studentId, session, val) {
    const day = getDay(dateISO);
    if (!day[studentId]) day[studentId] = { am: 0, pm: 0 };
    day[studentId][session] = val;
    persistAll();
  }

  function cycleCell(dateISO, studentId, session) {
    const day = getDay(dateISO);
    if (!day[studentId]) day[studentId] = { am: 0, pm: 0 };
    const cur = day[studentId][session];
    // 0 (no class) -> 1 (present) -> 2 (absent) -> 0
    const next = (cur + 1) % 3;
    day[studentId][session] = next;
    persistAll();
    return next;
  }

  function columnState(dateISO, session) {
    const day = getDay(dateISO);
    if (students.length === 0) return 'mixed';
    let allPresent = true;
    let anyMarked = false;
    students.forEach(s => {
      const rec = day[s.id];
      const v = rec ? rec[session] : 0;
      if (v === 1) anyMarked = true;
      if (v !== 1) allPresent = false;
    });
    if (allPresent && anyMarked) return 'all-present';
    if (!anyMarked) return 'all-noclass';
    return 'mixed';
  }

  function toggleColumn(dateISO, session) {
    const st = columnState(dateISO, session);
    const day = getDay(dateISO);
    let next;
    if (st === 'all-present') next = 0;      // reclick -> all no class
    else next = 1;                            // otherwise -> all present
    students.forEach(s => {
      if (!day[s.id]) day[s.id] = { am: 0, pm: 0 };
      day[s.id][session] = next;
    });
    persistAll();
  }

  /* ---------- DOM refs ---------- */
  const $ = (sel) => document.querySelector(sel);

  const welcomeMsg = $('#welcome-msg');
  const welcomeDate = $('#welcome-date');
  const statTotal = $('#stat-total');
  const statPresent = $('#stat-present');
  const statAbsent = $('#stat-absent');
  const statFee = $('#stat-fee');

  const dateMain = $('#date-main');
  const dateSub = $('#date-sub');
  const datePicker = $('#date-picker');
  const atBody = $('#at-body');
  const colAm = $('.at-am');
  const colPm = $('.at-pm');

  /* ---------- Typewriter effect ---------- */
  const WELCOME_LINES = [
    'Welcome, Admin!',
    'Ready to teach?',
    'Good day, Admin!',
    'Attendance time!'
  ];

  function typewriter(el, text, speed, done) {
    let i = 0;
    el.innerHTML = '';
    const caret = document.createElement('span');
    caret.className = 'caret';
    el.appendChild(caret);
    function tick() {
      if (i < text.length) {
        const node = document.createTextNode(text.charAt(i));
        el.insertBefore(node, caret);
        i++;
        setTimeout(tick, speed);
      } else if (done) {
        done();
      }
    }
    tick();
  }

  let typeIdx = 0;
  function runWelcome() {
    const text = WELCOME_LINES[typeIdx % WELCOME_LINES.length];
    typewriter(welcomeMsg, text, 45, () => {
      setTimeout(() => {
        typeIdx++;
        runWelcome();
      }, 2600);
    });
  }

  /* ---------- Tab navigation ---------- */
  let currentTab = 'tab-home';
  const pages = document.querySelectorAll('.tab-page');
  const navItems = document.querySelectorAll('.nav-item');

  function performNavigation(tabId) {
    if (tabId === currentTab) return;

    const from = document.getElementById(currentTab);
    const to = document.getElementById(tabId);

    // Direction for slide animation
    const order = ['tab-home', 'tab-attendance', 'tab-students', 'tab-fees'];
    const fromIdx = order.indexOf(currentTab);
    const toIdx = order.indexOf(tabId);
    const dir = toIdx > fromIdx ? 'right' : 'left';

    // Current page slides out
    from.classList.add('leaving-' + dir);
    from.classList.remove('active');

    // Target page slides in
    to.classList.remove('leaving-left', 'leaving-right');
    to.classList.add('active');
    to.scrollTop = 0;

    // Nav active state
    navItems.forEach(n => n.classList.toggle('active', n.dataset.tab === tabId));

    // Clean up leaving class after transition
    setTimeout(() => {
      from.classList.remove('leaving-left', 'leaving-right');
    }, 340);

    currentTab = tabId;

    // Refresh data when entering a tab
    if (tabId === 'tab-attendance') { renderAttendance(); renderWeekTable(); }
    if (tabId === 'tab-home') renderStats();
    if (tabId === 'tab-students') renderStudents();
    if (tabId === 'tab-fees') renderReports();
  }

  // Guard: if there are unsaved fee changes, confirm before leaving the tab
  let pendingTab = null;
  function goToTab(tabId) {
    if (tabId === currentTab) return;
    if (hasPendingFee()) {
      pendingTab = tabId;
      openModal();
      return;
    }
    performNavigation(tabId);
  }

  navItems.forEach(btn => {
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });

  document.querySelector('.quick-btn').addEventListener('click', () => goToTab('tab-attendance'));

  /* ---------- Stats ---------- */
  function renderStats() {
    const today = todayISO();
    const day = getDay(today);

    let present = 0, absent = 0;
    students.forEach(s => {
      const rec = day[s.id];
      const am = rec ? rec.am : 0;
      const pm = rec ? rec.pm : 0;
      // A student counts present if EITHER session present (and not both no-class)
      const isPresent = am === 1 || pm === 1;
      const isAbsent = (am === 2 || pm === 2) && am !== 1 && pm !== 1;
      if (isPresent) present++;
      else if (isAbsent) absent++;
    });

    const feePending = students.filter(s => !s.feePaid).length;

    statTotal.textContent = students.length;
    statPresent.textContent = present;
    statAbsent.textContent = absent;
    statFee.textContent = feePending;

    // Lively pop on the numbers
    [statTotal, statPresent, statAbsent, statFee].forEach(el => {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    });
  }

  /* ---------- Attendance rendering ---------- */
  let currentDate = todayISO();

  function renderDateLabel() {
    dateMain.textContent = formatShort(currentDate);
    dateSub.textContent = isToday(currentDate) ? 'Today · ' + formatNice(currentDate) : formatNice(currentDate);
    datePicker.value = currentDate;
  }

  function renderAttendance() {
    renderDateLabel();
    const day = getDay(currentDate);

    // Column header dots
    const amState = columnState(currentDate, 'am');
    const pmState = columnState(currentDate, 'pm');
    colAm.querySelector('.col-dot').classList.toggle('col-dot-on', amState === 'all-present');
    colPm.querySelector('.col-dot').classList.toggle('col-dot-on', pmState === 'all-present');

    if (students.length === 0) {
      atBody.innerHTML = '<div class="empty-state"><span class="empty-icon"><span class="ms">inbox</span></span>No students yet.<br/>Add students from the Students tab.</div>';
      return;
    }

    let html = '';
    students.forEach(s => {
      const rec = day[s.id] || { am: 0, pm: 0 };
      const am = rec.am, pm = rec.pm;
      const initials = s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      html += `
        <div class="student-row" data-id="${s.id}">
          <div class="student-name">
            <span class="student-avatar">${initials}</span>
            <span>${escapeHtml(s.name)}</span>
          </div>
          <div class="at-cell" data-session="am">
            <div class="check ${cls(am)}" data-id="${s.id}" data-session="am">${mark(am)}</div>
          </div>
          <div class="at-cell" data-session="pm">
            <div class="check ${cls(pm)}" data-id="${s.id}" data-session="pm">${mark(pm)}</div>
          </div>
        </div>`;
    });
    atBody.innerHTML = html;
  }

  function cls(v) {
    if (v === 1) return 'present';
    if (v === 2) return 'absent';
    return 'noclass';
  }
  function mark(v) {
    if (v === 1) return '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    if (v === 2) return '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    return '<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------- Toast ---------- */
  const toastEl = $('#toast');
  let toastTimer = null;
  function showToast(text) {
    if (toastTimer) { clearTimeout(toastTimer); toastEl.classList.remove('show'); }
    toastEl.textContent = text;
    requestAnimationFrame(() => {
      toastEl.classList.add('show');
      toastTimer = setTimeout(() => {
        toastEl.classList.remove('show');
        toastTimer = null;
      }, 2200);
    });
  }

  /* ---------- Student attendance stats ---------- */
  function getStudentStats(id) {
    let totalDays = 0, presentDays = 0;
    Object.keys(attendance).forEach(date => {
      const rec = attendance[date][id];
      if (!rec) return;
      const am = rec.am, pm = rec.pm;
      const hasAnySession = am !== 0 || pm !== 0;
      if (!hasAnySession) return;
      totalDays++;
      if (am === 1 || pm === 1) presentDays++;
    });
    const pct = totalDays === 0 ? 0 : Math.round((presentDays / totalDays) * 100);
    return { totalDays, presentDays, absentDays: totalDays - presentDays, pct };
  }

  /* ---------- Attendance interactions ---------- */
  atBody.addEventListener('click', (e) => {
    const check = e.target.closest('.check');
    if (!check) return;
    const id = check.dataset.id;
    const session = check.dataset.session;
    const next = cycleCell(currentDate, id, session);

    // Update the tapped cell
    check.className = 'check ' + cls(next);
    check.innerHTML = mark(next);
    check.classList.remove('pop');
    void check.offsetWidth;
    check.classList.add('pop');

    // Update column header dots
    const amState = columnState(currentDate, 'am');
    const pmState = columnState(currentDate, 'pm');
    colAm.querySelector('.col-dot').classList.toggle('col-dot-on', amState === 'all-present');
    colPm.querySelector('.col-dot').classList.toggle('col-dot-on', pmState === 'all-present');

    // Live-update home stats if today
    if (isToday(currentDate)) renderStats();
  });

  function handleColumnToggle(session) {
    toggleColumn(currentDate, session);
    renderAttendance();
    const amState = columnState(currentDate, 'am');
    const pmState = columnState(currentDate, 'pm');
    colAm.querySelector('.col-dot').classList.toggle('col-dot-on', amState === 'all-present');
    colPm.querySelector('.col-dot').classList.toggle('col-dot-on', pmState === 'all-present');
    if (isToday(currentDate)) renderStats();
  }

  colAm.addEventListener('click', () => handleColumnToggle('am'));
  colPm.addEventListener('click', () => handleColumnToggle('pm'));

  /* ---------- Students ---------- */
  const studentsList = $('#students-list');

  /* Search / Sort state */
  let searchQuery = '';
  let sortMode = 'alpha'; // 'alpha' | 'class' | 'class-filter'
  let classFilter = null;

  /* Pending (unsaved) fee changes: studentId -> proposed boolean */
  let pendingFee = {};
  function hasPendingFee() { return Object.keys(pendingFee).length > 0; }
  function pendingFeeCount() { return Object.keys(pendingFee).length; }

  function commitFees() {
    Object.keys(pendingFee).forEach(id => {
      const s = students.find(x => x.id === id);
      if (s) s.feePaid = !!pendingFee[id];
    });
    pendingFee = {};
    persistAll();
    renderStudents();
    renderStats();
    showToast('Fee status updated');
  }

  /* Save bar + confirm modal */
  const feeSaveBar = $('#fee-save-bar');
  const feeSaveMsg = $('#fee-save-msg');
  const confirmModal = $('#confirm-modal');
  const modalText = $('#modal-text');

  function updateSaveBar() {
    const n = pendingFeeCount();
    if (n === 0) { feeSaveBar.hidden = true; return; }
    feeSaveBar.hidden = false;
    feeSaveMsg.textContent = 'Fee change' + (n > 1 ? 's' : '') + ' (' + n + ') · tap Save';
  }

  function openModal() {
    const n = pendingFeeCount();
    modalText.textContent = 'You have ' + n + ' unsaved fee change' + (n > 1 ? 's' : '') + '. Save before leaving?';
    confirmModal.classList.add('visible');
  }
  function closeModal() {
    confirmModal.classList.remove('visible');
    pendingTab = null;
  }

  $('#fee-save-btn').addEventListener('click', commitFees);
  $('#fee-discard-btn').addEventListener('click', () => {
    pendingFee = {};
    renderStudents();
  });
  $('#modal-save-btn').addEventListener('click', () => {
    if (pendingTab === null) return;
    commitFees();
    const target = pendingTab;
    closeModal();
    performNavigation(target);
  });
  $('#modal-discard-btn').addEventListener('click', () => {
    pendingFee = {};
    renderStudents();
    if (pendingTab !== null) {
      const target = pendingTab;
      closeModal();
      performNavigation(target);
    } else {
      closeModal();
    }
  });
  $('#modal-stay-btn').addEventListener('click', closeModal);

  function genId() {
    return 's' + Date.now().toString(36);
  }

  function deleteStudent(id) {
    students = students.filter(x => x.id !== id);
    Object.keys(attendance).forEach(date => {
      if (attendance[date] && attendance[date][id]) delete attendance[date][id];
    });
    delete pendingFee[id];
    if (fees && fees[id]) delete fees[id];
    persistAll();
    renderStudents();
    renderStats();
  }

  function initials(name) {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  /* ---------- Search / Sort / Filter ---------- */
  const searchInput = $('#student-search');
  const searchClear = $('#search-clear');
  const sortPill = $('#sort-pill');
  const classChips = $('#class-chips');
  const SORT_LABELS = { 'alpha': 'A–Z', 'class': 'Class ↑', 'class-filter': 'Class:' };

  function getAvailableClasses() {
    const set = new Set();
    students.forEach(s => { if (s.className) set.add(s.className); });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }

  function getFilteredStudents() {
    let list = students.slice();
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.className.toLowerCase().includes(q) ||
        s.school.toLowerCase().includes(q)
      );
    }
    // Class filter
    if (sortMode === 'class-filter' && classFilter) {
      list = list.filter(s => s.className === classFilter);
    }
    // Sort
    if (sortMode === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => {
        const ca = Number(a.className) || 999;
        const cb = Number(b.className) || 999;
        return ca - cb || a.name.localeCompare(b.name);
      });
    }
    return list;
  }

  function renderClassChips() {
    const classes = getAvailableClasses();
    if (sortMode !== 'class-filter' || classes.length === 0) {
      classChips.hidden = true;
      return;
    }
    classChips.hidden = false;
    let html = '<button class="class-chip' + (!classFilter ? ' chip-active' : '') + '" data-class="">All</button>';
    classes.forEach(c => {
      const active = classFilter === c ? ' chip-active' : '';
      html += '<button class="class-chip' + active + '" data-class="' + c + '">Class ' + c + '</button>';
    });
    classChips.innerHTML = html;
  }

  // Sort pill cycling
  sortPill.addEventListener('click', () => {
    if (sortMode === 'alpha') { sortMode = 'class'; }
    else if (sortMode === 'class') { sortMode = 'class-filter'; classFilter = null; }
    else { sortMode = 'alpha'; classFilter = null; }
    sortPill.textContent = SORT_LABELS[sortMode];
    renderClassChips();
    renderStudents();
  });

  // Class chip click
  classChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.class-chip');
    if (!chip) return;
    classFilter = chip.dataset.class || null;
    renderClassChips();
    renderStudents();
  });

  // Search input
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    searchClear.hidden = !searchQuery;
    renderStudents();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.hidden = true;
    renderStudents();
  });

  /* ---------- Form Modal (Add / Edit) ---------- */
  const formModal = $('#form-modal');
  const formTitle = $('#form-title');
  const formName = $('#form-name');
  const formClass = $('#form-class');
  const formSchool = $('#form-school');
  const formPhone = $('#form-phone');
  const formWhatsapp = $('#form-whatsapp');
  let formEditId = null; // null = add mode, string = edit mode

  function openFormModal(studentId) {
    formEditId = studentId || null;
    if (formEditId) {
      const s = students.find(x => x.id === formEditId);
      if (!s) return;
      formTitle.textContent = 'Edit Student';
      formName.value = s.name;
      formClass.value = s.className || '';
      formSchool.value = s.school || '';
      formPhone.value = s.phone || '';
      formWhatsapp.value = s.whatsapp || '';
    } else {
      formTitle.textContent = 'Add Student';
      formName.value = '';
      formClass.value = '';
      formSchool.value = '';
      formPhone.value = '';
      formWhatsapp.value = '';
    }
    formModal.classList.add('visible');
    setTimeout(() => formName.focus(), 80);
  }

  function closeFormModal() {
    formModal.classList.remove('visible');
    formEditId = null;
  }

  function saveForm() {
    const name = (formName.value || '').trim();
    if (!name) { formName.focus(); return; }
    const cls = (formClass.value || '').trim();
    const school = (formSchool.value || '').trim();
    const phone = (formPhone.value || '').trim();
    const whatsapp = (formWhatsapp.value || '').trim();

    if (formEditId) {
      const s = students.find(x => x.id === formEditId);
      if (s) {
        s.name = name;
        s.className = cls;
        s.school = school;
        s.phone = phone;
        s.whatsapp = whatsapp;
      }
    } else {
      students.push({ id: genId(), name, className: cls, school, phone, whatsapp, feePaid: false });
    }
    persistAll();
    closeFormModal();
    renderStudents();
    renderStats();
    showToast(formEditId ? 'Student updated' : 'Student added');
  }

  $('#add-student-trigger').addEventListener('click', () => openFormModal(null));
  $('#form-save-btn').addEventListener('click', saveForm);
  $('#form-cancel-btn').addEventListener('click', closeFormModal);
  formName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveForm(); });

  /* ---------- Bottom Sheet (Student Detail) ---------- */
  const detailScrim = $('#detail-scrim');
  const detailSheet = $('#detail-sheet');
  const sheetAvatar = $('#sheet-avatar');
  const sheetName = $('#sheet-name');
  const sheetSub = $('#sheet-sub');
  const sheetPresent = $('#sheet-present');
  const sheetAbsent = $('#sheet-absent');
  const sheetRate = $('#sheet-rate');
  const sheetClass = $('#sheet-class');
  const sheetSchool = $('#sheet-school');
  const sheetPhoneLink = $('#sheet-phone-link');
  const sheetPhone = $('#sheet-phone');
  const sheetWhatsappLink = $('#sheet-whatsapp-link');
  const sheetWhatsapp = $('#sheet-whatsapp');
  let openSheetId = null;

  function openDetailSheet(id) {
    const s = students.find(x => x.id === id);
    if (!s) return;
    openSheetId = id;

    sheetAvatar.textContent = initials(s.name);
    sheetName.textContent = s.name;
    const subParts = [];
    if (s.className) subParts.push('Class ' + s.className);
    if (s.school) subParts.push(s.school);
    sheetSub.textContent = subParts.join(' · ') || '—';

    const stats = getStudentStats(id);
    sheetPresent.textContent = stats.totalDays === 0 ? '—' : stats.presentDays;
    sheetAbsent.textContent = stats.totalDays === 0 ? '—' : stats.absentDays;
    sheetRate.textContent = stats.totalDays === 0 ? '—' : stats.pct + '%';

    sheetClass.textContent = s.className || '—';
    sheetSchool.textContent = s.school || '—';

    if (s.phone) {
      sheetPhoneLink.hidden = false;
      sheetPhone.textContent = s.phone;
      sheetPhoneLink.href = 'tel:' + s.phone.replace(/\s+/g, '');
    } else {
      sheetPhoneLink.hidden = true;
    }

    if (s.whatsapp) {
      sheetWhatsappLink.hidden = false;
      sheetWhatsapp.textContent = s.whatsapp;
      const digits = s.whatsapp.replace(/\D/g, '');
      sheetWhatsappLink.href = 'https://wa.me/' + digits;
    } else {
      sheetWhatsappLink.hidden = true;
    }

    detailScrim.classList.add('visible');
  }

  function closeDetailSheet() {
    detailSheet.style.transform = 'translateY(100%)';
    setTimeout(() => {
      detailScrim.classList.remove('visible');
      detailSheet.style.transform = '';
      openSheetId = null;
    }, 300);
  }

  $('#detail-close').addEventListener('click', closeDetailSheet);
  detailScrim.addEventListener('click', (e) => {
    if (e.target === detailScrim) closeDetailSheet();
  });
  $('#sheet-edit-btn').addEventListener('click', () => {
    const id = openSheetId;
    closeDetailSheet();
    setTimeout(() => openFormModal(id), 320);
  });
  $('#sheet-delete-btn').addEventListener('click', () => {
    const id = openSheetId;
    if (!id) return;
    if (confirm('Delete this student permanently?')) {
      closeDetailSheet();
      setTimeout(() => deleteStudent(id), 320);
    }
  });

  /* ---------- Render Students ---------- */
  function renderStudents() {
    const list = getFilteredStudents();
    renderClassChips();

    if (students.length === 0) {
      pendingFee = {};
      studentsList.innerHTML = '<div class="empty-state"><span class="empty-icon"><span class="ms">person_add</span></span>No students yet.<br/>Tap Add Student to get started.</div>';
      updateSaveBar();
      return;
    }

    if (list.length === 0) {
      studentsList.innerHTML = '<div class="empty-state"><span class="empty-icon"><span class="ms">search_off</span></span>No students match your search.</div>';
      updateSaveBar();
      return;
    }

    let html = '';
    list.forEach(s => {
      const hasPending = Object.prototype.hasOwnProperty.call(pendingFee, s.id);
      const shown = hasPending ? !!pendingFee[s.id] : s.feePaid;
      const feeLabel = shown ? 'Paid' : 'Due';
      const feeCls = shown ? 'fee-paid' : 'fee-due';
      const pendCls = hasPending ? ' si-fee-pending' : '';

      const subParts = [];
      if (s.className) subParts.push('Class ' + s.className);
      if (s.school) subParts.push(s.school);
      const sub = subParts.join(' · ') || (shown ? 'Fee paid' : 'Fee due') + (hasPending ? ' · unsaved' : '');

      html += `
        <div class="student-item" data-id="${s.id}">
          <span class="si-avatar">${escapeHtml(initials(s.name))}</span>
          <div class="si-main">
            <div class="si-name">${escapeHtml(s.name)}</div>
            <div class="si-sub">${escapeHtml(sub)}</div>
          </div>
          <button class="si-fee ${feeCls}${pendCls}" data-act="fee" data-id="${s.id}">${feeLabel}</button>
        </div>`;
    });
    studentsList.innerHTML = html;
    updateSaveBar();
  }

  /* Student list click handler */
  studentsList.addEventListener('click', (e) => {
    // Fee pill tap — stage pending change
    const feeBtn = e.target.closest('[data-act="fee"]');
    if (feeBtn) {
      e.stopPropagation();
      const id = feeBtn.dataset.id;
      const s = students.find(x => x.id === id);
      if (!s) return;
      const hasPending = Object.prototype.hasOwnProperty.call(pendingFee, id);
      const current = hasPending ? !!pendingFee[id] : s.feePaid;
      pendingFee[id] = !current;
      renderStudents();
      return;
    }

    // Row tap — open detail sheet
    const row = e.target.closest('.student-item');
    if (row) {
      openDetailSheet(row.dataset.id);
    }
  });

  /* ---------- Date switching (smooth) ---------- */
  const dateDisplay = $('.date-display');

  function slideDate(direction) {
    // animate current label out, swap, animate in
    dateDisplay.style.transition = 'transform 0.22s cubic-bezier(0.22,1,0.36,1), opacity 0.22s';
    dateDisplay.style.transform = direction === 'prev' ? 'translateX(28px)' : 'translateX(-28px)';
    dateDisplay.style.opacity = '0';

    setTimeout(() => {
      currentDate = addDays(currentDate, direction === 'prev' ? -1 : 1);
      renderAttendance();
      dateDisplay.style.transition = 'none';
      dateDisplay.style.transform = direction === 'prev' ? 'translateX(-28px)' : 'translateX(28px)';
      dateDisplay.style.opacity = '0';
      void dateDisplay.offsetWidth;
      dateDisplay.style.transition = 'transform 0.22s cubic-bezier(0.22,1,0.36,1), opacity 0.22s';
      dateDisplay.style.transform = 'translateX(0)';
      dateDisplay.style.opacity = '1';
    }, 220);
  }

  $('#date-prev').addEventListener('click', () => slideDate('prev'));
  $('#date-next').addEventListener('click', () => slideDate('next'));

  $('#today-btn').addEventListener('click', () => {
    if (!isToday(currentDate)) {
      currentDate = todayISO();
      renderAttendance();
    }
  });

  datePicker.addEventListener('change', (e) => {
    if (e.target.value) {
      currentDate = e.target.value;
      renderAttendance();
    }
  });

  /* ---------- Weekly Attendance Spreadsheet ---------- */
  let currentWeekStart = '';
  const weekMain = $('#week-main');
  const weekSub = $('#week-sub');
  const weekTableWrap = $('#week-table-wrap');
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function getMonday(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay(); // 0=Sun
    const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
    dt.setDate(dt.getDate() + diff);
    return dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
  }

  function getWeekDays(mondayISO) {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(mondayISO, i));
    return days;
  }

  function formatDayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return DAY_NAMES[dt.getDay() === 0 ? 6 : dt.getDay() - 1] + ' ' + d;
  }

  function formatMonthDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return MONTH_NAMES[m - 1] + ' ' + d;
  }

  function renderWeekLabel() {
    const days = getWeekDays(currentWeekStart);
    const last = days[6];
    weekMain.textContent = formatMonthDay(currentWeekStart) + ' – ' + formatMonthDay(last);
    const isThisWeek = currentWeekStart === getMonday(todayISO());
    weekSub.textContent = isThisWeek ? 'This week' : formatMonthDay(currentWeekStart) + ' to ' + formatMonthDay(last);
  }

  function renderWeekTable() {
    renderWeekLabel();
    const days = getWeekDays(currentWeekStart);

    if (students.length === 0) {
      weekTableWrap.innerHTML = '<div class="empty-state" style="padding:20px">No students yet.</div>';
      return;
    }

    // Header row 1: day names spanning 2 cols each
    let h1 = '<tr><th class="wk-name-head" rowspan="2">Student</th>';
    days.forEach(iso => {
      h1 += '<th colspan="2">' + formatDayLabel(iso) + '</th>';
    });
    h1 += '</tr>';

    // Header row 2: AM/PM sub-headers
    let h2 = '<tr>';
    days.forEach((iso, i) => {
      const weekend = (i >= 5) ? ' wk-weekend' : '';
      h2 += '<th class="wk-sub-head' + weekend + '">AM</th>';
      h2 += '<th class="wk-sub-head' + weekend + '">PM</th>';
    });
    h2 += '</tr>';

    // Student rows
    let rows = '';
    students.forEach(s => {
      rows += '<tr><td class="wk-name">' + escapeHtml(s.name) + '</td>';
      days.forEach((iso, i) => {
        const day = attendance[iso] || {};
        const rec = day[s.id] || { am: 0, pm: 0 };
        const weekend = (i >= 5) ? ' wk-weekend' : '';
        rows += '<td class="wk-' + cls(rec.am) + weekend + '">' + cellIcon(rec.am) + '</td>';
        rows += '<td class="wk-' + cls(rec.pm) + weekend + '">' + cellIcon(rec.pm) + '</td>';
      });
      rows += '</tr>';
    });

    weekTableWrap.innerHTML =
      '<table class="wk-table"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody></table>';
  }

  function cellIcon(v) {
    if (v === 1) return '✓';
    if (v === 2) return '✗';
    return '—';
  }

  // Week navigation
  $('#week-prev').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, -7);
    renderWeekTable();
  });
  $('#week-next').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, 7);
    renderWeekTable();
  });
  $('#week-today').addEventListener('click', () => {
    currentWeekStart = getMonday(todayISO());
    renderWeekTable();
  });

  /* ---------- Reports Tab ---------- */
  const absentList = $('#absent-list');
  const unpaidList = $('#unpaid-list');
  const whatsappBtn = $('#whatsapp-btn');
  const resetDaySelect = $('#reset-day-select');
  const resetNowBtn = $('#reset-now-btn');
  const sheetResetDay = $('#sheet-reset-day');

  function getAbsentToday() {
    const today = todayISO();
    const day = attendance[today] || {};
    const absent = [];
    students.forEach(s => {
      const rec = day[s.id] || { am: 0, pm: 0 };
      // Absent if either session is absent (2) and not present in the other
      const amAbsent = rec.am === 2;
      const pmAbsent = rec.pm === 2;
      const amPresent = rec.am === 1;
      const pmPresent = rec.pm === 1;
      if ((amAbsent || pmAbsent) && !amPresent && !pmPresent) {
        absent.push(s);
      }
    });
    return absent;
  }

  function getUnpaidStudents() {
    return students.filter(s => !s.feePaid);
  }

  function renderReports() {
    // Absentees
    const absent = getAbsentToday();
    if (absent.length === 0) {
      absentList.innerHTML = '<div class="report-empty"><span class="ms" style="font-size:32px;color:var(--green);display:block;margin-bottom:8px">check_circle</span>All students present today!</div>';
      whatsappBtn.hidden = true;
    } else {
      let html = '';
      absent.forEach(s => {
        const cls = s.className ? ' · Class ' + s.className : '';
        html += '<div class="report-item"><span class="ri-avatar ri-absent">' + escapeHtml(initials(s.name)) + '</span><span class="ri-name">' + escapeHtml(s.name) + '</span><span class="ri-detail">' + escapeHtml(cls) + '</span></div>';
      });
      absentList.innerHTML = html;
      whatsappBtn.hidden = false;
    }

    // Unpaid
    const unpaid = getUnpaidStudents();
    if (unpaid.length === 0) {
      unpaidList.innerHTML = '<div class="report-empty"><span class="ms" style="font-size:32px;color:var(--green);display:block;margin-bottom:8px">check_circle</span>All fees paid this month!</div>';
    } else {
      let html = '';
      unpaid.forEach(s => {
        const cls = s.className ? ' · Class ' + s.className : '';
        html += '<div class="report-item"><span class="ri-avatar ri-unpaid">' + escapeHtml(initials(s.name)) + '</span><span class="ri-name">' + escapeHtml(s.name) + '</span><span class="ri-detail">' + escapeHtml(cls) + '</span></div>';
      });
      unpaidList.innerHTML = html;
    }

    // Reset day select
    resetDaySelect.value = appSettings.feeResetDay;

    // Sheet reset day display
    const suffix = getOrdinal(appSettings.feeResetDay);
    sheetResetDay.textContent = appSettings.feeResetDay + suffix + ' of each month';
  }

  function getOrdinal(n) {
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
  }

  // WhatsApp button
  whatsappBtn.addEventListener('click', () => {
    const absent = getAbsentToday();
    if (absent.length === 0) return;
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const lines = ['Absent today (' + dateStr + '):'];
    absent.forEach(s => {
      const cls = s.className ? ' (Class ' + s.className + ')' : '';
      lines.push(s.name + cls);
    });
    lines.push(absent.length + ' student' + (absent.length > 1 ? 's' : '') + ' absent.');
    const msg = lines.join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  });

  // Reset day selector
  resetDaySelect.addEventListener('change', () => {
    const val = parseInt(resetDaySelect.value, 10);
    if (val >= 1 && val <= 28) {
      appSettings.feeResetDay = val;
      persistAll();
      renderReports();
      showToast('Reset day set to ' + val + getOrdinal(val));
    }
  });

  // Reset now button
  resetNowBtn.addEventListener('click', () => {
    if (!confirm('Reset all student fees to "Not Paid" now?')) return;
    students.forEach(s => { s.feePaid = false; });
    const today = new Date();
    appSettings.lastResetMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    persistAll();
    renderReports();
    renderStats();
    renderStudents();
    showToast('All fees reset to Not Paid');
  });

  /* ---------- Init ---------- */
  function init() {
    // Safety net: ensure home tab is visible on load
    document.getElementById('tab-home').classList.add('active');
    
    // Welcome message
    const now = new Date();
    welcomeDate.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    runWelcome();

    renderStats();
    renderAttendance();
    renderStudents();
    currentWeekStart = getMonday(todayISO());
    renderWeekTable();

    // Populate reset day select
    let opts = '';
    for (let i = 1; i <= 28; i++) opts += '<option value="' + i + '">' + i + '</option>';
    resetDaySelect.innerHTML = opts;

    checkMonthlyReset();
    renderReports();
  }

  init();
})();