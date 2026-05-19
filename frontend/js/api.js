/**
 * SAEMI SaaS - API Client
 * Módulo de comunicação com o backend FastAPI
 */

const API_BASE = '/api/v1';

class ApiClient {
    constructor() {
        this.token = localStorage.getItem('saemi_token');
        this.refreshToken = localStorage.getItem('saemi_refresh');
    }

    setTokens(access, refresh) {
        this.token = access;
        this.refreshToken = refresh;
        localStorage.setItem('saemi_token', access);
        localStorage.setItem('saemi_refresh', refresh);
    }

    clearTokens() {
        this.token = null;
        this.refreshToken = null;
        localStorage.removeItem('saemi_token');
        localStorage.removeItem('saemi_refresh');
        localStorage.removeItem('saemi_user');
    }

    getUser() {
        const u = localStorage.getItem('saemi_user');
        return u ? JSON.parse(u) : null;
    }

    setUser(user) {
        localStorage.setItem('saemi_user', JSON.stringify(user));
    }

    isLoggedIn() {
        return !!this.token;
    }

    async _fetch(url, options = {}) {
        const headers = { ...options.headers };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        const resp = await fetch(`${API_BASE}${url}`, { ...options, headers });

        if (resp.status === 401 && this.refreshToken) {
            // Tentar refresh
            const refreshResp = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: this.refreshToken }),
            });

            if (refreshResp.ok) {
                const data = await refreshResp.json();
                this.setTokens(data.access_token, data.refresh_token);
                this.setUser(data.user);
                headers['Authorization'] = `Bearer ${data.access_token}`;
                return fetch(`${API_BASE}${url}`, { ...options, headers });
            } else {
                this.clearTokens();
                window.location.href = '/';
                return resp;
            }
        }

        return resp;
    }

    async _json(url, options = {}) {
        const resp = await this._fetch(url, options);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: 'Erro desconhecido' }));
            throw new Error(err.detail || `Erro ${resp.status}`);
        }
        return resp.json();
    }

    // ======== AUTH ========
    async register(data) {
        return this._json('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async login(email, senha) {
        return this._json('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, senha }),
        });
    }

    async getMe() {
        return this._json('/auth/me');
    }

    // ======== EMPRESA ========
    async getEmpresa() {
        return this._json('/empresa/');
    }

    // ======== USUÁRIOS ========
    async listUsuarios() {
        return this._json('/usuarios/');
    }

    async createUsuario(data) {
        return this._json('/usuarios/', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async updateUsuario(id, data) {
        return this._json(`/usuarios/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async deleteUsuario(id) {
        return this._json(`/usuarios/${id}`, { method: 'DELETE' });
    }

    // ======== IMPORTAÇÃO ========
    async uploadREM(file) {
        const formData = new FormData();
        formData.append('file', file);
        return this._json('/importacao/upload', {
            method: 'POST',
            body: formData,
        });
    }

    async listImportacoes() {
        return this._json('/importacao/');
    }

    // ======== LEITURAS ========
    async getClientes(impId, busca = '') {
        const q = busca ? `?busca=${encodeURIComponent(busca)}` : '';
        return this._json(`/leituras/${impId}${q}`);
    }

    async salvarLeitura(clienteId, data) {
        return this._json(`/leituras/${clienteId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async getStats(impId) {
        return this._json(`/leituras/${impId}/stats`);
    }

    async getOcorrencias(impId) {
        return this._json(`/leituras/${impId}/ocorrencias`);
    }

    async getTarifas(impId) {
        return this._json(`/leituras/${impId}/tarifas`);
    }

    // ======== EXPORTAÇÃO ========
    async exportarRET(impId) {
        const resp = await this._fetch(`/exportacao/${impId}/ret`, { method: 'POST' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: 'Erro' }));
            throw new Error(err.detail);
        }
        const blob = await resp.blob();
        const cd = resp.headers.get('content-disposition') || '';
        const match = cd.match(/filename="(.+?)"/);
        const filename = match ? match[1] : 'RETORNO.RET';
        return { blob, filename };
    }

    async getHistoricoExport() {
        return this._json('/exportacao/historico');
    }

    // ======== DASHBOARD ========
    async getDashboard() {
        return this._json('/dashboard/resumo');
    }

    async getProgressoRota(impId) {
        return this._json(`/dashboard/por-rota?imp_id=${impId}`);
    }

    // ======== GENÉRICO — usado pelos módulos de distribuição ========
    /**
     * Alias de _json para chamadas dinâmicas (GET por padrão, ou com options)
     */
    async fetch(url, options = {}) {
        return this._json(url, options);
    }
}

// Instância global
const api = new ApiClient();
