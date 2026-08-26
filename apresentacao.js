/* APRESENTAÇÃO — as fotos do empreendimento, para mostrar e vender.
 *
 * Toda a equipe vê (o corretor usa no plantão); só direção/escritório sobem e
 * apagam. Cada foto é um registro 'foto' (legenda, ordem) com o arquivo no
 * Storage via acervo — o mesmo cano provado dos contratos.
 *
 * As imagens baixam UMA vez por sessão e ficam num cache em memória
 * (arquivoId → objectURL): trocar de tela e voltar não rebaixa tudo. */

const _fotosCache = new Map();

async function urlDaFoto(arquivoId) {
  if (_fotosCache.has(arquivoId)) return _fotosCache.get(arquivoId);
  const { blob } = await baixarArquivo(arquivoId);
  const url = URL.createObjectURL(blob);
  _fotosCache.set(arquivoId, url);
  return url;
}

TELAS.apresentacao = function () {
  const app = document.getElementById('app');
  const fotos = lista('foto').sort((a, b) => (a.ordem || 0) - (b.ordem || 0) ||
    String(a.criadoEm || '').localeCompare(b.criadoEm || ''));
  const podeMexer = !ehCorretorPerfil();

  app.innerHTML =
    '<div class="cartao" style="background:var(--verde-escuro);border-color:var(--verde-escuro);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px">' +
      '<img src="icons/logo-full.png" alt="Portal dos Bosques" style="height:58px;max-width:60%;object-fit:contain">' +
      (podeMexer ? '<button class="btn mini" id="ap-subir" style="background:var(--verde-claro);border-color:var(--verde-claro);color:#123018">📷 Adicionar fotos</button>' : '') +
    '</div>' +
    (fotos.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">' +
        fotos.map((f) =>
          '<figure class="cartao" style="margin:0;padding:8px" data-foto="' + esc(f.id) + '">' +
          '<div class="ap-img" data-arq="' + esc(f.arquivoId) + '" style="aspect-ratio:4/3;background:var(--verde-palido);border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--tinta-fraca);font-size:12px;overflow:hidden;cursor:pointer">carregando…</div>' +
          '<figcaption style="font-size:12.5px;margin-top:6px;display:flex;gap:6px;align-items:center">' +
            '<span class="cresce" style="flex:1">' + esc(f.legenda || '') + '</span>' +
            (podeMexer ? '<button class="btn mini ap-legenda" data-id="' + esc(f.id) + '">✏️</button>' +
              '<button class="btn mini perigo ap-apagar" data-id="' + esc(f.id) + '">🗑</button>' : '') +
          '</figcaption></figure>').join('') + '</div>'
      : vazio('🏞️', 'Nenhuma foto ainda', podeMexer ? 'Suba as fotos do local — a equipe toda vê.' : 'A direção ainda não subiu as fotos.'));

  // carrega as imagens (uma a uma; erro numa não derruba as outras)
  app.querySelectorAll('.ap-img').forEach(async (el) => {
    try {
      const url = await urlDaFoto(el.dataset.arq);
      el.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover" alt="">';
    } catch (e) { el.textContent = 'não carregou'; }
  });
  // clicar = ver grande
  app.querySelectorAll('.ap-img').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        const url = await urlDaFoto(el.dataset.arq);
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,25,15,.92);z-index:400;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:18px';
        ov.innerHTML = '<img src="' + url + '" style="max-width:96vw;max-height:92vh;border-radius:10px">';
        ov.onclick = () => ov.remove();
        document.body.appendChild(ov);
      } catch (e) { /* já avisado no quadro */ }
    });
  });

  const bS = document.getElementById('ap-subir');
  if (bS) bS.onclick = abrirUploadFotos;
  app.querySelectorAll('.ap-legenda').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const f = achar('foto', b.dataset.id);
      const nova = await perguntar('Legenda da foto', { valor: f ? f.legenda : '' });
      if (nova != null) { salvar('foto', { id: b.dataset.id, legenda: nova.slice(0, 160) }); TELAS.apresentacao(); }
    };
  });
  app.querySelectorAll('.ap-apagar').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (await confirmar('Tirar esta foto da apresentação? (vai para a lixeira)', { perigo: true, ok: 'Tirar' })) {
        try {
          await api('apagar', { colecao: 'foto', id: b.dataset.id });
          const arr = S.reg.foto || [];
          const i = arr.findIndex((x) => x.id === b.dataset.id);
          if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
          gravarCache();
          TELAS.apresentacao();
        } catch (err) { toast(err.message || 'Não consegui agora', 'ruim'); }
      }
    };
  });
};

function abrirUploadFotos() {
  const corpo =
    '<div class="campo"><label>Fotos do local (pode escolher várias)</label>' +
    '<input type="file" id="ap-arqs" accept="image/*" multiple></div>' +
    '<p class="nota">Dica: fotos de celular já servem. Cada uma sobe inteira — em conexão lenta, poucas por vez.</p>' +
    '<div class="nota" id="ap-prog"></div>';
  abrirModal({
    titulo: 'Adicionar fotos',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Enviar', classe: 'primario', aoClicar: async (fundo) => {
        const inp = fundo.querySelector('#ap-arqs');
        const arquivos = [...(inp.files || [])];
        if (!arquivos.length) { toast('Escolha as fotos', 'ruim'); return; }
        const prog = fundo.querySelector('#ap-prog');
        const btn = fundo.querySelector('footer .primario');
        btn.disabled = true;
        let ordem = Math.max(0, ...lista('foto').map((f) => Number(f.ordem) || 0));
        let subiu = 0;
        for (const f of arquivos) {
          try {
            prog.textContent = 'enviando ' + f.name + ' (' + (subiu + 1) + '/' + arquivos.length + ')…';
            const meta = await enviarArquivo(f, (p2) => { prog.textContent = f.name + ' — ' + Math.round(p2 * 100) + '%'; });
            salvar('foto', { arquivoId: meta.id, nome: f.name, legenda: '', ordem: ++ordem });
            subiu++;
          } catch (e) {
            toast(f.name + ': ' + (e.message || 'falhou'), 'ruim');
          }
        }
        fecharSilencioso(fundo);
        toast(subiu + ' foto(s) na apresentação');
        TELAS.apresentacao();
      } },
    ],
  });
}
