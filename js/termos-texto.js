/**
 * termos-texto.js — Termos de uso e política da escola (PT, EN, ES).
 *
 * {horas} = antecedência mínima para o aluno cancelar (config, padrão 12)
 * {meses} = validade do questionário de saúde (config, padrão 6)
 *
 * ⚠️ Texto-base redigido a partir das regras combinadas com a escola.
 * Revise com a escola (e, se possível, com um advogado) antes de publicar.
 */

export const TERMOS = {
  pt: {
    atualizado: 'Versão de novembro de 2026',
    secoes: [
      {
        id: 'sobre',
        titulo: '1. Sobre estes termos',
        html: `<p>Estes termos valem para quem compra pacotes e agenda aulas da Barra Floripa Surf School
          (Tv. Manoel Florentino Vieira, 30 — Barra da Lagoa, Florianópolis/SC) pelo site. Ao criar a
          conta e concluir uma compra, o aluno declara ter lido e aceitado estes termos e a política de
          cancelamento abaixo.</p>`,
      },
      {
        id: 'creditos',
        titulo: '2. Pacotes, créditos e validade',
        html: `<ul>
          <li>Cada pacote dá direito a um número de <strong>créditos</strong>; cada aula agendada usa 1 crédito.</li>
          <li>Os créditos têm o <strong>prazo de uso</strong> informado no pacote (ex.: 30, 40 ou 60 dias),
            contado a partir da confirmação do pagamento. Créditos vencidos não são reembolsados nem prorrogados.</li>
          <li>Planos mensalistas valem <strong>somente aos sábados e domingos</strong>.</li>
          <li>Cupons de desconto valem nas condições informadas na criação (prazo, limite de usos e planos)
            e não são cumulativos.</li>
          <li>O <strong>professor de cada turma é definido pela escola</strong>, conforme a disponibilidade da
            equipe, o nível dos alunos e as condições do mar. A escola pode trocar o professor de uma
            turma sem aviso prévio.</li>
        </ul>`,
      },
      {
        id: 'cancelamento',
        titulo: '3. Política de cancelamento de aulas',
        html: `<ul>
          <li>O aluno pode <strong>cancelar pelo site até {horas} horas antes</strong> do início da aula.
            O crédito volta automaticamente, com o mesmo prazo de validade do pacote de origem.</li>
          <li>Faltando menos de {horas} horas, <strong>o site bloqueia o cancelamento pelo aluno</strong>.
            A partir daí, só a escola pode cancelar a aula.</li>
          <li><strong>Ausência sem justificativa aprovada faz o aluno perder o crédito</strong> daquela aula.</li>
        </ul>`,
      },
      {
        id: 'justificativas',
        titulo: '4. Faltas e justificativas',
        html: `<p>Em caso de imprevisto (doença, acidente, emergência), o aluno pode enviar uma
          <strong>justificativa pelo painel</strong>, com a explicação por escrito e, se houver, um
          <strong>atestado ou comprovante anexado</strong> (foto ou PDF). A justificativa é analisada pela
          administração da escola:</p>
          <ul>
            <li><strong>Aprovada:</strong> a escola cancela a aula e o crédito volta para o aluno.</li>
            <li><strong>Recusada:</strong> o crédito é mantido como utilizado, e o aluno recebe o motivo.</li>
          </ul>
          <p>A análise é feita caso a caso, a critério da escola.</p>`,
      },
      {
        id: 'clima',
        titulo: '5. Cancelamento pela escola (mar, tempestade, indisponibilidade)',
        html: `<p>Por segurança, a escola pode cancelar aulas por condições do mar ou do tempo, ou por
          indisponibilidade. Nesses casos <strong>o crédito volta automaticamente</strong> e o aluno recebe
          um aviso no painel, por mensagem e por e-mail para <strong>reagendar</strong>. A escola também
          pode transferir a aula para outra praia próxima, avisando os alunos.</p>`,
      },
      {
        id: 'presenca',
        titulo: '6. Presença e documento',
        html: `<p>A presença é conferida na praia pelo professor, com o <strong>CPF</strong> (ou, para
          estrangeiros, o passaporte/documento de identidade) informado no cadastro. <strong>Leve o documento
          em todas as aulas.</strong> Chegue com 15 minutos de antecedência; atrasos não estendem o horário da aula.</p>`,
      },
      {
        id: 'saude',
        titulo: '7. Saúde e responsabilidade',
        html: `<p>Para comprar e agendar, o aluno responde o <strong>Questionário de Prontidão para Atividade
          Física (PAR-Q)</strong> e assina o <strong>Termo de Responsabilidade</strong> (Lei estadual
          nº 16.724/2018), renovados a cada {meses} meses. Menores de 18 anos precisam do responsável
          legal. O aluno deve informar à escola qualquer mudança no seu estado de saúde. Saber nadar é
          recomendado; informe o professor se não souber.</p>`,
      },
      {
        id: 'pagamentos',
        titulo: '8. Pagamentos e reembolsos',
        html: `<p>Os pagamentos são processados pelo Mercado Pago (PIX, cartão e boleto) ou PayPal; o site
          não armazena dados de cartão. Os créditos entram assim que o pagamento é confirmado. Pedidos de
          reembolso de créditos não utilizados seguem o Código de Defesa do Consumidor (direito de
          arrependimento em até 7 dias da compra feita pela internet, desde que nenhuma aula tenha sido
          usada) e devem ser feitos pelo WhatsApp ou e-mail da escola.</p>`,
      },
      {
        id: 'dados',
        titulo: '9. Dados pessoais (LGPD)',
        html: `<p>Usamos nome, contato, documento, data de nascimento, idioma e as respostas do questionário
          de saúde apenas para agendar e conferir as aulas, cuidar da segurança dos alunos e cumprir
          obrigações legais. Esses dados são vistos somente pela equipe da escola e não são vendidos nem
          compartilhados para marketing. O aluno pode pedir a correção ou exclusão dos dados pelos
          canais de contato, respeitados os prazos legais de guarda.</p>`,
      },
      {
        id: 'contato',
        titulo: '10. Contato',
        html: `<p>WhatsApp (48) 99900-2584 · contato@barrafloripasurfschool.com.br</p>`,
      },
    ],
  },

  en: {
    atualizado: 'November 2026 version',
    secoes: [
      {
        id: 'sobre',
        titulo: '1. About these terms',
        html: `<p>These terms apply to anyone who buys packages and books lessons with Barra Floripa Surf School
          (Barra da Lagoa, Florianópolis, Brazil) through this website. By creating an account and completing
          a purchase, the student confirms they have read and accepted these terms and the cancellation
          policy below.</p>`,
      },
      {
        id: 'creditos',
        titulo: '2. Packages, credits and expiry',
        html: `<ul>
          <li>Each package gives a number of <strong>credits</strong>; each booked lesson uses 1 credit.</li>
          <li>Credits must be used within the <strong>period shown in the package</strong> (e.g. 30, 40 or
            60 days), counted from payment confirmation. Expired credits are not refunded or extended.</li>
          <li>Monthly plans are valid <strong>on Saturdays and Sundays only</strong>.</li>
          <li>Discount coupons apply under the conditions set when they were created and cannot be combined.</li>
          <li>The <strong>instructor of each class is assigned by the school</strong>, based on staff
            availability, students' level and sea conditions, and may change without notice.</li>
        </ul>`,
      },
      {
        id: 'cancelamento',
        titulo: '3. Lesson cancellation policy',
        html: `<ul>
          <li>Students can <strong>cancel on the website up to {horas} hours before</strong> the lesson starts.
            The credit is returned automatically, with the same expiry as the original package.</li>
          <li>With less than {horas} hours to go, <strong>the website blocks cancellation by the student</strong>.
            From then on, only the school can cancel the lesson.</li>
          <li><strong>A no-show without an approved justification means the credit is lost.</strong></li>
        </ul>`,
      },
      {
        id: 'justificativas',
        titulo: '4. Absences and justifications',
        html: `<p>In case of an emergency (illness, accident), the student may send a <strong>justification
          from their dashboard</strong>, with a written explanation and, if available, an <strong>attached
          medical certificate or proof</strong> (photo or PDF). The school's administration reviews it:</p>
          <ul>
            <li><strong>Approved:</strong> the school cancels the lesson and the credit is returned.</li>
            <li><strong>Declined:</strong> the credit remains used and the student is told why.</li>
          </ul>`,
      },
      {
        id: 'clima',
        titulo: '5. Cancellation by the school (sea, storm, unavailability)',
        html: `<p>For safety, the school may cancel lessons due to sea or weather conditions or unavailability.
          In that case <strong>the credit is returned automatically</strong> and the student is notified on the
          dashboard, by message and by email to <strong>reschedule</strong>.</p>`,
      },
      {
        id: 'presenca',
        titulo: '6. Attendance and ID',
        html: `<p>Attendance is checked on the beach by the instructor using the <strong>ID (passport or
          Brazilian CPF)</strong> provided at sign-up. <strong>Bring your ID to every lesson.</strong>
          Please arrive 15 minutes early; late arrivals do not extend the lesson.</p>`,
      },
      {
        id: 'saude',
        titulo: '7. Health and liability',
        html: `<p>To buy and book, the student answers the <strong>Physical Activity Readiness Questionnaire
          (PAR-Q)</strong> and signs the <strong>Liability Waiver</strong> (Santa Catarina State Law
          16.724/2018), renewed every {meses} months. Under-18s need a parent or legal guardian.
          Being able to swim is recommended; tell your instructor if you can't.</p>`,
      },
      {
        id: 'pagamentos',
        titulo: '8. Payments and refunds',
        html: `<p>Payments are processed by Mercado Pago (PIX, card, boleto) or PayPal; the website does not
          store card data. Credits are added once payment is confirmed. Refunds of unused credits follow
          Brazilian consumer law (7-day withdrawal right for online purchases, if no lesson was used) and
          must be requested via the school's WhatsApp or email.</p>`,
      },
      {
        id: 'dados',
        titulo: '9. Personal data',
        html: `<p>We use your name, contact details, ID, date of birth, language and health questionnaire
          answers only to book and check lessons, look after students' safety and meet legal obligations.
          Only school staff can see them; they are never sold or shared for marketing. You can ask us to
          correct or delete your data through the contact channels below.</p>`,
      },
      {
        id: 'contato',
        titulo: '10. Contact',
        html: '<p>WhatsApp +55 48 99900-2584 · contato@barrafloripasurfschool.com.br</p>',
      },
    ],
  },

  es: {
    atualizado: 'Versión de noviembre de 2026',
    secoes: [
      {
        id: 'sobre',
        titulo: '1. Sobre estos términos',
        html: `<p>Estos términos valen para quien compra paquetes y reserva clases de Barra Floripa Surf School
          (Barra da Lagoa, Florianópolis, Brasil) por el sitio. Al crear la cuenta y completar una compra, el
          alumno declara haber leído y aceptado estos términos y la política de cancelación.</p>`,
      },
      {
        id: 'creditos',
        titulo: '2. Paquetes, créditos y vigencia',
        html: `<ul>
          <li>Cada paquete da derecho a un número de <strong>créditos</strong>; cada clase reservada usa 1 crédito.</li>
          <li>Los créditos deben usarse dentro del <strong>plazo indicado en el paquete</strong> (ej.: 30, 40 o
            60 días), contado desde la confirmación del pago. Los créditos vencidos no se reembolsan ni se prorrogan.</li>
          <li>Los planes mensuales valen <strong>solo sábados y domingos</strong>.</li>
          <li>Los cupones de descuento valen en las condiciones informadas y no son acumulables.</li>
          <li>El <strong>instructor de cada clase lo define la escuela</strong>, según la disponibilidad del
            equipo, el nivel de los alumnos y las condiciones del mar, y puede cambiar sin aviso.</li>
        </ul>`,
      },
      {
        id: 'cancelamento',
        titulo: '3. Política de cancelación de clases',
        html: `<ul>
          <li>El alumno puede <strong>cancelar por el sitio hasta {horas} horas antes</strong> de la clase.
            El crédito vuelve automáticamente, con la misma vigencia del paquete de origen.</li>
          <li>Faltando menos de {horas} horas, <strong>el sitio bloquea la cancelación por el alumno</strong>.
            Desde entonces, solo la escuela puede cancelar la clase.</li>
          <li><strong>La ausencia sin justificación aprobada hace perder el crédito.</strong></li>
        </ul>`,
      },
      {
        id: 'justificativas',
        titulo: '4. Ausencias y justificaciones',
        html: `<p>Ante un imprevisto (enfermedad, accidente), el alumno puede enviar una <strong>justificación
          desde su panel</strong>, con la explicación por escrito y, si tiene, un <strong>certificado médico o
          comprobante adjunto</strong> (foto o PDF). La administración de la escuela la analiza:</p>
          <ul>
            <li><strong>Aprobada:</strong> la escuela cancela la clase y el crédito vuelve.</li>
            <li><strong>Rechazada:</strong> el crédito queda utilizado y el alumno recibe el motivo.</li>
          </ul>`,
      },
      {
        id: 'clima',
        titulo: '5. Cancelación por la escuela (mar, tormenta, indisponibilidad)',
        html: `<p>Por seguridad, la escuela puede cancelar clases por condiciones del mar o del clima, o por
          indisponibilidad. En ese caso <strong>el crédito vuelve automáticamente</strong> y el alumno recibe
          un aviso en el panel, por mensaje y por correo para <strong>reprogramar</strong>.</p>`,
      },
      {
        id: 'presenca',
        titulo: '6. Asistencia y documento',
        html: `<p>La asistencia la confirma el instructor en la playa con el <strong>documento (pasaporte, DNI o
          CPF)</strong> informado en el registro. <strong>Lleve el documento a todas las clases.</strong>
          Llegue 15 minutos antes; los atrasos no extienden la clase.</p>`,
      },
      {
        id: 'saude',
        titulo: '7. Salud y responsabilidad',
        html: `<p>Para comprar y reservar, el alumno responde el <strong>Cuestionario de Aptitud para la
          Actividad Física (PAR-Q)</strong> y firma el <strong>Término de Responsabilidad</strong> (Ley del
          estado de Santa Catarina 16.724/2018), renovados cada {meses} meses. Los menores de 18 años
          necesitan a su responsable legal.</p>`,
      },
      {
        id: 'pagamentos',
        titulo: '8. Pagos y reembolsos',
        html: `<p>Los pagos los procesa Mercado Pago (PIX, tarjeta, boleto) o PayPal; el sitio no guarda datos
          de tarjeta. Los créditos se acreditan al confirmarse el pago. Los reembolsos de créditos no usados
          siguen la ley brasileña del consumidor (7 días de arrepentimiento para compras por internet, si no
          se usó ninguna clase) y se piden por WhatsApp o correo de la escuela.</p>`,
      },
      {
        id: 'dados',
        titulo: '9. Datos personales',
        html: `<p>Usamos nombre, contacto, documento, fecha de nacimiento, idioma y respuestas del cuestionario
          de salud solo para reservar y controlar las clases, cuidar la seguridad de los alumnos y cumplir
          obligaciones legales. Solo el equipo de la escuela los ve; nunca se venden ni se comparten para
          marketing. Puede pedir la corrección o eliminación de sus datos por los canales de contacto.</p>`,
      },
      {
        id: 'contato',
        titulo: '10. Contacto',
        html: '<p>WhatsApp +55 48 99900-2584 · contato@barrafloripasurfschool.com.br</p>',
      },
    ],
  },
};
