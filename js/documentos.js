/**
 * documentos.js — CPF, passaporte, nacionalidade e idioma do aluno.
 *
 * O CPF é o documento de conferência na praia: o professor dá baixa na
 * presença olhando o CPF do aluno. Estrangeiros sem CPF informam o número do
 * passaporte (ou documento de identidade do país), que cumpre o mesmo papel.
 */

/* --------------------------------------------------------------------------
   CPF
   -------------------------------------------------------------------------- */

export const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

/** 12345678909 -> 123.456.789-09 (aceita parcial, para máscara de digitação). */
export function mascaraCpf(valor) {
  const d = soDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Valida os dígitos verificadores do CPF. */
export function cpfValido(valor) {
  const d = soDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (base) => {
    let soma = 0;
    for (let i = 0; i < base; i += 1) soma += Number(d[i]) * (base + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Documento normalizado para busca: CPF só com dígitos; passaporte em maiúsculas sem espaços. */
export function normalizarDocumento(valor) {
  const texto = String(valor || '').trim().toUpperCase().replace(/[\s.\-/]/g, '');
  return texto;
}

/** Texto do documento para exibir: CPF mascarado ou o passaporte como veio. */
export function documentoFormatado(usuario) {
  if (!usuario) return '';
  if (usuario.cpf) return mascaraCpf(usuario.cpf);
  if (usuario.documento) return String(usuario.documento).toUpperCase();
  return '';
}

/** Rótulo do tipo de documento do aluno. */
export const rotuloDocumento = (usuario) => (usuario?.cpf ? 'CPF' : 'Passaporte');

/* --------------------------------------------------------------------------
   Nacionalidade e idioma
   -------------------------------------------------------------------------- */

/**
 * Lista curta com os países que mais mandam alunos para a Barra; "Outro"
 * abre um campo livre. O código (ISO-3166 alfa-2) é o que fica gravado.
 */
export const PAISES = [
  { id: 'BR', pt: 'Brasil', en: 'Brazil', es: 'Brasil' },
  { id: 'AR', pt: 'Argentina', en: 'Argentina', es: 'Argentina' },
  { id: 'UY', pt: 'Uruguai', en: 'Uruguay', es: 'Uruguay' },
  { id: 'CL', pt: 'Chile', en: 'Chile', es: 'Chile' },
  { id: 'PY', pt: 'Paraguai', en: 'Paraguay', es: 'Paraguay' },
  { id: 'CO', pt: 'Colômbia', en: 'Colombia', es: 'Colombia' },
  { id: 'PE', pt: 'Peru', en: 'Peru', es: 'Perú' },
  { id: 'US', pt: 'Estados Unidos', en: 'United States', es: 'Estados Unidos' },
  { id: 'PT', pt: 'Portugal', en: 'Portugal', es: 'Portugal' },
  { id: 'ES', pt: 'Espanha', en: 'Spain', es: 'España' },
  { id: 'DE', pt: 'Alemanha', en: 'Germany', es: 'Alemania' },
  { id: 'FR', pt: 'França', en: 'France', es: 'Francia' },
  { id: 'IT', pt: 'Itália', en: 'Italy', es: 'Italia' },
  { id: 'GB', pt: 'Reino Unido', en: 'United Kingdom', es: 'Reino Unido' },
  { id: 'OUTRO', pt: 'Outro país', en: 'Other country', es: 'Otro país' },
];

export function nomePais(codigo, idioma = 'pt') {
  const pais = PAISES.find((p) => p.id === codigo);
  if (pais && pais.id !== 'OUTRO') return pais[idioma] || pais.pt;
  return codigo || '';
}

/** Idiomas em que a escola dá aula (e em que o site está traduzido). */
export const IDIOMAS_AULA = [
  { id: 'pt', nome: 'Português', bandeira: '🇧🇷' },
  { id: 'en', nome: 'English', bandeira: '🇺🇸' },
  { id: 'es', nome: 'Español', bandeira: '🇪🇸' },
];

export const nomeIdioma = (id) => IDIOMAS_AULA.find((i) => i.id === id)?.nome || 'Português';
export const bandeiraIdioma = (id) => IDIOMAS_AULA.find((i) => i.id === id)?.bandeira || '';

/* --------------------------------------------------------------------------
   Perfil completo
   -------------------------------------------------------------------------- */

/**
 * O aluno precisa de documento, nacionalidade, nascimento e idioma para
 * agendar. Quem entrou com o Google (ou se cadastrou antes desta versão)
 * completa esses dados uma vez.
 */
export function perfilCompleto(usuario) {
  if (!usuario || usuario.papel !== 'aluno') return true;
  const temDocumento = !!(usuario.cpf || usuario.documento);
  return temDocumento && !!usuario.nacionalidade && !!usuario.idioma && !!usuario.nascimento;
}

/** Idade em anos completos a partir de 'YYYY-MM-DD'. */
export function idadeEm(nascimento, referencia = new Date()) {
  const [a, m, d] = String(nascimento || '').split('-').map(Number);
  if (!a || !m || !d) return null;
  let idade = referencia.getFullYear() - a;
  const antesDoAniversario = referencia.getMonth() + 1 < m
    || (referencia.getMonth() + 1 === m && referencia.getDate() < d);
  if (antesDoAniversario) idade -= 1;
  return idade;
}
