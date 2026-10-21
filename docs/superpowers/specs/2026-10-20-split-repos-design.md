# Front e API em repos separados, cada um com o próprio runbooks

Diagnóstico e proposta de 2026-10-20, aprovados em 2026-10-21 (seção 2). Base: runbooks 1.3.0, commit `2c9090a`. Caminhos relativos a `runbooks/`. Os números do Cheap Courier vêm do relato do usuário, porque o plugin não tem acesso àqueles repos.

## Resumo

A fonte com `root` em repo irmão só faz duas coisas hoje. Ela entra no total da cobertura e gera órfãos quando sai do config. Ela nunca ajudou o `--affected`, e o servidor upstream não a lê. Em CI, sem a pasta irmã, a fonte é pulada e leva junto a checagem de órfãos de todas as entries, inclusive as rotas do próprio front. Por isso o número do laptop e o do CI divergem.

A recomendação é a opção B. A API vira um contrato e deixa de ser uma fonte de entries. O front guarda o OpenAPI que a API publica em `upstream.schema`. Os endpoints que uma tela chama vão para um campo novo, `calls`, que não conta cobertura e não gera órfão. O `list --affected` passa a ler a mudança desse arquivo de schema. Quem cobre os endpoints é a instalação da API, com runbooks `api`.

## 1. Diagnóstico

### 1.1 O que a fonte com root em repo irmão entrega hoje

Como a fonte é lida: `extract.mjs:21-26` resolve `root` a partir da raiz do projeto e, quando a pasta não existe, avisa e pula a fonte. Os ids lidos guardam o root no `file` (`extract.mjs:39`), por exemplo `../cheap-courier-shipping-api/src/app/admin/quotes/route.ts`. O retorno marca `complete: false` quando alguma fonte não rodou (`extract.mjs:48`).

| Recurso | Com a pasta irmã | Sem a pasta irmã (CI, clone isolado) | Quando a fonte sai do config |
|---|---|---|---|
| Cobertura | Os 252 endpoints entram no total. Um runbook mocked não cobre nenhum (`coverage.mjs:100-106`). Num stack `frontend`, um runbook live cobre os endpoints que cita (`coverage.mjs:106-107`). É daí que vêm os 10 endpoints cobertos entre os 25: 25 de 309 com a API contra 15 de 57 sem ela. | A fonte é pulada com warning (`extract.mjs:23-26`). O total cai para as entries do front. O número muda conforme o que está clonado ao lado. | O total cai para 57, igual ao CI. |
| Órfãos | Funcionam. | Ficam desligados para a lista inteira de entries, não só para a fonte que faltou (`coverage.mjs:159-165`, mensagem em `format.mjs:63-65`). Uma rota do front renomeada passa sem órfão no CI. O teste `cli.test.mjs:128-142` fixa esse comportamento. | Todo id da API em `covers.entries` vira órfão (`coverage.mjs:166-169`). Deu 281 órfãos em 71 runbooks. |
| `list --affected` | Nunca vê a API. `changedFiles` roda `git diff --relative` e `ls-files` só no repo do projeto (`affected.mjs:5`, `affected.mjs:11-15`), e nenhuma linha começa com `../`. O casamento por entry (`affected.mjs:27-29`) e por slice (`affected.mjs:31-33`) nunca dispara para a API. `list.md:30` já manda o agente avisar disso. | Mesmo resultado. | Mesmo resultado. Remover a fonte não muda nada no `--affected`. |
| `list --path` | Um glob `../api/**` funciona (`filter.mjs:10-13`, `runbooks.mjs:57-59`). | Não acha nada. | Não acha nada. |
| `create` e `update` | Os comandos citam ids de `entries --json` (`create.md:57`, `create.md:91`, `create.md:123`, `update.md:89`, `update.md:106`). O agente consegue citar endpoints da API. | Os ids da API não existem. O agente não tem o que citar ou escreve o id à mão, e ninguém confere, porque a checagem de órfãos está desligada. | O `update` remove só "ids que nenhum passo alcança" (`update.md:106`). Os ids da API continuam sendo alcançados pelos passos, então ele os mantém, e não existe comando para limpar em lote. |
| `audit-runbooks` | Lê os órfãos de `coverage --json` (`audit-runbooks.md:34`). Órfão vira `broken` (`audit-runbooks.md:38`). | A checagem pulada não gera achado, e o audit diz `in-sync` para ids que não verificou. | Os 71 runbooks ficam `broken`. |
| `map` | Os endpoints da API aparecem como não cobertos, porque mocked não cobre. `map.md:48` manda pôr toda entry não coberta num placeholder ou na lista de não mapeadas, o que dá placeholders `ui` ou uma lista de 252 endpoints de outro repo. | Nada aparece. | Nada aparece. |
| UI | `runbooksView` e `coverageView` recalculam a partir de todas as fontes (`explore.mjs:49-63`, `explore.mjs:165-166`). O contador "routes covered" soma endpoints da API (`ui.html:389-396`). | Mostra outros números e lista o warning da fonte. | Cai para os números do CI. |
| Servidor upstream e `fixtures` | Não leem entries. O servidor só importa módulos do Node (`upstream-server.mjs:2-10`). O comando `fixtures` lê as fixtures e `upstream.schema` (`runbooks.mjs:127-148`). | Funcionam iguais. | Funcionam iguais. |
| `upstream.root` | Nenhum script lê. Aparece só em `setup.md:82` e `config.md:126`. | Sem efeito. | Sem efeito. |
| `upstream.start`, `data.seedHint` | São textos de dica. `run.md:55` mostra `upstream.start` quando `baseUrl` não responde, e `create.md:110` cita `data.seedHint` nas precondições. Um `cd ../cheap-courier-shipping-api && yarn dev` supõe a pasta irmã. | A dica aponta para uma pasta que não existe. | A dica some. |

A suíte do plugin também fixa o padrão: o projeto de teste tem uma fonte `"root": "../api"` e um slice `../api/...` (`scripts/__fixtures__/project/docs/runbooks/runbooks.config.json:13` e `:19`).

Conclusão: a fonte irmã não entrega nada que funcione em CI, e com a pasta presente ela só mexe em cobertura e órfãos. O `--affected`, que era a justificativa da ADR 0004 para manter endpoints em `covers.entries` (`docs/adr/0004-mocked-runbooks-never-cover-endpoints.md:3` e `:8`), nunca funcionou entre repos.

### 1.2 A regra de detecção do setup

Hoje o setup detecta o repo irmão pela URL no `.env.example` mais a pasta ao lado e oferece uma fonte com `root` (`setup.md:29`). Os slices levam "the matching API folders" (`setup.md:41`), a pergunta de stack trata "endpoints in a sibling repo" (`setup.md:47`), e o bloco upstream pergunta `upstream.start` e `upstream.root` "when the sibling repo is local" (`setup.md:82`). O setup recomenda `live` quando a pasta irmã sobe localmente (`setup.md:73`).

Sob a premissa de que cada repo tem a própria instalação, essa detecção não faz sentido num stack `frontend`:

- Ela lê arquivos do outro repo, e a premissa proíbe isso.
- O resultado depende da máquina. O mesmo setup grava um config diferente num clone isolado.
- O id e o arquivo da API não servem a nenhum comando do front que funcione em CI (seção 1.1).

Procurar `../<api>/docs/runbooks/runbooks.config.json` também lê a pasta irmã. Além disso, a resposta não mudaria o que o front faz, porque tendo a API runbooks ou não, os endpoints dela não viram entries do front. A única diferença seria o texto do resumo: "a instalação da API cobre os endpoints" ou "ninguém cobre os endpoints". Perguntar resolve isso sem ler nada, e nem a pergunta é necessária, porque o resumo pode dizer as duas coisas.

O que oferecer no lugar:

1. A chave `*API_URL` do `.env.example` indica uma API upstream fora do processo do app. Isso continua valendo para `upstream.urlEnv` (`setup.md:31`).
2. Uma pergunta: onde vive o código da API? As opções são outro repositório (recomendado quando nenhuma pasta deste repo tem endpoints), uma pasta deste repositório (monorepo, que mantém a fonte de entries com `root` dentro do projeto) e um terceiro.
3. Para outro repositório, perguntar o caminho onde o front guarda o OpenAPI publicado pela API (`upstream.schema`), recomendando `docs/runbooks/_contract/openapi.json`. Pastas com `_` dentro de `paths.runbooks` não viram runbooks (`lib/runbooks.mjs:139`). Quando a API não publica OpenAPI, o setup avisa que nada no front percebe uma mudança na API antes de um run live.
4. `upstream.start` vira uma dica sem caminho ("em cheap-courier-shipping-api: `yarn dev`"). `app.start` lista só comandos deste repo. O `data.seedHint` da API não volta: o script de um runbook live cria os dados pela API (`references/upstream.md:24`).
5. A recomendação de modo deixa de depender da pasta irmã. O critério "`live` when the sibling repo starts locally" (`setup.md:73`) vira "`live` quando `upstream.baseUrl` responde agora".

### 1.3 O contrato entre os repos sem ler arquivos do outro

| Caminho | Como o front fica sabendo de uma mudança | Quem roda o quê | Custos e limites |
|---|---|---|---|
| OpenAPI publicado pela API e versionado no front como `upstream.schema` | Um job agendado ou um PR de bot traz o arquivo novo. No PR, o `fixtures` acusa fixtures fora do schema (`fixtures.mjs:93-121`), e, com a proposta, o `list --affected` aponta os runbooks cujas `calls` tocam operações alteradas. | A API gera o OpenAPI no CI e publica como artefato, release ou pacote. O CI do front baixa o arquivo e abre o PR. O plugin só lê o arquivo local, porque não lê URLs (`config.md:130`). | A API precisa gerar OpenAPI. O validador é parcial (`schema.mjs:1-2`) e confere só respostas, sem corpo de request (`fixtures.mjs:109-118`). Mudança de semântica sem mudança de forma passa. |
| Fixtures gravadas com `--record` contra a API live | Só quando alguém regrava e lê o diff. Nada diz quando regravar. | Um dev do front roda `/runbooks:run <id> --record` com a API no ar e dados criados pelas precondições (`references/upstream.md:146-162`). | Gravar passa pelo browser e precisa da API de pé. O diff tem ruído de ids e datas. Serve como dado do runbook mocked, não como sinal de mudança. |
| Arquivo exportado pelo runbooks da API (lista de endpoints ou manifesto) | O front compara o manifesto novo com o antigo: endpoint sumiu, hash do handler mudou, runbook `api` falhou. | A API roda um comando novo de export no CI. O front importa como no OpenAPI. | Acopla as duas instalações ao mesmo formato de id (`GET /x/[id]` do `next-app-router`) e a um arquivo novo que o plugin teria de versionar. Não descreve a forma das respostas. O hash do arquivo muda em qualquer refactor. Obriga a API a usar runbooks. |
| Só o modo live contra a API | Um passo live falha. | O CI do front precisa de uma API publicada com dados de teste, ou de subir a API, o que fere a premissa. | O sinal chega tarde e é amplo. A ADR 0003 escolheu mocked justamente para não depender disso (`docs/adr/0003-mocked-upstream-served-by-plugin-server.md:3`). |

O OpenAPI é o único caminho que dá um sinal cedo, roda no CI do front sem a API e não exige runbooks do outro lado. O live continua útil como smoke em poucos runbooks, e as fixtures gravadas continuam sendo o dado dos runbooks mocked.

### 1.4 O que covers.entries deve conter num stack frontend com upstream externo

Hoje um runbook mocked lista endpoints em `covers.entries` só para o `--affected` (ADR 0004, linha 3), e o `--affected` não os enxerga entre repos (seção 1.1). Um runbook live do front conta como cobertura de endpoints de outro repo (`coverage.mjs:106-107`), e a instalação da API não enxerga essa cobertura.

Proposta: `covers.entries` lista só entries deste repo. Os endpoints de uma API upstream externa vão para `calls`, uma lista de `METHOD /path` no formato do OpenAPI (`GET /admin/quotes/{id}`). O loader aceita `[id]` e normaliza para `{id}`. O campo `calls`:

- não entra na cobertura e não gera órfão;
- vale para runbooks `ui`, live ou mocked, e exige o bloco `upstream` no config;
- é conferido contra `upstream.schema`, quando existe, e contra as fixtures (toda request de fixture precisa casar com uma call);
- alimenta o `--affected` quando o arquivo de schema muda.

Não listar endpoint nenhum também resolve a cobertura, mas perde a lista de runbooks que uma mudança na API alcança. Derivar as calls das fixtures não serve para runbooks live, que não têm fixtures, e as fixtures guardam caminhos concretos por passo. A checagem cruzada entre fixtures e calls mantém os dois coerentes.

Convivência com as ADRs:

- A 0002 (`docs/adr/0002-endpoint-coverage-by-surface.md:1`) continua valendo dentro de um repo. Num stack `frontend` com route handlers próprios (BFF no Next.js), esses handlers são entries do front, e os runbooks `ui` live os cobrem.
- A 0004 continua valendo para endpoints do mesmo repo, como num monorepo. Para uma API em outro repo, a ADR nova troca a consequência "the endpoints from a sibling repo are covered only by live ui runbooks" (`0004...md:12`) por "o front não cobre endpoints de outro repo".

### 1.5 Cobertura e UI

Primeiro os bugs, separados do que é decisão de produto.

Bug 1, a divergência entre relatório e UI. As contas batem: 8.1% é o `overall` tanto na CLI quanto na UI. O que falta é escopo. A API da UI só lê `slice` (`ui-server.mjs:56-57`), e `coverageView` sempre chama `coverageResult` com filtros vazios (`explore.mjs:165-166`). Mesmo assim, `coverage.md:34` oferece `/runbooks:ui` logo depois de gravar um relatório filtrado, e o usuário cai numa página que não mostra o escopo que acabou de ver. A correção é a UI aceitar os mesmos filtros (`path`, `feature`, `capability`, `slice`), porque `coverageResult` já os recebe (`project.mjs:16`), e a linha final do `coverage` passar a apontar para o escopo do relatório.

Bug 2, os órfãos desligados em lote. A checagem de órfãos é tudo ou nada por lista (`coverage.mjs:159-165`). `coverage.md:8` documenta isso como intencional, mas a consequência esconde defeitos do próprio front no CI. Com a proposta, nenhuma fonte de entries aponta para fora do projeto, e o caso some. A regra fica para fontes `command` de requirements que falham.

Agora as decisões de produto. Declarar escopo no config, como um `coverage.exclude`, seria uma segunda forma de manter entries alheias e escondê-las do número. Com `calls`, elas deixam de ser entries, e o escopo no config não é necessário. A paridade de filtros na UI é barata e eu recomendo. Decidir se o relatório e a UI mostram um resumo de calls ("12 operações chamadas por 9 runbooks, fora da cobertura") é opcional.

### 1.6 Migração dos projetos que já têm a fonte do repo irmão

Detecção, no `setup` (passo 1, "An existing config"), no `settings sources` e como warning do loader em `list` e `coverage`:

- uma fonte de `entries` cujo `root` resolve fora da raiz do projeto;
- um glob de `slices` que começa com `../`;
- `upstream.root` diferente de `null`, que nenhum script lê;
- `app.start`, `upstream.start` ou `data.seedHint` com `cd ../`, para o agente mostrar e perguntar.

Limpeza segura e revisável, com um comando novo, `runbooks.mjs move-to-calls`:

1. Os candidatos dependem do caso. Com a pasta irmã presente, são os ids que a fonte fora do projeto produz. Sem ela, como no Cheap Courier depois da remoção manual, são os órfãos de entry no formato `METHOD /path`. Se alguma outra fonte não rodou, o comando sai com 2, pela mesma razão de `coverage.mjs:159`: não dá para separar id removido de id não lido.
2. Sem `--write`, o comando faz um dry run. Ele imprime, por runbook, os ids que vão para `calls` e os órfãos que ficam (rotas `ui` renomeadas, que são assunto do `/runbooks:update`). Imprime também a cobertura antes e depois ("25/309, 8.1% para 15/57, 26.3%").
3. Com `--write`, o comando reescreve só as chaves `covers.entries` e `calls` do frontmatter, nas três formas que o parser aceita (`references/format.md:50`): lista em linha, lista em linha quebrada em várias linhas e lista com `- item`. O resto do arquivo fica byte a byte igual. Ele normaliza `[id]` para `{id}`, remove duplicatas e é idempotente.
4. O comando não mexe em `status` nem em `last_run`, porque os passos não mudaram (o `outdated` de `update.md:117` vale para mudança de passo).
5. O `settings` mostra o diff do config (fonte, globs `../`, `upstream.root`, as dicas com `cd ../`) e o `git diff` dos runbooks antes de escrever. O config vai no commit de `setup` e os runbooks no de `runbooks` (`references/commits.md`).

### 1.7 O lado da API

A instalação da API usa `stack: backend`, com uma fonte `next-app-router` sobre os próprios route handlers, já que o glob atual é `src/app/admin/**/route.ts`, e `tests.api`. Pela ADR 0002, um endpoint só conta como coberto por um runbook `api` (`coverage.mjs:101-103`). Com o front fora da conta, essa instalação passa a ser a única dona da cobertura de endpoints, sem mudança de código.

O que ela precisa expor para o front é o OpenAPI 3 em JSON, gerado pela ferramenta da própria API e publicado no CI. O plugin não gera esse arquivo. A API não precisa saber que o front existe.

Uma adição opcional para uma segunda fase: na instalação da API, `runbooks.mjs contract --schema <file>` conferiria que todo `api-endpoint` das entries tem operação no OpenAPI e vice-versa, para que o contrato publicado não perca endpoints. Na mesma linha, o front poderia exportar as próprias `calls` como artefato, para a API ver quem consome cada operação. Eu deixaria as duas coisas para depois.

## 2. Opções de design

| | A. Só parar de oferecer | B. Contrato por OpenAPI e `calls` (recomendada) | C. Manifesto exportado pelo runbooks da API |
|---|---|---|---|
| O que muda | O setup não oferece mais fonte irmã, o loader avisa sobre roots fora do projeto e um comando remove os endpoints de `covers.entries`. Runbooks mocked não listam endpoints. | Tudo de A, mais `calls`, `contract`, `--affected` a partir do diff do schema, migração para `calls` e paridade de filtros na UI. | Tudo de A, mais `runbooks.mjs export` na API e `upstream.manifest` no front. A cobertura do front mostra o estado dos endpoints na API, de forma informativa, e o `--affected` lê o diff do manifesto. |
| Como o front sabe de mudança na API | Não sabe, até um run live falhar. | Pelo PR que atualiza o schema: `--affected` e `contract`. | Pelo PR que atualiza o manifesto. |
| Custo | Baixo: docs, um warning e um comando de limpeza. | Médio: dois comandos novos, um campo novo, um módulo de contrato e o editor de frontmatter. | Alto: formato novo versionado nas duas pontas, mais o que B já pede para não perder `calls`. |
| Riscos | Perde a lista de runbooks que uma operação alcança. O run mocked continua verde com fixtures velhas. | Depende de a API publicar OpenAPI. O validador é parcial. Sem schema, só sobra a checagem entre fixtures e calls. | Acopla as duas instalações ao formato de id e à versão do plugin. O hash do handler gera ruído. Não confere forma de resposta. |

Recomendo B, em três entregas:

1. 1.4.0: correção da UI (filtros), warnings do loader, novas regras do setup e do settings, campo `calls`, `move-to-calls` e a ADR 0005.
2. 1.5.0: comando `contract` e `--affected` a partir do diff do schema.
3. 2.0.0: `root` fora do projeto vira erro de config, inclusive `tests.<surface>.root`. É breaking para quem usa um stack `fullstack` espalhado em dois repos, como o exemplo de `config.md:52`.

Decisões aprovadas em 2026-10-21:

- A opção B, com o campo `calls`.
- `contract --strict` sai com 1 quando acha problema. Hoje o script só usa 0 e 2 (`runbooks.mjs:46`), e um gate de CI precisa de um código para "rodou e achou problema".
- Root fora do projeto gera warning na 1.4 e erro de config na 2.0.
- O schema versionado fica por padrão em `docs/runbooks/_contract/openapi.json`.

## 3. ADR

Gravada em `runbooks/docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`. O texto abaixo é o rascunho aprovado.

Arquivo: `docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`

```markdown
# An upstream API in another repository is a contract, not an entry source

When the upstream API of a `ui` project lives in another repository, that repository has its own runbooks install, and neither reads the other's files. CI checks out one repository at a time, so a source whose `root` points outside the project never runs there, and `list --affected` never sees the other repository's changes, because it diffs this repository only. So every `entries` source, `slices` glob and `tests.<surface>.root` resolves inside the project root. The endpoints a screen calls go in the runbook's `calls`, as `METHOD /path` templates of the upstream API. `calls` never counts as coverage and never makes an orphan. The upstream API's own install owns the coverage of its endpoints, through its `api` runbooks (ADR 0002). The contract between the two repositories is the OpenAPI 3 document the API publishes and the front keeps as `upstream.schema`. `runbooks.mjs contract` checks every call and every fixture against it, and `list --affected` turns a change of that file into the runbooks whose calls reach a changed operation. For an API in another repository, this replaces the part of ADR 0004 that kept a mocked runbook's endpoints in `covers.entries`: `list --affected` never found them there. A monorepo, where the API is a folder of the same repository, keeps ADR 0002 and ADR 0004 unchanged.

## Considered Options

- Keeping sibling sources and skipping them when the folder is missing. Rejected: coverage, orphans and the slice table then depend on what is cloned next to the project, so CI and a laptop report different numbers, and a skipped source turns off the orphan check for every entry.
- Reading the sibling's runbooks config to learn whether the API has its own install. Rejected: it reads the other repository, and the answer changes nothing the front does.
- Importing a manifest exported by the API's runbooks install (its endpoints and the `api` runbooks that cover them). Rejected for now: it ties both installs to one id format and to a new file format, and it says nothing about response shapes. An OpenAPI document carries the operations and their shapes, and the API does not need runbooks to publish one.
- Recorded fixtures as the contract. Rejected as the signal of a change: they change only when someone records again against a live API, so they cannot say when to record. They stay the data of mocked runbooks.
- Live runs as the only check. Rejected: the front's CI would need a deployed API with test data, and a change would show up late, as a failed step.
- Leaving the endpoints out of the runbook entirely. Rejected: the front would lose the list of runbooks that a changed operation reaches.
- Deriving the calls from the fixtures. Rejected: live runbooks have no fixtures, and fixtures hold concrete paths per step. `contract` checks that fixtures and calls agree instead.

## Consequences

- A project set up with a sibling source gets a warning from `list` and `coverage` until `/runbooks:settings sources` removes it. `runbooks.mjs move-to-calls` moves the endpoint ids from `covers.entries` to `calls`, as a dry run first.
- Endpoints of the other repository leave the front's coverage. The front's percentage measures its own entries, and the endpoints a `live` runbook used to cover count only in the API's install.
- Without `upstream.schema`, nothing in the front notices an API change before a `live` run. `setup` says so when the API publishes no OpenAPI document.
- The plugin fetches nothing. Bringing the published document into the front (a scheduled job, a bot pull request, a dispatch from the API's CI) is the project's CI.
- A `fullstack` stack spans one repository. A `root` outside the project warns in 1.4 and becomes a config error in 2.0.
```

E uma linha nova no fim das Consequences da 0004: "For an upstream API in another repository, ADR 0005 replaces this: the front lists those endpoints in `calls`, and they are covered only in the API's own install."

## 4. Mudanças por arquivo

### Commands

- `commands/setup.md`
  - `:29`: trocar a regra do repo irmão pelas perguntas da seção 1.2. Nunca ler pasta irmã. `root` só dentro do projeto.
  - `:41`: "plus the matching API folders" só quando a pasta está dentro do projeto.
  - `:47`: tirar "or the endpoints live in a sibling repo".
  - `:70-83`: tirar `upstream.root`. `upstream.start` vira dica sem caminho. Perguntar `upstream.schema` com o caminho recomendado e o aviso de quando ele falta. O critério de `live` (`:73`) passa a ser "`baseUrl` responde".
  - Passo 1, "An existing config": detectar roots fora do projeto, globs `../`, `upstream.root` e dicas com `cd ../`.
  - Passo 3: um item "Sibling sources" que segue o fluxo da seção 1.6.
  - Passo 4: resumo com a cobertura antes e depois e a lista de runbooks alterados.
- `commands/settings.md`
  - Tabela `:66-84`: uma linha nova para "uma fonte de entries fora do projeto sai", que roda `move-to-calls` em dry run, mostra os números e escreve depois do sim.
  - Grupo `upstream` (`:52`): tirar `root`.
  - Grupo `app` (`:45`): mostrar `app.start` e `data.seedHint` com `cd ../`.
- `commands/upgrade.md:42-44`: dizer que o `setup` oferece a migração quando o config tem root fora do projeto.
- `commands/list.md:30`: trocar o aviso do root irmão pela explicação do motivo `upstream schema: <op> changed`, e avisar quando não há `upstream.schema`.
- `commands/coverage.md:34`: a oferta de `/runbooks:ui` aponta para o mesmo escopo do relatório.
- `commands/ui.md:21`: citar que a página aceita o escopo do relatório.
- `commands/create.md:57`, `:91`, `:121-123`: com upstream externo, os endpoints que a tela chama vão para `calls`. `covers.entries` fica só com entries deste repo. `:133`: as fixtures escritas a partir do schema usam as `calls`.
- `commands/update.md:89`, `:106`: o mesmo para `calls`, que ganham e perdem itens conforme os passos.
- `commands/run.md`, depois do record (`:53-56` e o passo do relatório): requests gravadas fora de `calls` entram em `calls`, ou o agente pergunta.
- `commands/audit-runbooks.md:34-55`: checar que toda call casa com uma operação de `upstream.schema` (`drift`) e que toda fixture casa com uma call (`drift`), a partir de `contract --json`.
- `commands/map.md:43-48`: num stack `frontend` com upstream externo, as calls do placeholder saem da leitura do código. Endpoints de outro repo não são entries a mapear.

### References e docs

- `skills/runbooks/references/config.md`
  - `:44`: `tests.<surface>.root` só dentro do projeto.
  - `:52`: o exemplo vira `"root": "apps/api"`.
  - `:125-126`: `start` como dica, `root` obsoleto.
  - `:130`: `schema` como o documento publicado pela API e versionado no front.
  - `:156` e `:166`: root fora do projeto avisa, e na 2.0 vira erro.
  - Uma lista nova de warnings do loader.
- `skills/runbooks/references/format.md:9-45`: a chave `calls` no exemplo e na tabela.
- `skills/runbooks/references/coverage.md:8` (tirar o exemplo do root irmão) e `:14`: um parágrafo sobre `calls`, fora da cobertura, com a razão na ADR 0005.
- `skills/runbooks/references/upstream.md`: uma seção nova, "Contract", com o schema publicado, um exemplo de job que traz o arquivo, o comando `contract` e o `--affected`. O `:22` deixa de falar em sibling repo.
- `CONTEXT.md`: termos novos **Call** e **Contract**, e "Upstream API" (`:42-44`) dizendo que pode viver em outro repo com instalação própria.
- `docs/adr/0005-upstream-api-in-another-repo-is-a-contract.md`: novo. `docs/adr/0004-...md`: a linha de ponteiro.
- `README.md` e `templates/readme.md`: uma frase sobre repos separados.

### Scripts

- `scripts/lib/config.mjs`
  - `config.warnings` para roots de `entries` e `tests` fora do projeto (via `path.relative` começando com `..`), globs de `slices` com `../` e `upstream.root` presente.
  - `:150`: tirar `root` dos defaults de `upstream`.
  - 2.0: trocar os warnings por `ConfigError`.
- `scripts/lib/runbooks.mjs:80`, `:125`: ler `calls` com `asList`, validar a forma `METHOD /path`, normalizar `[x]` para `{x}`. Problemas: "calls applies only to ui runbooks" e "calls needs an upstream block in the config".
- `scripts/lib/fixtures.mjs:65-79`: exportar `findTemplate` e `serverPrefix`.
- `scripts/lib/contract.mjs` (novo)
  - `operationsOf(doc)`: método e template, com responses, parâmetros e request body resolvidos por `$ref`.
  - `matchCall(call, doc)`: reaproveita `findTemplate` e `serverPrefix`.
  - `changedOperations(before, after)`: `added`, `removed` e `changed`, ignorando `description`, `summary`, `tags`, `operationId` e `x-*`.
  - `checkContract({ runbooks, fixtures, doc })`: call fora do schema e fixture fora das calls.
- `scripts/lib/affected.mjs`
  - `schemaAtBase(projectRoot, base, file)` com `git show <base>:<file>`. Sem o arquivo na base, nenhum motivo de schema.
  - `affectedRunbooks` recebe `contractChanges` e gera o motivo `upstream schema: GET /quotes/{id} changed`.
- `scripts/lib/frontmatter-edit.mjs` (novo): reescreve `covers.entries` e `calls` nas três formas de lista e preserva o resto do arquivo.
- `scripts/runbooks.mjs`
  - Comandos `contract [--strict]` e `move-to-calls [--source n] [--write]`.
  - `list --affected` liga o diff do schema (`:62-63`).
  - Junta `config.warnings` aos warnings de `list` e `coverage` (`:173-177`).
  - USAGE (`:22-47`).
- `scripts/lib/explore.mjs:165`: `coverageView(root, config, filters)` com `path`, `feature`, `capability` e `slice`. `:114-130`: `runbookView` devolve `calls`.
- `scripts/ui-server.mjs:56-57`: repassar os filtros da query string.
- `templates/ui.html:751-763`: montar a query a partir da rota, mostrar o escopo e mostrar as calls na página do runbook.
- `scripts/upstream-server.mjs`: só o `VERSION` (`:12`) e `.claude-plugin/plugin.json`.

### Templates e fixtures de teste

- `templates/runbook.md` e `templates/placeholder.md`: `calls: []` comentado como "only with an upstream API in another repository".
- `scripts/__fixtures__/front/`: novo projeto de front isolado. Stack `frontend`, upstream `mocked`, `docs/runbooks/_contract/openapi.json`, um runbook mocked com `calls` e fixtures, e um live com `calls`.
- `scripts/__fixtures__/project/`: mantém a fonte `../api` para testar o warning e a migração. Os testes de `cli.test.mjs` que conferem o stderr vão ganhar o warning novo e precisam ser ajustados.

## 5. Testes que provam o comportamento novo

O teste central é o de um front sem acesso ao repo da API em CI. Em `cli.test.mjs`, ele copia `__fixtures__/front` para um `mkdtemp` novo, onde nenhuma pasta irmã existe, roda `git init` e faz um commit. Depois confere:

- `coverage --json`: `warnings` vazio, `orphanChecksSkipped` vazio, `entries.total` igual ao número de entries do front, nenhuma call em `orphans`;
- `contract --strict`: sai com 0;
- `list --affected main`: roda sem erro e não depende de nada fora da pasta;
- `upstream --port 0`: sobe e serve as fixtures, de modo que o servidor continua independente de entries.

Os outros testes, por arquivo:

1. `runbooks.test.mjs`
   - `calls` normaliza `[id]` para `{id}` e remove duplicatas.
   - Uma call sem método ou sem `/` vira problema.
   - Um runbook `api` com `calls` vira problema.
   - `calls` sem bloco `upstream` vira problema.
   - `loadConfig` avisa sobre root de entries e de tests fora do projeto, glob `../` e `upstream.root`, e não avisa sobre `root: "apps/api"`.
2. `coverage.test.mjs`
   - Uma call que nenhuma entry tem não vira órfão.
   - Os totais com e sem `calls` são iguais.
   - Um runbook live com `calls` não cobre nada.
3. `contract.test.mjs` (novo)
   - `matchCall` com template e prefixo de servidor.
   - `changedOperations` detecta resposta alterada através de `$ref`, operação removida e operação nova, e ignora mudança só de `description`.
   - `checkContract` acusa call fora do schema e fixture fora das calls.
   - `contract --strict` sai com 1 quando há achados e com 0 quando não há.
   - Sem schema, o comando confere só fixtures contra calls.
4. `affected.test.mjs`, num repo git temporário a partir de `__fixtures__/front`
   - O schema v1 está em `main`. Um branch muda a resposta de `GET /quotes/{id}`, e `list --affected main --json` traz o runbook que chama essa operação, com o motivo `upstream schema: GET /quotes/{id} changed`.
   - O runbook que chama só `GET /shipments` não aparece.
   - Uma operação removida aparece como `removed`.
   - Sem schema na base, não há motivo de schema.
5. `move-to-calls.test.mjs` (novo)
   - Na cópia de `__fixtures__/project`, com `../api` presente, o dry run lista os ids por runbook e a cobertura antes e depois, e não escreve nada.
   - `--write` move os ids. O arquivo fica igual a um golden fora das linhas de `covers.entries` e `calls`.
   - Uma segunda execução não muda nada.
   - O comando funciona nas três formas de lista.
   - Sem a fonte e sem a pasta, os candidatos são os órfãos `METHOD /path`, e as rotas `ui` órfãs ficam onde estão e aparecem na saída.
   - Com uma fonte `command` que falha, o comando sai com 2.
6. `explore.test.mjs` e `ui-server.test.mjs`
   - `/api/coverage?path=src/**` devolve os mesmos totais que `coverage --path 'src/**' --json`.
   - O mesmo vale para `feature` e `capability`.
   - `runbookView` devolve `calls`.
7. `plugin.test.mjs:88-92`
   - Os títulos de `upstream.md` incluem "Contract".
   - O teste de links de `${CLAUDE_PLUGIN_ROOT}` (`:13-23`) já cobre os ponteiros para a ADR 0005.
