// =====================================================
// 내 차 관리 앱
// 구조: ① 데이터(서버 저장) → ② 계산 → ③ 화면 그리기 → ④ 이벤트 연결
// 데이터는 Supabase(서버 데이터베이스)에 저장되고, 로그인한 사용자 본인 것만 보입니다.
// =====================================================

const $ = sel => document.querySelector(sel);

// ---------- ① 데이터 ----------
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// 화면에 쓰는 데이터는 이 state 하나에 모아둬요. 서버에서 받아온 사본입니다.
let state = { car: { name: "", plate: "" }, fuel: [], service: [] };
let user = null; // 로그인한 사용자 (없으면 null)

const TABLE = { fuel: "fuel_logs", service: "service_logs" };

// DB 열 이름(next_km)  <->  화면에서 쓰는 이름(nextKm) 변환
const fromDb = {
  fuel: r => ({ id: r.id, date: r.date, odo: r.odo, liters: Number(r.liters), cost: r.cost }),
  service: r => ({
    id: r.id, type: r.type, date: r.date, odo: r.odo, cost: r.cost,
    nextKm: r.next_km, nextDate: r.next_date, memo: r.memo,
  }),
};
const toDb = {
  fuel: r => ({ date: r.date, odo: r.odo, liters: r.liters, cost: r.cost }),
  service: r => ({
    type: r.type, date: r.date, odo: r.odo, cost: r.cost,
    next_km: r.nextKm ?? null, next_date: r.nextDate || null, memo: r.memo || "",
  }),
};

// 서버 요청 결과에 에러가 있으면 예외로 바꿔주는 도우미
async function run(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

// 서버에서 내 데이터를 전부 받아와 state에 넣기
async function loadAll() {
  const [car, fuel, service] = await Promise.all([
    run(db.from("cars").select("name, plate").maybeSingle()),
    run(db.from("fuel_logs").select("*")),
    run(db.from("service_logs").select("*")),
  ]);
  state = {
    car: car || { name: "", plate: "" },
    fuel: fuel.map(fromDb.fuel),
    service: service.map(fromDb.service),
  };
}

// 쓰기 작업은 "서버에 반영 → 다시 받아오기 → 화면 갱신" 순서로 통일했어요.
// (조금 느릴 수 있지만 화면과 서버가 항상 같아서 실수할 일이 적어요)
async function mutate(action) {
  try {
    await action();
    await loadAll();
    render();
  } catch (err) {
    alert("저장하지 못했어요: " + (err.message || err));
  }
}

const addRecord = (kind, rec) => mutate(() => run(db.from(TABLE[kind]).insert(toDb[kind](rec))));
const removeRecord = (kind, id) => mutate(() => run(db.from(TABLE[kind]).delete().eq("id", id)));
const saveCar = car => mutate(() => run(db.from("cars").upsert({ user_id: user.id, ...car })));

// 여러 기록을 한꺼번에 추가 (백업 불러오기, 기존 기록 옮기기에서 사용)
function addAll(data) {
  return mutate(async () => {
    if (data.car && (data.car.name || data.car.plate)) {
      await run(db.from("cars").upsert({ user_id: user.id, name: data.car.name || "", plate: data.car.plate || "" }));
    }
    if (data.fuel.length) await run(db.from("fuel_logs").insert(data.fuel.map(toDb.fuel)));
    if (data.service.length) await run(db.from("service_logs").insert(data.service.map(toDb.service)));
  });
}

// ---------- ② 계산 ----------
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
const km = n => Number(n).toLocaleString("ko-KR") + " km";

// 오늘 날짜(YYYY-MM-DD). 한국 시간 기준으로 계산해요.
const today = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

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
  $("#account-email").textContent = user ? `로그인: ${user.email}` : "";
  $("#migrate-box").hidden = !localData();
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
  return data;
}

function setupForm(selector, kind) {
  const form = $(selector);
  form.date.value = today(); // 날짜 기본값: 오늘
  form.addEventListener("submit", async e => {
    e.preventDefault(); // 페이지 새로고침 막기
    const rec = formData(form);
    form.reset();
    form.date.value = today();
    await addRecord(kind, rec);
  });
}
setupForm("#fuel-form", "fuel");
setupForm("#service-form", "service");

// 내 차 정보 저장
$("#car-form").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target.elements;
  saveCar({ name: f.name.value.trim(), plate: f.plate.value.trim() });
});

// 삭제 버튼 (목록 전체에 이벤트를 하나만 달아서 처리)
document.addEventListener("click", e => {
  const btn = e.target.closest(".del");
  if (!btn || !confirm("이 기록을 삭제할까요?")) return;
  removeRecord(btn.dataset.kind, Number(btn.dataset.id));
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

// 백업: 불러오기 (현재 계정에 "추가"합니다. 기존 기록을 지우지 않아요)
$("#import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.car || !Array.isArray(data.fuel) || !Array.isArray(data.service)) throw new Error();
    if (confirm(`주유 ${data.fuel.length}건, 정비 ${data.service.length}건을 내 계정에 추가할까요?`)) await addAll(data);
  } catch {
    alert("올바른 백업 파일이 아니에요.");
  }
  e.target.value = "";
});

// ---------- 기존(서버 도입 전) 브라우저 저장 기록 옮기기 ----------
const LOCAL_KEY = "car-app-data";

function localData() {
  try {
    const d = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return d && (d.fuel?.length || d.service?.length) ? d : null;
  } catch { return null; }
}

$("#migrate-btn").addEventListener("click", async () => {
  const data = localData();
  if (!data || !confirm(`주유 ${data.fuel.length}건, 정비 ${data.service.length}건을 내 계정으로 옮길까요?`)) return;
  await addAll(data);
  localStorage.removeItem(LOCAL_KEY); // 중복으로 또 옮기지 않도록 정리
  render();
});

// ---------- 로그인 ----------
const authMsg = text => { $("#auth-msg").textContent = text; };

async function authenticate(action) {
  const f = $("#auth-form");
  if (!f.reportValidity()) return; // 이메일 형식, 비밀번호 길이 검사
  authMsg("잠시만요…");
  const { data, error } = await action({ email: f.email.value.trim(), password: f.password.value });
  if (error) return authMsg(error.message);
  // 회원가입 직후 세션이 없다면 이메일 인증이 켜져 있다는 뜻
  if (data && !data.session) authMsg("확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해주세요.");
}

$("#auth-form").addEventListener("submit", e => {
  e.preventDefault();
  authenticate(c => db.auth.signInWithPassword(c));
});
$("#signup-btn").addEventListener("click", () => authenticate(c => db.auth.signUp(c)));
$("#logout-btn").addEventListener("click", () => db.auth.signOut());

// 로그인 상태가 바뀔 때 화면 전환
async function setUser(u) {
  user = u;
  $("#auth").hidden = Boolean(u);
  $("#app").hidden = !u;
  if (!u) {
    state = { car: { name: "", plate: "" }, fuel: [], service: [] };
    $("#auth-form").reset();
    authMsg("");
    $("#car-title").textContent = "로그인이 필요해요";
    return;
  }
  $("#car-title").textContent = "불러오는 중…";
  try {
    await loadAll();
  } catch (err) {
    $("#car-title").textContent = "";
    alert("데이터를 불러오지 못했어요: " + (err.message || err));
  }
  render();
}

async function start() {
  if (!configured) {
    $("#auth").hidden = false;
    $("#auth-form").hidden = true;
    $("#car-title").textContent = "config.js에 Supabase 주소와 키를 먼저 입력해주세요";
    return;
  }
  const { data } = await db.auth.getSession();
  await setUser(data.session?.user ?? null);
  // 로그인/로그아웃 때만 반응 (토큰 자동 갱신처럼 사용자가 같은 경우는 무시)
  // 콜백 안에서 바로 서버 요청을 하면 멈출 수 있어서 setTimeout으로 한 박자 늦춰요.
  db.auth.onAuthStateChange((_event, session) => {
    const next = session?.user ?? null;
    if (next?.id !== user?.id) setTimeout(() => setUser(next), 0);
  });
}
start();

// 서비스 워커 등록 (https 주소나 localhost에서만 동작, 더블클릭으로 연 file:// 에서는 건너뜀)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(err => console.warn("서비스 워커 등록 실패", err));
}
