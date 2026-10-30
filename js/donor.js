import { requireSupabase } from "./supabase.js";
import {
  CATEGORIES, dashboardUrl, errorMessage, escapeHtml, formatDate, formatQuantity, imageUrl,
  refreshIcons, setLoading, showToast, statusBadge, uploadDonationImage
} from "./common.js";

const client = () => requireSupabase();

function heading(title, description, action = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${action ? `<div class="page-heading-actions">${action}</div>` : ""}</div>`;
}

function stats(items) {
  return `<section class="stat-grid">${items.map(([label, value, caption, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon"><i data-lucide="${icon}"></i></span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></article>`).join("")}</section>`;
}

function empty(title, detail, action = "") {
  return `<div class="empty-state"><i data-lucide="package-open"></i><strong>${title}</strong><p>${detail}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div>`;
}

export async function donorDashboard(profile) {
  const { data, error } = await client().from("food_donations").select("*").eq("donor_id", profile.id).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const active = rows.filter((item) => ["available", "claimed", "picked_up"].includes(item.status)).length;
  const completed = rows.filter((item) => item.status === "completed").length;
  const content = `${heading(`Hello, ${escapeHtml(profile.full_name?.split(" ")[0] || "there")}.`, "Here’s what’s happening with your food donations.", `<a class="button button-primary button-small" href="${dashboardUrl("donor", "add-donation")}"><i data-lucide="plus"></i> Add a donation</a>`)}
    ${stats([["Total donations", rows.length, "All time", "package"], ["Active donations", active, "Available, claimed or picked up", "clock-3"], ["Claimed donations", rows.filter((item) => item.status === "claimed").length, "Awaiting collection", "handshake"], ["Completed donations", completed, "Successfully shared", "circle-check"]])}
    <div class="dashboard-grid"><section class="content-card"><header class="card-header"><div><h2>Recent donations</h2><p>Your latest food listings</p></div><a class="card-link" href="${dashboardUrl("donor", "my-donations")}">View all <i data-lucide="arrow-right"></i></a></header>
    ${rows.length ? `<div class="simple-list">${rows.slice(0, 5).map((item) => `<div class="list-row"><img class="list-thumb" src="${escapeHtml(imageUrl(item))}" alt=""><div class="list-info"><strong>${escapeHtml(item.food_name)}</strong><small>${escapeHtml(formatQuantity(item.quantity, item.unit))} · ${escapeHtml(formatDate(item.created_at))}</small></div>${statusBadge(item.status)}</div>`).join("")}</div>` : empty("No donations yet", "Add your first food donation to get started.", `<a class="button button-primary button-small" href="${dashboardUrl("donor", "add-donation")}">Add a donation</a>`)}</section>
    <section class="content-card"><header class="card-header"><div><h2>Your impact</h2><p>Food you’ve shared with the community</p></div></header><div class="card-body">${rows.length ? `<div class="stat-value">${rows.filter((item) => item.status === "completed").reduce((sum, item) => sum + Number(item.quantity), 0).toLocaleString()}</div><div class="stat-caption">units successfully redistributed</div><div style="margin-top:18px">${rows.filter((item) => item.status === "completed").slice(0, 3).map((item) => `<div class="list-row" style="padding-inline:0"><div class="list-info"><strong>${escapeHtml(item.food_name)}</strong><small>${escapeHtml(formatQuantity(item.quantity, item.unit))}</small></div>${statusBadge(item.status)}</div>`).join("") || `<p class="form-hint">Completed donations will appear here.</p>`}</div>` : empty("Your impact starts here", "Shared donations and completed pickups will appear here.")}</div></section></div>`;
  return content;
}

export function donationFormMarkup(item = null) {
  const editing = Boolean(item);
  const dateValue = (value) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const categories = CATEGORIES.map((category) => `<option ${item?.category === category ? "selected" : ""}>${category}</option>`).join("");
  return `${heading(editing ? "Edit donation" : "Add a food donation", editing ? "Update details for your available food listing." : "Share your surplus food with a local community organization.")}
    <section class="content-card form-card"><header class="card-header"><div><h2>Donation details</h2><p>Fields marked with * are required.</p></div></header><div class="card-body"><form id="donation-form" novalidate><div class="form-grid">
      <label class="span-2">Food name *<input name="food_name" required maxlength="120" value="${escapeHtml(item?.food_name || "")}" placeholder="e.g. Fresh vegetable soup"></label>
      <label>Category *<select name="category" required><option value="">Choose a category</option>${categories}</select></label>
      <label>Quantity *<div style="display:grid;grid-template-columns:1fr 130px;gap:8px"><input name="quantity" type="number" step="0.01" min="0.01" required value="${escapeHtml(item?.quantity ?? "")}" placeholder="e.g. 12"><select name="unit" required><option value="meals" ${item?.unit === "meals" ? "selected" : ""}>Meals</option><option value="kg" ${item?.unit === "kg" ? "selected" : ""}>kg</option><option value="packets" ${item?.unit === "packets" ? "selected" : ""}>Packets</option></select></div></label>
      <label>Prepared on *<input name="preparation_time" type="datetime-local" required value="${dateValue(item?.preparation_time)}"></label>
      <label>Best before *<input name="expiry_time" type="datetime-local" required value="${dateValue(item?.expiry_time)}"></label>
      <label class="span-2">Pickup address *<input name="pickup_address" required maxlength="350" value="${escapeHtml(item?.pickup_address || "")}" placeholder="Street address, city, and any useful directions"></label>
      <label class="span-2">Pickup instructions <span class="form-hint">Optional</span><textarea name="instructions" maxlength="1500" placeholder="Pickup window, storage details, or other helpful information">${escapeHtml(item?.instructions || "")}</textarea></label>
      <label class="span-2">Food photo <input name="image" type="file" accept="image/jpeg,image/png,image/webp"><span class="form-hint">${editing && item.image_url ? "Upload a new image to replace the current one. " : ""}Optional · JPEG, PNG, or WebP · up to 5 MB</span></label>
      <p class="form-feedback span-2" aria-live="polite"></p>
    </div><div class="form-footer"><a class="button button-outline" href="${dashboardUrl("donor", "my-donations")}">Cancel</a><button type="submit" class="button button-primary">${editing ? "Save changes" : "Publish donation"} <i data-lucide="arrow-right"></i></button></div></form></div></section>`;
}

export async function initializeDonationForm(profile) {
  const editId = new URLSearchParams(location.search).get("edit");
  let editingDonation = null;
  if (editId) {
    const { data, error } = await client().from("food_donations").select("*").eq("id", editId).eq("donor_id", profile.id).maybeSingle();
    if (error) throw error;
    if (!data || data.status !== "available") throw new Error("Only your available donations can be edited.");
    editingDonation = data;
  }
  document.querySelector("#app .page-content").innerHTML = donationFormMarkup(editingDonation);
  refreshIcons();
  const form = document.querySelector("#donation-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const preparation = new Date(String(values.get("preparation_time")));
    const expiry = new Date(String(values.get("expiry_time")));
    if (Number.isNaN(preparation.getTime()) || Number.isNaN(expiry.getTime()) || expiry <= preparation) {
      form.querySelector(".form-feedback").textContent = "The best-before time must be after the preparation time.";
      return;
    }
    if (expiry <= new Date()) {
      form.querySelector(".form-feedback").textContent = "The best-before time must be in the future.";
      return;
    }
    const button = form.querySelector('[type="submit"]');
    setLoading(button, true, editingDonation ? "Saving…" : "Publishing…");
    try {
      const file = values.get("image");
      const image = file instanceof File && file.size ? await uploadDonationImage(file, profile.id) : editingDonation?.image_url || null;
      const donation = {
        donor_id: profile.id,
        food_name: String(values.get("food_name")).trim(),
        category: String(values.get("category")),
        quantity: Number(values.get("quantity")),
        unit: String(values.get("unit")),
        preparation_time: preparation.toISOString(),
        expiry_time: expiry.toISOString(),
        pickup_address: String(values.get("pickup_address")).trim(),
        instructions: String(values.get("instructions") || "").trim(),
        image_url: image
      };
      const result = editingDonation
        ? await client().from("food_donations").update(donation).eq("id", editingDonation.id).eq("status", "available").select("id").single()
        : await client().from("food_donations").insert(donation).select("id").single();
      if (result.error) throw result.error;
      showToast(editingDonation ? "Donation updated." : "Your donation is now listed.", "success");
      window.location.assign(dashboardUrl("donor", "my-donations"));
    } catch (error) {
      form.querySelector(".form-feedback").textContent = errorMessage(error);
    } finally {
      setLoading(button, false);
    }
  });
}

export async function donorDonations() {
  const { data, error } = await client().from("food_donations").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const content = `${heading("My donations", "Track and manage every food donation you’ve shared.", `<a class="button button-primary button-small" href="${dashboardUrl("donor", "add-donation")}"><i data-lucide="plus"></i> Add donation</a>`)}
    <section class="content-card"><header class="card-header"><div><h2>All donations</h2><p>${rows.length} listing${rows.length === 1 ? "" : "s"}</p></div></header>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Food</th><th>Quantity</th><th>Expiry</th><th>Status</th><th>Claimed by</th><th>Actions</th></tr></thead><tbody>${rows.map((item) => `<tr><td><div class="table-primary">${escapeHtml(item.food_name)}</div><div class="table-secondary">${escapeHtml(item.category)}</div></td><td>${escapeHtml(formatQuantity(item.quantity, item.unit))}</td><td>${escapeHtml(formatDate(item.expiry_time, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td><td>${statusBadge(item.status)}</td><td>${item.status === "claimed" || item.status === "picked_up" || item.status === "completed" ? `<span class="claim-ngo-name" data-donation-id="${escapeHtml(item.id)}">Loading…</span>` : "—"}</td><td><div class="table-actions">${item.status === "available" ? `<a class="icon-button" href="${dashboardUrl("donor", "add-donation")}?edit=${encodeURIComponent(item.id)}" aria-label="Edit ${escapeHtml(item.food_name)}"><i data-lucide="pencil"></i></a><button class="icon-button danger-button" data-delete-donation="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.food_name)}"><i data-lucide="trash-2"></i></button>` : "—"}</div></td></tr>`).join("")}</tbody></table></div>` : empty("Nothing to see here yet", "Your food donations will appear here when you share one.", `<a class="button button-primary button-small" href="${dashboardUrl("donor", "add-donation")}">Add a donation</a>`)}</section>`;
  return { content, rows };
}

export async function initializeDonorDonationTable(rows) {
  const claimed = rows.filter((item) => ["claimed", "picked_up", "completed"].includes(item.status));
  if (claimed.length) {
    const { data, error } = await client().rpc("donor_claim_overview", { donation_ids: claimed.map((item) => item.id) });
    if (error) throw error;
    for (const claim of data || []) {
      const element = document.querySelector(`[data-donation-id="${CSS.escape(claim.food_id)}"]`);
      if (element) element.textContent = claim.ngo_name || "Community organization";
    }
  }
  document.querySelectorAll("[data-delete-donation]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this available donation? This action cannot be undone.")) return;
      button.disabled = true;
      try {
        const { error } = await client().from("food_donations").delete().eq("id", button.dataset.deleteDonation).eq("status", "available");
        if (error) throw error;
        showToast("Donation deleted.", "success");
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        showToast(errorMessage(error), "error");
      }
    });
  });
}

export function donorProfileMarkup(profile) {
  return `${heading("My profile", "Keep your contact details up to date.")}<div class="profile-layout"><section class="content-card profile-card"><span class="profile-large-avatar">${escapeHtml((profile.full_name?.[0] || "F").toUpperCase())}</span><h2>${escapeHtml(profile.full_name)}</h2><p>${escapeHtml(profile.email)}</p><span class="profile-role">Food donor</span></section><section class="content-card"><header class="card-header"><div><h2>Personal details</h2><p>These details help coordinate successful pickups.</p></div></header><div class="card-body"><form class="profile-form" id="profile-form"><label>Full name<input name="full_name" required maxlength="120" value="${escapeHtml(profile.full_name || "")}"></label><label>Email address<input value="${escapeHtml(profile.email || "")}" disabled></label><label>Organization name<input name="organization_name" maxlength="160" value="${escapeHtml(profile.organization_name || "")}"></label><label>Phone number<input name="phone" type="tel" maxlength="32" value="${escapeHtml(profile.phone || "")}"></label><label>Address<input name="address" maxlength="300" value="${escapeHtml(profile.address || "")}"></label><p class="form-feedback" aria-live="polite"></p><button class="button button-primary" type="submit">Save changes</button></form></div></section></div>`;
}

export function initializeDonorProfile(profile) {
  const form = document.querySelector("#profile-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    setLoading(button, true, "Saving…");
    try {
      const values = new FormData(form);
      const { error } = await client().from("users").update({
        full_name: String(values.get("full_name")).trim(),
        organization_name: String(values.get("organization_name") || "").trim() || null,
        phone: String(values.get("phone") || "").trim() || null,
        address: String(values.get("address") || "").trim() || null
      }).eq("id", profile.id);
      if (error) throw error;
      showToast("Profile updated.", "success");
    } catch (error) {
      form.querySelector(".form-feedback").textContent = errorMessage(error);
    } finally {
      setLoading(button, false);
    }
  });
}
