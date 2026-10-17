---
name: cleanup-dependabot
description: "Use quando o usuário digitar /utils:cleanup-dependabot ou pedir para limpar, resolver, rebasear ou mergear as PRs do Dependabot (bumps de dependência, security updates) deste repositório."
argument-hint: "[--dry-run] [--only N,N,...]"
allowed-tools:
  - Read
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# /utils:cleanup-dependabot

Esvazia a fila de PRs do Dependabot **sem furar o fluxo do projeto**: tudo chega a `main`
por `develop`, ninguém mergeia CI vermelho, e major só entra com alguém olhando.

Lê a fila de verdade (nunca de memória), resolve conflito PR a PR, mergeia o que pode e
devolve um relatório do que entrou, do que fechou e do que ficou — com o motivo de cada um.

## Uso

```
/utils:cleanup-dependabot                # a fila inteira
/utils:cleanup-dependabot --dry-run      # só inventário + plano; não comenta, não mergeia, não fecha
/utils:cleanup-dependabot --only 215,180 # só essas PRs (as outras nem são tocadas)
```

Qualquer outro argumento é inválido — diga e pare.

**Onde funciona:** raiz do repositório, com `gh` autenticado (`gh auth status`) e `python3`.
O helper é `${CLAUDE_PLUGIN_ROOT}/skills/cleanup-dependabot/scripts/dependabot.py` (sem `jq` — não há
`jq` nesta máquina). Rode `python3 <helper>` sem argumentos para ver os subcomandos.

## O que esta skill faz e o que não faz

| Faz | Não faz |
|---|---|
| Lista e classifica as PRs abertas do Dependabot (alvo, nível semver, grupo, CI) | Mergear em `main` — **nunca**, nem com CI verde |
| Pede `@dependabot rebase` e, se não resolver, refaz o bump numa branch própria | Editar `yarn.lock` à mão |
| Mergeia em `develop` com `--merge` quando CI verde e `mergeable` | Mergear com check faltando, pulado ou vermelho; `--admin`; force-push |
| Para PR contra `main`: cobre via `develop` e fecha com comentário | Fechar PR de `main` sem a versão já estar em `develop` |
| Major: resume breaking changes e **pergunta** antes de mergear | Mergear major sem um "sim" explícito para aquela PR |
| Deixa `develop` local sincronizado e entrega o relatório | Stash automático, `git reset`, trocar de branch com árvore suja |

---

## Passo 1 — Pré-condições

Da raiz do repo:

```bash
gh auth status                                  # falhou? pare
git status --porcelain --untracked-files=no     # modificação rastreada? pare e devolva — nada de stash
git fetch origin
D="${CLAUDE_PLUGIN_ROOT}/skills/cleanup-dependabot/scripts/dependabot.py"
```

Arquivo untracked não bloqueia (só avise); com `--dry-run` a árvore nem precisa estar limpa,
porque nada troca de branch.

Confira que `.github/dependabot.yml` ainda tem `target-branch: develop` nos dois
ecossistemas. Se alguém mudou isso, o raciocínio de "PR contra `main` é resíduo" deixa
de valer — diga e pergunte antes de seguir.

## Passo 2 — Inventário

```bash
python3 $D list          # tabela na ordem de trabalho
python3 $D list --json   # quando precisar dos campos (updates, ci_problems…)
```

Mostre a tabela ao usuário e, em uma linha por PR, o que pretende fazer com ela — use o
vocabulário do relatório (passo 6): **mergear**, **perguntar** (major), **rebase**,
**re-extrair**, **esperar**, **fechar**, **pular**. Com `--dry-run`, **pare aqui**.

A ordem que o helper devolve é a ordem de trabalho, e ela não é estética:

1. **Alvo `develop` antes de `main`** — as de `main` só se resolvem depois que `develop`
   recebeu os bumps, porque a regra para elas é "já está coberto em `develop`?".
2. **Grupo antes de single** — o grupo `minor-and-patch` costuma cobrir vários singles;
   mergeá-lo primeiro fecha os outros de graça. Mergear um single que está no grupo
   faz o Dependabot **recriar o grupo** sem ele — retrabalho.
3. **Sem major antes de major** — o que não precisa de pergunta entra primeiro.

Com `--only`, respeite a mesma ordem dentro do subconjunto. PRs que a própria skill criar
por re-extração (passo 5) de uma PR listada estão dentro do escopo — são a mesma PR em
outra roupa.

## Passo 3 — Loop nas PRs contra `develop`

Para cada PR, nesta ordem, **uma de cada vez** — cada merge pode virar as seguintes em
`CONFLICTING` (todas mexem em `yarn.lock`), e o `wait` da próxima é o que absorve isso.

### 3.1 · Estado

```bash
python3 $D wait N        # espera mergeable ≠ UNKNOWN e checks terminarem; sai 0 = pode mergear
```

`UNKNOWN` é o GitHub ainda calculando; o helper espera. Não conclua nada a partir de
`UNKNOWN`.

### 3.2 · Conflito → rebase → re-extração

`mergeable=CONFLICTING`:

```bash
python3 $D rebase N      # comenta "@dependabot rebase", espera o head mudar, depois wait
```

Se o Dependabot não responder no prazo (ele desiste quando o conflito não é só `yarn.lock`,
ou quando a branch já recebeu push humano), vá para a **re-extração** (passo 5) e, ao
final, feche a PR original.

**Nunca resolva `yarn.lock` à mão** e **nunca faça push na branch do Dependabot**: a
partir do primeiro push humano ele para de mantê-la, e o lockfile editado à mão é a
forma mais rápida de quebrar `--frozen-lockfile` no CI.

### 3.3 · CI vermelho

Não mergeie. Descubra o job:

```bash
gh pr checks N
gh run view <run-id> --log-failed | tail -60
```

- Falha que o bump explica (tipo novo, API removida, peer dep) → **pular**, reportar com o
  trecho do log. Esse bump precisa de código, e código é ticket — sugira
  `/linear-create-ticket`.
- Falha sem relação com o bump (rede, runner, teste flaky conhecido) → `gh run rerun <run-id> --failed`
  **uma vez**, `wait` de novo. Vermelho duas vezes = pular e reportar; não insista.
- **Job pulado não é verde.** O helper exige `Lint`, `Typecheck`, `Build` e `Unit tests` em
  `SUCCESS`. Se `CI pause check` pausou o CI (`.github/ci-pause.json`), os outros jobs nem
  rodam e a PR parece limpa — o helper diz `ausente`/`SKIPPED`. `rerun --failed` não
  reexecuta job pulado: **pule** a PR, com motivo "CI pausado até <data do ci-pause.json>",
  e não espere a pausa acabar dentro desta execução.

### 3.4 · Major → perguntar

Vale para single major e para grupo que contenha um major (o helper marca `⚠`).
Antes de mergear, leia o corpo da PR e extraia, em até 6 linhas: o que quebra, se o
projeto usa a API afetada (confira no código com `grep`), e a versão de Node/React exigida.

```bash
gh pr view N --json body --jq .body | grep -n -iE 'breaking|deprecat|drop|requires? node' | head
```

Depois pergunte com `AskUserQuestion`: mergear / pular / re-extrair como PR própria para
olhar melhor. **Sem "sim", não mergeia.** Um "sim" vale para aquela PR; o próximo major
pergunta de novo.

### 3.5 · Merge

Só quando `wait` saiu 0 (e o major foi autorizado):

```bash
gh pr merge N --merge    # --merge, como o resto do repo; nunca --admin, nunca squash
python3 $D wait N        # confirma MERGED
git pull --ff-only origin develop
```

Se o `--ff-only` falhar, a `develop` local divergiu — pare e pergunte; não force.

## Passo 4 — PRs contra `main`

O Dependabot abre security updates contra o default branch (`main`) mesmo com
`target-branch: develop`. Elas **não são mergeadas**: `main` só recebe `develop` no
release. Por isso `mergeable`, `CONFLICTING` e o CI dessas PRs são **irrelevantes** —
não peça `rebase` nelas; a única pergunta é se `develop` tem a versão. Para cada uma, e
para cada pacote dela (grupo tem vários):

```bash
python3 $D covered <pkg> <versão-alvo>            # confere yarn.lock (npm) ou uses: (actions) em origin/develop
```

| `covered` | Ação |
|---|---|
| **coberto** | Fechar com comentário (abaixo). Nada a fazer em `develop`. |
| **não usado** (pacote não está mais em `develop`) | Confirme que foi removido (`git log -S'"<pkg>"' --oneline -1 origin/develop -- package.json yarn.lock`) e feche como **obsoleta**, citando o commit. Nome errado no `covered` também dá "não usado" — confira antes. |
| **não coberto**, mas uma PR aberta contra `develop` traz a versão | Esperar o passo 3 terminar; rodar `covered` de novo. |
| **não coberto** de vez | **Re-extrair** (passo 5) contra `develop`, mergear, e só então fechar a de `main`. |

Comentário de fechamento — Markdown, curto, com o link do que cobre:

```bash
gh pr comment N --body "Coberto em \`develop\` por #215 (\`js-yaml\` resolvido em 4.3.2). Chega a \`main\` no próximo release \`develop → main\`; PRs de bump não entram em \`main\` diretamente neste repo (ver \`.github/dependabot.yml\`)."
gh pr close N
```

O alerta do Dependabot em `main` **continua aberto até o release** — isso é esperado. Diga
no relatório, para ninguém reabrir a PR achando que o alerta foi esquecido.

## Passo 5 — Re-extração (bump refeito numa branch própria)

Quando o rebase do Dependabot não resolveu, ou a PR mira `main` e `develop` não tem a
versão. Uma branch por PR original:

```bash
git checkout -b chore/deps-<pkg-slug>-<versão> origin/develop
```

- **Dependência direta** (está em `package.json`): edite o range em `package.json` para a
  versão-alvo (ferramenta `Edit`) e rode `yarn install` — o `yarn.lock` vem do yarn, nunca
  de você.
- **Transitiva** (só em `yarn.lock`): `yarn upgrade <pkg>` — sem `@versão`, senão o yarn
  clássico a promove a dependência direta.
- **GitHub Action**: edite `uses: <action>@vN` em `.github/workflows/*.yml`.

Confira com `python3 $D covered <pkg> <versão> HEAD`. Depois:

```bash
yarn lint && npx tsc --noEmit
git add package.json yarn.lock .github/workflows
git commit -m "chore(deps): bump <pkg> from <de> to <para> (re-extraído de #N)"
git push -u origin chore/deps-<pkg-slug>-<versão>
gh pr create --base develop --title "chore(deps): bump <pkg> from <de> to <para>" --body "Re-extraído de #N, que mira \`main\`. Fecha #N ao mergear."
```

Aí a PR nova segue o passo 3 (é uma PR contra `develop` como outra qualquer — inclusive
a pergunta de major). Mergeada, feche a original com comentário apontando a nova.

Se o `yarn upgrade` não chegar à versão-alvo (range do pai não permite), isso não é
bump de dependência, é mudança no pai — pare, reporte, sugira ticket.

## Passo 6 — Relatório

Uma tabela, uma linha por PR original:

| PR | Pacote(s) | Resultado |
|---|---|---|
| #215 | grupo minor-and-patch (7) | **mergeada** em `develop` (`<sha>`) |
| #180 | actions/upload-artifact 4→7 | **mergeada** após confirmação (major) |
| #204 | js-yaml 4.3.2 | **fechada** — coberta por #215 |
| #176 | @fullcalendar/react 6.1.21 | **re-extraída** em #2xx → mergeada; original fechada |
| #177 | react-apexcharts 2.1.1 | **fechada** — `develop` já tinha 2.1.1 |
| #1xx | … | **pulada** — CI vermelho: `<job>`, `<motivo em uma linha>` |

Abaixo da tabela: a nota do alerta em `main` (passo 4), o estado final da `develop` local
(`git log --oneline -1`), e o que ficou pendente com o próximo passo de cada um.

---

## Armadilhas

**`mergeable` demora a atualizar depois de cada merge.** O GitHub recalcula as outras
PRs em background; `UNKNOWN` por um minuto é normal. O helper espera — não decida na mão.

**Mergear um membro do grupo separadamente recria o grupo.** O Dependabot fecha o grupo
e abre outro sem aquele pacote. Por isso grupo vai primeiro.

**`gh pr checks` lista check antigo em PR de `main`.** O CI dessas rodou contra a árvore
de meses atrás; "verde" ali não diz nada sobre `develop`. É irrelevante — elas não são
mergeadas de qualquer forma.

**`e2e-gate` só roda em PR para `main`.** PR contra `develop` não paga a suíte e2e; "verde"
aqui é lint + typecheck + build + unit. É o combinado do projeto (ver `dependabot.yml`),
não uma lacuna sua — mas não venda como "e2e passou".

**Bump de `next`/`react` no grupo.** Minor de framework às vezes muda comportamento de
build; se `Build` passar mas o usuário quiser ver rodando, `/run` existe. Não invente
verificação manual sem pedido.

**Fechar PR de security update sem cobrir.** O alerta some da lista de PRs, não do
painel de segurança — e ninguém volta para olhar. Só feche com `covered` = coberto, ou
com o pacote comprovadamente removido do projeto.

## Pronto quando

- O inventário foi lido do `gh`, mostrado ao usuário, e cada PR tem um resultado no relatório.
- Nenhuma PR foi mergeada em `main`; nenhuma foi mergeada com check ausente, pulado ou vermelho.
- Nenhum major entrou sem uma resposta explícita de "mergear" para aquela PR.
- Toda PR de `main` fechada tem comentário apontando o que a cobre em `develop` — ou o
  commit que removeu o pacote.
- Toda PR pulada tem o motivo e o próximo passo (rerun, ticket, decisão do usuário).
- `develop` local está em `origin/develop` (`--ff-only` limpo) e a árvore está limpa.
