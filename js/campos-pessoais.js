/**
 * campos-pessoais.js — nacionalidade, CPF/passaporte, nascimento e idioma
 * preferido. Usado no cadastro do fluxo de reserva e em "Meu perfil" (para
 * quem entrou com o Google e precisa completar o cadastro).
 */

import { PAISES, IDIOMAS_AULA, mascaraCpf } from './documentos.js';
import { t, idiomaAtual } from './i18n.js';
import { qs, qsa, escapar } from './ui.js';

export function camposPessoaisHTML(valores = {}) {
  const idioma = valores.idioma || idiomaAtual();
  const pais = valores.nacionalidade || (idioma === 'pt' ? 'BR' : '');
  return `
    <div class="linha-campos duas">
      <div class="campo">
        <label for="f-nacionalidade">${escapar(t('dados.nacionalidade'))}</label>
        <select id="f-nacionalidade">
          <option value="">${escapar(t('dados.selecione'))}</option>
          ${PAISES.map((p) => `<option value="${p.id}" ${p.id === pais ? 'selected' : ''}>${escapar(p[idiomaAtual()] || p.pt)}</option>`).join('')}
        </select>
        <span class="msg-erro">${escapar(t('dados.erroNacionalidade'))}</span>
      </div>
      <div class="campo ${pais === 'OUTRO' ? '' : 'oculto'}" id="campo-pais-outro">
        <label for="f-pais-outro">${escapar(t('dados.qualPais'))}</label>
        <input type="text" id="f-pais-outro" maxlength="40" value="${escapar(valores.nacionalidadeOutra || '')}">
      </div>
      <div class="campo ${pais === 'BR' ? '' : 'oculto'}" id="campo-cpf">
        <label for="f-cpf">CPF <span class="dica">${escapar(t('dados.cpfDica'))}</span></label>
        <input type="text" id="f-cpf" inputmode="numeric" placeholder="000.000.000-00" value="${escapar(valores.cpf || '')}">
        <span class="msg-erro">${escapar(t('dados.erroCpf'))}</span>
      </div>
      <div class="campo ${pais && pais !== 'BR' ? '' : 'oculto'}" id="campo-documento">
        <label for="f-documento">${escapar(t('dados.passaporte'))} <span class="dica">${escapar(t('dados.passaporteDica'))}</span></label>
        <input type="text" id="f-documento" maxlength="20" value="${escapar(valores.documento || '')}">
        <span class="msg-erro">${escapar(t('dados.erroDocumento'))}</span>
      </div>
    </div>
    <div class="linha-campos duas">
      <div class="campo">
        <label for="f-nascimento">${escapar(t('dados.nascimento'))}</label>
        <input type="date" id="f-nascimento" value="${escapar(valores.nascimento || '')}">
        <span class="msg-erro">${escapar(t('dados.erroNascimento'))}</span>
      </div>
      <div class="campo">
        <label>${escapar(t('dados.idioma'))}</label>
        <div class="segmento segmento-idioma" role="radiogroup">
          ${IDIOMAS_AULA.map((i) => `<label class="segmento-opcao ${i.id === idioma ? 'ativo' : ''}">
            <input type="radio" name="f-idioma" value="${i.id}" ${i.id === idioma ? 'checked' : ''} class="so-leitor">
            <span>${i.bandeira} ${escapar(i.nome)}</span></label>`).join('')}
        </div>
        <span class="dica">${escapar(t('dados.idiomaDica'))}</span>
      </div>
    </div>`;
}

/** Liga máscara de CPF, troca CPF/passaporte e o idioma do site. */
export function ligarCamposPessoais(form, aoTrocarIdiomaForm) {
  const select = qs('#f-nacionalidade', form);
  select.addEventListener('change', () => {
    const pais = select.value;
    qs('#campo-cpf', form).classList.toggle('oculto', pais !== 'BR');
    qs('#campo-documento', form).classList.toggle('oculto', !pais || pais === 'BR');
    qs('#campo-pais-outro', form).classList.toggle('oculto', pais !== 'OUTRO');
  });
  qs('#f-cpf', form).addEventListener('input', (ev) => { ev.target.value = mascaraCpf(ev.target.value); });
  qsa('input[name=f-idioma]', form).forEach((r) => r.addEventListener('change', () => {
    // A preferência de aula também define o idioma do site.
    aoTrocarIdiomaForm(r.value);
  }));
}

export function lerCamposPessoais(form) {
  return {
    nacionalidade: qs('#f-nacionalidade', form).value,
    nacionalidadeOutra: qs('#f-pais-outro', form).value,
    cpf: qs('#f-cpf', form).value,
    documento: qs('#f-documento', form).value,
    nascimento: qs('#f-nascimento', form).value,
    idioma: qs('input[name=f-idioma]:checked', form)?.value || idiomaAtual(),
  };
}

