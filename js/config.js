/**
 * Configuração central do sistema Barra Floripa.
 *
 * Para trocar do modo demo para produção, altere apenas MODO_DADOS e
 * MODO_PAGAMENTO abaixo e preencha as credenciais. Veja docs/GUIA.md.
 */

export const CONFIG = {
  /**
   * 'local'    -> tudo salvo no navegador (localStorage), já semeado com dados
   *               de exemplo. Funciona sem instalar nada.
   * 'firebase' -> usa Firebase Authentication + Cloud Firestore.
   *               Exige preencher firebaseConfig abaixo.
   */
  MODO_DADOS: 'firebase',

  /**
   * 'mock' -> pagamentos simulados (PIX, cartão, Mercado Pago, PayPal com
   *           fluxo visual completo, mas sem cobrança real).
   * 'real' -> usa os SDKs reais. Exige as chaves abaixo E um backend que crie
   *           as preferências/ordens. Veja docs/GUIA.md, seção "Pagamentos".
   */
  MODO_PAGAMENTO: 'mock',

  // Preencha ao migrar para Firebase (Console > Configurações do projeto).
  firebaseConfig: {
    apiKey: 'AIzaSyDPBnDg89uOBJ7eamiKjc_HfNiE9GV6EQg',
    authDomain: 'barra-floripa.firebaseapp.com',
    projectId: 'barra-floripa',
    storageBucket: 'barra-floripa.firebasestorage.app',
    messagingSenderId: '156655914707',
    appId: '1:156655914707:web:de80530316cefd2ffb0e26',
  },

  // Credenciais dos gateways (apenas chaves PÚBLICAS aqui; segredos no backend).
  pagamentos: {
    mercadoPagoPublicKey: '',
    paypalClientId: '',
    pixChave: 'contato@barrafloripa.com.br',
    pixBeneficiario: 'BARRA FLORIPA SURF',
    pixCidade: 'FLORIANOPOLIS',
  },

  // Endpoint do seu backend que cria preferências/ordens (modo 'real').
  backendUrl: '',
};

/** Dados da escola exibidos na landing e no rodapé. */
export const ESCOLA = {
  nome: 'Barra Floripa',
  subtitulo: 'Surf School',
  desde: 1989,
  telefone: '(48) 99900-2584',
  whatsapp: '5548999002584',
  email: 'contato@barrafloripasurfschool.com.br',
  instagram: 'barra.floripa.surf',
  endereco: 'Tv. Manoel Florentino Vieira, 0030 - Barra da Lagoa, Florianópolis - SC, 88061-080',
  mapsUrl: 'https://www.google.com/maps/place/Barra+Floripa+Surf+School/@-27.5758361,-48.4258321,17z',
};

/**
 * Valores padrão de fábrica. O painel administrativo grava sobrescritas na
 * coleção `config`; obterConfig() em js/precos.js faz o merge.
 * Nunca leia estes valores direto nas telas — use precos.js.
 */
export const DEFAULTS = {
  horarios: ['08:00', '10:00', '14:00', '16:00'],
  duracaoMin: 90,
  capacidadeGrupo: 5,
  /** Horas mínimas de antecedência para o aluno cancelar sozinho. */
  horasMinimasCancelamento: 12,

  professores: [
    { id: 'prof-laudinei', nome: 'Laudinei Neves', email: 'laudinei@barrafloripa.com.br', papel: 'admin', ordem: 1 },
    { id: 'prof-igor', nome: 'Igor', email: 'igor@barrafloripa.com.br', papel: 'professor', ordem: 2 },
    { id: 'prof-jorge', nome: 'Jorge', email: 'jorge@barrafloripa.com.br', papel: 'professor', ordem: 3 },
  ],

  locais: [
    { id: 'local-barra', nome: 'Praia da Barra da Lagoa', descricao: 'Ponto de encontro em frente à escola', ativo: true },
    { id: 'local-mole', nome: 'Praia Mole', descricao: 'Usado quando a Barra está sem condições', ativo: true },
  ],

  /**
   * Catálogo de pacotes.
   *
   * `creditos`        quantas aulas o aluno pode agendar
   * `validadeDias`    prazo para usar os créditos (null = sem prazo)
   * `apenasFimDeSemana` restringe o agendamento a sábado e domingo
   */
  pacotes: [
    { id: 'pac-avulsa', tipo: 'avulsa', nome: 'Aula em Grupo Avulsa', descricao: '1 aula em grupo (máx. 5 alunos)', creditos: 1, preco: 150, validadeDias: null, destaque: false, ativo: true, ordem: 1 },
    { id: 'pac-4', tipo: 'pacote', nome: 'Pacote 4 Aulas', descricao: '4 aulas em grupo · válido por 1 mês', creditos: 4, preco: 480, validadeDias: 30, destaque: false, ativo: true, ordem: 2 },
    { id: 'pac-9', tipo: 'pacote', nome: 'Pacote 9 Aulas', descricao: '9 aulas em grupo · válido por 40 dias', creditos: 9, preco: 990, validadeDias: 40, destaque: false, ativo: true, ordem: 3 },
    { id: 'pac-12', tipo: 'pacote', nome: 'Pacote 12 Aulas', descricao: '12 aulas em grupo · válido por 2 meses', creditos: 12, preco: 1300, validadeDias: 60, destaque: false, ativo: true, ordem: 4 },
    { id: 'pac-individual', tipo: 'individual', nome: 'Aula Particular', descricao: 'Só você e o professor', creditos: 1, preco: 250, validadeDias: null, destaque: false, ativo: true, ordem: 5 },
    { id: 'pac-mensal-1x', tipo: 'mensal', nome: 'Mensalista 1x/semana', descricao: '4 aulas por mês · somente sábado e domingo', creditos: 4, preco: 400, frequenciaSemanal: 1, validadeDias: 30, apenasFimDeSemana: true, destaque: false, ativo: true, ordem: 6 },
    { id: 'pac-mensal-2x', tipo: 'mensal', nome: 'Mensalista 2x/semana', descricao: '8 aulas por mês · somente sábado e domingo', creditos: 8, preco: 720, frequenciaSemanal: 2, validadeDias: 30, apenasFimDeSemana: true, destaque: true, ativo: true, ordem: 7 },
  ],
};

/** Preço de referência de uma aula avulsa, usado para calcular a economia. */
export const PRECO_AULA_AVULSA = 150;

/** Senha das contas de demonstração (apenas modo 'local'). */
export const SENHA_DEMO = 'barra123';
