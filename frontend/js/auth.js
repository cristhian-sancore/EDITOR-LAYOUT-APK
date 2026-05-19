/**
 * SAEMI SaaS - Auth Module
 * Gerencia login, registro e estado de autenticação
 */

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');

    btn.disabled = true;
    btn.textContent = 'Entrando...';
    errEl.classList.add('hidden');

    try {
        const data = await api.login(email, senha);
        api.setTokens(data.access_token, data.refresh_token);
        api.setUser(data.user);
        window.location.href = '/app';
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
    }
}


function logout() {
    api.clearTokens();
    window.location.href = '/';
}

function checkAuth() {
    if (!api.isLoggedIn()) {
        window.location.href = '/';
        return false;
    }
    return true;
}
