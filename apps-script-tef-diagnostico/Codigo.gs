/**
 * ==============================================================================
 * LÚMIA DATA ENGINE - BACKEND GOOGLE APPS SCRIPT
 * Projeto: Diagnóstico Infra TEF/POS (Grupo Boticário Tech / PDF)
 * ==============================================================================
 * Melhorias:
 *  - Join com trusted-zone.canal_loja.tb_canal_loja_geral_ttd (UF, cidade, bairro, tipo local)
 *  - Modo de busca por UF
 *  - CTEs compartilhadas + helpers (menos duplicação / melhor manutenção)
 * ==============================================================================
 */

var CONFIG = {
  projectId: 'sandbox-mooz', // ⚠️ Substitua pelo ID do seu projeto no GCP
  // Schema tb_canal_loja_geral_ttd (campos usados):
  // cidade, bairro, estado, des_local_pdv_2 (Rua/Shopping/Hipermercado/Outros),
  // nome_cp_atual, des_regional_atualizada, des_regional, des_modelo, tp_pdv,
  // cod_franquia (zeros à esquerda extras), flg_cod_atual
};

/**
 * Serve a UI HTML
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Consulta TEF - Lojas e Servidores | PDF')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* =============================================================================
 * HELPERS
 * ============================================================================= */

function getServidoresCte() {
  return `
    tb_servidores AS (
      SELECT 'SIT2-BOTICF1-01' AS ip_do_sitef, 'Centro-Oeste 1' AS regiao UNION ALL
      SELECT 'SIT2-BOTICF1-02', 'Centro-Oeste 2' UNION ALL
      SELECT 'SIT2-BOTICF1-03', 'Nordeste 1' UNION ALL
      SELECT 'SIT2-BOTICF1-04', 'Nordeste 2' UNION ALL
      SELECT 'SIT2-BOTICF1-05', 'Nordeste 3' UNION ALL
      SELECT 'SIT2-BOTICF1-06', 'Nordeste 4' UNION ALL
      SELECT 'SIT2-BOTICF1-07', 'Norte 1' UNION ALL
      SELECT 'SIT2-BOTICF1-08', 'Sudeste 1' UNION ALL
      SELECT 'SIT2-BOTICF1-09', 'Sudeste 2' UNION ALL
      SELECT 'SIT2-BOTICF1-10', 'Sudeste 3' UNION ALL
      SELECT 'SIT2-BOTICF1-11', 'Sudeste 4' UNION ALL
      SELECT 'SIT2-BOTICF1-12', 'Sudeste 5' UNION ALL
      SELECT 'SIT2-BOTICF1-13', 'Sudeste 6' UNION ALL
      SELECT 'SIT2-BOTICF1-14', 'Sudeste 7' UNION ALL
      SELECT 'SIT2-BOTICF1-15', 'Sudeste 8' UNION ALL
      SELECT 'SIT2-BOTICF1-16', 'Sudeste 9' UNION ALL
      SELECT 'SIT2-BOTICF1-17', 'Sul 1' UNION ALL
      SELECT 'SIT2-BOTICF1-18', 'Sul 2' UNION ALL
      SELECT 'SIT2-BOTICF1-19', 'Sul 3' UNION ALL
      SELECT 'SIT2-BOTICF1-20', 'Sul 4'
    )
  `;
}

/**
 * Dimensão de loja normalizada.
 * cod_franquia na canal_loja tem mais zeros à esquerda → LTRIM + LPAD 8.
 * flg_cod_atual = 'x' reduz duplicidade de histórico.
 */
function getDimCanalCte() {
  // Não existe coluna de logradouro completo nesta tabela.
  // Tipo de estabelecimento: des_local_pdv_2 (Rua, Shopping, Hipermercado, Outros).
  // Localização: cidade + bairro + estado.
  return `
    dim_canal AS (
      SELECT
        codloja_clean,
        uf,
        cidade,
        bairro,
        tipo_loja,
        modelo_loja,
        grupo_franquia_cadastro,
        regional
      FROM (
        SELECT
          LPAD(
            NULLIF(
              LTRIM(
                REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''),
                '0'
              ),
              ''
            ),
            8, '0'
          ) AS codloja_clean,
          UPPER(TRIM(estado)) AS uf,
          TRIM(cidade) AS cidade,
          TRIM(bairro) AS bairro,
          TRIM(COALESCE(des_local_pdv_2, des_local_pdv, tp_pdv)) AS tipo_loja,
          TRIM(des_modelo) AS modelo_loja,
          TRIM(nome_cp_atual) AS grupo_franquia_cadastro,
          TRIM(COALESCE(des_regional_atualizada, des_regional)) AS regional
        FROM \`trusted-zone.canal_loja.tb_canal_loja_geral_ttd\`
        WHERE flg_cod_atual = 'x'
          AND cod_franquia IS NOT NULL
      )
      WHERE codloja_clean IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY codloja_clean ORDER BY codloja_clean) = 1
    )
  `;
}

function normalizeStoreCodes(rawTerm) {
  if (!rawTerm || typeof rawTerm !== 'string') return [];
  return rawTerm
    .split(/[,;\n]+/)
    .map(function (item) { return item.trim(); })
    .filter(function (item) { return item.length > 0; })
    .map(function (item) {
      return item.replace(/^(ES|PS)/i, '').replace(/^0+/, '').padStart(8, '0');
    });
}

function normalizeUf(rawTerm) {
  if (!rawTerm || typeof rawTerm !== 'string') return '';
  return rawTerm.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function rowsToJson(queryResults) {
  if (!queryResults || !queryResults.rows) {
    return JSON.stringify([]);
  }
  var headers = queryResults.schema.fields.map(function (f) { return f.name; });
  var resultJson = queryResults.rows.map(function (row) {
    var item = {};
    row.f.forEach(function (col, index) {
      item[headers[index]] = col.v;
    });
    return item;
  });
  return JSON.stringify(resultJson);
}

function runBigQuery(sql, queryParameters) {
  var request = {
    query: sql,
    useLegacySql: false
  };
  if (queryParameters && queryParameters.length > 0) {
    request.parameterMode = 'NAMED';
    request.queryParameters = queryParameters;
  }
  return BigQuery.Jobs.query(request, CONFIG.projectId);
}

function stringParam(name, value) {
  return {
    name: name,
    parameterType: { type: 'STRING' },
    parameterValue: { value: value === null || value === undefined ? null : String(value) }
  };
}

function arrayStringParam(name, values) {
  return {
    name: name,
    parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } },
    parameterValue: {
      arrayValues: values.map(function (v) { return { value: v }; })
    }
  };
}

/* =============================================================================
 * API PRINCIPAL
 * ============================================================================= */

/**
 * @param {string} searchTerm
 * @param {string} searchType - RESUMO_SERVIDORES | LOJA | SERVIDOR | UF | TERMINAIS_LOJA
 */
function searchStoreBigQuery(searchTerm, searchType) {
  try {
    var processedTerm = (searchTerm && typeof searchTerm === 'string') ? searchTerm.trim() : '';
    var mode = searchType || 'RESUMO_SERVIDORES';

    // ROTA 1: VISÃO GLOBAL DE SERVIDORES
    if (mode === 'RESUMO_SERVIDORES') {
      return queryResumoServidores();
    }

    // ROTA 2: DRILL-DOWN DE TERMINAIS (PDVs) ON-DEMAND
    if (mode === 'TERMINAIS_LOJA' && processedTerm !== '') {
      return queryTerminaisLoja(processedTerm);
    }

    // ROTA 3: DASHBOARD (LOJA | SERVIDOR | UF)
    return queryDashboard(processedTerm, mode);

  } catch (error) {
    Logger.log('Erro ao consultar BigQuery: ' + error.toString());
    throw new Error('Erro de comunicação com o BigQuery: ' + error.message);
  }
}

/* =============================================================================
 * ROTAS SQL
 * ============================================================================= */

function queryResumoServidores() {
  var sql = `
    WITH ${getServidoresCte()},
    base_tef AS (
      SELECT
        cod_ip_sitef,
        LPAD(REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') AS codloja,
        vlr_transacao
      FROM \`trusted-zone.entradas_gateways.tb_entradas_transacoes_loja_fisica\`
      WHERE dt_transacao BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
        AND (UPPER(tp_terminal_origem) != 'POS' OR tp_terminal_origem IS NULL)
        AND cod_ip_sitef IS NOT NULL AND cod_ip_sitef != '192.168.63.71'
        AND (cod_pdv IS NULL OR UPPER(cod_pdv) NOT LIKE 'GW%')
    )
    SELECT
      COALESCE(s.regiao, b.cod_ip_sitef) AS nome_servidor,
      MAX(s.ip_do_sitef) AS ip_servidor,
      COUNT(DISTINCT b.codloja) AS qtd_lojas,
      COUNT(1) AS total_transacoes,
      SUM(b.vlr_transacao) AS volume_financeiro
    FROM base_tef b
    LEFT JOIN tb_servidores s ON b.cod_ip_sitef = s.ip_do_sitef
    GROUP BY nome_servidor
    ORDER BY nome_servidor
  `;
  return rowsToJson(runBigQuery(sql));
}

function queryTerminaisLoja(storeCodeRaw) {
  var storeCode = storeCodeRaw.replace(/^(ES|PS)/i, '').replace(/^0+/, '').padStart(8, '0');
  var sql = `
    WITH ${getServidoresCte()}
    SELECT
      g.cod_pdv,
      TRIM(UPPER(g.cod_ip_sitef)) AS ip_servidor,
      COALESCE(s.regiao, TRIM(UPPER(g.cod_ip_sitef))) AS nome_servidor,
      COUNT(1) AS qtd_transacoes,
      MAX(g.dt_transacao) AS ultima_transacao
    FROM \`trusted-zone.entradas_gateways.tb_entradas_transacoes_loja_fisica\` g
    LEFT JOIN tb_servidores s ON TRIM(UPPER(g.cod_ip_sitef)) = s.ip_do_sitef
    WHERE g.dt_transacao BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
      AND LPAD(REGEXP_REPLACE(UPPER(CAST(g.cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') = @store_code
      AND (g.tp_terminal_origem IS NULL OR UPPER(g.tp_terminal_origem) != 'POS')
      AND g.cod_ip_sitef IS NOT NULL AND g.cod_ip_sitef != '192.168.63.71'
      AND (g.cod_pdv IS NULL OR UPPER(g.cod_pdv) NOT LIKE 'GW%')
    GROUP BY g.cod_pdv, ip_servidor, nome_servidor
    ORDER BY g.cod_pdv, ultima_transacao DESC
  `;
  return rowsToJson(runBigQuery(sql, [stringParam('store_code', storeCode)]));
}

function queryDashboard(processedTerm, mode) {
  var storeCodesArray = [];
  var ufTerm = '';

  if (mode === 'LOJA' && processedTerm !== '') {
    storeCodesArray = normalizeStoreCodes(processedTerm);
  }
  if (mode === 'UF' && processedTerm !== '') {
    ufTerm = normalizeUf(processedTerm);
    if (!ufTerm || ufTerm.length !== 2) {
      throw new Error('Informe uma UF válida com 2 letras (ex: SP, RJ, PR).');
    }
  }

  var isMultiStore = mode === 'LOJA' && storeCodesArray.length > 0;
  var isServerSearch = mode === 'SERVIDOR' && processedTerm !== '';
  var isUfSearch = mode === 'UF' && ufTerm !== '';

  // Filtro de loja na base de gateways / pix
  var storeFilterGateways;
  var storeFilterPix;

  if (isMultiStore) {
    storeFilterGateways = `LPAD(REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') IN UNNEST(@store_codes)`;
    storeFilterPix = storeFilterGateways;
  } else if (isUfSearch) {
    // Performance: restringe primeiro às lojas da UF via dim_canal
    storeFilterGateways = `LPAD(REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') IN (SELECT codloja_clean FROM lojas_filtro_uf)`;
    storeFilterPix = storeFilterGateways;
  } else {
    storeFilterGateways = `processed_search.term_clean IS NULL OR LPAD(REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') LIKE CONCAT('%', processed_search.term_clean, '%')`;
    storeFilterPix = storeFilterGateways;
  }

  var ufCte = isUfSearch ? `
    lojas_filtro_uf AS (
      SELECT DISTINCT codloja_clean
      FROM dim_canal
      WHERE uf = @uf_term
    ),
  ` : '';

  var serverWhere = isServerSearch
    ? `AND (LOWER(st.nome_servidor_tef_atual) LIKE CONCAT('%', LOWER(@server_term), '%') OR LOWER(st.ip_tef_atual) LIKE CONCAT('%', LOWER(@server_term), '%'))`
    : '';

  var resultLimit = (isServerSearch || isUfSearch) ? 'LIMIT 2000' : 'LIMIT 500';

  var sqlQuery = `
    WITH processed_search AS (
      SELECT
        CASE
          WHEN @search_term IS NULL OR TRIM(@search_term) = '' THEN NULL
          ELSE LPAD(REGEXP_REPLACE(UPPER(TRIM(@search_term)), r'^(ES|PS)', ''), 8, '0')
        END AS term_clean
    ),
    ${getServidoresCte()},
    ${getDimCanalCte()},
    ${ufCte}
    base_gateways_30d AS (
      SELECT
        dt_transacao, hr_transacao,
        CASE WHEN UPPER(tp_terminal_origem) = 'POS' THEN 'POS' ELSE 'TEF' END AS canal_origem,
        LPAD(REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') AS codloja_clean,
        cod_ip_sitef, des_rede AS adquirente, vlr_transacao, des_status_transacao, cod_pdv
      FROM \`trusted-zone.entradas_gateways.tb_entradas_transacoes_loja_fisica\`, processed_search
      WHERE dt_transacao BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
        AND (${storeFilterGateways})
    ),
    base_tef_pura AS (
      SELECT
        g.codloja_clean, g.dt_transacao, g.hr_transacao, TRIM(UPPER(g.cod_ip_sitef)) AS cod_ip_sitef,
        COALESCE(s.regiao, TRIM(UPPER(g.cod_ip_sitef))) AS nome_servidor, g.cod_pdv
      FROM base_gateways_30d g
      LEFT JOIN tb_servidores s ON TRIM(UPPER(g.cod_ip_sitef)) = s.ip_do_sitef
      WHERE g.canal_origem = 'TEF'
        AND g.cod_ip_sitef IS NOT NULL
        AND g.cod_ip_sitef != '192.168.63.71'
        AND (g.cod_pdv IS NULL OR UPPER(g.cod_pdv) NOT LIKE 'GW%')
    ),
    historico_servidores_ordenado AS (
      SELECT
        codloja_clean, cod_ip_sitef, nome_servidor,
        ROW_NUMBER() OVER (PARTITION BY codloja_clean ORDER BY MAX(dt_transacao) DESC, MAX(hr_transacao) DESC) AS pos_ordem
      FROM base_tef_pura
      GROUP BY codloja_clean, cod_ip_sitef, nome_servidor
    ),
    diagnostico_servidores_tef AS (
      SELECT
        codloja_clean,
        MAX(IF(pos_ordem = 1, cod_ip_sitef, NULL)) AS ip_tef_atual,
        MAX(IF(pos_ordem = 1, nome_servidor, NULL)) AS nome_servidor_tef_atual,
        MAX(IF(pos_ordem = 2, cod_ip_sitef, NULL)) AS ip_tef_anterior,
        MAX(IF(pos_ordem = 2, nome_servidor, NULL)) AS nome_servidor_tef_anterior,
        IF(COUNT(DISTINCT cod_ip_sitef) > 1, 'SIM', 'NÃO') AS trocou_servidor_30d
      FROM historico_servidores_ordenado
      GROUP BY codloja_clean
    ),
    diagnostico_mesmo_dia AS (
      SELECT
        codloja_clean,
        IF(LOGICAL_OR(qtd_ips_no_dia > 1), 'SIM', 'NÃO') AS tef_multisservidor_mesmo_dia,
        STRING_AGG(DISTINCT IF(qtd_ips_no_dia > 1, servidores_do_dia, NULL), ' | ') AS servidores_mesmo_dia
      FROM (
        SELECT
          codloja_clean, dt_transacao,
          COUNT(DISTINCT cod_ip_sitef) AS qtd_ips_no_dia,
          STRING_AGG(DISTINCT nome_servidor, ', ' ORDER BY nome_servidor) AS servidores_do_dia
        FROM base_tef_pura
        GROUP BY codloja_clean, dt_transacao
      )
      GROUP BY codloja_clean
    ),
    diagnostico_pdvs AS (
      SELECT
        codloja_clean,
        IF(COUNT(DISTINCT nome_servidor) > 1, 'SIM', 'NÃO') AS pdvs_roteamento_divergente
      FROM (
        SELECT codloja_clean, cod_pdv, nome_servidor
        FROM base_tef_pura
        WHERE cod_pdv IS NOT NULL
        GROUP BY codloja_clean, cod_pdv, nome_servidor
      )
      GROUP BY codloja_clean
    ),
    agrupado_gateways AS (
      SELECT
        b.codloja_clean,
        ARRAY_AGG(
          IF(UPPER(b.adquirente) NOT LIKE '%CARD%SE%' AND b.adquirente IS NOT NULL, b.adquirente, NULL)
          IGNORE NULLS ORDER BY b.vlr_transacao DESC LIMIT 1
        )[SAFE_OFFSET(0)] AS adquirente_cartao_principal,
        COUNT(1) AS total_transacoes_30d,
        COUNTIF(LOWER(b.des_status_transacao) LIKE '%efetuada%') AS transacoes_aprovadas_30d,
        SUM(b.vlr_transacao) AS volume_financeiro_30d,
        COUNTIF(b.canal_origem = 'TEF') AS tx_tef_30d,
        COUNTIF(b.canal_origem = 'POS') AS tx_pos_30d,
        SUM(CASE WHEN b.canal_origem = 'TEF' THEN b.vlr_transacao ELSE 0 END) AS volume_tef_30d,
        SUM(CASE WHEN b.canal_origem = 'POS' THEN b.vlr_transacao ELSE 0 END) AS volume_pos_30d
      FROM base_gateways_30d b
      GROUP BY b.codloja_clean
    ),
    base_pix_30d AS (
      SELECT
        LPAD(REGEXP_REPLACE(UPPER(CAST(cod_franquia AS STRING)), r'^(ES|PS)', ''), 8, '0') AS codloja_clean,
        des_adquirente AS psp_pix, des_grupo_franquia AS grupo_franquia, vlr_transacao, dt_transacao
      FROM \`trusted-zone.processadora.tb_transacoes_cartao_pix\`, processed_search
      WHERE dt_transacao BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
        AND LOWER(tp_produto) LIKE '%pix%'
        AND (${storeFilterPix})
    ),
    agrupado_pix AS (
      SELECT
        codloja_clean,
        ARRAY_AGG(grupo_franquia IGNORE NULLS ORDER BY dt_transacao DESC LIMIT 1)[SAFE_OFFSET(0)] AS grupo_franquia,
        ARRAY_AGG(psp_pix IGNORE NULLS ORDER BY vlr_transacao DESC LIMIT 1)[SAFE_OFFSET(0)] AS psp_primario_pix,
        COUNT(1) AS total_tx_pix_30d,
        SUM(vlr_transacao) AS volume_pix_30d
      FROM base_pix_30d
      GROUP BY codloja_clean
    )
    SELECT
      g.codloja_clean,
      COALESCE(c.grupo_franquia_cadastro, px.grupo_franquia, 'Não Informado') AS grupo_franquia,
      COALESCE(c.uf, 'N/A') AS uf,
      COALESCE(c.cidade, 'Não mapeada') AS cidade,
      COALESCE(c.bairro, 'Não mapeado') AS bairro,
      COALESCE(c.tipo_loja, 'Não informado') AS tipo_loja,
      COALESCE(c.modelo_loja, 'Não informado') AS modelo_loja,
      COALESCE(c.regional, 'Não informado') AS regional,
      st.ip_tef_atual AS cod_ip_sitef_tef_atual,
      COALESCE(st.nome_servidor_tef_atual, 'Sem Vendas TEF') AS nome_servidor_tef_atual,
      st.ip_tef_anterior AS cod_ip_sitef_tef_anterior,
      COALESCE(st.nome_servidor_tef_anterior, 'Sem Troca') AS nome_servidor_tef_anterior,
      COALESCE(st.trocou_servidor_30d, 'NÃO') AS trocou_servidor_30d,
      COALESCE(md.tef_multisservidor_mesmo_dia, 'NÃO') AS tef_multisservidor_mesmo_dia,
      COALESCE(md.servidores_mesmo_dia, 'Nenhum') AS servidores_mesmo_dia,
      COALESCE(dp.pdvs_roteamento_divergente, 'NÃO') AS pdvs_roteamento_divergente,
      COALESCE(g.adquirente_cartao_principal, 'Não Informado') AS adquirente_cartao_principal,
      COALESCE(px.psp_primario_pix, 'Sem Vendas Pix') AS psp_primario_pix,
      g.total_transacoes_30d,
      g.transacoes_aprovadas_30d,
      ROUND(SAFE_DIVIDE(g.transacoes_aprovadas_30d, g.total_transacoes_30d) * 100, 2) AS pct_aprovacao_30d,
      ROUND(g.volume_financeiro_30d, 2) AS volume_financeiro_30d,
      g.tx_tef_30d,
      ROUND(SAFE_DIVIDE(g.tx_tef_30d, g.total_transacoes_30d) * 100, 2) AS pct_uso_tef_30d,
      ROUND(g.volume_tef_30d, 2) AS volume_tef_30d,
      g.tx_pos_30d,
      ROUND(SAFE_DIVIDE(g.tx_pos_30d, g.total_transacoes_30d) * 100, 2) AS pct_uso_pos_30d,
      ROUND(g.volume_pos_30d, 2) AS volume_pos_30d,
      COALESCE(px.total_tx_pix_30d, 0) AS total_tx_pix_30d,
      ROUND(COALESCE(px.volume_pix_30d, 0), 2) AS volume_pix_30d
    FROM agrupado_gateways g
    LEFT JOIN agrupado_pix px ON g.codloja_clean = px.codloja_clean
    LEFT JOIN diagnostico_servidores_tef st ON g.codloja_clean = st.codloja_clean
    LEFT JOIN diagnostico_mesmo_dia md ON g.codloja_clean = md.codloja_clean
    LEFT JOIN diagnostico_pdvs dp ON g.codloja_clean = dp.codloja_clean
    LEFT JOIN dim_canal c ON g.codloja_clean = c.codloja_clean
    WHERE 1=1
      ${serverWhere}
    ORDER BY g.total_transacoes_30d DESC
    ${resultLimit}
  `;

  var queryParameters = [];

  if (!isMultiStore) {
    queryParameters.push(stringParam('search_term', isServerSearch || isUfSearch ? null : processedTerm));
  } else {
    queryParameters.push(stringParam('search_term', null));
    queryParameters.push(arrayStringParam('store_codes', storeCodesArray));
  }

  if (isServerSearch) {
    queryParameters.push(stringParam('server_term', processedTerm));
  }
  if (isUfSearch) {
    queryParameters.push(stringParam('uf_term', ufTerm));
  }

  return rowsToJson(runBigQuery(sqlQuery, queryParameters));
}
