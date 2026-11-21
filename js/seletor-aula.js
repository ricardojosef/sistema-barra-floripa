/**
 * seletor-aula.js — calendário do mês + horários do dia escolhido.
 *
 * Usado no fluxo público de reserva (antes do login) e na tela "Agendar
 * aula" do aluno. Mostra horário, praia e vagas — nunca o professor, que é
 * atribuído internamente pela escola.
 */

import { resumoDoPeriodo, horariosDoDia } from './agenda.js';
import { nomeLocal } from './precos.js';
import { t, idiomaAtual } from './i18n.js';
import {
  el, isoDeData, hojeISO, faixaHorario, iconeEl, vazio, dataDeISO,
} from './ui.js';

const MESES = {
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};
const SEMANA = {
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};

/** 'sábado, 14 de novembro de 2026' no idioma atual. */
export function dataPorExtenso(iso) {
  const locale = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[idiomaAtual()] || 'pt-BR';
  const texto = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(dataDeISO(iso));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * opcoes:
 *   grade, rotuloMes, btnAnterior, btnProximo, lista, rotuloDia, resumoDia (elementos)
 *   contexto      { config, mapaLocais }
 *   tipo()        'grupo' | 'individual'
 *   soFimDeSemana() true quando o crédito/plano só vale sábado e domingo
 *   aoSelecionar(slot|null)
 */
export function criarSeletorAula(opcoes) {
  const {
    grade, rotuloMes, btnAnterior, btnProximo, lista, rotuloDia, resumoDia, contexto,
    tipo = () => 'grupo', soFimDeSemana = () => false, aoSelecionar = () => {},
  } = opcoes;

  let mesVisivel = new Date();
  mesVisivel.setDate(1);
  let diaSelecionado = null;
  let slotSelecionado = null;
  let resumos = new Map();

  const meses = () => MESES[idiomaAtual()] || MESES.pt;
  const semana = () => SEMANA[idiomaAtual()] || SEMANA.pt;

  async function montarCalendario() {
    const ano = mesVisivel.getFullYear();
    const mes = mesVisivel.getMonth();
    const nomeMes = meses()[mes];
    rotuloMes.textContent = `${nomeMes.charAt(0).toUpperCase()}${nomeMes.slice(1)} ${ano}`;

    const hoje = new Date();
    btnAnterior.disabled = ano === hoje.getFullYear() && mes === hoje.getMonth();

    const cabecalho = () => semana().forEach((d) => grade.append(el('div', { class: 'cab-dia', text: d })));
    grade.innerHTML = '';
    cabecalho();
    grade.append(el('div', { class: 'vazio', style: 'grid-column:1/-1', html: '<span class="spinner escuro"></span>' }));

    const primeiro = new Date(ano, mes, 1);
    const ultimo = new Date(ano, mes + 1, 0);
    try {
      resumos = await resumoDoPeriodo(isoDeData(primeiro), isoDeData(ultimo), { tipo: tipo() });
    } catch (err) {
      console.error('[seletor-aula] falha ao carregar o calendário:', err);
      grade.innerHTML = '';
      cabecalho();
      grade.append(el('div', { class: 'vazio', style: 'grid-column:1/-1' }, [
        el('span', { class: 'vazio-icone' }, [iconeEl('alerta')]),
        el('p', { text: t('cal.erro') }),
        el('button', { type: 'button', class: 'btn btn-secundario btn-peq mt-16', text: t('comum.tentarDeNovo'), onclick: () => montarCalendario() }),
      ]));
      return;
    }

    grade.innerHTML = '';
    cabecalho();
    for (let i = 0; i < primeiro.getDay(); i += 1) grade.append(el('div', { class: 'dia-cel vazio' }));

    const hojeIso = hojeISO();
    for (let dia = 1; dia <= ultimo.getDate(); dia += 1) {
      const data = new Date(ano, mes, dia);
      const iso = isoDeData(data);
      const resumo = resumos.get(iso);
      const passou = iso < hojeIso;
      const semVagas = resumo ? !resumo.temVaga : true;
      const bloqueadoPlano = soFimDeSemana() && data.getDay() !== 0 && data.getDay() !== 6;
      const semAula = !!resumo?.semAula;
      const indisponivel = passou || semVagas || bloqueadoPlano || semAula;

      let dica = '';
      if (semAula) dica = t('cal.semAula', { motivo: resumo.motivoSemAula || '' });
      else if (bloqueadoPlano) dica = t('cal.soFimDeSemana');
      else if (!indisponivel && resumo) {
        dica = `${resumo.horarios.join(' · ')} — ${resumo.locais.map((l) => nomeLocal(contexto.mapaLocais, l)).join(', ')}`;
      }

      const cel = el('button', {
        type: 'button',
        class: ['dia-cel', indisponivel ? 'indisponivel' : 'disponivel', iso === hojeIso ? 'hoje' : '',
          iso === diaSelecionado ? 'selecionado' : '', !passou && semVagas && !semAula ? 'lotado-total' : '',
          semAula && !passou ? 'sem-aula' : ''].filter(Boolean).join(' '),
        disabled: indisponivel,
        title: dica,
        'aria-label': `${dia} ${nomeMes}${dica ? ` — ${dica}` : ''}`,
        dataset: { data: iso },
      }, [el('span', { text: String(dia) })]);

      if (!indisponivel) {
        cel.append(el('span', { class: 'ponto' }));
        cel.addEventListener('click', () => selecionarDia(iso));
      }
      grade.append(cel);
    }
  }

  function montarResumoDoDia(slots) {
    if (!resumoDia) return;
    resumoDia.innerHTML = '';
    const futuros = slots.filter((s) => !s.jaPassou);
    if (!futuros.length) return;
    const locais = [...new Set(futuros.map((s) => nomeLocal(contexto.mapaLocais, s.localId)))];
    resumoDia.append(el('div', { class: 'resumo-dia-linha' }, [
      el('span', { class: 'resumo-dia-rotulo com-icone' }, [iconeEl('local'), t('cal.locais')]),
      ...locais.map((l) => el('span', { class: 'chip-info', text: l })),
    ]));
  }

  function estadoDoSlot(slot) {
    if (slot.semAula) return { pode: false, texto: t('cal.semAulaCurto'), classe: 'badge-perigo', dica: t('cal.semAulaCurto') };
    if (tipo() === 'individual') {
      return slot.particularLivre
        ? { pode: true, texto: t('cal.livre'), classe: 'badge-sucesso', dica: t('cal.particularLivre') }
        : { pode: false, texto: t('cal.ocupado'), classe: 'badge-perigo', dica: t('cal.particularOcupado') };
    }
    if (slot.vagas <= 0) return { pode: false, texto: t('cal.lotado'), classe: 'badge-perigo', dica: t('cal.turmaCompleta') };
    return {
      pode: true,
      texto: slot.vagas === 1 ? t('cal.umaVaga') : t('cal.nVagas', { n: slot.vagas }),
      classe: slot.vagas <= 2 ? 'badge-aviso' : 'badge-sucesso',
      dica: slot.vagas === 1 ? t('cal.resta1') : t('cal.restamN', { n: slot.vagas }),
    };
  }

  function montarSlots(slots) {
    lista.innerHTML = '';
    const utilizaveis = slots.filter((s) => !s.jaPassou);
    if (!utilizaveis.length) {
      lista.append(vazio(t('cal.semHorarios'), 'lua'));
      return;
    }
    for (const slot of utilizaveis) {
      const estado = estadoDoSlot(slot);
      const local = nomeLocal(contexto.mapaLocais, slot.localId);
      const pct = tipo() === 'individual'
        ? (slot.particularLivre ? 0 : 100)
        : (slot.capacidade ? Math.min(100, (slot.ocupados / slot.capacidade) * 100) : 100);
      const classeBarra = !estado.pode ? 'cheio' : pct >= 60 ? 'medio' : '';

      const botao = el('button', {
        type: 'button',
        class: `slot ${estado.pode ? '' : 'lotado'} ${slotSelecionado?.chave === slot.chave ? 'selecionado' : ''}`,
        disabled: !estado.pode,
        title: estado.dica,
        'aria-label': `${slot.horario}, ${local}: ${estado.dica}`,
        dataset: { chave: slot.chave },
      }, [
        el('div', { class: 'detalhe' }, [
          el('div', { class: 'prof', text: faixaHorario(slot.horario, contexto.config.duracaoMin) }),
          el('div', { class: 'local com-icone' }, [iconeEl('local'), `${local} · ${estado.dica}`]),
          el('div', { class: 'vagas-barra' }, [el('div', { class: `preenchido ${classeBarra}`, style: `width:${pct}%` })]),
        ]),
        el('span', { class: `badge ${estado.classe}`, text: estado.texto }),
      ]);
      if (estado.pode) {
        botao.addEventListener('click', () => {
          slotSelecionado = { ...slot, tipo: tipo() };
          lista.querySelectorAll('.slot').forEach((s) => s.classList.toggle('selecionado', s === botao));
          aoSelecionar(slotSelecionado);
        });
      }
      lista.append(botao);
    }
  }

  async function selecionarDia(iso) {
    diaSelecionado = iso;
    slotSelecionado = null;
    aoSelecionar(null);
    grade.querySelectorAll('.dia-cel').forEach((c) => c.classList.toggle('selecionado', c.dataset.data === iso));
    if (rotuloDia) rotuloDia.textContent = dataPorExtenso(iso);
    lista.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
    try {
      const slots = await horariosDoDia(iso, { tipo: tipo() });
      montarResumoDoDia(slots);
      montarSlots(slots);
    } catch (err) {
      console.error('[seletor-aula] falha ao carregar horários:', err);
      lista.innerHTML = '';
      lista.append(vazio(t('cal.erroHorarios'), 'alerta'));
    }
  }

  btnAnterior.addEventListener('click', async () => {
    mesVisivel = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() - 1, 1);
    await montarCalendario();
  });
  btnProximo.addEventListener('click', async () => {
    mesVisivel = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() + 1, 1);
    await montarCalendario();
  });

  return {
    /** Monta o mês e, se pedir, já abre o primeiro dia com vaga (ou o `dia` indicado). */
    async iniciar({ dia = null, abrirPrimeiro = true } = {}) {
      if (dia) mesVisivel = new Date(dataDeISO(dia).getFullYear(), dataDeISO(dia).getMonth(), 1);
      await montarCalendario();
      if (dia && resumos.get(dia)?.temVaga) {
        await selecionarDia(dia);
        return;
      }
      if (abrirPrimeiro) {
        const primeiro = [...resumos.values()].find((r) => r.temVaga && r.data >= hojeISO()
          && (!soFimDeSemana() || [0, 6].includes(dataDeISO(r.data).getDay())));
        if (primeiro) await selecionarDia(primeiro.data);
      }
    },
    async recarregar() {
      await montarCalendario();
      if (diaSelecionado) await selecionarDia(diaSelecionado);
    },
    /** Reabre o dia e tenta manter o horário escolhido (depois de trocar tipo/idioma). */
    async selecionarDia(iso) { await selecionarDia(iso); },
    selecionarChave(chave) {
      const botao = lista.querySelector(`.slot[data-chave="${CSS.escape(chave)}"]:not(.lotado)`);
      botao?.click();
      return !!botao;
    },
    limparSelecao() {
      slotSelecionado = null;
      lista.querySelectorAll('.slot.selecionado').forEach((s) => s.classList.remove('selecionado'));
      aoSelecionar(null);
    },
    selecionado: () => slotSelecionado,
    dia: () => diaSelecionado,
  };
}
