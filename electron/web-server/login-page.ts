/**
 * Self-contained login page served when cookie-based auth is enabled
 * and the user hasn't authenticated yet.
 */
export function getLoginPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${__BRAND_PRODUCT_NAME} — Login</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --brand-hue: ${__BRAND_THEME_HUE}; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: oklch(0.15 0.006 var(--brand-hue));
    background-image:
      radial-gradient(circle at top, oklch(0.60 0.10 var(--brand-hue) / 14%), transparent 34%),
      linear-gradient(180deg, oklch(0.12 0.006 var(--brand-hue) / 48%), transparent 24%);
    color: oklch(0.95 0.008 var(--brand-hue));
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .card {
    background:
      linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012)),
      linear-gradient(180deg, oklch(0.18 0.012 var(--brand-hue) / 38%), oklch(0.16 0.010 var(--brand-hue) / 26%));
    border: 1px solid oklch(0.33 0.015 var(--brand-hue) / 34%);
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 380px;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.05),
      0 8px 24px oklch(0.08 0.006 var(--brand-hue) / 20%);
    backdrop-filter: blur(22px) saturate(120%);
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: .25rem;
    color: oklch(0.95 0.008 var(--brand-hue));
  }
  .subtitle {
    font-size: .8rem;
    color: oklch(0.73 0.012 var(--brand-hue));
    margin-bottom: 1.5rem;
  }
  label {
    display: block;
    font-size: .75rem;
    font-weight: 500;
    color: oklch(0.73 0.012 var(--brand-hue));
    margin-bottom: .25rem;
  }
  input {
    width: 100%;
    padding: .5rem .75rem;
    font-size: 1rem;
    font-family: inherit;
    background: oklch(0.15 0.006 var(--brand-hue));
    border: 1px solid oklch(0.33 0.015 var(--brand-hue) / 34%);
    border-radius: 6px;
    color: oklch(0.95 0.008 var(--brand-hue));
    outline: none;
    transition: border-color .15s;
  }
  input:focus { border-color: oklch(0.84 0.085 var(--brand-hue)); }
  .field + .field { margin-top: .75rem; }
  button {
    margin-top: 1.25rem;
    width: 100%;
    padding: .5rem;
    font-size: .875rem;
    font-weight: 500;
    font-family: inherit;
    background: oklch(0.84 0.085 var(--brand-hue));
    color: oklch(0.18 0.008 var(--brand-hue));
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background .15s, opacity .15s;
  }
  button:hover { background: oklch(0.78 0.09 var(--brand-hue)); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .error {
    margin-top: .75rem;
    font-size: .8rem;
    color: oklch(0.69 0.20 21);
    display: none;
  }
  .error.visible { display: block; }
</style>
</head>
<body>
<div class="card">
  <h1>${__BRAND_PRODUCT_NAME} Web UI</h1>
  <p class="subtitle">Sign in to continue</p>
  <form id="loginForm" autocomplete="on">
    <div class="field">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button type="submit">Sign in</button>
    <p class="error" id="error">Invalid username or password.</p>
  </form>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var btn = this.querySelector('button');
  var err = document.getElementById('error');
  err.classList.remove('visible');
  btn.disabled = true;

  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    })
  }).then(function(res) {
    if (res.ok) {
      window.location.href = '/';
    } else {
      err.classList.add('visible');
      btn.disabled = false;
    }
  }).catch(function() {
    err.textContent = 'Connection error. Please try again.';
    err.classList.add('visible');
    btn.disabled = false;
  });
});
</script>
</body>
</html>`;
}
