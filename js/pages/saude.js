/**
 * saude.js (página) — o aluno vê a declaração vigente, baixa o PDF das que
 * já assinou e renova o questionário quando vence (a cada 6 meses).
 * `?voltar=pagina.html` devolve o aluno de onde veio depois de assinar.
 */

import { exigirAuth, sair } from '../auth.js';
import {
  declaracoesDoAluno, declaracaoVigente, baixarPdfDeclaracao, diasParaVencer,
} from '../saude.js';
import { montarFormularioSaude, resumoDeclaracaoEl } from '../saude-form.js';
import { t } from '../i18n.js';
import {
  qs, el, montarShellPainel, toast, paramUrl, formatarData, vazio, iconeEl,
} from '../ui.js';

let usuario = null;

/** Só páginas internas do aluno podem ser destino do ?voltar=. */
function destinoVoltar() {
  const v = paramUrl('voltar');
  return v && /^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(v) ? v : null;
}

async function baixar(decl) {
  try {
    await baixarPdfDeclaracao(decl);
  } catch (err) {
    toast(err.message || 'Não foi possível gerar o PDF.', 'erro', 6000);
  }
}

async function carregar() {
  const declaracoes = await declaracoesDoAluno(usuario.id);
  const vigente = declaracoes.find((d) => declaracaoVigente(d)) || null;

  // Formulário: só quando não há declaração vigente, ou perto de vencer.
  const area = qs('#area-formulario');
  area.innerHTML = '';
  const dias = diasParaVencer(vigente);
  if (vigente && dias > 15) {
    area.append(resumoDeclaracaoEl(vigente, { aoBaixar: () => baixar(vigente) }));
    area.append(el('p', { class: 'texto-peq texto-cinza mt-16', text: t('saude.renovarDepois') }));
  } else {
    if (vigente) area.append(el('div', { class: 'alerta alerta-info mb-16' }, [iconeEl('saude'), el('span', { text: t('dash.saudeVencendo', { dias }) })]));
    montarFormularioSaude(area, {
      usuario,
      aoAssinar: async () => {
        toast(t('saude.assinadaOk'), 'sucesso');
        const voltar = destinoVoltar();
        if (voltar) { location.href = voltar; return; }
        await carregar();
      },
    });
  }

  const lista = qs('#lista-declaracoes');
  lista.innerHTML = '';
  if (!declaracoes.length) {
    lista.append(vazio(t('saude.nenhuma'), 'saude'));
    return;
  }
  for (const d of declaracoes) {
    const ativa = declaracaoVigente(d);
    lista.append(el('div', { class: 'linha-declaracao' }, [
      el('div', { class: 'cresce' }, [
        el('div', { class: 'negrito', text: `${t('saude.assinadaEm')} ${formatarData(d.assinadoEm.slice(0, 10))}` }),
        el('div', { class: 'texto-min texto-cinza', text: `${t('saude.validaAteCurto')} ${formatarData(String(d.validaAte).slice(0, 10))}` }),
      ]),
      el('span', { class: `badge ${ativa ? 'badge-sucesso' : 'badge-neutro'}`, text: ativa ? t('saude.vigente') : t('saude.vencida') }),
      el('button', { type: 'button', class: 'btn btn-claro btn-peq com-icone', onclick: () => baixar(d) }, [iconeEl('download'), 'PDF']),
    ]));
  }
}

async function iniciar() {
  usuario = await exigirAuth(['aluno']);
  montarShellPainel({ usuario, paginaAtual: 'saude', aoSair: () => sair() });
  try {
    await carregar();
  } catch (err) {
    console.error('[saude] falha ao carregar:', err);
    toast(t('comum.erroCarregar'), 'erro');
  }
}

iniciar();
