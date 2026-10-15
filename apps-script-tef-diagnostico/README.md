# Consulta de Lojas e Servidores TEF

Google Apps Script + HTML (Google Sites / Web App) para diagnóstico de infraestrutura TEF/POS — PDF Pagamentos Presenciais.

## Arquivos

| Arquivo | Destino no Apps Script |
|---------|------------------------|
| `Codigo.gs` | Script principal (cole no editor `.gs`) |
| `index.html` | Arquivo HTML com o mesmo nome `index` |

## Como publicar

1. Abra o projeto no [Google Apps Script](https://script.google.com).
2. Substitua o conteúdo de `Codigo.gs` e `index` pelos arquivos desta pasta.
3. Em `CONFIG.projectId` (topo do `Codigo.gs`), confirme o projeto GCP.
4. Ative o serviço avançado **BigQuery API** no Apps Script.
5. Implantar → Nova implantação → Tipo **App da Web**.

## Melhorias desta versão

1. **Localização cadastral** via `trusted-zone.canal_loja.tb_canal_loja_geral_ttd`
   - UF (`estado`), `cidade`, `bairro`
   - Tipo local: `des_local_pdv_2` (Rua / Shopping / Hipermercado / Outros)
   - Modelo: `des_modelo` · Regional: `des_regional_atualizada`
   - Sem logradouro completo nesta tabela
   - Join com `LTRIM` + `LPAD(8)` em `cod_franquia` + `flg_cod_atual = 'x'`
2. **Busca por UF** no menu superior (select de estados)
3. **Layout institucional** alinhado à Plataforma de Homologação (banner Mooz/GB + nav sticky)
4. **Performance / manutenção**
   - CTEs de servidores e canal centralizadas
   - Filtro por UF antes do scan de transações (`lojas_filtro_uf`)
5. **Cache diário na planilha** (ver abaixo)

## Cache diário (planilha)

Como os dados do BQ fecham em **D-1** (atualizam ~1x/dia), o backend grava o resultado de cada pesquisa nas abas ocultas:

| Aba | Função |
|-----|--------|
| `_tef_cache_meta` | Índice: chave, modo, termo, `ref_date`, horário, chunks |
| `_tef_cache_data` | Payload JSON em chunks (suporta listas grandes) |

**Quando usa cache (não chama BQ):** mesma chave (`modo + termo normalizado`) com `ref_date = ontem`.

**Quando consulta o BQ de novo:**
1. Primeira vez daquele modo/termo no dia (miss)
2. Virada do dia (`ref_date` muda) → miss automático
3. Botão **Atualizar** / **Atualizar da base** (`forceRefresh = true`)
4. Antes das 08h (`pipelineReadyHour`): se ainda não há cache do D-1, reutiliza D-2 (evita BQ enquanto o pipeline pode estar rodando)

**Manutenção:** menu `TEF · Cache` na planilha → limpar expirado ou limpar tudo.  
Funções: `limparCacheExpirado()`, `limparCacheTef()`.  
Ajuste em `CONFIG.cache` no topo do `Codigo.gs`.

## Modos de busca

- `RESUMO_SERVIDORES` — cards globais
- `LOJA` — uma ou várias lojas
- `SERVIDOR` — lojas de um SiTef
- `UF` — lojas de um estado
- `TERMINAIS_LOJA` — drill-down de PDVs
