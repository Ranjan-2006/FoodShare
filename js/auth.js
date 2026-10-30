import { getSupabaseConfigError, requireSupabase } from "./supabase.js";
import { errorMessage, isConfigured, ROLE_PATHS, setLoading, showToast } from "./common.js";

function showFeedback(form, message) {
  const feedback = form.querySelector(".form-feedback");
  if (feedback) feedback.textContent = message;
}

export function initPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const input = toggle.parentElement.querySelector("input");
      const showing = input.type === "password";
      input.type = showing ? "text" : "password";
      toggle.setAttribute("aria-label", showing ? "Hide password" : "Show password");
      toggle.innerHTML = `<i data-lucide="${showing ? "eye-off" : "eye"}"></i>`;
      if (window.lucide) window.lucide.createIcons();
    });
  });
}

async function redirectIfSignedIn() {
  const auth = requireSupabase().auth;
  const { data: { session }, error: sessionError } = await auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return;

  const { data: { user }, error } = await auth.getUser();
  if (error) throw error;
  if (!user) return;
  const { data: profile, error: profileError } = await requireSupabase().from("users").select("role,is_active").eq("id", user.id).single();
  if (profileError) throw profileError;
  if (!profile.is_active) {
    const { error: signOutError } = await requireSupabase().auth.signOut();
    if (signOutError) throw signOutError;
    return;
  }
  window.location.replace(ROLE_PATHS[profile.role] || "index.html");
}

export async function initializeAuthPage(page) {
  const notice = document.querySelector("#auth-setup-notice");
  if (!isConfigured()) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = `${getSupabaseConfigError()} Authentication is unavailable until this is corrected.`;
    }
    document.querySelectorAll("form input, form select, form button").forEach((control) => { control.disabled = true; });
    return;
  }
  try {
    await redirectIfSignedIn();
  } catch (error) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = errorMessage(error);
    }
    document.querySelectorAll("form input, form select, form button").forEach((control) => { control.disabled = true; });
    return;
  }
  if (page === "login") initializeLogin();
  else initializeRegistration();
}

function initializeLogin() {
  const form = document.querySelector("#login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    setLoading(button, true, "Signing in…");
    showFeedback(form, "");
    try {
      const { data, error } = await requireSupabase().auth.signInWithPassword({
        email: String(values.get("email")).trim(),
        password: String(values.get("password"))
      });
      if (error) throw error;
      if (!data.user) throw new Error("Sign-in did not return a user. Please try again.");
      const { data: profile, error: profileError } = await requireSupabase().from("users").select("role,is_active").eq("id", data.user.id).single();
      if (profileError) throw profileError;
      if (!profile.is_active) {
        await requireSupabase().auth.signOut();
        throw new Error("Your account is currently inactive. Please contact FoodShare support.");
      }
      showToast("Welcome back!", "success");
      window.location.assign(ROLE_PATHS[profile.role] || "index.html");
    } catch (error) {
      showFeedback(form, errorMessage(error));
    } finally {
      setLoading(button, false);
    }
  });
}

function initializeRegistration() {
  const form = document.querySelector("#register-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const password = String(values.get("password"));
    if (password.length < 8) {
      showFeedback(form, "Use a password with at least 8 characters.");
      return;
    }
    setLoading(button, true, "Creating account…");
    showFeedback(form, "");
    try {
      const { data, error } = await requireSupabase().auth.signUp({
        email: String(values.get("email")).trim(),
        password,
        options: {
          data: {
            full_name: String(values.get("full_name")).trim(),
            phone: String(values.get("phone") || "").trim(),
            role: String(values.get("role")),
            organization_name: String(values.get("organization_name") || "").trim(),
            address: String(values.get("address") || "").trim()
          }
        }
      });
      if (error) throw error;
      if (data.session && data.user) {
        const { data: profile, error: profileError } = await requireSupabase().from("users").select("role").eq("id", data.user.id).single();
        if (profileError) throw profileError;
        window.location.assign(ROLE_PATHS[profile.role] || "index.html");
      } else {
        showFeedback(form, "Your account is created. Check your email to confirm your address, then log in.");
        form.reset();
      }
    } catch (error) {
      showFeedback(form, errorMessage(error));
    } finally {
      setLoading(button, false);
    }
  });
}
