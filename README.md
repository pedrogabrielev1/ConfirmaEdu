# ConfirmaEdu

Sistema compartilhado de controle das refeições da Escola Estadual Professor Antônio Dantas.

## Funcionalidades

- Cadastro e login com matrícula/usuário e senha.
- Perfis separados de aluno, cantina e direção.
- Primeiro usuário da direção liberado automaticamente.
- Demais funcionários aguardam aprovação da direção.
- Confirmação diária de almoço compartilhada entre todos os dispositivos.
- QR Code diário com validação no banco de dados.
- Registro manual de presença pela cantina.
- Cardápio semanal editável.
- Justificativas em PDF armazenadas com acesso restrito.
- Painel de ausências, relatórios e modo escuro.
- Nenhum aluno, cardápio ou registro vem preenchido previamente.

## Arquivos

- `index.html`, `style.css` e `script.js`: interface do sistema.
- `config.js`: conexão pública do Supabase.
- `database.sql`: cria todo o banco, permissões e armazenamento.
- `GUIA-RAPIDO.md`: configuração passo a passo.
- `supabase.js`, `qrcode.js` e `jsQR.js`: bibliotecas utilizadas pelo site.

## Publicação

Siga o arquivo `GUIA-RAPIDO.md`. Todos os arquivos podem ficar juntos na raiz do repositório; não é necessário criar uma pasta `vendor`.

## Segurança

Use no `config.js` apenas a chave **Publishable** ou **anon**. Nunca coloque a chave `service_role` no GitHub.
