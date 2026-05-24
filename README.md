# Tibia XP/h Simulator

Calculadora para modelar hunts de Tibia e comparar XP/h simulada com logs reais. O objetivo principal é testar se aumentos pequenos de dano geram ganho real de XP/h ao longo da hunt, levando em conta rotação, box, crítico, charm, vocação, cobertura e comportamento observado no server log.

## Como Rodar

```bash
npm run dev
```

Abra o endereço mostrado no terminal. A entrada canônica do app é `app/index.html`.

## Validação

```bash
npm run validate
```

Esse comando roda:

- `npm run check`: valida sintaxe dos scripts embutidos no HTML.
- `npm test`: smoke tests do parser/validador com fixtures pequenas.
- `npm run bench`: bancada simples de logs sanitizados.
- `npm run git:ready`: diagnóstico de Git/GitHub para commits e pushes.

## Logs Reais

Não versionar logs completos ou privados sem revisão. Para testes, use trechos sanitizados em `tests/fixtures`.

## Fluxo Recomendado Para Codex

1. Ler `AGENTS.md`.
2. Fazer mudanças pequenas e focadas.
3. Rodar `npm run validate`.
4. Mostrar resumo do diff.
5. Criar commit apenas quando solicitado.
6. Fazer push apenas quando solicitado.

## GitHub

O projeto ainda precisa ser conectado ao repositório GitHub existente:

```bash
git remote add origin <URL_DO_REPO_EXISTENTE>
```

Também é necessário configurar:

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@example.com"
gh auth login
```
