(() => {
  // Presentation only. All durations and intervals come from the shared engine.
  const { attendanceWindow, attendanceDateKey, localDateKey } = globalThis.__slaiTime;
  let model = null;
  let selectedDate = null;
  let mode = "calendar";
  let userChose = false;
  const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const qualification = (day, state) => {
    const value = dayPresentation(day, state);
    if (value.isFuture || (!value.isToday && !day.hasSummary) || value.duration === "--:--:--") return "";
    if (value.seconds >= REQUIRED_SECONDS) return "met";
    return day.type === "工作日" ? "short" : "";
  };
  const label = (day, state) => `${day.date} ${day.weekday}，${dayPresentation(day, state).type}，${dayPresentation(day, state).duration}${({ met: "，已达标", short: "，未达标" })[qualification(day, state)] || ""}`;

  function selectView(next, persist = false) {
    mode = next === "list" ? "list" : "calendar";
    $("monthCalendar").hidden = mode !== "calendar";
    $("dayList").hidden = mode !== "list";
    $("calendarView").setAttribute("aria-pressed", String(mode === "calendar"));
    $("listView").setAttribute("aria-pressed", String(mode === "list"));
    if (persist) {
      userChose = true;
      globalThis.chrome?.storage?.local?.set({ desktopView: mode }).catch(() => {
        $("calendarView").title = $("listView").title = "本次切换已生效，但未能保存，下次打开使用默认视图";
      });
    }
  }

  function showDay(date) {
    const day = model?.days.find(value => value.date === date);
    if (!day || !currentState) return;
    selectedDate = date;
    updateSelection();
    updateDialog(day, currentState);
    if (!$("dayDialog").open) $("dayDialog").showModal();
  }
  function updateDialog(day, state) {
    const value = dayPresentation(day, state);
    $("dayDialogTitle").textContent = `${day.date} · ${day.weekday}`;
    $("dayDialogDuration").textContent = value.duration;
    $("dayDialogType").textContent = value.type;
    $("dayDialogSource").textContent = value.isToday ? "当前考勤日按完整进出明细估算，05:00切日；实时数字不代表实时定位。" : day.hasSummary ? "来源：学校汇总。每日05:00至次日05:00，最终以学校系统为准。" : value.isFuture ? "该考勤日尚未开始。" : "学校尚未提供该日期的汇总，不以0代替缺失数据。";
  }
  function updateSelection() {
    for (const button of $("monthCalendar").querySelectorAll("[data-date]")) {
      button.classList.toggle("selected", button.dataset.date === selectedDate);
      button.tabIndex = button.dataset.date === selectedDate ? 0 : -1;
    }
  }
  function renderMonth(next, state) {
    const focused = document.activeElement?.dataset.date;
    const sameMonth = model?.month === next.month;
    model = next;
    if (!model.days.some(day => day.date === selectedDate)) selectedDate = model.days.some(day => day.date === model.today) ? model.today : model.days[0]?.date;
    $("monthLabel").hidden = model.month === model.today.slice(0, 7);
    const offset = (new Date(model.month + "-01T12:00:00+08:00").getUTCDay() + 6) % 7;
    $("monthCalendar").innerHTML = [
      ...["一", "二", "三", "四", "五", "六", "日"].map(text => `<span class="weekday" aria-hidden="true">${text}</span>`),
      ...Array.from({ length: offset }, () => '<span aria-hidden="true"></span>'),
      ...model.days.map(day => {
        const value = dayPresentation(day, state);
        return `<button type="button" class="calendar-day ${value.isToday ? "today" : ""} ${value.isFuture ? "future" : ""}" data-date="${day.date}" data-qualification="${qualification(day, state)}" ${value.isToday ? 'aria-current="date"' : ""} aria-label="${escapeHtml(label(day, state))}">${Number(day.date.slice(-2))}</button>`;
      })
    ].join("");
    $("dayList").innerHTML = model.days.map(day => {
      const value = dayPresentation(day, state);
      const parts = day.date.split("-");
      return `<button type="button" class="day-row ${value.isToday ? "today" : ""}" data-date="${day.date}" aria-label="${escapeHtml(label(day, state))}"><span class="day-date"><strong>${Number(parts[1])}/${Number(parts[2])}</strong><span>${day.weekday}</span></span><span class="day-type">${value.type}</span><span class="day-time ${value.tone}" ${value.isToday ? 'id="todayRowDuration"' : ""}>${escapeHtml(value.duration)}</span></button>`;
    }).join("");
    updateSelection();
    selectView(mode);
    if (sameMonth && focused && !$("dayDialog").open) {
      const container = mode === "calendar" ? $("monthCalendar") : $("dayList");
      container.querySelector(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
    }
    if ($("dayDialog").open) {
      const day = model.days.find(item => item.date === selectedDate);
      if (day) updateDialog(day, state); else $("dayDialog").close();
    }
  }

  function canvasContext(canvas) {
    const { width, height } = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return { context, width, height };
  }
  function updateToday(attendance, state) {
    const css = getComputedStyle(document.documentElement);
    const brand = css.getPropertyValue("--brand").trim();
    const track = css.getPropertyValue("--track").trim();
    const { context: ring, width, height } = canvasContext($("ringCanvas"));
    const radius = Math.min(width, height) / 2 - 5;
    ring.lineWidth = 6;
    ring.strokeStyle = track;
    ring.beginPath(); ring.arc(width / 2, height / 2, radius, 0, Math.PI * 2); ring.stroke();
    if (attendance.available && attendance.seconds > 0) {
      ring.strokeStyle = brand; ring.lineCap = "round";
      ring.beginPath(); ring.arc(width / 2, height / 2, radius, -Math.PI / 2, -Math.PI / 2 + Math.min(1, attendance.seconds / REQUIRED_SECONDS) * Math.PI * 2); ring.stroke();
    }
    if (attendance.available) $("progressRing").setAttribute("aria-valuenow", String(Math.min(REQUIRED_SECONDS, attendance.seconds)));
    else $("progressRing").removeAttribute("aria-valuenow");
    $("progressRing").setAttribute("aria-valuetext", attendance.available ? `在校${fullClockDuration(attendance.seconds)}，${attendance.frozen ? "估算已暂停" : "目标6小时"}` : "暂无可靠数据");
    $("statusText").title = $("statusText").textContent;
    if (attendance.available && !attendance.frozen) $("statusText").textContent = attendance.onCampus ? "在校 · 实时估算" : attendance.lastEffectiveSwipe ? "已离校 · 计时暂停" : "暂无校园进出记录";

    const date = attendanceDateKey(new Date(viewNow()));
    const window = attendanceWindow(date);
    const { context, width: w } = canvasContext($("timelineCanvas"));
    context.fillStyle = track;
    context.beginPath(); context.roundRect(0, 9, w, 9, 4); context.fill();
    context.fillStyle = brand;
    for (const segment of attendance.segments) {
      const left = w * (segment.start - window.start) / (window.end - window.start);
      const right = w * (segment.end - window.start) / (window.end - window.start);
      context.fillRect(left, 9, Math.max(0, right - left), 9);
    }
    if (attendance.available) {
      const markerAt = attendance.frozen ? Date.parse(attendance.updatedAt) : viewNow();
      const x = Math.max(1, Math.min(w - 1, w * (markerAt - window.start) / (window.end - window.start)));
      context.strokeStyle = brand; context.lineWidth = 1;
      context.beginPath(); context.moveTo(x, 2); context.lineTo(x, 25); context.stroke();
    }
    const format = at => (localDateKey(new Date(at)) !== date ? "次日" : "") + clock.format(new Date(at));
    const lines = attendance.segments.map(segment => `${format(segment.start)}—${format(segment.end)}${segment.estimated ? attendance.frozen ? "（估算已暂停）" : "（估算中）" : ""}`);
    const empty = attendance.available ? "暂无有效在校区间" : "暂无可靠数据，等待完整同步";
    $("timelineCanvas").setAttribute("aria-label", `05:00至次日05:00；${lines.join("；") || empty}`);
    $("timelineIntervals").innerHTML = (lines.length ? lines : [empty]).map(line => `<li>${escapeHtml(line)}</li>`).join("");
    const today = model?.days.find(day => day.date === date);
    if (today) for (const button of document.querySelectorAll(`[data-date="${date}"]`)) {
      button.setAttribute("aria-label", label(today, state));
      button.dataset.qualification = qualification(today, state);
    }
    if ($("dayDialog").open && selectedDate === date && today) updateDialog(today, state);
  }

  $("calendarView").addEventListener("click", () => selectView("calendar", true));
  $("listView").addEventListener("click", () => selectView("list", true));
  for (const id of ["monthCalendar", "dayList"]) $(id).addEventListener("click", event => {
    const button = event.target.closest("button[data-date]");
    if (button) showDay(button.dataset.date);
  });
  $("monthCalendar").addEventListener("keydown", event => {
    const buttons = [...$("monthCalendar").querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[event.key];
    const button = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
    selectedDate = button.dataset.date; updateSelection(); button.focus();
  });
  const repaint = () => { if (currentState) renderToday(currentState); };
  window.addEventListener("resize", repaint);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repaint);
  globalThis.__slaiDesktop = { renderMonth, renderToday: updateToday };
  selectView("calendar");
  globalThis.chrome?.storage?.local?.get("desktopView").then(value => { if (!userChose) selectView(value.desktopView); }).catch(() => {});
})();
