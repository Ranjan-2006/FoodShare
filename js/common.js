import { getSupabaseConfigError, isSupabaseConfigured, requireSupabase } from "./supabase.js";

export const ROLE_PATHS = {
  donor: "donor/dashboard.html",
  ngo: "ngo/dashboard.html",
  admin: "admin/dashboard.html"
};
export const CATEGORIES = ["Cooked Food", "Raw Food", "Bakery", "Fruits", "Vegetables", "Packaged Food"];
export const DONATION_STATUSES = ["available", "claimed", "picked_up", "completed", "expired"];
export const CLAIM_STATUSES = ["approved", "picked_up", "completed", "cancelled"];

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export function showToast(message, type = "success") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4800);
}

export function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatRelative(value) {
  if (!value) return "—";
  const difference = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(difference)) return "—";
  const hours = Math.round(difference / 3600000);
  if (hours < 0) return "Expired";
  if (hours < 1) return "Less than 1 hour";
  if (hours < 24) return `${hours} hours left`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export function formatQuantity(quantity, unit) {
  return `${Number(quantity).toLocaleString()} ${unit || ""}`.trim();
}

export function statusBadge(status) {
  const text = String(status || "unknown").replaceAll("_", " ");
  return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(text)}</span>`;
}

export function errorMessage(error) {
  const message = error?.message || "Something went wrong. Please try again.";
  if (/row-level security|permission denied|not allowed/i.test(message)) {
    return "You don’t have permission to do that. Check your account access or contact an administrator.";
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return "This action has already been completed.";
  }
  return message;
}

export function setLoading(button, loading, text = "Please wait…") {
  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${escapeHtml(text)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

export function imageUrl(donation) {
  return donation.image_url || `https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=700&q=80`;
}

export async function uploadDonationImage(file, userId) {
  if (!file) return null;
  if (!file.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) throw new Error("The image must be smaller than 5 MB.");
  const client = requireSupabase();
  const extension = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from("food-images").upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  const { data } = client.storage.from("food-images").getPublicUrl(path);
  return data.publicUrl;
}

export function dashboardUrl(role, page) {
  const prefix = role === "donor" ? "../donor/" : role === "ngo" ? "../ngo/" : "../admin/";
  return `${prefix}${page}.html`;
}

export async function getCurrentProfile() {
  const client = requireSupabase();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) return null;
  const { data, error } = await client.from("users").select("*").eq("id", user.id).single();
  if (error) throw error;
  return { ...data, authUser: user };
}

const NAV_ITEMS = {
  donor: [
    ["dashboard", "LayoutDashboard", "Dashboard"],
    ["add-donation", "CirclePlus", "Add food donation"],
    ["my-donations", "Package", "My donations"],
    ["profile", "UserRound", "My profile"]
  ],
  ngo: [
    ["dashboard", "LayoutDashboard", "Dashboard"],
    ["marketplace", "Search", "Browse food"],
    ["my-claims", "ClipboardList", "My claims"],
    ["profile", "UserRound", "My profile"]
  ],
  admin: [
    ["dashboard", "LayoutDashboard", "Overview"],
    ["users", "UsersRound", "Manage users"],
    ["donations", "PackageSearch", "Manage donations"],
    ["claims", "ClipboardCheck", "Manage claims"],
    ["reports", "ChartNoAxesCombined", "Reports"]
  ]
};

function activeNavKey(page) {
  const pageKeys = {
    "donor-add": "add-donation",
    "donor-donations": "my-donations",
    "ngo-claims": "my-claims"
  };
  if (pageKeys[page]) return pageKeys[page];
  if (page.startsWith("donor-")) return page.slice("donor-".length);
  if (page.startsWith("ngo-")) return page.slice("ngo-".length);
  if (page.startsWith("admin-")) return page.slice("admin-".length);
  return "dashboard";
}

export function renderAppShell(profile, page, content) {
  const role = profile.role;
  const name = profile.full_name || profile.email || "FoodShare member";
  const active = activeNavKey(page);
  const navigation = NAV_ITEMS[role].map(([route, icon, label]) => {
    const url = dashboardUrl(role, route);
    return `<a href="${url}" class="${active === route ? "active" : ""}"><i data-lucide="${icon}"></i><span>${label}</span></a>`;
  }).join("");
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="app-layout">
      <div class="overlay" data-overlay></div>
      <aside class="sidebar">
        <a class="brand" href="../index.html"><span class="brand-mark">f</span> foodshare<span class="brand-dot">.</span></a>
        <div class="sidebar-section-label">${role === "admin" ? "PLATFORM" : "WORKSPACE"}</div>
        <nav class="sidebar-nav" aria-label="Dashboard navigation">${navigation}</nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-user">
          <span class="user-avatar">${escapeHtml((name.trim()[0] || "F").toUpperCase())}</span>
          <span class="sidebar-user-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(profile.organization_name || role)}</small></span>
          <button type="button" class="sidebar-logout" data-logout aria-label="Log out"><i data-lucide="log-out"></i></button>
        </div>
      </aside>
      <div class="app-main">
        <header class="topbar"><button class="mobile-sidebar-toggle" data-menu-toggle aria-label="Open menu"><i data-lucide="menu"></i></button><span class="topbar-title">${role === "admin" ? "Admin panel" : role === "ngo" ? "Community workspace" : "Donor workspace"}</span><div class="topbar-right"><span class="topbar-date">${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span><span class="topbar-user" aria-label="${escapeHtml(name)}">${escapeHtml((name.trim()[0] || "F").toUpperCase())}</span></div></header>
        <main class="page-content">${content}</main>
      </div>
    </div>`;
  document.querySelector("[data-menu-toggle]").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
    document.querySelector("[data-overlay]").classList.toggle("visible");
  });
  document.querySelector("[data-overlay]").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.remove("open");
    document.querySelector("[data-overlay]").classList.remove("visible");
  });
  document.querySelector("[data-logout]").addEventListener("click", logout);
  refreshIcons();
}

export function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

export async function logout() {
  try {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
    window.location.href = "../login.html";
  } catch (error) {
    showToast(errorMessage(error), "error");
  }
}

export function showSetupPage() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.innerHTML = `<main class="page-content"><section class="error-panel"><h1>Connect FoodShare to Supabase</h1><p>${escapeHtml(`${getSupabaseConfigError()} Then run database/schema.sql in your project’s SQL Editor. The app will not pretend that unconfigured data operations succeeded.`)}</p><p><a href="../index.html">Return to the FoodShare homepage</a></p></section></main>`;
}

export function isConfigured() {
  return isSupabaseConfigured;
}
