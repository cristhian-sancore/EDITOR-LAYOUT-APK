/**
 * SAEMI SaaS - App Principal (pós-login)
 * Gerencia tabs, leituras, importações
 */

let currentImportacao = null;
let ocorrencias = [];
let saveTimers = {};

// ============================================
// SEGURANÇA — Sanitização XSS
// ============================================
/**
 * Escapa HTML para prevenir XSS Stored via dados do arquivo .REM
 * Converte < > " ' & em entidades HTML seguras
 */
function sanitize(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;

    let role = '';
    const user = api.getUser();
    if (user) {
        // Normalizar role para lowercase (evita inconsistência entre 'Supervisor' e 'supervisor')
        role = (user.role || '').toLowerCase();

        if (role === 'superadmin') {
            window.location.href = '/superadmin';
            return;
        }

        document.getElementById('user-name').textContent = user.nome;
        document.getElementById('user-role').textContent = role;
        document.getElementById('user-avatar').textContent = getInitials(user.nome);

        // Badge no mobile-header
        const mb = document.getElementById('mobile-user-badge');
        if (mb) mb.textContent = getInitials(user.nome);

        // Controle de visibilidade: supervisor/admin VÊ itens admin-only; leiturista NÃO
        const isAdmin = ['supervisor', 'admin', 'superadmin'].includes(role);
        document.querySelectorAll('.admin-only').forEach(el => {
            if (isAdmin) {
                el.classList.remove('hidden'); // garante visível para admin/supervisor
            } else {
                el.classList.add('hidden');    // esconde para leiturista
            }
        });
    }

    if (role === 'leiturista') {
        showTab('tab-leitura');
    } else {
        showTab('tab-dashboard');
    }

    // Carregar layout da Zebra ao iniciar
    ZebraPrint.fetchLayout().catch(() => {});
});

// ============================================
// BLUETOOTH GLOBAL (Zebra)
// ============================================
async function conectarZebraGlobal() {
    const btnM = document.getElementById('btn-bt-mobile');
    const btnD = document.getElementById('btn-bt-desktop');
    try {
        await ZebraPrint.connect();
        showToast('Impressora conectada com sucesso!', 'ok');
        if (btnM) btnM.textContent = '✅';
        if (btnD) btnD.textContent = '✅';
    } catch (e) {
        showToast('Erro Bluetooth: ' + e.message, 'error');
        if (btnM) btnM.textContent = '🖨️';
        if (btnD) btnD.textContent = '🖨️';
    }
}

// ============================================
// SIDEBAR MOBILE
// ============================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const btn = document.querySelector('.hamburger');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
        closeSidebar();
    } else {
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('open');
        if (btn) btn.classList.add('open');
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const btn = document.querySelector('.hamburger');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (btn) btn.classList.remove('open');
}

// ============================================
// NAVIGATION
// ============================================
function showTab(tabId, navEl) {
    // Fechar sidebar no mobile ao trocar de aba
    closeSidebar();
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    // Remove active from nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show selected tab
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.remove('hidden');

    // Activate nav
    if (navEl) {
        navEl.classList.add('active');
    } else {
        // Find nav by data-tab
        const nav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
        if (nav) nav.classList.add('active');
    }

    // Load data for tab
    switch (tabId) {
        case 'tab-dashboard': loadDashboard(); break;
        case 'tab-leitura': loadLeituras(); break;
        case 'tab-precos': loadPrecos(); break;
        case 'tab-historico': loadHistorico(); break;
        case 'tab-usuarios': loadUsuarios(); break;
        case 'tab-distribuicao': loadDistribuicao(); break;
    }
}

// ============================================
// DASHBOARD
// ============================================
async function loadDashboard() {
    try {
        const data = await api.getDashboard();

        document.getElementById('dash-total-imp').textContent = data.total_importacoes;
        document.getElementById('dash-total-users').textContent = data.total_usuarios;

        if (data.importacao_ativa) {
            // Só define currentImportacao se ainda não existe (não sobrescreve em operações de distribuição)
            if (!currentImportacao) currentImportacao = data.importacao_ativa;
            document.getElementById('dash-imp-nome').textContent = data.importacao_ativa.nome_arquivo;
            document.getElementById('dash-imp-status').textContent = data.importacao_ativa.status;
            document.getElementById('imp-active-info').classList.remove('hidden');
            document.getElementById('imp-empty-info').classList.add('hidden');
        } else {
            document.getElementById('imp-active-info').classList.add('hidden');
            document.getElementById('imp-empty-info').classList.remove('hidden');
        }

        if (data.stats) {
            document.getElementById('dash-clientes').textContent = fmtNumero(data.stats.total_clientes);
            document.getElementById('dash-realizadas').textContent = fmtNumero(data.stats.leituras_realizadas);
            document.getElementById('dash-pendentes').textContent = fmtNumero(data.stats.leituras_pendentes);
            document.getElementById('dash-consumo').textContent = fmtNumero(data.stats.consumo_total) + ' m³';
            document.getElementById('dash-valor').textContent = fmtMoeda(data.stats.valor_total);

            // Progress
            const pct = data.stats.total_clientes > 0
                ? ((data.stats.leituras_realizadas / data.stats.total_clientes) * 100).toFixed(1)
                : 0;
            document.getElementById('dash-progress-fill').style.width = pct + '%';
            document.getElementById('dash-progress-text').textContent = pct + '%';
        }

        // Progresso por rota
        if (currentImportacao) {
            const rotas = await api.getProgressoRota(currentImportacao.id);
            const rotasEl = document.getElementById('dash-rotas');
            rotasEl.innerHTML = '';
            rotas.forEach(r => {
                rotasEl.innerHTML += `
                    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-light)">
                        <code style="font-weight:700;width:50px">${r.rota}</code>
                        <div style="flex:1">
                            <div class="progress-bar"><div class="progress-fill" style="width:${r.percentual}%"></div></div>
                        </div>
                        <span style="font-size:0.8rem;color:var(--text-light);width:80px;text-align:right">${r.realizadas}/${r.total}</span>
                        <span style="font-weight:700;font-size:0.8rem;width:50px;text-align:right">${r.percentual}%</span>
                    </div>`;
            });
        }
    } catch (err) {
        console.error('Dashboard error:', err);
    }
}

// ============================================
// UPLOAD .REM
// ============================================
async function handleUpload() {
    const input = document.getElementById('file-rem');
    const file = input.files[0];
    if (!file) {
        showToast('Selecione um arquivo .REM', 'error');
        return;
    }

    showLoading();
    try {
        const imp = await api.uploadREM(file);
        currentImportacao = imp;
        showToast(`Arquivo importado! ${imp.total_clientes} clientes carregados.`);
        input.value = '';
        // Atualiza dashboard em segundo plano
        loadDashboard();
        // Verifica se o usuário é supervisor → vai pra Distribuição
        const user = api.getUser();
        if (user && user.role === 'supervisor') {
            showTab('tab-distribuicao');
            await loadDistribuicao();
        } else {
            showTab('tab-leitura');
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        hideLoading();
    }
}

// ============================================
// LEITURAS
// ============================================
// Lista global de todas as importações ativas
let _impsAtivas = [];

async function loadLeituras() {
    try {
        // Buscar TODAS as importações ativas
        const imps = await api.listImportacoes();
        _impsAtivas = imps.filter(i => i.status === 'ativo');

        if (!_impsAtivas.length) {
            document.getElementById('stat-total').textContent = '0';
            document.getElementById('stat-pend').textContent = '0';
            document.getElementById('stat-consumo').textContent = '0 m³';
            renderClientes([]);
            return;
        }

        // Usar a primeira para referência (ocorrências, mês, etc.)
        currentImportacao = _impsAtivas[0];

        // Carregar ocorrências da primeira importação (são iguais entre arquivos do mesmo mês)
        ocorrencias = await api.getOcorrencias(currentImportacao.id);

        // Agregar stats de TODAS as importações ativas
        let totalClientes = 0, totalPendentes = 0, totalConsumo = 0;
        await Promise.all(_impsAtivas.map(async imp => {
            try {
                const s = await api.getStats(imp.id);
                totalClientes += (s.total_clientes || 0);
                totalPendentes += (s.leituras_pendentes || 0);
                totalConsumo += (s.consumo_total || 0);
            } catch {}
        }));
        document.getElementById('stat-total').textContent = totalClientes;
        document.getElementById('stat-pend').textContent = totalPendentes;
        document.getElementById('stat-consumo').textContent = fmtNumero(totalConsumo) + ' m³';

        // Agregar clientes de TODAS as importações ativas
        const busca = document.getElementById('search-input')?.value || '';
        let allClientes = [];
        await Promise.all(_impsAtivas.map(async imp => {
            try {
                const clientes = await api.getClientes(imp.id, busca);
                // Guardar imp_id em cada cliente para contexto de impressão
                clientes.forEach(c => c._impId = imp.id);
                allClientes = allClientes.concat(clientes);
            } catch {}
        }));
        window._allClientesList = allClientes;
        renderClientes(allClientes);
    } catch (err) {
        showToast(err.message, 'error');
    }
}


function renderClientes(clientes) {
    const tbody = document.getElementById('lista-clientes');
    tbody.innerHTML = '';

    const isMobile = window.innerWidth <= 768;
    const mobileContainer = document.getElementById('lista-clientes-mobile');

    if (!clientes.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:40px">Nenhum cliente encontrado</td></tr>';
        if (mobileContainer) mobileContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px">Nenhum cliente encontrado</div>';
        return;
    }

    // Options de ocorrência — 0000 NORMAL como padrão
    let ocorrOptions = '<option value="0000">0000 - NORMAL</option>';
    ocorrencias.forEach(o => {
        if (o.codigo === '0000') return; // não duplicar o 0000
        ocorrOptions += `<option value="${o.codigo}">${o.codigo.padStart(4, '0')} - ${o.descricao}</option>`;
    });

    const catLabels = {
        residencial: 'Residencial', comercial: 'Comercial',
        industrial: 'Industrial', publica: 'Pública', tarifa_social: 'Social'
    };

    clientes.forEach(c => {
        const enderecoRaw = (c.rua || '') + (c.numero ? ', ' + c.numero : '');
        // Sanitizar TODOS os dados do .REM para prevenir XSS Stored
        const sMatricula = sanitize(c.matricula);
        const sNome     = sanitize(c.nome);
        const sEndereco = sanitize(enderecoRaw);
        const sBairro   = sanitize(c.bairro);
        const sZona     = sanitize((c.zona || '').trim());
        const sRota     = sanitize((c.rota || '').trim());
        const catLabel  = sanitize(catLabels[c.categoria] || c.categoria);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Matrícula"><code>${sMatricula}</code></td>
            <td data-label="Cliente">
                <div style="font-weight:600;font-size:0.85rem">${sNome}</div>
                <span class="badge badge-${sanitize(c.categoria)}">${catLabel}</span>
            </td>
            <td data-label="Endereço" class="endereco-cell">
                <div>${sEndereco}</div>
                <div class="info-small">${sBairro}</div>
            </td>
            <td data-label="Zona"><code>${sZona}</code></td>
            <td data-label="Rota"><code>${sRota}</code></td>
            <td data-label="Leit. Ant." style="font-weight:600;color:#475569">${sanitize(c.leitura_anterior)}</td>
            <td data-label="Leit. Atual">
                <input type="number" class="leitura-input" 
                    value="${c.leitura_atual !== null ? c.leitura_atual : ''}" 
                    oninput="onLeituraChange(${c.id}, this.value)"
                    placeholder="0" id="leit-${c.id}">
            </td>
            <td data-label="Ocorrência">
                <select class="ocorrencia-select" onchange="onOcorrenciaChange(${c.id}, this.value)" id="ocorr-${c.id}">
                    ${ocorrOptions}
                </select>
            </td>
            <td data-label="Consumo" class="consumo-cell" id="cons-${c.id}">${sanitize(c.consumo)}</td>
            <td data-label="Total" class="total-cell" id="tot-${c.id}">${fmtMoeda(c.valor_total)}</td>
            <td data-label="Imprimir">
                <button class="btn btn-sm btn-outline" id="btn-print-${c.id}"
                    onclick="abrirImpressao(${c.id})"
                    title="Imprimir conta"
                    ${(c.leitura_atual === null && (!c.ocorrencia_codigo || c.ocorrencia_codigo === '0000')) ? 'disabled style="opacity:0.4"' : ''}>
                    🖨️
                </button>
            </td>
        `;
        tbody.appendChild(tr);

        // Selecionar ocorrência correta
        if (c.ocorrencia_codigo) {
            const sel = document.getElementById(`ocorr-${c.id}`);
            if (sel) sel.value = c.ocorrencia_codigo;
        }
    });

    if (isMobile) {
        renderClientesMobile(clientes, ocorrOptions);
    }
}

// ============================================
// MOBILE LEITURA LOGIC
// ============================================
let _currentMobileCliente = null;

function renderClientesMobile(clientes, ocorrOptions) {
    const container = document.getElementById('lista-clientes-mobile');
    if (!container) return;
    container.innerHTML = '';
    
    // Guardar clientes globalmente para busca de "próximo"
    window._mobileClientesList = clientes;

    clientes.forEach(c => {
        const enderecoRaw = (c.rua || '') + (c.numero ? ', ' + c.numero : '');
        const lida = c.leitura_atual !== null || (c.ocorrencia_codigo && c.ocorrencia_codigo !== '0000');
        let statusClass = 'st-pendente';
        let statusText = 'Pendente';
        let cardClass = 'pendente';
        
        if (lida) {
            if (c.alerta) {
                statusClass = 'st-salva'; statusText = 'Salva (Alerta)'; cardClass = 'alerta';
            } else {
                statusClass = 'st-salva'; statusText = 'Salva'; cardClass = 'salva';
            }
        }

        const div = document.createElement('div');
        div.className = `card-leitura-mobile ${cardClass}`;
        div.onclick = () => abrirLeituraMobile(c.id);
        
        div.innerHTML = `
            <div class="cl-header">
                <span class="cl-nome">${sanitize(c.nome)}</span>
                <span class="cl-status ${statusClass}">${statusText}</span>
            </div>
            <div class="cl-detalhes">${sanitize(enderecoRaw)}</div>
            <div class="cl-detalhes"><strong>Mat:</strong> ${sanitize(c.matricula)} | <strong>Rota:</strong> ${sanitize(c.rota)}</div>
        `;
        container.appendChild(div);
    });
}

function abrirLeituraMobile(clienteId) {
    const cliente = window._mobileClientesList.find(c => c.id === clienteId);
    if (!cliente) return;
    
    _currentMobileCliente = cliente;
    
    document.getElementById('mlm-nome').textContent = cliente.nome;
    document.getElementById('mlm-endereco').textContent = (cliente.rua || '') + (cliente.numero ? ', ' + cliente.numero : '');
    document.getElementById('mlm-matricula').textContent = cliente.matricula;
    document.getElementById('mlm-rota').textContent = cliente.rota + ' / Seq: ' + (cliente.sequencia || '-');
    document.getElementById('mlm-anterior').textContent = (cliente.leitura_anterior || 0) + ' m³';
    document.getElementById('mlm-media').textContent = (cliente.consumo_medio || 0) + ' m³';
    
    document.getElementById('mlm-leitura-atual').value = cliente.leitura_atual !== null ? cliente.leitura_atual : '';
    
    // Popula select ocorrencia
    const sel = document.getElementById('mlm-ocorrencia');
    let ocorrOptions = '<option value="0000">0000 - NORMAL</option>';
    if (window.ocorrencias) {
        window.ocorrencias.forEach(o => {
            if (o.codigo === '0000') return;
            ocorrOptions += `<option value="${o.codigo}">${o.codigo.padStart(4, '0')} - ${o.descricao}</option>`;
        });
    }
    sel.innerHTML = ocorrOptions;
    sel.value = cliente.ocorrencia_codigo || '0000';
    
    document.getElementById('modal-leitura-mobile').classList.add('open');
    setTimeout(() => document.getElementById('mlm-leitura-atual').focus(), 300);
}

function fecharLeituraMobile() {
    document.getElementById('modal-leitura-mobile').classList.remove('open');
    _currentMobileCliente = null;
}

async function salvarLeituraMobileAtual(imprimir = false) {
    if (!_currentMobileCliente) return;
    const cliente = _currentMobileCliente;
    
    const inputLeitura = document.getElementById('mlm-leitura-atual');
    const inputOcorr = document.getElementById('mlm-ocorrencia');
    
    const leituraAtual = inputLeitura.value ? parseInt(inputLeitura.value, 10) : null;
    let ocorrenciaCod = inputOcorr.value || '0000';
    
    if (leituraAtual === null && ocorrenciaCod === '0000') {
        showToast('Informe a leitura ou uma ocorrência', 'error');
        return;
    }
    
    showLoading();
    try {
        const data = await api.salvarLeitura(cliente.id, {
            leitura_atual: leituraAtual,
            ocorrencia_codigo: ocorrenciaCod,
            latitude: window.currentPos?.lat || null,
            longitude: window.currentPos?.lng || null
        });
        
        showToast('Leitura salva com sucesso!');
        hideLoading();
        
        // Atualiza a lista visualmente nos bastidores sem recarregar tudo
        const cIdx = window._mobileClientesList.findIndex(c => c.id === cliente.id);
        if (cIdx !== -1) {
            window._mobileClientesList[cIdx].leitura_atual = leituraAtual;
            window._mobileClientesList[cIdx].ocorrencia_codigo = ocorrenciaCod;
            // Atualiza global list também para impressão
            const globalC = (window._allClientesList || []).find(x => x.id === cliente.id);
            if (globalC) {
                globalC.leitura_atual = leituraAtual;
                globalC.ocorrencia_codigo = ocorrenciaCod;
                globalC.consumo = data.consumo;
                globalC.valor_total = data.valor_total;
            }
            // Refaz a renderizacao mobile para mostrar 'Salva'
            renderClientesMobile(window._mobileClientesList, '');
        }

        if (imprimir) {
            abrirImpressao(cliente.id);
        }
        
        // Ir para o próximo pendente (começando a partir do cliente salvo)
        let proximoPendente = null;
        for (let i = cIdx + 1; i < window._mobileClientesList.length; i++) {
            const c = window._mobileClientesList[i];
            const lida = c.leitura_atual !== null || (c.ocorrencia_codigo && c.ocorrencia_codigo !== '0000');
            if (!lida) {
                proximoPendente = c;
                break;
            }
        }
        
        if (proximoPendente) {
            // Abre o proximo com um pequeno delay para a transição
            fecharLeituraMobile();
            setTimeout(() => abrirLeituraMobile(proximoPendente.id), 150);
        } else {
            fecharLeituraMobile();
            showToast('Todas as leituras desta rota parecem estar concluídas!');
        }
        
        // Dispara atualizacao de stats no background
        updateStats();
        
    } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
    }
}

function onLeituraChange(clienteId, value) {
    // Debounce: salvar após 500ms de inatividade
    if (saveTimers[clienteId]) clearTimeout(saveTimers[clienteId]);
    saveTimers[clienteId] = setTimeout(() => {
        salvarLeitura(clienteId);
    }, 500);
}

function onOcorrenciaChange(clienteId, value) {
    salvarLeitura(clienteId);
}

async function salvarLeitura(clienteId) {
    const leituraInput = document.getElementById(`leit-${clienteId}`);
    const ocorrSelect = document.getElementById(`ocorr-${clienteId}`);

    if (!leituraInput) return;

    const leituraAtual = leituraInput.value !== '' ? parseInt(leituraInput.value) : null;
    const ocorrencia = ocorrSelect ? ocorrSelect.value : '0000';
    const temOcorrenciaEspecial = ocorrencia && ocorrencia !== '0000';

    // Não salvar se: sem leitura E ocorrência é normal (nada útil a salvar)
    if (leituraAtual === null && !temOcorrenciaEspecial) return;

    // Capturar GPS se disponível
    let latitude = null, longitude = null;
    if (navigator.geolocation) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { 
                    timeout: 10000, 
                    maximumAge: 60000, 
                    enableHighAccuracy: true 
                });
            });
            latitude = pos.coords.latitude;
            longitude = pos.coords.longitude;
        } catch { /* GPS não disponível */ }
    }

    try {
        const result = await api.salvarLeitura(clienteId, {
            leitura_atual: leituraAtual,
            ocorrencia_codigo: ocorrencia || null,
            latitude,
            longitude,
        });

        // Atualizar UI — células de consumo e total
        const consCell = document.getElementById(`cons-${clienteId}`);
        const totCell = document.getElementById(`tot-${clienteId}`);
        consCell.textContent = result.consumo;
        totCell.textContent = fmtMoeda(result.valor_total);

        // Habilitar botão de impressão: quando tem leitura OU quando ocorrência especial foi salva
        const btnPrint = document.getElementById(`btn-print-${clienteId}`);
        if (btnPrint) {
            const ocorrAtual = ocorrSelect ? ocorrSelect.value : '';
            const temOcorrEspecial = ocorrAtual && ocorrAtual !== '0000';
            if (leituraAtual !== null || temOcorrEspecial) {
                btnPrint.disabled = false;
                btnPrint.style.opacity = '1';
            } else {
                btnPrint.disabled = true;
                btnPrint.style.opacity = '0.4';
            }
        }

        // Alertas de consumo alto/baixo/zero
        consCell.style.color = '';
        consCell.style.fontWeight = '';
        consCell.title = '';
        if (result.alerta === 'alto') {
            consCell.style.color = '#ef4444';
            consCell.style.fontWeight = '800';
            consCell.title = result.mensagem;
            showToast(result.mensagem, 'error');
        } else if (result.alerta === 'zero') {
            consCell.style.color = '#f59e0b';
            consCell.style.fontWeight = '800';
            consCell.title = result.mensagem;
            showToast(result.mensagem, 'error');
        } else if (result.alerta === 'baixo') {
            consCell.style.color = '#3b82f6';
            consCell.style.fontWeight = '800';
            consCell.title = result.mensagem;
            showToast(result.mensagem, 'error');
        }

        // Atualizar stats (sem bloquear)
        updateStats();
    } catch (err) {
        showToast('Erro ao salvar: ' + err.message, 'error');
    }
}

async function updateStats() {
    if (!_impsAtivas.length && !currentImportacao) return;
    try {
        const lista = _impsAtivas.length ? _impsAtivas : [currentImportacao];
        let totalClientes = 0, totalPendentes = 0, totalConsumo = 0;
        await Promise.all(lista.map(async imp => {
            try {
                const s = await api.getStats(imp.id);
                totalClientes += (s.total_clientes || 0);
                totalPendentes += (s.leituras_pendentes || 0);
                totalConsumo += (s.consumo_total || 0);
            } catch {}
        }));
        document.getElementById('stat-total').textContent = totalClientes;
        document.getElementById('stat-pend').textContent = totalPendentes;
        document.getElementById('stat-consumo').textContent = fmtNumero(totalConsumo) + ' m³';
    } catch { /* silent */ }
}

const debouncedSearch = debounce(() => loadLeituras(), 400);
function onSearch(value) {
    debouncedSearch();
}

// ============================================
// EXPORTAR .RET
// ============================================
async function exportarRET() {
    if (!currentImportacao) {
        showToast('Nenhuma importação ativa', 'error');
        return;
    }

    showLoading();
    try {
        const { blob, filename } = await api.exportarRET(currentImportacao.id);
        downloadBlob(blob, filename);
        showToast(`Arquivo ${filename} gerado com sucesso!`);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        hideLoading();
    }
}

// ============================================
// PREÇOS
// ============================================
async function loadPrecos() {
    if (!currentImportacao) return;
    try {
        const tarifas = await api.getTarifas(currentImportacao.id);
        const container = document.getElementById('precos-content');
        container.innerHTML = '';

        // Agrupar por categoria
        const grouped = {};
        tarifas.forEach(t => {
            if (!grouped[t.categoria]) grouped[t.categoria] = { agua: [], lixo: [] };
            grouped[t.categoria][t.servico].push(t);
        });

        for (const [cat, servicos] of Object.entries(grouped)) {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.display = 'inline-block';
            card.style.marginRight = '12px';
            card.style.marginBottom = '12px';
            card.style.verticalAlign = 'top';
            card.style.minWidth = '220px';

            let html = `<h3 style="margin-bottom:12px"><span class="badge badge-${cat}">${cat.toUpperCase()}</span></h3>`;

            if (servicos.agua.length) {
                const min = servicos.agua.find(f => f.valor_minimo);
                html += `<p style="font-size:0.85rem"><strong>Água Mín:</strong> ${min ? fmtMoeda(min.valor_minimo) : '-'}</p>`;
            }
            if (servicos.lixo.length) {
                const min = servicos.lixo.find(f => f.valor_minimo);
                html += `<p style="font-size:0.85rem"><strong>Lixo Mín:</strong> ${min ? fmtMoeda(min.valor_minimo) : '-'}</p>`;
            }

            card.innerHTML = html;
            container.appendChild(card);
        }

        if (!Object.keys(grouped).length) {
            container.innerHTML = '<p style="color:var(--text-muted)">Nenhuma tarifa carregada.</p>';
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================
// HISTÓRICO
// ============================================
async function loadHistorico() {
    try {
        const imps = await api.listImportacoes();
        const tbody = document.getElementById('historico-body');
        tbody.innerHTML = '';

        imps.forEach(imp => {
            const date = new Date(imp.data_importacao).toLocaleDateString('pt-BR');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${imp.id}</code></td>
                <td style="font-weight:600">${imp.nome_arquivo}</td>
                <td>${date}</td>
                <td>${imp.total_clientes}</td>
                <td>
                    <span class="status-dot status-${imp.status}"></span>
                    ${imp.status}
                </td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="selectImportacao(${imp.id}, '${imp.nome_arquivo}', ${imp.total_clientes}, '${imp.status}', '${imp.mes_referencia || ''}')">
                        Abrir
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (!imps.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">Nenhuma importação encontrada</td></tr>';
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function selectImportacao(id, nome, total, status, mesRef) {
    currentImportacao = { id, nome_arquivo: nome, total_clientes: total, status, mes_referencia: mesRef };
    showToast(`Importação "${nome}" selecionada`);
    showTab('tab-leitura');
}

// ============================================
// USUÁRIOS
// ============================================
async function loadUsuarios() {
    try {
        const usuarios = await api.listUsuarios();
        const tbody = document.getElementById('usuarios-body');
        tbody.innerHTML = '';

        if (!usuarios.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Nenhum usuário cadastrado</td></tr>';
            return;
        }

        const currentUser = api.getUser();

        usuarios.forEach(u => {
            const date = new Date(u.created_at).toLocaleDateString('pt-BR');
            const isSelf = currentUser && u.id === currentUser.id;
            const canEdit = u.role === 'leiturista' || u.role === 'supervisor';
            const tr = document.createElement('tr');
            tr.id = `user-row-${u.id}`;
            tr.innerHTML = `
                <td style="font-weight:600">${sanitize(u.nome)}</td>
                <td>${sanitize(u.email)}</td>
                <td><span class="badge badge-${u.role}">${u.role.toUpperCase()}</span></td>
                <td>${u.ativo ? '<span style="color:#22c55e">&#10003; Ativo</span>' : '<span style="color:#ef4444">&#10007; Inativo</span>'}</td>
                <td>${date}</td>
                <td style="display:flex;gap:6px;flex-wrap:wrap">
                    ${canEdit && !isSelf ? `
                        <button class="btn btn-sm btn-outline" onclick="abrirModalEditarUsuario(${u.id}, '${sanitize(u.nome)}', '${sanitize(u.email)}', '${u.role}')" title="Editar usuário">
                            ✏️ Editar
                        </button>
                        <button class="btn btn-sm btn-outline" style="border-color:#f59e0b;color:#f59e0b" onclick="abrirModalSenha(${u.id}, '${sanitize(u.nome)}')" title="Redefinir senha">
                            🔑 Senha
                        </button>
                    ` : ''}
                    ${!isSelf ? `
                        <button class="btn btn-sm ${u.ativo ? 'btn-danger' : 'btn-outline'}" onclick="toggleUsuario(${u.id}, ${u.ativo})">
                            ${u.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                    ` : '<span style="color:var(--text-muted);font-size:.75rem">(você)</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== MODAIS DE USUÁRIO =====

function abrirModalNovoUsuario() {
    document.getElementById('modal-usuario-titulo').textContent = 'Novo Usuário';
    document.getElementById('modal-usuario-id').value = '';
    document.getElementById('modal-usuario-btn').textContent = 'Criar Usuário';
    document.getElementById('modal-user-nome').value = '';
    document.getElementById('modal-user-email').value = '';
    document.getElementById('modal-user-senha').value = '';
    document.getElementById('modal-user-senha').required = true;
    document.getElementById('modal-user-role').value = 'leiturista';
    document.getElementById('modal-senha-hint').textContent = '';
    document.getElementById('modal-usuario').style.display = 'flex';
    document.getElementById('modal-user-nome').focus();
}

function abrirModalEditarUsuario(id, nome, email, role) {
    document.getElementById('modal-usuario-titulo').textContent = '✏️ Editar Usuário';
    document.getElementById('modal-usuario-id').value = id;
    document.getElementById('modal-usuario-btn').textContent = 'Salvar Alterações';
    document.getElementById('modal-user-nome').value = nome;
    document.getElementById('modal-user-email').value = email;
    document.getElementById('modal-user-senha').value = '';
    document.getElementById('modal-user-senha').required = false;
    document.getElementById('modal-user-role').value = role;
    document.getElementById('modal-senha-hint').textContent = 'Deixe em branco para não alterar a senha.';
    document.getElementById('modal-usuario').style.display = 'flex';
    document.getElementById('modal-user-nome').focus();
}

function fecharModalUsuario() {
    document.getElementById('modal-usuario').style.display = 'none';
}

async function submitModalUsuario(e) {
    e.preventDefault();
    const id    = document.getElementById('modal-usuario-id').value;
    const nome  = document.getElementById('modal-user-nome').value.trim();
    const email = document.getElementById('modal-user-email').value.trim();
    const senha = document.getElementById('modal-user-senha').value;
    const role  = document.getElementById('modal-user-role').value;
    const btn   = document.getElementById('modal-usuario-btn');

    btn.disabled = true;
    btn.textContent = '⏳ Salvando…';
    try {
        if (id) {
            // Editar
            const data = { nome, email, role };
            if (senha) data.senha = senha;
            await api.updateUsuario(id, data);
            showToast(`✅ Usuário ${nome} atualizado!`);
        } else {
            // Criar
            await api.createUsuario({ nome, email, senha, role });
            showToast(`✅ Usuário ${nome} criado!`);
        }
        fecharModalUsuario();
        loadUsuarios();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = id ? 'Salvar Alterações' : 'Criar Usuário';
    }
}

function abrirModalSenha(id, nome) {
    document.getElementById('modal-senha-id').value = id;
    document.getElementById('modal-senha-nome').textContent = nome;
    document.getElementById('modal-nova-senha').value = '';
    document.getElementById('modal-senha').style.display = 'flex';
    document.getElementById('modal-nova-senha').focus();
}

function fecharModalSenha() {
    document.getElementById('modal-senha').style.display = 'none';
}

async function submitModalSenha(e) {
    e.preventDefault();
    const id    = document.getElementById('modal-senha-id').value;
    const senha = document.getElementById('modal-nova-senha').value;
    try {
        const res = await api._json(`/usuarios/${id}/reset-senha`, {
            method: 'POST',
            body: JSON.stringify({ nova_senha: senha }),
        });
        showToast(`🔑 ${res.detail}`);
        fecharModalSenha();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function toggleUsuario(id, ativoAtual) {
    const acao = ativoAtual ? 'desativar' : 'reativar';
    if (!confirm(`Deseja ${acao} este usuário?`)) return;
    try {
        if (ativoAtual) {
            await api.deleteUsuario(id);
        } else {
            await api.updateUsuario(id, { ativo: true });
        }
        showToast(`Usuário ${ativoAtual ? 'desativado' : 'reativado'}!`);
        loadUsuarios();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Alias legado
async function desativarUsuario(id) { await toggleUsuario(id, true); }
async function criarUsuario(e) { await submitModalUsuario(e); }
function abrirResetSenha(id, nome) { abrirModalSenha(id, nome); }

// IMPRESSÃO ZEBRA LIS
// ============================================
async function abrirImpressao(clienteId) {
    const user = api.getUser();
    const imp = currentImportacao;
    if (!imp) return;

    // Achar cliente na lista global para obter o resto dos dados
    const c = (window._allClientesList || []).find(x => x.id === clienteId) || {};

    // Coletar dados do DOM (pois a leitura acabou de ser feita e pode não estar na lista global se não recarregou)
    // Se não achar no DOM (ex: mobile), pega da lista global `c`
    const leitAtual = document.getElementById(`leit-${clienteId}`)?.value || c.leitura_atual || '0';
    const consumo = document.getElementById(`cons-${clienteId}`)?.textContent || c.consumo || '0';
    const total = document.getElementById(`tot-${clienteId}`)?.textContent?.replace(/[^0-9,]/g,'').replace(',','.') || c.valor_total || '0';
    const ocorr = document.getElementById(`ocorr-${clienteId}`)?.value || c.ocorrencia_codigo || '';

    // Salva dados completos no sessionStorage para a janela de impressão ler (evita limite de URL)
    const dados = {
        matricula:          c.matricula || clienteId,
        mes_ref:            imp.mes_referencia || c.mes_ano_ref || '',
        referencia:         imp.mes_referencia || c.mes_ano_ref || '',
        data_leitura:       new Date().toLocaleDateString('pt-BR'),
        consumo:            consumo,
        valor_total:        total,
        ocorrencia:         ocorr,
        ocorrencia_codigo:  ocorr,
        ocorrencia_descricao: c.ocorrencia_descricao || '',
        leiturista:         user?.nome || '',
        nome:               c.nome || '',
        endereco:           c.rua || '',
        numero:             c.numero || '',
        bairro:             c.bairro || '',
        rota:               c.rota || '',
        setor:              c.sequencia || '',
        quadra:             '',
        lote:               '',
        leit_anterior:      c.leitura_anterior || '0',
        leitura_anterior:   c.leitura_anterior || '0',
        leitura_atual:      leitAtual,
        leit_atual:         leitAtual,
        categoria:          c.categoria || '',
        valor_agua:         c.valor_agua || '0',
        valor_esgoto:       c.valor_esgoto || '0',
        valor_lixo:         c.valor_lixo || '0',
        cep:                c.cep || '',
        vencimento:         c.data_vencimento || '',
        num_fatura:         c.num_fatura || '',
        nosso_numero:       c.num_fatura || c.matricula || '',
        data_leit_anterior: c.data_leit_anterior || '',
        ocorr_anterior:     c.ocorr_anterior || '',
        hidrometro:         c.hidrometro || '',
        nr_hidrometro:      c.hidrometro || '',
        vazao:              c.vazao || '',
        diametro:           c.diametro || '',
        data_instalacao:    c.data_instalacao || '',
        endereco_entrega:   c.endereco_entrega || '',
        codigo_barras:      c.codigo_barras || '',
        desc_agua:          imp.desc_agua || 'FORNEC. E ABASTEC. DE AGUA',
        desc_esgoto:        imp.desc_esgoto || 'ESGOTO',
        desc_lixo:          imp.desc_lixo || 'TAXA DE COLETA DE LIXO',
        mensagens_fatura:   c.mensagens_fatura || [],
        historico_consumo:  c.historico_consumo || c.historico || [],
        tem_notificacao:    c.tem_notificacao || false,
    };

    if (ZebraPrint.isConnected()) {
        try {
            await ZebraPrint.imprimirConta(dados);
            showToast('🖨️ Fatura impressa!');
        } catch (e) {
            showToast('Erro ao imprimir: ' + e.message, 'error');
        }
        return;
    }

    sessionStorage.setItem('saemi_print_data', JSON.stringify(dados));
    window.open('/print-conta', '_blank', 'width=900,height=700');
}

async function desativarUsuario(id) {
    if (!confirm('Desativar este usuário?')) return;
    try {
        await api.deleteUsuario(id);
        showToast('Usuário desativado');
        loadUsuarios();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================
// DISTRIBUICAO DE LEITURAS POR LEITURISTA
// Workflow: 1 arquivo .REM = 1 rota = 1 leiturista
// ============================================

let _leituristas = [];

/** Upload do .REM — adiciona à lista sem substituir */
async function handleUploadDistribuicao(file) {
    if (!file) return;
    const loading = document.getElementById('distrib-loading');
    const zone    = document.getElementById('distrib-upload-zone');
    loading.style.display = '';
    zone.style.pointerEvents = 'none';
    try {
        const imp = await api.uploadREM(file);
        document.getElementById('file-rem-distrib').value = '';
        showToast(`📂 ${imp.total_clientes} clientes importados! Selecione o leiturista.`);
        await loadDistribuicao();
    } catch (err) {
        showToast('Erro ao importar: ' + (err.message || err), 'error');
    } finally {
        loading.style.display = 'none';
        zone.style.pointerEvents = '';
    }
}

/** Drag & drop */
function handleDropDistribuicao(event) {
    const file = event.dataTransfer.files[0];
    if (file) handleUploadDistribuicao(file);
}

/** Carrega a aba — sempre mostra upload + lista todas as importações ativas */
async function loadDistribuicao() {
    try {
        const [imps, usuarios] = await Promise.all([
            api.listImportacoes(),
            api._json('/usuarios/').catch(() => []),
        ]);
        _leituristas = (usuarios || []).filter(u => (u.role || '').toLowerCase() === 'leiturista' && u.ativo);
        const ativas = (imps || []).filter(i => i.status === 'ativo');

        // Busca rotas e atribuições de cada importação em paralelo
        const rotasLists = await Promise.all(
            ativas.map(imp => api._json(`/atribuicoes/${imp.id}/rotas`).catch(() => []))
        );
        renderImportacoesList(ativas, rotasLists);
    } catch (err) {
        showToast('Erro ao carregar distribuição: ' + err.message, 'error');
    }
}

/** Renderiza os cards de cada importação ativa */
function renderImportacoesList(importacoes, rotasPorImp) {
    const header    = document.getElementById('distrib-lista-header');
    const container = document.getElementById('distrib-lista-cards');
    const btnSalvar = document.getElementById('btn-salvar-distrib');

    if (!importacoes.length) {
        header.style.display = 'none';
        btnSalvar.style.display = 'none';
        container.innerHTML = `
            <div style="text-align:center;padding:32px;color:var(--text-muted)">
                <div style="font-size:2rem;margin-bottom:8px">📭</div>
                <p>Nenhuma rota importada ainda. Use a área acima para importar um arquivo .REM.</p>
            </div>`;
        return;
    }

    header.style.display = '';
    btnSalvar.style.display = '';

    const optsLeit = _leituristas.map(u =>
        `<option value="${u.id}">${sanitize(u.nome)}</option>`
    ).join('');

    container.innerHTML = importacoes.map((imp, idx) => {
        const rotas    = rotasPorImp[idx] || [];
        const rotaNome = rotas.length ? rotas.map(r => r.rota).join(', ') : '—';
        const leitAtrib = rotas.length && rotas[0].leiturista_id ? rotas[0].leiturista_id : '';
        const dataRotas = sanitize(JSON.stringify(rotas.map(r => r.rota)));
        const totalFeito = rotas.reduce((s, r) => s + (r.leituras_feitas || 0), 0);
        const totalClientes = imp.total_clientes || 0;
        const perc = totalClientes > 0 ? Math.round(totalFeito / totalClientes * 100) : 0;

        return `
        <div class="card" style="margin-bottom:12px;padding:16px 20px"
             data-imp-id="${imp.id}" data-rotas='${dataRotas}'>
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
                <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:200px">
                    <span style="font-size:2rem">📄</span>
                    <div>
                        <div style="font-weight:700;font-size:0.95rem">${sanitize(imp.nome_arquivo || 'Arquivo')}</div>
                        <div style="color:var(--text-muted);font-size:0.8rem;margin-top:2px">
                            Rota: <strong>${sanitize(rotaNome)}</strong>
                            &nbsp;·&nbsp; ${totalClientes} clientes
                            &nbsp;·&nbsp; Ref: ${sanitize(imp.mes_referencia || '—')}
                            &nbsp;·&nbsp; <span style="color:${perc>=100?'#22c55e':'var(--primary)'}">${perc}% feito</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                    <div style="display:flex;align-items:center;gap:8px">
                        <label style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap">👤 Leiturista:</label>
                        <select id="leit-imp-${imp.id}" style="min-width:160px">
                            <option value="">-- Sem atribuição --</option>
                            ${optsLeit}
                        </select>
                    </div>
                    <button class="btn btn-outline btn-sm"
                            onclick="removerImportacao(${imp.id})"
                            title="Remover esta rota">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');

    // Pré-selecionar leituristas já atribuídos
    importacoes.forEach((imp, idx) => {
        const rotas = rotasPorImp[idx] || [];
        if (rotas.length && rotas[0].leiturista_id) {
            const sel = document.getElementById(`leit-imp-${imp.id}`);
            if (sel) sel.value = String(rotas[0].leiturista_id);
        }
    });
}

/** Salva todas as atribuições (uma por importação/rota) */
async function salvarDistribuicaoCompleta() {
    const cards = document.querySelectorAll('[data-imp-id]');
    if (!cards.length) return showToast('Nenhuma rota para salvar', 'error');

    const btn = document.getElementById('btn-salvar-distrib');
    btn.disabled = true;
    btn.textContent = '⏳ Salvando…';

    let totalClientes = 0;
    let erros = 0;

    try {
        for (const card of cards) {
            const impId  = card.dataset.impId;
            const rotas  = JSON.parse(card.dataset.rotas || '[]');
            const leitId = document.getElementById(`leit-imp-${impId}`)?.value;

            if (!rotas.length) continue;

            // Monta atribuições para todas as rotas deste arquivo
            const atribuicoes = rotas.map(rota => ({
                rota,
                leiturista_id: leitId ? parseInt(leitId) : null,
            }));

            try {
                const res = await api._json(`/atribuicoes/${impId}/atribuir`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ atribuicoes }),
                });
                totalClientes += res.clientes_atualizados || 0;
            } catch (e) {
                erros++;
                console.error(`Erro ao salvar importação ${impId}:`, e.message);
            }
        }

        if (erros === 0) {
            showToast(`✅ Distribuição salva! ${totalClientes} clientes distribuídos.`);
        } else {
            showToast(`⚠️ Salvo com ${erros} erro(s). Verifique o console.`, 'error');
        }
        await loadDistribuicao();
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar Distribuição';
    }
}

/** Remove uma importação (muda status para cancelado) */
async function removerImportacao(impId) {
    if (!confirm('Remover esta rota? Os dados de leitura serão perdidos.')) return;
    try {
        await api._json(`/importacao/${impId}/status?status=cancelado`, { method: 'PUT' });
        showToast('Rota removida.');
        await loadDistribuicao();
    } catch (err) {
        showToast('Erro ao remover: ' + err.message, 'error');
    }
}

// Funções legadas mantidas para compatibilidade (não usadas na nova UI)
function resetDistribuicao() { loadDistribuicao(); }
async function salvarAtribuicoes() { await salvarDistribuicaoCompleta(); }
async function limparAtribuicoes() {}
function renderLeitureistaCards() {}
function renderRotasTable() {}
function atribuirTodosParaUm() {}
function aplicarTodosParaUm() {}
async function _carregarAtribuicoes() {}


