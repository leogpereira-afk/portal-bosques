// config.js — endereços do backend e o token leve anti-robô.
//
// O TOKEN não é segredo de verdade (o repositório é público): ele só barra
// robô e curioso casual. O que abre a porta é a SENHA, conferida no servidor
// (x-senha). Mesmo desenho da Domo Construtora.
//
// Backend: projeto Supabase "Projetos Léo" (compartilhado com Domo e Diamond,
// namespace pdb_*). Os segredos das functions são PDB_TOKEN / PDB_PAINEL_SENHA
// / PDB_ROTINA_TOKEN — os nomes crus (TOKEN, PAINEL_SENHA…) são DA DOMO.
window.TOKEN = 'pdb-5be7a5a3546bfeb33e966e219a7d154e';
window.API_BASE = 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1';
window.API = window.API_BASE + '/pdb-nucleo';
window.API_ARQ = window.API_BASE + '/pdb-acervo';
window.API_OMIE = window.API_BASE + '/pdb-omie';
window.P_URL = window.API_BASE + '/pdb-p'; // landing pública da proposta

window.VERSAO = '1'; // suba a cada publicação, junto com o CACHE do sw.js
