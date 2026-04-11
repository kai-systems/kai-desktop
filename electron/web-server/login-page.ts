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
<title>Kai — Login</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #0a0a0b;
    color: #e4e4e7;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 4px 24px rgba(0,0,0,.4);
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: .25rem;
  }
  .subtitle {
    font-size: .8rem;
    color: #71717a;
    margin-bottom: 1.5rem;
  }
  label {
    display: block;
    font-size: .75rem;
    font-weight: 500;
    color: #a1a1aa;
    margin-bottom: .25rem;
  }
  input {
    width: 100%;
    padding: .5rem .75rem;
    font-size: .875rem;
    font-family: inherit;
    background: #09090b;
    border: 1px solid #27272a;
    border-radius: 6px;
    color: #e4e4e7;
    outline: none;
    transition: border-color .15s;
  }
  input:focus { border-color: #3b82f6; }
  .field + .field { margin-top: .75rem; }
  button {
    margin-top: 1.25rem;
    width: 100%;
    padding: .5rem;
    font-size: .875rem;
    font-weight: 500;
    font-family: inherit;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background .15s;
  }
  button:hover { background: #2563eb; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .error {
    margin-top: .75rem;
    font-size: .8rem;
    color: #ef4444;
    display: none;
  }
  .error.visible { display: block; }
</style>
</head>
<body>
<div class="card">
  <h1>Kai Web UI</h1>
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
