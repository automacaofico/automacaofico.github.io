const TABLE = (headerRow, keys, requiredColumns = keys, columnOverrides = {}) => ({ type: 'table', headerRow, keys, requiredColumns, columnOverrides });
const MATRIX = (labelColumn = 0, headerRows = []) => ({ type: 'matrix', labelColumn, headerRows });

export const DASHBOARDS = {
  superestrutura: {
    id: 'superestrutura',
    label: 'Superestrutura',
    aliases: ['super'],
    github: { owner: 'automacaofico', repo: 'super', path: 'Modelo Acompanhamento Super - FINAL.xlsx' },
    requiredSheets: ['ENTRADA', 'CURVAS', 'MATERIAIS'],
    sheets: {
      ENTRADA: MATRIX(0),
      CURVAS: MATRIX(0, [1]),
      HISTOGRAMA: MATRIX(0, [1, 2]),
      'SERVIÇOS NOTÁVEIS': MATRIX(0, [1]),
      LASTRO: TABLE(3, ['DATA', 'MÊS'], ['DATA', 'PRODUÇÃO (TON)', 'REALIZADO (TON)']),
      MATERIAIS: TABLE(1, ['DESCRIÇÃO', 'UNIDADE'], ['DESCRIÇÃO', 'UNIDADE', 'QNDE RECEBIDA', 'QNDE CONSUMIDA'])
    }
  },
  pendencias_r1: {
    id: 'pendencias_r1',
    label: 'Gestão de Pendências',
    aliases: ['pendenciasr1'],
    github: { owner: 'automacaofico', repo: 'pendenciasr1', path: 'Base_Pendencias_FICO.xlsx' },
    requiredSheets: ['PACOTES', 'PENDENCIAS', 'META'],
    sheets: {
      PACOTES: TABLE(1, ['PACOTE'], ['PACOTE', 'EMPRESA', 'KM', 'STATUS_TXT']),
      PENDENCIAS: TABLE(1, ['PACOTE', 'EMPRESA', 'TIPO'], ['PACOTE', 'EMPRESA', 'TIPO', 'TOTAL', 'EXECUTADO', 'PENDENTE']),
      CENARIOS: TABLE(1, ['PACOTE', 'N_EQUIPES'], ['PACOTE', 'N_EQUIPES', 'PEND_SEMANA']),
      ALERTAS: TABLE(1, ['PACOTE', 'TIPO', 'TITULO'], ['PACOTE', 'TIPO', 'TITULO']),
      META: TABLE(1, ['CHAVE'], ['CHAVE', 'VALOR'])
    }
  },
  mapa_pendencias: {
    id: 'mapa_pendencias',
    label: 'Mapa de Pendências',
    aliases: ['mapa-pendencias'],
    github: { owner: 'automacaofico', repo: 'mapa-pendencias', path: 'Pendencias_FICO_Mapa.xlsx' },
    requiredSheets: ['Pendências'],
    sheets: {
      Pendências: TABLE(1, ['ID ATLAS'], ['ID ATLAS', 'Empresa', 'Pacote', 'Descrição', 'KM inicial', 'KM final', 'Status'])
    }
  },
  infraestrutura_r1: {
    id: 'infraestrutura_r1',
    label: 'Infraestrutura Regional 01',
    aliases: ['base_fico_unificada'],
    github: { owner: 'automacaofico', repo: 'base_fico_unificada', path: 'Base_FICO_Unificada.xlsx' },
    requiredSheets: ['🎛️ Cabeçalho', '📋 Plan-Detalhado', 'Banco de Dados'],
    sheets: {
      '🎛️ Cabeçalho': MATRIX(0),
      '👷 Recursos': MATRIX(0, [3, 4]),
      '📊 Plan-Escopo': TABLE(4, ['Pacote', 'Serviço'], ['Pacote', 'Serviço', 'Previsto', 'Realizado'], { 0: 'Pacote' }),
      '📋 Plan-Detalhado': TABLE(4, ['Pacote', 'Serviço'], ['Pacote', 'Serviço', 'Acum. Prev.', 'Acum. Real.']),
      '🚫 Fora+Entrega': MATRIX(0),
      '📚 DataBooks-Mensal': TABLE(3, ['Pacote', 'Categoria'], ['Pacote', 'Categoria']),
      '🔧 RNCs': MATRIX(0),
      '📑 DataBooks-Ativos': TABLE(3, ['Pacote', 'Ativo'], ['Pacote', 'Ativo', 'Nota Qualitativa']),
      '🏗️ AsBuilt+Críticos': MATRIX(0),
      '🗺️ Retig P1': MATRIX(0, [4, 5, 6]),
      '🗺️ Retig P2': MATRIX(0, [4, 5, 6]),
      '🗺️ Retig P3': MATRIX(0, [4, 5, 6]),
      'Banco de Dados': TABLE(1, ['Id_Pendencia'], ['Id_Pendencia', 'Pacote', 'Ativo', 'KM Inicial', 'KM Final', 'Status_Pendencia']),
      PROGRAMAÇÃO: TABLE(1, ['Pacote', 'Ativo', 'Trecho'], ['Pacote', 'Ativo', 'Trecho', 'Status', '% Concluído'])
    }
  },
  infraestrutura_r2: {
    id: 'infraestrutura_r2',
    label: 'Infraestrutura Regional 02',
    aliases: ['regional2_infra'],
    github: { owner: 'automacaofico', repo: 'regional2-infra', path: 'Report_Regional02_Infra.xlsx' },
    requiredSheets: ['Report Consolidado Semanal', 'Report Pacote 0405', 'Report Pacote 06'],
    sheets: {
      'Report Consolidado Semanal': MATRIX(3, [3, 4, 5]),
      Gráficos: MATRIX(2, [1, 2]),
      Quadros: MATRIX(5, [3, 4]),
      'Report Pacote 0405': MATRIX(4, [5]),
      'Report Pacote 06': MATRIX(1, [6, 7]),
      'Report Pacote 07': MATRIX(1, [6, 7]),
      'Report Pacote 07-08': MATRIX(1, [6]),
      Bases: MATRIX(1, [1, 3])
    }
  }
};

export function dashboardById(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.values(DASHBOARDS).find((dashboard) => dashboard.id === normalized || dashboard.aliases.includes(normalized));
}
