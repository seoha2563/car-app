// =====================================================
// 내 차 관리 앱
// 구조: ① 데이터 저장/불러오기 → ② 계산 → ③ 화면 그리기 → ④ 이벤트 연결
// =====================================================

// ---------- ① 데이터 ----------
// 앱의 모든 데이터는 이 state 객체 하나에 들어 있어요.
const STORAGE_KEY = "car-app-data";

let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (e) { /* 저장된 데이터가 깨졌다면 새로 시작 */ }
  return { car: { name: "", plate: "" }, fuel: [], service: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render(); // 데이터가 바뀔 때마다 화면을 다시 그립니다
}

// ---------- ② 계산 ----------
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
const km = n => Number(n).toLocaleString("ko-KR") + " km";
const today = () => new Date().toISOString().slice(0, 10);

// 사용자가 입력한 글자가 HTML로 해석되지 않도록 바꿔주는 함수 (보안상 중요!)
function esc(text) {
  return String(text).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 현재 주행거리 = 모든 기록 중 가장 큰 주행거리
function currentOdo() {
  const all = [...state.fuel, ...state.service].map(r => r.odo);
  return all.length ? Math.max(...all) : 0;
}

// 주유 기록을 주행거리 순으로 정렬하고, 각 기록의 연비를 계산
// 연비 = (이번 주행거리 - 이전 주행거리) / 이번 주유량
function fuelWithEfficiency() {
  const sorted = [...state.fuel].sort((a, b) => a.odo - b.odo);
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    const eff = prev && r.odo > prev.odo ? (r.odo - prev.odo) / r.liters : null;
    return { ...r, eff };
  });
}

function averageEfficiency() {
  // 전체 평균 = (처음~마지막 주행거리) / (첫 주유를 뺀 총 주유량)
  const sorted = fuelWithEfficiency();
  if (sorted.length < 2) return null;
  const totalKm = sorted[sorted.length - 1].odo - sorted[0].odo;
  const totalLiters = sorted.slice(1).reduce((s, r) => s + r.liters, 0);
  return totalKm > 0 ? totalKm / totalLiters : null;
}

// 정비 항목의 상태: 지났음(overdue) / 곧 도래(soon) / 여유(ok)
function serviceStatus(s) {
  const odo = currentOdo();
  const now = today();
  let status = "ok", note = "";
  if (s.nextKm) {
    const left = s.nextKm - odo;
    if (left <= 0) { status = "overdue"; note = `${km(-left)} 초과`; }
    else if (left <= 1000) { status = "soon"; note = `${km(left)} 남음`; }
  }
  if (s.nextDate) {
    const days = Math.ceil((new Date(s.nextDate) - new Date(now)) / 86400000);
    if (days < 0) { status = "overdue"; note = `${-days}일 초과`; }
    else if (days <= 30 && status !== "overdue") { status = "soon"; note = `${days}일 남음`; }
  }
  return { status, note };
}

// ---------- ③ 화면 그리기 ----------
const $ = sel => document.querySelector(sel);

function render() {
  // 헤더
  const { name, plate } = state.car;
  $("#car-title").textContent = name || plate ? `${name} ${plate}`.trim() : "'내 차' 탭에서 차 정보를 입력해보세요";

  renderSummary();
  renderFuel();
  renderService();

  // 폼에 저장된 차 정보 채우기
  $("#car-form").elements.name.value = name;
  $("#car-form").elements.plate.value = plate;
}

function renderSummary() {
  const odo = currentOdo();
  const eff = averageEfficiency();
  const month = today().slice(0, 7);
  const all = [...state.fuel, ...state.service];

  $("#s-odo").textContent = odo ? km(odo) : "-";
  $("#s-eff").textContent = eff ? eff.toFixed(1) + " km/L" : "-";
  $("#s-month").textContent = won(all.filter(r => r.date.startsWith(month)).reduce((s, r) => s + r.cost, 0));
  $("#s-total").textContent = won(all.reduce((s, r) => s + r.cost, 0));

  // 다음 교체 시기가 설정된 정비 중, 지났거나 곧 다가온 것만 표시
  const alerts = state.service
    .map(s => ({ s, ...serviceStatus(s) }))
    .filter(a => a.status !== "ok");

  $("#alerts").innerHTML = alerts.length
    ? alerts.map(a => `
        <li class="${a.status}">
          <div>
            <div class="main">${esc(a.s.type)}</div>
            <div class="sub ${a.status === "overdue" ? "badge-overdue" : "badge-soon"}">
              ${a.status === "overdue" ? "교체 필요 · " : "곧 교체 · "}${a.note}
            </div>
          </div>
        </li>`).join("")
    : `<li class="empty">알림이 없어요 👍</li>`;
}

function renderFuel() {
  const rows = fuelWithEfficiency().reverse(); // 최신순
  $("#fuel-list").innerHTML = rows.length
    ? rows.map(r => `
        <li>
          <div>
            <div class="main">${r.date} · ${r.liters}L · ${won(r.cost)}</div>
            <div class="sub">${km(r.odo)}${r.eff ? ` · 연비 ${r.eff.toFixed(1)} km/L` : ""}</div>
          </div>
          <button class="del" data-kind="fuel" data-id="${r.id}" title="삭제">✕</button>
        </li>`).join("")
    : `<li class="empty">아직 주유 기록이 없어요</li>`;
}

function renderService() {
  const rows = [...state.service].sort((a, b) => b.date.localeCompare(a.date));
  $("#service-list").innerHTML = rows.length
    ? rows.map(r => `
        <li>
          <div>
            <div class="main">${esc(r.type)} · ${won(r.cost)}</div>
            <div class="sub">
              ${r.date} · ${km(r.odo)}
              ${r.nextKm ? ` · 다음 ${km(r.nextKm)}` : ""}${r.nextDate ? ` · 다음 ${r.nextDate}` : ""}
              ${r.memo ? ` · ${esc(r.memo)}` : ""}
            </div>
          </div>
          <button class="del" data-kind="service" data-id="${r.id}" title="삭제">✕</button>
        </li>`).join("")
    : `<li class="empty">아직 정비 기록이 없어요</li>`;
}

// ---------- ④ 이벤트 연결 ----------
// 탭 전환
$("#tabs").addEventListener("click", e => {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b === e.target));
  document.querySelectorAll(".tab").forEach(s => s.classList.toggle("active", s.id === tab));
});

// 폼에서 값을 꺼내 객체로 만드는 도우미
function formData(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const key of ["odo", "liters", "cost", "nextKm"]) {
    if (key in data) data[key] = data[key] === "" ? null : Number(data[key]);
  }
  return { id: Date.now(), ...data };
}

function setupForm(selector, listName) {
  const form = $(selector);
  form.date.value = today(); // 날짜 기본값: 오늘
  form.addEventListener("submit", e => {
    e.preventDefault(); // 페이지 새로고침 막기
    state[listName].push(formData(form));
    form.reset();
    form.date.value = today();
    save();
  });
}
setupForm("#fuel-form", "fuel");
setupForm("#service-form", "service");

// 내 차 정보 저장
$("#car-form").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target.elements;
  state.car = { name: f.name.value.trim(), plate: f.plate.value.trim() };
  save();
});

// 삭제 버튼 (목록 전체에 이벤트를 하나만 달아서 처리)
document.addEventListener("click", e => {
  const btn = e.target.closest(".del");
  if (!btn || !confirm("이 기록을 삭제할까요?")) return;
  const { kind, id } = btn.dataset;
  state[kind] = state[kind].filter(r => String(r.id) !== id);
  save();
});

// 백업: 내보내기
$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `car-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// 백업: 불러오기
$("#import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.car || !Array.isArray(data.fuel) || !Array.isArray(data.service)) throw new Error();
    if (!confirm("현재 데이터를 백업 파일로 덮어쓸까요?")) return;
    state = data;
    save();
  } catch {
    alert("올바른 백업 파일이 아니에요.");
  }
  e.target.value = "";
});

render(); // 첫 화면 그리기

// 서비스 워커 등록 (https 주소나 localhost에서만 동작, 더블클릭으로 연 file:// 에서는 건너뜀)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(err => console.warn("서비스 워커 등록 실패", err));
}
