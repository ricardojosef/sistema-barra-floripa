/**
 * perfil.js — "Meu perfil": foto e telefone do usuário logado.
 *
 * Nome e e-mail aparecem, mas travados. A foto é recortada em quadrado e
 * reduzida no navegador (canvas) antes de salvar, para caber no próprio
 * documento do usuário sem precisar de um serviço de arquivos.
 */

import { ESCOLA } from '../config.js';
import { exigirAuth, sair, atualizarMeuPerfil, ErroAuth } from '../auth.js';
import { saldoCreditos } from '../creditos.js';
import {
  qs, montarShellPainel, toast, botaoCarregando, mascaraTelefone, avatarHTML,
} from '../ui.js';

const LADO_FOTO = 320;          // px — o maior avatar do sistema tem 112px
const QUALIDADE_JPEG = 0.82;

let usuario = null;
let fotoPendente;               // undefined = sem mudança; null = remover; string = nova
let alterado = false;

function montarShell() {
  montarShellPainel({
    usuario,
    paginaAtual: 'perfil',
    aoSair: () => sair(),
    chipCreditos: usuario.papel === 'aluno',
  });
  if (usuario.papel === 'aluno') {
    saldoCreditos(usuario.id)
      .then((saldo) => { qs('#chip-creditos-valor').textContent = String(saldo); })
      .catch(() => { /* o chip só fica com "—" */ });
  }
}

function desenharAvatar() {
  const fotoAtual = fotoPendente === undefined ? usuario.fotoUrl : fotoPendente;
  qs('#perfil-avatar').innerHTML = avatarHTML({ nome: usuario.nome, fotoUrl: fotoAtual }, 'avatar-xg');
  qs('#btn-remover-foto').classList.toggle('oculto', !fotoAtual);
}

function marcarAlterado(sim = true) {
  alterado = sim;
  qs('#status-perfil').textContent = sim ? 'Alterações ainda não salvas.' : '';
  qs('#status-perfil').classList.toggle('texto-laranja', sim);
}

/** Lê o arquivo, recorta o centro em quadrado e devolve um JPEG reduzido. */
function reduzirFoto(arquivo) {
  return new Promise((resolver, rejeitar) => {
    if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) {
      rejeitar(new Error('Use uma imagem JPG, PNG ou WebP.'));
      return;
    }
    if (arquivo.size > 15 * 1024 * 1024) {
      rejeitar(new Error('A imagem passa de 15 MB. Escolha uma menor.'));
      return;
    }
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - lado) / 2;
      const sy = (img.naturalHeight - lado) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = LADO_FOTO;
      canvas.height = LADO_FOTO;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // PNG com transparência não fica preto
      ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
      ctx.drawImage(img, sx, sy, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
      URL.revokeObjectURL(url);
      resolver(canvas.toDataURL('image/jpeg', QUALIDADE_JPEG));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rejeitar(new Error('Não foi possível ler esta imagem.'));
    };
    img.src = url;
  });
}

async function escolherFoto(ev) {
  const arquivo = ev.target.files?.[0];
  ev.target.value = '';
  if (!arquivo) return;
  try {
    fotoPendente = await reduzirFoto(arquivo);
    desenharAvatar();
    marcarAlterado();
  } catch (err) {
    toast(err.message, 'erro', 5000);
  }
}

async function salvar(ev) {
  ev.preventDefault();
  const campoTel = qs('#perfil-telefone');
  const digitos = campoTel.value.replace(/\D/g, '');
  const telefoneInvalido = digitos.length > 0 && (digitos.length < 10 || digitos.length > 11);
  campoTel.closest('.campo').classList.toggle('erro', telefoneInvalido);
  if (telefoneInvalido) { campoTel.focus(); return; }

  const btn = qs('#btn-salvar-perfil');
  const restaurar = botaoCarregando(btn, 'Salvando...');
  try {
    usuario = await atualizarMeuPerfil({ telefone: campoTel.value, fotoUrl: fotoPendente });
    fotoPendente = undefined;
    marcarAlterado(false);
    montarShell();          // atualiza a foto no topo
    desenharAvatar();
    toast('Perfil atualizado.', 'sucesso');
  } catch (err) {
    toast(err instanceof ErroAuth ? err.message : 'Não foi possível salvar. Tente de novo.', 'erro', 6000);
    if (!(err instanceof ErroAuth)) console.error('[perfil] erro ao salvar:', err);
  } finally {
    restaurar();
  }
}

async function iniciar() {
  usuario = await exigirAuth(['aluno', 'professor', 'admin']);
  montarShell();

  const papelTexto = { aluno: 'Aluno', professor: 'Professor', admin: 'Administrador' }[usuario.papel];
  qs('#perfil-nome-topo').textContent = usuario.nome;
  qs('#perfil-papel').textContent = papelTexto;
  qs('#perfil-nome').value = usuario.nome || '';
  qs('#perfil-email').value = usuario.email || '';
  qs('#perfil-telefone').value = mascaraTelefone(usuario.telefone || '');
  qs('#link-escola').href = `https://wa.me/${ESCOLA.whatsapp}?text=${encodeURIComponent(
    `Olá! Preciso corrigir o nome ou e-mail da minha conta (${usuario.email}).`,
  )}`;
  qs('#link-escola').target = '_blank';
  qs('#link-escola').rel = 'noopener';
  desenharAvatar();

  qs('#btn-trocar-foto').addEventListener('click', () => qs('#input-foto').click());
  qs('#input-foto').addEventListener('change', escolherFoto);
  qs('#btn-remover-foto').addEventListener('click', () => {
    fotoPendente = null;
    desenharAvatar();
    marcarAlterado();
  });
  qs('#perfil-telefone').addEventListener('input', (ev) => {
    ev.target.value = mascaraTelefone(ev.target.value);
    ev.target.closest('.campo').classList.remove('erro');
    marcarAlterado();
  });
  qs('#form-perfil').addEventListener('submit', salvar);

  window.addEventListener('beforeunload', (ev) => {
    if (alterado) { ev.preventDefault(); ev.returnValue = ''; }
  });
}

iniciar();
