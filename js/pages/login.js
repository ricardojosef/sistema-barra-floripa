/**
 * login.js — controlador da tela de login e cadastro.
 *
 * Alterna entre os perfis aluno/professor (professor não tem cadastro
 * público), valida os formulários e redireciona para o painel certo.
 */

import { CONFIG, ESCOLA, SENHA_DEMO } from '../config.js';
import { inicializarStore, listar } from '../store.js';
import { entrar, cadastrar, entrarComGoogle, carregarUsuario, painelDoPapel, ErroAuth } from '../auth.js';
import {
  qs, qsa, el, escapar, paramUrl, toast, abrirModal, botaoCarregando,
  montarTopoPublico, mascaraTelefone,
} from '../ui.js';

let perfilSelecionado = 'aluno';

/* --------------------------------------------------------------------------
   Mensagens e validação
   -------------------------------------------------------------------------- */

function mostrarAlerta(mensagem, tipo = 'perigo') {
  const area = qs('#alerta-area');
  area.innerHTML = '';
  if (!mensagem) return;
  area.append(el('div', { class: `alerta alerta-${tipo}`, role: 'alert' }, [
    el('span', { text: tipo === 'perigo' ? '⚠️' : 'ℹ️' }),
    el('span', { text: mensagem }),
  ]));
}

function marcarErro(inputId, temErro, mensagem = null) {
  const campo = qs(`#${inputId}`)?.closest('.campo');
  if (!campo) return;
  campo.classList.toggle('erro', temErro);
  if (mensagem) {
    const msg = qs('.msg-erro', campo);
    if (msg) msg.textContent = mensagem;
  }
}

const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());

/* --------------------------------------------------------------------------
   Navegação entre abas e perfis
   -------------------------------------------------------------------------- */

function trocarAba(nome) {
  qsa('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
  qsa('.painel-aba').forEach((p) => p.classList.toggle('ativo', p.dataset.painel === nome));
  mostrarAlerta(null);
}

function selecionarPerfil(perfil) {
  perfilSelecionado = perfil;
  qsa('.cartao-perfil').forEach((c) => c.classList.toggle('ativo', c.dataset.perfil === perfil));

  const ehProfessor = perfil === 'professor';

  // Professor não cria conta sozinho: só a escola cadastra.
  qs('#abas-auth').classList.toggle('oculto', ehProfessor);
  qs('#area-google-login').classList.toggle('oculto', ehProfessor);
  if (ehProfessor) trocarAba('login');

  mostrarAlerta(
    ehProfessor
      ? 'Área restrita à equipe. Use o e-mail institucional fornecido pela escola.'
      : null,
    'info',
  );

  atualizarContasDemo();
}

/* --------------------------------------------------------------------------
   Contas de demonstração (apenas no modo local)
   -------------------------------------------------------------------------- */

async function atualizarContasDemo() {
  const bloco = qs('#contas-demo');
  const lista = qs('#lista-contas-demo');

  // No modo Firebase as contas são reais; não faz sentido listar senhas.
  if (CONFIG.MODO_DADOS !== 'local') {
    bloco.classList.add('oculto');
    return;
  }

  try {
    const usuarios = await listar('usuarios');
    const equipe = usuarios.filter((u) => u.papel === 'professor' || u.papel === 'admin');
    const alunos = usuarios.filter((u) => u.papel === 'aluno').slice(0, 2);
    const mostrar = perfilSelecionado === 'professor' ? equipe : alunos;

    lista.innerHTML = '';
    for (const u of mostrar) {
      const papel = u.papel === 'admin' ? 'Admin' : u.papel === 'professor' ? 'Professor' : 'Aluno';
      lista.append(el('button', {
        type: 'button',
        class: 'conta-demo-btn',
        onclick: () => {
          qs('#login-email').value = u.email;
          qs('#login-senha').value = SENHA_DEMO;
          qs('#login-email').focus();
          mostrarAlerta(null);
        },
      }, [
        el('span', { text: u.email }),
        el('span', { class: 'papel', text: papel }),
      ]));
    }
    bloco.classList.toggle('oculto', mostrar.length === 0);
  } catch (err) {
    console.error('[login] falha ao listar contas demo:', err);
    bloco.classList.add('oculto');
  }
}

/* --------------------------------------------------------------------------
   Redirecionamento pós-login
   -------------------------------------------------------------------------- */

/**
 * Só aceita destinos internos: um `redirect` vindo da URL não pode levar
 * o usuário para fora do site depois de autenticar.
 */
function destinoSeguro(usuario) {
  const solicitado = paramUrl('redirect');
  const padrao = painelDoPapel(usuario.papel);
  if (!solicitado) return padrao;

  const limpo = solicitado.replace(/^\/+/, '');
  const ehInterno = /^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(limpo);
  if (!ehInterno) return padrao;

  // Não devolve o aluno para uma página que ele não pode acessar.
  const paginasPorPapel = {
    aluno: ['dashboard.html', 'agendar.html', 'checkout.html', 'creditos.html', 'historico.html'],
    professor: ['professor.html'],
    admin: ['professor.html', 'admin.html'],
  };
  const arquivo = limpo.split('?')[0].toLowerCase();
  return paginasPorPapel[usuario.papel]?.includes(arquivo) ? limpo : padrao;
}

function entrarEredirecionar(usuario) {
  toast(`Bem-vindo de volta, ${usuario.nome.split(' ')[0]}!`, 'sucesso', 1500);
  setTimeout(() => { location.href = destinoSeguro(usuario); }, 450);
}

/* --------------------------------------------------------------------------
   Formulários
   -------------------------------------------------------------------------- */

async function aoEnviarLogin(ev) {
  ev.preventDefault();
  mostrarAlerta(null);

  const email = qs('#login-email').value.trim();
  const senha = qs('#login-senha').value;

  marcarErro('login-email', !emailValido(email));
  marcarErro('login-senha', !senha);
  if (!emailValido(email) || !senha) return;

  const btn = qs('#btn-entrar');
  const restaurar = botaoCarregando(btn, 'Entrando...');

  try {
    const usuario = await entrar(email, senha);

    // Coerência entre o perfil escolhido e o papel real da conta.
    if (perfilSelecionado === 'professor' && usuario.papel === 'aluno') {
      mostrarAlerta('Esta conta é de aluno. Use o card "Sou Aluno" para entrar.');
      restaurar();
      return;
    }

    entrarEredirecionar(usuario);
  } catch (err) {
    restaurar();
    mostrarAlerta(err instanceof ErroAuth ? err.message : 'Não foi possível entrar. Tente novamente.');
    console.error('[login] erro ao entrar:', err);
  }
}

async function aoEnviarCadastro(ev) {
  ev.preventDefault();
  mostrarAlerta(null);

  const nome = qs('#cad-nome').value.trim();
  const email = qs('#cad-email').value.trim();
  const telefone = qs('#cad-telefone').value.trim();
  const senha = qs('#cad-senha').value;
  const senha2 = qs('#cad-senha2').value;
  const termos = qs('#cad-termos').checked;

  const erros = {
    'cad-nome': nome.length < 3,
    'cad-email': !emailValido(email),
    'cad-senha': senha.length < 6,
    'cad-senha2': senha !== senha2 || !senha2,
  };
  Object.entries(erros).forEach(([id, temErro]) => marcarErro(id, temErro));

  if (Object.values(erros).some(Boolean)) return;
  if (!termos) {
    mostrarAlerta('É preciso aceitar os termos de uso para criar a conta.');
    return;
  }

  const btn = qs('#btn-cadastrar');
  const restaurar = botaoCarregando(btn, 'Criando conta...');

  try {
    const usuario = await cadastrar({ nome, email, telefone, senha });
    toast('Conta criada! Bem-vindo à Barra Floripa 🏄', 'sucesso', 1800);
    setTimeout(() => { location.href = painelDoPapel(usuario.papel); }, 600);
  } catch (err) {
    restaurar();
    mostrarAlerta(err instanceof ErroAuth ? err.message : 'Não foi possível criar a conta.');
    console.error('[login] erro ao cadastrar:', err);
  }
}

/* --------------------------------------------------------------------------
   Login com Google
   -------------------------------------------------------------------------- */

async function aoClicarGoogle() {
  mostrarAlerta(null);

  // Modo Firebase: abre o pop-up real do Google.
  if (CONFIG.MODO_DADOS === 'firebase') {
    try {
      const usuario = await entrarComGoogle();
      entrarEredirecionar(usuario);
    } catch (err) {
      mostrarAlerta(err instanceof ErroAuth ? err.message : 'Não foi possível entrar com o Google.');
      console.error('[login] erro no Google:', err);
    }
    return;
  }

  // Modo demo: não existe OAuth, então simulamos a escolha da conta.
  const corpo = el('div');
  corpo.innerHTML = `
    <div class="alerta alerta-info">
      <span>ℹ️</span>
      <span>
        <strong>Modo demonstração.</strong> O login real do Google exige o
        Firebase configurado. Aqui simulamos a conta que o Google devolveria.
      </span>
    </div>
    <div class="campo">
      <label for="g-nome">Nome da conta Google</label>
      <input type="text" id="g-nome" placeholder="Maria Silva" value="Visitante Google">
    </div>
    <div class="campo">
      <label for="g-email">E-mail da conta Google</label>
      <input type="email" id="g-email" placeholder="voce@gmail.com" value="visitante@gmail.com">
    </div>`;

  const { promessa, fechar, caixa } = abrirModal({
    titulo: 'Entrar com Google',
    corpo,
    botoes: [
      { texto: 'Cancelar', classe: 'btn-claro', valor: null },
      {
        texto: 'Continuar',
        classe: 'btn-primario',
        autoFechar: false,
        onClick: async () => {
          const nome = qs('#g-nome', caixa).value.trim();
          const email = qs('#g-email', caixa).value.trim();
          if (!emailValido(email)) {
            toast('Informe um e-mail válido.', 'erro');
            return;
          }
          fechar({ nome, email });
        },
      },
    ],
  });

  const dados = await promessa;
  if (!dados) return;

  try {
    const usuario = await entrarComGoogle(dados);
    entrarEredirecionar(usuario);
  } catch (err) {
    mostrarAlerta(err instanceof ErroAuth ? err.message : 'Não foi possível entrar com o Google.');
    console.error('[login] erro no Google simulado:', err);
  }
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

async function iniciar() {
  montarTopoPublico(null);
  qs('#link-whatsapp').href = `https://wa.me/${ESCOLA.whatsapp}`;

  await inicializarStore();

  // Quem já está logado não precisa ver esta tela.
  const jaLogado = await carregarUsuario();
  if (jaLogado) {
    location.replace(painelDoPapel(jaLogado.papel));
    return;
  }

  // Abas
  qsa('.aba').forEach((btn) => btn.addEventListener('click', () => trocarAba(btn.dataset.aba)));

  // Perfis
  qsa('.cartao-perfil').forEach((card) => {
    card.addEventListener('click', () => selecionarPerfil(card.dataset.perfil));
  });

  // Formulários
  qs('#form-login').addEventListener('submit', aoEnviarLogin);
  qs('#form-cadastro').addEventListener('submit', aoEnviarCadastro);
  qs('#btn-google-login').addEventListener('click', aoClicarGoogle);
  qs('#btn-google-cadastro').addEventListener('click', aoClicarGoogle);

  // Limpa o estado de erro assim que o usuário corrige o campo
  qsa('input').forEach((input) => {
    input.addEventListener('input', () => input.closest('.campo')?.classList.remove('erro'));
  });

  qs('#cad-telefone').addEventListener('input', (ev) => {
    ev.target.value = mascaraTelefone(ev.target.value);
  });

  // Estado inicial vindo da URL (?aba=cadastro, ?perfil=professor)
  const perfilUrl = paramUrl('perfil');
  selecionarPerfil(perfilUrl === 'professor' ? 'professor' : 'aluno');

  if (paramUrl('aba') === 'cadastro' && perfilSelecionado === 'aluno') trocarAba('cadastro');
  if (paramUrl('redirect')) {
    mostrarAlerta('Entre na sua conta para continuar.', 'info');
  }

  await atualizarContasDemo();
}

iniciar();
