/* APP — a casca: login, menu, roteador, painel inicial e configurações.
   As telas de negócio moram nos módulos (espelho.js, vendas.js, caixa.js,
   cadastros.js) e se registram em TELAS. */

/* ── Rotas ─────────────────────────────────────────────────────────────────── */
const ROTAS = {
  home:       { titulo: 'Início',        ic: '🏠' },
  espelho:    { titulo: 'Espelho',       ic: '🗺️' },
  lote:       { titulo: 'Lote',          ic: '🗺️', oculta: true },
  vendas:     { titulo: 'Vendas',        ic: '📋' },
  simulador:  { titulo: 'Simulador',     ic: '🏷️' },
  contratos:  { titulo: 'Contratos',     ic: '📜' },
  venda:      { titulo: 'Venda',         ic: '📋', oculta: true },
  propostas:  { titulo: 'Propostas',     ic: '📨' },
  caixa:      { titulo: 'Caixa',         ic: '💰' },
  lancamentos: { titulo: 'Lançamentos',  ic: '🧾' },
  simulacao:  { titulo: 'Simulação',     ic: '🧮', oculta: true }, // vive dentro de Vendas
  relatorios: { titulo: 'Relatórios',   ic: '📊' },
  cronograma: { titulo: 'Cronograma',   ic: '🏗️' },
  apresentacao: { titulo: 'Apresentação', ic: '🏞️' },
  comissoes:  { titulo: 'Comissões',     ic: '🤝', oculta: true }, // vive dentro de Corretores
  clientes:   { titulo: 'Clientes',      ic: '👥' },
  corretores: { titulo: 'Corretores',    ic: '🧑‍💼' },
  config:     { titulo: 'Configurações', ic: '⚙️' },
};

// O menu é um espelho do servidor: esconder botão não protege nada, só evita
// oferecer o que a pessoa não pode abrir.
function rotasDoPerfil() {
  if (S.perfil === 'corretor') return ['espelho', 'simulador', 'propostas', 'apresentacao'];
  if (S.perfil === 'escritorio') return ['home', 'espelho', 'simulador', 'vendas', 'contratos', 'propostas', 'caixa', 'lancamentos', 'relatorios', 'cronograma', 'clientes', 'corretores', 'apresentacao'];
  return ['home', 'espelho', 'simulador', 'vendas', 'contratos', 'propostas', 'caixa', 'lancamentos', 'relatorios', 'cronograma', 'clientes', 'corretores', 'apresentacao', 'config'];
}

function rotaAtual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [nome, id] = h.split('/');
  return { nome: nome || (S.perfil === 'corretor' ? 'espelho' : 'home'), id: id || '' };
}

/* ── Render ────────────────────────────────────────────────────────────────── */
function renderLateral() {
  const el = document.getElementById('lateral');
  const { nome } = rotaAtual();
  const atrasos = (S.perfil !== 'corretor')
    ? lista('venda').filter((v) => ['ativa', 'conferir'].includes(v.situacao || 'ativa') &&
        resumoVenda(v).qtdAtraso > 0).length
    : 0;
  el.innerHTML =
    '<div class="marca"><img src="icons/icon-192.png" alt=""><b>Portal dos Bosques<span>gestão do loteamento</span></b></div>' +
    '<nav id="menu">' +
      rotasDoPerfil().map((r) =>
        '<a href="#/' + r + '" class="' + (nome === r || (r === 'vendas' && nome === 'venda') || (r === 'espelho' && nome === 'lote') ? 'on' : '') + '">' +
        '<span class="ic">' + ROTAS[r].ic + '</span>' + ROTAS[r].titulo +
        (r === 'vendas' && atrasos ? '<span class="selo">' + atrasos + '</span>' : '') + '</a>').join('') +
    '</nav>' +
    '<div id="rodape-lateral">' + esc(S.quem || 'Equipe') + ' · ' + esc(({ direcao: 'Direção', escritorio: 'Escritório', corretor: 'Corretor' })[S.perfil] || S.perfil) +
      '<div class="acoes"><button id="bt-sync">↻ Sincronizar</button><button id="bt-sair">Sair</button></div></div>';
  const bs = el.querySelector('#bt-sync');
  if (bs) bs.onclick = () => { puxar(); toast('Sincronizando…'); };
  const bx = el.querySelector('#bt-sair');
  if (bx) bx.onclick = async () => {
    if (await confirmar('Sair e limpar este aparelho?')) {
      localStorage.clear();
      location.reload();
    }
  };
}

function renderTopo() {
  const { nome } = rotaAtual();
  document.getElementById('topo').innerHTML =
    '<h1>' + (ROTAS[nome] ? ROTAS[nome].titulo : 'Portal dos Bosques') + '</h1>' +
    '<span id="sync-badge"></span>';
  atualizarBadge();
}

function atualizarBadge() {
  const el = document.getElementById('sync-badge');
  if (!el) return;
  if (S.erroSync) { el.className = 'erro'; el.textContent = '⚠ ' + S.erroSync; return; }
  el.className = '';
  el.textContent = S.sincronizando ? 'sincronizando…'
    : S.fila.length ? S.fila.length + ' a enviar'
    : !S.online ? 'offline — salvando no aparelho'
    : S.ultimoPull ? '✓ em dia' : '';
}

let _renderPendente = false;
function render() {
  if (!S.senhaHash) { renderLogin(); return; }
  _renderPendente = false;
  // Confirma para o store que a tela consumiu o retrato novo — sem isso o
  // sync de 90s redesenharia a página toda vez, jogando a rolagem pro topo.
  if (S.assinaturaPendente) { S.assinatura = S.assinaturaPendente; S.assinaturaPendente = null; }
  const { nome, id } = rotaAtual();
  renderLateral();
  renderTopo();
  const rotas = rotasDoPerfil().concat(['lote', 'venda', 'comissoes', 'simulacao']);
  const tela = rotas.includes(nome) && TELAS[nome] ? TELAS[nome] : null;
  if (tela) tela(id);
  else location.hash = '#/' + rotasDoPerfil()[0];
}

/* ── Login ─────────────────────────────────────────────────────────────────── */
function renderLogin() {
  document.body.innerHTML =
    '<div class="tela-login"><div class="caixa-login">' +
      '<img src="icons/icon-192.png" alt="">' +
      '<h1>Portal dos Bosques</h1>' +
      '<div class="sub">gestão do loteamento</div>' +
      '<input type="text" id="lg-nome" placeholder="Seu nome" autocomplete="name" value="' + esc(S.quem || '') + '">' +
      '<input type="password" id="lg-senha" placeholder="Senha" autocomplete="current-password">' +
      '<div class="erro" id="lg-erro"></div>' +
      '<button class="btn primario" id="lg-entrar">Entrar</button>' +
    '</div></div>';
  const entrar = async () => {
    const nome = document.getElementById('lg-nome').value.trim();
    const senha = document.getElementById('lg-senha').value;
    const erro = document.getElementById('lg-erro');
    if (!senha) { erro.textContent = 'Digite a senha.'; return; }
    const btn = document.getElementById('lg-entrar');
    btn.disabled = true; btn.textContent = 'entrando…';
    try {
      S.senhaHash = await sha256(senha);
      S.quem = nome;
      const r = await api('entrar');
      if (!r.ok) throw new Error(r.error || 'Senha incorreta');
      S.perfil = r.perfil || 'direcao';
      S.usuarioId = r.proprio ? r.usuarioId : '';
      S.acessoProprio = !!r.proprio;
      if (r.proprio && r.nome) S.quem = r.nome;
      if (!S.quem) S.quem = 'Equipe';
      localStorage.setItem(K.senha, S.senhaHash);
      localStorage.setItem(K.quem, S.quem);
      localStorage.setItem(K.perfil, S.perfil);
      localStorage.setItem(K.usuario, S.usuarioId);
      location.reload(); // recomeça limpo com a casca inteira
    } catch (e) {
      S.senhaHash = '';
      erro.textContent = e.message || 'Não deu para entrar agora.';
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
  document.getElementById('lg-entrar').onclick = entrar;
  document.getElementById('lg-senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
}

/* ── Tela: início (o retrato do dia) ───────────────────────────────────────── */
TELAS.home = function () {
  const app = document.getElementById('app');
  const mes = mesDe(hojeISO());
  const t = totaisDoMes(mes);
  const vivas = vendasVivas();
  const comAtraso = vivas
    .map((v) => ({ v, r: resumoVenda(v) }))
    .filter((x) => x.r.qtdAtraso > 0)
    .sort((a, b) => b.r.emAtraso - a.r.emAtraso);
  const totalAtraso = comAtraso.reduce((s, x) => s + x.r.emAtraso, 0);
  const ultimosRecs = lista('rec').sort((a, b) => String(b.data || '').localeCompare(a.data || '')).slice(0, 6);
  const propsQuentes = lista('prop').filter((p) => (p.situacao || 'enviada') === 'enviada' &&
    (p.eventos || []).some((e) => e.tipo === 'interesse'));

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel clicavel" data-vai="caixa"><div class="rot">Entradas · ' + nomeMes(mes) + '</div>' +
        '<div class="num pos">' + fmt.brl(t.entradas) + '</div></div>' +
      '<div class="painel clicavel" data-vai="caixa"><div class="rot">Saídas · ' + nomeMes(mes) + '</div><div class="num">' + fmt.brl(t.saidas) + '</div></div>' +
      '<div class="painel clicavel" data-vai="caixa"><div class="rot">Resultado do mês</div>' +
        '<div class="num ' + (t.resultado >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(t.resultado) + '</div></div>' +
      '<div class="painel clicavel" data-vai="vendas"><div class="rot">Em atraso</div>' +
        '<div class="num' + (comAtraso.length ? ' neg' : ' pos') + '">' + fmt.brl(totalAtraso) + '</div>' +
        '<div class="sub">' + comAtraso.length + ' contrato(s)</div></div>' +
    '</div>' +
    (propsQuentes.length ? '<div class="cartao"><h2>🔥 Interesse nas propostas</h2>' +
      propsQuentes.slice(0, 5).map((p) => '<div class="lin prop-lin" data-id="' + esc(p.id) + '">' +
        '<div class="cresce"><b>' + esc((p.cliente && p.cliente.nome) || '?') + ' · Q' + p.quadra + '-L' + p.lote + '</b>' +
        '<span class="sub">clicou "tenho interesse" · proposta de ' + esc(p.donoNome || '—') + '</span></div>' +
        '<span class="etiqueta et-hoje">responder</span></div>').join('') + '</div>' : '') +
    '<div class="cartao"><h2>Cobranças em atraso <span class="nota">— as maiores primeiro</span></h2>' +
      (comAtraso.slice(0, 8).map(({ v, r }) =>
        '<div class="lin venda-lin" data-id="' + esc(v.id) + '">' +
        '<div class="cresce"><b>Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '?') + '</b>' +
        '<span class="sub">' + r.qtdAtraso + ' parcela(s) vencida(s)</span></div>' +
        botaoCobranca(v, r, true) +
        '<span class="dinheiro" style="color:var(--ruim)">' + fmt.brl(r.emAtraso) + '</span></div>').join('') ||
        '<p class="nota">🎉 Ninguém em atraso.</p>') + '</div>' +
    '<div class="cartao"><h2>Últimos recebimentos</h2>' +
      (ultimosRecs.map((rc) => {
        const v = achar('venda', rc.vendaId);
        return '<div class="lin venda-lin" data-id="' + esc(rc.vendaId) + '">' +
          '<div class="cresce"><b>' + fmt.brl(rc.valor) + '</b>' +
          '<span class="sub">' + fmt.data(rc.data) + ' · ' + (v ? 'Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '') : '—') + '</span></div></div>';
      }).join('') || '<p class="nota">Nenhum dinheiro lançado ainda.</p>') + '</div>' +
    // O pulso da ponte com o Omie: quando sincronizou e se deu certo.
    (S.perfil !== 'corretor'
      ? '<p class="nota" id="home-omie" style="margin:6px 2px">consultando a sincronização do Omie…</p>'
      : '');

  if (S.perfil !== 'corretor') statusOmieHome(document.getElementById('home-omie'));
  ligarBotoesCobranca(app);
  app.querySelectorAll('[data-vai]').forEach((el) => { el.onclick = () => { location.hash = '#/' + el.dataset.vai; }; });
  app.querySelectorAll('.venda-lin').forEach((el) => { el.onclick = () => { location.hash = '#/venda/' + el.dataset.id; }; });
  app.querySelectorAll('.prop-lin').forEach((el) => { el.onclick = () => abrirFichaProposta(el.dataset.id); });
};

/* ── Tela: configurações (direção) ─────────────────────────────────────────── */
TELAS.config = function () {
  const app = document.getElementById('app');
  const cfg = S.cfg || {};
  const emp = cfg.empresa || {};
  const reaj = cfg.reajuste || { pct: 6, aCada: 12 };
  const usuarios = cfg.usuarios || [];

  app.innerHTML =
    '<div class="cartao"><h2>Empresa</h2><div class="colunas">' +
      campo('Nome', entrada('empresa.nome', emp.nome || '')) +
      campo('Nome curto', entrada('empresa.nomeCurto', emp.nomeCurto || '')) +
    '</div><div class="colunas-3">' +
      campo('CNPJ', entrada('empresa.cnpj', emp.cnpj || '')) +
      campo('WhatsApp da casa', entrada('empresa.telefone', emp.telefone || ''), 'fallback do botão da proposta') +
      campo('Cidade', entrada('empresa.cidade', emp.cidade || 'Montes Claros')) +
    '</div>' +
    campo('Dados para pagamento (saem na proposta)', areaTexto('empresa.contaBancaria', emp.contaBancaria || '',
      'ex.: PIX (CNPJ): 00.000.000/0001-00 · Banco Sicoob ag 0000 c/c 00000-0 · Associação Campestre Portal dos Bosques')) +
    '<h2 style="margin-top:8px">Regras de venda</h2><div class="colunas-3">' +
      campo('Reajuste (%)', entrada('reajuste.pct', reaj.pct, { inputmode: 'decimal' }), 'da parcela "Reajustada"') +
      campo('a cada quantas parcelas', entrada('reajuste.aCada', reaj.aCada, { inputmode: 'numeric' })) +
      campo('Validade da proposta (dias)', entrada('validadeProposta', cfg.validadeProposta || 7, { inputmode: 'numeric' })) +
    '</div><div class="colunas-3">' +
      campo('Entrada padrão (R$)', entrada('entradaPadrao', cfg.entradaPadrao || 3000, { inputmode: 'decimal' }), 'o simulador já abre com ela') +
    '</div>' +
    campo('Centros de custo (um por linha)', areaTexto('centrosCustoTxt', (cfg.centrosCusto || []).join('\n'),
      'ex.:\nPortaria\nRede de água\nRede de energia\nRuas\nAdministração\nComercial')) +
    '<button class="btn primario" id="cf-salvar">Salvar configurações</button></div>' +

    '<div class="cartao"><h2>Acessos da equipe <span class="nota">— um por pessoa; o histórico diz quem fez</span></h2>' +
      (usuarios.map((u) =>
        '<div class="lin us-lin" data-id="' + esc(u.id) + '"' + (u.ativo === false ? ' style="opacity:.55"' : '') + '>' +
        '<div class="cresce"><b>' + esc(u.nome) + '</b><span class="sub">' +
        esc(({ direcao: 'Direção', escritorio: 'Escritório', corretor: 'Corretor' })[u.perfil] || u.perfil) +
        (u.ultimoAcesso ? ' · entrou ' + fmt.quando(u.ultimoAcesso) : ' · nunca entrou') +
        (u.ativo === false ? ' · DESATIVADO' : '') + '</span></div></div>').join('') || '<p class="nota">Só a senha da equipe por enquanto.</p>') +
      '<div class="acoes-linha"><button class="btn primario" id="cf-novo-acesso">+ Acesso</button>' +
      '<button class="btn" id="cf-senha-equipe">Trocar a senha da equipe</button></div></div>' +

    '<div class="cartao"><h2>Omie (ERP) <span class="nota">— boletos, pagamentos e cadastros entram sozinhos</span></h2>' +
    '<div class="colunas-3">' +
      campo('Recebimentos valem a partir de', entrada('omieCorte', (cfg.omie && cfg.omie.corteEntradas) || '', { tipo: 'date' }),
        'antes disso, o que vale é a planilha — recuar duplica se o mês já foi digitado') +
    '</div><div class="acoes-linha">' +
      '<button class="btn primario" id="cf-omie-sync">↻ Sincronizar agora</button>' +
    '</div><div class="nota" id="cf-omie-saude" style="margin-top:8px">conferindo a última sincronização…</div></div>' +

    '<div class="cartao"><h2>Manutenção</h2><div class="acoes-linha">' +
      '<button class="btn" id="cf-backup">⬇ Baixar backup</button>' +
      '<button class="btn" id="cf-log">📜 Últimas ações</button>' +
      '<button class="btn perigo" id="cf-lixeira">Esvaziar a lixeira</button>' +
    '</div><div class="nota" id="cf-saude" style="margin-top:8px">conferindo o backup automático…</div></div>';

  // O backup que ninguém confere é fé, não backup: a tela pergunta ao
  // servidor qual foi o ÚLTIMO DIA GRAVADO na tabela — e grita se atrasou.
  (async () => {
    const el = document.getElementById('cf-saude');
    try {
      const r = await api('saude');
      const ult = (r.backups && r.backups[0]) || null;
      if (!ult) { el.innerHTML = '⚠ <b>Nenhum backup na tabela ainda.</b>'; el.style.color = 'var(--ruim)'; return; }
      const hoje = hojeISO();
      const ontem = CARNE.venc(hoje, 0) && new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const atrasado = ult.dia < ontem;
      el.innerHTML = (atrasado
        ? '🔴 <b>Backup atrasado!</b> O último é de ' + fmt.data(ult.dia) + ' — a rotina das 03:10 não está entregando. Avise quem cuida do sistema.'
        : '🟢 Backup automático em dia: último em <b>' + fmt.data(ult.dia) + '</b>' +
          (r.rotina && r.rotina.registros ? ' com <b>' + r.rotina.registros + ' registros</b>' : '') +
          ' · roda sozinho todo dia às 03:10 e guarda 60 dias.');
      if (atrasado) el.style.color = 'var(--ruim)';
    } catch (e) {
      el.textContent = '⚠ Não consegui conferir o backup agora: ' + (e.message || 'sem resposta');
    }
  })();

  document.getElementById('cf-salvar').onclick = async () => {
    const v = lerCampos(app);
    try {
      const r = await api('salvarCfg', { cfg: {
        empresa: { ...emp, ...v.empresa },
        reajuste: { pct: numeroBR(v.reajuste.pct), aCada: Math.max(1, Math.round(numeroBR(v.reajuste.aCada))) },
        validadeProposta: Math.max(1, Math.round(numeroBR(v.validadeProposta))),
        entradaPadrao: Math.max(0, numeroBR(v.entradaPadrao)) || 3000,
        omie: { ...(cfg.omie || {}), corteEntradas: v.omieCorte || (cfg.omie && cfg.omie.corteEntradas) || '' },
        centrosCusto: String(v.centrosCustoTxt || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 40),
      } });
      S.cfg = { ...S.cfg, ...r.cfg };
      gravarCache();
      toast('Configurações salvas');
    } catch (e) { toast(e.message || 'Não salvou', 'ruim'); }
  };
  // A saúde da ponte com o Omie: quando rodou, o que trouxe, o que ficou
  // de fora por parecer repetido (esses saem daqui para a mão, nunca sozinhos).
  (async () => {
    const el = document.getElementById('cf-omie-saude');
    try {
      const r = await apiOmie('saude');
      if (!r.sync || !r.sync.quando) { el.innerHTML = 'Nunca sincronizou — o primeiro ↻ confere tudo.'; return; }
      const horas = (Date.now() - new Date(r.sync.quando).getTime()) / 3600e3;
      const pend = r.sync.pendencias || [];
      el.innerHTML = (horas < 26 ? '🟢' : '🔴') + ' Última sincronização ' + fmt.quando(r.sync.quando) +
        (r.sync.por && r.sync.por !== '—' ? ' por ' + esc(r.sync.por) : '') + ' — ' + resumoOmie(r.sync.contagens) + '.' +
        (pend.length ? '<br>⚠ <b>' + pend.length + ' despesa(s) do Omie ficaram de fora por parecerem repetidas</b> ' +
          '(mesmo valor no mesmo mês da planilha). As que forem reais, lance à mão no Caixa:<br>' +
          pend.slice(0, 12).map((p) => '· ' + fmt.data(p.data) + ' — ' + fmt.brl(p.valor) + ' (' + esc(p.categoria || '') + ')').join('<br>') +
          (pend.length > 12 ? '<br>… e mais ' + (pend.length - 12) : '') : '');
    } catch (e) { el.textContent = '⚠ Não consegui falar com o Omie agora: ' + (e.message || 'sem resposta'); }
  })();
  document.getElementById('cf-omie-sync').onclick = async () => {
    const b = document.getElementById('cf-omie-sync');
    b.disabled = true; b.textContent = 'sincronizando…';
    try {
      const r = await sincronizarOmie(true);
      toast('Omie: ' + resumoOmie(r && r.contagens));
      TELAS.config();
    } catch (e) {
      toast(e.message || 'Não sincronizou', 'ruim');
      b.disabled = false; b.textContent = '↻ Sincronizar agora';
    }
  };
  document.getElementById('cf-novo-acesso').onclick = () => abrirAcesso(null);
  app.querySelectorAll('.us-lin').forEach((el) => { el.onclick = () => abrirAcesso(el.dataset.id); });
  document.getElementById('cf-senha-equipe').onclick = async () => {
    const nova = await perguntar('Nova senha da equipe (mín. 6 caracteres)', { titulo: 'Senha da equipe', obrigatorio: true });
    if (!nova) return;
    if (nova.length < 6) { toast('Curta demais', 'ruim'); return; }
    try {
      await api('trocarSenha', { novaHash: await sha256(nova) });
      toast('Senha da equipe trocada — avise quem usa');
    } catch (e) { toast(e.message || 'Não trocou', 'ruim'); }
  };
  document.getElementById('cf-backup').onclick = async () => {
    try {
      const r = await api('backup');
      baixarTexto('backup-bosques-' + hojeISO() + '.json', JSON.stringify(r, null, 1));
    } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
  };
  document.getElementById('cf-log').onclick = async () => {
    try {
      const r = await api('log', { limite: 100 });
      abrirModal({
        titulo: 'Últimas ações',
        corpo: (r.linhas || []).map((l) =>
          '<div class="nota" style="padding:3px 0">' + fmt.dataHora(l.em) + ' — <b>' + esc(l.por || '') + '</b> ' +
          esc(l.acao || '') + (l.detalhe ? ' · ' + esc(l.detalhe) : '') + (l.codigo ? ' · ' + esc(l.codigo) : '') +
          (l.valor ? ' · ' + fmt.brl(l.valor) : '') + '</div>').join('') || '<p class="nota">Vazio.</p>',
        largo: true,
        acoes: [{ texto: 'Fechar', aoClicar: () => fecharModal() }],
      });
    } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
  };
  document.getElementById('cf-lixeira').onclick = async () => {
    if (await confirmar('Apagar DE VEZ tudo que está na lixeira, junto com os arquivos que só esses registros usavam?', { perigo: true, ok: 'Esvaziar' })) {
      try {
        const r = await api('esvaziarLixeira');
        toast('Lixeira esvaziada: ' + r.apagados + ' registro(s), ' + r.arquivos + ' arquivo(s)');
      } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
    }
  };
};

function abrirAcesso(id) {
  const u = id ? ((S.cfg && S.cfg.usuarios) || []).find((x) => x.id === id) : null;
  const corretores = lista('corretor').filter((c) => c.ativo !== false);
  const corpo =
    '<div class="colunas">' +
      campo('Nome', entrada('nome', u ? u.nome : '')) +
      campo('Cargo', entrada('cargo', u ? u.cargo : '')) +
    '</div><div class="colunas">' +
      campo('Perfil', seletor('perfil', u ? u.perfil : 'escritorio',
        [{ v: 'direcao', t: 'Direção — tudo' }, { v: 'escritorio', t: 'Escritório — opera o dia a dia' }, { v: 'corretor', t: 'Corretor — espelho e propostas' }])) +
      campo('Senha ' + (u ? '(deixe vazio p/ manter)' : ''), entrada('senha', '', { tipo: 'password' })) +
    '</div>' +
    campo('É um corretor do cadastro?', seletor('corretorId', u ? u.corretorId : '',
      corretores.map((c) => ({ v: c.id, t: c.nome })), 'não'), 'liga o acesso às comissões dele') +
    (u ? '<div class="campo"><label><input type="checkbox" data-campo="ativo" ' + (u.ativo !== false ? 'checked' : '') + ' style="width:auto;margin-right:6px">acesso ativo</label></div>' : '');
  abrirModal({
    titulo: u ? 'Acesso de ' + u.nome : 'Novo acesso',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      ...(u ? [{ texto: 'Remover', classe: 'perigo', aoClicar: async (fundo) => {
        if (await confirmar('Remover o acesso de ' + u.nome + '? A pessoa para de entrar na hora.', { perigo: true, ok: 'Remover' })) {
          try {
            const r = await api('apagarUsuario', { id: u.id });
            S.cfg = { ...S.cfg, ...r.cfg }; gravarCache();
            fecharSilencioso(fundo); TELAS.config();
          } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
        }
      } }] : []),
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const v = lerCampos(fundo);
        if (!v.nome || !v.nome.trim()) { toast('Diga o nome', 'ruim'); return; }
        if (!u && (!v.senha || v.senha.length < 6)) { toast('Senha de pelo menos 6 caracteres', 'ruim'); return; }
        if (v.senha && v.senha.length < 6) { toast('Senha curta demais', 'ruim'); return; }
        try {
          const r = await api('salvarUsuario', { usuario: {
            id: u ? u.id : undefined, nome: v.nome.trim(), cargo: v.cargo, perfil: v.perfil,
            corretorId: v.corretorId || '',
            ativo: u ? !!v.ativo : true,
            ...(v.senha ? { novaHash: await sha256(v.senha) } : {}),
          } });
          if (!r.ok) throw new Error(r.error || 'Não salvou');
          S.cfg = { ...S.cfg, ...r.cfg }; gravarCache();
          fecharSilencioso(fundo);
          toast('Acesso salvo');
          TELAS.config();
        } catch (e) { toast(e.message || 'Não salvou', 'ruim'); }
      } },
    ],
  });
}

/* ── Eventos e partida ─────────────────────────────────────────────────────── */
document.addEventListener('pdb:status', atualizarBadge);
document.addEventListener('pdb:dados', () => {
  // Redesenhar com modal aberto apagaria o que está sendo digitado.
  if (typeof _modalAberto !== 'undefined' && _modalAberto) { _renderPendente = true; return; }
  render();
});
document.addEventListener('ui:modais-fechados', () => { if (_renderPendente) render(); });
document.addEventListener('pdb:semsenha', () => {
  localStorage.removeItem(K.senha);
  S.senhaHash = '';
  toast('Sua sessão expirou — entre de novo', 'ruim');
  setTimeout(() => location.reload(), 900);
});
document.addEventListener('pdb:sempermissao', (e) => {
  const d = e.detail || {};
  toast('Não salvou: ' + (d.msg || 'seu acesso não permite'), 'ruim');
});
window.addEventListener('hashchange', render);

(function iniciar() {
  lerCache();
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
  render();
  if (S.senhaHash) { puxar(); talvezSincronizarOmie(); }
})();
