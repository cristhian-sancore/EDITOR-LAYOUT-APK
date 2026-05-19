/**
 * SAEMI - Módulo de Impressão Zebra ZQ520/ZQ521 via Web Bluetooth (CPCL)
 */

const ZebraPrint = (() => {
  let device = null;
  let server = null;
  let printCharacteristic = null;
  let customLayout = null;
  let customLayoutNotif = null;

  // UUIDs Zebra BLE
  const ZEBRA_SERVICE = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
  const ZEBRA_WRITE   = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
  const SPP_SERVICE   = '000018f0-0000-1000-8000-00805f9b34fb';
  const SPP_WRITE     = '00002af1-0000-1000-8000-00805f9b34fb';

  // ── Conexao Bluetooth ──────────────────────────────────
  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth nao suportado. Use Chrome no Android.');
    }
    try {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [ZEBRA_SERVICE, SPP_SERVICE]
      });
      server = await device.gatt.connect();
      try {
        const svc = await server.getPrimaryService(ZEBRA_SERVICE);
        printCharacteristic = await svc.getCharacteristic(ZEBRA_WRITE);
      } catch (_) {
        const svc = await server.getPrimaryService(SPP_SERVICE);
        printCharacteristic = await svc.getCharacteristic(SPP_WRITE);
      }
      device.addEventListener('gattserverdisconnected', onDisconnected);
      return true;
    } catch (e) {
      console.error('BT connect error:', e);
      throw new Error('Falha ao conectar: ' + e.message);
    }
  }

  function onDisconnected() {
    device = null; server = null; printCharacteristic = null;
    const el = document.getElementById('printer-status');
    if (el) { el.className = 'status-err'; el.textContent = 'Desconectado'; }
    const btn = document.getElementById('btn-imprimir');
    if (btn) btn.disabled = true;
  }

  function isConnected() { return printCharacteristic !== null; }

  // ── Envio BLE em chunks ────────────────────────────────
  async function sendData(dataStr) {
    if (!isConnected()) throw new Error('Impressora nao conectada');
    const data = new TextEncoder().encode(dataStr);
    const CHUNK = 512;
    for (let i = 0; i < data.length; i += CHUNK) {
      await printCharacteristic.writeValue(data.slice(i, i + CHUNK));
    }
    return true;
  }

  // ── Busca layouts da API ───────────────────────────────
  async function fetchLayout() {
    const token = localStorage.getItem('saemi_token');
    if (!token) return;
    try {
      const res = await fetch('/api/v1/empresa/layout', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        const data = await res.json();
        customLayout      = data.conteudo_cpcl || null;
        customLayoutNotif = data.conteudo_cpcl_notificacao || null;
        console.log('[ZebraPrint] Fatura:', !!customLayout, '| Notif:', !!customLayoutNotif);
      }
    } catch (e) {
      console.warn('[ZebraPrint] Sem layout customizado, usando generico.', e);
    }
  }

  // ── Mapa completo de variáveis ─────────────────────────
  function removerAcentos(str) {
    if(!str) return '';
    // Strip accents but KEEP newlines (essential for CPCL)
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function formatarValor(val) {
    return parseFloat(val || 0).toFixed(2).replace('.', ',');
  }

  function formatData(data) {
    if (!data) return '';
    
    // Se for objeto Date
    if (data instanceof Date) {
      return data.toLocaleDateString('pt-BR');
    }

    // Se for string no formato YYYY-MM-DD ou DD/MM/YYYY
    const s = String(data);
    if (s.indexOf('-') > 0) {
      let p = s.split('-');
      if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0];
    }
    return s;
  }

  function modulo10(bloco) {
      let soma = 0;
      let peso = 2;
      for (let i = bloco.length - 1; i >= 0; i--) {
          let num = parseInt(bloco.charAt(i), 10);
          let mult = num * peso;
          if (mult > 9) {
              mult = Math.floor(mult / 10) + (mult % 10);
          }
          soma += mult;
          peso = peso === 2 ? 1 : 2;
      }
      let resto = soma % 10;
      let dv = 10 - resto;
      if (dv === 10) return 0;
      return dv;
  }

  function formatarLinhaDigitavel(cb) {
      if (!cb || cb.length !== 44) return cb;
      let b1 = cb.substring(0, 11);
      let d1 = modulo10(b1);
      let b2 = cb.substring(11, 22);
      let d2 = modulo10(b2);
      let b3 = cb.substring(22, 33);
      let d3 = modulo10(b3);
      let b4 = cb.substring(33, 44);
      let d4 = modulo10(b4);
      return `${b1}-${d1} ${b2}-${d2} ${b3}-${d3} ${b4}-${d4}`;
  }

  function buildMap(dados) {
    const now  = new Date();
    const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    let codStr = (dados.matricula || '000000').replace(/\D/g, '');
    if (codStr.length % 2 !== 0) codStr = '0' + codStr; // I2OF5 exige numeração par

    let enderecoLimpo = removerAcentos(dados.endereco || '') + ', ' + (dados.numero || '');
    let bairroLimpo = removerAcentos(dados.bairro || '');
    
    // Quebra de linha de endereco muito longo
    let end1 = enderecoLimpo;
    let endBairro = bairroLimpo;
    
    if (enderecoLimpo.length > 40) {
        let splitIdx = enderecoLimpo.lastIndexOf(' ', 40);
        if (splitIdx === -1 || splitIdx < 20) splitIdx = 40;
        end1 = enderecoLimpo.substring(0, splitIdx);
        let end2 = enderecoLimpo.substring(splitIdx).trim();
        endBairro = end2 + " - " + bairroLimpo;
    }

    const map = {
      '{NOME_COMPROMISSARIO}':  removerAcentos(dados.nome || ''),
      '{ENDERECO_LOGRADOURO}':  end1,
      '{ENDERECO_BAIRRO}':      endBairro.substring(0, 42),
      '{CEP}':                  dados.cep || ' ',
      '{ROTA}':                 dados.rota || '',
      '{SEQUENCIA}':            (dados.setor || ' ') + ' - ' + (dados.quadra || ' ') + ' - ' + (dados.lote || '  '),
      '{LIGACAO}':              dados.matricula || '',
      '{ROTEIRO}':              dados.roteiro || '',
      '{REFERENCIA}':           dados.referencia || dados.mes_ref || '',
      '{NR_GUIA}':              dados.num_fatura || dados.nosso_numero || dados.matricula || '',
      '{CATEGORIA}':            dados.categoria || '',
      
      // Lançamentos e Valores
      '{LANCAMENTO_DESC_1}':    (dados.valor_agua > 0 || !dados.valor_esgoto) ? (dados.desc_agua || 'AGUA') : '',
      '{LANCAMENTO_VAL_1}':     formatarValor(dados.valor_agua || dados.valor_total),
      '{LANCAMENTO_DESC_2}':    dados.valor_esgoto > 0 ? (dados.desc_esgoto || 'ESGOTO') : '',
      '{LANCAMENTO_VAL_2}':     dados.valor_esgoto > 0 ? formatarValor(dados.valor_esgoto) : '',
      '{LANCAMENTO_DESC_3}':    dados.valor_lixo > 0 ? (dados.desc_lixo || 'TAXA DE LIXO') : '',
      '{LANCAMENTO_VAL_3}':     dados.valor_lixo > 0 ? formatarValor(dados.valor_lixo) : '',

      // Leituras
      '{DATA_LEITURA_ANT}':     formatData(dados.data_leit_anterior || dados.leitura_anterior_data || ''),
      '{DATA_LEITURA_ATU}':     formatData(now),
      '{LEIT_ANT}':             String(dados.leitura_anterior || dados.leit_anterior || '0'),
      '{LEIT_ATUAL}':           String(dados.leitura_atual || dados.leit_atual || '0'),
      '{CONS_REAL}':            String(dados.consumo || '0'),
      '{CONS_FATURADO}':        String(dados.consumo || '0'),
      '{MEDIA}':                String(dados.consumo_medio || '0'),
      
      // Hidrômetro
      '{NR_HIDROMETRO}':        dados.hidrometro || dados.nr_hidrometro || ' ',
      '{VAZAO}':                dados.vazao || '1.0',
      '{DIAMETRO}':             dados.diametro || '1',
      '{DATA_INSTALACAO}':      formatData(dados.data_instalacao) || ' ',
      
      // Valores
      '{DATA_VENCIMENTO}':      formatData(dados.data_vencimento || dados.vencimento),
      '{VALOR_PAGAR}':          formatarValor(dados.valor_total),
      '{TOTAL_PAGAR}':          formatarValor(dados.valor_total),
      '{DIVIDA}':               'R$ ' + formatarValor(dados.valor_total),
      
      // Outros
      '{OCORRENCIA}':           (dados.ocorrencia_codigo || '') + (dados.ocorrencia_descricao ? ' - ' + removerAcentos(dados.ocorrencia_descricao) : ''),
      '{DATA_EMISSAO}':         now.toLocaleDateString('pt-BR'),
      '{HORA_EMISSAO}':         hora,

      // Mensagens dinâmicas do Backend
      '{MENSAGEM_1}':           removerAcentos((dados.mensagens_fatura && dados.mensagens_fatura[0]) || dados.mensagem_1 || '').substring(0, 48),
      '{MENSAGEM_2}':           removerAcentos((dados.mensagens_fatura && dados.mensagens_fatura[1]) || dados.mensagem_2 || '').substring(0, 48),

      // Fallbacks em branco pro histórico (1 a 6)
      ...Array.from({length: 6}).reduce((acc, _, i) => {
         acc[`{HIST_MES_${i+1}}`] = ' ';
         acc[`{HIST_CONS_${i+1}}`] = ' ';
         acc[`{HIST_DIAS_${i+1}}`] = ' ';
         acc[`{HIST_MEDIA_${i+1}}`] = ' ';
         return acc;
      }, {}),

      // Fallbacks para análise de água
      ...Array.from({length: 8}).reduce((acc, _, i) => {
         acc[`{ANALISE_PARAM_${i+1}}`] = ' ';
         acc[`{ANALISE_UNID_${i+1}}`] = ' ';
         acc[`{ANALISE_VMP_${i+1}}`]  = ' ';
         acc[`{ANALISE_VAL_${i+1}}`]  = ' ';
         return acc;
      }, {})
    };

    // Preenche histórico se tiver
    let histList = (dados.historico_consumo && dados.historico_consumo.length > 0) ? dados.historico_consumo : (dados.historico || []);
    histList.forEach((h, i) => {
      if(i < 6) {
        map[`{HIST_MES_${i+1}}`] = h.mes_ano || h.mes || ' ';
        map[`{HIST_CONS_${i+1}}`] = String(h.consumo || '0');
        map[`{HIST_DIAS_${i+1}}`] = String(h.dias || '30');
        map[`{HIST_MEDIA_${i+1}}`] = String(h.media || '0');
      }
    });

    // Preenche análises de água se tiver
    if (dados.analises_agua && dados.analises_agua.length > 0) {
      dados.analises_agua.forEach((a, i) => {
        if (i < 8) {
           map[`{ANALISE_PARAM_${i+1}}`] = removerAcentos(a.parametro || '').substring(0, 20);
           map[`{ANALISE_UNID_${i+1}}`] = (a.unidade || '').substring(0, 10);
           map[`{ANALISE_VMP_${i+1}}`]  = (a.vmp || '').substring(0, 15);
           map[`{ANALISE_VAL_${i+1}}`]  = (a.valor || '').substring(0, 10);
         }
      });
    }

    // Se houver contas em aberto, gerar mensagem automaticamente
    if (dados.faturas_abertas > 0 && (!map['{MENSAGEM_1}'] || map['{MENSAGEM_1}'].trim() === '')) {
      map['{MENSAGEM_1}'] = `Constam ${dados.faturas_abertas} Faturas em Aberto.`;
    }

    // --- LOGICA DE CODIGO DE BARRAS / LINHA DIGITAVEL ---
    let rawBarcode = (dados.codigo_barras || '').replace(/\D/g, '');
    
    if (rawBarcode.length === 44) {
        map['{CODIGO_BARRAS}'] = rawBarcode;
        // Se for 44 dígitos, formatar a linha digitável (Padrão Concessionária/FEBRABAN se começar com 8)
        if (rawBarcode[0] === '8') {
            map['{LINHA_DIGITAVEL}'] = formatarLinhaDigitavelConcessionaria(rawBarcode);
        } else {
            map['{LINHA_DIGITAVEL}'] = rawBarcode; 
        }
    } else {
        // Fallback: usar matrícula
        let codFallback = (dados.matricula || '0').replace(/\D/g, '');
        if (codFallback.length % 2 !== 0) codFallback = '0' + codFallback;
        map['{CODIGO_BARRAS}'] = codFallback;
        map['{LINHA_DIGITAVEL}'] = codFallback;
    }

    return map;
  }

  function formatarLinhaDigitavelConcessionaria(cb) {
      if (!cb || cb.length !== 44) return cb;
      const mod10 = (s) => {
        let soma = 0, peso = 2;
        for (let i = s.length - 1; i >= 0; i--) {
          let v = parseInt(s[i]) * peso;
          if (v > 9) v = Math.floor(v / 10) + (v % 10);
          soma += v;
          peso = peso === 2 ? 1 : 2;
        }
        const r = soma % 10;
        return r === 0 ? 0 : 10 - r;
      };

      const c1 = cb.substring(0, 11);
      const c2 = cb.substring(11, 22);
      const c3 = cb.substring(22, 33);
      const c4 = cb.substring(33, 44);

      return `${c1}-${mod10(c1)} ${c2}-${mod10(c2)} ${c3}-${mod10(c3)} ${c4}-${mod10(c4)}`;
  }

  function aplicarVariaveis(cpcl, map) {
    for (const [key, val] of Object.entries(map)) {
      cpcl = cpcl.split(key).join(String(val || ' '));
    }
    
    // Garante JOURNAL se não tiver (evita que a impressora puxe papel sem parar)
    if (!cpcl.includes('JOURNAL')) {
        cpcl = cpcl.replace(/(!\s.*\r?\n)/, '$1JOURNAL\r\n');
    }
    return removerAcentos(cpcl);
  }

  // ── Layout genérico (fallback sem customização) ────────
  function layoutGenerico(dados) {
    return [
      '! 0 200 200 250 1',
      'JOURNAL',
      'IN-MILLIMETERS',
      'COUNTRY LATIN9',
      'LINE 2 15 100 15 0.2',
      'LINE 2 15 2 174 0.2',
      'LINE 100 15 100 174 0.2',
      'LINE 2 174 100 174 0.2',
      'LINE 76 15 76 39 0.2',
      'LINE 76 22 100 22 0.2',
      'LINE 76 30 100 30 0.2',
      'LINE 76 34 100 34 0.2',
      'LINE 2 39 100 39 0.2',
      'LINE 2 44 100 44 0.2',
      'T 7 0 3 16 {NOME_COMPROMISSARIO}',
      'T 7 0 3 19 {ENDERECO_LOGRADOURO}',
      'T 7 0 3 22 CEP: {CEP}, Rota: {ROTA}',
      'T 7 0 3 25 BAIRRO: {ENDERECO_BAIRRO}',
      'T 7 0 3 28 Sequencia anterior: {SEQUENCIA}',
      'T 7 0 3 31 LIGACAO: {LIGACAO}',
      'T 7 0 3 34 ROTEIRO: {ROTEIRO}',
      'T 7 2 78 15 MES/ANO: {REFERENCIA}',
      'T 7 0 78 23 NR. GUIA ',
      'T 7 0 78 26 {NR_GUIA}',
      'T 7 0 78 31 CATEGORIA/QTDE ',
      'T 7 0 82 35 {CATEGORIA}',
      'T 7 0 30 40 DESCRICAO ',
      'T 7 0 89 40 VALOR ',
      'T 7 0 5 45 {LANCAMENTO_DESC_1}',
      'T 7 0 87 45  {LANCAMENTO_VAL_1}',
      'T 7 0 5 48 {LANCAMENTO_DESC_2}',
      'T 7 0 87 48  {LANCAMENTO_VAL_2}',
      'T 7 0 5 51 {LANCAMENTO_DESC_3}',
      'T 7 0 87 51  {LANCAMENTO_VAL_3}',
      'LINE 2 80 100 80 0.2',
      'LINE 28 80 28 89 0.2',
      'LINE 50 80 50 89 0.2',
      'LINE 78 80 78 89 0.2',
      'LINE 2 89 100 89 0.2',
      'T 7 0 4 80 DT. LEIT. ANT',
      'T 7 2 5 83 {DATA_LEITURA_ANT}',
      'T 7 0 30 80 DT. LEIT. ATUAL',
      'T 7 2 30 83 {DATA_LEITURA_ATU}',
      'T 7 0 60 80 VENCIMENTO',
      'T 7 2 56 83 {DATA_VENCIMENTO}',
      'T 7 0 80 80 VALOR A PAGAR',
      'T 7 2 82 83 R$ {VALOR_PAGAR}',
      'LINE 25 89 25 97 0.2',
      'LINE 44 89 44 97 0.2',
      'LINE 60 89 60 97 0.2',
      'LINE 78 89 78 97 0.2',
      'LINE 2 97 100 97 0.2',
      'LINE 2 105 100 105 0.2',
      'T 7 0 7 89 LEITURA ANT.',
      'T 7 0 28 89 LEIT. ATUAL',
      'T 7 0 45 89 CONS. REAL',
      'T 7 0 61 89 CONS. FATUR.',
      'T 7 0 86 89 MEDIA',
      'T 5 0 9 93 {LEIT_ANT}',
      'T 5 0 30 93 {LEIT_ATUAL}',
      'T 5 0 50 93 {CONS_REAL}',
      'T 5 0 66 93 {CONS_FATURADO}',
      'T 5 0 87 93 {MEDIA}',
      'LINE 44 97 44 105 0.2',
      'LINE 60 97 60 105 0.2',
      'LINE 78 97 78 105 0.2',
      'T 7 0 15 97 NR. HIDROMETRO',
      'T 7 0 50 97 VAZAO',
      'T 7 0 64 97 DIAMETRO',
      'T 7 0 80 97 DT. INSTALACAO',
      'T 5 0 15 101 {NR_HIDROMETRO}',
      'T 5 0 50 101 {VAZAO}',
      'T 5 0 66 101 {DIAMETRO}',
      'T 5 0 82 101 {DATA_INSTALACAO}',
      'LINE 2 110 100 110 0.2',
      'T 7 0 4 107 OCORRENCIA: {OCORRENCIA}',
      'LINE 44 110 44 144 0.2',
      'T 7 0 4 110 ULTIMOS 6 MESES',
      'LINE 2 114 44 114 0.2',
      'T 7 0 4 114 MES',
      'T 7 0 16 114 CONS.',
      'T 7 0 28 114 DIAS',
      'T 7 0 36 114 MEDIA',
      'T 7 0 4 118 {HIST_MES_1}',
      'T 7 0 18 118 {HIST_CONS_1}',
      'T 7 0 29 118 {HIST_DIAS_1}',
      'T 7 0 36 118 {HIST_MEDIA_1}',
      'T 7 0 4 121 {HIST_MES_2}',
      'T 7 0 18 121 {HIST_CONS_2}',
      'T 7 0 29 121 {HIST_DIAS_2}',
      'T 7 0 36 121 {HIST_MEDIA_2}',
      'T 7 0 4 124 {HIST_MES_3}',
      'T 7 0 18 124 {HIST_CONS_3}',
      'T 7 0 29 124 {HIST_DIAS_3}',
      'T 7 0 36 124 {HIST_MEDIA_3}',
      'T 7 0 4 127 {HIST_MES_4}',
      'T 7 0 18 127 {HIST_CONS_4}',
      'T 7 0 29 127 {HIST_DIAS_4}',
      'T 7 0 36 127 {HIST_MEDIA_4}',
      'T 7 0 4 130 {HIST_MES_5}',
      'T 7 0 18 130 {HIST_CONS_5}',
      'T 7 0 29 130 {HIST_DIAS_5}',
      'T 7 0 36 130 {HIST_MEDIA_5}',
      'T 7 0 4 133 {HIST_MES_6}',
      'T 7 0 18 133 {HIST_CONS_6}',
      'T 7 0 29 133 {HIST_DIAS_6}',
      'T 7 0 36 133 {HIST_MEDIA_6}',
      'T 7 0 45 110 MENSAGEM',
      'T 7 0 45 114 {MENSAGEM_1}',
      'T 7 0 45 117 {MENSAGEM_2}',
      'LINE 2 144 100 144 0.2',
      'T 7 0 10 144 DETALHES SOBRE',
      'T 7 0 8 147 LEGISLACAO VIDE VERSO',
      'LINE 35 144 35 151 0.2',
      'T 7 0 42 145 PERIODO DA ANALISE: 24/08/2021 a ',
      'LINE 2 151 100 151 0.2',
      'T 7 0 10 152 PARAMETRO',
      'T 7 0 28 152 UNIDADE',
      'T 7 0 47 152 VMP',
      'T 7 0 60 151 QTD ANALISES',
      'T 7 0 64 154 REALIZADAS',
      'T 7 0 85 151 V. MEDIO',
      'T 7 0 85 154 DETECTADO',
      'T 7 0 8 158 {ANALISE_PARAM_1}',
      'T 7 0 28 158 {ANALISE_UNID_1}',
      'T 7 0 40 158 {ANALISE_VMP_1}',
      'T 7 0 65 158 1 ',
      'T 7 0 85 158 {ANALISE_VAL_1}',
      'T 7 0 8 161 {ANALISE_PARAM_2}',
      'T 7 0 28 161 {ANALISE_UNID_2}',
      'T 7 0 40 161 {ANALISE_VMP_2}',
      'T 7 0 65 161 1 ',
      'T 7 0 85 161 {ANALISE_VAL_2}',
      'T 7 0 8 164 {ANALISE_PARAM_3}',
      'T 7 0 28 164 {ANALISE_UNID_3}',
      'T 7 0 40 164 {ANALISE_VMP_3}',
      'T 7 0 65 164 1 ',
      'T 7 0 85 164 {ANALISE_VAL_3}',
      'T 7 0 8 167 {ANALISE_PARAM_4}',
      'T 7 0 28 167 {ANALISE_UNID_4}',
      'T 7 0 40 167 {ANALISE_VMP_4}',
      'T 7 0 65 167 1 ',
      'T 7 0 85 167 {ANALISE_VAL_4}',
      'T 7 0 8 170 {ANALISE_PARAM_5}',
      'T 7 0 28 170 {ANALISE_UNID_5}',
      'T 7 0 40 170 {ANALISE_VMP_5}',
      'T 7 0 65 170 1 ',
      'T 7 0 85 170 {ANALISE_VAL_5}',
      'T 7 0 6 173 {ANALISE_PARAM_6}',
      'T 7 0 28 173 {ANALISE_UNID_6}',
      'T 7 0 40 173 {ANALISE_VMP_6}',
      'T 7 0 65 173 1 ',
      'T 7 0 85 173 {ANALISE_VAL_6}',
      'T 7 0 6 176 {ANALISE_PARAM_7}',
      'T 7 0 28 176 {ANALISE_UNID_7}',
      'T 7 0 40 176 {ANALISE_VMP_7}',
      'T 7 0 65 176 1 ',
      'T 7 0 85 176 {ANALISE_VAL_7}',
      'LINE 2 190 100 190 0.2',
      'T 7 0 3 191 FAVOR AUTENTICAR NO VERSO',
      'T 5 0 68 191 EMISSAO: {DATA_EMISSAO}',
      'T 5 0 68 194 HORA: {HORA_EMISSAO}',
      'LINE 2 196 100 196 0.2',
      'LINE 2 196 2 226 0.2',
      'LINE 100 196 100 226 0.2',
      'LINE 2 213 100 213 0.2',
      'T 7 0 3 197 {NOME_COMPROMISSARIO}',
      'T 7 0 3 200 {ENDERECO_LOGRADOURO}',
      'T 7 0 3 203 CEP: {CEP}, Rota: {ROTA}',
      'T 7 0 3 206 END. ENT: {ENDERECO_BAIRRO}',
      'T 7 0 3 209 Seq. ant: {SEQUENCIA}',
      'T 7 2 78 197 MES/ANO: {REFERENCIA}',
      'LINE 76 200 100 200 0.2',
      'T 7 0 78 201 NR. GUIA ',
      'T 7 0 78 204 {NR_GUIA}',
      'LINE 76 207 100 207 0.2',
      'T 7 0 78 208 CATEGORIA ',
      'T 7 0 82 211 {CATEGORIA}',
      'T 7 0 12 214 LIGACAO ',
      'T 7 0 12 217 {LIGACAO}',
      'LINE 35 213 35 226 0.2',
      'T 7 0 47 214 VENCIMENTO ',
      'T 7 0 47 217 {DATA_VENCIMENTO}',
      'T 7 0 80 214 VALOR PAGO ',
      'T 7 0 82 217 R$ {VALOR_PAGAR}',
      'LINE 76 196 76 226 0.2',
      'LINE 2 226 100 226 0.2',
      'LEFT',
      'T 0 0 10 227 {LINHA_DIGITAVEL}',
      'B I2OF5 0.245 25 8 10 235 {CODIGO_BARRAS}',
      'FORM',
      'PRINT'
    ].join('\r\n');
  }

  // ── Gerar CPCL da fatura ───────────────────────────────
  function gerarCPCL(dados) {
    const raw = customLayout || layoutGenerico(dados);
    return aplicarVariaveis(raw, buildMap(dados));
  }

  // ── Gerar CPCL da notificacao ─────────────────────────
  function gerarCPCLNotificacao(dados) {
    if (!customLayoutNotif) return null;
    return aplicarVariaveis(customLayoutNotif, buildMap(dados));
  }

  // ── Imprimir conta + notificacao ──────────────────────
  async function imprimirConta(dados) {
    // Pagina 1: Fatura
    await sendData(gerarCPCL(dados));

    // Pagina 2: Notificacao (somente se houver layout e flag)
    const cpclNotif = gerarCPCLNotificacao(dados);
    if (cpclNotif && dados.tem_notificacao) {
      await new Promise(r => setTimeout(r, 1200));
      await sendData(cpclNotif);
    }
    return true;
  }

  return {
    connect,
    isConnected,
    sendData,
    imprimirConta,
    fetchLayout,
    gerarCPCL,
    gerarCPCLNotificacao,
  };

})();
