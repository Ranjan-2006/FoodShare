import { requireSupabase } from "./supabase.js";
import {
  dashboardUrl, errorMessage, escapeHtml, formatDate, formatQuantity, refreshIcons,
  showToast, statusBadge
} from "./common.js";
import { initializeClaimStatusUpdates } from "./ngo.js";

const client = () => requireSupabase();
const heading = (title, description) => `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div></div>`;
const empty = (title, detail) => `<div class="empty-state"><i data-lucide="inbox"></i><strong>${title}</strong><p>${detail}</p></div>`;

async function loadChartJs() {
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Chart.js could not be loaded. Check your internet connection and reload the page."));
    document.head.append(script);
  });
}

function countBy(rows, key, values) {
  return values.map((value) => rows.filter((row) => row[key] === value).length);
}

function renderCharts(donations) {
  const months = [];
  const monthlyCounts = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push(new Intl.DateTimeFormat(undefined, { month: "short" }).format(date));
    monthlyCounts.push(donations.filter((item) => {
      const created = new Date(item.created_at);
      return created.getFullYear() === date.getFullYear() && created.getMonth() === date.getMonth();
    }).length);
  }
  const categories = ["Cooked Food", "Raw Food", "Bakery", "Fruits", "Vegetables", "Packaged Food"];
  const statuses = ["available", "claimed", "picked_up", "completed", "expired"];
  const colors = ["#176b45", "#70a87a", "#b4d4b8", "#d9a955", "#ba7870", "#8d9c8e"];
  const baseFont = { family: "DM Sans", size: 10 };
  new window.Chart(document.querySelector("#monthly-chart"), {
    type: "bar",
    data: { labels: months, datasets: [{ label: "Food donations", data: monthlyCounts, backgroundColor: "#176b45", borderRadius: 5, maxBarThickness: 34 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: baseFont } }, y: { beginAtZero: true, ticks: { precision: 0, font: baseFont }, grid: { color: "#edf0ec" } } } }
  });
  new window.Chart(document.querySelector("#category-chart"), {
    type: "doughnut",
    data: { labels: categories, datasets: [{ data: countBy(donations, "category", categories), backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: { maintainAspectRatio: false, cutout: "66%", plugins: { legend: { position: "bottom", labels: { boxWidth: 8, padding: 11, font: baseFont } } } }
  });
  new window.Chart(document.querySelector("#status-chart"), {
    type: "doughnut",
    data: { labels: statuses.map((item) => item.replace("_", " ")), datasets: [{ data: countBy(donations, "status", statuses), backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: { maintainAspectRatio: false, cutout: "66%", plugins: { legend: { position: "bottom", labels: { boxWidth: 8, padding: 11, font: baseFont } } } }
  });
}

async function getPlatformData() {
  const [usersResult, donationsResult, claimsResult] = await Promise.all([
    client().from("users").select("id,full_name,email,phone,role,organization_name,address,is_active,created_at").order("created_at", { ascending: false }),
    client().from("food_donations").select("*").order("created_at", { ascending: false }),
    client().from("claims").select("*").order("claimed_at", { ascending: false })
  ]);
  if (usersResult.error) throw usersResult.error;
  if (donationsResult.error) throw donationsResult.error;
  if (claimsResult.error) throw claimsResult.error;
  return { users: usersResult.data || [], donations: donationsResult.data || [], claims: claimsResult.data || [] };
}

function overviewStats(users, donations, claims) {
  const complete = donations.filter((item) => item.status === "completed");
  return `<section class="stat-grid">${[
    ["Registered users", users.length, "Across the platform", "users-round"],
    ["Food donors", users.filter((item) => item.role === "donor").length, "Registered food partners", "store"],
    ["Community organizations", users.filter((item) => item.role === "ngo").length, "Registered NGOs", "hand-heart"],
    ["Food donations", donations.length, "All listings", "package"],
    ["Active donations", donations.filter((item) => ["available", "claimed", "picked_up"].includes(item.status)).length, "Available or in progress", "clock-3"],
    ["Completed donations", complete.length, "Successfully redistributed", "circle-check"],
    ["Total food redistributed", complete.reduce((sum, item) => sum + Number(item.quantity), 0).toLocaleString(), "Completed units", "scale"],
    ["Active claims", claims.filter((item) => ["pending", "approved", "picked_up"].includes(item.claim_status)).length, "Awaiting completion", "clipboard-list"]
  ].map(([label, value, caption, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon"><i data-lucide="${icon}"></i></span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></article>`).join("")}</section>`;
}

export async function adminDashboard() {
  const { users, donations, claims } = await getPlatformData();
  const latest = donations.slice(0, 5);
  const content = `${heading("Platform overview", "A live view of FoodShare’s community activity.")}${overviewStats(users, donations, claims)}
    <div class="charts-grid"><section class="content-card chart-wide"><header class="card-header"><div><h2>Monthly food donations</h2><p>Listings created over the last six months</p></div></header><div class="chart-box"><canvas id="monthly-chart" aria-label="Monthly food donation chart"></canvas></div></section>
    <section class="content-card"><header class="card-header"><div><h2>Food categories</h2><p>Distribution of all donation listings</p></div></header><div class="chart-box chart-tall"><canvas id="category-chart" aria-label="Food category distribution chart"></canvas></div></section>
    <section class="content-card"><header class="card-header"><div><h2>Donation status</h2><p>Current platform-wide listing status</p></div></header><div class="chart-box chart-tall"><canvas id="status-chart" aria-label="Donation status distribution chart"></canvas></div></section>
    <section class="content-card chart-wide"><header class="card-header"><div><h2>Latest donations</h2><p>Most recently listed food</p></div><a class="card-link" href="${dashboardUrl("admin", "donations")}">Manage donations <i data-lucide="arrow-right"></i></a></header>${latest.length ? `<div class="simple-list">${latest.map((item) => `<div class="list-row"><div class="list-info"><strong>${escapeHtml(item.food_name)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(formatQuantity(item.quantity, item.unit))} · ${escapeHtml(formatDate(item.created_at))}</small></div>${statusBadge(item.status)}</div>`).join("")}</div>` : empty("No donations yet", "New listings will appear here.")}</section></div>`;
  return { content, charts: donations };
}

export async function initializeCharts(donations) {
  await loadChartJs();
  renderCharts(donations);
}

export async function adminReports() {
  const { users, donations, claims } = await getPlatformData();
  return { content: `${heading("Platform reports", "Explore current impact and activity across FoodShare.")}${overviewStats(users, donations, claims)}
    <div class="charts-grid"><section class="content-card chart-wide"><header class="card-header"><div><h2>Monthly food donations</h2><p>Listings created over the last six months</p></div></header><div class="chart-box"><canvas id="monthly-chart" aria-label="Monthly food donation chart"></canvas></div></section><section class="content-card"><header class="card-header"><div><h2>Food categories</h2><p>Distribution by category</p></div></header><div class="chart-box chart-tall"><canvas id="category-chart" aria-label="Food category distribution chart"></canvas></div></section><section class="content-card"><header class="card-header"><div><h2>Donation status</h2><p>Platform-wide status distribution</p></div></header><div class="chart-box chart-tall"><canvas id="status-chart" aria-label="Donation status distribution chart"></canvas></div></section></div>`, charts: donations };
}

function usersMarkup(rows) {
  return `${heading("Manage users", "View member profiles and control access to the platform.")}<div class="toolbar"><label class="search-field"><i data-lucide="search"></i><input id="user-search" type="search" placeholder="Search name, organization, or email…" aria-label="Search users"></label><select id="user-role-filter" aria-label="Filter by role"><option value="">All roles</option><option value="donor">Donors</option><option value="ngo">NGOs</option><option value="admin">Admins</option></select><select id="user-status-filter" aria-label="Filter by account status"><option value="">All accounts</option><option value="true">Active</option><option value="false">Inactive</option></select></div>
    <section class="content-card"><header class="card-header"><div><h2>Platform users</h2><p>${rows.length} registered account${rows.length === 1 ? "" : "s"}</p></div></header><div id="users-results"></div></section>`;
}

function drawUsers(rows) {
  const search = document.querySelector("#user-search").value.trim().toLowerCase();
  const role = document.querySelector("#user-role-filter").value;
  const active = document.querySelector("#user-status-filter").value;
  const filtered = rows.filter((user) => {
    const text = `${user.full_name || ""} ${user.email || ""} ${user.organization_name || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!role || user.role === role) && (!active || String(user.is_active) === active);
  });
  const target = document.querySelector("#users-results");
  target.innerHTML = filtered.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Role</th><th>Contact</th><th>Joined</th><th>Status</th><th>Access</th></tr></thead><tbody>${filtered.map((user) => `<tr><td><div class="table-primary">${escapeHtml(user.full_name || "Unnamed member")}</div><div class="table-secondary">${escapeHtml(user.organization_name || user.address || "No organization or address")}</div></td><td>${escapeHtml(user.role)}</td><td><div>${escapeHtml(user.email || "—")}</div><div class="table-secondary">${escapeHtml(user.phone || "No phone number")}</div></td><td>${escapeHtml(formatDate(user.created_at))}</td><td><span class="status-badge ${user.is_active ? "status-available" : "status-cancelled"}">${user.is_active ? "active" : "inactive"}</span></td><td>${user.role === "admin" ? "Protected" : `<button type="button" class="button ${user.is_active ? "button-outline" : "button-primary"} button-small" data-user-toggle="${escapeHtml(user.id)}" data-next-active="${!user.is_active}">${user.is_active ? "Deactivate" : "Activate"}</button>`}</td></tr>`).join("")}</tbody></table></div>` : empty("No users found", "Try changing the search or filters.");
  target.querySelectorAll("[data-user-toggle]").forEach((button) => button.addEventListener("click", async () => {
    const next = button.dataset.nextActive === "true";
    if (!window.confirm(`${next ? "Activate" : "Deactivate"} this account?`)) return;
    button.disabled = true;
    try {
      const { error } = await client().from("users").update({ is_active: next }).eq("id", button.dataset.userToggle);
      if (error) throw error;
      showToast(`Account ${next ? "activated" : "deactivated"}.`, "success");
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      showToast(errorMessage(error), "error");
    }
  }));
}

export async function adminUsers() {
  const { data, error } = await client().from("users").select("id,full_name,email,phone,role,organization_name,address,is_active,created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return { content: usersMarkup(data || ""), rows: data || [] };
}

export function initializeUsers(rows) {
  ["#user-search", "#user-role-filter", "#user-status-filter"].forEach((selector) => {
    const event = selector === "#user-search" ? "input" : "change";
    document.querySelector(selector).addEventListener(event, () => drawUsers(rows));
  });
  drawUsers(rows);
}

export async function adminDonations() {
  const [{ data: donations, error }, { data: users, error: usersError }] = await Promise.all([
    client().from("food_donations").select("*").order("created_at", { ascending: false }),
    client().from("users").select("id,full_name,organization_name")
  ]);
  if (error) throw error;
  if (usersError) throw usersError;
  const byId = new Map((users || []).map((user) => [user.id, user]));
  const rows = donations || [];
  return {
    content: `${heading("Manage donations", "Review platform-wide food listings and remove invalid content.")}<div class="toolbar"><label class="search-field"><i data-lucide="search"></i><input id="donation-search" type="search" placeholder="Search food or donor…" aria-label="Search donations"></label><select id="donation-status-filter"><option value="">All statuses</option>${["available", "claimed", "picked_up", "completed", "expired"].map((status) => `<option value="${status}">${status.replace("_", " ")}</option>`).join("")}</select></div><section class="content-card"><header class="card-header"><div><h2>Food donations</h2><p>${rows.length} platform listing${rows.length === 1 ? "" : "s"}</p></div></header><div id="donations-results"></div></section>`,
    donations: rows,
    users: [...byId.values()]
  };
}

export function initializeAdminDonations(donations, users) {
  const byId = new Map(users.map((user) => [user.id, user]));
  const draw = () => {
    const search = document.querySelector("#donation-search").value.trim().toLowerCase();
    const status = document.querySelector("#donation-status-filter").value;
    const filtered = donations.filter((item) => {
      const donor = byId.get(item.donor_id);
      return (!search || `${item.food_name} ${item.pickup_address} ${donor?.full_name || ""} ${donor?.organization_name || ""}`.toLowerCase().includes(search)) && (!status || item.status === status);
    });
    const target = document.querySelector("#donations-results");
    target.innerHTML = filtered.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Food</th><th>Donor</th><th>Quantity</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>${filtered.map((item) => `<tr><td><div class="table-primary">${escapeHtml(item.food_name)}</div><div class="table-secondary">${escapeHtml(item.category)} · ${escapeHtml(item.pickup_address)}</div></td><td>${escapeHtml(byId.get(item.donor_id)?.organization_name || byId.get(item.donor_id)?.full_name || "Food donor")}</td><td>${escapeHtml(formatQuantity(item.quantity, item.unit))}</td><td>${escapeHtml(formatDate(item.expiry_time))}</td><td>${statusBadge(item.status)}</td><td><button type="button" class="icon-button danger-button" data-remove-donation="${escapeHtml(item.id)}" aria-label="Remove listing for ${escapeHtml(item.food_name)}"><i data-lucide="trash-2"></i></button></td></tr>`).join("")}</tbody></table></div>` : empty("No matching donations", "Try changing your search or filters.");
    target.querySelectorAll("[data-remove-donation]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Remove this donation? Associated claim records will also be deleted. This cannot be undone.")) return;
      button.disabled = true;
      try {
        const { error: deleteError } = await client().from("food_donations").delete().eq("id", button.dataset.removeDonation);
        if (deleteError) throw deleteError;
        showToast("Donation removed.", "success");
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        showToast(errorMessage(error), "error");
      }
    }));
    refreshIcons();
  };
  document.querySelector("#donation-search").addEventListener("input", draw);
  document.querySelector("#donation-status-filter").addEventListener("change", draw);
  draw();
}

export async function adminClaims() {
  const [{ data: claims, error }, { data: donations, error: donationsError }, { data: users, error: usersError }] = await Promise.all([
    client().from("claims").select("*").order("claimed_at", { ascending: false }),
    client().from("food_donations").select("id,food_name,quantity,unit,pickup_address"),
    client().from("users").select("id,full_name,organization_name")
  ]);
  if (error) throw error;
  if (donationsError) throw donationsError;
  if (usersError) throw usersError;
  const foodById = new Map((donations || []).map((food) => [food.id, food]));
  const userById = new Map((users || []).map((user) => [user.id, user]));
  const rows = claims || [];
  const content = `${heading("Manage claims", "Monitor food collection and redistribution activity.")}<section class="content-card"><header class="card-header"><div><h2>All claims</h2><p>${rows.length} platform claim${rows.length === 1 ? "" : "s"}</p></div></header>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Food</th><th>Community organization</th><th>Claimed</th><th>Status</th><th>Update status</th></tr></thead><tbody>${rows.map((claim) => { const food = foodById.get(claim.food_id); const ngo = userById.get(claim.ngo_id); return `<tr><td><div class="table-primary">${escapeHtml(food?.food_name || "Removed donation")}</div><div class="table-secondary">${food ? escapeHtml(`${formatQuantity(food.quantity, food.unit)} · ${food.pickup_address}`) : "This listing is no longer available"}</div></td><td>${escapeHtml(ngo?.organization_name || ngo?.full_name || "Community organization")}</td><td>${escapeHtml(formatDate(claim.claimed_at))}</td><td>${statusBadge(claim.claim_status)}</td><td>${["approved", "picked_up"].includes(claim.claim_status) ? `<select class="claim-status-select" data-claim-id="${escapeHtml(claim.id)}" aria-label="Update claim status"><option value="">Update…</option>${claim.claim_status === "approved" ? `<option value="picked_up">Mark picked up</option>` : ""}<option value="completed">Mark completed</option><option value="cancelled">Cancel claim</option></select>` : "—"}</td></tr>`; }).join("")}</tbody></table></div>` : empty("No claims yet", "Claims will appear here when NGOs reserve food.")}</section>`;
  return content;
}

export async function initializeAdminClaimUpdates() {
  document.querySelectorAll(".claim-status-select").forEach((select) => {
    const currentStatus = select.closest("tr")?.querySelector(".status-badge")?.textContent.trim();
    if (currentStatus === "picked up") select.querySelector('option[value="cancelled"]')?.remove();
    select.addEventListener("change", async () => {
    const newStatus = select.value;
    if (!newStatus) return;
    select.disabled = true;
    try {
      const { error } = await client().rpc("update_claim_status", { claim_id: select.dataset.claimId, new_status: newStatus });
      if (error) throw error;
      showToast("Claim status updated.", "success");
      window.location.reload();
    } catch (error) {
      select.disabled = false;
      select.value = "";
      showToast(errorMessage(error), "error");
    }
    });
  });
}
