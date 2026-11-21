/**
 * justificativa-ui.js — modal em que o aluno justifica uma falta ou um
 * cancelamento fora do prazo, com texto e atestado opcional.
 */

import { enviarJustificativa, ErroJustificativa } from './justificativas.js';
import { t } from './i18n.js';
import { qs, el, escapar, abrirModal, toast, botaoCarregando, formatarDataExtenso } from './ui.js';

export function abrirJustificativa(usuario, aula, { aoEnviar } = {}) {
  const corpo = el('div');
  corpo.innerHTML = `
    <p class="texto-peq mb-16">${escapar(t('just.explicacao', { quando: `${formatarDataExtenso(aula.data)} ${aula.horario}` }))}</p>
    <div class="campo">
      <label for="just-texto">${escapar(t('just.motivo'))}</label>
      <textarea id="just-texto" rows="4" maxlength="2000" placeholder="${escapar(t('just.motivoDica'))}"></textarea>
    </div>
    <div class="campo">
      <label for="just-anexo">${escapar(t('just.anexo'))} <span class="dica">${escapar(t('just.anexoDica'))}</span></label>
      <input type="file" id="just-anexo" accept="image/*,application/pdf">
    </div>
    <p class="texto-min texto-cinza">${escapar(t('just.analise'))}</p>`;

  const { caixa, fechar } = abrirModal({
    titulo: t('just.titulo'),
    corpo,
    botoes: [
      { texto: t('comum.cancelar'), classe: 'btn-claro' },
      {
        texto: t('just.enviar'),
        classe: 'btn-primario',
        autoFechar: false,
        onClick: async () => {
          const btn = caixa.querySelector('.modal-rodape .btn-primario');
          const restaurar = botaoCarregando(btn, t('comum.enviando'));
          try {
            await enviarJustificativa(usuario, aula, {
              texto: qs('#just-texto', caixa).value,
              arquivo: qs('#just-anexo', caixa).files[0] || null,
            });
            fechar();
            toast(t('just.enviada'), 'sucesso', 5000);
            await aoEnviar?.();
          } catch (err) {
            restaurar();
            toast(err instanceof ErroJustificativa ? err.message : t('comum.erroSalvar'), 'erro', 6000);
            if (!(err instanceof ErroJustificativa)) console.error('[justificativa] erro ao enviar:', err);
          }
        },
      },
    ],
  });
}
