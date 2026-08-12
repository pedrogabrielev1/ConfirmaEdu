"use strict";

const MAX_PDF_SIZE = 5 * 1024 * 1024;
const QR_PREFIX = "CONFIRMAEDU:";
const THEME_KEY = "confirmaedu_theme";

const ROLE_CONFIG = {
  student: { label: "Aluno", identifier: "Matrícula", detail: "Aluno" },
  canteen: { label: "Cantina", identifier: "Usuário ou matrícula funcional", detail: "Equipe da cantina" },
  direction: { label: "Direção", identifier: "Usuário ou matrícula funcional", detail: "Direção escolar" },
};

const CLASS_NAMES = [
  "1º A", "1º B", "1º C", "2º A", "2º B", "2º C", "3º A", "3º B", "3º C",
  "1º Edificações", "2º Edificações", "3º Edificações",
  "1º Informática", "2º Informática", "3º Informática",
];

const NAVIGATION = {
  student: [
    { id: "inicio", icon: "⌂", label: "Início" },
    { id: "cardapio", icon: "▦", label: "Cardápio" },
    { id: "historico", icon: "◷", label: "Histórico" },
    { id: "dados", icon: "◉", label: "Meus dados" },
  ],
  canteen: [
    { id: "inicio", icon: "⌂", label: "Visão geral" },
    { id: "turmas", icon: "▦", label: "Alunos e turmas" },
    { id: "registrar", icon: "▦", label: "QR Code" },
    { id: "cardapio", icon: "☷", label: "Cardápio" },
  ],
  direction: [
    { id: "inicio", icon: "⌂", label: "Visão geral" },
    { id: "ausencias", icon: "!", label: "Ausências" },
    { id: "justificativas", icon: "▤", label: "Justificativas" },
    { id: "cardapio", icon: "☷", label: "Cardápio" },
    { id: "acessos", icon: "♟", label: "Acessos" },
    { id: "relatorios", icon: "▥", label: "Relatórios" },
  ],
};

const appConfig = window.CONFIRMAEDU_CONFIG || {};
const isConfigured =
  /^https:\/\/.+\.supabase\.co$/i.test(String(appConfig.SUPABASE_URL || "")) &&
  !String(appConfig.SUPABASE_KEY || "").startsWith("COLE_") &&
  String(appConfig.SUPABASE_KEY || "").length > 20 &&
  typeof window.supabase?.createClient === "function";

const backend = isConfigured
  ? window.supabase.createClient(appConfig.SUPABASE_URL, appConfig.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const ui = {
  booting: true,
  busy: false,
  session: null,
  profile: null,
  loginRole: "student",
  registerRole: "student",
  authMode: "login",
  view: "inicio",
  modal: null,
  mobileMenu: false,
  search: "",
  theme: localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light",
};

const data = {
  profiles: [],
  confirmations: [],
  attendance: [],
  menu: [],
  justifications: [],
  qrSession: null,
};

let toastTimer = null;
let realtimeChannel = null;
let realtimeTimer = null;
let qrStream = null;
let qrFrameId = null;
let qrScanning = false;
let qrLastScan = 0;

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialsFromName(name = "") {
  return String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "CE";
}

function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function parseDate(value) {
  return new Date(`${value}T12:00:00-03:00`);
}

function formatDate(value, options = {}) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...options,
  }).format(parseDate(value));
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function weekDates(reference = new Date()) {
  const base = new Date(reference);
  const day = base.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + distance);
  return Array.from({ length: 5 }, (_, index) => {
    const current = new Date(base);
    current.setDate(base.getDate() + index);
    return dateKey(current);
  });
}

function firstDayRange(days = 45) {
  const current = new Date();
  current.setDate(current.getDate() - days);
  return dateKey(current);
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

function accountEmail(identifier) {
  const projectHost = new URL(appConfig.SUPABASE_URL).hostname;
  return `${normalizeIdentifier(identifier)}@${projectHost}`;
}

function roleLabel(role) {
  if (role === "pending") return "Aguardando aprovação";
  return ROLE_CONFIG[role]?.label || role;
}

function applyTheme() {
  document.documentElement.dataset.theme = ui.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ui.theme === "dark" ? "#0d1512" : "#147a50");
}

function brand() {
  return `<div class="brand"><img class="brand-logo" src="confirmaedu-logo.png" alt="ConfirmaEdu"></div>`;
}

function schoolBadge() {
  return `<span class="school-symbol school-logo"><img src="escola-antonio-dantas.png" alt="Brasão da Escola Estadual Professor Antônio Dantas"></span>`;
}

function themeButton() {
  const label = ui.theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro";
  return `<button class="icon-button" data-action="toggle-theme" title="${label}" aria-label="${label}">${ui.theme === "dark" ? "☀" : "☾"}</button>`;
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = `${type === "error" ? "⚠" : "✓"} ${message}`;
  toast.style.color = type === "error" ? "var(--red)" : "var(--green-dark)";
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setButtonBusy(button, busy, text = "Aguarde…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function render() {
  applyTheme();
  const app = document.getElementById("app");
  if (ui.booting) app.innerHTML = renderLoading();
  else if (!isConfigured) app.innerHTML = renderSetup();
  else if (!ui.session || !ui.profile) app.innerHTML = renderLogin();
  else if (ui.profile.role === "pending") app.innerHTML = renderPending();
  else app.innerHTML = renderApp();
  renderSchoolQr();
}

function renderLoading() {
  return `<main class="loading-screen"><div class="brand brand-loading"><img class="brand-logo" src="confirmaedu-logo.png" alt="ConfirmaEdu"></div><strong>Carregando o ConfirmaEdu…</strong></main>`;
}

function renderSetup() {
  return `<main class="login-page">
    <header class="login-topbar">${brand()}${themeButton()}</header>
    <section class="login-stage"><div class="login-panel"><div class="school-heading">${schoolBadge()}<p>Configuração inicial</p><h1>Conecte o banco de dados</h1><span>Abra o arquivo GUIA-RAPIDO.md e siga os passos indicados.</span></div>
    <article class="login-card setup-card"><span class="stat-icon orange">!</span><h2>Falta conectar o Supabase</h2><p>Preencha o arquivo <strong>config.js</strong> com a URL e a chave pública do projeto.</p><div class="local-box"><span>1</span><div><strong>Você só fará isso uma vez</strong><p>Depois de configurado, esta tela desaparece.</p></div></div></article></div></section>
  </main>`;
}

function roleTabs(selected, action) {
  return `<div class="role-tabs" role="tablist" aria-label="Tipo de acesso">${Object.entries(ROLE_CONFIG).map(([role, item]) => `<button type="button" role="tab" aria-selected="${selected === role}" class="${selected === role ? "active" : ""}" data-action="${action}" data-role="${role}">${item.label}</button>`).join("")}</div>`;
}

function renderLogin() {
  const role = ui.authMode === "register" ? ui.registerRole : ui.loginRole;
  const current = ROLE_CONFIG[role];
  const cardContent = ui.authMode === "register"
    ? `<div class="login-card__heading"><span>＋</span><div><h2>Criar cadastro</h2><p>Selecione o tipo de usuário</p></div></div>
      ${roleTabs(ui.registerRole, "select-register-role")}
      <form id="register-form" class="login-form">
        <label>Nome completo<input name="name" autocomplete="name" placeholder="Digite seu nome completo" minlength="3" required></label>
        <label>${current.identifier}<input name="identifier" autocomplete="username" placeholder="Digite ${role === "student" ? "sua matrícula" : "seu identificador"}" pattern="[A-Za-z0-9._-]{3,30}" maxlength="30" required></label>
        ${role === "student" ? `<label>Turma<select name="classroom" required><option value="">Selecione sua turma</option>${CLASS_NAMES.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")}</select></label>` : `<div class="approval-note"><span>◷</span><div><strong>Acesso protegido</strong><p>O cadastro de ${current.label.toLowerCase()} será liberado pela direção.</p></div></div>`}
        <label>Senha<input name="password" type="password" autocomplete="new-password" placeholder="Crie uma senha com 6 ou mais caracteres" minlength="6" required></label>
        <label>Confirmar senha<input name="passwordConfirm" type="password" autocomplete="new-password" placeholder="Digite a senha novamente" minlength="6" required></label>
        <div id="register-error" class="login-error"></div>
        <button class="button button-primary button-full" type="submit">Criar cadastro</button>
      </form>
      <button class="auth-switch" type="button" data-action="show-login">Já tenho cadastro <strong>Voltar ao login</strong></button>`
    : `<div class="login-card__heading"><span>→</span><div><h2>Acesso ao sistema</h2><p>Selecione o seu perfil</p></div></div>
      ${roleTabs(ui.loginRole, "select-login-role")}
      <form id="login-form" class="login-form">
        <label>${current.identifier}<input id="login-user" name="identifier" autocomplete="username" placeholder="Digite ${role === "student" ? "sua matrícula" : "seu identificador"}" required></label>
        <label>Senha<div class="password-wrap"><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Digite sua senha" required><button type="button" data-action="toggle-password" aria-label="Mostrar ou ocultar senha">◉</button></div></label>
        <div id="login-error" class="login-error"></div>
        <button class="button button-primary button-full" type="submit">Entrar</button>
      </form>
      <button class="auth-switch" type="button" data-action="show-register">Primeiro acesso? <strong>Criar cadastro</strong></button>`;

  return `<main class="login-page"><header class="login-topbar">${brand()}${themeButton()}</header><section class="login-stage"><div class="login-panel"><div class="school-heading">${schoolBadge()}<p>Escola Estadual</p><h1>Professor Antônio Dantas</h1><span>Controle de refeições escolares</span></div><div class="login-card">${cardContent}</div></div></section></main>`;
}

function renderPending() {
  const requested = ROLE_CONFIG[ui.profile.requested_role]?.label || "funcionário";
  return `<main class="login-page"><header class="login-topbar">${brand()}${themeButton()}</header><section class="login-stage"><div class="login-panel pending-panel"><div class="school-heading"><span class="school-symbol">◷</span><p>Cadastro recebido</p><h1>Aguardando aprovação</h1><span>A direção precisa liberar o acesso de ${escapeHTML(requested)}.</span></div><article class="login-card pending-card"><span class="pending-icon">✓</span><h2>${escapeHTML(ui.profile.full_name)}</h2><p>Seu cadastro foi salvo corretamente. Entre novamente depois que a direção aprovar.</p><div class="profile-status"><span>◷</span><div><strong>Situação</strong><p>Aguardando aprovação da direção</p></div></div><button class="button button-secondary button-full" data-action="refresh-account">Verificar novamente</button><button class="auth-switch" data-action="logout">Sair da conta</button></article></div></section></main>`;
}

function currentUser() {
  return ui.profile || {};
}

function profileById(id) {
  if (id === ui.profile?.id) return ui.profile;
  return data.profiles.find(profile => profile.id === id) || {};
}

function renderApp() {
  const user = currentUser();
  const nav = NAVIGATION[user.role] || [];
  return `<div class="app-shell"><aside class="sidebar ${ui.mobileMenu ? "open" : ""}">${brand()}<div class="profile-box"><span class="avatar">${initialsFromName(user.full_name)}</span><div><strong>${escapeHTML(user.full_name)}</strong><small>${escapeHTML(user.classroom || roleLabel(user.role))}</small></div></div><nav class="side-nav" aria-label="Navegação principal">${nav.map(item => navButton(item)).join("")}</nav><button class="logout-button" data-action="logout">↪ Sair</button></aside>${ui.mobileMenu ? `<button class="sidebar-overlay" data-action="close-mobile-menu" aria-label="Fechar menu"></button>` : ""}<div class="main-wrap"><header class="topbar"><button class="icon-button mobile-menu-button" data-action="open-mobile-menu" aria-label="Abrir menu">☰</button><span class="topbar-school">▦ EE Professor Antônio Dantas</span><div class="topbar-actions"><button class="icon-button" data-action="refresh-data" title="Atualizar dados" aria-label="Atualizar dados">↻</button>${themeButton()}</div></header><main class="content">${renderCurrentView()}</main></div><nav class="mobile-nav" aria-label="Navegação móvel">${nav.map(item => navButton(item, true)).join("")}</nav>${renderModal()}</div>`;
}

function navButton(item, mobile = false) {
  return `<button class="${ui.view === item.id ? "active" : ""}" data-action="navigate" data-view="${item.id}"><span class="${mobile ? "" : "nav-icon"}">${item.icon}</span><span>${item.label}</span></button>`;
}

function heading(overline, title, description, action = "") {
  return `<header class="page-heading"><div><span class="overline">${overline}</span><h1>${title}</h1><p>${description}</p></div>${action}</header>`;
}

function statCard(icon, tone, label, value, detail) {
  return `<article class="stat-card"><span class="stat-icon ${tone}">${icon}</span><div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div></article>`;
}

function emptyState(icon, title, text) {
  return `<div class="empty-state"><span>${icon}</span><strong>${title}</strong><p>${text}</p></div>`;
}

function renderCurrentView() {
  if (ui.profile.role === "student") return renderStudentView();
  if (ui.profile.role === "canteen") return renderCanteenView();
  return renderDirectionView();
}

function todayConfirmation(userId = ui.profile.id) {
  return data.confirmations.find(item => item.user_id === userId && item.meal_date === dateKey());
}

function todayAttendance(userId = ui.profile.id) {
  return data.attendance.find(item => item.user_id === userId && item.meal_date === dateKey());
}

function menuForDate(value) {
  return data.menu.find(item => item.menu_date === value);
}

function todayMenuCard() {
  const item = menuForDate(dateKey());
  if (!item) return `<article class="card today-menu"><span class="pill pill-green">☷ Cardápio de hoje</span>${emptyState("☷", "Cardápio ainda não informado", "A cantina poderá adicionar a refeição do dia.")}</article>`;
  return `<article class="card today-menu"><span class="pill pill-green">☷ Cardápio de hoje</span><h3>${escapeHTML(item.main_dish)}</h3><p>${escapeHTML(item.sides || "Sem acompanhamento informado")}</p><footer>♧ Sobremesa: ${escapeHTML(item.dessert || "Não informada")}</footer></article>`;
}

function renderStudentView() {
  if (ui.view === "cardapio") return renderMenu(false);
  if (ui.view === "historico") return renderHistory();
  if (ui.view === "dados") return renderStudentData();
  return renderStudentHome();
}

function renderStudentHome() {
  const user = currentUser();
  const confirmation = todayConfirmation();
  const checkin = todayAttendance();
  const firstName = String(user.full_name || "Aluno").split(/\s+/)[0];
  const feedback = confirmation
    ? `<div class="feedback ${confirmation.will_eat ? "" : "orange"}">✓ ${confirmation.will_eat ? "A cantina recebeu sua confirmação." : "A cantina recebeu que você não irá almoçar."}</div>`
    : "";
  return `<div class="page-stack">${heading("Área do aluno", `Olá, ${escapeHTML(firstName)}! 👋`, new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "full" }).format(new Date()))}<section class="student-grid"><article class="card confirm-card"><span class="pill pill-blue">◷ Confirmação do dia</span><h2>Você vai almoçar na escola hoje?</h2><p>Sua resposta ajuda a cantina a preparar a quantidade certa.</p><div class="class-line">▦ Sua turma <strong>${escapeHTML(user.classroom || "Não informada")}</strong></div><div class="attendance-buttons"><button class="attendance-button yes ${confirmation?.will_eat === true ? "active" : ""}" data-action="attendance" data-value="yes"><span>✓</span><span><strong>Sim, vou almoçar</strong><small>Reserve minha refeição</small></span></button><button class="attendance-button no ${confirmation?.will_eat === false ? "active" : ""}" data-action="attendance" data-value="no"><span>×</span><span><strong>Não vou almoçar</strong><small>Não preparar para mim</small></span></button></div>${feedback}</article>${todayMenuCard()}</section><article class="card student-qr-card ${checkin ? "complete" : ""}"><span class="student-qr-icon">${checkin ? "✓" : "▦"}</span><div><span class="overline">Presença na cantina</span><h2>${checkin ? "Refeição registrada" : "Leia o QR Code da escola"}</h2><p>${checkin ? `Registro realizado às ${formatDateTime(checkin.checked_in_at)}.` : "Na hora do almoço, abra a câmera e aponte para o código da cantina."}</p></div>${checkin ? `<span class="badge badge-green">Presente</span>` : `<button class="button button-primary" data-action="open-qr-scanner">Abrir câmera</button>`}</article></div>`;
}

function renderMenu(editable) {
  const days = weekDates();
  const dayShort = ["SEG", "TER", "QUA", "QUI", "SEX"];
  return `<div class="page-stack">${heading(editable ? "Planejamento" : "Área do aluno", "Cardápio semanal", `Semana de ${formatDate(days[0], { day: "2-digit", month: "2-digit" })} a ${formatDate(days[4], { day: "2-digit", month: "2-digit" })}.`)}<section class="menu-list">${days.map((day, index) => {
    const item = menuForDate(day);
    return `<article class="menu-row ${day === dateKey() ? "today" : ""}"><div class="menu-date"><strong>${dayShort[index]}</strong><small>${formatDate(day, { day: "2-digit", month: "2-digit" })}</small></div><div class="menu-content"><span>${new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Fortaleza" }).format(parseDate(day))}${day === dateKey() ? " • Hoje" : ""}</span>${item ? `<h3>${escapeHTML(item.main_dish)}</h3><p>${escapeHTML(item.sides || "Sem acompanhamento informado")}</p><div class="menu-meta">♧ ${escapeHTML(item.dessert || "Sobremesa não informada")}</div>` : `<h3>Refeição ainda não informada</h3><p>Aguardando o planejamento da escola.</p>`}</div>${editable ? `<button class="icon-button edit-button" data-action="edit-menu" data-date="${day}" aria-label="Editar cardápio">✎</button>` : ""}</article>`;
  }).join("")}</section></div>`;
}

function studentHistoryRows() {
  const ids = new Set([
    ...data.confirmations.filter(item => item.user_id === ui.profile.id).map(item => item.meal_date),
    ...data.attendance.filter(item => item.user_id === ui.profile.id).map(item => item.meal_date),
  ]);
  return [...ids].sort().reverse().map(day => {
    const confirmation = data.confirmations.find(item => item.user_id === ui.profile.id && item.meal_date === day);
    const attendance = data.attendance.find(item => item.user_id === ui.profile.id && item.meal_date === day);
    const justification = data.justifications.find(item => item.student_id === ui.profile.id && item.absence_date === day);
    let detail = "Sem confirmação";
    let status = "Não confirmou";
    let badge = "gray";
    if (attendance) { detail = `Refeição registrada às ${formatDateTime(attendance.checked_in_at)}`; status = "Presente"; badge = "green"; }
    else if (confirmation?.will_eat) { detail = day < dateKey() ? "Confirmou, mas não compareceu" : "Refeição confirmada"; status = justification ? justification.status : day < dateKey() ? "Ausente" : "Confirmado"; badge = justification?.status === "approved" ? "green" : day < dateKey() ? "orange" : "blue"; }
    else if (confirmation && !confirmation.will_eat) { detail = "Informou que não iria almoçar"; status = "Não iria"; badge = "gray"; }
    return { day, confirmation, attendance, justification, detail, status, badge };
  });
}

function renderHistory() {
  const rows = studentHistoryRows();
  return `<div class="page-stack">${heading("Acompanhamento", "Histórico de refeições", "Consulte suas confirmações, presenças e justificativas.")}<section class="card">${rows.length ? rows.map(row => `<div class="history-row"><span class="row-icon ${row.attendance ? "green" : row.confirmation?.will_eat ? "orange" : ""}">${row.attendance ? "✓" : row.confirmation?.will_eat ? "!" : "◷"}</span><div class="row-main"><strong>${formatDate(row.day)}</strong><small>${escapeHTML(row.detail)}</small></div><span class="badge badge-${row.badge}">${escapeHTML(statusLabel(row.status))}</span>${row.day < dateKey() && row.confirmation?.will_eat && !row.attendance && !row.justification ? `<button class="button button-primary button-small" data-action="justify" data-date="${row.day}">Justificar</button>` : ""}</div>`).join("") : emptyState("◷", "Nenhum histórico ainda", "Suas confirmações e refeições aparecerão aqui.")}</section></div>`;
}

function statusLabel(value) {
  const map = { pending: "Pendente", approved: "Aprovada", rejected: "Rejeitada" };
  return map[value] || value;
}

function renderStudentData() {
  const user = currentUser();
  return `<div class="page-stack">${heading("Perfil do aluno", "Meus dados", "Informações do seu cadastro.")}<section class="two-columns"><article class="card"><div class="section-head"><div><h2>Dados do aluno</h2><p>Cadastro ativo</p></div><span class="avatar">${initialsFromName(user.full_name)}</span></div><div class="form-grid"><label>Nome completo<input value="${escapeHTML(user.full_name)}" disabled></label><label>Matrícula<input value="${escapeHTML(user.registration)}" disabled></label><label>Turma<input value="${escapeHTML(user.classroom || "Não informada")}" disabled></label></div></article><article class="card"><div class="section-head"><div><h2>Situação da conta</h2><p>Acesso ao ConfirmaEdu</p></div></div><div class="profile-status"><span>✓</span><div><strong>Cadastro ativo</strong><p>Você já pode confirmar e registrar sua refeição.</p></div></div><button class="button button-secondary button-full" style="margin-top:15px" data-action="logout">Sair da conta</button></article></section></div>`;
}

function staffStudents() {
  return data.profiles.filter(profile => profile.role === "student");
}

function classStats() {
  return CLASS_NAMES.map(name => {
    const students = staffStudents().filter(profile => profile.classroom === name);
    const ids = new Set(students.map(profile => profile.id));
    const confirmed = data.confirmations.filter(item => item.meal_date === dateKey() && item.will_eat && ids.has(item.user_id)).length;
    const served = data.attendance.filter(item => item.meal_date === dateKey() && ids.has(item.user_id)).length;
    return { name, students: students.length, confirmed, served };
  }).filter(item => item.students || item.confirmed || item.served);
}

function staffTotals() {
  const confirmed = data.confirmations.filter(item => item.meal_date === dateKey() && item.will_eat).length;
  const served = data.attendance.filter(item => item.meal_date === dateKey()).length;
  return { confirmed, served, waiting: Math.max(confirmed - served, 0), rate: confirmed ? Math.round(served / confirmed * 100) : 0 };
}

function renderCanteenView() {
  if (ui.view === "turmas") return renderClasses();
  if (ui.view === "registrar") return renderCheckin();
  if (ui.view === "cardapio") return renderMenu(true);
  return renderCanteenHome();
}

function renderCanteenHome() {
  const totals = staffTotals();
  return `<div class="page-stack">${heading("Painel da cantina", "Planejamento de hoje", formatDate(dateKey()), `<button class="button button-primary" data-action="navigate" data-view="registrar">▦ Ver QR Code</button>`)}<section class="stats-grid">${statCard("♟", "blue", "Previstos para almoçar", totals.confirmed, "alunos confirmados")}${statCard("♨", "green", "Refeições servidas", totals.served, `${totals.rate}% dos confirmados`)}${statCard("◷", "orange", "Ainda não compareceram", totals.waiting, "até o momento")}${statCard("▦", "purple", "Alunos cadastrados", staffStudents().length, "contas ativas")}</section><section class="two-columns"><article class="card"><div class="section-head"><div><h2>Progresso do almoço</h2><p>Atualizado para todos os usuários</p></div><span class="pill pill-green">● Ao vivo</span></div><div class="metric-large">${totals.rate}%</div><p class="metric-caption">das confirmações registradas</p><div class="progress"><span style="width:${totals.rate}%"></span></div></article>${todayMenuCard()}</section><section class="card"><div class="section-head"><div><h2>Confirmações por turma</h2><p>Dados cadastrados no sistema</p></div><button class="button button-secondary button-small" data-action="navigate" data-view="turmas">Ver todas →</button></div><div class="class-grid">${classStats().length ? classStats().slice(0, 6).map(classCard).join("") : emptyState("▦", "Nenhuma turma com registros", "Cadastre os alunos para começar o acompanhamento.")}</div></section></div>`;
}

function classCard(item) {
  const percent = item.confirmed ? Math.round(item.served / item.confirmed * 100) : 0;
  return `<article class="class-card"><header><strong>${escapeHTML(item.name)}</strong><span>${percent}%</span></header><p>Alunos <strong>${item.students}</strong></p><p>Confirmaram <strong>${item.confirmed}</strong></p><p>Almoçaram <strong>${item.served}</strong></p><div class="progress"><span style="width:${percent}%"></span></div></article>`;
}

function renderClasses() {
  const students = staffStudents().filter(student => `${student.full_name} ${student.registration} ${student.classroom}`.toLowerCase().includes(ui.search.toLowerCase()));
  return `<div class="page-stack">${heading("Acompanhamento", "Alunos e turmas", "Cadastros, confirmações e refeições de hoje.")}<section class="card"><div class="section-head"><div><h2>Resumo por turma</h2><p>Somente dados registrados</p></div></div><div class="class-grid">${classStats().length ? classStats().map(classCard).join("") : emptyState("▦", "Sem dados por turma", "As turmas aparecerão após o primeiro cadastro de aluno.")}</div></section><section class="card"><form id="search-form" class="search-row"><input name="search" value="${escapeHTML(ui.search)}" placeholder="Pesquisar nome, matrícula ou turma"><button class="button button-secondary">Pesquisar</button></form>${students.length ? students.map(student => {
    const confirmation = todayConfirmation(student.id);
    const attendance = todayAttendance(student.id);
    return `<div class="person-row"><span class="avatar">${initialsFromName(student.full_name)}</span><div class="row-main"><strong>${escapeHTML(student.full_name)}</strong><small>${escapeHTML(student.classroom || "Sem turma")} • Matrícula ${escapeHTML(student.registration)}</small></div><span class="badge badge-${attendance ? "green" : confirmation?.will_eat ? "blue" : "gray"}">${attendance ? "Presente" : confirmation?.will_eat ? "Confirmou" : "Sem confirmação"}</span></div>`;
  }).join("") : emptyState("♟", "Nenhum aluno encontrado", "Os alunos criam o próprio cadastro na tela inicial.")}</section></div>`;
}

function recentAttendance() {
  return data.attendance.filter(item => item.meal_date === dateKey()).sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at));
}

function renderCheckin() {
  const records = recentAttendance();
  return `<div class="page-stack">${heading("Controle da cantina", "QR Code da refeição", "Gere o código do dia e exiba na entrada da cantina.")}<section class="qr-control-grid"><article class="card qr-print-card"><div class="section-head"><div><h2>QR Code de hoje</h2><p>ConfirmaEdu • ${formatDate(dateKey())}</p></div><span class="pill ${data.qrSession ? "pill-green" : "pill-orange"}">${data.qrSession ? "Ativo" : "Não gerado"}</span></div>${data.qrSession ? `<div id="school-qr" class="school-qr" aria-label="QR Code para registrar a refeição"></div><div class="qr-print-actions"><button class="button button-primary button-full" data-action="print-qr">Imprimir QR Code</button></div>` : `<div class="qr-empty">${emptyState("▦", "Gere o QR Code do dia", "O mesmo código funcionará durante o dia de hoje.")}<button class="button button-primary button-full" data-action="generate-qr">Gerar QR Code</button></div>`}</article><article class="card qr-instructions"><span class="stat-icon blue">▦</span><h2>Como registrar</h2><ol><li>O aluno entra no próprio perfil.</li><li>Toca em <strong>Abrir câmera</strong>.</li><li>Aponta para o QR Code do dia.</li><li>A presença aparece para a cantina e a direção.</li></ol></article></section><section class="two-columns"><article class="card"><div class="section-head"><div><h2>Entrada manual</h2><p>Alternativa para registrar pela matrícula</p></div><span class="stat-icon blue">✓</span></div><form id="checkin-form" class="form-grid"><label>Matrícula do aluno<input name="registration" placeholder="Digite a matrícula" required></label><button class="button button-primary" type="submit">Registrar refeição</button></form></article><article class="card"><div class="section-head"><div><h2>Registros de hoje</h2><p>QR Code e entradas manuais</p></div><span class="pill pill-green">${records.length} registros</span></div>${records.length ? records.slice(0, 10).map(item => { const student = profileById(item.user_id); return `<div class="checkin-row"><span class="row-icon green">✓</span><div class="row-main"><strong>${escapeHTML(student.full_name || "Aluno")}</strong><small>${escapeHTML(student.classroom || "Sem turma")} • ${escapeHTML(item.method === "manual" ? "Manual" : "QR Code")}</small></div><span class="badge badge-green">${formatDateTime(item.checked_in_at)}</span></div>`; }).join("") : emptyState("✓", "Nenhuma refeição registrada", "Os novos registros aparecerão aqui.")}</article></section></div>`;
}

function todayAbsences() {
  const attended = new Set(data.attendance.filter(item => item.meal_date === dateKey()).map(item => item.user_id));
  return data.confirmations.filter(item => item.meal_date === dateKey() && item.will_eat && !attended.has(item.user_id)).map(item => ({ ...profileById(item.user_id), confirmation: item }));
}

function renderDirectionView() {
  if (ui.view === "ausencias") return renderAbsences();
  if (ui.view === "justificativas") return renderJustifications();
  if (ui.view === "cardapio") return renderMenu(true);
  if (ui.view === "acessos") return renderAccessRequests();
  if (ui.view === "relatorios") return renderReports();
  return renderDirectionHome();
}

function renderDirectionHome() {
  const absences = todayAbsences();
  const pendingDocs = data.justifications.filter(item => item.status === "pending");
  const pendingStaff = data.profiles.filter(item => item.role === "pending");
  const totals = staffTotals();
  return `<div class="page-stack">${heading("Painel da direção", "Visão geral", "Ausências, justificativas e acessos do sistema.", `<button class="button button-secondary" data-action="export-csv">⇩ Exportar</button>`)}<section class="stats-grid">${statCard("!", "orange", "Confirmaram e não chegaram", absences.length, "registros de hoje")}${statCard("▤", "blue", "Justificativas pendentes", pendingDocs.length, "documentos para análise")}${statCard("♟", "purple", "Acessos pendentes", pendingStaff.length, "funcionários aguardando")}${statCard("♨", "green", "Refeições servidas", totals.served, "hoje")}</section><section class="two-columns"><article class="card"><div class="section-head"><div><h2>Ausências de hoje</h2><p>Confirmaram e ainda não compareceram</p></div><span class="pill pill-orange">${absences.length} alunos</span></div>${absences.length ? absences.slice(0, 6).map(personRow).join("") : emptyState("✓", "Nenhuma ausência até agora", "Os registros serão atualizados automaticamente.")}<button class="button button-secondary button-small" style="margin-top:11px" data-action="navigate" data-view="ausencias">Ver lista completa →</button></article><article class="card"><div class="section-head"><div><h2>Solicitações de acesso</h2><p>Funcionários aguardando aprovação</p></div></div>${pendingStaff.length ? pendingStaff.slice(0, 5).map(staffRequestRow).join("") : emptyState("♟", "Nenhuma solicitação", "Novos cadastros da cantina e direção aparecerão aqui.")}<button class="button button-secondary button-small" style="margin-top:11px" data-action="navigate" data-view="acessos">Gerenciar acessos →</button></article></section></div>`;
}

function personRow(person) {
  return `<div class="person-row"><span class="avatar">${initialsFromName(person.full_name)}</span><div class="row-main"><strong>${escapeHTML(person.full_name || "Aluno")}</strong><small>${escapeHTML(person.classroom || "Sem turma")} • ${escapeHTML(person.registration || "")}</small></div><span class="badge badge-orange">Aguardando</span></div>`;
}

function renderAbsences() {
  const query = ui.search.toLowerCase();
  const items = todayAbsences().filter(person => `${person.full_name} ${person.registration} ${person.classroom}`.toLowerCase().includes(query));
  return `<div class="page-stack">${heading("Gestão de ausências", "Confirmaram e ainda não almoçaram", "Dados de hoje atualizados pelo sistema.", `<button class="button button-primary" data-action="export-csv">⇩ CSV</button>`)}<section class="card"><form id="search-form" class="search-row"><input name="search" value="${escapeHTML(ui.search)}" placeholder="Pesquisar aluno ou turma"><button class="button button-secondary">Pesquisar</button></form>${items.length ? items.map(personRow).join("") : emptyState("✓", "Nenhum aluno encontrado", "Não há ausências com esse filtro.")}</section></div>`;
}

function renderJustifications() {
  return `<div class="page-stack">${heading("Documentos", "Justificativas", "Analise os PDFs enviados pelos alunos.")}<section class="card"><div class="section-head"><div><h2>Documentos recebidos</h2><p>Comprovantes encaminhados para análise</p></div><span class="pill pill-blue">${data.justifications.length} documentos</span></div>${data.justifications.length ? data.justifications.map(item => { const student = profileById(item.student_id); return `<div class="document-row"><span class="row-icon blue">▤</span><div class="row-main"><strong>${escapeHTML(student.full_name || "Aluno")}</strong><small>${escapeHTML(student.classroom || "Sem turma")} • ${formatDate(item.absence_date)} • ${escapeHTML(item.file_name)}</small></div><span class="badge badge-${item.status === "approved" ? "green" : item.status === "rejected" ? "gray" : "orange"}">${statusLabel(item.status)}</span><button class="button button-secondary button-small" data-action="view-document" data-id="${item.id}">Visualizar</button>${item.status === "pending" ? `<button class="button button-success button-small" data-action="review-document" data-id="${item.id}" data-status="approved">Aprovar</button><button class="button button-danger button-small" data-action="review-document" data-id="${item.id}" data-status="rejected">Recusar</button>` : ""}</div>`; }).join("") : emptyState("▤", "Nenhum documento", "As justificativas enviadas aparecerão aqui.")}</section></div>`;
}

function staffRequestRow(profile) {
  return `<div class="document-row"><span class="avatar">${initialsFromName(profile.full_name)}</span><div class="row-main"><strong>${escapeHTML(profile.full_name)}</strong><small>${escapeHTML(profile.registration)} • Solicitou ${escapeHTML(ROLE_CONFIG[profile.requested_role]?.label || profile.requested_role)}</small></div><button class="button button-success button-small" data-action="approve-staff" data-id="${profile.id}" data-role="${profile.requested_role === "direction" ? "direction" : "canteen"}">Aprovar</button></div>`;
}

function renderAccessRequests() {
  const pending = data.profiles.filter(profile => profile.role === "pending");
  const staff = data.profiles.filter(profile => ["canteen", "direction"].includes(profile.role));
  return `<div class="page-stack">${heading("Controle de acesso", "Usuários da equipe", "Aprove os cadastros da cantina e da direção.")}<section class="card"><div class="section-head"><div><h2>Aguardando aprovação</h2><p>Somente a direção pode liberar funcionários</p></div><span class="pill pill-orange">${pending.length} pendentes</span></div>${pending.length ? pending.map(staffRequestRow).join("") : emptyState("✓", "Nenhuma solicitação pendente", "Todos os pedidos já foram analisados.")}</section><section class="card"><div class="section-head"><div><h2>Equipe com acesso</h2><p>Contas atualmente liberadas</p></div></div>${staff.length ? staff.map(profile => `<div class="person-row"><span class="avatar">${initialsFromName(profile.full_name)}</span><div class="row-main"><strong>${escapeHTML(profile.full_name)}</strong><small>${escapeHTML(profile.registration)}</small></div><span class="badge badge-${profile.role === "direction" ? "blue" : "green"}">${roleLabel(profile.role)}</span></div>`).join("") : emptyState("♟", "Nenhum funcionário cadastrado", "Os usuários aprovados aparecerão aqui.")}</section></div>`;
}

function renderReports() {
  const yes = data.confirmations.filter(item => item.will_eat).length;
  const served = data.attendance.length;
  const justified = data.justifications.filter(item => item.status === "approved").length;
  const rate = yes ? Math.round(served / yes * 100) : 0;
  const days = weekDates();
  const daily = days.map(day => {
    const confirmed = data.confirmations.filter(item => item.meal_date === day && item.will_eat).length;
    const attended = data.attendance.filter(item => item.meal_date === day).length;
    return { day, confirmed, attended, rate: confirmed ? Math.min(100, Math.round(attended / confirmed * 100)) : 0 };
  });
  return `<div class="page-stack">${heading("Indicadores", "Relatórios", "Resumo criado a partir dos registros do sistema.", `<button class="button button-secondary" data-action="print">Imprimir</button>`)}<section class="stats-grid">${statCard("♟", "blue", "Confirmações", yes, "no período carregado")}${statCard("♨", "green", "Refeições registradas", served, `${rate}% das confirmações`)}${statCard("▤", "purple", "Justificativas aprovadas", justified, "documentos analisados")}${statCard("▦", "orange", "Alunos cadastrados", staffStudents().length, "contas ativas")}</section><section class="card"><div class="section-head"><div><h2>Presença na semana</h2><p>Percentual das confirmações que compareceram</p></div></div><div class="bar-chart">${daily.map(item => `<div class="bar-item"><div class="bar"><span style="height:${item.rate}%" data-value="${item.rate}%"></span></div><strong>${new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Fortaleza" }).format(parseDate(item.day)).replace(".", "").toUpperCase()}</strong></div>`).join("")}</div></section></div>`;
}

function renderModal() {
  if (!ui.modal) return "";
  if (ui.modal.type === "justify") return justificationModal(ui.modal.date);
  if (ui.modal.type === "edit-menu") return menuModal(ui.modal.date);
  if (ui.modal.type === "document") return documentModal(ui.modal.id);
  if (ui.modal.type === "qr-scanner") return qrScannerModal();
  if (ui.modal.type === "qr-success") return qrSuccessModal();
  return "";
}

function modalShell(title, content, wide = false) {
  return `<div class="modal-layer" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar janela"></button><section class="modal ${wide ? "wide" : ""}"><header class="modal-head"><h2>${escapeHTML(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body">${content}</div></section></div>`;
}

function justificationModal(day) {
  return modalShell("Justificar ausência", `<form id="justification-form" class="form-grid" data-date="${day}"><div class="local-box"><span>!</span><div><strong>${formatDate(day)}</strong><p>Você confirmou, mas não registrou a refeição.</p></div></div><label>Motivo da ausência<textarea name="reason" placeholder="Explique brevemente o motivo…" required></textarea></label><label class="file-box"><span>⇧</span><strong id="file-name">Anexar comprovante em PDF</strong><small>Arquivo PDF de até 5 MB</small><input id="pdf-file" name="pdf" type="file" accept="application/pdf" required></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Enviar justificativa</button></div></form>`);
}

function menuModal(day) {
  const item = menuForDate(day);
  return modalShell("Editar cardápio", `<form id="menu-form" class="form-grid" data-date="${day}"><div class="local-box"><span>☷</span><div><strong>${formatDate(day)}</strong><p>Informe a refeição planejada.</p></div></div><label>Prato principal<input name="main" value="${escapeHTML(item?.main_dish || "")}" required></label><label>Acompanhamentos<input name="sides" value="${escapeHTML(item?.sides || "")}"></label><label>Sobremesa ou fruta<input name="dessert" value="${escapeHTML(item?.dessert || "")}"></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Salvar cardápio</button></div></form>`);
}

function documentModal(id) {
  const item = data.justifications.find(document => String(document.id) === String(id));
  if (!item) return "";
  const student = profileById(item.student_id);
  return modalShell("Visualizar justificativa", `<div class="document-preview"><article class="paper"><strong>ConfirmaEdu — justificativa</strong><h3>JUSTIFICATIVA DE AUSÊNCIA</h3><p><strong>Aluno:</strong> ${escapeHTML(student.full_name || "Aluno")}</p><p><strong>Data:</strong> ${formatDate(item.absence_date)}</p><p><strong>Motivo:</strong> ${escapeHTML(item.reason)}</p></article><aside class="document-info"><span class="row-icon blue">▤</span><h3>${escapeHTML(item.file_name)}</h3><p>PDF enviado pelo aluno</p><dl><div><dt>Turma</dt><dd>${escapeHTML(student.classroom || "Não informada")}</dd></div><div><dt>Situação</dt><dd>${statusLabel(item.status)}</dd></div></dl><button class="button button-primary button-full" data-action="open-pdf" data-id="${item.id}">Abrir PDF</button></aside></div>`, true);
}

function qrScannerModal() {
  return modalShell("Ler QR Code da escola", `<div class="qr-scanner"><div class="camera-frame"><video id="qr-video" autoplay muted playsinline></video><canvas id="qr-canvas" hidden></canvas><span class="scan-guide" aria-hidden="true"></span></div><div id="qr-status" class="scanner-status"><span class="status-dot"></span>Preparando a câmera…</div><p>Aponte a câmera para o QR Code exibido na cantina.</p></div>`);
}

function qrSuccessModal() {
  const checkin = todayAttendance();
  return modalShell("Presença registrada", `<div class="qr-success"><span>✓</span><h2>Refeição confirmada!</h2><p>${escapeHTML(ui.profile.full_name)}, sua presença foi registrada${checkin ? ` às ${formatDateTime(checkin.checked_in_at)}` : ""}.</p><button class="button button-success button-full" data-action="close-modal">Concluir</button></div>`);
}

function renderSchoolQr() {
  const container = document.getElementById("school-qr");
  if (!container || !data.qrSession?.token) return;
  if (typeof window.qrcode !== "function") {
    container.innerHTML = "<strong>Não foi possível gerar o QR Code.</strong>";
    return;
  }
  const code = window.qrcode(0, "M");
  code.addData(`${QR_PREFIX}${data.qrSession.token}`, "Byte");
  code.make();
  container.innerHTML = code.createSvgTag({ cellSize: 7, margin: 4, scalable: true });
}

async function boot() {
  applyTheme();
  if (!isConfigured) {
    ui.booting = false;
    render();
    return;
  }
  try {
    const { data: sessionData, error } = await backend.auth.getSession();
    if (error) throw error;
    ui.session = sessionData.session;
    if (ui.session) await loadCurrentAccount();
  } catch (error) {
    console.error(error);
    await backend.auth.signOut().catch(() => {});
    ui.session = null;
    ui.profile = null;
  }
  ui.booting = false;
  render();
}

async function loadCurrentAccount() {
  const userId = ui.session?.user?.id;
  if (!userId) return;
  let { data: profile, error } = await backend.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  if (profile.role === "pending" && profile.requested_role === "direction") {
    const bootstrap = await backend.rpc("bootstrap_first_direction");
    if (!bootstrap.error && bootstrap.data === true) {
      const refreshed = await backend.from("profiles").select("*").eq("id", userId).single();
      if (!refreshed.error) profile = refreshed.data;
    }
  }
  ui.profile = profile;
  if (profile.role !== "pending") {
    await refreshData(false);
    subscribeRealtime();
  }
}

async function refreshData(showMessage = true) {
  if (!backend || !ui.profile || ui.profile.role === "pending") return;
  const start = firstDayRange(45);
  const end = dateKey();
  const requests = [
    backend.from("profiles").select("*").order("full_name"),
    backend.from("meal_confirmations").select("*").gte("meal_date", start).lte("meal_date", end).order("meal_date", { ascending: false }),
    backend.from("attendance").select("*").gte("meal_date", start).lte("meal_date", end).order("checked_in_at", { ascending: false }),
    backend.from("weekly_menu").select("*").gte("menu_date", weekDates()[0]).lte("menu_date", weekDates()[4]).order("menu_date"),
    backend.from("justifications").select("*").order("created_at", { ascending: false }),
    backend.from("qr_sessions").select("token, meal_date, active, expires_at").eq("meal_date", dateKey()).eq("active", true).maybeSingle(),
  ];
  const results = await Promise.all(requests);
  const fatal = results.slice(0, 5).find(result => result.error);
  if (fatal) throw fatal.error;
  data.profiles = results[0].data || [];
  data.confirmations = results[1].data || [];
  data.attendance = results[2].data || [];
  data.menu = results[3].data || [];
  data.justifications = results[4].data || [];
  data.qrSession = results[5].error ? null : results[5].data;
  render();
  if (showMessage) showToast("Dados atualizados.");
}

function subscribeRealtime() {
  if (realtimeChannel) backend.removeChannel(realtimeChannel);
  realtimeChannel = backend.channel(`confirmaedu-${ui.profile.id}`);
  ["profiles", "meal_confirmations", "attendance", "weekly_menu", "justifications", "qr_sessions"].forEach(table => {
    realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
      clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => refreshData(false).catch(console.error), 350);
    });
  });
  realtimeChannel.subscribe();
}

async function startQrScanner() {
  stopQrScanner();
  const video = document.getElementById("qr-video");
  const status = document.getElementById("qr-status");
  if (!video || !status) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    status.innerHTML = "⚠ Câmera não disponível neste navegador.";
    status.classList.add("error");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (ui.modal?.type !== "qr-scanner" || !document.getElementById("qr-video")) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    qrStream = stream;
    video.srcObject = stream;
    await video.play();
    qrScanning = true;
    qrLastScan = 0;
    status.innerHTML = '<span class="status-dot"></span>Câmera ativa — procurando QR Code';
    qrFrameId = requestAnimationFrame(scanQrFrame);
  } catch {
    status.innerHTML = "⚠ Não foi possível acessar a câmera. Verifique a permissão.";
    status.classList.add("error");
  }
}

function scanQrFrame(timestamp) {
  if (!qrScanning || ui.modal?.type !== "qr-scanner") return;
  const video = document.getElementById("qr-video");
  const canvas = document.getElementById("qr-canvas");
  if (!video || !canvas) return stopQrScanner();
  if (timestamp - qrLastScan > 160 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    qrLastScan = timestamp;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width && height && typeof window.jsQR === "function") {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      const result = window.jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
      if (result?.data) {
        completeQrCheckin(result.data);
        return;
      }
    }
  }
  qrFrameId = requestAnimationFrame(scanQrFrame);
}

function stopQrScanner() {
  qrScanning = false;
  if (qrFrameId) cancelAnimationFrame(qrFrameId);
  qrFrameId = null;
  if (qrStream) qrStream.getTracks().forEach(track => track.stop());
  qrStream = null;
}

async function completeQrCheckin(value) {
  const text = String(value || "").trim();
  const status = document.getElementById("qr-status");
  if (!text.startsWith(QR_PREFIX)) {
    if (status) { status.textContent = "QR Code não reconhecido. Use o código da cantina."; status.classList.add("error"); }
    return;
  }
  stopQrScanner();
  if (status) status.textContent = "Validando presença…";
  const token = text.slice(QR_PREFIX.length);
  const { error } = await backend.rpc("register_qr_attendance", { p_token: token });
  if (error) {
    ui.modal = null;
    render();
    showToast(error.message.includes("inválido") ? error.message : "Não foi possível validar este QR Code.", "error");
    return;
  }
  await refreshData(false);
  ui.modal = { type: "qr-success" };
  render();
  showToast("Presença registrada pelo QR Code.");
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "toggle-theme") {
    ui.theme = ui.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, ui.theme);
    render();
    return;
  }
  if (action === "select-login-role") { ui.loginRole = button.dataset.role; render(); return; }
  if (action === "select-register-role") { ui.registerRole = button.dataset.role; render(); return; }
  if (action === "show-register") { ui.authMode = "register"; ui.registerRole = ui.loginRole; render(); return; }
  if (action === "show-login") { ui.authMode = "login"; render(); return; }
  if (action === "toggle-password") { const input = document.getElementById("login-password"); if (input) input.type = input.type === "password" ? "text" : "password"; return; }
  if (action === "open-mobile-menu") { ui.mobileMenu = true; render(); return; }
  if (action === "close-mobile-menu") { ui.mobileMenu = false; render(); return; }
  if (action === "navigate") { stopQrScanner(); ui.view = button.dataset.view; ui.mobileMenu = false; ui.search = ""; render(); return; }
  if (action === "close-modal") { stopQrScanner(); ui.modal = null; render(); return; }
  if (action === "print" || action === "print-qr") { window.print(); return; }

  try {
    if (action === "logout") {
      stopQrScanner();
      if (realtimeChannel) await backend.removeChannel(realtimeChannel);
      await backend.auth.signOut();
      ui.session = null; ui.profile = null; ui.view = "inicio"; ui.authMode = "login"; ui.mobileMenu = false;
      Object.keys(data).forEach(key => { data[key] = key === "qrSession" ? null : []; });
      render();
      return;
    }
    if (action === "refresh-account") {
      setButtonBusy(button, true);
      const sessionResult = await backend.auth.getSession();
      ui.session = sessionResult.data.session;
      await loadCurrentAccount();
      render();
      if (ui.profile?.role === "pending") showToast("O acesso ainda aguarda aprovação.", "error");
      return;
    }
    if (action === "refresh-data") { setButtonBusy(button, true); await refreshData(); return; }
    if (action === "attendance") {
      setButtonBusy(button, true);
      const { error } = await backend.from("meal_confirmations").upsert({ user_id: ui.profile.id, meal_date: dateKey(), will_eat: button.dataset.value === "yes", updated_at: new Date().toISOString() }, { onConflict: "user_id,meal_date" });
      if (error) throw error;
      await refreshData(false);
      showToast(button.dataset.value === "yes" ? "Almoço confirmado." : "A cantina recebeu que você não irá almoçar.");
      return;
    }
    if (action === "open-qr-scanner") { ui.modal = { type: "qr-scanner" }; render(); setTimeout(startQrScanner, 0); return; }
    if (action === "generate-qr") {
      setButtonBusy(button, true, "Gerando…");
      const { error } = await backend.rpc("generate_daily_qr");
      if (error) throw error;
      await refreshData(false);
      showToast("QR Code do dia gerado.");
      return;
    }
    if (action === "justify") { ui.modal = { type: "justify", date: button.dataset.date }; render(); return; }
    if (action === "edit-menu") { ui.modal = { type: "edit-menu", date: button.dataset.date }; render(); return; }
    if (action === "view-document") { ui.modal = { type: "document", id: button.dataset.id }; render(); return; }
    if (action === "open-pdf") {
      const item = data.justifications.find(entry => entry.id === button.dataset.id);
      if (!item) return;
      const popup = window.open("about:blank", "_blank");
      const { data: signed, error } = await backend.storage.from("justifications").createSignedUrl(item.file_path, 60);
      if (error) { popup?.close(); throw error; }
      if (popup) popup.location = signed.signedUrl; else window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (action === "review-document") {
      setButtonBusy(button, true);
      const { error } = await backend.rpc("review_justification", { p_justification_id: button.dataset.id, p_status: button.dataset.status });
      if (error) throw error;
      await refreshData(false);
      showToast(button.dataset.status === "approved" ? "Justificativa aprovada." : "Justificativa recusada.");
      return;
    }
    if (action === "approve-staff") {
      const confirmed = window.confirm(`Liberar este usuário como ${ROLE_CONFIG[button.dataset.role]?.label}?`);
      if (!confirmed) return;
      setButtonBusy(button, true);
      const { error } = await backend.rpc("approve_staff", { p_user_id: button.dataset.id, p_role: button.dataset.role });
      if (error) throw error;
      await refreshData(false);
      showToast("Acesso liberado com sucesso.");
      return;
    }
    if (action === "export-csv") { exportCSV(); return; }
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível concluir a ação.", "error");
    setButtonBusy(button, false);
  }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type="submit"]');
  try {
    if (form.id === "login-form") {
      const values = new FormData(form);
      const identifier = normalizeIdentifier(values.get("identifier"));
      const password = String(values.get("password") || "");
      const errorBox = document.getElementById("login-error");
      if (!identifier) { errorBox.textContent = "Informe seu usuário ou matrícula."; errorBox.classList.add("show"); return; }
      setButtonBusy(submit, true, "Entrando…");
      const login = await backend.auth.signInWithPassword({ email: accountEmail(identifier), password });
      if (login.error) throw new Error("Usuário ou senha incorretos.");
      ui.session = login.data.session;
      await loadCurrentAccount();
      const requestedLogin = ui.loginRole;
      const actualRole = ui.profile.role === "pending" ? ui.profile.requested_role : ui.profile.role;
      if (requestedLogin !== actualRole) {
        await backend.auth.signOut();
        ui.session = null; ui.profile = null;
        throw new Error(`Este cadastro pertence ao perfil ${ROLE_CONFIG[actualRole]?.label || roleLabel(actualRole)}.`);
      }
      ui.view = "inicio";
      render();
      return;
    }
    if (form.id === "register-form") {
      const values = new FormData(form);
      const name = String(values.get("name") || "").trim().replace(/\s+/g, " ");
      const identifier = normalizeIdentifier(values.get("identifier"));
      const classroom = ui.registerRole === "student" ? String(values.get("classroom") || "") : null;
      const password = String(values.get("password") || "");
      const confirmation = String(values.get("passwordConfirm") || "");
      const errorBox = document.getElementById("register-error");
      const fail = message => { errorBox.textContent = message; errorBox.classList.add("show"); };
      if (name.length < 3) return fail("Informe o nome completo.");
      if (!/^[a-z0-9._-]{3,30}$/.test(identifier)) return fail("Use de 3 a 30 letras, números, ponto, traço ou underline.");
      if (ui.registerRole === "student" && !classroom) return fail("Selecione sua turma.");
      if (password.length < 6) return fail("A senha deve ter pelo menos 6 caracteres.");
      if (password !== confirmation) return fail("As senhas não coincidem.");
      setButtonBusy(submit, true, "Criando…");
      const signup = await backend.auth.signUp({
        email: accountEmail(identifier),
        password,
        options: { data: { full_name: name, registration: identifier, classroom, requested_role: ui.registerRole } },
      });
      if (signup.error) {
        if (signup.error.message.toLowerCase().includes("already")) throw new Error("Este usuário ou matrícula já possui cadastro.");
        throw signup.error;
      }
      let session = signup.data.session;
      if (!session) {
        const login = await backend.auth.signInWithPassword({ email: accountEmail(identifier), password });
        if (login.error) throw new Error("Cadastro criado, mas a confirmação de e-mail está ativada no Supabase. Desative essa opção seguindo o GUIA-RAPIDO.md.");
        session = login.data.session;
      }
      ui.session = session;
      await loadCurrentAccount();
      ui.loginRole = ui.registerRole;
      ui.authMode = "login";
      ui.view = "inicio";
      render();
      showToast(ui.profile.role === "pending" ? "Cadastro enviado para aprovação." : "Cadastro criado com sucesso.");
      return;
    }
    if (form.id === "checkin-form") {
      setButtonBusy(submit, true, "Registrando…");
      const registration = normalizeIdentifier(new FormData(form).get("registration"));
      const { error } = await backend.rpc("register_manual_attendance", { p_registration: registration });
      if (error) throw error;
      form.reset();
      await refreshData(false);
      showToast("Refeição registrada na cantina.");
      return;
    }
    if (form.id === "menu-form") {
      setButtonBusy(submit, true, "Salvando…");
      const values = new FormData(form);
      const payload = { menu_date: form.dataset.date, main_dish: String(values.get("main") || "").trim(), sides: String(values.get("sides") || "").trim(), dessert: String(values.get("dessert") || "").trim(), updated_by: ui.profile.id, updated_at: new Date().toISOString() };
      const { error } = await backend.from("weekly_menu").upsert(payload, { onConflict: "menu_date" });
      if (error) throw error;
      ui.modal = null;
      await refreshData(false);
      showToast("Cardápio atualizado.");
      return;
    }
    if (form.id === "search-form") { ui.search = String(new FormData(form).get("search") || "").trim(); render(); return; }
    if (form.id === "justification-form") {
      const values = new FormData(form);
      const file = document.getElementById("pdf-file")?.files?.[0];
      if (!file || file.type !== "application/pdf") throw new Error("Selecione um arquivo PDF válido.");
      if (file.size > MAX_PDF_SIZE) throw new Error("O PDF deve ter no máximo 5 MB.");
      setButtonBusy(submit, true, "Enviando…");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const filePath = `${ui.profile.id}/${crypto.randomUUID()}-${safeName}`;
      const upload = await backend.storage.from("justifications").upload(filePath, file, { contentType: "application/pdf", upsert: false });
      if (upload.error) throw upload.error;
      const insert = await backend.from("justifications").insert({ student_id: ui.profile.id, absence_date: form.dataset.date, reason: String(values.get("reason") || "").trim(), file_path: filePath, file_name: file.name });
      if (insert.error) {
        await backend.storage.from("justifications").remove([filePath]);
        throw insert.error;
      }
      ui.modal = null;
      await refreshData(false);
      showToast("Justificativa enviada para a direção.");
    }
  } catch (error) {
    console.error(error);
    const target = form.querySelector(".login-error");
    if (target) { target.textContent = error.message || "Não foi possível continuar."; target.classList.add("show"); }
    else showToast(error.message || "Não foi possível concluir.", "error");
    setButtonBusy(submit, false);
  }
});

document.addEventListener("change", event => {
  if (event.target.id !== "pdf-file") return;
  const file = event.target.files[0];
  const label = document.getElementById("file-name");
  if (file && label) label.textContent = file.name;
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && ui.modal) { stopQrScanner(); ui.modal = null; render(); }
});

function exportCSV() {
  const rows = [["Aluno", "Matrícula", "Turma", "Data", "Situação"], ...todayAbsences().map(person => [person.full_name, person.registration, person.classroom || "", dateKey(), "Confirmou e ainda não compareceu"])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `confirmaedu-ausencias-${dateKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Lista de ausências exportada.");
}

boot();
