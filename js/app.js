import { getSupabaseConfigError, requireSupabase } from "./supabase.js";
import {
  errorMessage, escapeHtml, getCurrentProfile, isConfigured, refreshIcons,
  renderAppShell, showSetupPage, showToast
} from "./common.js";
import { initializeAuthPage, initPasswordToggles } from "./auth.js";
import {
  donorDashboard, donorDonations, donorProfileMarkup, initializeDonorDonationTable,
  initializeDonationForm, initializeDonorProfile
} from "./donor.js";
import {
  initializeClaimStatusUpdates, initializeMarketplace, marketplaceMarkup,
  ngoClaims, ngoDashboard
} from "./ngo.js";
import {
  adminClaims, adminDashboard, adminDonations, adminReports, adminUsers,
  initializeAdminClaimUpdates, initializeAdminDonations, initializeCharts,
  initializeUsers
} from "./admin.js";

const page = document.body.dataset.page;

function showPageError(error) {
  const content = document.querySelector("#app .page-content");
  if (content) {
    content.innerHTML = `<section class="error-panel"><h1>We couldn’t load this page</h1><p>${escapeHtml(errorMessage(error))}</p><p>If the problem continues, refresh the page or contact your FoodShare administrator.</p></section>`;
  } else {
    const notice = document.querySelector("#auth-setup-notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = errorMessage(error);
    } else {
      showToast(errorMessage(error), "error");
    }
  }
}

async function loadLandingStats() {
  const paragraph = document.querySelector(".impact-heading > p");
  if (!isConfigured()) {
    const notice = document.createElement("div");
    notice.className = "notice notice-info";
    notice.textContent = `${getSupabaseConfigError()} Live impact statistics are unavailable until this is corrected.`;
    document.querySelector(".impact-grid").after(notice);
    return;
  }
  try {
    const { data, error } = await requireSupabase().rpc("public_platform_stats");
    if (error) throw error;
    document.querySelector("#impact-food").textContent = Number(data.food_donated || 0).toLocaleString();
    document.querySelector("#impact-meals").textContent = Number(data.meals_redistributed || 0).toLocaleString();
    document.querySelector("#impact-ngos").textContent = Number(data.active_ngos || 0).toLocaleString();
    document.querySelector("#impact-completed").textContent = Number(data.successful_donations || 0).toLocaleString();
  } catch (error) {
    const notice = document.createElement("div");
    notice.className = "notice notice-info";
    notice.textContent = `Live impact statistics could not be loaded: ${errorMessage(error)}`;
    document.querySelector(".impact-grid").after(notice);
    if (paragraph) paragraph.textContent = "Impact statistics are updated from live community donations.";
  }
}

function initializePublicPage() {
  const year = document.querySelector("#current-year");
  if (year) year.textContent = String(new Date().getFullYear());
  const toggle = document.querySelector(".mobile-menu-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const nav = document.querySelector(".site-nav");
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.innerHTML = `<i data-lucide="${open ? "x" : "menu"}"></i>`;
      refreshIcons();
    });
  }
  loadLandingStats();
}

async function requireRole(role) {
  if (!isConfigured()) {
    showSetupPage();
    return null;
  }
  const profile = await getCurrentProfile();
  if (!profile) {
    window.location.replace("../login.html");
    return null;
  }
  if (!profile.is_active) {
    await requireSupabase().auth.signOut();
    throw new Error("Your account is currently inactive. Please contact FoodShare support.");
  }
  if (profile.role !== role) {
    window.location.replace(`../${profile.role}/dashboard.html`);
    return null;
  }
  const { error: expiryError } = await requireSupabase().rpc("expire_food_donations");
  if (expiryError) throw expiryError;
  return profile;
}

async function initializeDashboard() {
  const role = document.body.dataset.role;
  const profile = await requireRole(role);
  if (!profile) return;
  const loading = `<div class="loading-state"><span class="spinner"></span> Loading your FoodShare workspace…</div>`;
  renderAppShell(profile, page, loading);

  if (page === "donor-dashboard") {
    renderAppShell(profile, page, await donorDashboard(profile));
  } else if (page === "donor-add") {
    await initializeDonationForm(profile);
  } else if (page === "donor-donations") {
    const result = await donorDonations();
    document.querySelector("#app .page-content").innerHTML = result.content;
    await initializeDonorDonationTable(result.rows);
    refreshIcons();
  } else if (page === "donor-profile" || page === "ngo-profile") {
    document.querySelector("#app .page-content").innerHTML = donorProfileMarkup(profile);
    initializeDonorProfile(profile);
    refreshIcons();
  } else if (page === "ngo-dashboard") {
    renderAppShell(profile, page, await ngoDashboard(profile));
  } else if (page === "ngo-marketplace") {
    document.querySelector("#app .page-content").innerHTML = marketplaceMarkup();
    refreshIcons();
    initializeMarketplace();
  } else if (page === "ngo-claims") {
    document.querySelector("#app .page-content").innerHTML = await ngoClaims();
    initializeClaimStatusUpdates();
    refreshIcons();
  } else if (page === "admin-dashboard") {
    const result = await adminDashboard();
    renderAppShell(profile, page, result.content);
    await initializeCharts(result.charts);
  } else if (page === "admin-users") {
    const result = await adminUsers();
    document.querySelector("#app .page-content").innerHTML = result.content;
    initializeUsers(result.rows);
    refreshIcons();
  } else if (page === "admin-donations") {
    const result = await adminDonations();
    document.querySelector("#app .page-content").innerHTML = result.content;
    initializeAdminDonations(result.donations, result.users);
    refreshIcons();
  } else if (page === "admin-claims") {
    document.querySelector("#app .page-content").innerHTML = await adminClaims();
    await initializeAdminClaimUpdates();
    refreshIcons();
  } else if (page === "admin-reports") {
    const result = await adminReports();
    document.querySelector("#app .page-content").innerHTML = result.content;
    await initializeCharts(result.charts);
    refreshIcons();
  } else {
    throw new Error("This dashboard page is not configured.");
  }
}

async function start() {
  if (window.lucide) refreshIcons();
  if (page === "home") {
    initializePublicPage();
    return;
  }
  if (page === "login" || page === "register") {
    initPasswordToggles();
    await initializeAuthPage(page);
    return;
  }
  try {
    await initializeDashboard();
  } catch (error) {
    showPageError(error);
  }
}

start();
