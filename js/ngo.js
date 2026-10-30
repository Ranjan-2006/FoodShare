import { requireSupabase } from "./supabase.js";
import {
  CATEGORIES, dashboardUrl, errorMessage, escapeHtml, formatDate, formatQuantity, formatRelative,
  imageUrl, refreshIcons, setLoading, showToast, statusBadge
} from "./common.js";

const client = () => requireSupabase();
const heading = (title, description, action = "") => `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${action ? `<div class="page-heading-actions">${action}</div>` : ""}</div>`;
const statCards = (items) => `<section class="stat-grid">${items.map(([label, value, caption, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon"><i data-lucide="${icon}"></i></span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></article>`).join("")}</section>`;
const empty = (title, text, action = "") => `<div class="empty-state"><i data-lucide="package-open"></i><strong>${title}</strong><p>${text}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div>`;

async function getClaims() {
  const { data, error } = await client().rpc("ngo_claim_overview");
  if (error) throw error;
  return data || [];
}

export async function ngoDashboard(profile) {
  const [{ data: available, error: foodError }, claims] = await Promise.all([
    client().rpc("browse_available_donations", { search_term: null, category_filter: null, location_term: null, sort_order: "newest" }),
    getClaims()
  ]);
  if (foodError) throw foodError;
  const done = claims.filter((claim) => claim.claim_status === "completed");
  const collected = done.reduce((sum, claim) => sum + Number(claim.quantity || 0), 0);
  const active = claims.filter((claim) => ["approved", "picked_up"].includes(claim.claim_status)).length;
  const content = `${heading(`Hello, ${escapeHtml(profile.full_name?.split(" ")[0] || "there")}.`, "Find food, coordinate pickups, and track your community’s impact.", `<a class="button button-primary button-small" href="${dashboardUrl("ngo", "marketplace")}"><i data-lucide="search"></i> Browse food</a>`)}
    ${statCards([["Available food", (available || []).length, "Ready to be claimed", "package-search"], ["My active claims", active, "Pickups in progress", "clipboard-list"], ["Completed collections", done.length, "Successfully collected", "circle-check"], ["Food collected", collected.toLocaleString(), "Total completed units", "hand-heart"]])}
    <div class="dashboard-grid"><section class="content-card"><header class="card-header"><div><h2>Nearby food</h2><p>Recently shared food available to collect</p></div><a class="card-link" href="${dashboardUrl("ngo", "marketplace")}">Browse all <i data-lucide="arrow-right"></i></a></header>
    ${(available || []).length ? `<div class="simple-list">${available.slice(0, 5).map((item) => `<div class="list-row"><img class="list-thumb" src="${escapeHtml(imageUrl(item))}" alt=""><div class="list-info"><strong>${escapeHtml(item.food_name)}</strong><small>${escapeHtml(formatQuantity(item.quantity, item.unit))} · ${escapeHtml(item.pickup_address)}</small></div><span class="status-badge status-available">available</span></div>`).join("")}</div>` : empty("No food available right now", "Check back soon or explore the marketplace.")}</section>
    <section class="content-card"><header class="card-header"><div><h2>Recent claims</h2><p>Your latest collection activity</p></div><a class="card-link" href="${dashboardUrl("ngo", "my-claims")}">View all <i data-lucide="arrow-right"></i></a></header>
    ${claims.length ? `<div class="simple-list">${claims.slice(0, 5).map((item) => `<div class="list-row"><div class="list-info"><strong>${escapeHtml(item.food_name)}</strong><small>${escapeHtml(formatQuantity(item.quantity, item.unit))} · ${escapeHtml(formatDate(item.claimed_at))}</small></div>${statusBadge(item.claim_status)}</div>`).join("")}</div>` : empty("No claims yet", "Claim an available donation to get started.", `<a class="button button-primary button-small" href="${dashboardUrl("ngo", "marketplace")}">Browse food</a>`)}</section></div>`;
  return content;
}

function filtersMarkup() {
  return `<div class="toolbar"><label class="search-field"><i data-lucide="search"></i><input id="market-search" type="search" placeholder="Search food or donor…" aria-label="Search donations"></label><select id="market-category" aria-label="Filter by category"><option value="">All categories</option>${CATEGORIES.map((category) => `<option>${category}</option>`).join("")}</select><input id="market-location" class="filter-control" style="width:155px;min-height:38px;font-size:11px" type="search" placeholder="Filter location" aria-label="Filter by pickup location"><select id="market-sort" aria-label="Sort donations"><option value="newest">Newest first</option><option value="expiry">Expiring soon</option></select></div>`;
}

export function marketplaceMarkup() {
  return `${heading("Browse food", "Discover available food donations from local partners.")}${filtersMarkup()}<div id="market-results" class="loading-state"><span class="spinner"></span> Finding nearby food…</div>`;
}

function donationCard(item) {
  return `<article class="food-card"><div class="food-card-image"><img src="${escapeHtml(imageUrl(item))}" alt="${escapeHtml(item.food_name)}" loading="lazy">${statusBadge("available")}</div><div class="food-card-body"><span class="food-category">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.food_name)}</h3><p class="food-card-quantity">${escapeHtml(formatQuantity(item.quantity, item.unit))}</p><div class="food-meta"><span><i data-lucide="building-2"></i> ${escapeHtml(item.donor_name || item.organization_name || "Local food donor")}</span><span><i data-lucide="map-pin"></i> ${escapeHtml(item.pickup_address)}</span><span class="expiry-alert"><i data-lucide="clock-3"></i> ${escapeHtml(formatRelative(item.expiry_time))}</span></div><div class="food-card-footer"><span>${escapeHtml(formatDate(item.created_at, { month: "short", day: "numeric" }))}</span><button class="button button-outline" data-view-food="${escapeHtml(item.id)}" type="button">View details <i data-lucide="arrow-right"></i></button></div></div></article>`;
}

async function fetchMarketplace() {
  const search = document.querySelector("#market-search").value.trim() || null;
  const category = document.querySelector("#market-category").value || null;
  const location = document.querySelector("#market-location").value.trim() || null;
  const order = document.querySelector("#market-sort").value;
  const target = document.querySelector("#market-results");
  target.innerHTML = `<div class="loading-state"><span class="spinner"></span> Finding nearby food…</div>`;
  try {
    const { data, error } = await client().rpc("browse_available_donations", {
      search_term: search,
      category_filter: category,
      location_term: location,
      sort_order: order
    });
    if (error) throw error;
    target.className = "marketplace-grid";
    target.innerHTML = data?.length ? data.map(donationCard).join("") : empty("No matching donations", "Try changing your search or filters.");
    target.querySelectorAll("[data-view-food]").forEach((button) => {
      button.addEventListener("click", () => showDonationDetails(data.find((item) => item.id === button.dataset.viewFood)));
    });
    refreshIcons();
  } catch (error) {
    target.className = "content-card";
    target.innerHTML = `<div class="empty-state"><strong>Couldn’t load donations</strong><p>${escapeHtml(errorMessage(error))}</p></div>`;
  }
}

function showDonationDetails(item) {
  if (!item) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="food-modal-title"><button type="button" class="icon-button modal-close" aria-label="Close dialog" data-close><i data-lucide="x"></i></button><img src="${escapeHtml(imageUrl(item))}" alt="" style="width:100%;height:180px;object-fit:cover;border-radius:8px;margin-bottom:16px"><span class="food-category">${escapeHtml(item.category)}</span><h2 id="food-modal-title">${escapeHtml(item.food_name)}</h2><p>${escapeHtml(formatQuantity(item.quantity, item.unit))} · ${escapeHtml(formatRelative(item.expiry_time))}</p><div class="food-meta"><span><i data-lucide="building-2"></i> ${escapeHtml(item.donor_name || item.organization_name || "Local food donor")}</span><span><i data-lucide="map-pin"></i> Pickup: ${escapeHtml(item.pickup_address)}</span><span><i data-lucide="clock-3"></i> Prepared ${escapeHtml(formatDate(item.preparation_time, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span>${item.instructions ? `<span><i data-lucide="info"></i> ${escapeHtml(item.instructions)}</span>` : ""}</div><div class="modal-actions"><button type="button" class="button button-outline" data-close>Close</button><button type="button" class="button button-primary" data-claim="${escapeHtml(item.id)}">Claim this food <i data-lucide="arrow-right"></i></button></div></section>`;
  document.body.append(backdrop);
  refreshIcons();
  backdrop.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => backdrop.remove()));
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("[data-claim]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!window.confirm("Claim this food donation? Other organizations will no longer be able to claim it.")) return;
    setLoading(button, true, "Claiming…");
    try {
      const { error } = await client().rpc("claim_food", { donation_id: item.id });
      if (error) throw error;
      backdrop.remove();
      showToast("Donation claimed. Pickup details are available in My Claims.", "success");
      window.location.assign(dashboardUrl("ngo", "my-claims"));
    } catch (error) {
      setLoading(button, false);
      showToast(errorMessage(error), "error");
    }
  });
}

export function initializeMarketplace() {
  let debounceTimer;
  ["#market-search", "#market-location"].forEach((selector) => document.querySelector(selector).addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(fetchMarketplace, 240);
  }));
  ["#market-category", "#market-sort"].forEach((selector) => document.querySelector(selector).addEventListener("change", fetchMarketplace));
  fetchMarketplace();
}

export async function ngoClaims() {
  const rows = await getClaims();
  const rowsMarkup = rows.map((item) => {
    let actions = "—";
    if (item.claim_status === "approved") {
      actions = `<select class="claim-status-select" data-claim-id="${escapeHtml(item.claim_id)}" aria-label="Update claim status"><option value="">Update…</option><option value="picked_up">Mark picked up</option><option value="cancelled">Cancel claim</option></select>`;
    } else if (item.claim_status === "picked_up") {
      actions = `<select class="claim-status-select" data-claim-id="${escapeHtml(item.claim_id)}" aria-label="Update claim status"><option value="">Update…</option><option value="completed">Mark completed</option></select>`;
    }
    return `<tr><td><div class="table-primary">${escapeHtml(item.food_name)}</div><div class="table-secondary">${escapeHtml(item.category)}</div></td><td>${escapeHtml(formatQuantity(item.quantity, item.unit))}</td><td>${escapeHtml(item.pickup_address)}</td><td><div class="table-primary">${escapeHtml(item.donor_name || "Food donor")}</div><div class="table-secondary">${escapeHtml(item.donor_phone || "Contact information unavailable")}</div></td><td>${escapeHtml(formatDate(item.claimed_at))}</td><td>${statusBadge(item.claim_status)}</td><td>${actions}</td></tr>`;
  }).join("");
  return `${heading("My claims", "Coordinate food pickups and keep your collection status up to date.")}<section class="content-card"><header class="card-header"><div><h2>All claims</h2><p>${rows.length} claim${rows.length === 1 ? "" : "s"}</p></div></header>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Food</th><th>Quantity</th><th>Pickup address</th><th>Donor contact</th><th>Claimed</th><th>Status</th><th>Update status</th></tr></thead><tbody>${rowsMarkup}</tbody></table></div>` : empty("No claims yet", "Claim an available food donation to see pickup details here.", `<a class="button button-primary button-small" href="${dashboardUrl("ngo", "marketplace")}">Browse food</a>`)}</section>`;
}

export function initializeClaimStatusUpdates() {
  document.querySelectorAll(".claim-status-select").forEach((select) => select.addEventListener("change", async () => {
    const nextStatus = select.value;
    if (!nextStatus) return;
    if (nextStatus === "cancelled" && !window.confirm("Cancel this claim? The donation will become available to other organizations again.")) {
      select.value = "";
      return;
    }
    select.disabled = true;
    try {
      const { error } = await client().rpc("update_claim_status", { claim_id: select.dataset.claimId, new_status: nextStatus });
      if (error) throw error;
      showToast(nextStatus === "cancelled" ? "Claim cancelled." : `Claim marked ${nextStatus.replace("_", " ")}.`, "success");
      window.location.reload();
    } catch (error) {
      select.disabled = false;
      select.value = "";
      showToast(errorMessage(error), "error");
    }
  }));
}
